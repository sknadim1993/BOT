import DeltaRestClient from 'delta-rest-client';
import axios from 'axios';

const BASE_URL = 'https://api.india.delta.exchange';
const SYMBOL = 'ETHUSD'; // App supports only ETHUSD
let PRODUCT_ID: number | null = null;

interface OHLCVData {
  symbol: string;
  resolution: string;
  data: {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
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

/* ----------------- PRODUCT INIT (ETHUSD FIXED) ----------------- */
async function initProduct() {
  if (PRODUCT_ID) return PRODUCT_ID;
  console.log(`[DEBUG] Fetching product ID for ${SYMBOL}`);
  const response = await axios.get(`${BASE_URL}/v2/products/${SYMBOL}`);
  PRODUCT_ID = response.data.result.id;
  console.log(`[DEBUG] ETHUSD PRODUCT ID = ${PRODUCT_ID}`);
  return PRODUCT_ID;
}

/* ----------------- SDK INIT ----------------- */
async function getDeltaClient() {
  if (!deltaClientInstance) {
    const apiKey = process.env.DELTA_API_KEY;
    const apiSecret = process.env.DELTA_API_SECRET;

    if (!apiKey || !apiSecret) {
      throw new Error('Missing DELTA_API_KEY or DELTA_API_SECRET');
    }

    deltaClientInstance = await DeltaRestClient(apiKey, apiSecret);
    await initProduct();
  }
  return deltaClientInstance;
}

/* ----------------- OHLCV (ETHUSD ONLY) ----------------- */
async function getOHLCV(symbol: string, resolution: string, from: number, to: number): Promise<OHLCVData> {
  try {
    const productId = await initProduct();
    const url = `${BASE_URL}/v2/history/candles`;

    const params = {
      resolution: resolution.toLowerCase(), // 1H → 1h, 1D → 1d
      product_id: productId,
      start: from.toString(),
      end: to.toString(),
    };

    const response = await axios.get(url, { params });

    return {
      symbol: SYMBOL,
      resolution,
      data: response.data.result || [],
    };
  } catch (error: any) {
    console.error(`Error fetching OHLCV for ETHUSD:`, error.message);
    throw error;
  }
}

/* ----------------- ORDERBOOK ----------------- */
async function getOrderbook(): Promise<OrderbookData> {
  const client = await getDeltaClient();
  const response = await client.apis.Orderbook.getL2Orderbook({ symbol: SYMBOL });
  const result = JSON.parse(response.data.toString());
  return {
    symbol: SYMBOL,
    buy: result.result?.buy || [],
    sell: result.result?.sell || [],
  };
}

/* ----------------- POSITIONS ----------------- */
async function getPositions(): Promise<Position[]> {
  const client = await getDeltaClient();
  const response = await client.apis.Positions.getPositions();
  const result = JSON.parse(response.data.toString());
  return result.result || [];
}

/* ----------------- SET LEVERAGE ----------------- */
async function setProductLeverage(leverage: number) {
  const client = await getDeltaClient();
  const productId = await initProduct();
  const response = await client.apis.Orders.setLeverage({
    product_id: productId,
    leverage: leverage.toString()
  });
  return JSON.parse(response.data.toString());
}

/* ----------------- MARKET ORDER ----------------- */
async function placeMarketOrder(size: number, side: 'buy' | 'sell') {
  const client = await getDeltaClient();
  const productId = await initProduct();
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

/* ----------------- MARKET ORDER + BRACKET ----------------- */
async function placeMarketOrderWithBracket(
  size: number,
  side: 'buy' | 'sell',
  stopLoss: string,
  takeProfit: string
) {
  const client = await getDeltaClient();
  const productId = await initProduct();
  const response = await client.apis.Orders.placeOrder({
    order: {
      product_id: productId,
      size,
      side,
      order_type: 'market_order',
      time_in_force: 'ioc',
      bracket_stop_loss_price: stopLoss,
      bracket_take_profit_price: takeProfit,
    }
  });
  return JSON.parse(response.data.toString());
}

/* ----------------- LIMIT ORDER ----------------- */
async function placeLimitOrder(
  size: number,
  price: string,
  side: 'buy' | 'sell',
  stopLoss?: string,
  takeProfit?: string
) {
  const client = await getDeltaClient();
  const productId = await initProduct();
  const order: any = {
    product_id: productId,
    size,
    limit_price: price,
    side,
    order_type: 'limit_order',
    time_in_force: 'gtc',
  };

  if (stopLoss) order.bracket_stop_loss_price = stopLoss;
  if (takeProfit) order.bracket_take_profit_price = takeProfit;

  const response = await client.apis.Orders.placeOrder({ order });
  return JSON.parse(response.data.toString());
}

/* ----------------- CANCEL ORDER ----------------- */
async function cancelOrder(orderId: string) {
  const client = await getDeltaClient();
  const response = await client.apis.Orders.deleteOrder({ id: orderId });
  return JSON.parse(response.data.toString());
}

/* ----------------- WALLET ----------------- */
async function getWalletBalance() {
  const client = await getDeltaClient();
  const response = await client.apis.Wallet.getBalances();
  const result = JSON.parse(response.data.toString());
  return result.result || [];
}

/* ----------------- ORDER STATUS ----------------- */
async function getOrderStatus(orderId: string) {
  const client = await getDeltaClient();
  const response = await client.apis.Orders.getOrder({ id: orderId });
  const result = JSON.parse(response.data.toString());
  return result.result;
}

/* ----------------- TEST CONNECTION ----------------- */
async function testConnection(): Promise<boolean> {
  try {
    console.log('[DEBUG] Testing Delta Exchange connection...');
    await initProduct();
    await getWalletBalance();
    console.log('[DEBUG] Connection OK for ETHUSD');
    return true;
  } catch (error: any) {
    console.error('[DEBUG] Connection failed:', error.message);
    return false;
  }
}

/* ----------------- EXPORT ----------------- */
export const deltaClient = {
  getOHLCV,
  getOrderbook,
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
