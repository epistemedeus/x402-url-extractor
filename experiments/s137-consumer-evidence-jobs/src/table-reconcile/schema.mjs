/**
 * S137 c11 — table-reconcile schema (R2-CONSUMER-JOBS-03).
 *
 * Source tables join on explicit keys, units, and time windows.
 * This module validates shapes and primitives. It does not merge rows
 * (c12), load fixtures (c13/c14), or invent totals.
 *
 * Evidence: synthetic | fixture | live-capture. Offline. No network.
 */

import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import {
  PACKET_SCHEMA,
  EVIDENCE_CLASSES,
  DECISIONS,
  createEnvelope,
  requireCitedFinding,
} from "../packet.mjs";

export const JOB_ID = "R2-CONSUMER-JOBS-03";
export const ARTIFACT_KIND = "table-reconcile";
export const INPUT_SCHEMA = "s137.table-reconcile.input.v1";
export const OUTPUT_SCHEMA = "s137.table-reconcile.output.v1";
export const CASE_SCHEMA = "s137.table-reconcile.case.v1";
export const SOURCE_TABLE_SCHEMA = "s137.table-reconcile.source-table.v1";
export const PAIR_FIXTURE_SCHEMA = "s137.consumer-evidence.table-pair-fixture.v1";
export { PACKET_SCHEMA, EVIDENCE_CLASSES, DECISIONS };

/** Case polarity. `conflicting` is accepted as an alias of `conflict` (c13/c14 pin `conflict`). */
export const CASE_KINDS = Object.freeze([
  "positive",
  "negative",
  "partial",
  "conflict",
]);

export const FINDING_KINDS = Object.freeze([
  "positive",
  "negative",
  "partial",
  "conflict",
  "conflicting",
  "agree",
  "value-conflict",
  "unit-conflict",
  "time-window-mismatch",
  "missing-in-source",
  "invalid-input",
]);

export const ROW_OUTCOMES = Object.freeze([
  "agree",
  "conflict",
  "partial",
  "unkeyed",
  "window_mismatch",
  "unit_mismatch",
  "excluded",
]);

export const COLUMN_ROLES = Object.freeze([
  "key",
  "measure",
  "time",
  "bound",
  "attribute",
  "unit",
]);

export const WINDOW_STATUSES = Object.freeze([
  "specified",
  "partial",
  "unspecified",
  "invalid",
]);

export const POLICIES = Object.freeze({
  neverInventTotals: true,
  neverCoalesceUnitMismatch: true,
  surfaceDisagreement: true,
  requireCitations: true,
  operatorClockRequired: true,
  conversionsMustBeDeclared: true,
});

export const LIMITS = Object.freeze({
  maxTables: 32,
  maxColumns: 64,
  maxKeys: 8,
  maxRowsPerTable: 10_000,
  maxStringChars: 4096,
  maxCitations: 256,
  maxFindings: 256,
  maxConversions: 64,
});

export const LIMITATIONS = Object.freeze([
  "Does not merge tables or compare row values (c12).",
  "Does not load pack fixtures (c13/c14) or run pack-level tests (c15).",
  "Does not convert units unless the operator supplies an explicit conversion.",
  "Does not invent missing rows, filled windows, or totals.",
  "Date-only bounds are UTC midnight instants; end-of-day is not inferred.",
  "Unspecified time windows make comparability partial, not global.",
  "Unknown unit identifiers are not assumed compatible.",
  "No network, paid endpoints, legal attestation, or demand claims.",
]);

const HOSTILE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const CLOCK_ISO =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Identifier catalog only. Same dimension does not imply convertibility.
 * Factors live in input.join.conversions, never here.
 */
export const UNIT_CATALOG = Object.freeze({
  count: { id: "count", dimension: "count", aliases: ["1", "items", "n"] },
  percent: { id: "percent", dimension: "ratio", aliases: ["%", "pct"] },
  ratio: { id: "ratio", dimension: "ratio", aliases: [] },
  usd: { id: "usd", dimension: "currency", aliases: ["USD", "US$"] },
  iso_datetime: {
    id: "iso_datetime",
    dimension: "time_point",
    aliases: ["iso8601", "datetime"],
  },
  iso_date: { id: "iso_date", dimension: "time_point", aliases: ["date"] },
  second: { id: "second", dimension: "duration", aliases: ["s", "sec"] },
  millisecond: {
    id: "millisecond",
    dimension: "duration",
    aliases: ["ms"],
  },
  count_per_day: {
    id: "count_per_day",
    dimension: "rate",
    aliases: ["count/day", "per_day"],
  },
});

const UNIT_ALIAS = (() => {
  const map = new Map();
  for (const entry of Object.values(UNIT_CATALOG)) {
    map.set(entry.id, entry);
    map.set(entry.id.toLowerCase(), entry);
    for (const alias of entry.aliases) map.set(String(alias).toLowerCase(), entry);
  }
  return map;
})();

export const FORBIDDEN_TOTAL_FIELDS = Object.freeze([
  "inventedTotal",
  "guessedSum",
  "modelEstimate",
  "averageAcrossSources",
]);

export function makeIssue({
  kind,
  code,
  keyword,
  instancePath,
  schemaPath,
  message,
  params = {},
}) {
  return {
    kind,
    code,
    keyword: keyword || code,
    instancePath,
    schemaPath: schemaPath || `#${instancePath || ""}`,
    message,
    params,
  };
}

export function sha256Hex(value) {
  const input =
    typeof value === "string" || Buffer.isBuffer(value)
      ? value
      : stableStringify(value);
  return createHash("sha256").update(input).digest("hex");
}

export function stableStringify(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
    return out;
  }
  return value;
}

function isPlainObject(value) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasHostileKey(value, depth = 0) {
  if (depth > 8 || value == null || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.some((item) => hasHostileKey(item, depth + 1));
  }
  for (const key of Object.keys(value)) {
    if (HOSTILE_KEYS.has(key)) return true;
    if (hasHostileKey(value[key], depth + 1)) return true;
  }
  return false;
}

function tooLong(text) {
  return typeof text === "string" && text.length > LIMITS.maxStringChars;
}

export function normalizeCaseKind(kind) {
  if (kind === "conflicting") return "conflict";
  return kind;
}

const GRAIN_ALIASES = Object.freeze({
  day: "P1D",
  d: "P1D",
  week: "P7D",
  w: "P7D",
  p1d: "P1D",
  p7d: "P7D",
  p1w: "P1W",
});

/**
 * Grain is an ISO-8601 duration or a documented alias (`day` → `P1D`).
 * Different grains over the same span are not rolled up.
 */
export function parseGrain(raw, instancePath = "/grain") {
  if (raw == null || raw === "") {
    return { ok: true, status: "unspecified", iso: null, raw: raw ?? null, issues: [] };
  }
  if (typeof raw !== "string") {
    return {
      ok: false,
      status: "invalid",
      iso: null,
      raw,
      issues: [
        makeIssue({
          kind: "invalid",
          code: "type",
          instancePath,
          message: "grain must be a string (ISO-8601 duration or day|week)",
        }),
      ],
    };
  }
  const trimmed = raw.trim();
  if (!trimmed || tooLong(trimmed)) {
    return {
      ok: false,
      status: "invalid",
      iso: null,
      raw: trimmed,
      issues: [
        makeIssue({
          kind: "invalid",
          code: "pattern",
          instancePath,
          message: "grain is empty or too long",
        }),
      ],
    };
  }
  const aliased = GRAIN_ALIASES[trimmed.toLowerCase()];
  const iso = aliased || trimmed.toUpperCase();
  if (!/^P\d+[DWM]$/.test(iso)) {
    return {
      ok: false,
      status: "invalid",
      iso: null,
      raw: trimmed,
      issues: [
        makeIssue({
          kind: "invalid",
          code: "pattern",
          instancePath,
          message: "grain must be PnD / PnW or alias day|week",
        }),
      ],
    };
  }
  return { ok: true, status: "specified", iso, raw: trimmed, issues: [] };
}

