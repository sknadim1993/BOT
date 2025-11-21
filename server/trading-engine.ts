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

    // Get wallet balances
    const balances = await deltaClient.getWalletBalance();
    console.log("Wallet balances received:", JSON.stringify(balances, null, 2));
    
    // Handle if balances is array or object
    const balanceArray = Array.isArray(balances) ? balances : (balances?.balances || []);
    
    // Find USDT or INR balance (common collateral assets on Delta Exchange)
    const usdtBalance = balanceArray.find((b: any) => 
      b.asset_symbol === "USDT" || b.asset_symbol === "USDC"
    );
    const inrBalance = balanceArray.find((b: any) => 
      b.asset_symbol === "INR"
    );
    const usdBalance = balanceArray.find((b: any) => 
      b.asset_symbol === "USD"
    );
    
    const collateral = usdtBalance || inrBalance || usdBalance || balanceArray[0];

    if (!collateral) {
      console.error("No collateral balance found, aborting trade.");
      return null;
    }

    // Use available_balance field as per Delta Exchange docs
    const availableBalanceRaw = parseFloat(
      collateral.available_balance || collateral.balance || "0"
    );

    console.log(`Collateral asset: ${collateral.asset_symbol}, Available: ${availableBalanceRaw}`);

    if (availableBalanceRaw <= 0) {
      console.error("Insufficient collateral balance, aborting trade.");
      return null;
    }

    // Calculate balance to use for this trade
    const balanceToUse = availableBalanceRaw * (settings.balanceAllocation / 100);
    console.log(`Balance to use: ${balanceToUse} (${settings.balanceAllocation}% of ${availableBalanceRaw})`);

    // Get product info
    const products = await deltaClient.getProducts();
    const product = products.find((p: any) => p.symbol === signal.recommendedAsset);
    if (!product) {
      console.error(`Product not found: ${signal.recommendedAsset}`);
      return null;
    }

    // Set leverage for this product
    console.log(`Setting leverage to ${settings.leverage}x`);
    await deltaClient.setProductLeverage(settings.leverage);

    // Calculate quantity with leverage
    // Available balance * leverage / entry price = position size
    const positionValue = balanceToUse * settings.leverage;
    const quantity = Number((positionValue / signal.entryPrice).toFixed(8));

    console.log(`Calculated quantity: ${quantity} (Position value: ${positionValue}, Entry: ${signal.entryPrice})`);

    if (quantity <= 0) {
      console.error("Calculated quantity is zero or negative, aborting trade.");
      return null;
    }

    const side = signal.direction === "long" ? "buy" : "sell";
    let orderResult: any = null;
    
    try {
      console.log(`Placing ${side} order: ${quantity} @ ${signal.entryPrice} with SL: ${signal.stopLoss}, TP: ${signal.takeProfit}`);
      
      orderResult = await deltaClient.placeMarketOrderWithBracket(
        quantity,
        side,
        signal.stopLoss.toString(),
        signal.takeProfit.toString()
      );
      
      console.log("Order placed successfully:", JSON.stringify(orderResult, null, 2));
    } catch (err: any) {
      console.error("Failed to place Delta order:", err?.message || err);
      console.error("Delta error body:", err?.response?.data || err);
      return null;
    }

    const orderId = orderResult?.result?.id || orderResult?.id || null;

    // Persist trade to DB
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

    // notify
    await sendTradeExecutedEmail({
      symbol: signal.recommendedAsset,
      direction: signal.direction,
      entryPrice: signal.entryPrice.toString(),
      stopLoss: signal.stopLoss.toString(),
      takeProfit: signal.takeProfit.toString(),
      quantity: quantity.toString(),
      leverage: settings.leverage,
    });

    console.log("Trade executed and persisted:", trade.id);
    return trade;
  } catch (error: any) {
    console.error("Error executing trade:", error?.message || error);
    return null;
  }
}

export async function monitorTrades() {
  const activeTrades = await storage.getActiveTrades();
  for (const trade of activeTrades) {
    try {
      if (!trade.deltaOrderId) continue;
      const status = await deltaClient.getOrderStatus(trade.deltaOrderId);
      const state = status?.state || status?.status || null;
      if (!state) continue;

      if (state === "closed" || state === "cancelled") {
        const exitPrice = Number(status.average_fill_price || trade.entryPrice.toString());
        // determine sl/tp/hit
        const entryPrice = Number(trade.entryPrice.toString());
        const stopLoss = Number(trade.stopLoss.toString());
        const takeProfit = Number(trade.takeProfit.toString());

        let finalStatus = "closed";
        if (trade.direction === "long") {
          finalStatus = exitPrice <= stopLoss ? "sl_hit" : exitPrice >= takeProfit ? "tp_hit" : "closed";
        } else {
          finalStatus = exitPrice >= stopLoss ? "sl_hit" : exitPrice <= takeProfit ? "tp_hit" : "closed";
        }

        await closeTrade(trade.id, exitPrice, finalStatus);
      }
    } catch (err: any) {
      console.error(`Error monitoring trade ${trade.id}:`, err?.message || err);
    }
  }
}

export async function closeTrade(tradeId: string, exitPrice: number, status: string) {
  try {
    const trade = await storage.getTrade(tradeId);
    if (!trade) return;

    const entryPrice = Number(trade.entryPrice.toString());
    const quantity = Number(trade.quantity.toString());

    let pnl: number;
    if (trade.direction === "long") {
      pnl = (exitPrice - entryPrice) * quantity * trade.leverage;
    } else {
      pnl = (entryPrice - exitPrice) * quantity * trade.leverage;
    }

    const pnlPercentage = (pnl / (entryPrice * quantity)) * 100;

    await storage.updateTrade(tradeId, {
      exitPrice: exitPrice.toString(),
      exitTime: new Date(),
      pnl: pnl.toString(),
      pnlPercentage: pnlPercentage.toString(),
      status,
    });

    // update daily performance
    await updateDailyPerformance(trade.symbol, pnl);

    // send email
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

    console.log(`Trade closed ${tradeId} PnL ${pnl.toFixed(2)}`);
  } catch (err: any) {
    console.error("Error closing trade:", err?.message || err);
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