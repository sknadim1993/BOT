// trading-engine.ts
import { deltaClient } from "./delta-client";
import { storage } from "./storage";
import { sendTradeExecutedEmail, sendTradeClosedEmail } from "./email-service";
import type { Settings } from "@shared/schema";

interface TradeSignal {
  recommendedAsset: string;
  direction: "long" | "short";
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  patternExplanation: string;
  multiTimeframeReasoning: string;
}

export async function executeTrade(signal: TradeSignal, settings: Settings) {
  console.log(`Executing trade: ${signal.direction.toUpperCase()} ${signal.recommendedAsset}`);

  try {
    const activeTrades = await storage.getActiveTrades();
    if (activeTrades.length >= settings.concurrentTrades) {
      console.log("Max concurrent trades reached. Skipping trade execution.");
      return null;
    }

    const balances = await deltaClient.getWalletBalance();
    console.log("Wallet balances received:", JSON.stringify(balances, null, 2));
    const balanceArray = Array.isArray(balances) ? balances : (balances?.balances || []);

    const usdtBalance = balanceArray.find((b: any) => b.asset_symbol === "USDT" || b.asset_symbol === "USDC");
    const inrBalance = balanceArray.find((b: any) => b.asset_symbol === "INR");
    const usdBalance = balanceArray.find((b: any) => b.asset_symbol === "USD");
    const collateral = usdtBalance || inrBalance || usdBalance || balanceArray[0];

    if (!collateral) {
      console.error("No collateral balance found, aborting trade.");
      return null;
    }

    const availableBalanceRaw = parseFloat(collateral.available_balance || collateral.balance || "0");
    console.log(`Collateral asset: ${collateral.asset_symbol}, Available: ${availableBalanceRaw}`);

    if (availableBalanceRaw <= 0) {
      console.error("Insufficient collateral balance, aborting trade.");
      return null;
    }

    const balanceToUse = availableBalanceRaw * (settings.balanceAllocation / 100);
    console.log(`Balance to use: ${balanceToUse} (${settings.balanceAllocation}% of ${availableBalanceRaw})`);

    const products = await deltaClient.getProducts();
    const product = products.find((p: any) => p.symbol === signal.recommendedAsset);
    if (!product) {
      console.error(`Product not found: ${signal.recommendedAsset}`);
      return null;
    }

    console.log(`Setting leverage to ${settings.leverage}x`);
    await deltaClient.setProductLeverage(settings.leverage);

    // ==== CONTRACT SIZE LOGIC ====
    const availableNotional = balanceToUse * settings.leverage;
    const CONTRACT_VALUE = 0.01; // ETHUSD contract value
    const rawSize = availableNotional / (CONTRACT_VALUE * signal.entryPrice);
    const quantity = Math.floor(rawSize);

    console.log(
      `Calculated size (contracts): ${quantity} | Notional: ${availableNotional} | Entry: ${signal.entryPrice}`
    );

    if (quantity < 1) {
      console.error("Not enough balance to open even 1 contract — aborting trade.");
      return null;
    }

    // ==== VALIDATION: Ensure entry price makes sense ====
    const side = signal.direction === "long" ? "buy" : "sell";
    
    if (signal.direction === "long") {
      if (signal.takeProfit <= signal.entryPrice) {
        console.error(
          `❌ INVALID LONG TRADE: Entry (${signal.entryPrice}) must be < Take Profit (${signal.takeProfit})`
        );
        return null;
      }
      if (signal.stopLoss >= signal.entryPrice) {
        console.error(
          `❌ INVALID LONG TRADE: Stop Loss (${signal.stopLoss}) must be < Entry (${signal.entryPrice})`
        );
        return null;
      }
    } else {
      // SHORT
      if (signal.takeProfit >= signal.entryPrice) {
        console.error(
          `❌ INVALID SHORT TRADE: Entry (${signal.entryPrice}) must be > Take Profit (${signal.takeProfit})`
        );
        return null;
      }
      if (signal.stopLoss <= signal.entryPrice) {
        console.error(
          `❌ INVALID SHORT TRADE: Stop Loss (${signal.stopLoss}) must be > Entry (${signal.entryPrice})`
        );
        return null;
      }
    }

    // ==== CRITICAL: CHECK CURRENT MARKET PRICE ====
    let currentPrice: number;
    try {
      currentPrice = await deltaClient.getCurrentPrice();
      console.log(`📊 Current market price: ${currentPrice}`);
      console.log(`📊 AI Signal entry: ${signal.entryPrice}`);
      console.log(`📊 Take Profit: ${signal.takeProfit}`);
      console.log(`📊 Stop Loss: ${signal.stopLoss}`);
    } catch (error) {
      console.error("❌ Failed to get current market price, aborting trade.");
      return null;
    }

    // Price deviation check: Entry must be within 1% of current price
    const priceDeviation = Math.abs(signal.entryPrice - currentPrice) / currentPrice;
    const maxDeviation = 0.01; // 1% - stricter check

    if (priceDeviation > maxDeviation) {
      console.error(
        `❌ ENTRY PRICE TOO FAR FROM MARKET: Entry ${signal.entryPrice} is ${(priceDeviation * 100).toFixed(2)}% away from current price ${currentPrice} (max ${maxDeviation * 100}%)`
      );
      return null;
    }

    // CRITICAL: For limit orders to work properly as intended:
    // LONG: Entry must be BELOW current price (buy when price drops)
    // SHORT: Entry must be ABOVE current price (sell when price rises)
    
    if (signal.direction === "long") {
      if (currentPrice <= signal.entryPrice) {
        console.error(
          `❌ CANNOT PLACE LONG LIMIT ORDER: Current price (${currentPrice}) is at or below entry (${signal.entryPrice}). This would fill immediately at current price or worse, making take-profit unreachable.`
        );
        return null;
      }
      
      // Verify the trade makes sense: current > entry > stopLoss
      if (currentPrice <= signal.stopLoss) {
        console.error(
          `❌ INVALID LONG: Current price (${currentPrice}) is already at or below stop loss (${signal.stopLoss})`
        );
        return null;
      }
      
      // Verify entry is between current and SL
      if (signal.entryPrice <= signal.stopLoss) {
        console.error(
          `❌ INVALID LONG: Entry (${signal.entryPrice}) must be above stop loss (${signal.stopLoss})`
        );
        return null;
      }
    } else {
      // SHORT
      if (currentPrice >= signal.entryPrice) {
        console.error(
          `❌ CANNOT PLACE SHORT LIMIT ORDER: Current price (${currentPrice}) is at or above entry (${signal.entryPrice}). This would fill immediately at current price or worse, making take-profit unreachable.`
        );
        return null;
      }
      
      // Verify the trade makes sense: current < entry < stopLoss
      if (currentPrice >= signal.stopLoss) {
        console.error(
          `❌ INVALID SHORT: Current price (${currentPrice}) is already at or above stop loss (${signal.stopLoss})`
        );
        return null;
      }
      
      // Verify entry is between current and SL
      if (signal.entryPrice >= signal.stopLoss) {
        console.error(
          `❌ INVALID SHORT: Entry (${signal.entryPrice}) must be below stop loss (${signal.stopLoss})`
        );
        return null;
      }
    }

    console.log(
      `✅ Price validation passed: ${signal.direction.toUpperCase()} order will wait for price to ${signal.direction === "long" ? "drop to" : "rise to"} ${signal.entryPrice} (current: ${currentPrice})`
    );

    console.log(
      `📤 Placing LIMIT ${side} order: ${quantity} contracts @ ${signal.entryPrice} with SL: ${signal.stopLoss}, TP: ${signal.takeProfit}`
    );

    // ==== PLACE LIMIT ORDER WITH BRACKET ====
    const orderResult = await deltaClient.placeLimitOrderWithBracket(
      quantity,
      side,
      signal.entryPrice.toString(),
      signal.stopLoss.toString(),
      signal.takeProfit.toString()
    );

    console.log("✅ Order placed successfully:", JSON.stringify(orderResult, null, 2));

    const orderId = orderResult?.result?.id || orderResult?.id || null;

    const trade = await storage.createTrade({
      symbol: signal.recommendedAsset,
      tradingMode: settings.tradingMode,
      direction: signal.direction,
      entryPrice: signal.entryPrice.toString(),
      exitPrice: null,
      quantity: quantity.toString(),
      leverage: settings.leverage,
      stopLoss: signal.stopLoss.toString(),
      takeProfit: signal.takeProfit.toString(),
      pnl: null,
      pnlPercentage: null,
      status: "open",
      confidence: signal.confidence,
      reasoning: `${signal.patternExplanation}\n\n${signal.multiTimeframeReasoning}`,
      deltaOrderId: orderId,
    });

    await sendTradeExecutedEmail({
      symbol: signal.recommendedAsset,
      direction: signal.direction,
      entryPrice: signal.entryPrice.toString(),
      stopLoss: signal.stopLoss.toString(),
      takeProfit: signal.takeProfit.toString(),
      quantity: quantity.toString(),
      leverage: settings.leverage,
    });

    console.log("✅ Trade executed and persisted:", trade.id);
    return trade;
  } catch (error: any) {
    console.error("❌ Error executing trade:", error?.message || error);
    return null;
  }
}