export function grainsCompatible(leftRaw, rightRaw) {
  const left = parseGrain(leftRaw);
  const right = parseGrain(rightRaw);
  if (!left.ok || !right.ok) return { compatible: false, status: "invalid", left, right };
  if (left.status === "unspecified" || right.status === "unspecified") {
    return { compatible: false, status: "unknown", left, right };
  }
  return {
    compatible: left.iso === right.iso,
    status: left.iso === right.iso ? "equal" : "mismatch",
    left,
    right,
  };
}

export function isIsoDateTime(text) {
  return typeof text === "string" && CLOCK_ISO.test(text) && Number.isFinite(Date.parse(text));
}

export function isIsoDate(text) {
  return typeof text === "string" && DATE_ISO.test(text);
}

export function parseInstant(raw, instancePath = "/instant") {
  if (raw == null || raw === "") {
    return {
      ok: false,
      ms: null,
      iso: null,
      issues: [
        makeIssue({
          kind: "invalid",
          code: "required",
          instancePath,
          message: "timestamp required",
        }),
      ],
    };
  }
  if (typeof raw !== "string") {
    return {
      ok: false,
      ms: null,
      iso: null,
      issues: [
        makeIssue({
          kind: "invalid",
          code: "type",
          instancePath,
          message: "timestamp must be an ISO-8601 string",
        }),
      ],
    };
  }
  if (raw === "now" || raw === "today") {
    return {
      ok: false,
      ms: null,
      iso: null,
      issues: [
        makeIssue({
          kind: "invalid",
          code: "invented_clock",
          instancePath,
          message: "operator clock must be explicit ISO-8601; do not use now",
        }),
      ],
    };
  }
  if (isIsoDate(raw)) {
    const iso = `${raw}T00:00:00.000Z`;
    return { ok: true, ms: Date.parse(iso), iso, issues: [] };
  }
  if (!isIsoDateTime(raw)) {
    return {
      ok: false,
      ms: null,
      iso: null,
      issues: [
        makeIssue({
          kind: "invalid",
          code: "pattern",
          instancePath,
          message: "timestamp must be ISO-8601 date or date-time",
        }),
      ],
    };
  }
  return { ok: true, ms: Date.parse(raw), iso: raw, issues: [] };
}

/**
 * Time window. Date-only bounds are UTC midnight. End-of-day is not inferred.
 * Default: start inclusive, end exclusive.
 * Missing start and/or end ⇒ status "partial" (comparability not global).
 */
export function parseTimeWindow(raw, instancePath = "/timeWindow", options = {}) {
  if (raw == null) {
    return {
      ok: true,
      status: "unspecified",
      window: null,
      issues: [],
    };
  }
  if (!isPlainObject(raw)) {
    return {
      ok: false,
      status: "invalid",
      window: null,
      issues: [
        makeIssue({
          kind: "invalid",
          code: "type",
          instancePath,
          message: "timeWindow must be an object",
        }),
      ],
    };
  }
  if (hasHostileKey(raw)) {
    return {
      ok: false,
      status: "invalid",
      window: null,
      issues: [
        makeIssue({
          kind: "invalid",
          code: "hostile_key",
          instancePath,
          message: "timeWindow contains a hostile key",
        }),
      ],
    };
  }

  const issues = [];
  const hasStart = Object.prototype.hasOwnProperty.call(raw, "start") && raw.start != null && raw.start !== "";
  const hasEnd = Object.prototype.hasOwnProperty.call(raw, "end") && raw.end != null && raw.end !== "";
  const inclusiveStart = raw.inclusiveStart !== false;
  let inclusiveEnd = raw.inclusiveEnd === true;
  if (options.windowInclusive === true && raw.inclusiveEnd == null) {
    inclusiveEnd = true;
  }
  const grain = parseGrain(raw.grain, `${instancePath}/grain`);
  issues.push(...grain.issues);

  let start = null;
  let end = null;
  if (hasStart) {
    const parsed = parseInstant(raw.start, `${instancePath}/start`);
    issues.push(...parsed.issues);
    if (parsed.ok) start = parsed;
  }
  if (hasEnd) {
    const parsed = parseInstant(raw.end, `${instancePath}/end`);
    issues.push(...parsed.issues);
    if (parsed.ok) end = parsed;
  }

  if (issues.some((issue) => issue.kind === "invalid")) {
    return { ok: false, status: "invalid", window: null, issues };
  }

  if (start && end && start.ms > end.ms) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "window_order",
        instancePath,
        message: "timeWindow.start must be <= timeWindow.end",
      }),
    );
    return { ok: false, status: "invalid", window: null, issues };
  }

  const specified = hasStart && hasEnd;
  const status = specified ? "specified" : hasStart || hasEnd ? "partial" : "unspecified";
  return {
    ok: true,
    status,
    window: {
      start: start ? start.iso : null,
      end: end ? end.iso : null,
      startMs: start ? start.ms : null,
      endMs: end ? end.ms : null,
      inclusiveStart,
      inclusiveEnd,
      grain: grain.iso,
      grainStatus: grain.status,
      status,
    },
    issues,
  };
}

export function windowsOverlap(left, right) {
  if (!left || !right) return { status: "unknown", overlap: null };
  if (left.status === "unspecified" || right.status === "unspecified") {
    return { status: "unknown", overlap: null };
  }
  if (left.status === "invalid" || right.status === "invalid") {
    return { status: "invalid", overlap: false };
  }
  const a0 = boundMs(left, "start");
  const a1 = boundMs(left, "end");
  const b0 = boundMs(right, "start");
  const b1 = boundMs(right, "end");
  if (a0 == null || a1 == null || b0 == null || b1 == null) {
    return { status: "unknown", overlap: null };
  }
  const overlap = a0 < b1 && b0 < a1;
  return { status: overlap ? "overlap" : "disjoint", overlap };
}

function boundMs(window, which) {
  if (which === "start") {
    if (window.startMs == null) return null;
    return window.inclusiveStart ? window.startMs : window.startMs + 1;
  }
  if (window.endMs == null) return null;
  return window.inclusiveEnd ? window.endMs + 1 : window.endMs;
}

export function windowContainsInstant(window, iso, instancePath = "/instant") {
  if (!window || window.status === "unspecified") {
    return { status: "unknown", contained: null };
  }
  const instant = parseInstant(iso, instancePath);
  if (!instant.ok) return { status: "invalid", contained: false, issues: instant.issues };
  const startOk =
    window.startMs == null ||
    (window.inclusiveStart ? instant.ms >= window.startMs : instant.ms > window.startMs);
  const endOk =
    window.endMs == null ||
    (window.inclusiveEnd ? instant.ms <= window.endMs : instant.ms < window.endMs);
  if (window.status === "partial") {
    return { status: "partial", contained: startOk && endOk };
  }
  return { status: "specified", contained: startOk && endOk };
}

export function normalizeUnit(raw) {
  if (raw == null || raw === "") {
    return { ok: false, status: "missing", id: null, dimension: null, raw: raw ?? null };
  }
  if (typeof raw !== "string") {
    return { ok: false, status: "invalid", id: null, dimension: null, raw };
  }
  const trimmed = raw.trim();
  if (!trimmed || tooLong(trimmed)) {
    return { ok: false, status: "invalid", id: null, dimension: null, raw: trimmed };
  }
  const hit = UNIT_ALIAS.get(trimmed) || UNIT_ALIAS.get(trimmed.toLowerCase());
  if (hit) return { ok: true, status: "catalog", id: hit.id, dimension: hit.dimension, raw: trimmed };
  return { ok: true, status: "unknown", id: trimmed.toLowerCase(), dimension: null, raw: trimmed };
}

export function unitsCompatible(leftRaw, rightRaw) {
  const left = normalizeUnit(leftRaw);
  const right = normalizeUnit(rightRaw);
  if (!left.ok || !right.ok) return { compatible: false, status: "invalid", left, right };
  if (left.status === "missing" || right.status === "missing") {
    return { compatible: false, status: "missing", left, right };
  }
  if (left.status === "unknown" || right.status === "unknown") {
    if (left.id && right.id && left.id === right.id) {
      return { compatible: true, status: "unknown_equal", left, right };
    }
    return { compatible: false, status: "unknown", left, right };
  }
  return {
    compatible: left.id === right.id,
    status: left.id === right.id ? "equal" : "mismatch",
    left,
    right,
  };
}

