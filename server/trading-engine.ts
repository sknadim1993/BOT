import { deltaClient } from './delta-client';
import { storage } from './storage';
import { sendTradeExecutedEmail, sendTradeClosedEmail } from './email-service';
import type { Settings } from '@shared/schema';

interface TradeSignal {
  recommendedAsset: string;
  direction: 'long' | 'short';
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
    // Check if we've reached max concurrent trades
    const activeTrades = await storage.getActiveTrades();
    if (activeTrades.length >= settings.concurrentTrades) {
      console.log('Max concurrent trades reached. Skipping trade execution.');
      return null;
    }

    // Get wallet balance
    const balances = await deltaClient.getWalletBalance();
    const inrBalance = balances.find((b: any) => b.asset_symbol === 'INR');
    if (!inrBalance || parseFloat(inrBalance.balance) === 0) {
      console.error('Insufficient INR balance');
      return null;
    }

    const availableBalance = parseFloat(inrBalance.balance) * (settings.balanceAllocation / 100);

    // Get product info
    const products = await deltaClient.getProducts();
    const product = products.find((p: any) => p.symbol === signal.recommendedAsset);
    if (!product) {
      console.error(`Product not found: ${signal.recommendedAsset}`);
      return null;
    }

    // Set leverage for this product
    await deltaClient.setProductLeverage(product.id, settings.leverage);

    // Calculate position size (leverage is applied by exchange)
    const quantity = availableBalance / signal.entryPrice;

    // Place market order with bracket SL/TP
    const side = signal.direction === 'long' ? 'buy' : 'sell';
    let orderId = null;
    
    try {
      const order = await deltaClient.placeMarketOrderWithBracket(
        product.id,
        quantity,
        side,
        signal.stopLoss.toString(),
        signal.takeProfit.toString()
      );
      orderId = order.result?.id || null;
    } catch (error: any) {
      console.error('Failed to place Delta order:', error);
      console.error('Delta Exchange Error Details:', error.response?.data);
      return null;
    }

    // Create trade record
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
      status: 'open',
      confidence: signal.confidence,
      reasoning: `${signal.patternExplanation}\n\n${signal.multiTimeframeReasoning}`,
      deltaOrderId: orderId,
    });

    // Send email notification
    await sendTradeExecutedEmail({
      symbol: signal.recommendedAsset,
      direction: signal.direction,
      entryPrice: signal.entryPrice.toString(),
      stopLoss: signal.stopLoss.toString(),
      takeProfit: signal.takeProfit.toString(),
      quantity: quantity.toString(),
      leverage: settings.leverage,
    });

    console.log(`Trade executed successfully: ${trade.id}`);
    return trade;
  } catch (error: any) {
    console.error('Error executing trade:', error);
    console.error('Delta Exchange Error Details:', error.response?.data);
    return null;
  }
}

export async function monitorTrades() {
  const activeTrades = await storage.getActiveTrades();

  for (const trade of activeTrades) {
    try {
      // Check order status on Delta Exchange
      if (trade.deltaOrderId) {
        const orderStatus = await deltaClient.getOrderStatus(trade.deltaOrderId);
        
        // If bracket orders hit, they'll show in order status
        if (orderStatus.state === 'closed' || orderStatus.state === 'cancelled') {
          const exitPrice = parseFloat(orderStatus.average_fill_price || trade.entryPrice.toString());
          
          // Determine if SL or TP was hit based on price
          const entryPrice = parseFloat(trade.entryPrice.toString());
          const stopLoss = parseFloat(trade.stopLoss.toString());
          const takeProfit = parseFloat(trade.takeProfit.toString());
          
          let status = 'closed';
          if (trade.direction === 'long') {
            status = exitPrice <= stopLoss ? 'sl_hit' : exitPrice >= takeProfit ? 'tp_hit' : 'closed';
          } else {
            status = exitPrice >= stopLoss ? 'sl_hit' : exitPrice <= takeProfit ? 'tp_hit' : 'closed';
          }
          
          await closeTrade(trade.id, exitPrice, status);
        }
      }
    } catch (error: any) {
      console.error(`Error monitoring trade ${trade.id}:`, error);
      console.error('Delta Exchange Error Details:', error.response?.data);
    }
  }
}

export async function closeTrade(tradeId: string, exitPrice: number, status: string) {
  try {
    const trade = await storage.getTrade(tradeId);
    if (!trade) return;

    const entryPrice = parseFloat(trade.entryPrice.toString());
    const quantity = parseFloat(trade.quantity.toString());
    
    // Calculate PnL (leverage is already factored in by exchange)
    let pnl: number;
    if (trade.direction === 'long') {
      pnl = (exitPrice - entryPrice) * quantity * trade.leverage;
    } else {
      pnl = (entryPrice - exitPrice) * quantity * trade.leverage;
    }

    const pnlPercentage = (pnl / (entryPrice * quantity)) * 100;

    // Update trade
    await storage.updateTrade(tradeId, {
      exitPrice: exitPrice.toString(),
      exitTime: new Date(),
      pnl: pnl.toString(),
      pnlPercentage: pnlPercentage.toString(),
      status,
    });

    // Update daily performance
    await updateDailyPerformance(trade.symbol, pnl);

    // Send email notification
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

    console.log(`Trade closed: ${tradeId}, PnL: ${pnl.toFixed(2)}`);
  } catch (error: any) {
    console.error('Error closing trade:', error);
    console.error('Delta Exchange Error Details:', error.response?.data);
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
      winRate: pnl > 0 ? '100' : '0',
      bestAsset: pnl > 0 ? asset : null,
      worstAsset: pnl <= 0 ? asset : null,
      largestWin: pnl > 0 ? pnl.toString() : '0',
      largestLoss: pnl <= 0 ? pnl.toString() : '0',
      tradingMode: 'scalping' as any,
    });
    return;
  }

  const totalPnl = parseFloat(performance.totalPnl.toString()) + pnl;
  const totalTrades = performance.totalTrades + 1;
  const winningTrades = performance.winningTrades + (pnl > 0 ? 1 : 0);
  const losingTrades = performance.losingTrades + (pnl <= 0 ? 1 : 0);
  const winRate = (winningTrades / totalTrades) * 100;
  
  const largestWin = Math.max(parseFloat(performance.largestWin?.toString() || '0'), pnl > 0 ? pnl : 0);
  const largestLoss = Math.min(parseFloat(performance.largestLoss?.toString() || '0'), pnl <= 0 ? pnl : 0);

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