export async function monitorTrades() {
  const activeTrades = await storage.getActiveTrades();
  
  if (activeTrades.length === 0) {
    return; // No trades to monitor
  }
  
  console.log(`🔍 Monitoring ${activeTrades.length} active trade(s)...`);
  
  for (const trade of activeTrades) {
    try {
      if (!trade.deltaOrderId) {
        console.log(`⚠️ Trade ${trade.id} has no Delta order ID, skipping`);
        continue;
      }
      
      // Add delay to avoid immediate checking after order placement
      const tradeAge = Date.now() - new Date(trade.entryTime).getTime();
      if (tradeAge < 10000) { // Less than 10 seconds old
        console.log(`⏳ Trade ${trade.id} is too new (${Math.floor(tradeAge / 1000)}s), skipping check`);
        continue;
      }
      
      const status = await deltaClient.getOrderStatus(trade.deltaOrderId);
      const state = status?.state || status?.status || null;
      
      console.log(`📋 Trade ${trade.id} (${trade.symbol} ${trade.direction}): state=${state}`);
      
      if (!state) {
        console.log(`⚠️ No state found for trade ${trade.id}`);
        continue;
      }

      // Only process if trade is actually filled and closed
      if (state === "closed" && status.unfilled_size === 0) {
        const fillPrice = parseFloat(status.average_fill_price || "0");
        
        if (!fillPrice || fillPrice === 0) {
          console.log(`⚠️ Trade ${trade.id} closed but no fill price available`);
          continue;
        }
        
        const entryPrice = parseFloat(trade.entryPrice.toString());
        const stopLoss = parseFloat(trade.stopLoss.toString());
        const takeProfit = parseFloat(trade.takeProfit.toString());

        console.log(`💰 Trade ${trade.id} filled at ${fillPrice}, checking exit...`);

        // Determine if SL or TP was hit based on fill price
        let finalStatus = "closed";
        let exitPrice = fillPrice;
        
        if (trade.direction === "long") {
          if (fillPrice <= stopLoss * 1.002) { // 0.2% tolerance
            finalStatus = "sl_hit";
            exitPrice = stopLoss;
            console.log(`🛑 Stop Loss hit for LONG trade`);
          } else if (fillPrice >= takeProfit * 0.998) {
            finalStatus = "tp_hit";
            exitPrice = takeProfit;
            console.log(`🎯 Take Profit hit for LONG trade`);
          }
        } else {
          if (fillPrice >= stopLoss * 0.998) { // 0.2% tolerance
            finalStatus = "sl_hit";
            exitPrice = stopLoss;
            console.log(`🛑 Stop Loss hit for SHORT trade`);
          } else if (fillPrice <= takeProfit * 1.002) {
            finalStatus = "tp_hit";
            exitPrice = takeProfit;
            console.log(`🎯 Take Profit hit for SHORT trade`);
          }
        }

        await closeTrade(trade.id, exitPrice, finalStatus);
      } else if (state === "cancelled") {
        console.log(`❌ Trade ${trade.id} was cancelled`);
        await storage.updateTrade(trade.id, { status: "cancelled" });
      } else {
        console.log(`⏳ Trade ${trade.id} still pending (state: ${state}, unfilled: ${status.unfilled_size || 0})`);
      }
    } catch (err: any) {
      console.error(`❌ Error monitoring trade ${trade.id}:`, err?.message || err);
    }
  }
}

