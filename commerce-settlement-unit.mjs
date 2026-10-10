import { createHash } from "node:crypto";

import checkedUnitCatalog from "./commerce-settlement-unit-catalog.json" with { type: "json" };

export const SETTLEMENT_UNIT_SCHEMA = "samedaydesk.commerce-settlement-unit.v1";
const SUMMARY_SCHEMA = "samedaydesk.commerce-settlement-summary.v1";
const RECORD_SCHEMA = "samedaydesk.commerce-settlement-reconciliation.v1";
const TRANSACTION_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
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

function parseLines(contents) {
  let invalidLines = 0;
  const records = String(contents || "").split("\n").filter(Boolean).flatMap((line) => {
    try {
      const parsed = JSON.parse(line);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? [parsed] : [];
    } catch {
      invalidLines += 1;
      return [];
    }
  });
  return { invalidLines, records };
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

function admitLedger(contents) {
  const parsed = parseLines(contents);
  const references = new Set();
  const admitted = [];
  let duplicateReferencesIgnored = 0;
  for (const record of parsed.records) {
    if (record?.schemaVersion !== RECORD_SCHEMA || record?.state !== "reconciled") continue;
    if (!TRANSACTION_HASH_PATTERN.test(String(record.settlementReference || ""))) continue;
    if (!/^\d+$/.test(String(record.amountAtomic || ""))) continue;
    const reference = String(record.settlementReference).toLowerCase();
    if (references.has(reference)) {
      duplicateReferencesIgnored += 1;
      continue;
    }
    references.add(reference);
    admitted.push(record);
  }
  let amountAtomic = 0n;
  for (const record of admitted) amountAtomic += BigInt(record.amountAtomic);
  return {
    admitted,
    duplicateReferencesIgnored,
    invalidLines: parsed.invalidLines,
    reconciledSettlements: admitted.length,
    amountAtomic: amountAtomic.toString(),
  };
}

function parentBinding(walk, parentSummary) {
  if (parentSummary == null) {
    return {
      reconciledSettlements: walk.reconciledSettlements,
      amountAtomic: walk.amountAtomic,
      matchesSuppliedSummary: null,
    };
  }
  const supplied = parentSummary && typeof parentSummary === "object" && !Array.isArray(parentSummary)
    ? parentSummary
    : null;
  const schemaOk = supplied?.schemaVersion == null || supplied.schemaVersion === SUMMARY_SCHEMA;
  const matches = Boolean(
    supplied
    && schemaOk
    && supplied.reconciledSettlements === walk.reconciledSettlements
    && supplied.amountAtomic === walk.amountAtomic,
  );
  return {
    reconciledSettlements: walk.reconciledSettlements,
    amountAtomic: walk.amountAtomic,
    matchesSuppliedSummary: matches,
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

function reasonFor(decision, catalogInvalid) {
  const reasons = [];
  if (catalogInvalid) reasons.push("catalog_invalid");
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
  const entries = usableEntries(catalog);
  const catalogInvalid = entries.length === 0;
  if (typeof contents !== "string") {
    const projection = baseProjection(catalog, entries.length, null);
    projection.decision = "unreadable";
    projection.reasons = reasonFor("unreadable", catalogInvalid);
    projection.coverage = null;
    return projection;
  }
  const walk = admitLedger(contents);
  const binding = parentBinding(walk, options.parentSummary);
  const rows = [];
  const rejectedReasons = {};
  for (const record of walk.admitted) {
    let row;
    try {
      row = classifyRecord(record, entries);
    } catch {
      row = { kind: "rejected", reason: "hostile_unit_metadata" };
    }
    if (catalogInvalid && row.kind === "qualified") row = { kind: "unmapped", network: row.entry.network, asset: row.entry.asset.toLowerCase() };
    if (row.kind === "rejected") rejectedReasons[row.reason] = (rejectedReasons[row.reason] || 0) + 1;
    rows.push(row);
  }
  let decision = decide(rows);
  if (binding.matchesSuppliedSummary === false) decision = "stale_cut";
  const projection = baseProjection(catalog, entries.length, sha256(contents));
  projection.decision = decision;
  projection.comparable = decision === "qualified";
  projection.reasons = reasonFor(decision, catalogInvalid && decision !== "stale_cut" && decision !== "empty");
  projection.rejectedReasons = rejectedReasons;
  projection.bindsToParent = {
    summarySchema: SUMMARY_SCHEMA,
    reconciledSettlements: binding.reconciledSettlements,
    amountAtomic: binding.amountAtomic,
    matchesSuppliedSummary: binding.matchesSuppliedSummary,
  };
  projection.coverage = {
    admittedRecords: walk.admitted.length,
    missingUnit: rows.filter((row) => row.kind === "missing").length,
    qualifiedUnit: rows.filter((row) => row.kind === "qualified").length,
    unmappedUnit: rows.filter((row) => row.kind === "unmapped").length,
    rejectedUnit: rows.filter((row) => row.kind === "rejected").length,
    duplicateReferencesIgnored: walk.duplicateReferencesIgnored,
    invalidLines: walk.invalidLines,
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
          matchesSuppliedSummary: nullable({ type: "boolean" }),
        },
        required: ["summarySchema", "reconciledSettlements", "amountAtomic", "matchesSuppliedSummary"],
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
