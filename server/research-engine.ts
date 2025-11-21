import { deltaClient } from "./delta-client";
import { groq, analyzeMarkets } from "./groq-client";
import { storage } from "./storage";
import type { TradingMode } from "@shared/schema";

const SYMBOL = "ETHUSD"; // fixed

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

export async function fetchMultiTimeframeData(): Promise<any> {
  const timeframes = {
    "5m": { resolution: "5m", ...getTimestampRange("5m") },
    "15m": { resolution: "15m", ...getTimestampRange("15m") },
    "1H": { resolution: "1h", ...getTimestampRange("1h") },
    "1D": { resolution: "1d", ...getTimestampRange("1d") },
  };

  const results: any = {};

  for (const [tf, cfg] of Object.entries(timeframes)) {
    try {
      const data = await deltaClient.getOHLCV(
        cfg.resolution,
        cfg.from,
        cfg.to
      );
      results[tf] = data.data;
    } catch (err) {
      console.error(`Error fetching ${tf} data:`, err);
      results[tf] = [];
    }
  }

  return results;
}

export async function calculateVolatility(ohlcv: any[]): Promise<number> {
  if (ohlcv.length < 2) return 0;

  const returns = [];
  for (let i = 1; i < ohlcv.length; i++) {
    const prev = ohlcv[i - 1].close;
    const current = ohlcv[i].close;
    returns.push((current - prev) / prev);
  }

  const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance =
    returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / returns.length;

  return Math.sqrt(variance) * 100;
}

export async function researchMarkets(tradingMode: TradingMode) {
  console.log(`Research mode → ${tradingMode}`);

  try {
    const ohlcvData = await fetchMultiTimeframeData();
    const orderbook = await deltaClient.getOrderbook();

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
          buy: orderbook.buy.slice(0, 10),
          sell: orderbook.sell.slice(0, 10),
        },
        volume: 0,
        volatility,
      },
    ];

    const analysis = await analyzeMarkets(marketData, tradingMode);

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

    console.log(`Analysis Complete → ${analysis.recommendedAsset} | ${analysis.direction}`);
    return analysis;
  } catch (err) {
    console.error("Error in market research:", err);
    return null;
  }
}
