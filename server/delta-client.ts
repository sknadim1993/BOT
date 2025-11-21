// delta-client.ts
import axios, { AxiosError } from "axios";
import DeltaRestClient from "delta-rest-client";

const BASE_URL = "https://api.india.delta.exchange";
const SYMBOL = "ETHUSD";
let PRODUCT: any = null; // full product object
let PRODUCT_ID: number | null = null;
let deltaClientInstance: any = null;

// Resolution candidates we will try if the first one fails
const RESOLUTION_CANDIDATES: Record<string, string[]> = {
  "1m": ["1"],
  "5m": ["5"],
  "15m": ["15"],
  "30m": ["30"],
  "1h": ["60"],
  "4h": ["240"],
  "1d": ["1440", "1d"],
};

/**
 * Parse SDK response safely (SDK sometimes returns stringified payloads)
 */
function parseSdkResponse(res: any) {
  if (!res) return res;
  if (res.data === undefined) return res;
  const payload = res.data;
  if (typeof payload === "string") {
    try {
      return JSON.parse(payload);
    } catch {
      return payload;
    }
  }
  return payload;
}

/* ---------------- INIT PRODUCT ---------------- */
export async function initProduct() {
  if (PRODUCT_ID) return PRODUCT_ID;
  const res = await axios.get(`${BASE_URL}/v2/products`);
  const list = res?.data?.result || [];
  const product = list.find((p: any) => p.symbol === SYMBOL);
  if (!product) {
    throw new Error(`Product ${SYMBOL} not found in /v2/products`);
  }
  PRODUCT = product;
  // pick a reasonable id field: prefer contract_id if available, fallback to id/product_id
  PRODUCT_ID = product.contract_id || product.id || product.product_id || null;
  console.log(`[INIT] ETHUSD product loaded. id=${PRODUCT_ID} (fields: ${Object.keys(product).join(",")})`);
  return PRODUCT_ID;
}

/* ---------------- DELTA CLIENT ---------------- */
export async function getDeltaClient() {
  if (!deltaClientInstance) {
    const { DELTA_API_KEY, DELTA_API_SECRET } = process.env;
    if (!DELTA_API_KEY || !DELTA_API_SECRET) throw new Error("Missing Delta API credentials");
    deltaClientInstance = await DeltaRestClient(DELTA_API_KEY, DELTA_API_SECRET);
    await initProduct();
  }
  return deltaClientInstance;
}

/* ---------------- PRODUCTS (helper used by trading-engine) ---------------- */
export async function getProducts() {
  const res = await axios.get(`${BASE_URL}/v2/products`);
  return res.data?.result || [];
}

/* ---------------- OHLCV (robust) ----------------
  - Tries candidate resolution formats (e.g. "1440" then "1d")
  - Tries both 'product_id' and 'contract_id' param names if necessary
  - Returns the first successful response, else throws with detailed messages
*/
export async function getOHLCV(
  timeframe: "5m" | "15m" | "1h" | "1d" | "1m" | "30m" | "4h",
  from: number,
  to: number
) {
  await initProduct();
  if (!PRODUCT_ID) throw new Error("Product ID not available");

  const candidates = RESOLUTION_CANDIDATES[timeframe] || [timeframe];
  const paramNames = ["product_id", "contract_id", "productId", "contractId"];

  const errors: any[] = [];

  for (const candidateRes of candidates) {
    for (const paramName of paramNames) {
      const params: any = {
        resolution: candidateRes,
        start: Math.floor(from),
        end: Math.floor(to),
      };
      params[paramName] = PRODUCT_ID;

      try {
        // debug log (comment out in prod)
        // console.log(`[OHLCV] trying resolution=${candidateRes} param=${paramName} start=${params.start} end=${params.end}`);

        const response = await axios.get(`${BASE_URL}/v2/history/candles`, { params });

        // some endpoints return success:false with error body even with 200 ; treat that as failure
        if (response?.data?.success === false) {
          errors.push({ candidateRes, paramName, body: response.data });
          continue;
        }

        return {
          symbol: SYMBOL,
          timeframe,
          resolutionUsed: candidateRes,
          paramNameUsed: paramName,
          data: response.data?.result || [],
        };
      } catch (err: any) {
        // capture Axios error body if present
        const aerr = err as AxiosError;
        errors.push({
          candidateRes,
          paramName,
          status: aerr?.response?.status,
          body: aerr?.response?.data,
          message: aerr?.message,
        });
        // try next combination
      }
    }
  }

  // nothing worked — throw aggregated error
  const e = new Error("All OHLCV requests failed");
  (e as any).details = errors;
  throw e;
}

/* ---------------- ORDERBOOK ---------------- */
export async function getOrderbook() {
  const client = await getDeltaClient();
  const res = await client.apis.Orderbook.getL2Orderbook({ symbol: SYMBOL });
  const parsed = parseSdkResponse(res);
  return parsed?.result || parsed;
}

/* ---------------- POSITIONS ---------------- */
export async function getPositions() {
  const client = await getDeltaClient();
  const res = await client.apis.Positions.getPositions();
  const parsed = parseSdkResponse(res);
  return parsed?.result || parsed;
}

/* ---------------- WALLET ---------------- */
export async function getWalletBalance() {
  const client = await getDeltaClient();
  const res = await client.apis.Wallet.getBalances();
  const parsed = parseSdkResponse(res);
  return parsed?.result || parsed;
}

/* ---------------- SET LEVERAGE ---------------- */
export async function setProductLeverage(productId: number, leverage: number) {
  const client = await getDeltaClient();
  const res = await client.apis.Orders.setLeverage({
    product_id: productId,
    leverage: leverage.toString(),
  });
  const parsed = parseSdkResponse(res);
  return parsed;
}

/* ---------------- PLACE MARKET ORDER ---------------- */
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
  const parsed = parseSdkResponse(res);
  return parsed;
}

/* ---------------- PLACE MARKET ORDER WITH BRACKET (SL/TP) ---------------- */
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
  const parsed = parseSdkResponse(res);
  return parsed;
}

/* ---------------- CANCEL ORDER ---------------- */
export async function cancelOrder(orderId: string) {
  const client = await getDeltaClient();
  const res = await client.apis.Orders.deleteOrder({ id: orderId });
  const parsed = parseSdkResponse(res);
  return parsed;
}

/* ---------------- GET ORDER STATUS ---------------- */
export async function getOrderStatus(orderId: string) {
  const client = await getDeltaClient();
  const res = await client.apis.Orders.getOrder({ id: orderId });
  const parsed = parseSdkResponse(res);
  return parsed?.result || parsed;
}

/* ---------------- CONNECTION TEST ---------------- */
export async function testConnection() {
  try {
    await initProduct();
    await getWalletBalance();
    console.log("[TEST] Delta API OK");
    return true;
  } catch (err) {
    console.error("[TEST] Delta API failed:", (err as any)?.message || err);
    return false;
  }
}

export const deltaClient = {
  initProduct,
  getDeltaClient,
  getProducts,
  getOHLCV,
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
