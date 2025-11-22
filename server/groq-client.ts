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
export type ExecutionStrategy = 'market' | 'limit';

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
  executionStrategy: ExecutionStrategy;
  reasonForStrategy: string;
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

function buildPrompt(marketData: MarketData[], tradingMode: string, currentPrice: number) {
  const primaryTimeframe = TIMEFRAME_MAP[tradingMode] || '15m';

  const marketSections = marketData
    .map((md) => {
      const last10 = JSON.stringify(md.ohlcv.slice(-10));
      const buyPressure = (md.orderbook?.buy || []).slice(0, 5).map((b) => `$${b.price} (${b.size})`).join(', ');
      const sellPressure = (md.orderbook?.sell || []).slice(0, 5).map((s) => `$${s.price} (${s.size})`).join(', ');
      return `Symbol: ${md.symbol}\nTimeframe: ${md.timeframe}\nRecent Candles: ${last10}\nOrderbook Buy Pressure: ${buyPressure}\nOrderbook Sell Pressure: ${sellPressure}\nVolume: ${md.volume}\nVolatility: ${md.volatility || 'N/A'}`;
    })
    .join('\n---\n');

  const systemPrompt = `You are an expert cryptocurrency trading AI with FULL autonomous decision-making authority.

COMPREHENSIVE RESPONSIBILITIES:
1. Analyze market data (price action, orderbook pressure, volume, volatility, patterns)
2. Decide trade direction: long, short, or none
3. Determine optimal entry price based on technical analysis
4. Set appropriate stop loss and take profit levels
5. Choose execution strategy: market or limit

EXECUTION STRATEGY SELECTION:
- **MARKET ORDER** (execute immediately at current price):
  * Use when: Strong momentum breakout/breakdown is happening NOW
  * Use when: Time-sensitive signal that requires immediate action
  * Use when: Price is already at optimal entry level
  * Entry price: Will be current market price ($${currentPrice})
  
- **LIMIT ORDER** (wait for better entry price):
  * Use when: Current price needs minor pullback/retracement (0.3% - 2%)
  * Use when: Better risk/reward available by waiting
  * Use when: Support/resistance level nearby offers better entry
  * Entry price: Can be 0.3% - 2% away from current price
  * Limit orders will wait up to 15 minutes for price to reach target

RISK MANAGEMENT RULES:
- Minimum 1:2 risk/reward ratio (preferably 1:3 for scalping)
- Stop loss: 0.5% - 1% from entry (tight stops for scalping)
- Only suggest trades with confidence ≥ 70
- For limit orders: ensure entry makes logical sense (LONG entry < current, SHORT entry > current)

IMPORTANT CONSTRAINTS:
- For MARKET orders: Entry will be exactly current price ($${currentPrice})
- For LIMIT orders: Entry must be within 0.3% - 2% of current price
- LONG limit orders: Entry MUST BE BELOW current price (buy the dip)
- SHORT limit orders: Entry MUST BE ABOVE current price (sell the rally)

Return ONLY valid JSON with this EXACT structure:
{
  "recommendedAsset": "ETHUSD",
  "direction": "long|short|none",
  "entryPrice": number,
  "stopLoss": number,
  "takeProfit": number,
  "confidence": number (70-95 for trades, <70 for none),
  "executionStrategy": "market|limit",
  "reasonForStrategy": "Detailed explanation of why this execution method",
  "strongestAssets": ["array of strings"],
  "weakestAssets": ["array of strings"],
  "patternExplanation": "Technical analysis explanation",
  "multiTimeframeReasoning": "Multi-timeframe confluence analysis"
}

CRITICAL: Do NOT suggest trades with confidence < 70. When uncertain, return direction = "none".`;

  const userPrompt = `CURRENT MARKET PRICE: $${currentPrice}

MARKET DATA:
${marketSections}

TRADING MODE: ${tradingMode.toUpperCase()} (Primary Timeframe: ${primaryTimeframe})

ANALYSIS REQUIREMENTS:
1. Assess trend direction and momentum strength
2. Evaluate orderbook imbalance (bid vs ask pressure)
3. Identify key support/resistance levels
4. Analyze volume profile and volatility
5. Determine if immediate execution is required or if waiting for better entry is optimal

Make your COMPLETE autonomous trading decision including:
- Should we trade? (only if confidence ≥ 70)
- Which direction provides best probability?
- What's the ideal entry price?
- Should we execute NOW (market) or WAIT (limit)?
- Where should protective stop loss be placed?
- What's the realistic take profit target (minimum 1:2 R/R)?

DECISION FRAMEWORK:
- If strong breakout/breakdown happening NOW → market order at $${currentPrice}
- If price needs 0.3%-2% pullback for better R/R → limit order
- Current price: $${currentPrice}

Respond with your complete trading decision in JSON format.`;

  return { systemPrompt, userPrompt, primaryTimeframe };
}

