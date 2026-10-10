import { createHash } from "node:crypto";

import { readCommerceSettlementAdmission } from "./commerce-settlement-reconciler.mjs";
import checkedUnitCatalog from "./commerce-settlement-unit-catalog.json" with { type: "json" };

export const SETTLEMENT_UNIT_SCHEMA = "samedaydesk.commerce-settlement-unit.v1";
const SUMMARY_SCHEMA = "samedaydesk.commerce-settlement-summary.v1";
const NETWORK_PATTERN = /^eip155:[1-9][0-9]{0,9}$/;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const SYMBOL_PATTERN = /^[A-Z0-9]{2,12}$/;

const BOUNDARIES = Object.freeze({
  unitIsNotIncome: true,
  unitIsNotCustomerAttribution: true,
  unitIsNotAcceptedDelivery: true,
  mixedAtomicTotalsAreNotOneAsset: true,
  parentSummaryRemainsMoneyAuthority: true,
});

const DECISIONS = Object.freeze([
  "qualified",
  "missing",
  "partial",
  "conflicting",
  "rejected",
  "unmapped",
  "empty",
  "stale_cut",
  "unreadable",
  "absent",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function absent(value) {
  return value === undefined || value === null;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = stableValue(value[key]);
      return out;
    }, {});
  }
  return value;
}

function sameValue(left, right) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function claimedStatus(catalog) {
  const stack = [catalog];
  const seen = new Set();
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    for (const [key, item] of Object.entries(current)) {
      if (/^(status|qualified|verified|completeness|usableentries|complete)$/i.test(key)) return true;
      if (item && typeof item === "object") stack.push(item);
    }
  }
  return false;
}

function sameCheckedEntry(entry) {
  const checked = checkedUnitCatalog.entries[0];
  return Boolean(
    entry
    && entry.network === checked.network
    && entry.chainId === checked.chainId
    && entry.asset === checked.asset
    && entry.symbol === checked.symbol
    && entry.decimals === checked.decimals,
  );
}

function catalogFailure(catalog) {
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) return "catalog_incomplete";
  if (catalog.schemaVersion !== checkedUnitCatalog.schemaVersion || catalog.checkedAt !== checkedUnitCatalog.checkedAt) {
    return "catalog_provenance";
  }
  if (claimedStatus(catalog)) return "catalog_claimed_status";
  if (!Array.isArray(catalog.entries)) return "catalog_incomplete";
  const usable = usableEntries(catalog);
  if (usable.length !== catalog.entries.length) return "catalog_incomplete";
  const seen = new Map();
  for (const entry of usable) {
    const key = `${entry.network}|${entry.asset.toLowerCase()}`;
    const prior = seen.get(key);
    if (prior) {
      if (prior.decimals !== entry.decimals || prior.symbol !== entry.symbol || prior.chainId !== entry.chainId) {
        return "catalog_conflict";
      }
      return "catalog_duplicate";
    }
    seen.set(key, entry);
  }
  if (usable.length !== 1 || !sameCheckedEntry(usable[0])) return "catalog_unsupported";
  return "catalog_provenance";
}

function assessCatalog(catalog) {
  if (sameValue(catalog, checkedUnitCatalog)) {
    return { entries: usableEntries(catalog), invalid: false, reason: null };
  }
  return { entries: [], invalid: true, reason: catalogFailure(catalog) };
}

function usableEntries(catalog) {
  if (!catalog || typeof catalog !== "object" || !Array.isArray(catalog.entries)) return [];
  return catalog.entries.filter((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    if (typeof entry.network !== "string" || !NETWORK_PATTERN.test(entry.network)) return false;
    const chainId = Number(entry.network.slice("eip155:".length));
    if (!Number.isInteger(entry.chainId) || entry.chainId !== chainId) return false;
    if (typeof entry.asset !== "string" || !ADDRESS_PATTERN.test(entry.asset)) return false;
    if (typeof entry.symbol !== "string" || !SYMBOL_PATTERN.test(entry.symbol)) return false;
    if (!Number.isInteger(entry.decimals) || entry.decimals < 0 || entry.decimals > 36) return false;
    return true;
  });
}

function findEntry(entries, network, asset) {
  const normalized = asset.toLowerCase();
  return entries.find((entry) => entry.network === network && entry.asset.toLowerCase() === normalized) || null;
}

