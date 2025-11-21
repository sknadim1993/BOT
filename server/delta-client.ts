import axios from "axios";
import crypto from "crypto";

const BASE_URL = "https://api.india.delta.exchange";
const SYMBOL = "ETHUSD";
let CONTRACT_ID: number | null = null;

/* ---- REST Auth ---- */
const KEY = process.env.DELTA_API_KEY!;
const SECRET = process.env.DELTA_API_SECRET!;

/* ---- REST request with signature ---- */
async function signedRequest(method: string, endpoint: string, body: any = {}) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const payload = timestamp + method.toUpperCase() + endpoint + (Object.keys(body).length ? JSON.stringify(body) : "");
  const signature = crypto.createHmac("sha256", SECRET).update(payload).digest("hex");

  const headers = {
    "api-key": KEY,
    "timestamp": timestamp,
    "signature": signature,
  };

  const url = `${BASE_URL}${endpoint}`;
  const response = method === "GET"
    ? await axios.get(url, { headers })
    : await axios.post(url, body, { headers });

  return response.data;
}

/* ---- Initialize CONTRACT ID for ETHUSD ---- */
async function initProduct() {
  if (CONTRACT_ID) return CONTRACT_ID;
  const res = await axios.get(`${BASE_URL}/v2/products`);
  const product = res.data.result.find((p: any) => p.symbol === SYMBOL);
  if (!product) throw new Error("ETHUSD product not found");
  CONTRACT_ID = product.contract_id;
  console.log(`[Delta] ETHUSD CONTRACT ID = ${CONTRACT_ID}`);
  return CONTRACT_ID;
}

/* ---- OHLC ---- */
async function getOHLCV(timeframe: "5m" | "15m" | "1h" | "1d") {
  const contractId = await initProduct();

  const map: Record<string, { resolution_number: number; resolution_unit: string }> = {
    "5m": { resolution_number: 5, resolution_unit: "minute" },
    "15m": { resolution_number: 15, resolution_unit: "minute" },
    "1h": { resolution_number: 1, resolution_unit: "hour" },
    "1d": { resolution_number: 1, resolution_unit: "day" },
  };

  const { resolution_number, resolution_unit } = map[timeframe];
  const now = Math.floor(Date.now() / 1000);
  const from = now - 200 * (resolution_number * 60);

  const response = await axios.get(`${BASE_URL}/v2/history/candles`, {
    params: {
      resolution_number,
      resolution_unit,
      contract_id: contractId,
      start: from,
      end: now,
    },
  });

  return response.data.result;
}

/* ---- Orderbook ---- */
async function getOrderbook() {
  const response = await axios.get(`${BASE_URL}/v2/l2orderbook`, {
    params: { product_ids: SYMBOL },
  });
  return response.data.result[SYMBOL];
}

/* ---- Wallet ---- */
async function getWallet() {
  return signedRequest("GET", "/v2/wallet/balances");
}

/* ---- Positions ---- */
async function getPositions() {
  return signedRequest("GET", "/v2/positions/margined");
}

/* ---- Order Status ---- */
async function getOrder(orderId: string) {
  return signedRequest("GET", `/v2/orders/${orderId}`);
}

/* ---- Set leverage ---- */
async function setLeverage(leverage: number) {
  const contractId = await initProduct();
  return signedRequest("POST", "/v2/leverage", { leverage, contract_id: contractId });
}

/* ---- Market Order ---- */
async function placeMarketOrder(size: number, side: "buy" | "sell") {
  const contractId = await initProduct();
  return signedRequest("POST", "/v2/orders", {
    product_id: contractId,
    size,
    side,
    order_type: "market_order",
    time_in_force: "ioc",
  });
}

/* ---- Market Order + SL/TP (Bracket) ---- */
async function placeMarketOrderWithBracket(size: number, side: "buy" | "sell", sl: string, tp: string) {
  const contractId = await initProduct();
  return signedRequest("POST", "/v2/orders", {
    product_id: contractId,
    size,
    side,
    order_type: "market_order",
    time_in_force: "ioc",
    bracket_stop_loss_price: sl,
    bracket_take_profit_price: tp,
  });
}

/* ---- Cancel Order ---- */
async function cancelOrder(orderId: string) {
  return signedRequest("POST", `/v2/orders/${orderId}/cancel`);
}

/* ---- Test connection ---- */
async function testConnection() {
  try {
    await initProduct();
    await getWallet();
    return true;
  } catch {
    return false;
  }
}

export const deltaClient = {
  getOHLCV,
  getOrderbook,
  getPositions,
  getWallet,
  getOrder,
  setLeverage,
  placeMarketOrder,
  placeMarketOrderWithBracket,
  cancelOrder,
  testConnection,
};