/**
 * Look up an operator-declared conversion. Never infers a factor.
 */
export function findDeclaredConversion(fromRaw, toRaw, conversions = []) {
  const from = normalizeUnit(fromRaw);
  const to = normalizeUnit(toRaw);
  if (from.ok && to.ok && from.id && from.id === to.id) {
    return { ok: true, factor: 1, identity: true, from, to };
  }
  if (!Array.isArray(conversions)) {
    return { ok: false, reason: "conversions_not_array", from, to };
  }
  for (let i = 0; i < conversions.length; i += 1) {
    const entry = conversions[i];
    if (!isPlainObject(entry)) continue;
    const src = normalizeUnit(entry.from);
    const dst = normalizeUnit(entry.to);
    if (!src.ok || !dst.ok || src.id !== from.id || dst.id !== to.id) continue;
    if (typeof entry.factor !== "number" || !Number.isFinite(entry.factor)) {
      return { ok: false, reason: "non_numeric_factor", from, to, index: i };
    }
    return { ok: true, factor: entry.factor, identity: false, from, to, index: i };
  }
  return { ok: false, reason: "no_declared_conversion", from, to };
}

export function keyTuple(row, keyColumns, instancePath = "/row") {
  if (!Array.isArray(keyColumns) || keyColumns.length === 0) {
    return { ok: false, code: "unkeyed", tuple: null, id: null };
  }
  if (!isPlainObject(row)) {
    return { ok: false, code: "unkeyed", tuple: null, id: null };
  }
  const tuple = {};
  for (const col of keyColumns) {
    if (typeof col !== "string" || !col || HOSTILE_KEYS.has(col)) {
      return { ok: false, code: "invalid_key_column", tuple: null, id: null, column: col };
    }
    if (!Object.prototype.hasOwnProperty.call(row, col) || row[col] == null || row[col] === "") {
      return {
        ok: false,
        code: "unkeyed",
        tuple: null,
        id: null,
        missing: col,
        instancePath: `${instancePath}/${col}`,
      };
    }
    const value = row[col];
    if (typeof value === "object") {
      return { ok: false, code: "compound_key_value", tuple: null, id: null, column: col };
    }
    tuple[col] = value;
  }
  return { ok: true, code: "ok", tuple, id: sha256Hex(stableStringify(tuple)) };
}

export function makeCitation({
  id,
  path = null,
  url = null,
  contentSha256 = null,
  sha256 = null,
  body = null,
  retrievedAt = null,
  evidenceClass = "synthetic",
  licenseNote = null,
} = {}) {
  if (!id || typeof id !== "string") {
    return {
      ok: false,
      citation: null,
      issues: [
        makeIssue({
          kind: "invalid",
          code: "required",
          instancePath: "/citations/id",
          message: "citation.id required",
        }),
      ],
    };
  }
  if (!EVIDENCE_CLASSES.includes(evidenceClass)) {
    return {
      ok: false,
      citation: null,
      issues: [
        makeIssue({
          kind: "invalid",
          code: "enum",
          instancePath: `/citations/${id}/evidenceClass`,
          message: `evidenceClass must be ${EVIDENCE_CLASSES.join("|")}`,
        }),
      ],
    };
  }
  if (!path && !url) {
    return {
      ok: false,
      citation: null,
      issues: [
        makeIssue({
          kind: "invalid",
          code: "required",
          instancePath: `/citations/${id}`,
          message: "citation needs path or url",
        }),
      ],
    };
  }
  let hash = contentSha256 || sha256 || null;
  if (body != null) hash = sha256Hex(body);
  if (hash != null && (typeof hash !== "string" || !SHA256_HEX.test(hash))) {
    return {
      ok: false,
      citation: null,
      issues: [
        makeIssue({
          kind: "invalid",
          code: "pattern",
          instancePath: `/citations/${id}/contentSha256`,
          message: "contentSha256 must be 64 lowercase hex chars",
        }),
      ],
    };
  }
  if (retrievedAt != null) {
    const instant = parseInstant(retrievedAt, `/citations/${id}/retrievedAt`);
    if (!instant.ok) return { ok: false, citation: null, issues: instant.issues };
  }
  return {
    ok: true,
    citation: {
      id,
      path,
      url,
      contentSha256: hash,
      retrievedAt,
      evidenceClass,
      licenseNote,
    },
    issues: [],
  };
}

export function makeFinding({
  id,
  kind,
  code,
  message,
  citationIds,
  key = null,
  timeWindow = null,
  unit = null,
  outcome = null,
} = {}) {
  const finding = {
    id: id || null,
    kind: kind || null,
    code: code || null,
    message: message || null,
    citationIds: Array.isArray(citationIds) ? [...citationIds] : [],
    key,
    timeWindow,
    unit,
    outcome,
  };
  try {
    requireCitedFinding(finding);
  } catch (err) {
    return {
      ok: false,
      finding: null,
      issues: [
        makeIssue({
          kind: "invalid",
          code: "citation_required",
          instancePath: `/findings/${id || ""}/citationIds`,
          message: err.message,
        }),
      ],
    };
  }
  if (!FINDING_KINDS.includes(finding.kind) && !CASE_KINDS.includes(normalizeCaseKind(finding.kind))) {
    return {
      ok: false,
      finding: null,
      issues: [
        makeIssue({
          kind: "invalid",
          code: "enum",
          instancePath: `/findings/${id}/kind`,
          message: `finding.kind must be ${FINDING_KINDS.join("|")}`,
        }),
      ],
    };
  }
  return { ok: true, finding, issues: [] };
}

function push(issues, issue) {
  issues.push(issue);
  return issues;
}

function cellScalar(value) {
  if (value == null) return true;
  const t = typeof value;
  return t === "string" || t === "number" || t === "boolean";
}

function validateColumns(columns, instancePath, issues) {
  if (!Array.isArray(columns) || columns.length === 0) {
    push(
      issues,
      makeIssue({
        kind: "invalid",
        code: "minItems",
        instancePath,
        message: "table.columns must be a non-empty array",
      }),
    );
    return [];
  }
  if (columns.length > LIMITS.maxColumns) {
    push(
      issues,
      makeIssue({
        kind: "invalid",
        code: "maxItems",
        instancePath,
        message: `at most ${LIMITS.maxColumns} columns`,
        params: { limit: LIMITS.maxColumns },
      }),
    );
  }
  const names = [];
  for (let i = 0; i < columns.length; i += 1) {
    const col = columns[i];
    const path = `${instancePath}/${i}`;
    if (!isPlainObject(col)) {
      push(issues, makeIssue({ kind: "invalid", code: "type", instancePath: path, message: "column must be an object" }));
      continue;
    }
    if (hasHostileKey(col) || HOSTILE_KEYS.has(col.name)) {
      push(issues, makeIssue({ kind: "invalid", code: "hostile_key", instancePath: path, message: "hostile column key" }));
      continue;
    }
    if (typeof col.name !== "string" || !col.name || tooLong(col.name)) {
      push(issues, makeIssue({ kind: "invalid", code: "required", instancePath: `${path}/name`, message: "column.name required" }));
      continue;
    }
    if (col.role != null && !COLUMN_ROLES.includes(col.role)) {
      push(
        issues,
        makeIssue({
          kind: "invalid",
          code: "enum",
          instancePath: `${path}/role`,
          message: `column.role must be ${COLUMN_ROLES.join("|")}`,
        }),
      );
    }
    if (col.unit != null) {
      const unit = normalizeUnit(col.unit);
      if (!unit.ok) {
        push(
          issues,
          makeIssue({
            kind: "invalid",
            code: "unit",
            instancePath: `${path}/unit`,
            message: "column.unit invalid",
          }),
        );
      }
    }
    names.push(col.name);
  }
  return names;
}

