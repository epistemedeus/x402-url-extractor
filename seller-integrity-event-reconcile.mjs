#!/usr/bin/env node
// Bounded seller-integrity catalog reconcile.
// Uses the current settlement summary, source-delivery attribution, and
// payment-evidence readout. Catalog call counters are not revenue.
// Does not pay, settle, deploy, or change prices.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  normalizeCommercePayerClasses,
  sanitizeSettlementSourceDeliveryAttribution,
} from "./commerce-events.mjs";
import { buildCommercePaymentEvidenceReadout } from "./commerce-payment-evidence.mjs";
import {
  summarizeCommerceSettlementLedger,
  summarizeSettlementSourceDelivery,
} from "./commerce-settlement-reconciler.mjs";

export const SELLER_INTEGRITY_EVENT_RECONCILE_SCHEMA =
  "samedaydesk.seller-integrity-event-reconcile.v1";
export const SELLER_INTEGRITY_ROUTE = "/commerce/seller-integrity-audit";
export const SELLER_INTEGRITY_RESOURCE =
  "https://agents.samedaydesk.com/commerce/seller-integrity-audit";
export const SELLER_INTEGRITY_SEARCH =
  "https://api.cdp.coinbase.com/platform/v2/x402/discovery/search";
export const R02_SELLER_INTEGRITY_PIN = Object.freeze({
  pilotPull: 238,
  commit: "35a1075cb274d84a716a656d13914548243765bd",
  calls: 3,
  payers: 3,
  lastCalledAt: "2026-09-28T06:02:21.396Z",
  amountAtomic: "10000",
  descriptionLength: 469,
  label: "catalog-aggregate-unverified",
  pathNote: "docs/s05-store-readiness-path.md",
  pilotTreeWriteOwner: "S05-R02-INTEGRATE-0930",
});

const MERCHANT_PAYTO = "0x8904df3de6dfee6a7c8cc38619d2f17806213cee";
const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const MAX_BODY_BYTES = 250_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ATOMIC = /^\d+$/;

const CLAIM_KEYS = new Set([
  "attributable",
  "bank",
  "bankedNetUsdc",
  "bankedRevenue",
  "bankedRevenueUsdc",
  "catalogEqualsRevenue",
  "joinCatalogPayers",
  "revenueUsdc",
  "treatQualityAsRevenue",
]);
const MONEY_KEYS = ["bankedNetUsdc", "bankedRevenue", "bankedRevenueUsdc", "revenueUsdc"];

export class SellerIntegrityReconcileError extends Error {
  constructor(message, { code = "seller_integrity_reconcile_failed" } = {}) {
    super(message);
    this.name = "SellerIntegrityReconcileError";
    this.code = code;
  }
}

function fail(message, code) {
  throw new SellerIntegrityReconcileError(message, { code });
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function canonicalTimestamp(value, code) {
  if (typeof value !== "string") fail("lastCalledAt must be a canonical UTC timestamp", code);
  let iso;
  try {
    iso = new Date(value).toISOString();
  } catch {
    fail("lastCalledAt must be a canonical UTC timestamp", code);
  }
  if (iso !== value) fail("lastCalledAt must be a canonical UTC timestamp", code);
  return value;
}

function operationIdOf(value) {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value);
  if (!OPERATION_ID.test(text)) fail("operationId must be a UUID", "invalid_operation_id");
  return text.toLowerCase();
}

function rejectDirectBank(input) {
  if (input?.bank === true || input?.catalogEqualsRevenue === true || input?.treatQualityAsRevenue === true) {
    fail("catalog call counters are not revenue and cannot be banked", "invented_banked_revenue");
  }
  for (const key of MONEY_KEYS) {
    if (hasOwn(input || {}, key)) {
      fail("refusing an invented banked revenue figure", "invented_banked_revenue");
    }
  }
}

