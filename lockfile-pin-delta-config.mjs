export const LOCKFILE_PIN_DELTA_PATH = "/lockfile-pin-delta";
export const LOCKFILE_PIN_DELTA_METHOD = "POST";
export const LOCKFILE_PIN_DELTA_PRODUCT = "samedaydesk-lockfile-pin-delta";
export const LOCKFILE_PIN_DELTA_SCHEMA_VERSION = "samedaydesk.lockfile-pin-delta-http.v0";
export const LOCKFILE_PIN_DELTA_ENGINE_SCHEMA = "samedaydesk.lockfile-pin-delta.v1";

export const LOCKFILE_PIN_DELTA_ENGINE_REPO = "epistemedeus/samedaydesk";
export const LOCKFILE_PIN_DELTA_ENGINE_SHA = "fba9d14872bc4c04214e527b9edfb30c2123c9e7";
export const LOCKFILE_PIN_DELTA_ENGINE_PATH = "tools/lockfile-pin-delta/";
export const LOCKFILE_PIN_DELTA_CATALOG_SHA = "a20232b0f777b0f737cdffefb64a9ca9d9c9ba0e";

export const DEFAULT_LOCKFILE_PIN_DELTA_PRICE_USD = "$0.005";

export const LOCKFILE_PIN_DELTA_MAX_REQUEST_BYTES = 256 * 1024;
export const LOCKFILE_PIN_DELTA_MAX_LOCKFILE_BYTES = 128 * 1024;
export const LOCKFILE_PIN_DELTA_MAX_RESPONSE_BYTES = 160 * 1024;
export const LOCKFILE_PIN_DELTA_MAX_MARKDOWN_BYTES = 24 * 1024;
export const LOCKFILE_PIN_DELTA_MAX_PINS = 8_000;
export const LOCKFILE_PIN_DELTA_MAX_JSON_DEPTH = 32;
export const LOCKFILE_PIN_DELTA_MAX_JSON_NODES = 50_000;
export const LOCKFILE_PIN_DELTA_TIMEOUT_MS = 5_000;
export const LOCKFILE_PIN_DELTA_WORKER_KILL_GRACE_MS = 500;

export const LOCKFILE_PIN_DELTA_DESCRIPTION =
  "Compare two caller-supplied npm package-lock.json objects (lockfileVersion 2 or 3) and return added, removed, and changed name+version+integrity+resolved pins. HTTP JSON only: no filesystem paths, commands, or network fetch. Identical pins are informational, not failure. Charge is the bounded compare, not an install, audit, or purchase.";

export const LOCKFILE_PIN_DELTA_QUOTE_MEANING =
  "Flat USDC quote for one bounded compare of two caller-supplied npm package-lock.json objects. Default $0.005 matches live GET /extract. Charge is the compare, not an install, audit, or proven margin.";

/**
 * Explicit production feature flag. Default off. Never inferred from
 * NODE_ENV, Railway environment names, or other ambient guesses.
 */