function validateTable(table, index, issues) {
  const instancePath = `/tables/${index}`;
  if (!isPlainObject(table)) {
    push(issues, makeIssue({ kind: "invalid", code: "type", instancePath, message: "table must be an object" }));
    return null;
  }
  if (hasHostileKey(table)) {
    push(issues, makeIssue({ kind: "invalid", code: "hostile_key", instancePath, message: "hostile table key" }));
    return null;
  }
  if (typeof table.id !== "string" || !table.id || tooLong(table.id)) {
    push(issues, makeIssue({ kind: "invalid", code: "required", instancePath: `${instancePath}/id`, message: "table.id required" }));
  }
  const columnNames = validateColumns(table.columns, `${instancePath}/columns`, issues);
  if (!Array.isArray(table.rows)) {
    push(issues, makeIssue({ kind: "invalid", code: "type", instancePath: `${instancePath}/rows`, message: "table.rows must be an array" }));
  } else if (table.rows.length > LIMITS.maxRowsPerTable) {
    push(
      issues,
      makeIssue({
        kind: "invalid",
        code: "maxItems",
        instancePath: `${instancePath}/rows`,
        message: `at most ${LIMITS.maxRowsPerTable} rows`,
      }),
    );
  } else {
    for (let r = 0; r < table.rows.length; r += 1) {
      const row = table.rows[r];
      const rowPath = `${instancePath}/rows/${r}`;
      if (!isPlainObject(row)) {
        push(issues, makeIssue({ kind: "invalid", code: "type", instancePath: rowPath, message: "row must be an object" }));
        continue;
      }
      if (hasHostileKey(row)) {
        push(issues, makeIssue({ kind: "invalid", code: "hostile_key", instancePath: rowPath, message: "hostile row key" }));
        continue;
      }
      for (const [field, value] of Object.entries(row)) {
        if (!cellScalar(value)) {
          push(
            issues,
            makeIssue({
              kind: "invalid",
              code: "type",
              instancePath: `${rowPath}/${field}`,
              message: "cell values must be scalar or null",
            }),
          );
        }
      }
    }
  }

  let windowResult = parseTimeWindow(null);
  if (Object.prototype.hasOwnProperty.call(table, "timeWindow")) {
    windowResult = parseTimeWindow(table.timeWindow, `${instancePath}/timeWindow`);
    issues.push(...windowResult.issues);
  }

  const source = table.source && isPlainObject(table.source) ? table.source : null;
  if (table.source != null && !source) {
    push(issues, makeIssue({ kind: "invalid", code: "type", instancePath: `${instancePath}/source`, message: "table.source must be an object" }));
  } else if (source && !source.path && !source.url) {
    push(
      issues,
      makeIssue({
        kind: "invalid",
        code: "required",
        instancePath: `${instancePath}/source`,
        message: "table.source needs path or url",
      }),
    );
  }

  const tableUnit = table.unit != null ? normalizeUnit(table.unit) : null;
  if (table.unit != null && tableUnit && !tableUnit.ok) {
    push(issues, makeIssue({ kind: "invalid", code: "unit", instancePath: `${instancePath}/unit`, message: "table.unit invalid" }));
  }
  const tableGrain = parseGrain(table.timeWindow?.grain ?? table.grain, `${instancePath}/grain`);
  issues.push(...tableGrain.issues);

  return {
    id: table.id || null,
    columns: Array.isArray(table.columns) ? table.columns : [],
    columnNames,
    rows: Array.isArray(table.rows) ? table.rows : [],
    keys: Array.isArray(table.keys) ? table.keys : [],
    unit: table.unit ?? null,
    grain: tableGrain.iso,
    timeWindow: windowResult.window,
    windowStatus: windowResult.status,
    source: source || (typeof table.path === "string" ? { path: table.path } : null),
    path: typeof table.path === "string" ? table.path : null,
    evidenceClass: table.evidenceClass || null,
  };
}

/**
 * Accepts join.units (map) or join.unit (singular, c13/c14) plus valueField/grain.
 * `join.unit: null` means no shared unit (conflict), not an implicit count.
 */
export function normalizeJoin(join, issues = [], instancePath = "/join") {
  if (!isPlainObject(join)) {
    push(issues, makeIssue({ kind: "invalid", code: "required", instancePath, message: "join object required (keys/units/timeWindow)" }));
    return null;
  }
  if (hasHostileKey(join)) {
    push(issues, makeIssue({ kind: "invalid", code: "hostile_key", instancePath, message: "hostile join key" }));
    return null;
  }

  const keys = join.keys;
  if (!Array.isArray(keys) || keys.length === 0) {
    push(issues, makeIssue({ kind: "invalid", code: "minItems", instancePath: `${instancePath}/keys`, message: "join.keys must be a non-empty array" }));
  } else if (keys.length > LIMITS.maxKeys) {
    push(issues, makeIssue({ kind: "invalid", code: "maxItems", instancePath: `${instancePath}/keys`, message: `at most ${LIMITS.maxKeys} keys` }));
  } else {
    for (let i = 0; i < keys.length; i += 1) {
      if (typeof keys[i] !== "string" || !keys[i] || HOSTILE_KEYS.has(keys[i])) {
        push(
          issues,
          makeIssue({
            kind: "invalid",
            code: "type",
            instancePath: `${instancePath}/keys/${i}`,
            message: "join key must be a non-empty string",
          }),
        );
      }
    }
  }

  const valueField =
    typeof join.valueField === "string" && join.valueField
      ? join.valueField
      : isPlainObject(join.units) && Object.keys(join.units).length
        ? Object.keys(join.units)[0]
        : "value";

  let units = {};
  let sharedUnit = undefined;
  const hasUnitsMap = Object.prototype.hasOwnProperty.call(join, "units");
  const hasUnit = Object.prototype.hasOwnProperty.call(join, "unit");

  if (hasUnitsMap) {
    if (!isPlainObject(join.units)) {
      push(issues, makeIssue({ kind: "invalid", code: "type", instancePath: `${instancePath}/units`, message: "join.units must be an object" }));
    } else if (hasHostileKey(join.units)) {
      push(issues, makeIssue({ kind: "invalid", code: "hostile_key", instancePath: `${instancePath}/units`, message: "hostile unit key" }));
    } else if (Object.keys(join.units).length === 0) {
      push(
        issues,
        makeIssue({
          kind: "invalid",
          code: "minProperties",
          instancePath: `${instancePath}/units`,
          message: "join.units must name at least one measure",
        }),
      );
    } else {
      units = { ...join.units };
      for (const [measure, unit] of Object.entries(units)) {
        const normalized = normalizeUnit(unit);
        if (!normalized.ok) {
          push(
            issues,
            makeIssue({
              kind: "invalid",
              code: "unit",
              instancePath: `${instancePath}/units/${measure}`,
              message: "measure unit invalid",
            }),
          );
        }
      }
    }
  } else if (hasUnit && join.unit === null) {
    sharedUnit = null;
    units = {};
  } else if (hasUnit && typeof join.unit === "string") {
    const normalized = normalizeUnit(join.unit);
    if (!normalized.ok) {
      push(issues, makeIssue({ kind: "invalid", code: "unit", instancePath: `${instancePath}/unit`, message: "join.unit invalid" }));
    } else {
      sharedUnit = join.unit;
      units = { [valueField]: join.unit };
    }
  } else {
    push(
      issues,
      makeIssue({
        kind: "invalid",
        code: "required",
        instancePath: `${instancePath}/units`,
        message: "join.units or join.unit required; omission is not an implicit count",
      }),
    );
  }

  if (hasUnitsMap && hasUnit && join.unit != null && units[valueField] && units[valueField] !== join.unit) {
    const compat = unitsCompatible(units[valueField], join.unit);
    if (!compat.compatible) {
      push(
        issues,
        makeIssue({
          kind: "invalid",
          code: "unit_mismatch",
          instancePath,
          message: "join.unit disagrees with join.units for valueField",
        }),
      );
    }
  }

  const windowResult = parseTimeWindow(join.timeWindow, `${instancePath}/timeWindow`, {
    windowInclusive: join.windowInclusive === true,
  });
  issues.push(...windowResult.issues);

  const grainFromJoin = parseGrain(join.grain, `${instancePath}/grain`);
  issues.push(...grainFromJoin.issues);
  const grainIso = grainFromJoin.iso || windowResult.window?.grain || null;
  const grainStatus = grainFromJoin.status !== "unspecified" ? grainFromJoin.status : windowResult.window?.grainStatus || "unspecified";

  let conversions = [];
  if (join.conversions != null) {
    if (!Array.isArray(join.conversions)) {
      push(
        issues,
        makeIssue({
          kind: "invalid",
          code: "type",
          instancePath: `${instancePath}/conversions`,
          message: "join.conversions must be an array of {from,to,factor}",
        }),
      );
    } else if (join.conversions.length > LIMITS.maxConversions) {
      push(
        issues,
        makeIssue({
          kind: "invalid",
          code: "maxItems",
          instancePath: `${instancePath}/conversions`,
          message: `at most ${LIMITS.maxConversions} conversions`,
        }),
      );
    } else {
      conversions = join.conversions;
      for (let i = 0; i < conversions.length; i += 1) {
        const entry = conversions[i];
        const path = `${instancePath}/conversions/${i}`;
        if (!isPlainObject(entry)) {
          push(issues, makeIssue({ kind: "invalid", code: "type", instancePath: path, message: "conversion must be an object" }));
          continue;
        }
        if (typeof entry.factor !== "number" || !Number.isFinite(entry.factor)) {
          push(
            issues,
            makeIssue({
              kind: "invalid",
              code: "type",
              instancePath: `${path}/factor`,
              message: "conversion.factor must be a finite number supplied by the operator",
            }),
          );
        }
      }
    }
  }

  return {
    keys: Array.isArray(keys) ? keys : [],
    units,
    valueField,
    sharedUnit: sharedUnit === undefined ? (Object.values(units)[0] ?? null) : sharedUnit,
    grain: grainIso,
    grainStatus,
    timeWindow: windowResult.window,
    windowStatus: windowResult.status,
    windowInclusive: join.windowInclusive === true,
    conversions,
  };
}

