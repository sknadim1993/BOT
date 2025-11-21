import DeltaRestClient from 'delta-rest-client';
import axios from 'axios';

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

let deltaClientInstance: any = null;
const BASE_URL = 'https://api.india.delta.exchange';

async function getDeltaClient() {
  if (!deltaClientInstance) {
    const apiKey = process.env.DELTA_API_KEY;
    const apiSecret = process.env.DELTA_API_SECRET;
    
    if (!apiKey || !apiSecret) {
      throw new Error('Missing DELTA_API_KEY or DELTA_API_SECRET environment variables');
    }
    
    console.log('[DEBUG] Initializing Delta Exchange client with official SDK');
    deltaClientInstance = await DeltaRestClient(apiKey, apiSecret);
  }
  return deltaClientInstance;
}

// Get historical OHLCV data using direct API call
async function getOHLCV(symbol: string, resolution: string, from: number, to: number): Promise<OHLCVData> {
  try {
    const url = `${BASE_URL}/v2/history/candles`;
    const params = {
      resolution,
      symbol,
      start: from.toString(),
      end: to.toString()
    };
    
    const response = await axios.get(url, { params });
    
    return {
      symbol,
      resolution,
      data: response.data.result || [],
    };
  } catch (error: any) {
    console.error(`Error fetching OHLCV for ${symbol}:`, error.message);
    throw error;
  }
}

// Get orderbook depth
async function getOrderbook(symbol: string): Promise<OrderbookData> {
  const client = await getDeltaClient();
  const response = await client.apis.Orderbook.getL2Orderbook({ symbol });
  
  const result = JSON.parse(response.data.toString());
  return {
    symbol,
    buy: result.result?.buy || [],
    sell: result.result?.sell || [],
  };
}

// Get all available products
async function getProducts() {
  const client = await getDeltaClient();
  const response = await client.apis.Products.getProducts();
  const result = JSON.parse(response.data.toString());
  return result.result || [];
}

// Get product by symbol using direct API call
async function getProductBySymbol(symbol: string) {
  try {
    const url = `${BASE_URL}/v2/products/${symbol}`;
    const response = await axios.get(url);
    return response.data.result;
  } catch (error: any) {
    console.error(`Error fetching product ${symbol}:`, error.message);
    throw error;
  }
}

// Get account positions
async function getPositions(): Promise<Position[]> {
  const client = await getDeltaClient();
  const response = await client.apis.Positions.getPositions();
  const result = JSON.parse(response.data.toString());
  return result.result || [];
}

// Set product leverage
async function setProductLeverage(productId: number, leverage: number) {
  const client = await getDeltaClient();
  const response = await client.apis.Orders.setLeverage({
    product_id: productId,
    leverage: leverage.toString()
  });
  return JSON.parse(response.data.toString());
}

// Place market order with bracket SL/TP
async function placeMarketOrderWithBracket(
  productId: number,
  size: number,
  side: 'buy' | 'sell',
  stopLoss: string,
  takeProfit: string
) {
  const client = await getDeltaClient();
  
  const orderData: any = {
    product_id: productId,
    size,
    side,
    order_type: 'market_order',
    time_in_force: 'ioc',
  };

  // Add bracket orders
  orderData.bracket_stop_loss_price = stopLoss;
  orderData.bracket_take_profit_price = takeProfit;
  
  const response = await client.apis.Orders.placeOrder({ order: orderData });
  return JSON.parse(response.data.toString());
}

// Place a market order
async function placeMarketOrder(productId: number, size: number, side: 'buy' | 'sell') {
  const client = await getDeltaClient();
  const response = await client.apis.Orders.placeOrder({
    order: {
      product_id: productId,
      size,
      side,
      order_type: 'market_order',
      time_in_force: 'ioc',
    }
  });
  
  return JSON.parse(response.data.toString());
}

// Get order status
async function getOrderStatus(orderId: string) {
  const client = await getDeltaClient();
  const response = await client.apis.Orders.getOrder({ id: orderId });
  const result = JSON.parse(response.data.toString());
  return result.result;
}

// Place a limit order
async function placeLimitOrder(
  productId: number,
  size: number,
  price: string,
  side: 'buy' | 'sell',
  stopLoss?: string,
  takeProfit?: string
) {
  const client = await getDeltaClient();
  const orderData: any = {
    product_id: productId,
    size,
    limit_price: price,
    side,
    order_type: 'limit_order',
    time_in_force: 'gtc',
  };

  if (stopLoss) {
    orderData.bracket_stop_loss_price = stopLoss;
  }
  if (takeProfit) {
    orderData.bracket_take_profit_price = takeProfit;
  }
  
  const response = await client.apis.Orders.placeOrder({ order: orderData });
  return JSON.parse(response.data.toString());
}

// Cancel an order
async function cancelOrder(orderId: string) {
  const client = await getDeltaClient();
  const response = await client.apis.Orders.deleteOrder({ id: orderId });
  return JSON.parse(response.data.toString());
}

// Get wallet balance
async function getWalletBalance() {
  const client = await getDeltaClient();
  const response = await client.apis.Wallet.getBalances();
  const result = JSON.parse(response.data.toString());
  return result.result || [];
}

// Test connection
async function testConnection(): Promise<boolean> {
  try {
    console.log('[DEBUG] Testing Delta Exchange connection...');
    await getProducts();
    console.log('[DEBUG] Connection test successful!');
    return true;
  } catch (error: any) {
    console.error('[DEBUG] Connection test failed:', error.message);
    return false;
  }
}

export const deltaClient = {
  getOHLCV,
  getOrderbook,
  getProducts,
  getProductBySymbol,
  getPositions,
  setProductLeverage,
  placeMarketOrder,
  placeMarketOrderWithBracket,
  placeLimitOrder,
  cancelOrder,
  getWalletBalance,
  getOrderStatus,
  testConnection,
};
