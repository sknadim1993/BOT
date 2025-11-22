import Groq from "groq-sdk";
import { z } from "zod";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Define strict schema with explicit ranges
const TradingSignalSchema = z.object({
  action: z.enum(["BUY", "SELL", "HOLD"]),
  current_price: z.number(),
  entry_price: z.number(),
  stop_loss: z.number(),
  take_profit: z.number(),
  entry_deviation_pct: z.number().min(-0.5).max(0.5), // Hard limit
  reasoning: z.string()
});

const systemPrompt = `You are a crypto trading signal generator with MANDATORY numerical constraints.

ABSOLUTE RULES (violation = system rejection):
1. REFERENCE POINT: Current price is the ONLY anchor. NEVER use historical swing highs/lows.
2. PERCENTAGE BOUNDS: Entry MUST be within 0.5% of current price.
3. CALCULATION PROCESS:
   - Current Price: $CURRENT
   - Max Entry: $CURRENT × 1.005
   - Min Entry: $CURRENT × 0.995
   - Your entry MUST fall within this range

EXECUTION ORDER:
Step 1: State current price explicitly
Step 2: Calculate boundaries: current × (1 ± 0.005)
Step 3: Propose entry within boundaries
Step 4: VERIFY: abs((entry - current) / current × 100) ≤ 0.5
Step 5: Return structured JSON

EXAMPLE (DO THIS):
Current: $2738.24
Max Entry: $2738.24 × 1.005 = $2751.93
Min Entry: $2738.24 × 0.995 = $2724.55
Selected Entry: $2745.00 ✓ (0.25% from current)

FORBIDDEN (NEVER DO THIS):
Using $2805.05 (previous resistance) ✗ - This is 2.44% away!`;

async function getGroqSignal(currentPrice: number, ohlcvData: any) {
  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      { role: "system", content: systemPrompt },
      { 
        role: "user", 
        content: `Current market price: $${currentPrice}. 
                  Generate trading signal with entry within 0.5% of current price.
                  Show your calculation steps.` 
      }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "trading_signal",
        schema: {
          type: "object",
          properties: {
            current_price: { type: "number" },
            entry_price: { 
              type: "number",
              minimum: currentPrice * 0.995,
              maximum: currentPrice * 1.005,
              description: "Must be within 0.5% of current price"
            },
            stop_loss: { type: "number" },
            take_profit: { type: "number" },
            entry_deviation_pct: { 
              type: "number",
              minimum: -0.5,
              maximum: 0.5 
            },
            reasoning: { type: "string" }
          },
          required: ["current_price", "entry_price", "stop_loss", "take_profit", "entry_deviation_pct"],
          additionalProperties: false
        },
        strict: true
      }
    },
    temperature: 0.1, // Critical: Low temperature for deterministic output
    max_tokens: 1500
  });

  const content = response.choices[0].message.content;
  if (!content) throw new Error("Empty response from Groq");
  
  return JSON.parse(content);
}