function validateJoin(join, issues) {
  return normalizeJoin(join, issues, "/join");
}

/**
 * Structural coverage of keys/units/windows across tables.
 * Row-value disagreement is c12; this only classifies join completeness.
 */
export function classifyJoin(normalized) {
  if (!normalized || !normalized.join) return "negative";
  const { join, tables } = normalized;
  if (!tables || tables.length === 0) return "negative";
  if (!join.keys.length) return "negative";
  if (join.sharedUnit === null && Object.keys(join.units).length === 0) return "conflict";
  if (!Object.keys(join.units).length) return "negative";

  let partial = false;
  let conflicting = false;

  if (join.windowStatus === "partial" || join.windowStatus === "unspecified") partial = true;

  const measureNames = Object.keys(join.units);
  const tableGrains = [];
  const tableUnits = [];
  for (const table of tables) {
    if (!table.rows || table.rows.length === 0) {
      partial = true;
    }
    for (const key of join.keys) {
      if (table.columnNames.length && !table.columnNames.includes(key)) partial = true;
    }
    for (const measure of measureNames) {
      if (table.columnNames.length && !table.columnNames.includes(measure)) partial = true;
      const col = table.columns.find((c) => c && c.name === measure);
      if (col && col.unit != null) {
        const compat = unitsCompatible(col.unit, join.units[measure]);
        if (!compat.compatible) {
          const conv = findDeclaredConversion(col.unit, join.units[measure], join.conversions);
          if (!conv.ok) conflicting = true;
        }
      }
    }
    if (table.unit != null && join.sharedUnit) {
      const compat = unitsCompatible(table.unit, join.sharedUnit);
      if (!compat.compatible) {
        const conv = findDeclaredConversion(table.unit, join.sharedUnit, join.conversions);
        if (!conv.ok) conflicting = true;
      }
    }
    if (table.unit != null) tableUnits.push(table.unit);
    if (table.grain) tableGrains.push(table.grain);
    if (table.windowStatus === "partial") partial = true;
    if (table.timeWindow && join.timeWindow) {
      const overlap = windowsOverlap(table.timeWindow, join.timeWindow);
      if (overlap.status === "disjoint") partial = true;
      if (overlap.status === "unknown") partial = true;
    } else if (join.timeWindow && !table.timeWindow) {
      partial = true;
    }
  }

  if (tableUnits.length >= 2) {
    for (let i = 1; i < tableUnits.length; i += 1) {
      if (!unitsCompatible(tableUnits[0], tableUnits[i]).compatible) conflicting = true;
    }
  }
  if (tableGrains.length >= 2) {
    for (let i = 1; i < tableGrains.length; i += 1) {
      const grain = grainsCompatible(tableGrains[0], tableGrains[i]);
      if (grain.status === "mismatch") conflicting = true;
    }
  }

  if (conflicting) return "conflict";
  if (partial) return "partial";
  return "positive";
}

export function validateInput(doc) {
  const issues = [];
  if (!isPlainObject(doc)) {
    return {
      ok: false,
      status: "invalid",
      caseKind: "negative",
      issues: [
        makeIssue({
          kind: "invalid",
          code: "type",
          instancePath: "",
          message: "input must be an object",
        }),
      ],
      value: null,
    };
  }
  if (hasHostileKey(doc)) {
    return {
      ok: false,
      status: "invalid",
      caseKind: "negative",
      issues: [
        makeIssue({
          kind: "invalid",
          code: "hostile_key",
          instancePath: "",
          message: "input contains a hostile key",
        }),
      ],
      value: null,
    };
  }

  if (doc.schema != null && doc.schema !== INPUT_SCHEMA) {
    push(
      issues,
      makeIssue({
        kind: "invalid",
        code: "const",
        instancePath: "/schema",
        message: `schema must be ${INPUT_SCHEMA}`,
      }),
    );
  }

  const clock = parseInstant(doc.clock, "/clock");
  issues.push(...clock.issues);

  const evidenceClass = doc.evidenceClass || "synthetic";
  if (!EVIDENCE_CLASSES.includes(evidenceClass)) {
    push(
      issues,
      makeIssue({
        kind: "invalid",
        code: "enum",
        instancePath: "/evidenceClass",
        message: `evidenceClass must be ${EVIDENCE_CLASSES.join("|")}`,
      }),
    );
  }

  if (!Array.isArray(doc.tables)) {
    push(issues, makeIssue({ kind: "invalid", code: "type", instancePath: "/tables", message: "tables must be an array" }));
  } else if (doc.tables.length === 0) {
    push(issues, makeIssue({ kind: "invalid", code: "minItems", instancePath: "/tables", message: "at least one table is required" }));
  } else if (doc.tables.length > LIMITS.maxTables) {
    push(
      issues,
      makeIssue({
        kind: "invalid",
        code: "maxItems",
        instancePath: "/tables",
        message: `at most ${LIMITS.maxTables} tables`,
      }),
    );
  }

  const tables = [];
  const seenIds = new Set();
  if (Array.isArray(doc.tables)) {
    for (let i = 0; i < doc.tables.length; i += 1) {
      const normalized = validateTable(doc.tables[i], i, issues);
      if (!normalized) continue;
      if (normalized.id && seenIds.has(normalized.id)) {
        push(
          issues,
          makeIssue({
            kind: "invalid",
            code: "uniqueItems",
            instancePath: `/tables/${i}/id`,
            message: "table.id must be unique",
          }),
        );
      }
      if (normalized.id) seenIds.add(normalized.id);
      tables.push(normalized);
    }
  }

  const join = validateJoin(doc.join, issues);

  const invalid = issues.some((issue) => issue.kind === "invalid");
  const value = invalid
    ? null
    : {
        schema: INPUT_SCHEMA,
        clock: clock.iso,
        evidenceClass,
        tables,
        join,
        policies: POLICIES,
      };

  let caseKind = "negative";
  if (!invalid && value) caseKind = classifyJoin(value);

  return {
    ok: !invalid,
    status: invalid ? "invalid" : "ok",
    caseKind,
    issues,
    value,
  };
}

/**
 * Source table shape used by c13 (`s137.table-reconcile.source-table.v1`).
 * A bare array is unkeyed/invalid — keys are not inferred.
 */
