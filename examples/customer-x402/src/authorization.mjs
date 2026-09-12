import { parseLosslessNumericJson } from "./numeric-json.mjs";
import { getAddress } from "viem";

import {
  admitExtractBatchBody,
  admitPublicHttpOrHttpsUrl,
  assertExactBodyBytes,
  BatchAdmissionError,
  bodyDigestFor,
} from "./batch-admission.mjs";
import {
  DEFAULT_BATCH_REQUIRED_OUTPUT,
  DEFAULT_LOCKFILE_REQUIRED_OUTPUT,
  DEFAULT_REQUIRED_OUTPUT,
  DEFAULT_VENDOR_BUDGET_REQUIRED_OUTPUT,
  LIVE_BATCH_METHOD,
  LIVE_LOCKFILE_METHOD,
  LIVE_METHOD,
  LIVE_VENDOR_BUDGET_METHOD,
} from "./constants.mjs";

export class AuthorizationRefusal extends Error {
  constructor(message, { field = null } = {}) {
    super(message);
    this.name = "AuthorizationRefusal";
    this.code = "authorization_refused";
    this.field = field;
  }
}

function fail(message, field = null) {
  throw new AuthorizationRefusal(message, { field });
}

function normalizeHttpsUrl(raw, label) {
  let url;
  try {
    url = new URL(String(raw || ""));
  } catch {
    fail(`${label} must be an absolute HTTPS URL`, label);
  }
  if (url.protocol !== "https:") fail(`${label} must use HTTPS`, label);
  if (url.protocol === "mcp:" || String(raw).startsWith("mcp://")) {
    fail(`${label} must not use mcp://`, label);
  }
  if (url.username || url.password) fail(`${label} must not contain credentials`, label);
  if (url.hash) fail(`${label} must not contain a fragment`, label);
  return url;
}

function normalizeAddress(value, label) {
  try {
    return getAddress(String(value || ""));
  } catch {
    fail(`${label} must be a checksummable EVM address`, label);
  }
}

function normalizeAtomic(value, label) {
  const raw = String(value ?? "").trim();
  if (!/^\d+$/.test(raw)) fail(`${label} must be a non-negative integer string`, label);
  return BigInt(raw);
}

function normalizeRequiredOutput(requiredOutput, { batch }) {
  if (!requiredOutput || typeof requiredOutput !== "object") fail("requiredOutput is required", "requiredOutput");
  if (requiredOutput.mediaType !== "application/json") {
    fail("requiredOutput.mediaType must be application/json", "requiredOutput");
  }
  if (!Array.isArray(requiredOutput.requiredFields) || !requiredOutput.requiredFields.length) {
    fail("requiredOutput.requiredFields must be a non-empty array", "requiredOutput");
  }
  if (requiredOutput.requiredFields.some(field => typeof field !== "string" ||
      !/^[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*$/.test(field))) {
    fail("requiredFields must contain non-empty dotted field names", "requiredOutput");
  }
  const maxResponseBytes = requiredOutput.maxResponseBytes ?? (batch ? 128_000 : 500_000);
  const ceiling = batch ? 128 * 1024 : 1_000_000;
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > ceiling) {
    fail(`maxResponseBytes must be an integer from 1 to ${ceiling}`, "requiredOutput");
  }
  return Object.freeze({
    mediaType: "application/json",
    requiredFields: Object.freeze([...requiredOutput.requiredFields].map(String)),
    maxResponseBytes,
  });
}

function normalizeGetAuthorization(input) {
  const method = String(input.method || LIVE_METHOD).toUpperCase();
  if (method !== "GET") fail("authorization method must be GET", "method");
  if (input.body !== undefined && input.body !== null) {
    fail("authorization for GET /extract must not include a body", "body");
  }
  const url = normalizeHttpsUrl(input.url, "url");
  if (url.pathname !== "/extract") fail("authorization path must be /extract", "url");
  const targets = url.searchParams.getAll("url");
  if (targets.length !== 1 || !targets[0]) fail("authorization query must include url=", "url");
  try {
    admitPublicHttpOrHttpsUrl(targets[0], { field: "url", httpsOnly: false });
  } catch (error) {
    if (error instanceof BatchAdmissionError) fail(error.message, "url");
    throw error;
  }
  return {
    method,
    url: url.toString(),
    origin: url.origin,
    path: url.pathname,
    query: url.search,
    bodyRaw: null,
    bodyDigest: null,
    bodyBytes: 0,
    batch: null,
    requiredOutput: normalizeRequiredOutput(input.requiredOutput || DEFAULT_REQUIRED_OUTPUT, { batch: false }),
  };
}

