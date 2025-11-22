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

  // Calculate exact boundaries
  const maxLongEntry = (currentPrice * 1.005).toFixed(2);
  const minLongEntry = currentPrice.toFixed(2);
  const maxShortEntry = currentPrice.toFixed(2);
  const minShortEntry = (currentPrice * 0.995).toFixed(2);

  const systemPrompt = `You are a crypto trading signal generator with MANDATORY numerical constraints.

ABSOLUTE RULES (violation = system rejection):
1. REFERENCE POINT: Current price $${currentPrice} is the ONLY anchor. NEVER use historical swing highs/lows.
2. PERCENTAGE BOUNDS: Entry MUST be within 0.5% of current price.
3. CALCULATION PROCESS:
   - Current Price: $${currentPrice}
   - For LONG: Entry between $${minLongEntry} and $${maxLongEntry}
   - For SHORT: Entry between $${minShortEntry} and $${maxShortEntry}
   
EXECUTION ORDER:
Step 1: State current price explicitly: $${currentPrice}
Step 2: Calculate boundaries based on current price ONLY
Step 3: Propose entry within boundaries
Step 4: VERIFY: abs((entry - ${currentPrice}) / ${currentPrice} × 100) ≤ 0.5
Step 5: Return structured JSON

EXAMPLE (DO THIS):
Current: $${currentPrice}
Selected LONG Entry: $${(currentPrice * 1.002).toFixed(2)} ✓ (0.2% from current)

FORBIDDEN (NEVER DO THIS):
Using swing highs/previous resistance levels that are >0.5% away from current price ✗`;

  const userPrompt = `CURRENT MARKET PRICE: $${currentPrice}

MARKET DATA:
${marketSections}

TRADING MODE: ${tradingMode.toUpperCase()} (Primary Timeframe: ${primaryTimeframe})

Generate a trading signal where entry is within 0.5% of $${currentPrice}.

For LONG trades: entry between $${minLongEntry} and $${maxLongEntry}
For SHORT trades: entry between $${minShortEntry} and $${maxShortEntry}

If no valid setup exists within these bounds, return direction = "none" with confidence < 60.`;

  return { systemPrompt, userPrompt, primaryTimeframe };
}