export function isLockfilePinDeltaEnabled(env = process.env) {
  const raw = String(env.LOCKFILE_PIN_DELTA_ENABLED || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function isLockfilePinDeltaPath(pathname) {
  const path = String(pathname || "").split("?", 1)[0].toLowerCase().replace(/\/+$/, "");
  return path === LOCKFILE_PIN_DELTA_PATH;
}

function parsePriceUsd(raw, fallback) {
  const text = String(raw == null || raw === "" ? fallback : raw).trim();
  const match = /^\$?(0|[1-9]\d*)(?:\.(\d{1,6}))?$/.exec(text);
  if (!match) throw new Error("LOCKFILE_PIN_DELTA_PRICE must be a USDC amount such as $0.005");
  const whole = match[1];
  const fraction = (match[2] || "").padEnd(6, "0");
  const atomic = String(BigInt(whole) * 1_000_000n + BigInt(fraction));
  if (atomic === "0") throw new Error("LOCKFILE_PIN_DELTA_PRICE must be positive");
  return { priceUsd: text.startsWith("$") ? text : `$${text}`, amountAtomic: atomic };
}

function atomicToDisplay(amount) {
  const atomic = String(amount);
  const padded = atomic.padStart(7, "0");
  const whole = padded.slice(0, -6);
  const fraction = padded.slice(-6).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export function lockfilePinDeltaPrice(env = process.env) {
  const parsed = parsePriceUsd(env.LOCKFILE_PIN_DELTA_PRICE, DEFAULT_LOCKFILE_PIN_DELTA_PRICE_USD);
  return Object.freeze({
    priceUsd: parsed.priceUsd,
    amountAtomic: parsed.amountAtomic,
    displayUsdc: atomicToDisplay(parsed.amountAtomic),
  });
}

export const LOCKFILE_PIN_DELTA_PRICE = lockfilePinDeltaPrice();
export const LOCKFILE_PIN_DELTA_PRICE_USD = LOCKFILE_PIN_DELTA_PRICE.priceUsd;
export const LOCKFILE_PIN_DELTA_AMOUNT_ATOMIC = LOCKFILE_PIN_DELTA_PRICE.amountAtomic;
export const LOCKFILE_PIN_DELTA_PRICE_DISPLAY = LOCKFILE_PIN_DELTA_PRICE.displayUsdc;

function boundedCeiling(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > fallback) {
    throw new Error(`${name} must be an integer from 1 through ${fallback}`);
  }
  return value;
}

export function lockfilePinDeltaLimits(env = process.env) {
  return Object.freeze({
    maxRequestBytes: boundedCeiling(env, "LOCKFILE_PIN_DELTA_MAX_REQUEST_BYTES", LOCKFILE_PIN_DELTA_MAX_REQUEST_BYTES),
    maxLockfileBytes: boundedCeiling(env, "LOCKFILE_PIN_DELTA_MAX_LOCKFILE_BYTES", LOCKFILE_PIN_DELTA_MAX_LOCKFILE_BYTES),
    maxResponseBytes: boundedCeiling(env, "LOCKFILE_PIN_DELTA_MAX_RESPONSE_BYTES", LOCKFILE_PIN_DELTA_MAX_RESPONSE_BYTES),
    maxMarkdownBytes: boundedCeiling(env, "LOCKFILE_PIN_DELTA_MAX_MARKDOWN_BYTES", LOCKFILE_PIN_DELTA_MAX_MARKDOWN_BYTES),
    maxPins: boundedCeiling(env, "LOCKFILE_PIN_DELTA_MAX_PINS", LOCKFILE_PIN_DELTA_MAX_PINS),
    maxJsonDepth: boundedCeiling(env, "LOCKFILE_PIN_DELTA_MAX_JSON_DEPTH", LOCKFILE_PIN_DELTA_MAX_JSON_DEPTH),
    maxJsonNodes: boundedCeiling(env, "LOCKFILE_PIN_DELTA_MAX_JSON_NODES", LOCKFILE_PIN_DELTA_MAX_JSON_NODES),
    timeoutMs: boundedCeiling(env, "LOCKFILE_PIN_DELTA_TIMEOUT_MS", LOCKFILE_PIN_DELTA_TIMEOUT_MS),
  });
}

export function lockfilePinDeltaCostParameters(env = process.env) {
  const limits = lockfilePinDeltaLimits(env);
  if (
    env.IDEMPOTENCY_MAX_RESPONSE_BYTES !== undefined
    && Number(env.IDEMPOTENCY_MAX_RESPONSE_BYTES) < limits.maxResponseBytes
  ) {
    throw new Error(`lockfile pin-delta requires replay response capacity of at least ${limits.maxResponseBytes} bytes`);
  }
  lockfilePinDeltaPrice(env);
  return limits;
}