function normalizePostBatchAuthorization(input) {
  const method = String(input.method || LIVE_BATCH_METHOD).toUpperCase();
  if (method !== "POST") fail("batch authorization method must be POST", "method");
  const url = normalizeHttpsUrl(input.url, "url");
  if (url.pathname !== "/extract/batch") fail("authorization path must be /extract/batch", "url");
  if (url.search) fail("batch authorization URL must not include a query string", "url");
  let admitted;
  try {
    if (typeof input.bodyRaw === "string") {
      if (Buffer.byteLength(input.bodyRaw) > 16 * 1024) fail("bodyRaw exceeds request byte ceiling", "body");
      let parsed;
      try {
        parsed = JSON.parse(input.bodyRaw);
      } catch {
        fail("bodyRaw must be valid JSON", "body");
      }
      admitted = admitExtractBatchBody(parsed);
      if (admitted.bodyRaw !== input.bodyRaw) {
        fail("bodyRaw must already be the exact admitted serialized bytes", "body");
      }
      if (input.body !== undefined && admitExtractBatchBody(input.body).bodyRaw !== admitted.bodyRaw) {
        fail("body does not match authorized bodyRaw", "body");
      }
    } else {
      admitted = admitExtractBatchBody(input.body);
    }
    if (input.bodyDigest !== undefined && input.bodyDigest !== admitted.bodyDigest) {
      fail("body digest drifted after approval", "body");
    }
  } catch (error) {
    if (error instanceof BatchAdmissionError || error instanceof AuthorizationRefusal) {
      fail(error.message, error.field || "body");
    }
    throw error;
  }
  return {
    method,
    url: url.toString(),
    origin: url.origin,
    path: url.pathname,
    query: "",
    bodyRaw: admitted.bodyRaw,
    bodyDigest: admitted.bodyDigest,
    bodyBytes: admitted.bodyBytes,
    batch: Object.freeze({
      urls: admitted.urls,
      fields: admitted.fields,
    }),
    requiredOutput: normalizeRequiredOutput(
      input.requiredOutput || DEFAULT_BATCH_REQUIRED_OUTPUT,
      { batch: true },
    ),
  };
}

const LOCKFILE_MAX_REQUEST_JSON_BYTES = 256 * 1024;
const LOCKFILE_ALLOWED_BODY_KEYS = Object.freeze(["before", "after"]);

