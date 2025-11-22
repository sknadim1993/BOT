import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, decimal, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Trading settings
export const settings = pgTable("settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leverage: integer("leverage").notNull().default(50),
  balanceAllocation: integer("balance_allocation").notNull().default(100),
  concurrentTrades: integer("concurrent_trades").notNull().default(1),
  tradingMode: text("trading_mode").notNull().default('scalping'), // scalping, intraday, swing, longterm
  autoTradingEnabled: boolean("auto_trading_enabled").notNull().default(false),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Trade history
export const trades = pgTable("trades", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol: text("symbol").notNull(),
  tradingMode: text("trading_mode").notNull(),
  direction: text("direction").notNull(), // long or short
  entryPrice: decimal("entry_price", { precision: 20, scale: 8 }).notNull(),
  exitPrice: decimal("exit_price", { precision: 20, scale: 8 }),
  quantity: decimal("quantity", { precision: 20, scale: 8 }).notNull(),
  leverage: integer("leverage").notNull(),
  stopLoss: decimal("stop_loss", { precision: 20, scale: 8 }).notNull(),
  takeProfit: decimal("take_profit", { precision: 20, scale: 8 }).notNull(),
  pnl: decimal("pnl", { precision: 20, scale: 8 }),
  pnlPercentage: decimal("pnl_percentage", { precision: 10, scale: 2 }),
  status: text("status").notNull().default('open'), // open, closed, cancelled, sl_hit, tp_hit
  confidence: integer("confidence"),
  reasoning: text("reasoning"),
  entryTime: timestamp("entry_time").notNull().defaultNow(),
  exitTime: timestamp("exit_time"),
  deltaOrderId: text("delta_order_id"),
});

// Market analysis from Groq
export const analysis = pgTable("analysis", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tradingMode: text("trading_mode").notNull(),
  recommendedAsset: text("recommended_asset"),
  direction: text("direction"),
  entryPrice: decimal("entry_price", { precision: 20, scale: 8 }),
  stopLoss: decimal("stop_loss", { precision: 20, scale: 8 }),
  takeProfit: decimal("take_profit", { precision: 20, scale: 8 }),
  confidence: integer("confidence"),
  strongestAssets: jsonb("strongest_assets").$type<string[]>(),
  weakestAssets: jsonb("weakest_assets").$type<string[]>(),
  patternExplanation: text("pattern_explanation"),
  multiTimeframeReasoning: text("multi_timeframe_reasoning"),
  marketData: jsonb("market_data"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Daily performance metrics
export const dailyPerformance = pgTable("daily_performance", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  date: timestamp("date").notNull().defaultNow(),
  totalPnl: decimal("total_pnl", { precision: 20, scale: 8 }).notNull().default('0'),
  totalTrades: integer("total_trades").notNull().default(0),
  winningTrades: integer("winning_trades").notNull().default(0),
  losingTrades: integer("losing_trades").notNull().default(0),
  winRate: decimal("win_rate", { precision: 5, scale: 2 }),
  bestAsset: text("best_asset"),
  worstAsset: text("worst_asset"),
  largestWin: decimal("largest_win", { precision: 20, scale: 8 }),
  largestLoss: decimal("largest_loss", { precision: 20, scale: 8 }),
  tradingMode: text("trading_mode"),
});

// Type definitions
export type TradeStatus = 'open' | 'closed' | 'cancelled' | 'sl_hit' | 'tp_hit';
export type TradeDirection = 'long' | 'short';

// Zod schemas for validation
export const insertSettingsSchema = createInsertSchema(settings).omit({ id: true, updatedAt: true }).extend({
  leverage: z.number().min(1).max(100),
  balanceAllocation: z.number().min(10).max(100),
  concurrentTrades: z.number().min(1).max(10),
  tradingMode: z.enum(['scalping', 'intraday', 'swing', 'longterm']),
  autoTradingEnabled: z.boolean(),
});

export const insertTradeSchema = createInsertSchema(trades).omit({ 
  id: true, 
  entryTime: true, 
  exitTime: true 
}).extend({
  status: z.enum(['open', 'closed', 'cancelled', 'sl_hit', 'tp_hit']).optional(),
  direction: z.enum(['long', 'short']),
});

export const insertAnalysisSchema = createInsertSchema(analysis).omit({ 
  id: true, 
  createdAt: true 
}).extend({
  tradingMode: z.string(),
  confidence: z.number().optional(),
});

export const insertDailyPerformanceSchema = createInsertSchema(dailyPerformance).omit({ 
  id: true, 
  date: true 
});

// TypeScript types
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Settings = typeof settings.$inferSelect;

export type InsertTrade = z.infer<typeof insertTradeSchema>;
export type Trade = typeof trades.$inferSelect;

export type InsertAnalysis = z.infer<typeof insertAnalysisSchema>;
export type Analysis = typeof analysis.$inferSelect;

export type InsertDailyPerformance = z.infer<typeof insertDailyPerformanceSchema>;
export type DailyPerformance = typeof dailyPerformance.$inferSelect;

// Trading mode configuration
export const TRADING_MODES = {
  scalping: { label: 'Scalping', timeframe: '5m', interval: 5 },
  intraday: { label: 'Intraday', timeframe: '15m', interval: 15 },
  swing: { label: 'Swing', timeframe: '1H', interval: 60 },
  longterm: { label: 'Long-Term', timeframe: '1D', interval: 1440 },
} as const;

export type TradingMode = keyof typeof TRADING_MODES;