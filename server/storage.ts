import { supabase } from "./supabase-client";
import type { 
  Settings, 
  InsertSettings, 
  Trade, 
  InsertTrade,
  Analysis,
  InsertAnalysis,
  DailyPerformance,
  InsertDailyPerformance
} from "@shared/schema";

export interface IStorage {
  // Settings
  getSettings(): Promise<Settings | undefined>;
  updateSettings(settings: Partial<InsertSettings>): Promise<Settings>;
  
  // Trades
  getTrade(id: string): Promise<Trade | undefined>;
  getTrades(filters?: { status?: string }): Promise<Trade[]>;
  getActiveTrades(): Promise<Trade[]>;
  createTrade(trade: InsertTrade): Promise<Trade>;
  updateTrade(id: string, updates: Partial<Trade>): Promise<Trade>;
  
  // Analysis
  getLatestAnalysis(): Promise<Analysis | undefined>;
  createAnalysis(analysis: InsertAnalysis): Promise<Analysis>;
  
  // Daily Performance
  getTodayPerformance(): Promise<DailyPerformance | undefined>;
  updateDailyPerformance(performance: Partial<InsertDailyPerformance>): Promise<DailyPerformance>;
}

export class SupabaseStorage implements IStorage {
  // Settings
  async getSettings(): Promise<Settings | undefined> {
    const { data, error } = await supabase
      .from('settings')
      .select('*')
      .limit(1)
      .single();
    
    if (error && error.code !== 'PGRST116') {
      console.error('Error fetching settings:', error);
      return undefined;
    }
    
    return data || undefined;
  }

  async updateSettings(settings: Partial<InsertSettings>): Promise<Settings> {
    const existing = await this.getSettings();
    
    if (existing) {
      const { data, error } = await supabase
        .from('settings')
        .update({ ...settings, updatedAt: new Date().toISOString() })
        .eq('id', existing.id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } else {
      const { data, error } = await supabase
        .from('settings')
        .insert([settings])
        .select()
        .single();
      
      if (error) throw error;
      return data;
    }
  }

  // Trades
  async getTrade(id: string): Promise<Trade | undefined> {
    const { data, error } = await supabase
      .from('trades')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) {
      console.error('Error fetching trade:', error);
      return undefined;
    }
    
    return data;
  }

  async getTrades(filters?: { status?: string }): Promise<Trade[]> {
    let query = supabase.from('trades').select('*').order('entryTime', { ascending: false });
    
    if (filters?.status) {
      query = query.eq('status', filters.status);
    }
    
    const { data, error } = await query;
    
    if (error) {
      console.error('Error fetching trades:', error);
      return [];
    }
    
    return data || [];
  }

  async getActiveTrades(): Promise<Trade[]> {
    const { data, error } = await supabase
      .from('trades')
      .select('*')
      .eq('status', 'open')
      .order('entryTime', { ascending: false });
    
    if (error) {
      console.error('Error fetching active trades:', error);
      return [];
    }
    
    return data || [];
  }

  async createTrade(trade: InsertTrade): Promise<Trade> {
    const { data, error } = await supabase
      .from('trades')
      .insert([trade])
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  async updateTrade(id: string, updates: Partial<Trade>): Promise<Trade> {
    const { data, error } = await supabase
      .from('trades')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  // Analysis
  async getLatestAnalysis(): Promise<Analysis | undefined> {
    const { data, error } = await supabase
      .from('analysis')
      .select('*')
      .order('createdAt', { ascending: false })
      .limit(1)
      .single();
    
    if (error && error.code !== 'PGRST116') {
      console.error('Error fetching analysis:', error);
      return undefined;
    }
    
    return data || undefined;
  }

  async createAnalysis(analysis: InsertAnalysis): Promise<Analysis> {
    const { data, error } = await supabase
      .from('analysis')
      .insert([analysis])
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  // Daily Performance
  async getTodayPerformance(): Promise<DailyPerformance | undefined> {
    const today = new Date().toISOString().split('T')[0];
    
    const { data, error } = await supabase
      .from('dailyPerformance')
      .select('*')
      .gte('date', `${today}T00:00:00`)
      .lte('date', `${today}T23:59:59`)
      .limit(1)
      .single();
    
    if (error && error.code !== 'PGRST116') {
      console.error('Error fetching daily performance:', error);
      return undefined;
    }
    
    return data || undefined;
  }

  async updateDailyPerformance(performance: Partial<InsertDailyPerformance>): Promise<DailyPerformance> {
    const existing = await this.getTodayPerformance();
    
    if (existing) {
      const { data, error } = await supabase
        .from('dailyPerformance')
        .update(performance)
        .eq('id', existing.id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } else {
      const { data, error } = await supabase
        .from('dailyPerformance')
        .insert([performance])
        .select()
        .single();
      
      if (error) throw error;
      return data;
    }
  }
}

export const storage = new SupabaseStorage();