function admitLockfilePair(value, label) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be a JSON object (not a path or string)`, label);
  }
  return value;
}

function admitLockfileBody(input) {
  let bodyRaw;
  let parsed;
  if (typeof input.bodyRaw === "string") {
    if (Buffer.byteLength(input.bodyRaw) > LOCKFILE_MAX_REQUEST_JSON_BYTES) {
      fail("bodyRaw exceeds request byte ceiling", "body");
    }
    try {
      parsed = JSON.parse(input.bodyRaw);
    } catch {
      fail("bodyRaw must be valid JSON", "body");
    }
    bodyRaw = input.bodyRaw;
    if (input.body !== undefined) {
      const fromBody = JSON.stringify({ before: input.body.before, after: input.body.after });
      if (fromBody !== bodyRaw) fail("body does not match authorized bodyRaw", "body");
    }
  } else if (input.body && typeof input.body === "object" && !Array.isArray(input.body)) {
    parsed = input.body;
    bodyRaw = JSON.stringify({ before: parsed.before, after: parsed.after });
    if (Buffer.byteLength(bodyRaw) > LOCKFILE_MAX_REQUEST_JSON_BYTES) {
      fail("lockfile body exceeds request byte ceiling", "body");
    }
  } else {
    fail("lockfile authorization requires body {before, after} or bodyRaw", "body");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail("body must be a JSON object", "body");
  }
  const extra = Object.keys(parsed).filter((key) => !LOCKFILE_ALLOWED_BODY_KEYS.includes(key));
  if (extra.length) fail(`unexpected field: ${extra[0]}`, extra[0]);
  admitLockfilePair(parsed.before, "before");
  admitLockfilePair(parsed.after, "after");
  const digest = bodyDigestFor(bodyRaw);
  if (input.bodyDigest !== undefined && input.bodyDigest !== digest) {
    fail("body digest drifted after approval", "body");
  }
  return Object.freeze({
    bodyRaw,
    bodyDigest: digest,
    bodyBytes: Buffer.byteLength(bodyRaw),
  });
}

function normalizePostLockfileAuthorization(input) {
  const method = String(input.method || LIVE_LOCKFILE_METHOD).toUpperCase();
  if (method !== "POST") fail("lockfile authorization method must be POST", "method");
  const url = normalizeHttpsUrl(input.url, "url");
  if (url.pathname !== "/lockfile-pin-delta") fail("authorization path must be /lockfile-pin-delta", "url");
  if (url.search) fail("lockfile authorization URL must not include a query string", "url");
  const admitted = admitLockfileBody(input);
  return {
    method,
    url: url.toString(),
    origin: url.origin,
    path: url.pathname,
    query: "",
    bodyRaw: admitted.bodyRaw,
    bodyDigest: admitted.bodyDigest,
    bodyBytes: admitted.bodyBytes,
    batch: null,
    lockfile: true,
    requiredOutput: normalizeRequiredOutput(
      input.requiredOutput || DEFAULT_LOCKFILE_REQUIRED_OUTPUT,
      { batch: false },
    ),
  };
}

const VENDOR_BUDGET_MAX_REQUEST_JSON_BYTES = 64 * 1024;
const VENDOR_BUDGET_ALLOWED_BODY_KEYS = Object.freeze(["before", "after"]);
const VENDOR_BUDGET_ALLOWED_SNAPSHOT_KEYS = Object.freeze(["rows", "label", "note"]);
const VENDOR_BUDGET_ALLOWED_ROW_KEYS = Object.freeze(["field", "value", "unit"]);

function admitVendorBudgetSnapshot(value, label) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be a JSON object with a rows array (not a path or string)`, label);
  }
  const extra = Object.keys(value).filter((key) => !VENDOR_BUDGET_ALLOWED_SNAPSHOT_KEYS.includes(key));
  if (extra.length) fail(`${label} unexpected field: ${extra[0]}`, label);
  if (!Array.isArray(value.rows) || value.rows.length === 0) {
    fail(`${label} must include a non-empty rows array`, label);
  }
  if (value.rows.length > 256) fail(`${label} exceeds 256 rows`, label);
  if (Buffer.byteLength(JSON.stringify(value) + "\n") > 32 * 1024) fail(`${label} exceeds snapshot byte ceiling`, label);
  for (const key of ["label", "note"]) {
    if (value[key] !== undefined && (typeof value[key] !== "string" || value[key].length > 256)) {
      fail(`${label}.${key} must be a string of at most 256 characters`, label);
    }
  }
  if (value.label?.trim().toUpperCase() === "SAMPLE") fail("SAMPLE snapshot is not customer pricing", label);
  value.rows.forEach((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      fail(`${label} row ${index} must be an object`, label);
    }
    const rowExtra = Object.keys(row).filter((key) => !VENDOR_BUDGET_ALLOWED_ROW_KEYS.includes(key));
    if (rowExtra.length) fail(`${label} row ${index} unexpected field: ${rowExtra[0]}`, label);
    if (typeof row.field !== "string" || !row.field.trim()) {
      fail(`${label} row ${index} field must be a non-empty string`, label);
    }
    if (typeof row.value !== "number" || !Number.isFinite(row.value)) {
      fail(`${label} row ${index} value must be a finite number`, label);
    }
    if (typeof row.unit !== "string" || !row.unit.trim()) {
      fail(`${label} row ${index} unit must be a non-empty string`, label);
    }
    if (row.field.length > 256 || row.unit.length > 256) fail(`${label} row ${index} field/unit exceeds 256 characters`, label);
  });
  return value;
}