function enforceRiskRewardAndSanitize(
  analysis: any,
  currentPrice: number,
  lastCandle: OHLCV | null
): TradingRecommendation {
  console.log('\n=== SANITIZATION LAYER ===');
  console.log('AI raw response:', JSON.stringify(analysis, null, 2));
  console.log('Current market price:', currentPrice);

  // Defensive default
  const defaultNoTrade: TradingRecommendation = {
    recommendedAsset: analysis?.recommendedAsset || 'ETHUSD',
    direction: 'none',
    entryPrice: currentPrice,
    stopLoss: currentPrice,
    takeProfit: currentPrice,
    confidence: Math.max(1, Math.min(69, analysis?.confidence || 50)),
    strongestAssets: analysis?.strongestAssets || [],
    weakestAssets: analysis?.weakestAssets || [],
    patternExplanation: analysis?.patternExplanation || 'No trade — insufficient confluence',
    multiTimeframeReasoning: analysis?.multiTimeframeReasoning || '',
    executionStrategy: 'market',
    reasonForStrategy: 'No trade signal',
  };

  if (!analysis || !analysis.direction || analysis.direction === 'none') {
    console.log('✋ Direction is none, returning no-trade');
    return defaultNoTrade;
  }

  // Validate confidence threshold
  const confidence = Math.round(Number(analysis.confidence || 50));
  if (confidence < 70) {
    console.log(`✋ Confidence too low (${confidence} < 70), rejecting trade`);
    return defaultNoTrade;
  }

  const dir: Direction = analysis.direction === 'short' ? 'short' : 'long';
  const strategy: ExecutionStrategy = analysis.executionStrategy === 'limit' ? 'limit' : 'market';
  
  console.log(`\n🤖 AI Decision:`);
  console.log(`   Direction: ${dir.toUpperCase()}`);
  console.log(`   Strategy: ${strategy.toUpperCase()}`);
  console.log(`   Confidence: ${confidence}%`);

  let entry: number;
  let stop: number;
  let tp: number;

  // ===== MARKET ORDER STRATEGY =====
  if (strategy === 'market') {
    console.log('\n💨 MARKET ORDER - Execute immediately');
    
    entry = currentPrice;
    console.log(`✓ Entry = Current Price: $${entry.toFixed(2)}`);

    // Tight stops for scalping
    if (dir === 'long') {
      stop = entry * 0.995; // 0.5% below entry
      tp = entry + ((entry - stop) * 2); // 1:2 R/R
    } else {
      stop = entry * 1.005; // 0.5% above entry
      tp = entry - ((stop - entry) * 2); // 1:2 R/R
    }

    console.log(`   Stop Loss: $${stop.toFixed(2)}`);
    console.log(`   Take Profit: $${tp.toFixed(2)}`);
    console.log(`   Risk/Reward: 1:2.0`);
  }
  // ===== LIMIT ORDER STRATEGY =====
  else {
    console.log('\n⏳ LIMIT ORDER - Wait for better entry');
    
    const aiSuggestedEntry = Number(analysis.entryPrice || currentPrice);
    console.log(`   AI suggested entry: $${aiSuggestedEntry.toFixed(2)}`);
    
    // Validate AI's entry makes sense
    const entryDeviation = Math.abs(aiSuggestedEntry - currentPrice) / currentPrice;
    const MIN_DEVIATION = 0.003; // 0.3% minimum
    const MAX_DEVIATION = 0.02;  // 2% maximum
    
    console.log(`   Deviation from current: ${(entryDeviation * 100).toFixed(2)}%`);

    // Check if deviation is acceptable
    if (entryDeviation < MIN_DEVIATION) {
      console.log(`⚠️ Entry too close to current (${(entryDeviation * 100).toFixed(2)}% < 0.3%), using MARKET order instead`);
      entry = currentPrice;
    } else if (entryDeviation > MAX_DEVIATION) {
      console.log(`⚠️ Entry too far from current (${(entryDeviation * 100).toFixed(2)}% > 2%), capping at 1.5%`);
      if (dir === 'long') {
        entry = currentPrice * 0.985; // 1.5% below current
      } else {
        entry = currentPrice * 1.015; // 1.5% above current
      }
    } else {
      // Validate direction logic
      if (dir === 'long' && aiSuggestedEntry >= currentPrice) {
        console.log(`⚠️ LONG limit must be BELOW current, adjusting: ${aiSuggestedEntry} -> ${(currentPrice * 0.995).toFixed(2)}`);
        entry = currentPrice * 0.995; // 0.5% below
      } else if (dir === 'short' && aiSuggestedEntry <= currentPrice) {
        console.log(`⚠️ SHORT limit must be ABOVE current, adjusting: ${aiSuggestedEntry} -> ${(currentPrice * 1.005).toFixed(2)}`);
        entry = currentPrice * 1.005; // 0.5% above
      } else {
        entry = aiSuggestedEntry;
        console.log(`✓ Using AI entry: $${entry.toFixed(2)}`);
      }
    }

    // Calculate SL/TP based on entry
    if (dir === 'long') {
      stop = entry * 0.995; // 0.5% below entry
      tp = entry + ((entry - stop) * 2.5); // 1:2.5 R/R (better for limit orders)
    } else {
      stop = entry * 1.005; // 0.5% above entry
      tp = entry - ((stop - entry) * 2.5); // 1:2.5 R/R
    }

    const riskReward = Math.abs(tp - entry) / Math.abs(entry - stop);
    console.log(`   Final Entry: $${entry.toFixed(2)}`);
    console.log(`   Stop Loss: $${stop.toFixed(2)}`);
    console.log(`   Take Profit: $${tp.toFixed(2)}`);
    console.log(`   Risk/Reward: 1:${riskReward.toFixed(2)}`);
  }

  // Validate risk/reward ratio
  const risk = Math.abs(entry - stop);
  const reward = Math.abs(tp - entry);
  const riskRewardRatio = reward / risk;

  if (riskRewardRatio < 1.5) {
    console.log(`❌ Risk/Reward too low (${riskRewardRatio.toFixed(2)} < 1.5), rejecting trade`);
    return defaultNoTrade;
  }

  // Final validation
  if (!isFinite(entry) || !isFinite(stop) || !isFinite(tp)) {
    console.error('❌ Invalid price calculations, returning no-trade');
    return defaultNoTrade;
  }

  const result: TradingRecommendation = {
    recommendedAsset: analysis.recommendedAsset || 'ETHUSD',
    direction: dir,
    entryPrice: Number(entry.toFixed(2)),
    stopLoss: Number(stop.toFixed(2)),
    takeProfit: Number(tp.toFixed(2)),
    confidence,
    strongestAssets: analysis.strongestAssets || [],
    weakestAssets: analysis.weakestAssets || [],
    patternExplanation: analysis.patternExplanation || '',
    multiTimeframeReasoning: analysis.multiTimeframeReasoning || '',
    executionStrategy: strategy,
    reasonForStrategy: analysis.reasonForStrategy || `${strategy === 'market' ? 'Immediate execution' : 'Wait for better entry'}`,
  };

  console.log('\n✅ FINAL TRADE SIGNAL:', {
    direction: result.direction.toUpperCase(),
    strategy: result.executionStrategy.toUpperCase(),
    entry: result.entryPrice,
    sl: result.stopLoss,
    tp: result.takeProfit,
    confidence: result.confidence,
    riskReward: `1:${riskRewardRatio.toFixed(2)}`,
  });

  return result;
}