function rejectClaim(claim) {
  if (claim === undefined) return;
  if (claim === null || typeof claim !== "object" || Array.isArray(claim)) {
    fail("claim must be an object", "invalid_claim");
  }
  for (const key of Object.keys(claim)) {
    if (!CLAIM_KEYS.has(key)) fail(`unrecognized claim ${key}`, "invalid_claim");
  }
  if (claim.joinCatalogPayers === true) {
    fail("catalog payer counts cannot be joined to wallet classes", "catalog_payers_are_not_identities");
  }
  if (hasOwn(claim, "attributable") && claim.attributable !== "unknown") {
    fail(
      "catalog payers are not identities and cannot be labeled external or owner/QA",
      "attribution_without_identity",
    );
  }
  if (claim.bank === true || claim.catalogEqualsRevenue === true || claim.treatQualityAsRevenue === true) {
    fail("catalog call counters are not revenue and cannot be banked", "invented_banked_revenue");
  }
  if ([claim.bank, claim.catalogEqualsRevenue, claim.treatQualityAsRevenue, claim.joinCatalogPayers]
    .some((value) => value !== undefined && typeof value !== "boolean")) {
    fail("claim flags must be booleans", "invalid_claim");
  }
  for (const key of MONEY_KEYS) {
    if (hasOwn(claim, key)) fail("refusing an invented banked revenue figure", "invented_banked_revenue");
  }
}

function labelFromPaymentClass(paymentClass) {
  if (paymentClass === "internal" || paymentClass === "validation") return "owner_qa";
  if (paymentClass === "independent") return "external";
  return "unknown";
}

function labelsFromByClass(byClass) {
  const labels = { external: 0, owner_qa: 0, unknown: 0 };
  for (const [paymentClass, bucket] of Object.entries(byClass || {})) {
    const count = bucket?.settlements;
    if (!Number.isSafeInteger(count) || count < 0) continue;
    labels[labelFromPaymentClass(paymentClass)] += count;
  }
  return labels;
}

function rejectCatalogBankFields(body) {
  if (body.bank === true || body.catalogEqualsRevenue === true || body.treatQualityAsRevenue === true) {
    fail("catalog call counters are not revenue and cannot be banked", "invented_banked_revenue");
  }
  if (body.joinCatalogPayers === true) {
    fail("catalog payer counts cannot be joined to wallet classes", "catalog_payers_are_not_identities");
  }
  if (hasOwn(body, "attributable") && body.attributable !== "unknown") {
    fail(
      "catalog payers are not identities and cannot be labeled external or owner/QA",
      "attribution_without_identity",
    );
  }
  for (const key of MONEY_KEYS) {
    if (hasOwn(body, key)) fail("refusing an invented banked revenue figure", "invented_banked_revenue");
  }
}

function readSellerIntegrityCatalog(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    fail("catalog must be a JSON object", "invalid_catalog");
  }
  rejectCatalogBankFields(body);
  rejectClaim(body.claim);
  if (body.partialResults !== false) {
    fail("bounded reconcile requires partialResults false", "catalog_unbounded");
  }
  if (!Array.isArray(body.resources)) fail("catalog resources must be an array", "invalid_catalog");
  if (body.resources.length !== 1) {
    fail("bounded reconcile requires exactly one resource", "catalog_unbounded");
  }
  const resource = body.resources[0];
  if (resource === null || typeof resource !== "object" || Array.isArray(resource)) {
    fail("catalog resource must be an object", "invalid_catalog");
  }
  let url;
  try {
    url = new URL(resource.resource);
  } catch {
    fail("seller-integrity resource URL is missing", "seller_integrity_absent");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    fail("seller-integrity resource must be a credential-free https URL", "invalid_catalog");
  }
  if (url.hostname !== "agents.samedaydesk.com" || url.pathname !== SELLER_INTEGRITY_ROUTE || url.search) {
    fail("catalog resource is not the seller-integrity route", "seller_integrity_absent");
  }
  const quality = resource.quality;
  if (quality === null || typeof quality !== "object" || Array.isArray(quality)) {
    fail("catalog quality counters are missing", "catalog_quality_missing");
  }
  const calls = quality.l30DaysTotalCalls;
  const payers = quality.l30DaysUniquePayers;
  if (!Number.isSafeInteger(calls) || calls < 0 || !Number.isSafeInteger(payers) || payers < 0) {
    fail("catalog quality counters are missing", "catalog_quality_missing");
  }
  if (payers > calls) fail("unique payers cannot exceed calls", "invalid_catalog");
  const lastCalledAt = canonicalTimestamp(quality.lastCalledAt, "catalog_quality_missing");
  if (!Array.isArray(resource.accepts) || resource.accepts.length === 0) {
    fail("catalog accepts are missing", "invalid_catalog");
  }
  const amounts = resource.accepts.map((accept) => accept?.amount);
  if (!amounts.every((amount) => typeof amount === "string" && ATOMIC.test(amount))) {
    fail("accept amount must be an atomic decimal string", "invalid_catalog");
  }
  if (new Set(amounts).size !== 1) fail("catalog accepts disagree on amount", "ambiguous_amount");
  for (const accept of resource.accepts) {
    const payTo = String(accept?.payTo || "").toLowerCase();
    if (payTo !== MERCHANT_PAYTO) fail("catalog payTo is not the merchant treasury", "payto_mismatch");
    if (accept?.network !== undefined && accept.network !== "eip155:8453") {
      fail("catalog network is not Base", "invalid_catalog");
    }
    if (accept?.asset !== undefined && String(accept.asset).toLowerCase() !== BASE_USDC) {
      fail("catalog asset is not Base USDC", "invalid_catalog");
    }
  }
  const description = typeof resource.description === "string" ? resource.description : "";
  return {
    resource: SELLER_INTEGRITY_RESOURCE,
    route: SELLER_INTEGRITY_ROUTE,
    calls,
    payers,
    lastCalledAt,
    amountAtomic: amounts[0],
    descriptionLength: description.length,
    descriptionOver500: description.length > 500,
    featuredPresent: hasOwn(resource, "featured"),
    partialResults: false,
    label: "catalog-aggregate-unverified",
  };
}

