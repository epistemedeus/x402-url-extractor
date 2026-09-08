import {
  closeSync,
  constants,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { getAddress } from "viem";
import { isEIP3009Payload } from "@x402/evm";
import { extractPaymentIdentifier } from "@x402/extensions/payment-identifier";

export const ATTEMPT_RECEIPT_SCHEMA = "samedaydesk.customer-x402.attempt-receipt.v1";

export const RECEIPT_STAGES = Object.freeze({
  READY_BEFORE_SEND: "ready_before_send",
  PAID_SEND_DISPATCHED: "paid_send_dispatched",
  PAID_RESPONSE_OBSERVED: "paid_response_observed",
  FAILED_AFTER_IDENTITY: "failed_after_identity",
});

export const SETTLEMENT_STATES = Object.freeze({
  UNKNOWN: "unknown",
  OBSERVED_HTTP: "observed_http_unverified",
});

export class AttemptReceiptError extends Error {
  constructor(message, { code = "attempt_receipt_error", field = null } = {}) {
    super(message);
    this.name = "AttemptReceiptError";
    this.code = code;
    this.field = field;
  }
}

function fail(message, field = null, code = "invalid_attempt_receipt") {
  throw new AttemptReceiptError(message, { code, field });
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
  return raw;
}

function normalizeNonce(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(raw)) {
    fail("nonce must be a 32-byte 0x-prefixed hex string", "nonce");
  }
  return raw;
}

function normalizeUnixSeconds(value, label) {
  const raw = String(value ?? "").trim();
  if (!/^\d+$/.test(raw)) fail(`${label} must be a non-negative integer string`, label);
  return raw;
}

function normalizePaymentIdentifier(value) {
  if (value == null || value === "") return null;
  const id = String(value);
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(id)) {
    fail("paymentIdentifier format is unsupported", "paymentIdentifier");
  }
  return id;
}

function assertNoSecrets(record) {
  const banned = [
    "signature", "privateKey", "private_key", "mnemonic", "seed", "credential",
    "paymentSignature", "paymentHeader", "typedData", "domain", "types", "message",
    "PAYMENT-SIGNATURE", "X-PAYMENT", "environment", "env",
  ];
  for (const key of banned) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      fail(`attempt receipt must not include ${key}`, key, "secret_material_refused");
    }
  }
  if (record.paymentIdentity && typeof record.paymentIdentity === "object") {
    for (const key of banned) {
      if (Object.prototype.hasOwnProperty.call(record.paymentIdentity, key)) {
        fail(`attempt receipt must not include ${key}`, key, "secret_material_refused");
      }
    }
  }
}

/**
 * Extract unsigned EIP-3009 payment identity from an official payment payload.
 * Returns explicit unsupported when the provider shape cannot be safely read.
 */
export function unsignedIdentityFromPaymentPayload(paymentPayload, { matchedAuthorization = null } = {}) {
  if (!paymentPayload || typeof paymentPayload !== "object") {
    return { ok: false, reason: "unsupported_payload", message: "payment payload is missing" };
  }
  const version = paymentPayload.x402Version;
  if (version !== 2) {
    return { ok: false, reason: "unsupported_version", message: `x402Version ${version} is unsupported` };
  }
  const accepted = paymentPayload.accepted;
  if (!accepted || accepted.scheme !== "exact") {
    return { ok: false, reason: "unsupported_scheme", message: "only exact scheme identity is supported" };
  }
  const method = accepted.extra?.assetTransferMethod ?? "eip3009";
  if (method !== "eip3009") {
    return { ok: false, reason: "unsupported_asset_transfer", message: `assetTransferMethod ${method} is unsupported` };
  }
  if (!isEIP3009Payload(paymentPayload.payload)) {
    return { ok: false, reason: "unsupported_payload", message: "payload is not a readable EIP-3009 authorization" };
  }
  const auth = paymentPayload.payload.authorization;
  if (!auth || typeof auth !== "object") {
    return { ok: false, reason: "unsupported_payload", message: "authorization object is missing" };
  }
  // payload.signature is expected on the wire object; never copy it into the receipt.
  let paymentIdentifier = null;
  try {
    paymentIdentifier = extractPaymentIdentifier(paymentPayload, true);
  } catch {
    return { ok: false, reason: "unsupported_payment_identifier", message: "payment identifier could not be safely read" };
  }

  try {
    const identity = {
      scheme: "exact",
      assetTransferMethod: "eip3009",
      x402Version: 2,
      network: String(accepted.network || ""),
      asset: normalizeAddress(accepted.asset, "asset"),
      assetName: String(accepted.extra?.name || matchedAuthorization?.assetName || ""),
      assetVersion: String(accepted.extra?.version || matchedAuthorization?.assetVersion || ""),
      payer: normalizeAddress(auth.from, "payer"),
      payee: normalizeAddress(auth.to, "payee"),
      amountAtomic: normalizeAtomic(auth.value, "amountAtomic"),
      nonce: normalizeNonce(auth.nonce),
      validAfter: normalizeUnixSeconds(auth.validAfter, "validAfter"),
      validBefore: normalizeUnixSeconds(auth.validBefore, "validBefore"),
      paymentIdentifier: normalizePaymentIdentifier(paymentIdentifier),
    };
    if (!/^eip155:\d+$/.test(identity.network)) {
      return { ok: false, reason: "unsupported_network", message: "network must look like eip155:<id>" };
    }
    if (!identity.assetName || !identity.assetVersion) {
      return { ok: false, reason: "unsupported_asset_domain", message: "EIP-712 asset name/version are required" };
    }
    if (matchedAuthorization) {
      if (identity.network !== matchedAuthorization.network) {
        return { ok: false, reason: "identity_mismatch", message: "network does not match authorization" };
      }
      if (identity.asset !== matchedAuthorization.asset) {
        return { ok: false, reason: "identity_mismatch", message: "asset does not match authorization" };
      }
      if (identity.payee !== matchedAuthorization.recipient) {
        return { ok: false, reason: "identity_mismatch", message: "payee does not match authorization" };
      }
      if (BigInt(identity.amountAtomic) > BigInt(matchedAuthorization.amountCapAtomic)) {
        return { ok: false, reason: "identity_mismatch", message: "amount exceeds authorized cap" };
      }
    }
    return { ok: true, identity };
  } catch (error) {
    if (error instanceof AttemptReceiptError) {
      return { ok: false, reason: "unsupported_payload", message: error.message };
    }
    return { ok: false, reason: "unsupported_payload", message: "payment identity could not be safely understood" };
  }
}

