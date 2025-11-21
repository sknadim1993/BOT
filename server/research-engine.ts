import { deltaClient } from './delta-client';
import { groq, analyzeMarkets } from './groq-client';
import { storage } from './storage';
import type { TradingMode } from '@shared/schema';

interface MarketResearch {
  symbol: string;
  price: number;
  volume: number;
  volatility: number;
  orderbook: any;
  ohlcv: any[];
}

const MAJOR_PERPETUALS = ['ETHUSD'];

function getTimestampRange(resolution: string, candles = 150) {
  const now = Math.floor(Date.now() / 1000);
  const seconds =
    resolution === '5m' ? 5 * 60 :
    resolution === '15m' ? 15 * 60 :
    resolution === '1h' ? 60 * 60 :
    resolution === '1d' ? 24 * 60 * 60 :
    5 * 60;

  return {
    from: now - candles * seconds,
    to: now
  };
}

export async function fetchMultiTimeframeData(symbol: string): Promise<any> {
  const timeframes = {
    '5m': { resolution: '5m', ...getTimestampRange('5m') },
    '15m': { resolution: '15m', ...getTimestampRange('15m') },
    '1H': { resolution: '1h', ...getTimestampRange('1h') },
    '1D': { resolution: '1d', ...getTimestampRange('1d') },
  };

  const results: any = {};

  for (const [timeframe, config] of Object.entries(timeframes)) {
    try {
      const data = await deltaClient.getOHLCV(
        symbol,
        config.resolution,
        config.from,
        config.to
      );
      results[timeframe] = data.data;
    } catch (error) {
      console.error(`Error fetching ${timeframe} data for ${symbol}:`, error);
      results[timeframe] = [];
    }
  }

  return results;
}

export async function calculateVolatility(ohlcvData: any[]): Promise<number> {
  if (ohlcvData.length < 2) return 0;

  const returns = [];
  for (let i = 1; i < ohlcvData.length; i++) {
    const prevClose = ohlcvData[i - 1].close;
    const currentClose = ohlcvData[i].close;
    returns.push((currentClose - prevClose) / prevClose);
  }

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / returns.length;
  return Math.sqrt(variance) * 100;
}

export async function researchMarkets(tradingMode: TradingMode) {
  console.log(`Starting market research for ${tradingMode} mode...`);
  try {
    const marketData = [];

    for (const symbol of MAJOR_PERPETUALS) {
      try {
        const ohlcvData = await fetchMultiTimeframeData(symbol);
        const orderbook = await deltaClient.getOrderbook();

        const primaryTimeframe = tradingMode === 'scalping' ? '5m' :
                                 tradingMode === 'intraday' ? '15m' :
                                 tradingMode === 'swing' ? '1H' : '1D';

        const volatility = await calculateVolatility(ohlcvData[primaryTimeframe] || []);
        const volume = 0;

        marketData.push({
          symbol,
          timeframe: primaryTimeframe,
          ohlcv: ohlcvData[primaryTimeframe] || [],
          orderbook: {
            buy: orderbook.buy.slice(0, 10),
            sell: orderbook.sell.slice(0, 10),
          },
          volume,
          volatility,
        });

        await new Promise(resolve => setTimeout(resolve, 50));
      } catch (error) {
        console.error(`Error fetching data for ${symbol}:`, error);
      }
    }

    if (marketData.length === 0) return null;

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

    console.log('Market analysis completed:', analysis.recommendedAsset, analysis.direction);
    return analysis;
  } catch (error) {
    console.error('Error in market research:', error);
    return null;
  }
}
