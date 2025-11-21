// delta-client.ts
import axios from "axios";
import DeltaRestClient from "delta-rest-client";

const BASE_URL = "https://api.india.delta.exchange";
const SYMBOL = "ETHUSD";
let PRODUCT_ID: number | null = null;
let deltaClientInstance: any = null;

// Correct mapping — required by Delta API
const RESOLUTION_MAP: Record<string, string> = {
  "1m": "1",
  "5m": "5",
  "15m": "15",
  "30m": "30",
  "1h": "60",
  "4h": "240",
  "1d": "1440",
};

// ---------------- INIT PRODUCT ----------------
async function initProduct() {
  if (PRODUCT_ID) return PRODUCT_ID;
  const res = await axios.get(`${BASE_URL}/v2/products`);
  const product = res.data.result.find((p: any) => p.symbol === SYMBOL);
  if (!product) throw new Error(`Product ${SYMBOL} not found`);
  PRODUCT_ID = product.id;
  console.log(`[INIT] ETHUSD product ID = ${PRODUCT_ID}`);
  return PRODUCT_ID;
}

// ---------------- DELTA CLIENT ----------------
async function getDeltaClient() {
  if (!deltaClientInstance) {
    const { DELTA_API_KEY, DELTA_API_SECRET } = process.env;
    if (!DELTA_API_KEY || !DELTA_API_SECRET)
      throw new Error("Missing Delta API credentials");

    deltaClientInstance = await DeltaRestClient(
      DELTA_API_KEY,
      DELTA_API_SECRET
    );
    await initProduct();
  }
  return deltaClientInstance;
}

// ---------------- OHLCV ----------------
export async function getOHLCV(
  timeframe: "5m" | "15m" | "1h" | "1d",
  from: number,
  to: number
) {
  const mapped = RESOLUTION_MAP[timeframe];
  if (!mapped) throw new Error(`Invalid timeframe: ${timeframe}`);
  const productId = await initProduct();

  const res = await axios.get(`${BASE_URL}/v2/history/candles`, {
    params: {
      product_id: productId,
      resolution: mapped,
      start: Math.floor(from),
      end: Math.floor(to),
    },
  });

  return {
    symbol: SYMBOL,
    timeframe,
    data: res.data.result || [],
  };
}

// ---------------- ORDERBOOK ----------------
export async function getOrderbook() {
  const client = await getDeltaClient();
  const res = await client.apis.Orderbook.getL2Orderbook({ symbol: SYMBOL });
  return JSON.parse(res.data.toString()).result;
}

// ---------------- POSITIONS ----------------
export async function getPositions() {
  const client = await getDeltaClient();
  const res = await client.apis.Positions.getPositions();
  return JSON.parse(res.data.toString()).result;
}

// ---------------- WALLET ----------------
export async function getWalletBalance() {
  const client = await getDeltaClient();
  const res = await client.apis.Wallet.getBalances();
  return JSON.parse(res.data.toString()).result;
}

// ---------------- PRODUCT LIST ----------------
export async function getProducts() {
  const res = await axios.get(`${BASE_URL}/v2/products`);
  return res.data.result || [];
}

// ---------------- SET LEVERAGE ----------------
export async function setProductLeverage(productId: number, leverage: number) {
  const client = await getDeltaClient();
  const res = await client.apis.Orders.setLeverage({
    product_id: productId,
    leverage: leverage.toString(),
  });
  return JSON.parse(res.data.toString());
}

// ---------------- MARKET ORDER ----------------
export async function placeMarketOrder(productId: number, size: number, side: "buy" | "sell") {
  const client = await getDeltaClient();
  const res = await client.apis.Orders.placeOrder({
    order: {
      product_id: productId,
      size,
      side,
      order_type: "market_order",
      time_in_force: "ioc",
    },
  });

  return JSON.parse(res.data.toString());
}

// ---------------- MARKET ORDER W/ BRACKET ----------------
export async function placeMarketOrderWithBracket(
  productId: number,
  size: number,
  side: "buy" | "sell",
  stopLoss: string,
  takeProfit: string
) {
  const client = await getDeltaClient();
  const res = await client.apis.Orders.placeOrder({
    order: {
      product_id: productId,
      size,
      side,
      order_type: "market_order",
      time_in_force: "ioc",
      bracket_stop_loss_price: stopLoss,
      bracket_take_profit_price: takeProfit,
    },
  });
  return JSON.parse(res.data.toString());
}

// ---------------- CANCEL ORDER ----------------
export async function cancelOrder(orderId: string) {
  const client = await getDeltaClient();
  const res = await client.apis.Orders.deleteOrder({ id: orderId });
  return JSON.parse(res.data.toString());
}

// ---------------- ORDER STATUS ----------------
export async function getOrderStatus(orderId: string) {
  const client = await getDeltaClient();
  const res = await client.apis.Orders.getOrder({ id: orderId });
  return JSON.parse(res.data.toString()).result;
}

// ---------------- CONNECTIVITY TEST ----------------
export async function testConnection() {
  await initProduct();
  await getWalletBalance();
  console.log("[TEST] Delta API working");
  return true;
}

export const deltaClient = {
  getOHLCV,
  getOrderbook,
  getPositions,
  getWalletBalance,
  getProducts,
  setProductLeverage,
  placeMarketOrder,
  placeMarketOrderWithBracket,
  cancelOrder,
  getOrderStatus,
  testConnection,
};
