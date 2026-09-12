export const VENDOR_BUDGET_IMPACT_PATH = "/vendor-budget-impact";
export const VENDOR_BUDGET_IMPACT_METHOD = "POST";
export const VENDOR_BUDGET_IMPACT_PRODUCT = "samedaydesk-vendor-budget-impact";
export const VENDOR_BUDGET_IMPACT_SCHEMA_VERSION = "samedaydesk.vendor-budget-impact-http.v0";
export const VENDOR_BUDGET_IMPACT_ENGINE_SCHEMA = "samedaydesk.vendor-budget-impact.v1";

export const VENDOR_BUDGET_IMPACT_ENGINE_REPO = "epistemedeus/samedaydesk";
export const VENDOR_BUDGET_IMPACT_ENGINE_SHA = "b23260e6a2b74452075f73da1631da24d8ae6906";
export const VENDOR_BUDGET_IMPACT_ENGINE_PATH = "experiments/s134-record-jobs/modules/pricing-table-change/";
export const VENDOR_BUDGET_IMPACT_CATALOG_SHA = "dacb9950ef3e1ffcf9151c30324fe1f1cb209e19";
export const VENDOR_BUDGET_IMPACT_MAPPING_SHA = "485a5023843f27bb920ad2a26ad0631fa1bbb4bd";
export const VENDOR_BUDGET_IMPACT_ARCHIVE_SHA256 = "2b1949189f0ad2e3c1bd5f7a43f7eda800fd5f0dc3a395415689feee0419ff4f";

export const DEFAULT_VENDOR_BUDGET_IMPACT_PRICE_USD = "$0.005";

export const VENDOR_BUDGET_IMPACT_MAX_REQUEST_BYTES = 64 * 1024;
export const VENDOR_BUDGET_IMPACT_MAX_SNAPSHOT_BYTES = 32 * 1024;
export const VENDOR_BUDGET_IMPACT_MAX_RESPONSE_BYTES = 64 * 1024;
export const VENDOR_BUDGET_IMPACT_MAX_MARKDOWN_BYTES = 16 * 1024;
export const VENDOR_BUDGET_IMPACT_MAX_ROWS = 256;
export const VENDOR_BUDGET_IMPACT_MAX_JSON_DEPTH = 8;
export const VENDOR_BUDGET_IMPACT_MAX_JSON_NODES = 8_000;
export const VENDOR_BUDGET_IMPACT_MAX_STRING_CHARS = 256;
export const VENDOR_BUDGET_IMPACT_TIMEOUT_MS = 5_000;
export const VENDOR_BUDGET_IMPACT_WORKER_KILL_GRACE_MS = 500;
export const VENDOR_BUDGET_IMPACT_MAX_WORKERS = 4;

export const VENDOR_BUDGET_IMPACT_PAYMENT_PROTOCOLS = Object.freeze(["x402"]);

export const VENDOR_BUDGET_IMPACT_DESCRIPTION =
  "Compare two supplied pricing-row JSON objects (field, value, unit). Return field/unit/add/remove deltas; unchanged rows are informational. Raw numeric values must equal their Number canonical decimal value; rounding aliases are refused before payment. No paths, URLs, commands, or writable caches. Charge buys a bounded compare, not a live quote or ROI. x402 only; ordinary buyers use examples/customer-x402.";

export const VENDOR_BUDGET_IMPACT_QUOTE_MEANING =
  "Flat USDC quote for one bounded compare of two caller-supplied pricing-row JSON objects. Default $0.005 matches live GET /extract. Charge is the compare, not a live quote, purchase, or proven margin. Pay with x402; MPP is not accepted on this route. Ordinary buyers inspect and approve through examples/customer-x402, not a precomputed signature.";

/**
 * Explicit production feature flag. Default off. Never inferred from
 * NODE_ENV, Railway environment names, or other ambient guesses.
 */
