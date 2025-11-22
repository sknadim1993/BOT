import cron from 'node-cron';
import { storage } from './storage';
import { researchMarkets } from './research-engine';
import { executeTrade, monitorTrades } from './trading-engine';
import { sendDailyReport } from './email-service';
import { limitOrderManager } from './limit-order-manager';
import { deltaClient } from './delta-client';
import type { TradingMode } from '@shared/schema';

let isAnalyzing = false;
let isMonitoring = false;

// Monitor trades AND limit orders every 30 seconds (increased frequency)
cron.schedule('*/30 * * * * *', async () => {
  if (isMonitoring) return;
  
  isMonitoring = true;
  try {
    const pendingOrders = limitOrderManager.getPendingOrderCount();
    const activeTrades = await storage.getActiveTrades();
    
    if (pendingOrders > 0 || activeTrades.length > 0) {
      console.log(`\n👁️ Monitoring: ${activeTrades.length} active trade(s), ${pendingOrders} pending limit order(s)`);
      await monitorTrades();
    }
  } catch (error) {
    console.error('❌ Error in trade monitoring:', error);
  } finally {
    isMonitoring = false;
  }
});

// Clean expired limit orders every 2 minutes
cron.schedule('*/2 * * * *', async () => {
  try {
    limitOrderManager.clearExpiredOrders();
  } catch (error) {
    console.error('❌ Error clearing expired orders:', error);
  }
});

// Analyze markets based on trading mode
cron.schedule('*/5 * * * *', async () => {
  if (isAnalyzing) return;

  isAnalyzing = true;
  try {
    // Check if all required env vars are set
    if (!process.env.DELTA_API_KEY || !process.env.GROQ_API_KEY) {
      console.log('⚠️ Missing API credentials, skipping automated analysis');
      return;
    }

    const settings = await storage.getSettings();
    
    if (!settings || !settings.autoTradingEnabled) {
      console.log('⚠️ Auto-trading disabled, skipping analysis');
      return;
    }

    const { tradingMode, concurrentTrades } = settings;
    
    // Check timeframe interval
    const now = new Date();
    const minutes = now.getMinutes();
    
    let shouldAnalyze = false;
    
    if (tradingMode === 'scalping' && minutes % 5 === 0) {
      shouldAnalyze = true; // Every 5 minutes
    } else if (tradingMode === 'intraday' && minutes % 15 === 0) {
      shouldAnalyze = true; // Every 15 minutes
    } else if (tradingMode === 'swing' && minutes === 0) {
      shouldAnalyze = true; // Every hour
    } else if (tradingMode === 'longterm' && now.getHours() === 0 && minutes === 0) {
      shouldAnalyze = true; // Daily at midnight
    }

    if (!shouldAnalyze) {
      return;
    }

    console.log(`\n🔬 ===== SCHEDULED MARKET ANALYSIS =====`);
    console.log(`Time: ${now.toLocaleTimeString()}`);
    console.log(`Mode: ${tradingMode.toUpperCase()}`);
    console.log(`=======================================\n`);
    
    // Research markets
    const analysis = await researchMarkets(tradingMode as TradingMode);
    
    if (!analysis) {
      console.log('⚠️ No viable trading opportunities found');
      return;
    }

    console.log(`\n📊 ===== ANALYSIS RESULTS =====`);
    console.log(`Direction: ${analysis.direction.toUpperCase()}`);
    console.log(`Confidence: ${analysis.confidence}%`);
    console.log(`Strategy: ${analysis.executionStrategy?.toUpperCase() || 'MARKET'}`);
    console.log(`==============================\n`);

    // Check if confidence is high enough (AI should already filter this, but double-check)
    if (analysis.confidence < 70) {
      console.log(`⚠️ Confidence too low (${analysis.confidence}% < 70%), skipping trade`);
      return;
    }

    // Check if direction is none
    if (analysis.direction === 'none') {
      console.log('⚠️ AI recommends no trade at this time');
      return;
    }

    // Check concurrent trade limit (only count active trades, not pending limit orders)
    const activeTrades = await storage.getActiveTrades();
    const pendingLimitOrders = limitOrderManager.getPendingOrderCount();
    
    console.log(`\n📋 Current Status:`);
    console.log(`   Active trades: ${activeTrades.length}/${concurrentTrades}`);
    console.log(`   Pending limit orders: ${pendingLimitOrders}`);
    
    if (activeTrades.length >= concurrentTrades) {
      console.log(`⚠️ Max concurrent trades reached (${activeTrades.length}/${concurrentTrades}), skipping execution`);
      return;
    }

    // Check if we already have a pending limit order for this direction
    const pendingOrders = limitOrderManager.getPendingOrders();
    const sameDirectionOrder = pendingOrders.find(
      order => order.recommendation.direction === analysis.direction
    );
    
    if (sameDirectionOrder) {
      console.log(`⚠️ Already have a pending ${analysis.direction.toUpperCase()} limit order, skipping to avoid duplicates`);
      return;
    }

    // Execute trade (will handle both market and limit strategies)
    console.log(`\n🚀 Proceeding with trade execution...\n`);
    await executeTrade(analysis, settings);
    
  } catch (error: any) {
    console.error('❌ Error in market analysis:', error?.message || error);
  } finally {
    isAnalyzing = false;
  }
});