/** Extract unsigned identity from the ExactEvmScheme typed-data message (no signature). */
export function unsignedIdentityFromTypedData(typedData, { network, matchedAuthorization = null } = {}) {
  if (!typedData || typedData.primaryType !== "TransferWithAuthorization") {
    return { ok: false, reason: "unsupported_typed_data", message: "expected TransferWithAuthorization" };
  }
  const message = typedData.message;
  const domain = typedData.domain;
  if (!message || !domain) {
    return { ok: false, reason: "unsupported_typed_data", message: "typed data message/domain missing" };
  }
  try {
    const chainId = Number(domain.chainId);
    if (!Number.isSafeInteger(chainId) || chainId < 1) {
      return { ok: false, reason: "unsupported_network", message: "typed data chainId is invalid" };
    }
    const inferredNetwork = network || `eip155:${chainId}`;
    if (inferredNetwork !== `eip155:${chainId}`) {
      return { ok: false, reason: "identity_mismatch", message: "typed data chainId does not match network" };
    }
    const identity = {
      scheme: "exact",
      assetTransferMethod: "eip3009",
      x402Version: 2,
      network: inferredNetwork,
      asset: normalizeAddress(domain.verifyingContract, "asset"),
      assetName: String(domain.name || ""),
      assetVersion: String(domain.version || ""),
      payer: normalizeAddress(message.from, "payer"),
      payee: normalizeAddress(message.to, "payee"),
      amountAtomic: normalizeAtomic(message.value, "amountAtomic"),
      nonce: normalizeNonce(typeof message.nonce === "string" ? message.nonce : null),
      validAfter: normalizeUnixSeconds(message.validAfter, "validAfter"),
      validBefore: normalizeUnixSeconds(message.validBefore, "validBefore"),
      paymentIdentifier: null,
    };
    if (matchedAuthorization) {
      if (identity.asset !== matchedAuthorization.asset || identity.payee !== matchedAuthorization.recipient) {
        return { ok: false, reason: "identity_mismatch", message: "typed data does not match authorization" };
      }
    }
    return { ok: true, identity };
  } catch (error) {
    if (error instanceof AttemptReceiptError) {
      return { ok: false, reason: "unsupported_typed_data", message: error.message };
    }
    return { ok: false, reason: "unsupported_typed_data", message: "typed data could not be safely understood" };
  }
}

