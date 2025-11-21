import DeltaRestClient from "delta-rest-client";
import axios from "axios";

const BASE_URL = "https://api.india.delta.exchange";
const SYMBOL = "ETHUSD"; // FIXED
let PRODUCT_ID: number | null = null;

let deltaClientInstance: any = null;

/* -------- PRODUCT INIT -------- */
async function initProduct() {
  if (PRODUCT_ID) return PRODUCT_ID;
  const res = await axios.get(`${BASE_URL}/v2/products`);
  const product = res.data.result.find((p: any) => p.symbol === SYMBOL);
  if (!product) throw new Error(`ETHUSD not found in /v2/products`);
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

/* -------- OHLCV (NO RESOLUTION MAP) -------- */
async function getOHLCV(
  resolution: string, // 5m | 15m | 1h | 1d
  from: number,
  to: number
) {
  const productId = await initProduct();
  const url = `${BASE_URL}/v2/history/candles`;
  const params = {
    product_id: productId,
    resolution: resolution.toLowerCase(),
    start: Math.floor(from).toString(),
    end: Math.floor(to).toString(),
  };

  const response = await axios.get(url, { params });
  return {
    symbol: SYMBOL,
    resolution,
    data: response.data.result || [],
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
  return data.result;
}

/* -------- PLACE MARKET -------- */
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

/* -------- CANCEL ORDER -------- */
async function cancelOrder(orderId: string) {
  const client = await getDeltaClient();
  const res = await client.apis.Orders.deleteOrder({ id: orderId });
  return JSON.parse(res.data.toString());
}

/* -------- WALLET -------- */
async function getWalletBalance() {
  const client = await getDeltaClient();
  const res = await client.apis.Wallet.getBalances();
  const data = JSON.parse(res.data.toString());
  return data.result;
}

/* -------- TEST CONNECTION -------- */
async function testConnection() {
  console.log("[TEST] Checking connection...");
  await initProduct();
  await getWalletBalance();
  console.log("[TEST] OK");
  return true;
}

export const deltaClient = {
  getOHLCV,
  getOrderbook,
  getPositions,
  placeMarketOrder,
  cancelOrder,
  getWalletBalance,
  testConnection,
};
