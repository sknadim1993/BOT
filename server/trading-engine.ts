// trading-engine.ts
import { deltaClient } from "./delta-client";
import { storage } from "./storage";
import { sendTradeExecutedEmail, sendTradeClosedEmail } from "./email-service";
import { limitOrderManager } from "./limit-order-manager";
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
  executionStrategy: "market" | "limit";
  reasonForStrategy: string;
}

export async function executeTrade(signal: TradeSignal, settings: Settings) {
  console.log(`\n💼 ===== TRADE EXECUTION REQUEST =====`);
  console.log(`Asset: ${signal.recommendedAsset}`);
  console.log(`Direction: ${signal.direction.toUpperCase()}`);
  console.log(`Strategy: ${signal.executionStrategy.toUpperCase()}`);
  console.log(`Entry: $${signal.entryPrice}`);
  console.log(`Confidence: ${signal.confidence}%`);
  console.log(`=====================================\n`);

  try {
    // Check concurrent trade limit
    const activeTrades = await storage.getActiveTrades();
    if (activeTrades.length >= settings.concurrentTrades) {
      console.log(`⚠️ Max concurrent trades reached (${activeTrades.length}/${settings.concurrentTrades}). Skipping.`);
      return null;
    }

    // Get wallet balance
    const balances = await deltaClient.getWalletBalance();
    console.log("Wallet balances received");
    const balanceArray = Array.isArray(balances) ? balances : (balances?.balances || []);

    const inrBalance = balanceArray.find((b: any) => b.asset_symbol === "INR");
    const usdtBalance = balanceArray.find((b: any) => b.asset_symbol === "USDT" || b.asset_symbol === "USDC");
    const usdBalance = balanceArray.find((b: any) => b.asset_symbol === "USD");
    const collateral = inrBalance || usdtBalance || usdBalance || balanceArray[0];

    if (!collateral) {
      console.error("❌ No collateral balance found, aborting trade.");
      return null;
    }

    const availableBalanceRaw = parseFloat(collateral.available_balance || collateral.balance || "0");
    console.log(`💰 Collateral: ${collateral.asset_symbol}, Available: ${availableBalanceRaw.toFixed(2)}`);

    if (availableBalanceRaw <= 0) {
      console.error("❌ Insufficient collateral balance, aborting trade.");
      return null;
    }

    const balanceToUse = availableBalanceRaw * (settings.balanceAllocation / 100);
    console.log(`💵 Using ${settings.balanceAllocation}% of balance: ${balanceToUse.toFixed(2)}`);

    // Get product info
    const products = await deltaClient.getProducts();
    const product = products.find((p: any) => p.symbol === signal.recommendedAsset);
    if (!product) {
      console.error(`❌ Product not found: ${signal.recommendedAsset}`);
      return null;
    }

    // Set leverage
    console.log(`⚙️ Setting leverage to ${settings.leverage}x`);
    await deltaClient.setProductLeverage(settings.leverage);

    // Calculate position size
    const availableNotional = balanceToUse * settings.leverage;
    const CONTRACT_VALUE = 0.01; // ETHUSD contract value
    const rawSize = availableNotional / (CONTRACT_VALUE * signal.entryPrice);
    const quantity = Math.floor(rawSize);

    console.log(`📊 Position calculation:`);
    console.log(`   Available notional: $${availableNotional.toFixed(2)}`);
    console.log(`   Contract value: $${CONTRACT_VALUE}`);
    console.log(`   Contracts: ${quantity}`);

    if (quantity < 1) {
      console.error("❌ Not enough balance for even 1 contract. Aborting.");
      return null;
    }

    // Validate trade logic
    const side = signal.direction === "long" ? "buy" : "sell";

    if (signal.direction === "long") {
      if (signal.takeProfit <= signal.entryPrice) {
        console.error(`❌ INVALID LONG: TP (${signal.takeProfit}) must be > Entry (${signal.entryPrice})`);
        return null;
      }
      if (signal.stopLoss >= signal.entryPrice) {
        console.error(`❌ INVALID LONG: SL (${signal.stopLoss}) must be < Entry (${signal.entryPrice})`);
        return null;
      }
    } else {
      if (signal.takeProfit >= signal.entryPrice) {
        console.error(`❌ INVALID SHORT: TP (${signal.takeProfit}) must be < Entry (${signal.entryPrice})`);
        return null;
      }
      if (signal.stopLoss <= signal.entryPrice) {
        console.error(`❌ INVALID SHORT: SL (${signal.stopLoss}) must be > Entry (${signal.entryPrice})`);
        return null;
      }
    }

    // Get current market price
    let currentPrice: number;
    try {
      currentPrice = await deltaClient.getCurrentPrice();
      console.log(`📊 Current market price: $${currentPrice.toFixed(2)}`);
    } catch (error) {
      console.error("❌ Failed to get current market price, aborting.");
      return null;
    }

    // ===== STRATEGY: MARKET ORDER =====
    if (signal.executionStrategy === "market") {
      console.log(`\n💨 EXECUTING MARKET ORDER`);
      console.log(`Reason: ${signal.reasonForStrategy}`);
      console.log(`Entry will be at current market price: $${currentPrice.toFixed(2)}`);

      // Use current price as entry for market orders
      const marketEntry = currentPrice;
      
      // Recalculate SL/TP based on actual market entry
      let adjustedSL: number, adjustedTP: number;
      if (signal.direction === "long") {
        adjustedSL = marketEntry * 0.995; // 0.5% below
        adjustedTP = marketEntry + ((marketEntry - adjustedSL) * 2);
      } else {
        adjustedSL = marketEntry * 1.005; // 0.5% above
        adjustedTP = marketEntry - ((adjustedSL - marketEntry) * 2);
      }

      console.log(`📤 Placing LIMIT order (near-market execution):`);
      console.log(`   ${side.toUpperCase()} ${quantity} contracts`);
      console.log(`   Entry: $${marketEntry.toFixed(2)}`);
      console.log(`   SL: $${adjustedSL.toFixed(2)}`);
      console.log(`   TP: $${adjustedTP.toFixed(2)}`);

      const orderResult = await deltaClient.placeLimitOrderWithBracket(
        quantity,
        side,
        marketEntry.toFixed(2),
        adjustedSL.toFixed(2),
        adjustedTP.toFixed(2)
      );

      console.log("✅ Market order placed successfully");

      const orderId = orderResult?.result?.id || orderResult?.id || null;

      const trade = await storage.createTrade({
        symbol: signal.recommendedAsset,
        tradingMode: settings.tradingMode,
        direction: signal.direction,
        entryPrice: marketEntry.toString(),
        exitPrice: null,
        quantity: quantity.toString(),
        leverage: settings.leverage,
        stopLoss: adjustedSL.toString(),
        takeProfit: adjustedTP.toString(),
        pnl: null,
        pnlPercentage: null,
        status: "open",
        confidence: signal.confidence,
        reasoning: `${signal.patternExplanation}\n\n${signal.multiTimeframeReasoning}\n\nExecution: ${signal.reasonForStrategy}`,
        deltaOrderId: orderId,
      });

      await sendTradeExecutedEmail({
        symbol: signal.recommendedAsset,
        direction: signal.direction,
        entryPrice: marketEntry.toString(),
        stopLoss: adjustedSL.toString(),
        takeProfit: adjustedTP.toString(),
        quantity: quantity.toString(),
        leverage: settings.leverage,
      });

      console.log(`✅ Trade executed and recorded: ${trade.id}\n`);
      return trade;
    }

    // ===== STRATEGY: LIMIT ORDER =====
    else {
      console.log(`\n⏳ CREATING LIMIT ORDER`);
      console.log(`Reason: ${signal.reasonForStrategy}`);
      console.log(`Target entry: $${signal.entryPrice.toFixed(2)}`);
      console.log(`Current price: $${currentPrice.toFixed(2)}`);

      // Validate limit order logic
      const deviation = Math.abs(signal.entryPrice - currentPrice) / currentPrice;
      
      if (signal.direction === "long") {
        if (currentPrice <= signal.entryPrice) {
          console.error(
            `❌ CANNOT PLACE LONG LIMIT: Current (${currentPrice.toFixed(2)}) must be > Entry (${signal.entryPrice.toFixed(2)})`
          );
          return null;
        }
      } else {
        if (currentPrice >= signal.entryPrice) {
          console.error(
            `❌ CANNOT PLACE SHORT LIMIT: Current (${currentPrice.toFixed(2)}) must be < Entry (${signal.entryPrice.toFixed(2)})`
          );
          return null;
        }
      }

      // Deviation check (0.3% - 3%)
      if (deviation < 0.003) {
        console.log(`⚠️ Entry too close to current (${(deviation * 100).toFixed(2)}%), executing as market order instead`);
        signal.executionStrategy = "market";
        return executeTrade(signal, settings); // Recursive call with market strategy
      }

      if (deviation > 0.03) {
        console.error(`❌ Entry too far from current (${(deviation * 100).toFixed(2)}% > 3%), rejecting`);
        return null;
      }

      console.log(`✅ Limit order validation passed`);
      console.log(`   Deviation: ${(deviation * 100).toFixed(2)}%`);
      console.log(`   Direction: ${signal.direction.toUpperCase()}`);
      console.log(`   Entry: $${signal.entryPrice.toFixed(2)} (${signal.direction === "long" ? "below" : "above"} current)`);

      // Add to limit order manager
      const limitOrderId = limitOrderManager.addPendingOrder(
        {
          ...signal,
          recommendedAsset: signal.recommendedAsset,
          direction: signal.direction,
          entryPrice: signal.entryPrice,
          stopLoss: signal.stopLoss,
          takeProfit: signal.takeProfit,
          confidence: signal.confidence,
          strongestAssets: [],
          weakestAssets: [],
          patternExplanation: signal.patternExplanation,
          multiTimeframeReasoning: signal.multiTimeframeReasoning,
          executionStrategy: signal.executionStrategy,
          reasonForStrategy: signal.reasonForStrategy,
        },
        currentPrice
      );

      console.log(`✅ Limit order queued: ${limitOrderId}`);
      console.log(`⏰ Will monitor price for next 15 minutes\n`);

      return null; // No immediate trade, waiting for trigger
    }
  } catch (error: any) {
    console.error("❌ Error executing trade:", error?.message || error);
    return null;
  }
}