export function buildAttemptReceipt({
  identity,
  request,
  stage = RECEIPT_STAGES.READY_BEFORE_SEND,
  settlementState = SETTLEMENT_STATES.UNKNOWN,
  now = () => new Date(),
} = {}) {
  if (!identity || typeof identity !== "object") fail("identity is required", "identity");
  const createdAt = now().toISOString();
  const receipt = {
    schema: ATTEMPT_RECEIPT_SCHEMA,
    stage,
    settlementState,
    createdAt,
    updatedAt: createdAt,
    scheme: identity.scheme,
    assetTransferMethod: identity.assetTransferMethod,
    x402Version: identity.x402Version,
    network: identity.network,
    asset: identity.asset,
    assetName: identity.assetName,
    assetVersion: identity.assetVersion,
    payer: identity.payer,
    payee: identity.payee,
    amountAtomic: identity.amountAtomic,
    nonce: identity.nonce,
    validAfter: identity.validAfter,
    validBefore: identity.validBefore,
    paymentIdentifier: identity.paymentIdentifier ?? null,
    request: Object.freeze({
      method: String(request?.method || ""),
      url: String(request?.url || ""),
      bodyDigest: request?.bodyDigest == null ? null : String(request.bodyDigest),
    }),
    boundary: Object.freeze({
      purpose: "customer-owned unsigned EIP-3009 attempt identity for read-only reconciliation",
      secrets: "never stores signature, payment credential/header, private key, typed-data envelope, raw response, or environment",
      delivery: "chain usage is not delivered output and not permission to retry or respend",
      settlement: "HTTP observations remain unverified until a separate reconcile reports on-chain evidence",
    }),
  };
  return validateAttemptReceipt(receipt);
}

export function validateAttemptReceipt(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("attempt receipt must be an object");
  }
  assertNoSecrets(input);
  if (input.schema !== ATTEMPT_RECEIPT_SCHEMA) {
    fail(`schema must be ${ATTEMPT_RECEIPT_SCHEMA}`, "schema");
  }
  if (!Object.values(RECEIPT_STAGES).includes(input.stage)) {
    fail("stage is unsupported", "stage");
  }
  if (!Object.values(SETTLEMENT_STATES).includes(input.settlementState)) {
    fail("settlementState is unsupported", "settlementState");
  }
  if (input.scheme !== "exact") fail("only exact scheme receipts are supported", "scheme");
  if (input.assetTransferMethod !== "eip3009") {
    fail("only EIP-3009 receipts are supported", "assetTransferMethod");
  }
  if (input.x402Version !== 2) fail("only x402 v2 receipts are supported", "x402Version");
  if (!/^eip155:\d+$/.test(String(input.network || ""))) {
    fail("network must look like eip155:<id>", "network");
  }
  const request = input.request;
  if (!request || typeof request !== "object") fail("request binding is required", "request");
  if (request.method !== "GET" && request.method !== "POST") {
    fail("request.method must be GET or POST", "request.method");
  }
  try {
    const url = new URL(String(request.url || ""));
    if (url.protocol !== "https:") fail("request.url must be HTTPS", "request.url");
  } catch {
    fail("request.url must be an absolute HTTPS URL", "request.url");
  }
  if (request.method === "POST" && (request.bodyDigest == null || request.bodyDigest === "")) {
    fail("POST receipts require bodyDigest", "request.bodyDigest");
  }
  if (request.method === "GET" && request.bodyDigest != null) {
    fail("GET receipts must not include bodyDigest", "request.bodyDigest");
  }

  const normalized = {
    schema: ATTEMPT_RECEIPT_SCHEMA,
    stage: input.stage,
    settlementState: input.settlementState,
    createdAt: String(input.createdAt || ""),
    updatedAt: String(input.updatedAt || ""),
    scheme: "exact",
    assetTransferMethod: "eip3009",
    x402Version: 2,
    network: String(input.network),
    asset: normalizeAddress(input.asset, "asset"),
    assetName: String(input.assetName || ""),
    assetVersion: String(input.assetVersion || ""),
    payer: normalizeAddress(input.payer, "payer"),
    payee: normalizeAddress(input.payee, "payee"),
    amountAtomic: normalizeAtomic(input.amountAtomic, "amountAtomic"),
    nonce: normalizeNonce(input.nonce),
    validAfter: normalizeUnixSeconds(input.validAfter, "validAfter"),
    validBefore: normalizeUnixSeconds(input.validBefore, "validBefore"),
    paymentIdentifier: normalizePaymentIdentifier(input.paymentIdentifier),
    request: {
      method: request.method,
      url: String(request.url),
      bodyDigest: request.bodyDigest == null ? null : String(request.bodyDigest),
    },
    boundary: input.boundary && typeof input.boundary === "object"
      ? { ...input.boundary }
      : {
        purpose: "customer-owned unsigned EIP-3009 attempt identity for read-only reconciliation",
        secrets: "never stores signature, payment credential/header, private key, typed-data envelope, raw response, or environment",
        delivery: "chain usage is not delivered output and not permission to retry or respend",
        settlement: "HTTP observations remain unverified until a separate reconcile reports on-chain evidence",
      },
  };
  if (!normalized.assetName || !normalized.assetVersion) {
    fail("assetName and assetVersion are required", "assetName");
  }
  if (!normalized.createdAt || !normalized.updatedAt) {
    fail("createdAt and updatedAt are required", "createdAt");
  }
  assertNoSecrets(normalized);
  return Object.freeze({
    ...normalized,
    request: Object.freeze(normalized.request),
    boundary: Object.freeze(normalized.boundary),
  });
}