export function validateSourceTable(doc, instancePath = "") {
  const issues = [];
  if (Array.isArray(doc)) {
    return {
      ok: false,
      status: "invalid",
      caseKind: "negative",
      issues: [
        makeIssue({
          kind: "invalid",
          code: "missing-keys",
          instancePath,
          message: "bare array is not a keyed source table; do not infer keys",
        }),
      ],
      value: null,
    };
  }
  if (!isPlainObject(doc)) {
    return {
      ok: false,
      status: "invalid",
      caseKind: "negative",
      issues: [
        makeIssue({
          kind: "invalid",
          code: "type",
          instancePath,
          message: "source table must be an object",
        }),
      ],
      value: null,
    };
  }
  if (doc.schema != null && doc.schema !== SOURCE_TABLE_SCHEMA) {
    push(
      issues,
      makeIssue({
        kind: "invalid",
        code: "const",
        instancePath: `${instancePath}/schema`,
        message: `schema must be ${SOURCE_TABLE_SCHEMA}`,
      }),
    );
  }
  const asInputTable = {
    id: doc.id,
    evidenceClass: doc.evidenceClass,
    source: doc.source || (doc.id ? { path: String(doc.id) } : null),
    columns: doc.columns,
    rows: doc.rows,
    timeWindow: doc.timeWindow,
    keys: doc.keys,
    unit: doc.unit,
    grain: doc.grain,
  };
  const table = validateTable(asInputTable, 0, issues);
  if (!Array.isArray(doc.keys) || doc.keys.length === 0) {
    push(
      issues,
      makeIssue({
        kind: "invalid",
        code: "missing-keys",
        instancePath: `${instancePath}/keys`,
        message: "source table keys required",
      }),
    );
  }
  const invalid = issues.some((issue) => issue.kind === "invalid");
  return {
    ok: !invalid,
    status: invalid ? "invalid" : "ok",
    caseKind: invalid ? "negative" : "positive",
    issues,
    value: invalid ? null : table,
  };
}

/**
 * Case document shape used by c13 (`s137.table-reconcile.case.v1`).
 * Tables may be path references; rows are not required here (c12 loads them).
 */
export function validateCase(doc) {
  const issues = [];
  if (!isPlainObject(doc)) {
    return {
      ok: false,
      status: "invalid",
      caseKind: "negative",
      issues: [
        makeIssue({
          kind: "invalid",
          code: "type",
          instancePath: "",
          message: "case must be an object",
        }),
      ],
      value: null,
    };
  }
  if (hasHostileKey(doc)) {
    return {
      ok: false,
      status: "invalid",
      caseKind: "negative",
      issues: [
        makeIssue({
          kind: "invalid",
          code: "hostile_key",
          instancePath: "",
          message: "case contains a hostile key",
        }),
      ],
      value: null,
    };
  }
  if (doc.schema != null && doc.schema !== CASE_SCHEMA) {
    push(
      issues,
      makeIssue({
        kind: "invalid",
        code: "const",
        instancePath: "/schema",
        message: `schema must be ${CASE_SCHEMA}`,
      }),
    );
  }
  if (doc.jobId != null && doc.jobId !== JOB_ID) {
    push(issues, makeIssue({ kind: "invalid", code: "const", instancePath: "/jobId", message: `jobId must be ${JOB_ID}` }));
  }
  const clock = parseInstant(doc.clock, "/clock");
  issues.push(...clock.issues);
  const kind = normalizeCaseKind(doc.kind);
  if (doc.kind != null && !CASE_KINDS.includes(kind)) {
    push(
      issues,
      makeIssue({
        kind: "invalid",
        code: "enum",
        instancePath: "/kind",
        message: `kind must be ${CASE_KINDS.join("|")}`,
      }),
    );
  }
  const join = normalizeJoin(doc.join, issues, "/join");
  if (!Array.isArray(doc.tables) || doc.tables.length === 0) {
    push(issues, makeIssue({ kind: "invalid", code: "minItems", instancePath: "/tables", message: "case.tables required" }));
  } else {
    for (let i = 0; i < doc.tables.length; i += 1) {
      const table = doc.tables[i];
      const path = `/tables/${i}`;
      if (!isPlainObject(table)) {
        push(issues, makeIssue({ kind: "invalid", code: "type", instancePath: path, message: "table ref must be an object" }));
        continue;
      }
      if (typeof table.id !== "string" || !table.id) {
        push(issues, makeIssue({ kind: "invalid", code: "required", instancePath: `${path}/id`, message: "table.id required" }));
      }
      if (typeof table.path !== "string" || !table.path) {
        push(issues, makeIssue({ kind: "invalid", code: "required", instancePath: `${path}/path`, message: "table.path required on case refs" }));
      }
    }
  }
  if (!Array.isArray(doc.citations) || doc.citations.length === 0) {
    push(issues, makeIssue({ kind: "invalid", code: "minItems", instancePath: "/citations", message: "citations[] required" }));
  } else {
    for (let i = 0; i < doc.citations.length; i += 1) {
      issues.push(...makeCitation({ evidenceClass: doc.evidenceClass || "synthetic", ...(doc.citations[i] || {}) }).issues);
    }
  }
  const cited = citationIndex(doc.citations);
  const findings = doc.expect?.findings;
  if (Array.isArray(findings)) {
    for (let i = 0; i < findings.length; i += 1) {
      const finding = findings[i];
      const made = makeFinding({
        id: finding.id,
        kind: finding.kind,
        code: finding.code || finding.kind,
        message: finding.message || finding.kind,
        citationIds: finding.citationIds,
        key: finding.keys || finding.key || null,
        unit: finding.unit || null,
      });
      issues.push(...made.issues);
      if (Array.isArray(finding.citationIds)) {
        for (const cid of finding.citationIds) {
          if (!cited.has(cid)) {
            push(
              issues,
              makeIssue({
                kind: "invalid",
                code: "unresolved_citation",
                instancePath: `/expect/findings/${i}/citationIds`,
                message: `citationId ${cid} is not in citations[]`,
              }),
            );
          }
        }
      }
    }
  }
  if (doc.expect && doc.expect.inventTotals === true) {
    push(
      issues,
      makeIssue({
        kind: "invalid",
        code: "invented_total",
        instancePath: "/expect/inventTotals",
        message: "cases must not invent totals",
      }),
    );
  }

  const invalid = issues.some((issue) => issue.kind === "invalid");
  return {
    ok: !invalid,
    status: invalid ? "invalid" : "ok",
    caseKind: kind && CASE_KINDS.includes(kind) ? kind : invalid ? "negative" : null,
    issues,
    value: invalid
      ? null
      : {
          schema: CASE_SCHEMA,
          id: doc.id || null,
          clock: clock.iso,
          kind,
          evidenceClass: doc.evidenceClass || "synthetic",
          join,
          tables: doc.tables,
          citations: doc.citations,
          expect: doc.expect || null,
        },
  };
}

function citationIndex(citations) {
  const map = new Map();
  if (!Array.isArray(citations)) return map;
  for (const citation of citations) {
    if (citation && typeof citation.id === "string") map.set(citation.id, citation);
  }
  return map;
}