export async function monitorTrades() {
  // First: Check if any limit orders should trigger
  try {
    const currentPrice = await deltaClient.getCurrentPrice();
    const triggeredOrder = limitOrderManager.checkPendingOrders(currentPrice);

    if (triggeredOrder) {
      console.log(`\n🚀 ===== LIMIT ORDER TRIGGERED, EXECUTING NOW =====\n`);
      
      // Get current settings
      const settings = await storage.getSettings();
      if (!settings) {
        console.error("❌ No settings found, cannot execute triggered limit order");
        return;
      }

      // Execute the triggered order as market order
      const trade = await executeTrade(triggeredOrder, settings);
      
      if (trade) {
        console.log(`✅ Limit order successfully converted to trade: ${trade.id}`);
      }
      
      return; // Exit after handling triggered order
    }
  } catch (err: any) {
    console.error("❌ Error checking limit orders:", err?.message || err);
  }

  // Second: Monitor active trades
  const activeTrades = await storage.getActiveTrades();

  if (activeTrades.length === 0) {
    return;
  }

  console.log(`\n🔍 Monitoring ${activeTrades.length} active trade(s)...`);

  for (const trade of activeTrades) {
    try {
      if (!trade.deltaOrderId) {
        console.log(`⚠️ Trade ${trade.id} has no Delta order ID, skipping`);
        continue;
      }

      const tradeAge = Date.now() - new Date(trade.entryTime).getTime();
      if (tradeAge < 30000) { // Increased to 30 seconds
        console.log(`⏳ Trade ${trade.id} too new (${Math.floor(tradeAge / 1000)}s), skipping`);
        continue;
      }

      // Get order status
      const status = await deltaClient.getOrderStatus(trade.deltaOrderId);
      const state = status?.state || status?.status || null;
      const unfilledSize = parseFloat(status?.unfilled_size || "0");
      const filledSize = parseFloat(status?.size || "0") - unfilledSize;

      console.log(`📋 Trade ${trade.id}: ${trade.symbol} ${trade.direction.toUpperCase()}`);
      console.log(`   State: ${state} | Filled: ${filledSize}/${status?.size || 0} contracts`);

      if (!state) {
        console.log(`⚠️ No state found for trade ${trade.id}`);
        continue;
      }

      // CRITICAL FIX: Check positions instead of relying only on order state
      // Delta Exchange marks parent order as "closed" even when bracket orders are active
      let positions: any[] = [];
      try {
        positions = await deltaClient.getPositions();
        console.log(`   Checking positions: ${positions.length} found`);
      } catch (posErr) {
        console.error(`⚠️ Failed to get positions for trade ${trade.id}`);
      }

      // Find if this trade has an active position
      const activePosition = positions.find((pos: any) => {
        const posSymbol = pos.product?.symbol || pos.symbol;
        const posSize = Math.abs(parseFloat(pos.size || "0"));
        return posSymbol === trade.symbol && posSize > 0;
      });

      if (activePosition) {
        const posSize = Math.abs(parseFloat(activePosition.size || "0"));
        const unrealizedPnl = parseFloat(activePosition.unrealized_pnl || activePosition.unrealized_profit_loss || "0");
        
        console.log(`   ✅ Active position found: ${posSize} contracts, Unrealized PnL: $${unrealizedPnl.toFixed(2)}`);
        console.log(`   🔄 Trade is ACTIVE, waiting for SL/TP to trigger...`);
        continue; // Position still active, don't close trade
      }

      // If no active position AND order is closed, then check if it was filled
      if (state === "closed") {
        // Order closed but no active position = SL or TP was hit
        const fillPrice = parseFloat(status.average_fill_price || status.avg_fill_price || "0");

        if (!fillPrice || fillPrice === 0) {
          console.log(`⚠️ Trade ${trade.id} closed but no fill price available`);
          continue;
        }

        // Check if order was actually filled (not just cancelled)
        if (filledSize === 0 || unfilledSize === parseFloat(status?.size || "0")) {
          console.log(`❌ Trade ${trade.id} was cancelled or not filled`);
          await storage.updateTrade(trade.id, { status: "cancelled" });
          continue;
        }

        const entryPrice = parseFloat(trade.entryPrice.toString());
        const stopLoss = parseFloat(trade.stopLoss.toString());
        const takeProfit = parseFloat(trade.takeProfit.toString());

        console.log(`💰 Trade ${trade.id} position closed at ${fillPrice.toFixed(2)}`);

        // Determine if SL or TP was hit based on fill price
        let finalStatus = "closed";
        let exitPrice = fillPrice;

        if (trade.direction === "long") {
          const distanceToSL = Math.abs(fillPrice - stopLoss);
          const distanceToTP = Math.abs(fillPrice - takeProfit);
          
          if (distanceToSL < distanceToTP) {
            finalStatus = "sl_hit";
            exitPrice = stopLoss;
            console.log(`🛑 Stop Loss hit for LONG trade`);
          } else {
            finalStatus = "tp_hit";
            exitPrice = takeProfit;
            console.log(`🎯 Take Profit hit for LONG trade`);
          }
        } else {
          const distanceToSL = Math.abs(fillPrice - stopLoss);
          const distanceToTP = Math.abs(fillPrice - takeProfit);
          
          if (distanceToSL < distanceToTP) {
            finalStatus = "sl_hit";
            exitPrice = stopLoss;
            console.log(`🛑 Stop Loss hit for SHORT trade`);
          } else {
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
        console.log(`⏳ Trade ${trade.id} still pending (state: ${state})`);
      }
    } catch (err: any) {
      console.error(`❌ Error monitoring trade ${trade.id}:`, err?.message || err);
    }
  }

  // Clean up expired limit orders
  limitOrderManager.clearExpiredOrders();
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
    const CONTRACT_VALUE = 0.01;

    let pnl: number;

    if (trade.direction === "long") {
      pnl = (exitPrice - entryPrice) * quantity * CONTRACT_VALUE * trade.leverage;
    } else {
      pnl = (entryPrice - exitPrice) * quantity * CONTRACT_VALUE * trade.leverage;
    }

    const pnlPercentage = ((exitPrice - entryPrice) / entryPrice) * 100 * (trade.direction === "long" ? 1 : -1);

    console.log(`\n💵 ===== TRADE CLOSED =====`);
    console.log(`ID: ${tradeId}`);
    console.log(`Direction: ${trade.direction.toUpperCase()}`);
    console.log(`Entry: $${entryPrice.toFixed(2)}`);
    console.log(`Exit: $${exitPrice.toFixed(2)}`);
    console.log(`Quantity: ${quantity} contracts`);
    console.log(`Leverage: ${trade.leverage}x`);
    console.log(`PnL: $${pnl.toFixed(2)} (${pnlPercentage.toFixed(2)}%)`);
    console.log(`Status: ${status}`);
    console.log(`=========================\n`);

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

    console.log(`✅ Trade ${tradeId} closed successfully`);
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