function classifyRecord(record, entries) {
  const networkAbsent = absent(record.network);
  const assetAbsent = absent(record.asset);
  if (networkAbsent && assetAbsent) {
    if (!absent(record.decimals) || !absent(record.symbol) || !absent(record.currency)) {
      return { kind: "rejected", reason: "unit_fields_without_network_asset" };
    }
    return { kind: "missing" };
  }
  if (networkAbsent || assetAbsent) return { kind: "rejected", reason: "incomplete_unit_pair" };
  if (typeof record.network !== "string" || !NETWORK_PATTERN.test(record.network)) {
    return { kind: "rejected", reason: "malformed_network" };
  }
  if (typeof record.asset !== "string" || !ADDRESS_PATTERN.test(record.asset)) {
    return { kind: "rejected", reason: "malformed_asset" };
  }
  const entry = findEntry(entries, record.network, record.asset);
  if (!absent(record.decimals)) {
    if (!Number.isInteger(record.decimals) || record.decimals < 0 || record.decimals > 36) {
      return { kind: "rejected", reason: "malformed_decimals" };
    }
    if (!entry || record.decimals !== entry.decimals) return { kind: "rejected", reason: "forged_decimals" };
  }
  if (!absent(record.symbol)) {
    if (typeof record.symbol !== "string" || !entry || record.symbol !== entry.symbol) {
      return { kind: "rejected", reason: "forged_symbol" };
    }
  }
  if (!absent(record.currency)) {
    if (typeof record.currency !== "string" || !entry || record.currency !== entry.symbol) {
      return { kind: "rejected", reason: "forged_currency" };
    }
  }
  if (!entry) {
    return { kind: "unmapped", network: record.network, asset: record.asset.toLowerCase() };
  }
  return { kind: "qualified", entry };
}

function emptyCoverage() {
  return {
    admittedRecords: 0,
    missingUnit: 0,
    qualifiedUnit: 0,
    unmappedUnit: 0,
    rejectedUnit: 0,
    duplicateReferencesIgnored: 0,
    invalidLines: 0,
  };
}

function summaryFieldsMatch(supplied, summary) {
  if (!supplied || typeof supplied !== "object" || Array.isArray(supplied)) return false;
  return supplied.schemaVersion === summary.schemaVersion
    && supplied.reconciledSettlements === summary.reconciledSettlements
    && supplied.distinctSettlementReferences === summary.distinctSettlementReferences
    && supplied.amountAtomic === summary.amountAtomic
    && supplied.invalidLines === summary.invalidLines
    && sameValue(supplied.byClass, summary.byClass)
    && sameValue(supplied.byRoute, summary.byRoute);
}

function parentBinding(admission, parentSummary, admissionCutId) {
  const summary = admission.summary;
  if (parentSummary == null && admissionCutId == null) {
    return {
      reconciledSettlements: summary.reconciledSettlements,
      amountAtomic: summary.amountAtomic,
      admissionCutId: admission.admissionCutId,
      matchesSuppliedSummary: null,
    };
  }
  return {
    reconciledSettlements: summary.reconciledSettlements,
    amountAtomic: summary.amountAtomic,
    admissionCutId: admission.admissionCutId,
    matchesSuppliedSummary: summaryFieldsMatch(parentSummary, summary) && admissionCutId === admission.admissionCutId,
  };
}

function catalogInfo(catalog, usableCount) {
  return {
    schemaVersion: typeof catalog?.schemaVersion === "string" ? catalog.schemaVersion : null,
    checkedAt: typeof catalog?.checkedAt === "string" ? catalog.checkedAt : null,
    usableEntries: usableCount,
  };
}

function baseProjection(catalog, usableCount, sourceCutSha256) {
  return {
    schemaVersion: SETTLEMENT_UNIT_SCHEMA,
    decision: "rejected",
    comparable: false,
    unit: null,
    atomicScale: null,
    bindsToParent: null,
    coverage: emptyCoverage(),
    rejectedReasons: {},
    reasons: ["rejected_unit_metadata"],
    catalog: catalogInfo(catalog, usableCount),
    boundaries: { ...BOUNDARIES },
    recognizedIncomeAtomic: null,
    customerAttribution: null,
    sourceCutSha256,
  };
}

