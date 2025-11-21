import DeltaRestClient from 'delta-rest-client';

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

// Get historical OHLCV data
async function getOHLCV(symbol: string, resolution: string, from: number, to: number): Promise<OHLCVData> {
  const client = await getDeltaClient();
  const response = await client.apis.Products.getL2Candles({
    resolution,
    symbol,
    start: from,
    end: to
  });
  
  const result = JSON.parse(response.data.toString());
  return {
    symbol,
    resolution,
    data: result.result || [],
  };
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

// Get account positions
async function getPositions(): Promise<Position[]> {
  const client = await getDeltaClient();
  const response = await client.apis.Positions.getPositions();
  const result = JSON.parse(response.data.toString());
  return result.result || [];
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
    orderData.stop_loss_order = { stop_price: stopLoss };
  }
  if (takeProfit) {
    orderData.take_profit_order = { stop_price: takeProfit };
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
  getPositions,
  placeMarketOrder,
  placeLimitOrder,
  cancelOrder,
  getWalletBalance,
  testConnection,
};