function fsyncPath(filePath) {
  const fd = openSync(filePath, constants.O_RDONLY);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function writeExclusive(filePath, text, mode = 0o600) {
  const fd = openSync(filePath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, mode);
  try {
    writeFileSync(fd, text, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    fsyncPath(dirname(filePath));
  } catch {
    // Directory fsync is best-effort on filesystems that disallow it.
  }
}

function atomicReplace(filePath, text, mode = 0o600) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const fd = openSync(tempPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, mode);
  try {
    writeFileSync(fd, text, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tempPath, filePath);
  try {
    fsyncPath(dirname(filePath));
  } catch {
    // best-effort
  }
}

export function writeAttemptReceipt(filePath, receipt, { replace = false } = {}) {
  const validated = validateAttemptReceipt(receipt);
  const absolute = resolve(filePath);
  mkdirSync(dirname(absolute), { recursive: true, mode: 0o700 });
  const text = `${JSON.stringify(validated, null, 2)}\n`;
  try {
    if (replace && existsRegularFile(absolute)) {
      atomicReplace(absolute, text);
    } else {
      writeExclusive(absolute, text);
    }
  } catch (error) {
    throw new AttemptReceiptError(
      `failed to persist attempt receipt: ${error instanceof Error ? error.message : String(error)}`,
      { code: "receipt_write_failed" },
    );
  }
  // Verify mode is not group/world readable when the platform reports mode.
  try {
    const mode = statSync(absolute).mode & 0o777;
    if ((mode & 0o077) !== 0) {
      throw new AttemptReceiptError("attempt receipt file must not be group/world accessible", {
        code: "receipt_privacy_failed",
      });
    }
  } catch (error) {
    if (error instanceof AttemptReceiptError) throw error;
  }
  return validated;
}

function existsRegularFile(filePath) {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export function readAttemptReceipt(filePath) {
  const absolute = resolve(filePath);
  let raw;
  try {
    raw = readFileSync(absolute, "utf8");
  } catch (error) {
    throw new AttemptReceiptError(
      `failed to read attempt receipt: ${error instanceof Error ? error.message : String(error)}`,
      { code: "receipt_read_failed" },
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail("attempt receipt is not valid JSON", "schema");
  }
  return validateAttemptReceipt(parsed);
}

export function updateAttemptReceipt(filePath, patch, { now = () => new Date() } = {}) {
  const current = readAttemptReceipt(filePath);
  const next = validateAttemptReceipt({
    ...current,
    ...patch,
    request: patch.request ? { ...current.request, ...patch.request } : current.request,
    boundary: current.boundary,
    schema: ATTEMPT_RECEIPT_SCHEMA,
    // Identity fields are immutable once written.
    scheme: current.scheme,
    assetTransferMethod: current.assetTransferMethod,
    x402Version: current.x402Version,
    network: current.network,
    asset: current.asset,
    assetName: current.assetName,
    assetVersion: current.assetVersion,
    payer: current.payer,
    payee: current.payee,
    amountAtomic: current.amountAtomic,
    nonce: current.nonce,
    validAfter: current.validAfter,
    validBefore: current.validBefore,
    paymentIdentifier: current.paymentIdentifier,
    createdAt: current.createdAt,
    updatedAt: now().toISOString(),
  });
  return writeAttemptReceipt(filePath, next, { replace: true });
}

/** Serializer for receipt/reconcile output: never emit signatures or private keys. */
export function safeAttemptJson(value) {
  return JSON.stringify(sanitizeAttemptValue(value), null, 2);
}

function sanitizeAttemptValue(value, key = "") {
  if (value == null) return value;
  if (/private.?key|secret|seed|mnemonic|password|credential|signature|payment.?header|typed.?data/i.test(key)) {
    return "[redacted]";
  }
  if (typeof value === "string") {
    if (/private.?key|secret|seed|mnemonic|password/i.test(key)) return "[redacted]";
    // Leave 32-byte nonces and addresses intact; redact longer hex blobs (signatures ~65 bytes).
    if (/^0x[0-9a-fA-F]{130,}$/.test(value)) return "[redacted]";
    if (/[A-Za-z0-9+/_=-]{100,}/.test(value) && !/^0x[0-9a-fA-F]{64}$/.test(value)) {
      return "[opaque-redacted]";
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeAttemptValue(item));
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = sanitizeAttemptValue(v, k);
    return out;
  }
  return value;
}