export async function closeTrade(tradeId: string, exitPrice: number, status: string) {
  try {
    const trade = await storage.getTrade(tradeId);
    if (!trade) {
      console.error(`❌ Trade ${tradeId} not found`);
      return;
    }

    const entryPrice = parseFloat(trade.entryPrice.toString());
    const quantity = parseFloat(trade.quantity.toString());
    const CONTRACT_VALUE = 0.01; // ETHUSD contract value
    
    let pnl: number;

    if (trade.direction === "long") {
      // For LONG: PnL = (Exit - Entry) * Quantity * Contract Value * Leverage
      pnl = (exitPrice - entryPrice) * quantity * CONTRACT_VALUE * trade.leverage;
    } else {
      // For SHORT: PnL = (Entry - Exit) * Quantity * Contract Value * Leverage
      pnl = (entryPrice - exitPrice) * quantity * CONTRACT_VALUE * trade.leverage;
    }

    const pnlPercentage = ((exitPrice - entryPrice) / entryPrice) * 100 * (trade.direction === "long" ? 1 : -1);

    console.log(`💵 PnL Calculation for trade ${tradeId}:`);
    console.log(`   Direction: ${trade.direction}`);
    console.log(`   Entry: ${entryPrice}, Exit: ${exitPrice}`);
    console.log(`   Quantity: ${quantity}, Leverage: ${trade.leverage}x`);
    console.log(`   PnL: ${pnl.toFixed(2)}, PnL%: ${pnlPercentage.toFixed(2)}%`);

    await storage.updateTrade(tradeId, {
      exitPrice: exitPrice.toString(),
      exitTime: new Date(),
      pnl: pnl.toString(),
      pnlPercentage: pnlPercentage.toString(),
      status,
    });

    await updateDailyPerformance(trade.symbol, pnl);

    await sendTradeClosedEmail({
      symbol: trade.symbol,
      direction: trade.direction,
      entryPrice: trade.entryPrice.toString(),
      stopLoss: trade.stopLoss.toString(),
      takeProfit: trade.takeProfit.toString(),
      quantity: trade.quantity.toString(),
      leverage: trade.leverage,
      exitPrice: exitPrice.toString(),
      pnl: pnl.toString(),
      status,
    });

    console.log(`✅ Trade closed ${tradeId} | Status: ${status} | PnL: ${pnl.toFixed(2)}`);
  } catch (err: any) {
    console.error("❌ Error closing trade:", err?.message || err);
  }
}

