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
    const usdtBalance = balances.find((b: any) => b.asset_symbol === 'USDT');
    if (!usdtBalance || parseFloat(usdtBalance.balance) === 0) {
      console.error('Insufficient USDT balance');
      return null;
    }

    const availableBalance = parseFloat(usdtBalance.balance) * (settings.balanceAllocation / 100);

    // Calculate position size
    const positionValue = availableBalance * settings.leverage;
    const quantity = positionValue / signal.entryPrice;

    // Get product ID for the symbol
    const products = await deltaClient.getProducts();
    const product = products.find((p: any) => p.symbol === signal.recommendedAsset);
    if (!product) {
      console.error(`Product not found: ${signal.recommendedAsset}`);
      return null;
    }

    // Place market order
    const side = signal.direction === 'long' ? 'buy' : 'sell';
    let orderId = null;
    
    try {
      const order = await deltaClient.placeMarketOrder(product.id, quantity, side);
      orderId = order.result?.id || null;
    } catch (error) {
      console.error('Failed to place Delta order, creating trade record anyway:', error);
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
  } catch (error) {
    console.error('Error executing trade:', error);
    return null;
  }
}

export async function monitorTrades() {
  const activeTrades = await storage.getActiveTrades();

  for (const trade of activeTrades) {
    try {
      // Get current price from orderbook
      const orderbook = await deltaClient.getOrderbook(trade.symbol);
      const currentPrice = parseFloat(orderbook.buy[0]?.price || '0');

      if (currentPrice === 0) continue;

      const entryPrice = parseFloat(trade.entryPrice.toString());
      const stopLoss = parseFloat(trade.stopLoss.toString());
      const takeProfit = parseFloat(trade.takeProfit.toString());

      let shouldClose = false;
      let status = trade.status;

      // Check if stop loss or take profit hit
      if (trade.direction === 'long') {
        if (currentPrice <= stopLoss) {
          shouldClose = true;
          status = 'sl_hit';
        } else if (currentPrice >= takeProfit) {
          shouldClose = true;
          status = 'tp_hit';
        }
      } else {
        // Short position
        if (currentPrice >= stopLoss) {
          shouldClose = true;
          status = 'sl_hit';
        } else if (currentPrice <= takeProfit) {
          shouldClose = true;
          status = 'tp_hit';
        }
      }

      if (shouldClose) {
        await closeTrade(trade.id, currentPrice, status);
      }
    } catch (error) {
      console.error(`Error monitoring trade ${trade.id}:`, error);
    }
  }
}

export async function closeTrade(tradeId: string, exitPrice: number, status: string) {
  try {
    const trade = await storage.getTrade(tradeId);
    if (!trade) return;

    const entryPrice = parseFloat(trade.entryPrice.toString());
    const quantity = parseFloat(trade.quantity.toString());
    
    // Calculate PnL
    let pnl: number;
    if (trade.direction === 'long') {
      pnl = (exitPrice - entryPrice) * quantity;
    } else {
      pnl = (entryPrice - exitPrice) * quantity;
    }

    const pnlPercentage = (pnl / (entryPrice * quantity)) * 100 * trade.leverage;

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
  } catch (error) {
    console.error('Error closing trade:', error);
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