function settlementFromLedger(ledgerContents) {
  if (ledgerContents === null || ledgerContents === undefined) {
    return { supplied: false, summary: null, routeSummary: null };
  }
  if (typeof ledgerContents !== "string") fail("ledger must be ndjson text", "invalid_ledger");
  if (Buffer.byteLength(ledgerContents) > MAX_BODY_BYTES) fail("ledger exceeded the size cap", "ledger_too_large");
  const summary = summarizeCommerceSettlementLedger(ledgerContents);
  const routeLines = [];
  for (const line of ledgerContents.split("\n")) {
    if (!line) continue;
    try {
      const row = JSON.parse(line);
      if (row && row.route === SELLER_INTEGRITY_ROUTE) routeLines.push(line);
    } catch {
      // The settlement summary already counts invalid lines. They are not revenue.
    }
  }
  return {
    supplied: true,
    summary,
    routeSummary: summarizeCommerceSettlementLedger(`${routeLines.join("\n")}${routeLines.length ? "\n" : ""}`),
  };
}

function refuseUnjoinedPayerClasses(payerClasses) {
  if (payerClasses === undefined || payerClasses === null || payerClasses === "") return;
  let normalized;
  try {
    normalized = normalizeCommercePayerClasses(payerClasses);
  } catch (error) {
    fail(error instanceof Error ? error.message : "commerce payer class is invalid", "invalid_payer_class");
  }
  if (normalized.size > 0) {
    fail("payer classes do not identify Bazaar quality payers", "catalog_payers_are_not_identities");
  }
}