function decide(rows) {
  if (rows.length === 0) return "empty";
  const kinds = new Set(rows.map((row) => row.kind));
  if (kinds.size === 1 && kinds.has("missing")) return "missing";
  if (kinds.size === 1 && kinds.has("rejected")) return "rejected";
  if (kinds.size === 1 && kinds.has("qualified")) {
    const keys = new Set(rows.map((row) => `${row.entry.network}|${row.entry.asset.toLowerCase()}|${row.entry.decimals}|${row.entry.symbol}`));
    return keys.size === 1 ? "qualified" : "conflicting";
  }
  if (kinds.size === 1 && kinds.has("unmapped")) {
    const keys = new Set(rows.map((row) => `${row.network}|${row.asset}`));
    return keys.size === 1 ? "unmapped" : "conflicting";
  }
  if (kinds.has("missing")) return "partial";
  return "conflicting";
}

function reasonFor(decision, catalogReason) {
  const reasons = [];
  if (catalogReason) reasons.push("catalog_invalid", catalogReason);
  const byDecision = {
    qualified: "qualified_single_catalog_unit",
    missing: "missing_unit_metadata",
    partial: "partial_unit_metadata",
    conflicting: "conflicting_unit_metadata",
    rejected: "rejected_unit_metadata",
    unmapped: "unmapped_unit",
    empty: "empty_admitted_cut",
    stale_cut: "stale_parent_cut",
    unreadable: "unreadable_cut",
    absent: "unit_projection_not_supplied",
  };
  reasons.push(byDecision[decision]);
  return reasons.sort();
}

export function projectCommerceSettlementUnit(contents, options = {}) {
  const catalog = options.catalog === undefined ? checkedUnitCatalog : options.catalog;
  const assessment = assessCatalog(catalog);
  const entries = assessment.entries;
  const catalogReason = assessment.invalid ? assessment.reason : null;
  if (typeof contents !== "string") {
    const projection = baseProjection(catalog, entries.length, null);
    projection.decision = "unreadable";
    projection.reasons = reasonFor("unreadable", catalogReason);
    projection.coverage = null;
    return projection;
  }
  const admission = readCommerceSettlementAdmission(contents, {
    paymentClassBySourceEventId: options.paymentClassBySourceEventId,
  });
  const binding = parentBinding(admission, options.parentSummary, options.admissionCutId);
  const rows = [];
  const rejectedReasons = {};
  for (const record of admission.admitted) {
    let row;
    try {
      row = classifyRecord(record, entries);
    } catch {
      row = { kind: "rejected", reason: "hostile_unit_metadata" };
    }
    if (row.kind === "rejected") rejectedReasons[row.reason] = (rejectedReasons[row.reason] || 0) + 1;
    rows.push(row);
  }
  let decision = decide(rows);
  if (binding.matchesSuppliedSummary === false) decision = "stale_cut";
  const projection = baseProjection(catalog, entries.length, sha256(contents));
  projection.decision = decision;
  projection.comparable = decision === "qualified";
  projection.reasons = reasonFor(decision, catalogReason && decision !== "stale_cut" && decision !== "empty" ? catalogReason : null);
  projection.rejectedReasons = rejectedReasons;
  projection.bindsToParent = {
    summarySchema: SUMMARY_SCHEMA,
    reconciledSettlements: binding.reconciledSettlements,
    amountAtomic: binding.amountAtomic,
    admissionCutId: binding.admissionCutId,
    matchesSuppliedSummary: binding.matchesSuppliedSummary,
  };
  projection.coverage = {
    admittedRecords: admission.admitted.length,
    missingUnit: rows.filter((row) => row.kind === "missing").length,
    qualifiedUnit: rows.filter((row) => row.kind === "qualified").length,
    unmappedUnit: rows.filter((row) => row.kind === "unmapped").length,
    rejectedUnit: rows.filter((row) => row.kind === "rejected").length,
    duplicateReferencesIgnored: admission.duplicateReferencesIgnored,
    invalidLines: admission.summary.invalidLines,
  };
  if (decision === "qualified") {
    const entry = rows[0].entry;
    projection.unit = {
      network: entry.network,
      asset: entry.asset,
      symbol: entry.symbol,
      decimals: entry.decimals,
    };
    projection.atomicScale = (10n ** BigInt(entry.decimals)).toString();
  } else if (decision === "unmapped") {
    projection.unit = {
      network: rows[0].network,
      asset: rows[0].asset,
      symbol: null,
      decimals: null,
    };
  }
  return projection;
}

