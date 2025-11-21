import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertSettingsSchema } from "@shared/schema";
import { deltaClient } from "./delta-client";

export async function registerRoutes(app: Express): Promise<Server> {
  // Get settings
  app.get('/api/settings', async (req, res) => {
    try {
      const settings = await storage.getSettings();
      
      if (!settings) {
        // Return default settings if none exist
        const defaultSettings = await storage.updateSettings({
          leverage: 50,
          balanceAllocation: 100,
          concurrentTrades: 1,
          tradingMode: 'scalping',
          autoTradingEnabled: false,
        });
        return res.json(defaultSettings);
      }
      
      res.json(settings);
    } catch (error: any) {
      console.error('Error fetching settings:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Update settings
  app.put('/api/settings', async (req, res) => {
    try {
      const validated = insertSettingsSchema.partial().parse(req.body);
      const settings = await storage.updateSettings(validated);
      res.json(settings);
    } catch (error: any) {
      console.error('Error updating settings:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Test Delta Exchange connection
  app.post('/api/settings/test-connection', async (req, res) => {
    try {
      const isConnected = await deltaClient.testConnection();
      if (isConnected) {
        res.json({ success: true, message: 'Delta Exchange API connected successfully' });
      } else {
        res.status(500).json({ success: false, message: 'Failed to connect to Delta Exchange API' });
      }
    } catch (error: any) {
      console.error('Error testing connection:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Get all trades
  app.get('/api/trades', async (req, res) => {
    try {
      const trades = await storage.getTrades();
      res.json(trades);
    } catch (error: any) {
      console.error('Error fetching trades:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get active trades
  app.get('/api/trades/active', async (req, res) => {
    try {
      const trades = await storage.getActiveTrades();
      res.json(trades);
    } catch (error: any) {
      console.error('Error fetching active trades:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get latest analysis
  app.get('/api/analysis', async (req, res) => {
    try {
      const analysis = await storage.getLatestAnalysis();
      res.json(analysis || null);
    } catch (error: any) {
      console.error('Error fetching analysis:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get daily performance
  app.get('/api/performance', async (req, res) => {
    try {
      let performance = await storage.getTodayPerformance();
      
      if (!performance) {
        // Initialize today's performance if it doesn't exist
        performance = await storage.updateDailyPerformance({
          totalPnl: '0',
          totalTrades: 0,
          winningTrades: 0,
          losingTrades: 0,
          winRate: '0',
          bestAsset: null,
          worstAsset: null,
          largestWin: '0',
          largestLoss: '0',
          tradingMode: 'scalping',
        });
      }
      
      res.json(performance);
    } catch (error: any) {
      console.error('Error fetching performance:', error);
      res.status(500).json({ error: error.message });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
