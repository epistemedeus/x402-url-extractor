export const EXTRACT_BATCH_PATH = "/extract/batch";
export const EXTRACT_BATCH_METHOD = "POST";
export const EXTRACT_BATCH_AMOUNT_ATOMIC = "10000";
export const EXTRACT_BATCH_PRICE_USD = "$0.01";
export const EXTRACT_BATCH_PRICE_DISPLAY = "0.01";
export const EXTRACT_BATCH_PRODUCT = "samedaydesk-extract-batch";
export const EXTRACT_BATCH_SCHEMA_VERSION = "samedaydesk.extract-batch.v0";
export const EXTRACT_BATCH_MAX_URLS = 5;
export const EXTRACT_BATCH_MAX_URL_LENGTH = 2048;
export const EXTRACT_BATCH_MAX_RESPONSE_BYTES = 128 * 1024;
export const EXTRACT_BATCH_MAX_REQUEST_JSON_BYTES = 16 * 1024;

export const EXTRACT_BATCH_DESCRIPTION =
  "Batch extract one to five public HTTPS URLs into bounded structured fields. One flat 0.01 USDC (10000 atomic Base USDC) quote buys a bounded attempt with hard request, byte, and wall-time ceilings. Charge is for the attempt, not a guarantee that every URL succeeds.";

export const EXTRACT_BATCH_QUOTE_MEANING =
  "Introductory flat 0.01 USDC batch quote for a bounded 1-5 URL attempt. Not a per-URL success promise.";

export const DEFAULT_EXTRACT_BATCH_COST = Object.freeze({
  maxRequests: 16,
  maxBytesTotal: 1_500_000,
  maxWallTimeMs: 15_000,
  maxRetriesPerItem: 0,
  maxBytesPerItem: 400_000,
  timeoutMs: 5_000,
  maxRedirects: 3,
});

/**
 * Explicit production feature flag. Default off. Never inferred from
 * NODE_ENV, Railway environment names, or other ambient guesses.
 */
export function isExtractBatchEnabled(env = process.env) {
  const raw = String(env.EXTRACT_BATCH_ENABLED || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function boundedCeiling(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > fallback) {
    throw new Error(`${name} must be an integer from 1 through ${fallback}`);
  }
  return value;
}

export function extractBatchCostParameters(env = process.env) {
  if (env.IDEMPOTENCY_MAX_RESPONSE_BYTES !== undefined && Number(env.IDEMPOTENCY_MAX_RESPONSE_BYTES) < EXTRACT_BATCH_MAX_RESPONSE_BYTES) {
    throw new Error("extract batch requires replay response capacity of at least 131072 bytes");
  }
  return {
    maxRequests: boundedCeiling(env, "EXTRACT_BATCH_MAX_REQUESTS", DEFAULT_EXTRACT_BATCH_COST.maxRequests),
    maxBytesTotal: boundedCeiling(env, "EXTRACT_BATCH_MAX_BYTES_TOTAL", DEFAULT_EXTRACT_BATCH_COST.maxBytesTotal),
    maxWallTimeMs: boundedCeiling(env, "EXTRACT_BATCH_MAX_WALL_MS", DEFAULT_EXTRACT_BATCH_COST.maxWallTimeMs),
    maxRetriesPerItem: 0,
    maxBytesPerItem: boundedCeiling(env, "EXTRACT_BATCH_MAX_BYTES_PER_ITEM", DEFAULT_EXTRACT_BATCH_COST.maxBytesPerItem),
    timeoutMs: boundedCeiling(env, "EXTRACT_BATCH_TIMEOUT_MS", DEFAULT_EXTRACT_BATCH_COST.timeoutMs),
    maxRedirects: boundedCeiling(env, "EXTRACT_BATCH_MAX_REDIRECTS", DEFAULT_EXTRACT_BATCH_COST.maxRedirects),
  };
}
