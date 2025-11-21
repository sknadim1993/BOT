import { deltaClient } from './delta-client';
import { groq, analyzeMarkets } from './groq-client';
import { storage } from './storage';
import type { TradingMode } from '@shared/schema';

interface MarketResearch {
  symbol: string;
  price: number;
  volatility: number;
  orderbook: any;
  ohlcv: any[];
}

const MAJOR_PERPETUALS = [
  'ETHUSD',
];

export async function fetchMultiTimeframeData(symbol: string): Promise<any> {
  const now = Math.floor(Date.now() / 1000);
  const timeframes = {
    '5m': { resolution: '5m', from: now - 3600, to: now }, // Last hour
    '15m': { resolution: '15m', from: now - 7200, to: now }, // Last 2 hours
    '1H': { resolution: '60', from: now - 86400, to: now }, // Last day
    '1D': { resolution: '1D', from: now - 604800, to: now }, // Last week
  };

  const results: any = {};

  for (const [timeframe, config] of Object.entries(timeframes)) {
    try {
      const data = await deltaClient.getOHLCV(symbol, config.resolution, config.from, config.to);
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
    const returnVal = (currentClose - prevClose) / prevClose;
    returns.push(returnVal);
  }

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / returns.length;
  const volatility = Math.sqrt(variance) * 100;

  return volatility;
}

export async function researchMarkets(tradingMode: TradingMode) {
  console.log(`Starting market research for ${tradingMode} mode...`);

  try {
    const marketData = [];

    for (const symbol of MAJOR_PERPETUALS) {
      try {
        // Fetch multi-timeframe OHLCV data
        const ohlcvData = await fetchMultiTimeframeData(symbol);

        // Fetch orderbook
        const orderbook = await deltaClient.getOrderbook(symbol);

        // Calculate volatility from primary timeframe
        const primaryTimeframe = tradingMode === 'scalping' ? '5m' : 
                                 tradingMode === 'intraday' ? '15m' :
                                 tradingMode === 'swing' ? '1H' : '1D';
        const volatility = await calculateVolatility(ohlcvData[primaryTimeframe] || []);

        // Calculate volume
        const recentCandles = ohlcvData[primaryTimeframe] || [];

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

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch (error) {
        console.error(`Error fetching data for ${symbol}:`, error);
      }
    }

    if (marketData.length === 0) {
      console.error('No market data collected');
      return null;
    }

    // Analyze markets using Groq
    console.log('Sending data to Groq for analysis...');
    const analysis = await analyzeMarkets(marketData, tradingMode);

    // Save analysis to database
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
      marketData: marketData,
    });

    console.log('Market analysis completed:', analysis.recommendedAsset, analysis.direction);
    return analysis;
  } catch (error) {
    console.error('Error in market research:', error);
    return null;
  }
}