export function admitVendorBudgetBody(input) {
  let bodyRaw;
  let parsed;
  if (typeof input.bodyRaw === "string") {
    if (Buffer.byteLength(input.bodyRaw) > VENDOR_BUDGET_MAX_REQUEST_JSON_BYTES) {
      fail("bodyRaw exceeds request byte ceiling", "body");
    }
    try {
      parsed = parseLosslessNumericJson(input.bodyRaw);
    } catch {
      fail("bodyRaw must be valid JSON", "body");
    }
    bodyRaw = input.bodyRaw;
    if (input.body !== undefined) {
      const fromBody = JSON.stringify({ before: input.body.before, after: input.body.after });
      if (fromBody !== bodyRaw) fail("body does not match authorized bodyRaw", "body");
    }
  } else if (input.body && typeof input.body === "object" && !Array.isArray(input.body)) {
    parsed = input.body;
    bodyRaw = JSON.stringify({ before: parsed.before, after: parsed.after });
    if (Buffer.byteLength(bodyRaw) > VENDOR_BUDGET_MAX_REQUEST_JSON_BYTES) {
      fail("vendor-budget body exceeds request byte ceiling", "body");
    }
  } else {
    fail("vendor-budget authorization requires body {before, after} or bodyRaw", "body");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail("body must be a JSON object", "body");
  }
  const extra = Object.keys(parsed).filter((key) => !VENDOR_BUDGET_ALLOWED_BODY_KEYS.includes(key));
  if (extra.length) fail(`unexpected field: ${extra[0]}`, extra[0]);
  admitVendorBudgetSnapshot(parsed.before, "before");
  admitVendorBudgetSnapshot(parsed.after, "after");
  const digest = bodyDigestFor(bodyRaw);
  if (input.bodyDigest !== undefined && input.bodyDigest !== digest) {
    fail("body digest drifted after approval", "body");
  }
  return Object.freeze({
    bodyRaw,
    bodyDigest: digest,
    bodyBytes: Buffer.byteLength(bodyRaw),
  });
}

function normalizePostVendorBudgetAuthorization(input) {
  const method = String(input.method || LIVE_VENDOR_BUDGET_METHOD).toUpperCase();
  if (method !== "POST") fail("vendor-budget authorization method must be POST", "method");
  const url = normalizeHttpsUrl(input.url, "url");
  if (url.pathname !== "/vendor-budget-impact") fail("authorization path must be /vendor-budget-impact", "url");
  if (url.search) fail("vendor-budget authorization URL must not include a query string", "url");
  const admitted = admitVendorBudgetBody(input);
  return {
    method,
    url: url.toString(),
    origin: url.origin,
    path: url.pathname,
    query: "",
    bodyRaw: admitted.bodyRaw,
    bodyDigest: admitted.bodyDigest,
    bodyBytes: admitted.bodyBytes,
    batch: null,
    vendorBudget: true,
    requiredOutput: normalizeRequiredOutput(
      input.requiredOutput || DEFAULT_VENDOR_BUDGET_REQUIRED_OUTPUT,
      { batch: false },
    ),
  };
}

function postRouteFor(input) {
  let preview;
  try {
    preview = new URL(String(input.url || ""));
  } catch {
    fail("url must be an absolute HTTPS URL", "url");
  }
  if (preview.pathname === "/vendor-budget-impact") return normalizePostVendorBudgetAuthorization(input);
  if (preview.pathname === "/lockfile-pin-delta") return normalizePostLockfileAuthorization(input);
  return normalizePostBatchAuthorization(input);
}

/**
 * Bind the exact customer-authorized purchase shape before any wallet access.
 * HTTP payment credentials must never be transplanted into mcp:// resources.
 * POST /extract/batch also binds exact request body bytes and selected fields.
 * POST /lockfile-pin-delta binds exact {before, after} body bytes the same way.
 * POST /vendor-budget-impact binds exact pricing-row {before, after} body bytes.
 */