export async function analyzeMarkets(
  marketData: MarketData[],
  tradingMode: string
): Promise<TradingRecommendation> {
  console.log('\n🔬 ===== GROQ AI ANALYSIS START =====');

  // Get current price from latest candle
  const primaryTimeframe = TIMEFRAME_MAP[tradingMode] || '15m';
  const primaryMarket = marketData.find((m) => m.timeframe === primaryTimeframe) || marketData[0];
  const lastCandle = primaryMarket ? lastCandleFor(primaryMarket) : null;
  const currentPrice = lastCandle ? lastCandle.close : 0;

  if (!currentPrice || !isFinite(currentPrice)) {
    throw new Error('Unable to determine current market price from provided market data.');
  }

  console.log(`📊 Current market price: $${currentPrice.toFixed(2)}`);
  console.log(`⚙️ Trading mode: ${tradingMode}`);

  const { systemPrompt, userPrompt } = buildPrompt(marketData, tradingMode, currentPrice);

  try {
    const client = getGroqClient();

    const completion = await client.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: userPrompt,
        },
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.2,
      max_tokens: 2000,
      response_format: { type: 'json_object' },
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      throw new Error('No response from Groq AI');
    }

    console.log('✓ AI response received');

    // Parse JSON response
    let analysis: any;
    try {
      analysis = JSON.parse(response);
    } catch (err) {
      console.error('❌ Failed to parse AI response as JSON');
      throw new Error('AI returned invalid JSON');
    }

    // Apply sanitization and validation
    const sanitized = enforceRiskRewardAndSanitize(analysis, currentPrice, lastCandle);

    console.log('🔬 ===== GROQ AI ANALYSIS COMPLETE =====\n');
    return sanitized;
  } catch (error: any) {
    console.error('❌ AI analysis error:', error?.message || error);

    // Return safe no-trade recommendation
    return {
      recommendedAsset: marketData[0]?.symbol || 'ETHUSD',
      direction: 'none',
      entryPrice: currentPrice,
      stopLoss: currentPrice,
      takeProfit: currentPrice,
      confidence: 30,
      strongestAssets: [],
      weakestAssets: [],
      patternExplanation: `AI error: ${error?.message || 'unknown error'}`,
      multiTimeframeReasoning: '',
      executionStrategy: 'market',
      reasonForStrategy: 'Error occurred',
    };
  }
}