export function isVendorBudgetImpactEnabled(env = process.env) {
  const raw = String(env.VENDOR_BUDGET_IMPACT_ENABLED || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function isVendorBudgetImpactPath(pathname) {
  const path = String(pathname || "").split("?", 1)[0].toLowerCase().replace(/\/+$/, "");
  return path === VENDOR_BUDGET_IMPACT_PATH;
}

function parsePriceUsd(raw, fallback) {
  const text = String(raw == null || raw === "" ? fallback : raw).trim();
  const match = /^\$?(0|[1-9]\d*)(?:\.(\d{1,6}))?$/.exec(text);
  if (!match) throw new Error("VENDOR_BUDGET_IMPACT_PRICE must be a USDC amount such as $0.005");
  const whole = match[1];
  const fraction = (match[2] || "").padEnd(6, "0");
  const atomic = String(BigInt(whole) * 1_000_000n + BigInt(fraction));
  if (atomic === "0") throw new Error("VENDOR_BUDGET_IMPACT_PRICE must be positive");
  return { priceUsd: text.startsWith("$") ? text : `$${text}`, amountAtomic: atomic };
}

function atomicToDisplay(amount) {
  const atomic = String(amount);
  const padded = atomic.padStart(7, "0");
  const whole = padded.slice(0, -6);
  const fraction = padded.slice(-6).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export function vendorBudgetImpactPrice(env = process.env) {
  const parsed = parsePriceUsd(env.VENDOR_BUDGET_IMPACT_PRICE, DEFAULT_VENDOR_BUDGET_IMPACT_PRICE_USD);
  return Object.freeze({
    priceUsd: parsed.priceUsd,
    amountAtomic: parsed.amountAtomic,
    displayUsdc: atomicToDisplay(parsed.amountAtomic),
  });
}

export const VENDOR_BUDGET_IMPACT_PRICE = isVendorBudgetImpactEnabled()
  ? vendorBudgetImpactPrice()
  : Object.freeze({ priceUsd: "$0.005", amountAtomic: "5000", displayUsdc: "0.005" });
export const VENDOR_BUDGET_IMPACT_PRICE_USD = VENDOR_BUDGET_IMPACT_PRICE.priceUsd;
export const VENDOR_BUDGET_IMPACT_AMOUNT_ATOMIC = VENDOR_BUDGET_IMPACT_PRICE.amountAtomic;
export const VENDOR_BUDGET_IMPACT_PRICE_DISPLAY = VENDOR_BUDGET_IMPACT_PRICE.displayUsdc;

function boundedCeiling(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > fallback) {
    throw new Error(`${name} must be an integer from 1 through ${fallback}`);
  }
  return value;
}

export function vendorBudgetImpactLimits(env = process.env) {
  return Object.freeze({
    maxRequestBytes: boundedCeiling(env, "VENDOR_BUDGET_IMPACT_MAX_REQUEST_BYTES", VENDOR_BUDGET_IMPACT_MAX_REQUEST_BYTES),
    maxSnapshotBytes: boundedCeiling(env, "VENDOR_BUDGET_IMPACT_MAX_SNAPSHOT_BYTES", VENDOR_BUDGET_IMPACT_MAX_SNAPSHOT_BYTES),
    maxResponseBytes: boundedCeiling(env, "VENDOR_BUDGET_IMPACT_MAX_RESPONSE_BYTES", VENDOR_BUDGET_IMPACT_MAX_RESPONSE_BYTES),
    maxMarkdownBytes: boundedCeiling(env, "VENDOR_BUDGET_IMPACT_MAX_MARKDOWN_BYTES", VENDOR_BUDGET_IMPACT_MAX_MARKDOWN_BYTES),
    maxRows: boundedCeiling(env, "VENDOR_BUDGET_IMPACT_MAX_ROWS", VENDOR_BUDGET_IMPACT_MAX_ROWS),
    maxJsonDepth: boundedCeiling(env, "VENDOR_BUDGET_IMPACT_MAX_JSON_DEPTH", VENDOR_BUDGET_IMPACT_MAX_JSON_DEPTH),
    maxJsonNodes: boundedCeiling(env, "VENDOR_BUDGET_IMPACT_MAX_JSON_NODES", VENDOR_BUDGET_IMPACT_MAX_JSON_NODES),
    maxStringChars: boundedCeiling(env, "VENDOR_BUDGET_IMPACT_MAX_STRING_CHARS", VENDOR_BUDGET_IMPACT_MAX_STRING_CHARS),
    timeoutMs: boundedCeiling(env, "VENDOR_BUDGET_IMPACT_TIMEOUT_MS", VENDOR_BUDGET_IMPACT_TIMEOUT_MS),
    maxWorkers: boundedCeiling(env, "VENDOR_BUDGET_IMPACT_MAX_WORKERS", VENDOR_BUDGET_IMPACT_MAX_WORKERS),
  });
}

export function vendorBudgetImpactCostParameters(env = process.env) {
  const limits = vendorBudgetImpactLimits(env);
  if (
    env.IDEMPOTENCY_MAX_RESPONSE_BYTES !== undefined
    && Number(env.IDEMPOTENCY_MAX_RESPONSE_BYTES) < limits.maxResponseBytes
  ) {
    throw new Error(`vendor-budget-impact requires replay response capacity of at least ${limits.maxResponseBytes} bytes`);
  }
  vendorBudgetImpactPrice(env);
  return limits;
}