export function unprojectedSettlementUnit() {
  return {
    schemaVersion: SETTLEMENT_UNIT_SCHEMA,
    decision: "absent",
    comparable: false,
    unit: null,
    atomicScale: null,
    bindsToParent: null,
    coverage: null,
    rejectedReasons: {},
    reasons: ["unit_projection_not_supplied"],
    catalog: null,
    boundaries: { ...BOUNDARIES },
    recognizedIncomeAtomic: null,
    customerAttribution: null,
    sourceCutSha256: null,
  };
}

function nullable(schema) {
  return { anyOf: [schema, { type: "null" }] };
}

export function commerceSettlementUnitOutputSchema() {
  const unitSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      network: { type: "string" },
      asset: { type: "string" },
      symbol: nullable({ type: "string" }),
      decimals: nullable({ type: "integer", minimum: 0, maximum: 36 }),
    },
    required: ["network", "asset", "symbol", "decimals"],
  };
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      schemaVersion: { type: "string", const: SETTLEMENT_UNIT_SCHEMA },
      decision: { type: "string", enum: [...DECISIONS] },
      comparable: { type: "boolean" },
      unit: nullable(unitSchema),
      atomicScale: nullable({ type: "string", pattern: "^[1-9][0-9]{0,36}$" }),
      bindsToParent: nullable({
        type: "object",
        additionalProperties: false,
        properties: {
          summarySchema: { type: "string", const: SUMMARY_SCHEMA },
          reconciledSettlements: { type: "integer", minimum: 0 },
          amountAtomic: { type: "string", pattern: "^\\d+$" },
          admissionCutId: { type: "string", pattern: "^[0-9a-f]{64}$" },
          matchesSuppliedSummary: nullable({ type: "boolean" }),
        },
        required: ["summarySchema", "reconciledSettlements", "amountAtomic", "admissionCutId", "matchesSuppliedSummary"],
      }),
      coverage: nullable({
        type: "object",
        additionalProperties: false,
        properties: {
          admittedRecords: { type: "integer", minimum: 0 },
          missingUnit: { type: "integer", minimum: 0 },
          qualifiedUnit: { type: "integer", minimum: 0 },
          unmappedUnit: { type: "integer", minimum: 0 },
          rejectedUnit: { type: "integer", minimum: 0 },
          duplicateReferencesIgnored: { type: "integer", minimum: 0 },
          invalidLines: { type: "integer", minimum: 0 },
        },
        required: [
          "admittedRecords",
          "missingUnit",
          "qualifiedUnit",
          "unmappedUnit",
          "rejectedUnit",
          "duplicateReferencesIgnored",
          "invalidLines",
        ],
      }),
      rejectedReasons: {
        type: "object",
        additionalProperties: { type: "integer", minimum: 1 },
      },
      reasons: {
        type: "array",
        minItems: 1,
        items: { type: "string", pattern: "^[a-z0-9_]+$" },
      },
      catalog: nullable({
        type: "object",
        additionalProperties: false,
        properties: {
          schemaVersion: nullable({ type: "string" }),
          checkedAt: nullable({ type: "string" }),
          usableEntries: { type: "integer", minimum: 0 },
        },
        required: ["schemaVersion", "checkedAt", "usableEntries"],
      }),
      boundaries: {
        type: "object",
        additionalProperties: false,
        properties: {
          unitIsNotIncome: { type: "boolean", const: true },
          unitIsNotCustomerAttribution: { type: "boolean", const: true },
          unitIsNotAcceptedDelivery: { type: "boolean", const: true },
          mixedAtomicTotalsAreNotOneAsset: { type: "boolean", const: true },
          parentSummaryRemainsMoneyAuthority: { type: "boolean", const: true },
        },
        required: [
          "unitIsNotIncome",
          "unitIsNotCustomerAttribution",
          "unitIsNotAcceptedDelivery",
          "mixedAtomicTotalsAreNotOneAsset",
          "parentSummaryRemainsMoneyAuthority",
        ],
      },
      recognizedIncomeAtomic: { type: "null" },
      customerAttribution: { type: "null" },
      sourceCutSha256: nullable({ type: "string", pattern: "^[0-9a-f]{64}$" }),
    },
    required: [
      "schemaVersion",
      "decision",
      "comparable",
      "unit",
      "atomicScale",
      "bindsToParent",
      "coverage",
      "rejectedReasons",
      "reasons",
      "catalog",
      "boundaries",
      "recognizedIncomeAtomic",
      "customerAttribution",
      "sourceCutSha256",
    ],
  };
}

export { DECISIONS };
