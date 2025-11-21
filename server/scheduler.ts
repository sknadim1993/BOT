import cron from 'node-cron';
import { storage } from './storage';
import { researchMarkets } from './research-engine';
import { executeTrade, monitorTrades } from './trading-engine';
import { sendDailyReport } from './email-service';
import type { TradingMode } from '@shared/schema';

let isAnalyzing = false;
let isMonitoring = false;

// Monitor trades every minute
cron.schedule('* * * * *', async () => {
  if (isMonitoring) return;
  
  isMonitoring = true;
  try {
    await monitorTrades();
  } catch (error) {
    console.error('Error in trade monitoring:', error);
  } finally {
    isMonitoring = false;
  }
});

// Analyze markets based on trading mode
cron.schedule('*/5 * * * *', async () => {
  if (isAnalyzing) return;

  isAnalyzing = true;
  try {
    // Check if all required env vars are set
    if (!process.env.DELTA_API_KEY || !process.env.GROQ_API_KEY) {
      console.log('Missing API credentials, skipping automated analysis');
      return;
    }

    const settings = await storage.getSettings();
    
    if (!settings || !settings.autoTradingEnabled) {
      console.log('Auto-trading disabled, skipping analysis');
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

    console.log(`Running analysis for ${tradingMode} mode...`);
    
    // Research markets
    const analysis = await researchMarkets(tradingMode as TradingMode);
    
    if (!analysis) {
      console.log('No viable trading opportunities found');
      return;
    }

    // Check if confidence is high enough
    if (analysis.confidence < 60) {
      console.log(`Confidence too low (${analysis.confidence}%), skipping trade`);
      return;
    }

    // Check concurrent trade limit
    const activeTrades = await storage.getActiveTrades();
    if (activeTrades.length >= concurrentTrades) {
      console.log('Max concurrent trades reached, skipping execution');
      return;
    }

    // Execute trade
    await executeTrade(analysis, settings);
  } catch (error) {
    console.error('Error in market analysis:', error);
  } finally {
    isAnalyzing = false;
  }
});

// Daily report at 11:59 PM IST
cron.schedule('29 18 * * *', async () => {
  // 18:29 UTC = 11:59 PM IST
  try {
    // Check if email service is configured
    if (!process.env.REPLIT_CONNECTORS_HOSTNAME || !process.env.SUPPORT_EMAIL) {
      console.log('Email service not configured, skipping daily report');
      return;
    }

    const performance = await storage.getTodayPerformance();
    
    if (!performance) {
      console.log('No performance data for today');
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

    console.log('Daily report sent');
  } catch (error) {
    console.error('Error sending daily report:', error);
  }
});

export function startScheduler() {
  console.log('Scheduler started');
  console.log('- Trade monitoring: Every minute');
  console.log('- Market analysis: Based on trading mode');
  console.log('- Daily reports: 11:59 PM IST');
}