// Daily report at 11:59 PM IST
cron.schedule('29 18 * * *', async () => {
  // 18:29 UTC = 11:59 PM IST
  try {
    console.log('\n📧 ===== GENERATING DAILY REPORT =====\n');
    
    // Check if email service is configured
    if (!process.env.REPLIT_CONNECTORS_HOSTNAME || !process.env.SUPPORT_EMAIL) {
      console.log('⚠️ Email service not configured, skipping daily report');
      return;
    }

    const performance = await storage.getTodayPerformance();
    
    if (!performance) {
      console.log('⚠️ No performance data for today');
      return;
    }

    await sendDailyReport({
      date: new Date().toLocaleDateString(),
      totalPnl: parseFloat(performance.totalPnl?.toString() || '0'),
      totalTrades: performance.totalTrades,
      winningTrades: performance.winningTrades,
      losingTrades: performance.losingTrades,
      winRate: parseFloat(performance.winRate?.toString() || '0'),
      bestAsset: performance.bestAsset || 'N/A',
      worstAsset: performance.worstAsset || 'N/A',
      largestWin: parseFloat(performance.largestWin?.toString() || '0'),
      largestLoss: parseFloat(performance.largestLoss?.toString() || '0'),
      tradingMode: performance.tradingMode || 'scalping',
    });

    console.log('✅ Daily report sent successfully\n');
  } catch (error: any) {
    console.error('❌ Error sending daily report:', error?.message || error);
  }
});

// Status log every 15 minutes (helps with debugging)
cron.schedule('*/15 * * * *', async () => {
  try {
    const settings = await storage.getSettings();
    const activeTrades = await storage.getActiveTrades();
    const pendingOrders = limitOrderManager.getPendingOrderCount();
    const performance = await storage.getTodayPerformance();
    
    // ✅ FETCH REAL POSITIONS FROM DELTA EXCHANGE
    let realOpenPositions: any[] = [];
    try {
      realOpenPositions = await deltaClient.getOpenPositions();
    } catch (err) {
      console.error('⚠️ Failed to fetch real positions from Delta');
    }
    
    console.log(`\n📊 ===== BOT STATUS =====`);
    console.log(`Time: ${new Date().toLocaleTimeString()}`);
    console.log(`Auto-trading: ${settings?.autoTradingEnabled ? '✅ ENABLED' : '❌ DISABLED'}`);
    console.log(`Mode: ${settings?.tradingMode?.toUpperCase() || 'N/A'}`);
    console.log(`Active trades (DB): ${activeTrades.length}/${settings?.concurrentTrades || 0}`);
    console.log(`Pending limit orders: ${pendingOrders}`);
    console.log(`Real open positions (Delta): ${realOpenPositions.length}`);
    
    if (realOpenPositions.length > 0) {
      console.log(`\n🔍 Open Positions on Delta Exchange:`);
      realOpenPositions.forEach((pos: any, idx: number) => {
        const symbol = pos.product?.symbol || pos.symbol || 'UNKNOWN';
        const size = parseFloat(pos.size || "0");
        const direction = size > 0 ? 'LONG' : 'SHORT';
        const entryPrice = parseFloat(pos.entry_price || "0");
        const unrealizedPnl = parseFloat(pos.unrealized_pnl || pos.unrealized_profit_loss || "0");
        
        console.log(`   ${idx + 1}. ${symbol} ${direction} | Size: ${Math.abs(size)} | Entry: $${entryPrice.toFixed(2)} | Unrealized PnL: $${unrealizedPnl.toFixed(2)}`);
      });
    }
    
    console.log(`\nToday's Performance:`);
    console.log(`   PnL: $${performance?.totalPnl?.toString() || '0'}`);
    console.log(`   Trades: ${performance?.totalTrades || 0}`);
    console.log(`   Win rate: ${performance?.winRate?.toString() || '0'}%`);
    console.log(`========================\n`);
  } catch (error) {
    // Silent fail for status logs
  }
});

export function startScheduler() {
  console.log('\n🚀 ===== SCHEDULER STARTED =====');
  console.log('⏰ Cron Jobs Active:');
  console.log('   • Trade monitoring: Every 30 seconds');
  console.log('   • Limit order cleanup: Every 2 minutes');
  console.log('   • Market analysis: Every 5 minutes (scalping mode)');
  console.log('   • Status log: Every 15 minutes');
  console.log('   • Daily report: 11:59 PM IST (18:29 UTC)');
  console.log('================================\n');
}