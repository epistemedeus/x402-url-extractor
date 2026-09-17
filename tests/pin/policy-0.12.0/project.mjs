#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { evaluateRepoPins, loadPins, pinRecord } from "./evaluate.mjs";

export const PROJECTION_SCHEMA = "samedaydesk.agent-payment-policy-0.12.0-pin-projection.v1";
export const DIGEST = /^sha256:[0-9a-f]{64}$/;

export const BOUNDARY = Object.freeze({
  credentialsUsed: false,
  networkAccessed: false,
  walletAccessed: false,
  paymentSigned: false,
  paymentSent: false,
  ledgerCreated: false,
  paidCapture: false,
  sellerSignatureVerified: false,
  inspectOutputSchemaAvailable: false,
  productionPinBumped: false,
  statement: "Pin fixture only. Merchant agent-payment-policy 0.12.0 cannot supply buyer.schemaDigest from inspectOutputSchema (policy 0.13+). This helper does not bump production pins, pay, verify EIP-712, or mint R6-04 portable evidence.",
});

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function digestString(value) {
  return typeof value === "string" && DIGEST.test(value.toLowerCase()) ? value.toLowerCase() : null;
}

function failClosed(reason, message, extra = {}) {
  const error = new Error(message);
  error.reason = reason;
  error.extra = extra;
  throw error;
}

function extractOfferReceiptExtension(input) {
  const paymentRequired = record(input?.paymentRequired) || input;
  const extensions = record(paymentRequired?.extensions) || record(input?.extensions);
  return record(extensions?.["offer-receipt"]) || record(paymentRequired?.["offer-receipt"]) || null;
}

export function extractSignedOffers(input) {
  const extension = extractOfferReceiptExtension(input);
  const offers = extension?.info?.offers;
  if (offers === undefined || offers === null) return [];
  if (!Array.isArray(offers)) {
    failClosed("seller_offer_receipt_malformed", "seller offer-receipt offers must be an array");
  }
  return offers;
}

export function inventedHits(input, forbidden) {
  const hits = [];
  const blob = JSON.stringify(input);
  for (const name of forbidden) {
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b`);
    if (re.test(blob)) hits.push(name);
  }
  return hits;
}

export function projectPinBoundary(input, pins = loadPins()) {
  const body = record(input);
  if (!body) failClosed("projection_input_invalid", "pin projection input must be a JSON object");

  const invented = inventedHits(body, pins.forbiddenInvented || []);
  if (invented.length) {
    failClosed(
      "invented_receipt_field_without_live_schema",
      "invented receipt field without live schema citation",
      { invented, buyerSchemaDigest: null, decisionChanged: "buyer.schemaDigest:omitted" },
    );
  }

  const treatAbsenceAsDemand = body.treatOmittedDigestAsDemand === true
    || body.treatAbsenceAsDemand === true;
  const buyer = record(body.buyer) || {};
  const buyerDigest = digestString(buyer.schemaDigest);
  const offers = extractSignedOffers(body);
  const sellerPresent = offers.length > 0;
  const omitted = !buyerDigest;

  if (treatAbsenceAsDemand) {
    failClosed(
      "treat_absence_as_demand",
      "omitted buyer.schemaDigest is not buyer demand and is not an inspectOutputSchema result on policy 0.12.0",
      {
        sellerOfferReceiptPresent: sellerPresent,
        buyerSchemaDigest: null,
        decisionChanged: "buyer.schemaDigest:omitted;treat-absence-as-demand",
      },
    );
  }

  if (body.claimInspectOutputSchema === true) {
    failClosed(
      "inspect_output_schema_unavailable",
      "inspectOutputSchema is not exported by agent-payment-policy 0.12.0",
      {
        sellerOfferReceiptPresent: sellerPresent,
        buyerSchemaDigest: buyerDigest,
        decisionChanged: omitted ? "buyer.schemaDigest:omitted" : "inspectOutputSchema:unavailable",
      },
    );
  }

  if (sellerPresent && omitted) {
    failClosed(
      "buyer_schema_digest_omitted",
      "buyer schemaDigest is required when a seller offer-receipt is present; policy 0.12.0 cannot supply it from inspectOutputSchema",
      {
        sellerOfferReceiptPresent: true,
        buyerSchemaDigest: null,
        decisionChanged: "buyer.schemaDigest:omitted",
      },
    );
  }

  if (!sellerPresent) {
    failClosed("seller_offer_receipt_missing", "seller-signed offer-receipt is required for this pin fixture");
  }

  failClosed(
    "inspect_output_schema_unavailable",
    "merchant pin 0.12.0 cannot supply R6-04 buyer.schemaDigest from inspectOutputSchema",
    {
      sellerOfferReceiptPresent: true,
      buyerSchemaDigest: buyerDigest,
      decisionChanged: "inspectOutputSchema:unavailable",
    },
  );
}

export function refusalPayload(error, pins = loadPins(), pinResult = null) {
  const extra = record(error?.extra) || {};
  const reason = typeof error?.reason === "string" ? error.reason : "projection_failed";
  const schemaDigestOmitted = reason === "buyer_schema_digest_omitted"
    || reason === "treat_absence_as_demand";
  return Object.freeze({
    schemaVersion: PROJECTION_SCHEMA,
    accepted: false,
    reasons: Object.freeze([reason]),
    sellerOfferReceiptPresent: extra.sellerOfferReceiptPresent === true,
    buyerSchemaDigest: extra.buyerSchemaDigest === undefined ? null : extra.buyerSchemaDigest,
    decisionChanged: extra.decisionChanged || (schemaDigestOmitted ? "buyer.schemaDigest:omitted" : null),
    evidence: null,
    invented: extra.invented ? Object.freeze([...extra.invented]) : undefined,
    error: error?.message || "pin projection failed",
    pin: pinRecord(pins),
    pinCheck: pinResult
      ? Object.freeze({ ok: pinResult.ok, code: pinResult.code, failures: pinResult.failures })
      : undefined,
    boundary: BOUNDARY,
  });
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

export async function run(argv = process.argv.slice(2)) {
  const path = argv[0];
  if (!path || argv.length !== 1) {
    console.error("Usage: node tests/pin/policy-0.12.0/project.mjs <projection-json>");
    process.exitCode = 2;
    return;
  }
  const pins = loadPins();
  const pinResult = evaluateRepoPins();
  try {
    projectPinBoundary(JSON.parse(readFileSync(resolve(path), "utf8")), pins);
    printJson({
      accepted: true,
      evidence: null,
      error: "pin fixture must not mint portable evidence",
      pin: pinRecord(pins),
      pinCheck: { ok: pinResult.ok, code: pinResult.code },
      boundary: BOUNDARY,
    });
    process.exitCode = 1;
  } catch (error) {
    const payload = refusalPayload(error, pins, pinResult);
    printJson(payload);
    process.exitCode = 1;
  }
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) await run();