export function reconcileSellerIntegrityEvent({
  catalog,
  ledgerContents = null,
  payerClasses = "",
  operationId = null,
  deliveryEvent = null,
} = {}) {
  rejectDirectBank(arguments[0] || {});
  refuseUnjoinedPayerClasses(payerClasses);
  const observation = readSellerIntegrityCatalog(catalog);
  const settlement = settlementFromLedger(ledgerContents);
  let sanitizedDelivery = null;
  if (deliveryEvent !== null && deliveryEvent !== undefined) {
    sanitizedDelivery = sanitizeSettlementSourceDeliveryAttribution(deliveryEvent);
    if (!sanitizedDelivery) {
      fail("delivery event is not canonical source-delivery attribution", "invalid_delivery");
    }
  }
  const deliverySummary = summarizeSettlementSourceDelivery(sanitizedDelivery
    ? {
      sourceDeliveryAttribution: sanitizedDelivery,
      route: SELLER_INTEGRITY_ROUTE,
      paymentClass: "unclassified",
      state: "unknown",
    }
    : {});
  const evidence = buildCommercePaymentEvidenceReadout({
    eventSnapshot: {
      requestedWindowStart: observation.lastCalledAt,
      requestedWindowCoverage: "unknown_for_full_window",
      coverage: { metrics: { external: { coverage: "unknown_for_full_window" } } },
    },
    settlementReconciliation: settlement.supplied
      ? {
        enabled: true,
        settlementEvidenceSince: null,
        ledger: {
          reconciledSettlements: settlement.summary.reconciledSettlements,
          amountAtomic: settlement.summary.amountAtomic,
          byClass: settlement.summary.byClass,
          byRoute: settlement.summary.byRoute,
        },
      }
      : undefined,
  });
  const routeSummary = settlement.routeSummary;
  const pin = R02_SELLER_INTEGRITY_PIN;
  return {
    schemaVersion: SELLER_INTEGRITY_EVENT_RECONCILE_SCHEMA,
    operationId: operationIdOf(operationId),
    bank: false,
    doNotBank: true,
    bankedRevenueInvented: false,
    bankedRevenueUsdc: null,
    catalogEqualsRevenue: false,
    attributable: "unknown",
    attribution: {
      external: 0,
      owner_qa: 0,
      unknown: observation.payers,
      payerIdentityJoinedToCatalog: false,
      reason: "Bazaar quality counters name call and payer counts only. They do not identify wallets, so this row is unknown rather than external or owner/QA.",
    },
    catalog: observation,
    settlement: {
      supplied: settlement.supplied,
      schemaVersion: settlement.summary?.schemaVersion || null,
      reconciledSettlements: settlement.summary?.reconciledSettlements ?? null,
      amountAtomic: settlement.summary?.amountAtomic ?? null,
      invalidLines: settlement.summary?.invalidLines ?? null,
      routeReconciledSettlements: routeSummary?.reconciledSettlements ?? null,
      routeAmountAtomic: routeSummary?.amountAtomic ?? null,
      attributableLabels: routeSummary ? labelsFromByClass(routeSummary.byClass) : null,
      labelsAreCatalogPayers: false,
      numericalCountMatch: Boolean(routeSummary) && routeSummary.reconciledSettlements === observation.calls,
      emptyOrSuppliedZeroIsNotHistoricalRevenue: true,
    },
    delivery: {
      schemaVersion: deliverySummary.schemaVersion,
      originClass: deliverySummary.originClass,
      originVerification: deliverySummary.originVerification,
      customerDemand: deliverySummary.customerDemand,
      buyerValidOutput: deliverySummary.buyerValidOutput,
      deliveryValidation: deliverySummary.deliveryValidation,
      sanitized: sanitizedDelivery !== null,
      originClassDoesNotLabelCatalogPayers: true,
    },
    paymentEvidence: {
      schemaVersion: evidence.schemaVersion,
      relationship: evidence.relationship,
      retainedPaidSuccessActors: evidence.eventPlane.retainedPaidSuccessActors,
      attributableCustomerCount: evidence.customerPlane.attributableCustomerCount,
      buyerValidDeliveryCount: evidence.customerPlane.buyerValidDeliveryCount,
      settlementCoverage: evidence.settlementPlane.coverage,
      retainedEventZeroNeverMeansHistoricalZeroWhenCoverageIncomplete:
        evidence.boundaries.retainedEventZeroNeverMeansHistoricalZeroWhenCoverageIncomplete,
      customerAttributionRequiresSeparateEvidence:
        evidence.boundaries.customerAttributionRequiresSeparateEvidence,
    },
    r02: {
      pilotPull: pin.pilotPull,
      commit: pin.commit,
      label: pin.label,
      matchesPin: observation.calls === pin.calls
        && observation.payers === pin.payers
        && observation.lastCalledAt === pin.lastCalledAt
        && observation.amountAtomic === pin.amountAtomic
        && observation.descriptionLength === pin.descriptionLength
        && observation.featuredPresent === false,
      pathNote: pin.pathNote,
      pilotTreeWriteOwner: pin.pilotTreeWriteOwner,
    },
    tools: [
      ...(settlement.supplied ? ["summarizeCommerceSettlementLedger"] : []),
      "summarizeSettlementSourceDelivery",
      ...(sanitizedDelivery ? ["sanitizeSettlementSourceDeliveryAttribution"] : []),
      "buildCommercePaymentEvidenceReadout",
    ],
    boundary: {
      paymentSent: false,
      settlementExecuted: false,
      pricesChanged: false,
      catalogCountersAreRevenue: false,
      payerIdentityJoinedToCatalog: false,
    },
  };
}