function enforceRiskRewardAndSanitize(analysis: any, currentPrice: number, lastCandle: OHLCV | null): TradingRecommendation {
  console.log('\n=== SANITIZATION LAYER ===');
  console.log('Groq raw response:', JSON.stringify(analysis, null, 2));
  console.log('Current market price:', currentPrice);
  
  // Defensive default
  const defaultNoTrade: TradingRecommendation = {
    recommendedAsset: analysis?.recommendedAsset || 'UNKNOWN',
    direction: 'none',
    entryPrice: currentPrice,
    stopLoss: currentPrice,
    takeProfit: currentPrice,
    confidence: Math.max(1, Math.min(59, analysis?.confidence || 50)),
    strongestAssets: analysis?.strongestAssets || [],
    weakestAssets: analysis?.weakestAssets || [],
    patternExplanation: analysis?.patternExplanation || 'No trade — insufficient confluence',
    multiTimeframeReasoning: analysis?.multiTimeframeReasoning || '',
  };

  if (!analysis || !analysis.direction || analysis.direction === 'none') {
    console.log('Direction is none, returning no-trade');
    return defaultNoTrade;
  }

  const dir: Direction = analysis.direction === 'short' ? 'short' : 'long';
  console.log('Direction:', dir);

  // CRITICAL: Force entry to be very close to current price
  // Maximum 0.3% deviation allowed
  const MAX_ENTRY_DEVIATION = 0.003; // 0.3%
  
  let entry = Number(analysis.entryPrice || currentPrice);
  console.log('Groq suggested entry:', entry);
  
  // Check if Groq's entry is too far from current price
  const entryDeviation = Math.abs(entry - currentPrice) / currentPrice;
  console.log(`Entry deviation: ${(entryDeviation * 100).toFixed(3)}%`);
  
  if (entryDeviation > MAX_ENTRY_DEVIATION) {
    console.warn(`⚠️ OVERRIDE: Groq entry ${entry} is ${(entryDeviation * 100).toFixed(2)}% from current ${currentPrice}`);
    
    // FORCE override to safe entry near current price
    if (dir === 'long') {
      entry = currentPrice * 1.0015; // 0.15% above current
      console.log(`✓ Overridden to LONG entry: ${entry.toFixed(2)} (0.15% above current)`);
    } else {
      entry = currentPrice * 0.9985; // 0.15% below current
      console.log(`✓ Overridden to SHORT entry: ${entry.toFixed(2)} (0.15% below current)`);
    }
  } else {
    console.log(`✓ Entry ${entry} is within acceptable range`);
  }
  
  // Calculate stop loss based on entry (not from Groq)
  // For scalping: tight stops at 0.5% from entry
  let stop: number;
  if (dir === 'long') {
    stop = entry * 0.995; // 0.5% below entry
  } else {
    stop = entry * 1.005; // 0.5% above entry
  }
  console.log('Calculated stop loss:', stop.toFixed(2));

  // Compute TP = entry + 2*(entry - SL) for long, inverse for short
  let tp: number;
  if (dir === 'long') {
    const rr = entry - stop; // risk
    tp = entry + Math.abs(rr) * 2;
  } else {
    const rr = stop - entry; // risk for short (positive)
    tp = entry - Math.abs(rr) * 2;
  }
  console.log('Calculated take profit:', tp.toFixed(2));

  // Confidence clamp
  let confidence = Math.round(Number(analysis.confidence || 50));
  if (isNaN(confidence) || confidence < 1) confidence = 1;
  if (confidence > 95) confidence = 95;

  // If the adjusted entry/SL/TP are nonsensical (e.g., equal), return no-trade
  if (!isFinite(entry) || !isFinite(stop) || !isFinite(tp) || Math.abs(entry - stop) < 0.0001) {
    console.error('❌ Invalid price calculations, returning no-trade');
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

  console.log('Final sanitized result:', {
    direction: result.direction,
    entry: result.entryPrice,
    sl: result.stopLoss,
    tp: result.takeProfit
  });

  return result;
}

function marketReferenceAssetFromAnalysis(analysis: any): string {
  if (analysis?.recommendedAsset) return analysis.recommendedAsset;
  if (analysis?.strongestAssets && analysis.strongestAssets.length) return analysis.strongestAssets[0];
  return 'UNKNOWN';
}

export async function analyzeMarkets(marketData: MarketData[], tradingMode: string): Promise<TradingRecommendation> {
  console.log('\n=== GROQ ANALYSIS START ===');
  
  // Get current price from latest candle
  const primaryTimeframe = TIMEFRAME_MAP[tradingMode] || '15m';
  const primaryMarket = marketData.find((m) => m.timeframe === primaryTimeframe) || marketData[0];
  const lastCandle = primaryMarket ? lastCandleFor(primaryMarket) : null;
  const currentPrice = lastCandle ? lastCandle.close : 0;

  if (!currentPrice || !isFinite(currentPrice)) {
    throw new Error('Unable to determine current market price from provided market data.');
  }

  console.log('Current market price:', currentPrice);
  console.log('Max allowed entry deviation: 0.5%');
  console.log('LONG entry range:', `${currentPrice.toFixed(2)} - ${(currentPrice * 1.005).toFixed(2)}`);
  console.log('SHORT entry range:', `${(currentPrice * 0.995).toFixed(2)} - ${currentPrice.toFixed(2)}`);

  const { systemPrompt, userPrompt, primaryTimeframe: ptf } = buildPrompt(marketData, tradingMode, currentPrice);

  try {
    const client = getGroqClient();

    // Use JSON Schema mode to enforce constraints
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
      temperature: 0.1, // Very low temperature for deterministic output
      max_tokens: 1600,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'trading_signal',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              recommendedAsset: { type: 'string' },
              direction: { 
                type: 'string',
                enum: ['long', 'short', 'none']
              },
              entryPrice: { 
                type: 'number',
                description: 'Entry price must be within 0.5% of current price'
              },
              stopLoss: { type: 'number' },
              takeProfit: { type: 'number' },
              confidence: { 
                type: 'integer',
                minimum: 1,
                maximum: 100
              },
              strongestAssets: {
                type: 'array',
                items: { type: 'string' }
              },
              weakestAssets: {
                type: 'array',
                items: { type: 'string' }
              },
              patternExplanation: { type: 'string' },
              multiTimeframeReasoning: { type: 'string' }
            },
            required: [
              'recommendedAsset',
              'direction',
              'entryPrice',
              'stopLoss',
              'takeProfit',
              'confidence',
              'patternExplanation',
              'multiTimeframeReasoning'
            ],
            additionalProperties: false
          }
        }
      }
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      throw new Error('No response from Groq');
    }

    console.log('Groq raw response received');

    // Parse JSON response
    let analysis: any;
    if (typeof response === 'string') {
      try {
        analysis = JSON.parse(response);
      } catch (err) {
        throw new Error('Groq returned invalid JSON');
      }
    } else {
      analysis = response;
    }

    // CRITICAL: Apply sanitization (this returns a NEW object)
    const sanitized = enforceRiskRewardAndSanitize(analysis, currentPrice, lastCandle);

    console.log('\n=== FINAL VALIDATION ===');
    console.log('Sanitized direction:', sanitized.direction);
    console.log('Sanitized entry:', sanitized.entryPrice);
    
    // Final safety check: ensure entry is within acceptable bounds
    if (sanitized.direction !== 'none') {
      const finalDeviation = Math.abs(sanitized.entryPrice - currentPrice) / currentPrice;
      console.log(`Final entry deviation: ${(finalDeviation * 100).toFixed(3)}%`);
      
      if (finalDeviation > 0.01) {
        console.error(`❌ SAFETY BLOCK: Final entry ${sanitized.entryPrice} is ${(finalDeviation * 100).toFixed(2)}% from current ${currentPrice}`);
        
        // If still outside 1% after sanitization, return no-trade
        return {
          recommendedAsset: sanitized.recommendedAsset,
          direction: 'none',
          entryPrice: currentPrice,
          stopLoss: currentPrice,
          takeProfit: currentPrice,
          confidence: Math.max(1, Math.min(59, sanitized.confidence)),
          strongestAssets: sanitized.strongestAssets,
          weakestAssets: sanitized.weakestAssets,
          patternExplanation: 'No safe entry within acceptable deviation from market price',
          multiTimeframeReasoning: sanitized.multiTimeframeReasoning,
        };
      }
      
      console.log('✓ Final validation passed');
    }

    console.log('=== GROQ ANALYSIS COMPLETE ===\n');
    return sanitized;
    
  } catch (error: any) {
    console.error('Groq analysis error:', error?.message || error);
    
    // Return a safe no-trade recommendation rather than crash the system
    return {
      recommendedAsset: marketData[0]?.symbol || 'UNKNOWN',
      direction: 'none',
      entryPrice: currentPrice,
      stopLoss: currentPrice,
      takeProfit: currentPrice,
      confidence: 30,
      strongestAssets: [],
      weakestAssets: [],
      patternExplanation: `Groq error: ${error?.message || 'unknown error'}`,
      multiTimeframeReasoning: '',
    };
  }
}