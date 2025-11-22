import Groq from "groq-sdk";
import pkg from "delta-rest-client";
const { DeltaRestClient } = pkg;
import { z } from "zod";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const delta = new DeltaRestClient({
  base_url: "https://api.india.delta.exchange",
  api_key: process.env.DELTA_API_KEY,
  api_secret: process.env.DELTA_API_SECRET
});

// Strict schema
const SignalSchema = z.object({
  action: z.enum(["BUY", "SELL", "HOLD"]),
  current_price: z.number(),
  entry_price: z.number(),
  stop_loss: z.number(),
  take_profit: z.number(),
  confidence: z.number().min(0).max(1)
});

type TradingSignal = z.infer<typeof SignalSchema>;

// Configuration
const CONFIG = {
  MAX_ENTRY_DEVIATION: 0.003, // 0.3%
  MAX_SAFETY_DEVIATION: 0.005, // 0.5% absolute max
  GROQ_TEMPERATURE: 0.1,
  PRODUCT_SYMBOL: "ETHUSD",
  PRODUCT_ID: 3136
};

async function getAISignal(currentPrice: number): Promise<TradingSignal> {
  const systemPrompt = `You are a trading signal generator. CRITICAL RULE: Entry MUST be within 0.5% of current price $${currentPrice}.
  
  CALCULATION FORMULA:
  - Max Entry = ${currentPrice} × 1.005 = ${(currentPrice * 1.005).toFixed(2)}
  - Min Entry = ${currentPrice} × 0.995 = ${(currentPrice * 0.995).toFixed(2)}
  
  Your entry MUST fall between these bounds. Using historical swing prices violates this rule.`;

  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Current price: $${currentPrice}. Generate signal.` }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "signal",
        schema: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["BUY", "SELL", "HOLD"] },
            current_price: { type: "number" },
            entry_price: { 
              type: "number",
              minimum: currentPrice * 0.995,
              maximum: currentPrice * 1.005
            },
            stop_loss: { type: "number" },
            take_profit: { type: "number" },
            confidence: { type: "number", minimum: 0, maximum: 1 }
          },
          required: ["action", "current_price", "entry_price", "stop_loss", "take_profit"],
          additionalProperties: false
        },
        strict: true
      }
    },
    temperature: CONFIG.GROQ_TEMPERATURE
  });

  const content = response.choices[0].message.content;
  if (!content) throw new Error("Empty Groq response");
  
  return JSON.parse(content);
}

function sanitizePrice(signal: TradingSignal, currentPrice: number): TradingSignal {
  const deviation = Math.abs(signal.entry_price - currentPrice) / currentPrice;
  
  if (deviation > CONFIG.MAX_ENTRY_DEVIATION) {
    console.warn(`⚠️ Entry ${signal.entry_price} deviates ${(deviation * 100).toFixed(2)}%`);
    
    const maxEntry = currentPrice * (1 + CONFIG.MAX_ENTRY_DEVIATION);
    const minEntry = currentPrice * (1 - CONFIG.MAX_ENTRY_DEVIATION);
    
    const correctedEntry = Math.max(minEntry, Math.min(maxEntry, signal.entry_price));
    
    console.log(`✓ Corrected to ${correctedEntry.toFixed(2)}`);
    
    return {
      ...signal,
      entry_price: correctedEntry
    };
  }
  
  return signal;
}

function roundToTickSize(price: number, tickSize: number): number {
  return Math.round(price / tickSize) * tickSize;
}

async function placeOrder(signal: TradingSignal, currentPrice: number) {
  // Get product specs
  const product = await delta.getProduct(CONFIG.PRODUCT_SYMBOL);
  const tickSize = parseFloat(product.tick_size);
  
  // Round to valid tick
  signal.entry_price = roundToTickSize(signal.entry_price, tickSize);
  
  // Final safety check
  const finalDeviation = Math.abs(signal.entry_price - currentPrice) / currentPrice;
  
  if (finalDeviation > CONFIG.MAX_SAFETY_DEVIATION) {
    throw new Error(
      `SAFETY BLOCK: Entry ${signal.entry_price} is ${(finalDeviation * 100).toFixed(2)}% from current ${currentPrice} (max: 0.5%)`
    );
  }
  
  // Execute
  const order = await delta.placeOrder({
    product_id: CONFIG.PRODUCT_ID,
    size: 10,
    side: signal.action.toLowerCase(),
    order_type: "limit_order",
    limit_price: signal.entry_price.toString(),
    time_in_force: "gtc"
  });
  
  console.log("✓ Order placed:", order.id);
  return order;
}

async function main() {
  const currentPrice = 2738.24;
  
  console.log(`Current ETH price: $${currentPrice}\n`);
  
  // Step 1: Get AI signal
  let signal = await getAISignal(currentPrice);
  console.log("Groq signal:", signal.entry_price);
  
  // Step 2: Validate schema
  signal = SignalSchema.parse(signal);
  
  // Step 3: Sanitize (MUST CAPTURE RETURN VALUE)
  signal = sanitizePrice(signal, currentPrice);
  console.log("Sanitized signal:", signal.entry_price);
  
  // Step 4: Execute
  await placeOrder(signal, currentPrice);
}

main().catch(console.error);