export function validateOutput(doc) {
  const issues = [];
  if (!isPlainObject(doc)) {
    return {
      ok: false,
      status: "invalid",
      issues: [
        makeIssue({
          kind: "invalid",
          code: "type",
          instancePath: "",
          message: "output must be an object",
        }),
      ],
    };
  }
  if (hasHostileKey(doc)) {
    return {
      ok: false,
      status: "invalid",
      issues: [
        makeIssue({
          kind: "invalid",
          code: "hostile_key",
          instancePath: "",
          message: "output contains a hostile key",
        }),
      ],
    };
  }

  if (doc.schema !== OUTPUT_SCHEMA && doc.schema !== PACKET_SCHEMA) {
    push(
      issues,
      makeIssue({
        kind: "invalid",
        code: "const",
        instancePath: "/schema",
        message: `schema must be ${OUTPUT_SCHEMA} or ${PACKET_SCHEMA}`,
      }),
    );
  }
  if (doc.jobId != null && doc.jobId !== JOB_ID) {
    push(
      issues,
      makeIssue({
        kind: "invalid",
        code: "const",
        instancePath: "/jobId",
        message: `jobId must be ${JOB_ID}`,
      }),
    );
  }
  if (doc.artifactKind != null && doc.artifactKind !== ARTIFACT_KIND) {
    push(
      issues,
      makeIssue({
        kind: "invalid",
        code: "const",
        instancePath: "/artifactKind",
        message: `artifactKind must be ${ARTIFACT_KIND}`,
      }),
    );
  }

  const clock = parseInstant(doc.clock, "/clock");
  issues.push(...clock.issues);

  if (doc.evidenceClass && !EVIDENCE_CLASSES.includes(doc.evidenceClass)) {
    push(
      issues,
      makeIssue({
        kind: "invalid",
        code: "enum",
        instancePath: "/evidenceClass",
        message: `evidenceClass must be ${EVIDENCE_CLASSES.join("|")}`,
      }),
    );
  }
  if (doc.decision && !DECISIONS.includes(doc.decision)) {
    push(
      issues,
      makeIssue({
        kind: "invalid",
        code: "enum",
        instancePath: "/decision",
        message: `decision must be ${DECISIONS.join("|")}`,
      }),
    );
  }

  for (const field of FORBIDDEN_TOTAL_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(doc, field)) {
      push(
        issues,
        makeIssue({
          kind: "invalid",
          code: "invented_total",
          instancePath: `/${field}`,
          message: "invented totals are forbidden",
        }),
      );
    }
  }

  if (doc.totals != null) {
    if (!isPlainObject(doc.totals)) {
      push(issues, makeIssue({ kind: "invalid", code: "type", instancePath: "/totals", message: "totals must be an object" }));
    } else {
      if (doc.totals.invented === true || doc.totals.computed === true) {
        push(
          issues,
          makeIssue({
            kind: "invalid",
            code: "invented_total",
            instancePath: "/totals",
            message: "do not compute or invent totals; surface disagreement per key",
          }),
        );
      }
      if (typeof doc.totals.value === "number") {
        push(
          issues,
          makeIssue({
            kind: "invalid",
            code: "invented_total",
            instancePath: "/totals/value",
            message: "numeric totals.value is an invented aggregate",
          }),
        );
      }
    }
  }

  if (!Array.isArray(doc.citations) || doc.citations.length === 0) {
    push(
      issues,
      makeIssue({
        kind: "invalid",
        code: "minItems",
        instancePath: "/citations",
        message: "citations[] required",
      }),
    );
  } else if (doc.citations.length > LIMITS.maxCitations) {
    push(
      issues,
      makeIssue({
        kind: "invalid",
        code: "maxItems",
        instancePath: "/citations",
        message: `at most ${LIMITS.maxCitations} citations`,
      }),
    );
  }

  const cited = citationIndex(doc.citations);
  if (Array.isArray(doc.citations)) {
    for (let i = 0; i < doc.citations.length; i += 1) {
      const made = makeCitation(doc.citations[i] || {});
      issues.push(...made.issues);
    }
  }

  if (!Array.isArray(doc.findings)) {
    push(issues, makeIssue({ kind: "invalid", code: "type", instancePath: "/findings", message: "findings must be an array" }));
  } else {
    if (doc.findings.length > LIMITS.maxFindings) {
      push(
        issues,
        makeIssue({
          kind: "invalid",
          code: "maxItems",
          instancePath: "/findings",
          message: `at most ${LIMITS.maxFindings} findings`,
        }),
      );
    }
    for (let i = 0; i < doc.findings.length; i += 1) {
      const finding = doc.findings[i];
      const path = `/findings/${i}`;
      const made = makeFinding(finding || {});
      issues.push(...made.issues);
      if (made.ok) {
        for (const cid of made.finding.citationIds) {
          if (!cited.has(cid)) {
            push(
              issues,
              makeIssue({
                kind: "invalid",
                code: "unresolved_citation",
                instancePath: `${path}/citationIds`,
                message: `citationId ${cid} is not in citations[]`,
              }),
            );
          }
        }
      }
    }
  }

  if (doc.groups != null && !Array.isArray(doc.groups)) {
    push(issues, makeIssue({ kind: "invalid", code: "type", instancePath: "/groups", message: "groups must be an array" }));
  } else if (Array.isArray(doc.groups)) {
    for (let i = 0; i < doc.groups.length; i += 1) {
      const group = doc.groups[i];
      const path = `/groups/${i}`;
      if (!isPlainObject(group)) {
        push(issues, makeIssue({ kind: "invalid", code: "type", instancePath: path, message: "group must be an object" }));
        continue;
      }
      if (group.outcome && !ROW_OUTCOMES.includes(group.outcome)) {
        push(
          issues,
          makeIssue({
            kind: "invalid",
            code: "enum",
            instancePath: `${path}/outcome`,
            message: `group.outcome must be ${ROW_OUTCOMES.join("|")}`,
          }),
        );
      }
      if (group.inventedTotal != null || typeof group.total === "number") {
        push(
          issues,
          makeIssue({
            kind: "invalid",
            code: "invented_total",
            instancePath: path,
            message: "groups must not carry invented totals",
          }),
        );
      }
    }
  }

  if (doc.claims && doc.claims.inventsFacts === true) {
    push(
      issues,
      makeIssue({
        kind: "invalid",
        code: "invented_facts",
        instancePath: "/claims/inventsFacts",
        message: "packet must not claim invented facts",
      }),
    );
  }

  const invalid = issues.some((issue) => issue.kind === "invalid");
  return { ok: !invalid, status: invalid ? "invalid" : "ok", issues };
}

export const TOTALS_NOT_COMPUTED = Object.freeze({
  computed: false,
  invented: false,
  policy: "never_invent",
  note: "Disagreement is listed per key; no summed or averaged total is emitted.",
});

export function createOutputPacket({
  clock,
  evidenceClass = "synthetic",
  decision = "unknown",
  sources = [],
  findings = [],
  citations = [],
  limitations = LIMITATIONS,
  join = null,
  groups = [],
  caseKind = null,
} = {}) {
  const envelope = createEnvelope({
    jobId: JOB_ID,
    artifactKind: ARTIFACT_KIND,
    clock,
    evidenceClass,
    sources,
    findings,
    decision,
    limitations,
    citations,
  });
  return {
    ...envelope,
    schema: OUTPUT_SCHEMA,
    packetSchema: PACKET_SCHEMA,
    join,
    groups,
    caseKind,
    totals: { ...TOTALS_NOT_COMPUTED },
    policies: POLICIES,
  };
}

function syntheticCitation(id, body) {
  const made = makeCitation({
    id,
    path: `synthetic://table-reconcile/${id}`,
    body,
    evidenceClass: "synthetic",
    licenseNote: "synthetic schema example; not a live source",
  });
  if (!made.ok) throw new Error(made.issues.map((i) => i.message).join("; "));
  return made.citation;
}

function baseJoin(overrides = {}) {
  return {
    keys: ["entity"],
    units: { items: "count" },
    timeWindow: {
      start: "2026-01-01T00:00:00Z",
      end: "2026-02-01T00:00:00Z",
      inclusiveStart: true,
      inclusiveEnd: false,
    },
    conversions: [],
    ...overrides,
  };
}

function baseTable(id, rows, extra = {}) {
  return {
    id,
    evidenceClass: "synthetic",
    source: { path: `synthetic://table-reconcile/${id}` },
    columns: [
      { name: "entity", role: "key" },
      { name: "items", role: "measure", unit: "count" },
      { name: "observedAt", role: "time", unit: "iso_datetime" },
    ],
    timeWindow: {
      start: "2026-01-01T00:00:00Z",
      end: "2026-02-01T00:00:00Z",
    },
    rows,
    ...extra,
  };
}

/**
 * In-memory synthetic documents for the four required case kinds.
 * Not pack fixtures (those belong to c13/c14).
 */
