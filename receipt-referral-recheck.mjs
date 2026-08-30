import { createHash } from "node:crypto";
import { chmod, mkdir, open as fsOpen, stat } from "node:fs/promises";
import path from "node:path";

import {
  canonicalize,
  extractReceiptPayload,
  isEIP712SignedReceipt,
  verifyReceiptSignatureEIP712,
} from "@x402/extensions/offer-receipt";

import {
  normalizeSellerIntegrityAuditInput,
  sellerIntegrityAudit,
  sellerIntegrityAuditOutputSchema,
} from "./seller-integrity-audit.mjs";

const CLAIM_ROUTE = "/commerce/referral-recheck";
const AUDIT_ROUTE = "/commerce/seller-integrity-audit";
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const EVM_TRANSACTION = /^0x[0-9a-fA-F]{64}$/;
const EIP712_SIGNATURE = /^0x[0-9a-fA-F]{130}$/;
const NETWORK = /^eip155:[1-9][0-9]*$/;
const REFERRAL_ID = /^r1_[0-9a-f]{64}$/;
const MALFORMED_PERCENT_ESCAPE = /%(?![0-9a-fA-F]{2})/;
const URL_CONTROL_OR_BACKSLASH = /[\u0000-\u001f\u007f\\]/;
const RECEIPT_KEYS = Object.freeze(["format", "payload", "signature"]);
const PAYLOAD_KEYS = Object.freeze([
  "issuedAt",
  "network",
  "payer",
  "resourceUrl",
  "transaction",
  "version",
]);