export function normalizeAuthorization(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("authorization must be an object");
  }
  const method = String(input.method || LIVE_METHOD).toUpperCase();
  if (method !== "GET" && method !== "POST") {
    fail("authorization method must be GET or POST", "method");
  }
  const network = String(input.network || "").trim();
  if (!/^eip155:\d+$/.test(network)) fail("authorization network must look like eip155:<id>", "network");
  const asset = normalizeAddress(input.asset, "asset");
  const recipient = normalizeAddress(input.recipient, "recipient");
  const amountCapAtomic = normalizeAtomic(input.amountCapAtomic, "amountCapAtomic");
  if (amountCapAtomic <= 0n) fail("amount cap must be positive", "amountCapAtomic");
  const assetName = input.assetName;
  const assetVersion = input.assetVersion;
  const maxTimeoutSeconds = input.maxTimeoutSeconds;
  if (typeof assetName !== "string" || !assetName || typeof assetVersion !== "string" || !assetVersion) {
    fail("explicit EIP-3009 assetName and assetVersion are required", "assetName");
  }
  if (!Number.isSafeInteger(maxTimeoutSeconds) || maxTimeoutSeconds < 1 || maxTimeoutSeconds > 300) {
    fail("maxTimeoutSeconds must be an integer from 1 to 300", "maxTimeoutSeconds");
  }

  const route = method === "POST"
    ? postRouteFor(input)
    : normalizeGetAuthorization(input);

  return Object.freeze({
    ...route,
    network,
    asset,
    recipient,
    amountCapAtomic: amountCapAtomic.toString(),
    assetName,
    assetVersion,
    maxTimeoutSeconds,
  });
}

export function assertRequestMatchesAuthorization(requestUrl, authorization, { method, body } = {}) {
  const auth = normalizeAuthorization(authorization);
  const actualMethod = String(method ?? auth.method).toUpperCase();
  if (actualMethod !== auth.method) {
    fail(`request method ${actualMethod} does not match authorized ${auth.method}`, "method");
  }
  const actual = normalizeHttpsUrl(requestUrl, "request url");
  if (actual.toString() !== auth.url) {
    fail("request URL does not match the exact authorized HTTPS origin/path/query", "url");
  }
  if (auth.method === "GET") {
    if (body !== undefined && body !== null && body !== "") {
      fail("request body is not authorized for GET /extract", "body");
    }
    return auth;
  }
  if (body !== undefined) {
    try {
      assertExactBodyBytes(auth.bodyRaw, body);
    } catch (error) {
      fail(error.message, "body");
    }
    if (bodyDigestFor(auth.bodyRaw) !== auth.bodyDigest) {
      fail("authorized body digest drifted after approval", "body");
    }
  }
  return auth;
}

/**
 * Compare a live or fixture accept option to the customer authorization.
 * Refusals happen before any signer or wallet credential is used.
 */
export function assertAcceptMatchesAuthorization(accept, authorization) {
  const auth = normalizeAuthorization(authorization);
  if (!accept || typeof accept !== "object") fail("accept option is required");
  if (accept.scheme !== "exact") fail("only the exact scheme is authorized", "scheme");
  if ((accept.extra?.assetTransferMethod ?? "eip3009") !== "eip3009") {
    fail("only EIP-3009 is authorized; Permit2 and approval extensions are not supported", "scheme");
  }
  if (accept.extra?.name !== auth.assetName || accept.extra?.version !== auth.assetVersion) {
    fail("EIP-712 asset domain does not match authorization", "assetName");
  }
  if (!Number.isSafeInteger(accept.maxTimeoutSeconds) || accept.maxTimeoutSeconds < 1 ||
      accept.maxTimeoutSeconds > auth.maxTimeoutSeconds) {
    fail("payment validity exceeds authorized maxTimeoutSeconds", "maxTimeoutSeconds");
  }
  if (accept.network !== auth.network) {
    fail(`network ${accept.network} does not match authorized ${auth.network}`, "network");
  }
  let asset;
  let payTo;
  try {
    asset = getAddress(accept.asset);
    payTo = getAddress(accept.payTo);
  } catch {
    fail("accept asset/payTo must be EVM addresses", "asset");
  }
  if (asset !== auth.asset) fail(`asset ${asset} does not match authorized ${auth.asset}`, "asset");
  if (payTo !== auth.recipient) {
    fail(`recipient ${payTo} does not match authorized ${auth.recipient}`, "recipient");
  }
  const amount = normalizeAtomic(accept.amount ?? accept.maxAmountRequired, "accept.amount");
  if (typeof accept.amount !== "string" || amount <= 0n) fail("v2 amount must be a positive integer string", "amount");
  const cap = BigInt(auth.amountCapAtomic);
  if (amount > cap) {
    fail(`amount ${amount} exceeds authorized amountCapAtomic ${cap}`, "amount");
  }
  return Object.freeze({
    ...auth,
    selectedAmountAtomic: amount.toString(),
  });
}