export function exampleCases(clock = "2026-09-10T00:00:00Z") {
  const positiveTables = [
    baseTable("alpha", [{ entity: "a", items: 3, observedAt: "2026-01-15T00:00:00Z" }]),
    baseTable("beta", [{ entity: "a", items: 3, observedAt: "2026-01-15T00:00:00Z" }]),
  ];
  const partialTables = [
    baseTable("alpha", [{ entity: "a", items: 3, observedAt: "2026-01-15T00:00:00Z" }]),
    baseTable(
      "beta",
      [{ entity: "a", items: 3, observedAt: "2026-01-15T00:00:00Z" }],
      { timeWindow: { start: "2026-01-01T00:00:00Z" }, columns: [{ name: "entity", role: "key" }, { name: "items", role: "measure" }] },
    ),
  ];
  const conflictingTables = [
    baseTable("alpha", [{ entity: "a", items: 3, observedAt: "2026-01-15T00:00:00Z" }]),
    baseTable(
      "beta",
      [{ entity: "a", items: 9, observedAt: "2026-01-15T00:00:00Z" }],
      {
        columns: [
          { name: "entity", role: "key" },
          { name: "items", role: "measure", unit: "usd" },
          { name: "observedAt", role: "time", unit: "iso_datetime" },
        ],
      },
    ),
  ];

  const positiveInput = {
    schema: INPUT_SCHEMA,
    clock,
    evidenceClass: "synthetic",
    join: baseJoin(),
    tables: positiveTables,
  };
  const negativeInput = {
    schema: INPUT_SCHEMA,
    clock,
    evidenceClass: "synthetic",
    join: { keys: [], units: {}, timeWindow: null },
    tables: [],
  };
  const partialInput = {
    schema: INPUT_SCHEMA,
    clock,
    evidenceClass: "synthetic",
    join: baseJoin({ timeWindow: { start: "2026-01-01T00:00:00Z" } }),
    tables: partialTables,
  };
  const conflictingInput = {
    schema: INPUT_SCHEMA,
    clock,
    evidenceClass: "synthetic",
    join: baseJoin(),
    tables: conflictingTables,
  };

  const citeA = syntheticCitation("src-alpha", positiveTables[0]);
  const citeB = syntheticCitation("src-beta", positiveTables[1]);

  const positiveFinding = makeFinding({
    id: "f-agree",
    kind: "positive",
    code: "keys_units_window_aligned",
    message: "Join keys, units, and time windows are specified and compatible.",
    citationIds: [citeA.id, citeB.id],
    key: { entity: "a" },
    unit: "count",
    outcome: "agree",
  }).finding;
  const negativeFinding = makeFinding({
    id: "f-empty",
    kind: "negative",
    code: "missing_join_keys",
    message: "No tables and no join.keys were supplied.",
    citationIds: [citeA.id],
  }).finding;
  const partialFinding = makeFinding({
    id: "f-open-window",
    kind: "partial",
    code: "incomplete_time_window",
    message: "A table or join time window is open-ended, so comparability is partial.",
    citationIds: [citeA.id, citeB.id],
  }).finding;
  const conflictingFinding = makeFinding({
    id: "f-unit",
    kind: "unit-conflict",
    code: "unit_mismatch",
    message: "Measure items is count in one table and usd in the other; no declared conversion.",
    citationIds: [citeA.id, citeB.id],
    unit: "count",
    outcome: "unit_mismatch",
  }).finding;

  const examples = {
    positive: {
      caseKind: "positive",
      input: positiveInput,
      output: createOutputPacket({
        clock,
        evidenceClass: "synthetic",
        decision: "pass",
        caseKind: "positive",
        sources: [citeA, citeB],
        citations: [citeA, citeB],
        findings: [positiveFinding],
        join: baseJoin(),
        groups: [{ key: { entity: "a" }, outcome: "agree", values: [3, 3], unit: "count" }],
      }),
    },
    negative: {
      caseKind: "negative",
      input: negativeInput,
      output: createOutputPacket({
        clock,
        evidenceClass: "synthetic",
        decision: "fail",
        caseKind: "negative",
        sources: [citeA],
        citations: [citeA],
        findings: [negativeFinding],
        join: { keys: [], units: {}, timeWindow: null },
        groups: [],
      }),
    },
    partial: {
      caseKind: "partial",
      input: partialInput,
      output: createOutputPacket({
        clock,
        evidenceClass: "synthetic",
        decision: "partial",
        caseKind: "partial",
        sources: [citeA, citeB],
        citations: [citeA, citeB],
        findings: [partialFinding],
        join: baseJoin({ timeWindow: { start: "2026-01-01T00:00:00Z" } }),
        groups: [{ key: { entity: "a" }, outcome: "partial" }],
      }),
    },
    conflict: {
      caseKind: "conflict",
      input: conflictingInput,
      output: createOutputPacket({
        clock,
        evidenceClass: "synthetic",
        decision: "conflict",
        caseKind: "conflict",
        sources: [citeA, citeB],
        citations: [citeA, citeB],
        findings: [conflictingFinding],
        join: baseJoin(),
        groups: [{ key: { entity: "a" }, outcome: "unit_mismatch", values: [3, 9] }],
      }),
    },
  };
  examples.conflicting = examples.conflict;
  return examples;
}

export function schemaCatalog() {
  return {
    jobId: JOB_ID,
    inputSchema: INPUT_SCHEMA,
    outputSchema: OUTPUT_SCHEMA,
    packetSchema: PACKET_SCHEMA,
    keys: {
      field: "join.keys",
      required: true,
      min: 1,
      max: LIMITS.maxKeys,
      role: "key",
      note: "Composite equality key. Missing cell ⇒ unkeyed, not a default.",
    },
    units: {
      field: "join.units",
      aliases: ["join.unit", "join.valueField"],
      required: true,
      catalog: Object.keys(UNIT_CATALOG),
      note: "join.units is measure → unit. join.unit (singular, c13/c14) maps onto valueField. join.unit null means no shared unit. Unknown units are not assumed compatible. Conversions are operator-declared only.",
    },
    timeWindows: {
      fields: ["join.timeWindow", "tables[].timeWindow"],
      grain: "join.grain | timeWindow.grain (PnD / PnW or day|week)",
      defaultInclusivity: { inclusiveStart: true, inclusiveEnd: false },
      note: "ISO-8601 date or date-time. Date-only is UTC midnight. Unspecified ⇒ partial comparability. Different grains are not rolled up. join.windowInclusive=true makes both bounds inclusive (npm download-counts).",
    },
    caseKinds: CASE_KINDS,
    rowOutcomes: ROW_OUTCOMES,
    evidenceClasses: EVIDENCE_CLASSES,
    decisions: DECISIONS,
    policies: POLICIES,
    limitations: LIMITATIONS,
  };
}

export function selfCheck(clock = "2026-09-10T00:00:00Z") {
  const examples = exampleCases(clock);
  const results = {};
  for (const name of CASE_KINDS) {
    const example = examples[name];
    const input = validateInput(example.input);
    const output = validateOutput(example.output);
    results[name] = {
      inputOk: input.ok,
      inputCaseKind: input.caseKind,
      outputOk: output.ok,
      inputIssues: input.issues,
      outputIssues: output.issues,
    };
  }
  const positiveOk = results.positive.inputOk && results.positive.inputCaseKind === "positive" && results.positive.outputOk;
  const negativeOk = !results.negative.inputOk && results.negative.inputCaseKind === "negative" && results.negative.outputOk;
  const partialOk = results.partial.inputOk && results.partial.inputCaseKind === "partial" && results.partial.outputOk;
  const conflictOk =
    results.conflict.inputOk && results.conflict.inputCaseKind === "conflict" && results.conflict.outputOk;
  return {
    ok: positiveOk && negativeOk && partialOk && conflictOk,
    results,
  };
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const arg = process.argv[2] || "--self-check";
  if (arg === "--catalog") {
    process.stdout.write(`${JSON.stringify(schemaCatalog(), null, 2)}\n`);
  } else {
    const result = selfCheck();
    process.stdout.write(`${JSON.stringify({ ok: result.ok, results: result.results }, null, 2)}\n`);
    if (!result.ok) process.exit(1);
  }
}
