// research-engine.ts
import { deltaClient } from "./delta-client";
import { analyzeMarkets } from "./groq-client";
import { storage } from "./storage";
import type { TradingMode } from "@shared/schema";

const SYMBOL = "ETHUSD";

function getTimestampRange(resolution: string, candles = 150) {
  const now = Math.floor(Date.now() / 1000);
  const seconds =
    resolution === "5m"
      ? 5 * 60
      : resolution === "15m"
      ? 15 * 60
      : resolution === "1h"
      ? 60 * 60
      : resolution === "1d"
      ? 24 * 60 * 60
      : 5 * 60;
  return {
    from: now - candles * seconds,
    to: now,
  };
}

export async function fetchMultiTimeframeData(): Promise<Record<string, any[]>> {
  const timeframes = {
    "5m": { resolution: "5m", ...getTimestampRange("5m") },
    "15m": { resolution: "15m", ...getTimestampRange("15m") },
    "1H": { resolution: "1h", ...getTimestampRange("1h") },
    "1D": { resolution: "1d", ...getTimestampRange("1d") },
  };

  const results: Record<string, any[]> = {};

  for (const [tf, cfg] of Object.entries(timeframes)) {
    try {
      const data = await deltaClient.getOHLCV(SYMBOL, cfg.resolution as any, cfg.from, cfg.to);
      // deltaClient.getOHLCV returns object {symbol, timeframe, data, resolutionUsed?, paramNameUsed?}
      if (data && Array.isArray(data.data)) {
        results[tf] = data.data;
      } else if (Array.isArray(data)) {
        results[tf] = data;
      } else {
        // In case delta-client returns structure different, attempt to extract
        results[tf] = data?.data || [];
      }
    } catch (error: any) {
      // show detailed error info (helps debugging)
      console.error(`Error fetching ${tf} data:`, error.message || error);
      if ((error as any).details) {
        console.error("OHLCV attempt details:", JSON.stringify((error as any).details, null, 2));
      } else if (error?.response?.data) {
        console.error("Axios response body:", JSON.stringify(error.response.data, null, 2));
      }
      results[tf] = [];
    }
  }

  return results;
}

export async function calculateVolatility(ohlcv: any[]): Promise<number> {
  if (!Array.isArray(ohlcv) || ohlcv.length < 2) return 0;
  const returns: number[] = [];
  for (let i = 1; i < ohlcv.length; i++) {
    const prev = Number(ohlcv[i - 1].close);
    const cur = Number(ohlcv[i].close);
    if (!prev || !cur) continue;
    returns.push((cur - prev) / prev);
  }
  if (returns.length === 0) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / returns.length;
  return Math.sqrt(variance) * 100;
}

export async function researchMarkets(tradingMode: TradingMode) {
  console.log(`Starting market research for ${tradingMode} mode...`);
  try {
    // fetch OHLCV & orderbook concurrently
    const [ohlcvData, orderbook] = await Promise.all([
      fetchMultiTimeframeData(),
      deltaClient.getOrderbook().catch(err => {
        console.error("Orderbook fetch failed:", err?.message || err);
        return { buy: [], sell: [] };
      }),
    ]);

    const primaryTF =
      tradingMode === "scalping"
        ? "5m"
        : tradingMode === "intraday"
        ? "15m"
        : tradingMode === "swing"
        ? "1H"
        : "1D";

    const volatility = await calculateVolatility(ohlcvData[primaryTF] || []);

    const marketData = [
      {
        symbol: SYMBOL,
        timeframe: primaryTF,
        ohlcv: ohlcvData[primaryTF] || [],
        orderbook: {
          buy: (orderbook?.buy || []).slice(0, 10),
          sell: (orderbook?.sell || []).slice(0, 10),
        },
        volume: 0,
        volatility,
      },
    ];

    const analysis = await analyzeMarkets(marketData, tradingMode);

    // Save analysis (make sure types match your schema)
    await storage.createAnalysis({
      tradingMode,
      recommendedAsset: analysis.recommendedAsset,
      direction: analysis.direction,
      entryPrice: analysis.entryPrice.toString(),
      stopLoss: analysis.stopLoss.toString(),
      takeProfit: analysis.takeProfit.toString(),
      confidence: analysis.confidence,
      strongestAssets: analysis.strongestAssets,
      weakestAssets: analysis.weakestAssets,
      patternExplanation: analysis.patternExplanation,
      multiTimeframeReasoning: analysis.multiTimeframeReasoning,
      marketData,
    });

    console.log("Market analysis completed:", analysis.recommendedAsset, analysis.direction);
    return analysis;
  } catch (error) {
    console.error("Error in market research:", (error as any).message || error);
    return null;
  }
}