export class ReceiptReferralRecheckError extends Error {
  constructor(message, { code = "invalid_referral_claim", statusCode = 400 } = {}) {
    super(message);
    this.name = "ReceiptReferralRecheckError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function fail(message, options) {
  throw new ReceiptReferralRecheckError(message, options);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  if (!isObject(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function normalizeReceipt(receipt, label) {
  if (!isObject(receipt)) fail(`${label} must be a complete signed offer receipt`);
  let supported = false;
  try {
    supported = isEIP712SignedReceipt(receipt);
  } catch {
    supported = false;
  }
  if (!supported) {
    fail(`${label} must use the merchant-supported eip712 receipt format`, {
      code: "unsupported_receipt_signature_format",
    });
  }
  if (!hasExactKeys(receipt, RECEIPT_KEYS)) {
    fail(`${label} must contain exactly format, payload, and signature`);
  }
  if (!hasExactKeys(receipt.payload, PAYLOAD_KEYS)) {
    fail(`${label} payload is incomplete or contains unsupported fields`);
  }
  const payload = extractReceiptPayload(receipt);
  if (
    payload.version !== 1
    || !NETWORK.test(payload.network)
    || typeof payload.resourceUrl !== "string"
    || payload.resourceUrl.length === 0
    || payload.resourceUrl.length > 4096
    || !EVM_ADDRESS.test(payload.payer)
    || !Number.isSafeInteger(payload.issuedAt)
    || payload.issuedAt <= 0
    || !EVM_TRANSACTION.test(payload.transaction)
    || !EIP712_SIGNATURE.test(receipt.signature)
  ) {
    fail(`${label} payload or signature is malformed`);
  }
  return { receipt, payload };
}

function normalizeClaimInput(input) {
  if (!hasExactKeys(input, ["downstream", "original"])) {
    fail("request body must contain exactly original and downstream receipts");
  }
  return {
    original: normalizeReceipt(input.original, "original"),
    downstream: normalizeReceipt(input.downstream, "downstream"),
  };
}

function normalizePublicOrigin(publicUrl) {
  if (
    typeof publicUrl !== "string"
    || publicUrl.length === 0
    || publicUrl !== publicUrl.trim()
    || !/^https:\/\/[^/?#]+\/?$/i.test(publicUrl)
    || URL_CONTROL_OR_BACKSLASH.test(publicUrl)
    || MALFORMED_PERCENT_ESCAPE.test(publicUrl)
  ) {
    fail("receipt referral public URL is not configured as an HTTPS origin", {
      code: "receipt_verification_unavailable",
      statusCode: 503,
    });
  }
  let url;
  try {
    url = new URL(publicUrl);
  } catch {
    fail("receipt referral public URL is not configured as an HTTPS origin", {
      code: "receipt_verification_unavailable",
      statusCode: 503,
    });
  }
  if (
    url.protocol !== "https:"
    || !url.hostname
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
  ) {
    fail("receipt referral public URL is not configured as an HTTPS origin", {
      code: "receipt_verification_unavailable",
      statusCode: 503,
    });
  }
  return url.origin;
}

function parseSignedAuditUrl(resourceUrl, { canonicalOrigin, expectedReferral, label }) {
  if (
    resourceUrl !== resourceUrl.trim()
    || URL_CONTROL_OR_BACKSLASH.test(resourceUrl)
    || MALFORMED_PERCENT_ESCAPE.test(resourceUrl)
  ) {
    fail(`${label} resourceUrl is malformed`, { code: "invalid_signed_resource_url" });
  }
  let url;
  try {
    url = new URL(resourceUrl);
  } catch {
    fail(`${label} resourceUrl is malformed`, { code: "invalid_signed_resource_url" });
  }
  if (
    url.protocol !== "https:"
    || url.origin !== canonicalOrigin
    || url.username
    || url.password
    || url.pathname !== AUDIT_ROUTE
    || url.hash
  ) {
    fail(`${label} resourceUrl must use the canonical SameDayDesk seller-integrity audit route`, {
      code: "invalid_signed_resource_url",
    });
  }

  const entries = [...url.searchParams.entries()];
  const allowed = new Set(["origin", "route", "method", "requiredPaths", "requireBazaar", "referral"]);
  const input = Object.create(null);
  for (const [key, value] of entries) {
    if (!allowed.has(key) || Object.hasOwn(input, key)) {
      fail(`${label} resourceUrl has an unsupported or ambiguous query`, {
        code: "invalid_signed_resource_url",
      });
    }
    input[key] = value;
  }
  if (
    expectedReferral === null
    && Object.hasOwn(input, "referral")
    && !REFERRAL_ID.test(input.referral)
  ) {
    fail("original resourceUrl referral must be syntactically valid", {
      code: "invalid_signed_resource_url",
    });
  } else if (expectedReferral !== null && input.referral !== expectedReferral) {
    fail("downstream resourceUrl must carry the receipt-derived referral exactly once", {
      code: "referral_mismatch",
    });
  }

  try {
    return normalizeSellerIntegrityAuditInput(input);
  } catch {
    fail(`${label} resourceUrl does not contain a valid seller-integrity audit target`, {
      code: "invalid_signed_resource_url",
    });
  }
}

async function verifyMerchantReceipt(normalized, merchantSigner, label) {
  let verified;
  try {
    verified = await verifyReceiptSignatureEIP712(normalized.receipt);
  } catch {
    fail(`${label} receipt signature is invalid`, { code: "invalid_receipt_signature" });
  }
  if (String(verified.signer).toLowerCase() !== merchantSigner.toLowerCase()) {
    fail(`${label} receipt was not signed by the configured merchant receipt signer`, {
      code: "foreign_receipt_signer",
      statusCode: 403,
    });
  }
  return verified.payload;
}

export function receiptReferralId(receipt) {
  return `r1_${createHash("sha256").update(canonicalize(receipt)).digest("hex")}`;
}

export function createReceiptReferralClaimStore({
  dataDir = process.env.COMMERCE_DATA_DIR || path.join(process.cwd(), "data"),
} = {}) {
  const claimsDir = path.join(dataDir, "referral-recheck-claims");

  async function prepare() {
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    await chmod(dataDir, 0o700).catch(() => {});
    await mkdir(claimsDir, { recursive: true, mode: 0o700 });
    await chmod(claimsDir, 0o700);
  }

  function markerPath(referralId) {
    if (!REFERRAL_ID.test(referralId)) throw new Error("invalid referral marker key");
    return path.join(claimsDir, referralId);
  }

  return Object.freeze({
    claimsDir,
    async isClaimed(referralId) {
      try {
        await stat(markerPath(referralId));
        return true;
      } catch (error) {
        if (error?.code === "ENOENT") return false;
        throw error;
      }
    },
    async create(referralId) {
      await prepare();
      let handle;
      try {
        handle = await fsOpen(markerPath(referralId), "wx", 0o600);
        await handle.chmod(0o600);
        return true;
      } catch (error) {
        if (error?.code === "EEXIST") return false;
        throw error;
      } finally {
        await handle?.close();
      }
    },
  });
}

function duplicateClaim() {
  fail("this referral has already received its one free recheck", {
    code: "referral_already_claimed",
    statusCode: 409,
  });
}

export async function receiptReferralRecheck(input, {
  merchantSigner,
  network,
  publicUrl,
  claimStore = createReceiptReferralClaimStore(),
  audit = sellerIntegrityAudit,
} = {}) {
  const canonicalOrigin = normalizePublicOrigin(publicUrl);
  const normalized = normalizeClaimInput(input);
  if (!EVM_ADDRESS.test(String(merchantSigner || "")) || !NETWORK.test(String(network || ""))) {
    fail("receipt referral verification is not configured", {
      code: "receipt_verification_unavailable",
      statusCode: 503,
    });
  }

  const [originalPayload, downstreamPayload] = await Promise.all([
    verifyMerchantReceipt(normalized.original, merchantSigner, "original"),
    verifyMerchantReceipt(normalized.downstream, merchantSigner, "downstream"),
  ]);
  const referralId = receiptReferralId(normalized.original.receipt);
  const originalSignedTarget = parseSignedAuditUrl(originalPayload.resourceUrl, {
    canonicalOrigin,
    expectedReferral: null,
    label: "original",
  });
  parseSignedAuditUrl(downstreamPayload.resourceUrl, {
    canonicalOrigin,
    expectedReferral: referralId,
    label: "downstream",
  });
  const originalTarget = Object.freeze({
    origin: originalSignedTarget.origin,
    route: originalSignedTarget.route,
    method: originalSignedTarget.method,
    requiredPaths: originalSignedTarget.requiredPaths,
    requireBazaar: originalSignedTarget.requireBazaar,
    referral: null,
  });

  if (originalPayload.network !== network || downstreamPayload.network !== network) {
    fail("both receipts must use the merchant's configured network", { code: "receipt_network_mismatch" });
  }
  if (originalPayload.network !== downstreamPayload.network) {
    fail("receipts must use the same network", { code: "receipt_network_mismatch" });
  }
  if (originalPayload.issuedAt > downstreamPayload.issuedAt) {
    fail("downstream receipt cannot be issued before the original receipt", { code: "receipt_order_invalid" });
  }
  if (originalPayload.payer.toLowerCase() === downstreamPayload.payer.toLowerCase()) {
    fail("receipts must identify distinct payers", { code: "payer_not_distinct" });
  }
  if (originalPayload.transaction.toLowerCase() === downstreamPayload.transaction.toLowerCase()) {
    fail("receipts must bind distinct transaction hashes", { code: "transaction_not_distinct" });
  }

  try {
    if (await claimStore.isClaimed(referralId)) duplicateClaim();
  } catch (error) {
    if (error instanceof ReceiptReferralRecheckError) throw error;
    fail("referral claim storage is unavailable", {
      code: "claim_storage_unavailable",
      statusCode: 503,
    });
  }

  let recheck;
  try {
    recheck = await audit(originalTarget);
  } catch {
    fail("seller-integrity recheck failed before the reward was consumed", {
      code: "recheck_failed",
      statusCode: 502,
    });
  }

  try {
    if (!await claimStore.create(referralId)) duplicateClaim();
  } catch (error) {
    if (error instanceof ReceiptReferralRecheckError) throw error;
    fail("referral claim storage is unavailable", {
      code: "claim_storage_unavailable",
      statusCode: 503,
    });
  }

  return {
    ok: true,
    product: "samedaydesk-referral-recheck",
    version: "1.0.0",
    referralId,
    reward: "one_free_changed_state_recheck",
    recheck,
    evidence: {
      proof: "two_distinct_seller_signed_settlement_receipts",
      sellerSignaturesVerified: true,
      sameNetwork: true,
      downstreamIssuedAtNotEarlier: true,
      distinctPayers: true,
      distinctTransactions: true,
      buyerOutputValidated: false,
      broadcastRequired: false,
    },
    claim: {
      consumed: true,
      consumptionPoint: "after_recheck_completed_before_success_response",
    },
    boundary: {
      charged: false,
      paidDemandRecorded: false,
      settlementRecorded: false,
      revenueRecorded: false,
      rawReceiptsRetained: false,
      payersRetained: false,
      transactionsRetained: false,
      requestBodyRetained: false,
    },
  };
}

function signedReceiptSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      format: { type: "string", const: "eip712" },
      payload: {
        type: "object",
        additionalProperties: false,
        properties: {
          version: { type: "integer", const: 1 },
          network: { type: "string", pattern: "^eip155:[1-9][0-9]*$" },
          resourceUrl: { type: "string", format: "uri", maxLength: 4096 },
          payer: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
          issuedAt: { type: "integer", minimum: 1 },
          transaction: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" },
        },
        required: ["version", "network", "resourceUrl", "payer", "issuedAt", "transaction"],
      },
      signature: { type: "string", pattern: "^0x[0-9a-fA-F]{130}$" },
    },
    required: ["format", "payload", "signature"],
  };
}

export function receiptReferralRecheckRequestSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      original: signedReceiptSchema(),
      downstream: signedReceiptSchema(),
    },
    required: ["original", "downstream"],
  };
}

export function receiptReferralRecheckOutputSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      ok: { type: "boolean", const: true },
      product: { type: "string", const: "samedaydesk-referral-recheck" },
      version: { type: "string", const: "1.0.0" },
      referralId: { type: "string", pattern: "^r1_[0-9a-f]{64}$" },
      reward: { type: "string", const: "one_free_changed_state_recheck" },
      recheck: sellerIntegrityAuditOutputSchema(),
      evidence: {
        type: "object",
        additionalProperties: false,
        properties: {
          proof: { type: "string", const: "two_distinct_seller_signed_settlement_receipts" },
          sellerSignaturesVerified: { type: "boolean", const: true },
          sameNetwork: { type: "boolean", const: true },
          downstreamIssuedAtNotEarlier: { type: "boolean", const: true },
          distinctPayers: { type: "boolean", const: true },
          distinctTransactions: { type: "boolean", const: true },
          buyerOutputValidated: { type: "boolean", const: false },
          broadcastRequired: { type: "boolean", const: false },
        },
        required: ["proof", "sellerSignaturesVerified", "sameNetwork", "downstreamIssuedAtNotEarlier", "distinctPayers", "distinctTransactions", "buyerOutputValidated", "broadcastRequired"],
      },
      claim: {
        type: "object",
        additionalProperties: false,
        properties: {
          consumed: { type: "boolean", const: true },
          consumptionPoint: { type: "string", const: "after_recheck_completed_before_success_response" },
        },
        required: ["consumed", "consumptionPoint"],
      },
      boundary: {
        type: "object",
        additionalProperties: false,
        properties: Object.fromEntries([
          "charged",
          "paidDemandRecorded",
          "settlementRecorded",
          "revenueRecorded",
          "rawReceiptsRetained",
          "payersRetained",
          "transactionsRetained",
          "requestBodyRetained",
        ].map((key) => [key, { type: "boolean", const: false }])),
        required: ["charged", "paidDemandRecorded", "settlementRecorded", "revenueRecorded", "rawReceiptsRetained", "payersRetained", "transactionsRetained", "requestBodyRetained"],
      },
    },
    required: ["ok", "product", "version", "referralId", "reward", "recheck", "evidence", "claim", "boundary"],
  };
}

export const RECEIPT_REFERRAL_RECHECK_ROUTE = CLAIM_ROUTE;
