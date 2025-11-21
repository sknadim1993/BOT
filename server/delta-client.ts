// delta-client.ts
import axios from "axios";
import DeltaRestClient from "delta-rest-client";

const BASE_URL = "https://api.india.delta.exchange";
const SYMBOL = "ETHUSD";

let PRODUCT: any = null;
let PRODUCT_ID: number | null = null;
let deltaClientInstance: any = null;

/* ---------------- INIT PRODUCT ---------------- */
export async function initProduct() {
  if (PRODUCT_ID) return PRODUCT_ID;
  const res = await axios.get(`${BASE_URL}/v2/products`);
  const list = res?.data?.result || [];
  const product = list.find((p: any) => p.symbol === SYMBOL);
  if (!product) throw new Error(`Product ${SYMBOL} not found`);
  PRODUCT = product;
  PRODUCT_ID = product.contract_id || product.id || product.product_id || null;
  console.log(`[INIT] ${SYMBOL} Loaded → PRODUCT_ID: ${PRODUCT_ID}`);
  return PRODUCT_ID;
}

/* ---------------- AUTHENTICATED CLIENT ---------------- */
export async function getDeltaClient() {
  if (!deltaClientInstance) {
    const { DELTA_API_KEY, DELTA_API_SECRET } = process.env;
    if (!DELTA_API_KEY || !DELTA_API_SECRET)
      throw new Error("Missing Delta API KEY or SECRET");
    deltaClientInstance = await DeltaRestClient(DELTA_API_KEY, DELTA_API_SECRET);
    await initProduct();
  }
  return deltaClientInstance;
}

/* ---------------- SIMPLE OHLCV (CORRECT + NO FAILURE)  ---------------- */
const RESOLUTION_MAP: Record<string, string> = {
  "5m": "5m",
  "15m": "15m",
  "1h": "1h",
  "1H": "1h",
  "1d": "1d",
  "1D": "1d",
};

export async function getOHLCV(
  symbol: string,
  timeframe: "5m" | "15m" | "1h" | "1H" | "1d" | "1D",
  start: number,
  end: number
) {
  const resolution = RESOLUTION_MAP[timeframe];
  if (!resolution) throw new Error(`Invalid resolution: ${timeframe}`);

  const url = `${BASE_URL}/v2/history/candles`;

  try {
    const res = await axios.get(url, {
      params: {
        symbol,
        resolution,
        start,
        end,
      },
    });

    return {
      symbol,
      timeframe,
      data: res.data?.result || [],
    };
  } catch (err: any) {
    console.error(`❌ OHLC fetch failed ${symbol} ${resolution}`, err?.response?.data || err.message);
    return { symbol, timeframe, data: [] };
  }
}

/* ---------------- GET PRODUCTS ---------------- */
export async function getProducts() {
  const res = await axios.get(`${BASE_URL}/v2/products`);
  return res?.data?.result || [];
}

/* ---------------- ORDERBOOK ---------------- */
export async function getOrderbook() {
  const client = await getDeltaClient();
  const res = await client.apis.Orderbook.getL2Orderbook({ symbol: SYMBOL });
  return res?.data?.result || res?.result || res;
}

/* ---------------- POSITIONS ---------------- */
export async function getPositions() {
  const client = await getDeltaClient();
  const res = await client.apis.Positions.getPositions();
  return res?.data?.result || res?.result || res;
}

/* ---------------- WALLET ---------------- */
export async function getWalletBalance() {
  const client = await getDeltaClient();
  const res = await client.apis.Wallet.getBalances();
  const actualData = res?.body?.result || res?.obj?.result || res?.data?.result || res?.result || res;
  
  return actualData;
}

/* ---------------- SET LEVERAGE ---------------- */
export async function setProductLeverage(leverage: number) {
  await initProduct();
  const client = await getDeltaClient();
  const res = await client.apis.Orders.setLeverage({
    product_id: PRODUCT_ID,
    leverage: leverage.toString(),
  });
  return res;
}

/* ---------------- MARKET ORDER ---------------- */
export async function placeMarketOrder(size: number, side: "buy" | "sell") {
  await initProduct();
  const client = await getDeltaClient();

  const res = await client.apis.Orders.placeOrder({
    order: {
      product_id: PRODUCT_ID,
      size,
      side,
      order_type: "market_order",
      time_in_force: "ioc",
    },
  });

  return res;
}

/* ---------------- MARKET ORDER + SL / TP ---------------- */
export async function placeMarketOrderWithBracket(
  size: number,
  side: "buy" | "sell",
  stopLoss: string,
  takeProfit: string
) {
  await initProduct();
  const client = await getDeltaClient();
  const res = await client.apis.Orders.placeOrder({
    order: {
      product_id: PRODUCT_ID,
      size,
      side,
      order_type: "market_order",
      time_in_force: "ioc",
      bracket_stop_loss_price: stopLoss,
      bracket_take_profit_price: takeProfit,
    },
  });
  return res;
}

/* ---------------- ORDER MANAGEMENT ---------------- */
export async function cancelOrder(orderId: string) {
  const client = await getDeltaClient();
  return client.apis.Orders.deleteOrder({ id: orderId });
}

export async function getOrderStatus(orderId: string) {
  const client = await getDeltaClient();
  const res = await client.apis.Orders.getOrder({ id: orderId });
  return res?.data?.result || res?.result || res;
}

/* ---------------- CONNECTION TEST ---------------- */
export async function testConnection() {
  try {
    await initProduct();
    await getWalletBalance();
    console.log("🔥 Delta API Connection OK");
    return true;
  } catch (err: any) {
    console.error("❌ Delta API connection failed:", err.message);
    return false;
  }
}

export const deltaClient = {
  initProduct,
  getOHLCV,
  getProducts,
  getOrderbook,
  getPositions,
  getWalletBalance,
  setProductLeverage,
  placeMarketOrder,
  placeMarketOrderWithBracket,
  cancelOrder,
  getOrderStatus,
  testConnection,
};