async function updateDailyPerformance(asset: string, pnl: number) {
  const performance = await storage.getTodayPerformance();

  if (!performance) {
    await storage.updateDailyPerformance({
      totalPnl: pnl.toString(),
      totalTrades: 1,
      winningTrades: pnl > 0 ? 1 : 0,
      losingTrades: pnl <= 0 ? 1 : 0,
      winRate: pnl > 0 ? "100" : "0",
      bestAsset: pnl > 0 ? asset : null,
      worstAsset: pnl <= 0 ? asset : null,
      largestWin: pnl > 0 ? pnl.toString() : "0",
      largestLoss: pnl <= 0 ? pnl.toString() : "0",
      tradingMode: "scalping" as any,
    });
    return;
  }

  const totalPnl = parseFloat(performance.totalPnl.toString()) + pnl;
  const totalTrades = performance.totalTrades + 1;
  const winningTrades = performance.winningTrades + (pnl > 0 ? 1 : 0);
  const losingTrades = performance.losingTrades + (pnl <= 0 ? 1 : 0);
  const winRate = (winningTrades / totalTrades) * 100;

  const largestWin = Math.max(parseFloat(performance.largestWin?.toString() || "0"), pnl > 0 ? pnl : 0);
  const largestLoss = Math.min(parseFloat(performance.largestLoss?.toString() || "0"), pnl <= 0 ? pnl : 0);

  await storage.updateDailyPerformance({
    totalPnl: totalPnl.toString(),
    totalTrades,
    winningTrades,
    losingTrades,
    winRate: winRate.toString(),
    bestAsset: performance.bestAsset,
    worstAsset: performance.worstAsset,
    largestWin: largestWin.toString(),
    largestLoss: largestLoss.toString(),
  });
}