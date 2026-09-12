/** SameDayDesk offer defaults; validate current live terms before authorization. */
export const LIVE_ORIGIN = "https://agents.samedaydesk.com";
export const LIVE_EXTRACT_PATH = "/extract";
export const LIVE_EXTRACT_BATCH_PATH = "/extract/batch";
export const LIVE_EXAMPLE_TARGET = "https://example.com";
export const LIVE_EXTRACT_URL =
  `${LIVE_ORIGIN}${LIVE_EXTRACT_PATH}?url=${encodeURIComponent(LIVE_EXAMPLE_TARGET)}`;
export const LIVE_EXTRACT_BATCH_URL = `${LIVE_ORIGIN}${LIVE_EXTRACT_BATCH_PATH}`;
export const LIVE_LOCKFILE_PATH = "/lockfile-pin-delta";
export const LIVE_LOCKFILE_URL = `${LIVE_ORIGIN}${LIVE_LOCKFILE_PATH}`;
export const LIVE_VENDOR_BUDGET_PATH = "/vendor-budget-impact";
export const LIVE_VENDOR_BUDGET_URL = `${LIVE_ORIGIN}${LIVE_VENDOR_BUDGET_PATH}`;

export const LIVE_NETWORK = "eip155:8453";
export const LIVE_ASSET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const LIVE_RECIPIENT = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
export const LIVE_AMOUNT_ATOMIC = "5000";
export const LIVE_BATCH_AMOUNT_ATOMIC = "10000";
export const LIVE_LOCKFILE_AMOUNT_ATOMIC = "5000";
export const LIVE_VENDOR_BUDGET_AMOUNT_ATOMIC = "5000";
export const LIVE_METHOD = "GET";
export const LIVE_BATCH_METHOD = "POST";
export const LIVE_LOCKFILE_METHOD = "POST";
export const LIVE_VENDOR_BUDGET_METHOD = "POST";

export const LIVE_BATCH_PRODUCT = "samedaydesk-extract-batch";
export const LIVE_BATCH_SCHEMA_VERSION = "samedaydesk.extract-batch.v0";

/** Default fixture URLs for credential-free batch preflight (fictional/public). */
export const DEFAULT_BATCH_URLS = Object.freeze([
  "https://example.com/",
  "https://example.org/",
]);

export const DEFAULT_BATCH_FIELDS = Object.freeze(["title", "description", "headings"]);

/**
 * Separately authorized future live-trial targets only. Not invoked by default
 * commands or tests in this assignment.
 */
export const OWNED_HOMEPAGE_BATCH_URLS = Object.freeze([
  "https://samedaydesk.com/",
  "https://ein.llc/",
  "https://neomorphic.io/",
]);

/** Buyer-required extract fields. Presence alone does not prove semantic quality. */
export const DEFAULT_REQUIRED_OUTPUT = Object.freeze({
  mediaType: "application/json",
  requiredFields: Object.freeze([
    "ok",
    "url",
    "title",
    "text",
    "fetchedAt",
    "aiReadiness.hasTitle",
  ]),
  maxResponseBytes: 500_000,
});

export const DEFAULT_BATCH_REQUIRED_OUTPUT = Object.freeze({
  mediaType: "application/json",
  requiredFields: Object.freeze([
    "ok",
    "product",
    "schemaVersion",
    "jobId",
    "jobStatus",
    "partial",
    "sources",
    "charged",
    "boundary",
    "quote.amountAtomic",
  ]),
  maxResponseBytes: 128 * 1024,
});

export const DEFAULT_LOCKFILE_REQUIRED_OUTPUT = Object.freeze({
  mediaType: "application/json",
  requiredFields: Object.freeze([
    "ok",
    "product",
    "schemaVersion",
    "charged",
    "analysis",
    "quote.amountAtomic",
  ]),
  maxResponseBytes: 160 * 1024,
});

export const DEFAULT_VENDOR_BUDGET_REQUIRED_OUTPUT = Object.freeze({
  mediaType: "application/json",
  requiredFields: Object.freeze([
    "ok",
    "product",
    "schemaVersion",
    "charged",
    "analysis",
    "quote.amountAtomic",
  ]),
  maxResponseBytes: 64 * 1024,
});

export const DEFAULT_AUTHORIZATION = Object.freeze({
  method: LIVE_METHOD,
  url: LIVE_EXTRACT_URL,
  network: LIVE_NETWORK,
  asset: LIVE_ASSET,
  recipient: LIVE_RECIPIENT,
  amountCapAtomic: LIVE_AMOUNT_ATOMIC,
  assetName: "USD Coin",
  assetVersion: "2",
  maxTimeoutSeconds: 300,
  requiredOutput: DEFAULT_REQUIRED_OUTPUT,
});

export const DEFAULT_BATCH_BODY = Object.freeze({
  urls: DEFAULT_BATCH_URLS,
  fields: DEFAULT_BATCH_FIELDS,
});

export const DEFAULT_BATCH_AUTHORIZATION = Object.freeze({
  method: LIVE_BATCH_METHOD,
  url: LIVE_EXTRACT_BATCH_URL,
  network: LIVE_NETWORK,
  asset: LIVE_ASSET,
  recipient: LIVE_RECIPIENT,
  amountCapAtomic: LIVE_BATCH_AMOUNT_ATOMIC,
  assetName: "USD Coin",
  assetVersion: "2",
  maxTimeoutSeconds: 300,
  body: DEFAULT_BATCH_BODY,
  requiredOutput: DEFAULT_BATCH_REQUIRED_OUTPUT,
});

/** Template only. Inspect live 402 terms before --approve. Not a default command. */
export const DEFAULT_LOCKFILE_AUTHORIZATION = Object.freeze({
  method: LIVE_LOCKFILE_METHOD,
  url: LIVE_LOCKFILE_URL,
  network: LIVE_NETWORK,
  asset: LIVE_ASSET,
  recipient: LIVE_RECIPIENT,
  amountCapAtomic: LIVE_LOCKFILE_AMOUNT_ATOMIC,
  assetName: "USD Coin",
  assetVersion: "2",
  maxTimeoutSeconds: 300,
  requiredOutput: DEFAULT_LOCKFILE_REQUIRED_OUTPUT,
});

/** Template only. Inspect unpaid 402 terms before --approve. Not a default command. */
export const DEFAULT_VENDOR_BUDGET_AUTHORIZATION = Object.freeze({
  method: LIVE_VENDOR_BUDGET_METHOD,
  url: LIVE_VENDOR_BUDGET_URL,
  network: LIVE_NETWORK,
  asset: LIVE_ASSET,
  recipient: LIVE_RECIPIENT,
  amountCapAtomic: LIVE_VENDOR_BUDGET_AMOUNT_ATOMIC,
  assetName: "USD Coin",
  assetVersion: "2",
  maxTimeoutSeconds: 300,
  requiredOutput: DEFAULT_VENDOR_BUDGET_REQUIRED_OUTPUT,
});

export const OUTCOMES = Object.freeze({
  PREFLIGHT_OK: "preflight_ok",
  AUTHORIZATION_REFUSED: "authorization_refused",
  VALID_DELIVERED: "valid_delivered",
  USEFUL_DELIVERED: "useful_delivered",
  PARTIAL_DELIVERED: "partial_delivered",
  PAID_INVALID_OUTPUT: "paid_invalid_output",
  SETTLEMENT_FAILED: "settlement_failed",
  UNKNOWN: "unknown",
});
