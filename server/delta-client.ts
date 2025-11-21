import DeltaRestClient from "delta-rest-client";
import axios from "axios";

const BASE_URL = "https://api.india.delta.exchange";
const SYMBOL = "ETHUSD"; // FIXED FOR YOUR BOT
let PRODUCT_ID: number | null = null;
let deltaClientInstance: any = null;

/* -------- RESOLUTION MAP (100% REQUIRED TO AVOID 400 ERRORS) -------- */
const RESOLUTION_MAP: Record<string, string> = {
  "1m": "1",
  "5m": "5",
  "15m": "15",
  "30m": "30",
  "1h": "60",
  "4h": "240",
  "1d": "1d",
};

/* -------- PRODUCT INIT -------- */
async function initProduct() {
  if (PRODUCT_ID) return PRODUCT_ID;

  const res = await axios.get(`${BASE_URL}/v2/products`);
  const product = res.data.result.find((p: any) => p.symbol === SYMBOL);
  if (!product) throw new Error(`Product ${SYMBOL} not found`);
  PRODUCT_ID = product.id;

  console.log(`[INIT] ETHUSD product ID = ${PRODUCT_ID}`);
  return PRODUCT_ID;
}

/* -------- DELTA CLIENT INIT -------- */
async function getDeltaClient() {
  if (!deltaClientInstance) {
    const { DELTA_API_KEY, DELTA_API_SECRET } = process.env;
    if (!DELTA_API_KEY || !DELTA_API_SECRET)
      throw new Error("Missing Delta API credentials");
    deltaClientInstance = await DeltaRestClient(DELTA_API_KEY, DELTA_API_SECRET);
    await initProduct();
  }
  return deltaClientInstance;
}

/* -------- OHLCV -------- */
async function getOHLCV(
  resolution: string, // 5m, 15m, 1h, 1d
  from: number,
  to: number
) {
  const productId = await initProduct();
  const mappedRes = RESOLUTION_MAP[resolution.toLowerCase()];
  if (!mappedRes) throw new Error(`Invalid resolution: ${resolution}`);

  const url = `${BASE_URL}/v2/history/candles`;
  const params = {
    product_id: productId,
    resolution: mappedRes,
    start: Math.floor(from),
    end: Math.floor(to),
  };

  const res = await axios.get(url, { params });
  return {
    symbol: SYMBOL,
    resolution,
    data: res.data.result || [],
  };
}

/* -------- ORDERBOOK -------- */
async function getOrderbook() {
  const client = await getDeltaClient();
  const res = await client.apis.Orderbook.getL2Orderbook({ symbol: SYMBOL });
  const data = JSON.parse(res.data.toString());
  return data.result;
}

/* -------- POSITIONS -------- */
async function getPositions() {
  const client = await getDeltaClient();
  const res = await client.apis.Positions.getPositions();
  const data = JSON.parse(res.data.toString());
  return data.result || [];
}

/* -------- WALLET -------- */
async function getWalletBalance() {
  const client = await getDeltaClient();
  const res = await client.apis.Wallet.getBalances();
  const data = JSON.parse(res.data.toString());
  return data.result || [];
}

/* -------- SET LEVERAGE -------- */
async function setProductLeverage(leverage: number) {
  const client = await getDeltaClient();
  const productId = await initProduct();
  const res = await client.apis.Orders.setLeverage({
    product_id: productId,
    leverage: leverage.toString(),
  });
  return JSON.parse(res.data.toString());
}

/* -------- MARKET ORDER -------- */
async function placeMarketOrder(size: number, side: "buy" | "sell") {
  const client = await getDeltaClient();
  const productId = await initProduct();
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

/* -------- MARKET ORDER WITH SL / TP -------- */
async function placeMarketOrderWithBracket(
  size: number,
  side: "buy" | "sell",
  stopLoss: string,
  takeProfit: string
) {
  const client = await getDeltaClient();
  const productId = await initProduct();
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

/* -------- LIMIT ORDER WITH OPTIONAL SL / TP -------- */
async function placeLimitOrder(
  size: number,
  price: string,
  side: "buy" | "sell",
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
    order_type: "limit_order",
    time_in_force: "gtc",
  };

  if (stopLoss) order.bracket_stop_loss_price = stopLoss;
  if (takeProfit) order.bracket_take_profit_price = takeProfit;

  const res = await client.apis.Orders.placeOrder({ order });
  return JSON.parse(res.data.toString());
}

/* -------- CANCEL ORDER -------- */
async function cancelOrder(orderId: string) {
  const client = await getDeltaClient();
  const res = await client.apis.Orders.deleteOrder({ id: orderId });
  return JSON.parse(res.data.toString());
}

/* -------- ORDER STATUS -------- */
async function getOrderStatus(orderId: string) {
  const client = await getDeltaClient();
  const res = await client.apis.Orders.getOrder({ id: orderId });
  return JSON.parse(res.data.toString()).result;
}

/* -------- TEST CONNECTION -------- */
async function testConnection() {
  console.log("[TEST] Checking connection to Delta Exchange...");
  await initProduct();
  await getWalletBalance();
  console.log("[TEST] OK — API working & ETHUSD accessible");
  return true;
}

/* -------- EXPORT -------- */
export const deltaClient = {
  getOHLCV,
  getOrderbook,
  getPositions,
  getWalletBalance,
  setProductLeverage,
  placeMarketOrder,
  placeMarketOrderWithBracket,
  placeLimitOrder,
  cancelOrder,
  getOrderStatus,
  testConnection,
};
