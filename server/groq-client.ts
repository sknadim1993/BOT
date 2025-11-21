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

interface MarketData {
  symbol: string;
  timeframe: string;
  ohlcv: any[];
  orderbook: {
    buy: { price: string; size: number }[];
    sell: { price: string; size: number }[];
  };
  volume: number;
  volatility?: number;
}

interface TradingRecommendation {
  recommendedAsset: string;
  direction: 'long' | 'short';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  strongestAssets: string[];
  weakestAssets: string[];
  patternExplanation: string;
  multiTimeframeReasoning: string;
}

export async function analyzeMarkets(
  marketData: MarketData[],
  tradingMode: string
): Promise<TradingRecommendation> {
  const timeframeMap: Record<string, string> = {
    scalping: '5m',
    intraday: '15m',
    swing: '1H',
    longterm: '1D',
  };

  const primaryTimeframe = timeframeMap[tradingMode] || '15m';

  // Build comprehensive prompt
  const prompt = `You are an expert crypto trading analyst. Analyze the following multi-timeframe market data and provide ONE best trading recommendation.

TRADING MODE: ${tradingMode.toUpperCase()} (Primary Timeframe: ${primaryTimeframe})

MARKET DATA:
${marketData.map(md => `
Symbol: ${md.symbol}
Timeframe: ${md.timeframe}
Recent Candles: ${JSON.stringify(md.ohlcv.slice(-10))}
Orderbook Buy Pressure: ${md.orderbook.buy.slice(0, 5).map(b => `$${b.price} (${b.size})`).join(', ')}
Orderbook Sell Pressure: ${md.orderbook.sell.slice(0, 5).map(s => `$${s.price} (${s.size})`).join(', ')}
Volume: ${md.volume}
Volatility: ${md.volatility || 'N/A'}
`).join('\n---\n')}

ANALYSIS REQUIREMENTS FOR ${tradingMode.toUpperCase()}:
1. Trend strength across all timeframes
2. Support/resistance levels
3. Orderbook imbalances (buy walls vs sell walls)
4. Volume patterns
5. Candlestick patterns and wick behavior
6. Breakouts vs fakeouts detection
7. Momentum indicators
8. Liquidity zones

Provide your response in this EXACT JSON format:
{
  "recommendedAsset": "BTCUSDT",
  "direction": "long",
  "entryPrice": 45000.50,
  "stopLoss": 44500.00,
  "takeProfit": 46000.00,
  "confidence": 75,
  "strongestAssets": ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
  "weakestAssets": ["ADAUSDT", "DOTUSDT"],
  "patternExplanation": "Strong bullish engulfing pattern on 5m with increasing volume. Orderbook shows significant buy support at $44,800. RSI showing momentum shift.",
  "multiTimeframeReasoning": "Daily: Uptrend intact above 200 EMA. 1H: Higher highs and higher lows forming. 15m: Breakout above key resistance. 5m: Entry signal confirmed with volume spike."
}

IMPORTANT: 
- Use 1:2 risk-reward ratio (TP should be 2x the distance of SL from entry)
- Confidence score 1-100 based on signal strength
- Only recommend trades with confluence across multiple timeframes
- For ${tradingMode}, focus heavily on ${primaryTimeframe} patterns`;

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
      temperature: 0.3,
      max_tokens: 2048,
      response_format: { type: 'json_object' },
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      throw new Error('No response from Groq');
    }

    const analysis = JSON.parse(response);
    return analysis;
  } catch (error: any) {
    console.error('Groq analysis error:', error.message);
    throw error;
  }
}
