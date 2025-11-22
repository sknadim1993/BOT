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

  const prompt = `You are an expert crypto trading analyst. Analyze the following multi-timeframe market data and provide ONE best trading recommendation.\n\nTRADING MODE: ${tradingMode.toUpperCase()} (Primary Timeframe: ${primaryTimeframe})\n\nMARKET DATA:\n${marketSections}\n\nANALYSIS REQUIREMENTS FOR ${tradingMode.toUpperCase()}:\n1. Trend strength across all timeframes\n2. Support/resistance levels\n3. Orderbook imbalances (buy walls vs sell walls)\n4. Volume patterns\n5. Candlestick patterns and wick behavior\n6. Breakouts vs fakeouts detection\n7. Momentum indicators\n8. Liquidity zones\n\nIMPORTANT RULES TO FOLLOW (MUST OBEY):\n- READ prices ONLY from the provided OHLC candles. Do NOT invent or hallucinate price levels from outside this data.\n- Entry price MUST be based on real price levels from the latest candles (primary timeframe).\n  • LONG trade → entry slightly ABOVE pattern high / breakout level (use last candle high if needed).\n  • SHORT trade → entry slightly BELOW pattern low / breakdown level (use last candle low if needed).\n- Stop-loss MUST be based on recent swing low/high or wick extremes:\n  • LONG → stop-loss BELOW recent swing low / wick low.\n  • SHORT → stop-loss ABOVE recent swing high / wick high.\n- Take-profit MUST be computed precisely using 1:2 risk-reward ratio (TP is 2× distance from entry to SL).\n- NEVER recommend an entry that is further than 1% away from the most recent closing price on the primary timeframe. If no safe entry is available within that range, return a "no-trade" recommendation (direction = "none") with confidence < 60.\n- For scalping, use tight stops; for intraday/swing/longterm use progressively wider stops.\n- Only recommend trades with confluence across multiple timeframes.\n- Output EXACTLY one JSON object (no extra commentary) using the schema shown below.\n\nRESPONSE JSON FORMAT EXAMPLE (MUST MATCH TYPES):\n{\n  "recommendedAsset": "BTCUSDT",\n  "direction": "long",\n  "entryPrice": 45000.50,\n  "stopLoss": 44500.00,\n  "takeProfit": 46000.00,\n  "confidence": 75,\n  "strongestAssets": ["BTCUSDT", "ETHUSDT", "SOLUSDT"],\n  "weakestAssets": ["ADAUSDT", "DOTUSDT"],\n  "patternExplanation": "Strong bullish engulfing pattern on 5m with increasing volume. Orderbook shows significant buy support at $44,800. RSI showing momentum shift.",\n  "multiTimeframeReasoning": "Daily: Uptrend intact above 200 EMA. 1H: Higher highs and higher lows forming. 15m: Breakout above key resistance. 5m: Entry signal confirmed with volume spike."\n}\n\nIMPORTANT: Use the primary timeframe candle structure as the main basis for entry/SL/TP derivation.\n\nEND OF PROMPT.`;

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

  // Start with the Groq suggested numbers but sanitize
  let entry = Number(analysis.entryPrice || lastPrice + (dir === 'long' ? buffer : -buffer));
  let stop = Number(analysis.stopLoss || (dir === 'long' ? (lastCandle ? lastCandle.low - buffer : lastPrice - buffer * 2) : (lastCandle ? lastCandle.high + buffer : lastPrice + buffer * 2)));

  // Ensure entry is not unrealistically far from market
  const deviation = Math.abs(entry - lastPrice) / lastPrice;
  if (deviation > 0.01) {
    // If Groq gave an entry >1% away, override to safe entry near market
    entry = lastPrice + (dir === 'long' ? buffer : -buffer);
  }

  // Ensure SL is on the correct side of entry
  if (dir === 'long' && stop >= entry) {
    // place SL below entry
    stop = Math.min(entry - Math.max(buffer, Math.abs(entry) * 0.0005), entry - 0.5);
  }
  if (dir === 'short' && stop <= entry) {
    stop = Math.max(entry + Math.max(buffer, Math.abs(entry) * 0.0005), entry + 0.5);
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
