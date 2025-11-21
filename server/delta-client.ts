import crypto from 'crypto-js';
import axios, { AxiosInstance } from 'axios';

interface DeltaConfig {
  apiKey: string;
  apiSecret: string;
  baseURL: string;
}

interface OHLCVData {
  symbol: string;
  resolution: string;
  data: {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }[];
}

interface OrderbookData {
  symbol: string;
  buy: { price: string; size: number }[];
  sell: { price: string; size: number }[];
}

interface Position {
  symbol: string;
  size: number;
  entry_price: string;
  margin: string;
}

interface Order {
  id: string;
  product_id: number;
  size: number;
  price: string;
  side: 'buy' | 'sell';
  state: string;
}

export class DeltaClient {
  private client: AxiosInstance;
  private apiKey: string;
  private apiSecret: string;

  constructor(config: DeltaConfig) {
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    
    this.client = axios.create({
      baseURL: config.baseURL,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  private generateSignature(method: string, endpoint: string, timestamp: string, payload: string = ''): string {
    // Delta Exchange signature format: METHOD + TIMESTAMP + ENDPOINT_PATH + PAYLOAD
    // Use uppercase method and Hex encoding
    const message = method.toUpperCase() + timestamp + endpoint + payload;
    const signature = crypto.HmacSHA256(message, this.apiSecret).toString(crypto.enc.Hex);
    
    console.log(`[DEBUG] Signature generation:`, {
      method: method.toUpperCase(),
      endpoint,
      timestamp,
      payloadLength: payload.length,
      messagePreview: message.substring(0, 100) + '...',
      signaturePreview: signature.substring(0, 20) + '...'
    });
    
    return signature;
  }

  private async request(method: string, endpoint: string, data?: any) {
    // For GET requests, don't include payload in signature
    const payload = (method.toUpperCase() === 'GET') ? '' : (data ? JSON.stringify(data) : '');
    // Use milliseconds timestamp
    const timestamp = Math.floor(Date.now()).toString();
    const signature = this.generateSignature(method, endpoint, timestamp, payload);

    try {
      console.log(`[DEBUG] Delta API Request:`, {
        method: method.toUpperCase(),
        url: endpoint,
        timestamp,
        hasData: !!data
      });

      const response = await this.client.request({
        method,
        url: endpoint,
        data: data || undefined,
        headers: {
          'api-key': this.apiKey,
          'timestamp': timestamp,
          'signature': signature,
        },
      });

      return response.data;
    } catch (error: any) {
      console.error(`Delta API Error [${method} ${endpoint}]:`, {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message
      });
      throw error;
    }
  }

  // Get historical OHLCV data
  async getOHLCV(symbol: string, resolution: string, from: number, to: number): Promise<OHLCVData> {
    // Build endpoint with query params - this is what needs to be signed
    const endpoint = `/v2/history/candles?resolution=${resolution}&symbol=${symbol}&start=${from}&end=${to}`;
    const data = await this.request('GET', endpoint);
    
    return {
      symbol,
      resolution,
      data: data.result || [],
    };
  }

  // Get orderbook depth
  async getOrderbook(symbol: string): Promise<OrderbookData> {
    const endpoint = `/v2/l2orderbook/${symbol}`;
    const data = await this.request('GET', endpoint);
    
    return {
      symbol,
      buy: data.result?.buy || [],
      sell: data.result?.sell || [],
    };
  }

  // Get all available products (perpetual futures)
  async getProducts() {
    const endpoint = '/v2/products';
    const data = await this.request('GET', endpoint);
    return data.result || [];
  }

  // Get account positions
  async getPositions(): Promise<Position[]> {
    const endpoint = '/v2/positions';
    const data = await this.request('GET', endpoint);
    return data.result || [];
  }

  // Place a market order
  async placeMarketOrder(productId: number, size: number, side: 'buy' | 'sell') {
    const endpoint = '/v2/orders';
    const orderData = {
      product_id: productId,
      size,
      side,
      order_type: 'market_order',
      time_in_force: 'ioc',
    };
    
    return await this.request('POST', endpoint, orderData);
  }

  // Place a limit order (for SL/TP)
  async placeLimitOrder(
    productId: number,
    size: number,
    price: string,
    side: 'buy' | 'sell',
    stopLoss?: string,
    takeProfit?: string
  ) {
    const endpoint = '/v2/orders';
    const orderData: any = {
      product_id: productId,
      size,
      limit_price: price,
      side,
      order_type: 'limit_order',
      time_in_force: 'gtc',
    };

    if (stopLoss) {
      orderData.stop_loss_order = {
        stop_price: stopLoss,
      };
    }

    if (takeProfit) {
      orderData.take_profit_order = {
        stop_price: takeProfit,
      };
    }
    
    return await this.request('POST', endpoint, orderData);
  }

  // Cancel an order
  async cancelOrder(orderId: string) {
    const endpoint = `/v2/orders/${orderId}`;
    return await this.request('DELETE', endpoint);
  }

  // Get wallet balance
  async getWalletBalance() {
    const endpoint = '/v2/wallet/balances';
    const data = await this.request('GET', endpoint);
    return data.result || [];
  }

  // Test connection
  async testConnection(): Promise<boolean> {
    try {
      console.log('[DEBUG] Testing Delta Exchange connection...');
      await this.getProducts();
      console.log('[DEBUG] Connection test successful!');
      return true;
    } catch (error: any) {
      console.error('[DEBUG] Connection test failed:', error.message);
      return false;
    }
  }
}

// Initialize Delta client lazily
let deltaClientInstance: DeltaClient | null = null;

export function getDeltaClient(): DeltaClient {
  if (!deltaClientInstance) {
    const apiKey = process.env.DELTA_API_KEY;
    const apiSecret = process.env.DELTA_API_SECRET;
    
    if (!apiKey || !apiSecret) {
      throw new Error('Missing DELTA_API_KEY or DELTA_API_SECRET environment variables. Please configure your Delta Exchange credentials.');
    }
    
    console.log('[DEBUG] Initializing Delta Exchange client:', {
      apiKeyPreview: apiKey.substring(0, 10) + '...',
      apiSecretPreview: apiSecret.substring(0, 10) + '...',
      baseURL: 'https://api.delta.exchange'
    });
    
    deltaClientInstance = new DeltaClient({
      apiKey,
      apiSecret,
      baseURL: 'https://api.delta.exchange',
    });
  }
  return deltaClientInstance;
}

// Export for backward compatibility
export const deltaClient = {
  getOHLCV: (...args: Parameters<DeltaClient['getOHLCV']>) => getDeltaClient().getOHLCV(...args),
  getOrderbook: (...args: Parameters<DeltaClient['getOrderbook']>) => getDeltaClient().getOrderbook(...args),
  getProducts: (...args: Parameters<DeltaClient['getProducts']>) => getDeltaClient().getProducts(...args),
  getPositions: (...args: Parameters<DeltaClient['getPositions']>) => getDeltaClient().getPositions(...args),
  placeMarketOrder: (...args: Parameters<DeltaClient['placeMarketOrder']>) => getDeltaClient().placeMarketOrder(...args),
  placeLimitOrder: (...args: Parameters<DeltaClient['placeLimitOrder']>) => getDeltaClient().placeLimitOrder(...args),
  cancelOrder: (...args: Parameters<DeltaClient['cancelOrder']>) => getDeltaClient().cancelOrder(...args),
  getWalletBalance: (...args: Parameters<DeltaClient['getWalletBalance']>) => getDeltaClient().getWalletBalance(...args),
  testConnection: (...args: Parameters<DeltaClient['testConnection']>) => getDeltaClient().testConnection(...args),
};