export function sellerIntegritySearchUrl() {
  const url = new URL(SELLER_INTEGRITY_SEARCH);
  url.searchParams.set("query", "seller integrity audit");
  url.searchParams.set("urlSubstring", "samedaydesk.com");
  url.searchParams.set("limit", "5");
  return url;
}

export async function fetchSellerIntegrityCatalog({
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) fail("timeout must be positive", "invalid_args");
  const url = sellerIntegritySearchUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let reader;
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": "SameDayDesk-SellerIntegrityReconcile/1.0 (+https://samedaydesk.com)",
      },
    });
    if (response?.status !== 200) fail(`catalog returned HTTP ${response?.status}`, "catalog_fetch_failed");
    if (response.redirected) fail("catalog redirect refused", "redirect_rejected");
    if (!response.body?.getReader) fail("catalog response has no readable body", "catalog_fetch_failed");
    reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) fail("catalog response exceeded the size cap", "catalog_too_large");
      chunks.push(Buffer.from(value));
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks, size).toString("utf8"));
    } catch {
      fail("catalog response was not valid JSON", "catalog_json_invalid");
    }
    return body;
  } catch (error) {
    if (error instanceof SellerIntegrityReconcileError) throw error;
    if (controller.signal.aborted) fail("catalog deadline exceeded", "catalog_timeout");
    fail("catalog fetch failed", "catalog_fetch_failed");
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (reader) await reader.cancel().catch(() => {});
  }
}

function readCapped(file, label) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    fail(`${label} file is unreadable`, "invalid_args");
  }
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) fail(`${label} exceeded the size cap`, "catalog_too_large");
  return text;
}

function usage() {
  return [
    "Usage: node seller-integrity-event-reconcile.mjs (--catalog file.json | --live) [--ledger file.ndjson] [--operation-id uuid] [--payer-classes json]",
    "Catalog quality counters are not banked. Exit 0 writes a reconcile report. Exit 1 refuses a bank or identity claim.",
  ].join("\n");
}

export async function runSellerIntegrityReconcileCli(argv = process.argv.slice(2), {
  stdout = (value) => console.log(value),
  stderr = (value) => console.error(value),
  fetchImpl = globalThis.fetch,
  cwd = process.cwd(),
} = {}) {
  const args = {
    catalog: null,
    ledger: null,
    live: false,
    operationId: null,
    payerClasses: null,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) fail(`missing value for ${arg}`, "usage");
      index += 1;
      return value;
    };
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--live") args.live = true;
    else if (arg === "--catalog") args.catalog = next();
    else if (arg === "--ledger") args.ledger = next();
    else if (arg === "--operation-id") args.operationId = next();
    else if (arg === "--payer-classes") args.payerClasses = next();
    else fail(`unknown argument ${arg}`, "usage");
  }
  if (args.help) {
    stdout(usage());
    return 0;
  }
  if (args.live === Boolean(args.catalog)) fail("pass exactly one of --catalog or --live", "usage");
  const catalog = args.live
    ? await fetchSellerIntegrityCatalog({ fetchImpl })
    : JSON.parse(readCapped(resolve(cwd, args.catalog), "catalog"));
  const ledgerContents = args.ledger ? readCapped(resolve(cwd, args.ledger), "ledger") : null;
  const report = reconcileSellerIntegrityEvent({
    catalog,
    ledgerContents,
    payerClasses: args.payerClasses === null ? "" : args.payerClasses,
    operationId: args.operationId,
  });
  stdout(JSON.stringify(report, null, 2));
  return 0;
}

function errorCode(error) {
  if (error instanceof SellerIntegrityReconcileError) return error.code === "usage" ? 2 : 1;
  if (error instanceof SyntaxError) return 1;
  return 64;
}

async function main() {
  try {
    process.exitCode = await runSellerIntegrityReconcileCli();
  } catch (error) {
    const code = error instanceof SellerIntegrityReconcileError
      ? error.code
      : (error instanceof SyntaxError ? "invalid_catalog" : "unexpected");
    console.error(JSON.stringify({
      ok: false,
      code,
      message: error instanceof Error ? error.message : "reconcile failed",
      bankedRevenueInvented: false,
    }));
    process.exitCode = errorCode(error);
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] || "")).href) {
  await main();
}
