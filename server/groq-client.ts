import Groq from 'groq-sdk';

let groq: Groq | null = null;

function getGroqClient(): Groq {
  if (!groq) {
    if (!process.env.GROQ_API_KEY) {
      throw new Error('Missing GROQ_API_KEY environment variable. Please configure your Groq API key.');
    }
    groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });
  }
  return groq;
}

interface OHLCV {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface OrderbookSideItem {
  price: string;
  size: number;
}

interface MarketData {
  symbol: string;
  timeframe: string;
  ohlcv: OHLCV[];
  orderbook: {
    buy: OrderbookSideItem[];
    sell: OrderbookSideItem[];
  };
  volume: number;
  volatility?: number;
}

export type Direction = 'long' | 'short' | 'none';

export interface TradingRecommendation {
  recommendedAsset: string;
  direction: Direction;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number; // 1-100
  strongestAssets: string[];
  weakestAssets: string[];
  patternExplanation: string;
  multiTimeframeReasoning: string;
}

const TIMEFRAME_MAP: Record<string, string> = {
  scalping: '5m',
  intraday: '15m',
  swing: '1H',
  longterm: '1D',
};

function lastCandleFor(md: MarketData) {
  return md.ohlcv && md.ohlcv.length ? md.ohlcv[md.ohlcv.length - 1] : null;
}

function buildPrompt(marketData: MarketData[], tradingMode: string) {
  const primaryTimeframe = TIMEFRAME_MAP[tradingMode] || '15m';

  const marketSections = marketData
    .map((md) => {
      const last10 = JSON.stringify(md.ohlcv.slice(-10));
      const buyPressure = (md.orderbook?.buy || []).slice(0, 5).map((b) => `$${b.price} (${b.size})`).join(', ');
      const sellPressure = (md.orderbook?.sell || []).slice(0, 5).map((s) => `$${s.price} (${s.size})`).join(', ');
      return `Symbol: ${md.symbol}\nTimeframe: ${md.timeframe}\nRecent Candles: ${last10}\nOrderbook Buy Pressure: ${buyPressure}\nOrderbook Sell Pressure: ${sellPressure}\nVolume: ${md.volume}\nVolatility: ${md.volatility || 'N/A'}`;
    })
    .join('\n---\n');

  // Get the latest close price from the most recent candle
  const latestCandle = marketData.find(m => m.timeframe === primaryTimeframe)?.ohlcv?.slice(-1)[0];
  const currentPrice = latestCandle ? latestCandle.close : 0;

  const prompt = `You are an expert crypto trading analyst. Analyze the following multi-timeframe market data and provide ONE best trading recommendation.\n\nTRADING MODE: ${tradingMode.toUpperCase()} (Primary Timeframe: ${primaryTimeframe})\n\nCURRENT MARKET PRICE (LATEST CLOSE): $${currentPrice}\n\nMARKET DATA:\n${marketSections}\n\nANALYSIS REQUIREMENTS FOR ${tradingMode.toUpperCase()}:\n1. Trend strength across all timeframes\n2. Support/resistance levels\n3. Orderbook imbalances (buy walls vs sell walls)\n4. Volume patterns\n5. Candlestick patterns and wick behavior\n6. Breakouts vs fakeouts detection\n7. Momentum indicators\n8. Liquidity zones\n\nCRITICAL RULES FOR ENTRY PRICE (MUST OBEY):\n- The CURRENT MARKET PRICE is $${currentPrice} (from the most recent candle close)\n- Entry price MUST be within 0.5% of the current price $${currentPrice}\n- For LONG trades: Entry should be between $${(currentPrice * 1.000).toFixed(2)} and $${(currentPrice * 1.005).toFixed(2)}\n- For SHORT trades: Entry should be between $${(currentPrice * 0.995).toFixed(2)} and $${(currentPrice * 1.000).toFixed(2)}\n- If no valid setup exists within this range, return direction = "none" with confidence < 60\n\nOTHER RULES:\n- Stop-loss MUST be based on recent swing low/high:\n  • LONG → stop-loss BELOW recent swing low (but not more than 1% from entry)\n  • SHORT → stop-loss ABOVE recent swing high (but not more than 1% from entry)\n- Take-profit MUST use 1:2 risk-reward ratio (TP is 2× distance from entry to SL)\n- For scalping, use tight stops (0.3-0.5% from entry)\n- Only recommend trades with confluence across multiple timeframes\n- Output EXACTLY one JSON object (no extra commentary)\n\nRESPONSE JSON FORMAT EXAMPLE (MUST MATCH TYPES):\n{\n  "recommendedAsset": "ETHUSD",\n  "direction": "long",\n  "entryPrice": ${currentPrice > 0 ? (currentPrice * 1.002).toFixed(2) : '2740.00'},\n  "stopLoss": ${currentPrice > 0 ? (currentPrice * 0.995).toFixed(2) : '2720.00'},\n  "takeProfit": ${currentPrice > 0 ? (currentPrice * 1.016).toFixed(2) : '2780.00'},\n  "confidence": 75,\n  "strongestAssets": ["ETHUSD"],\n  "weakestAssets": [],\n  "patternExplanation": "Bullish pattern on 5m with volume confirmation near current price $${currentPrice}",\n  "multiTimeframeReasoning": "5m: Entry near current market price with tight risk management"\n}\n\nEND OF PROMPT.`;

  return { prompt, primaryTimeframe };
}

function enforceRiskRewardAndSanitize(analysis: any, lastPrice: number, lastCandle: OHLCV | null): TradingRecommendation {
  // Defensive default
  const defaultNoTrade: TradingRecommendation = {
    recommendedAsset: analysis?.recommendedAsset || 'UNKNOWN',
    direction: 'none',
    entryPrice: lastPrice,
    stopLoss: lastPrice,
    takeProfit: lastPrice,
    confidence: Math.max(1, Math.min(59, analysis?.confidence || 50)),
    strongestAssets: analysis?.strongestAssets || [],
    weakestAssets: analysis?.weakestAssets || [],
    patternExplanation: analysis?.patternExplanation || 'No trade — insufficient confluence',
    multiTimeframeReasoning: analysis?.multiTimeframeReasoning || '',
  };

  if (!analysis || !analysis.direction || analysis.direction === 'none') return defaultNoTrade;

  const dir: Direction = analysis.direction === 'short' ? 'short' : 'long';

  // Use lastPrice as market reference and a small buffer = 0.05% by default
  const bufferPct = dir === 'long' ? 0.0005 : 0.0005; // 0.05%
  const buffer = lastPrice * bufferPct;

  // CRITICAL: Force entry to be very close to current price
  // Groq often uses old candle data, so we must override aggressively
  const maxEntryDeviation = 0.003; // 0.3% maximum deviation from current price
  
  let entry = Number(analysis.entryPrice || lastPrice);
  
  // Check if Groq's entry is too far from current price
  const entryDeviation = Math.abs(entry - lastPrice) / lastPrice;
  
  if (entryDeviation > maxEntryDeviation) {
    console.warn(`⚠️ Groq entry ${entry} is ${(entryDeviation * 100).toFixed(2)}% from current ${lastPrice}. Overriding to current price.`);
    // Force entry to be very close to current price
    if (dir === 'long') {
      entry = lastPrice * 1.0015; // 0.15% above current (wait for slight uptick)
    } else {
      entry = lastPrice * 0.9985; // 0.15% below current (wait for slight downtick)
    }
  }
  
  // Now calculate stop loss based on entry (not from Groq)
  // For scalping: tight stops at 0.5% from entry
  let stop: number;
  if (dir === 'long') {
    stop = entry * 0.995; // 0.5% below entry
  } else {
    stop = entry * 1.005; // 0.5% above entry
  }

  // Compute TP = entry + 2*(entry - SL) for long, inverse for short
  let tp: number;
  if (dir === 'long') {
    const rr = entry - stop; // risk
    tp = entry + Math.abs(rr) * 2;
  } else {
    const rr = stop - entry; // risk for short (positive)
    tp = entry - Math.abs(rr) * 2;
  }

  // Confidence clamp
  let confidence = Math.round(Number(analysis.confidence || 50));
  if (isNaN(confidence) || confidence < 1) confidence = 1;
  if (confidence > 95) confidence = 95;

  // If the adjusted entry/SL/TP are nonsensical (e.g., equal), return no-trade
  if (!isFinite(entry) || !isFinite(stop) || !isFinite(tp) || Math.abs(entry - stop) < 0.0001) {
    return defaultNoTrade;
  }

  const result: TradingRecommendation = {
    recommendedAsset: analysis.recommendedAsset || marketReferenceAssetFromAnalysis(analysis),
    direction: dir,
    entryPrice: Number(Number(entry).toFixed(2)),
    stopLoss: Number(Number(stop).toFixed(2)),
    takeProfit: Number(Number(tp).toFixed(2)),
    confidence,
    strongestAssets: analysis.strongestAssets || [],
    weakestAssets: analysis.weakestAssets || [],
    patternExplanation: analysis.patternExplanation || '',
    multiTimeframeReasoning: analysis.multiTimeframeReasoning || '',
  };

  return result;
}

function marketReferenceAssetFromAnalysis(analysis: any): string {
  if (analysis?.recommendedAsset) return analysis.recommendedAsset;
  if (analysis?.strongestAssets && analysis.strongestAssets.length) return analysis.strongestAssets[0];
  return 'UNKNOWN';
}

export async function analyzeMarkets(marketData: MarketData[], tradingMode: string): Promise<TradingRecommendation> {
  const { prompt, primaryTimeframe } = buildPrompt(marketData, tradingMode);

  try {
    const client = getGroqClient();

    const completion = await client.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: 'You are a professional crypto trading analyst specializing in multi-timeframe technical analysis. Always respond with valid JSON only, no additional text.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.15,
      max_tokens: 1600,
      // Use Groq's structured response format if available
      response_format: { type: 'json_object' },
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      throw new Error('No response from Groq');
    }

    // If the SDK already returns a parsed object, use it. Otherwise try JSON.parse
    let analysis: any = response;
    if (typeof response === 'string') {
      try {
        analysis = JSON.parse(response);
      } catch (err) {
        // if parsing fails, throw
        throw new Error('Groq returned invalid JSON');
      }
    }

    // Determine the most relevant market reference (primary timeframe & matching asset)
    const recommendedAsset = analysis.recommendedAsset || marketData[0]?.symbol;
    const primaryMarket = marketData.find((m) => m.symbol === recommendedAsset && m.timeframe === primaryTimeframe) || marketData.find((m) => m.timeframe === primaryTimeframe) || marketData[0];
    const lastCandle = primaryMarket ? lastCandleFor(primaryMarket) : null;
    const lastPrice = lastCandle ? lastCandle.close : primaryMarket && lastCandleFor(primaryMarket) ? lastCandleFor(primaryMarket)!.close : marketData[0] && lastCandleFor(marketData[0]) ? lastCandleFor(marketData[0])!.close : NaN;

    if (!isFinite(lastPrice)) {
      throw new Error('Unable to determine last market price from provided market data.');
    }

    const sanitized = enforceRiskRewardAndSanitize(analysis, lastPrice, lastCandle);

    // Final sanity check: ensure entry is within 1% of lastPrice (as required)
    if (sanitized.direction !== 'none') {
      const deviation = Math.abs(sanitized.entryPrice - lastPrice) / lastPrice;
      if (deviation > 0.01) {
        // If still outside 1% after adjustments, downgrade to no-trade
        return {
          recommendedAsset: sanitized.recommendedAsset,
          direction: 'none',
          entryPrice: lastPrice,
          stopLoss: lastPrice,
          takeProfit: lastPrice,
          confidence: Math.max(1, Math.min(59, sanitized.confidence)),
          strongestAssets: sanitized.strongestAssets,
          weakestAssets: sanitized.weakestAssets,
          patternExplanation: 'No safe entry within 1% of market price after sanitization',
          multiTimeframeReasoning: sanitized.multiTimeframeReasoning,
        };
      }
    }

    return sanitized;
  } catch (error: any) {
    console.error('Groq analysis error:', error?.message || error);
    // Return a safe no-trade recommendation rather than crash the system
    return {
      recommendedAsset: marketData[0]?.symbol || 'UNKNOWN',
      direction: 'none',
      entryPrice: marketData[0] && lastCandleFor(marketData[0]) ? lastCandleFor(marketData[0])!.close : 0,
      stopLoss: marketData[0] && lastCandleFor(marketData[0]) ? lastCandleFor(marketData[0])!.close : 0,
      takeProfit: marketData[0] && lastCandleFor(marketData[0]) ? lastCandleFor(marketData[0])!.close : 0,
      confidence: 30,
      strongestAssets: [],
      weakestAssets: [],
      patternExplanation: `Groq error: ${error?.message || 'unknown error'}`,
      multiTimeframeReasoning: '',
    };
  }
}