/**
 * S137 c12 — table-reconcile transform (R2-CONSUMER-JOBS-03).
 *
 * Merge supplied source tables on explicit keys, units, and time windows.
 * Surface disagreement. Never invent totals, unit conversions, grain rollups,
 * or missing-key fills. Offline. No network. No default merge.
 */

import { pathToFileURL } from "node:url";

import {
  JOB_ID,
  ARTIFACT_KIND,
  INPUT_SCHEMA,
  OUTPUT_SCHEMA,
  LIMITS,
  POLICIES,
  TOTALS_NOT_COMPUTED,
  ROW_OUTCOMES,
  FINDING_KINDS,
  keyTuple,
  unitsCompatible,
  findDeclaredConversion,
  makeCitation,
  makeFinding,
  createOutputPacket,
  validateInput,
  validateOutput,
  sha256Hex,
  stableStringify,
} from "./schema.mjs";

export {
  JOB_ID,
  ARTIFACT_KIND,
  INPUT_SCHEMA,
  OUTPUT_SCHEMA,
  POLICIES,
  TOTALS_NOT_COMPUTED,
  ROW_OUTCOMES,
};

export const TRANSFORM_SCHEMA = "s137.table-reconcile.transform.v1";

export const LIMITATIONS = Object.freeze([
  "Does not invent totals, averages, majority votes, or zero-fills.",
  "Does not convert units unless join.conversions declares an explicit factor.",
  "Does not roll up or split time grains (P7D is not the sum of P1D rows).",
  "Does not infer join keys, units, or windows from raw arrays.",
  "Does not pick a winning source on disagreement (no default merge).",
  "Does not fetch network, pay endpoints, or attest legal/customer-demand claims.",
]);

const TIME_KEY_NAMES = new Set(["windowStart", "windowEnd", "observedAt", "start", "end"]);

const SURFACE_TO_CASE = Object.freeze({
  agree: "positive",
  "invalid-input": "negative",
  "missing-in-source": "partial",
  "value-conflict": "conflict",
  "unit-conflict": "conflict",
  "time-window-mismatch": "conflict",
  unkeyed: "negative",
  duplicate_key: "conflict",
});

const SURFACE_TO_OUTCOME = Object.freeze({
  agree: "agree",
  "invalid-input": "excluded",
  "missing-in-source": "partial",
  "value-conflict": "conflict",
  "unit-conflict": "unit_mismatch",
  "time-window-mismatch": "window_mismatch",
  unkeyed: "unkeyed",
  duplicate_key: "conflict",
});

function isPlainObject(value) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function dateToken(iso) {
  if (typeof iso !== "string" || iso.length < 10) return "unknown";
  return iso.slice(0, 10);
}

function shortId(table) {
  if (table.shortId) return String(table.shortId);
  const id = String(table.id || "");
  const slash = id.lastIndexOf("/");
  return slash >= 0 ? id.slice(slash + 1) : id || "table";
}

function measureNames(join, tables) {
  if (join?.units && isPlainObject(join.units) && Object.keys(join.units).length) {
    return Object.keys(join.units);
  }
  const names = [];
  const seen = new Set();
  for (const table of tables) {
    for (const col of table.columns || []) {
      if (col && col.role === "measure" && col.name && !seen.has(col.name)) {
        seen.add(col.name);
        names.push(col.name);
      }
    }
  }
  if (names.length) return names;
  return ["value"];
}

function columnUnit(table, measure) {
  const col = (table.columns || []).find((c) => c && c.name === measure);
  return col?.unit ?? table.unit ?? null;
}

function tableGrain(table) {
  const grain = table?.timeWindow?.grain;
  return grain == null || grain === "" ? null : String(grain);
}

function isUndeclaredTable(table) {
  if (!table || typeof table !== "object") return true;
  if (table.raw === true) return true;
  if (Array.isArray(table)) return true;
  if (table.keys == null && table.schema == null && !Array.isArray(table.columns)) return true;
  return false;
}

function lookupProvidedCitationId(table, provided) {
  if (!Array.isArray(provided)) return null;
  const path = table.path || table.source?.path;
  for (const citation of provided) {
    if (!citation?.id) continue;
    if (path && (citation.path === path || String(citation.path || "").endsWith(path))) {
      return citation.id;
    }
    if (table.id && citation.id === `src:${table.id}`) return citation.id;
  }
  return null;
}

function citationForTable(table, evidenceClass, provided) {
  const lookedUp = lookupProvidedCitationId(table, provided);
  const id =
    table.citationId ||
    lookedUp ||
    (table.id && !String(table.id).endsWith(".json") ? `src:${table.id}` : null) ||
    (table.specId && table.shortId ? `src:${table.specId}/${table.shortId}` : null) ||
    `src:${shortId(table)}`;
  const path =
    table.path ||
    table.source?.path ||
    (table.url || table.source?.url ? null : `synthetic://table-reconcile/${table.id || shortId(table)}`);
  const url = table.url || table.source?.url || null;
  const hash =
    table.sha256 ||
    table.contentSha256 ||
    table.source?.sha256 ||
    sha256Hex(stableStringify({ id: table.id, rows: table.rows || [] }));
  const made = makeCitation({
    id,
    path,
    url,
    contentSha256: hash,
    evidenceClass: table.evidenceClass || evidenceClass || "synthetic",
    licenseNote: table.license || table.licenseNote || null,
    retrievedAt: table.retrievedAt || table.authoredAt || null,
  });
  if (!made.ok) {
    return {
      id,
      path: path || `synthetic://table-reconcile/${id}`,
      url,
      contentSha256: typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash) ? hash : sha256Hex(id),
      evidenceClass: evidenceClass || "synthetic",
      licenseNote: table.license || null,
      retrievedAt: table.retrievedAt || table.authoredAt || null,
    };
  }
  return made.citation;
}

function addFinding(findings, citations, {
  id,
  surfaceKind,
  message,
  citationIds,
  key = null,
  unit = null,
  extra = {},
}) {
  const kind = FINDING_KINDS.includes(surfaceKind)
    ? surfaceKind
    : SURFACE_TO_CASE[surfaceKind] === "negative"
      ? "invalid-input"
      : SURFACE_TO_CASE[surfaceKind] === "conflict"
        ? "conflict"
        : SURFACE_TO_CASE[surfaceKind] || extra.caseKind || "invalid-input";
  const outcome = extra.outcome || SURFACE_TO_OUTCOME[surfaceKind] || null;
  const made = makeFinding({
    id,
    kind,
    code: extra.code || surfaceKind,
    message,
    citationIds,
    key,
    timeWindow: extra.timeWindow || extra.span || null,
    unit,
    outcome,
  });
  if (!made.ok) {
    throw new Error(made.issues.map((issue) => issue.message).join("; "));
  }
  const finding = {
    ...made.finding,
    keys: extra.keys || key,
    surfaceKind,
    ...extra,
  };
  delete finding.caseKind;
  findings.push(finding);
  return finding;
}

function valuesBySource(obs, field) {
  const out = {};
  for (const item of obs) out[item.shortId] = item[field];
  return out;
}

function canonicalizeMeasure(value) {
  if (value == null) return { text: "null", raw: null };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { text: String(value), raw: value };
    return { text: String(value), raw: value };
  }
  return { text: stableStringify(value), raw: value };
}

function applyConversion(value, fromUnit, toUnit, conversions) {
  if (fromUnit == null || toUnit == null) {
    return { ok: false, value: null, converted: false };
  }
  const found = findDeclaredConversion(fromUnit, toUnit, conversions);
  if (!found.ok) return { ok: false, value: null, converted: false, reason: found.reason };
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { ok: false, value: null, converted: false, reason: "non_numeric_measure" };
  }
  return { ok: true, value: value * found.factor, converted: !found.identity, factor: found.factor };
}

function nonTimeKeys(joinKeys) {
  return (joinKeys || []).filter((key) => !TIME_KEY_NAMES.has(key));
}

function metricKey(row, keys) {
  const tuple = {};
  for (const key of nonTimeKeys(keys)) {
    if (row[key] != null && row[key] !== "") tuple[key] = row[key];
  }
  return tuple;
}

function unwrapTables(input) {
  if (input && Array.isArray(input.tables) && input.spec) {
    return {
      spec: input.spec,
      clock: input.clock || input.spec.clock,
      evidenceClass: input.evidenceClass || input.spec.evidenceClass || "synthetic",
      join: input.join || input.spec.join,
      citations: input.citations || input.spec.citations,
      doNotInvent: input.doNotInvent || input.spec.doNotInvent,
      tables: input.tables.map((entry) => {
        const body = entry.body && typeof entry.body === "object" ? entry.body : entry;
        const table = isPlainObject(body) ? { ...body } : body;
        const short = entry.id || shortId({ id: body.id || entry.id });
        const specId = input.spec.id || null;
        const stableId =
          (typeof body.id === "string" && !body.id.endsWith(".json") && body.id) ||
          (specId && short ? `${specId}/${short}` : short);
        if (Array.isArray(body) || body?.raw === true) {
          return {
            raw: true,
            id: stableId,
            specId,
            shortId: short,
            path: entry.path || body.path,
            sha256: entry.sha256 || body.sha256,
            keys: body.keys ?? null,
            unit: body.unit ?? null,
            timeWindow: body.timeWindow ?? null,
            columns: body.columns ?? null,
            rows: Array.isArray(body) ? body : body.rows || [],
            evidenceClass: body.evidenceClass || input.spec.evidenceClass,
            citationId: lookupProvidedCitationId(
              { path: entry.path || body.path, id: stableId },
              input.spec.citations,
            ),
          };
        }
        return {
          ...table,
          id: table.id || stableId,
          specId,
          shortId: short,
          path: entry.path || table.path,
          sha256: entry.sha256 || table.sha256,
        };
      }),
    };
  }

  if (input && input.schema === "s137.table-reconcile.case.v1") {
    return {
      spec: input,
      clock: input.clock,
      evidenceClass: input.evidenceClass || "synthetic",
      join: input.join,
      citations: input.citations,
      doNotInvent: input.doNotInvent,
      tables: (input.tables || []).map((entry) => {
        if (entry && (entry.rows || entry.body || entry.raw)) {
          const body = entry.body || entry;
          return {
            ...body,
            shortId: entry.id || shortId(body),
            path: entry.path || body.path,
            sha256: entry.sha256 || body.sha256,
          };
        }
        return {
          id: entry.id,
          shortId: entry.id,
          path: entry.path,
          rows: entry.rows,
          missingBody: !entry.rows,
        };
      }),
    };
  }

  return {
    spec: null,
    clock: input?.clock,
    evidenceClass: input?.evidenceClass || "synthetic",
    join: input?.join,
    citations: input?.citations,
    doNotInvent: input?.doNotInvent,
    tables: Array.isArray(input?.tables) ? input.tables : [],
    schemaInput: input,
  };
}

function normalizeJoin(join, tables) {
  const src = join && isPlainObject(join) ? join : {};
  let units = src.units;
  if (!units && typeof src.unit === "string" && src.unit) {
    const measures = measureNames({ units: {} }, tables);
    units = { [measures[0] || "value"]: src.unit };
  }
  if (!units && src.unit == null) {
    const measures = measureNames({ units: {} }, tables);
    units = {};
    for (const name of measures) units[name] = tables.find((t) => t.unit)?.unit || undefined;
    for (const name of Object.keys(units)) {
      if (units[name] == null) delete units[name];
    }
  }
  return {
    keys: Array.isArray(src.keys) ? src.keys : [],
    units: isPlainObject(units) ? units : {},
    unit: src.unit === undefined ? null : src.unit,
    timeWindow: src.timeWindow || null,
    grain: src.timeWindow?.grain ?? null,
    conversions: Array.isArray(src.conversions) ? src.conversions : [],
  };
}

function attachCitations(tables, provided, evidenceClass) {
  const byId = new Map();
  if (Array.isArray(provided)) {
    for (const citation of provided) {
      if (citation?.id) byId.set(citation.id, citation);
    }
  }
  const citations = [];
  const seen = new Set();
  for (const table of tables) {
    const generated = citationForTable(table, evidenceClass, provided);
    const id = generated.id;
    table.citationId = id;
    if (seen.has(id)) continue;
    seen.add(id);
    const given = byId.get(id);
    if (given) {
      citations.push({
        id: given.id,
        path: given.path || generated.path,
        url: given.url || generated.url,
        contentSha256: given.sha256 || given.contentSha256 || generated.contentSha256,
        retrievedAt: given.retrievedAt || generated.retrievedAt || null,
        evidenceClass: given.evidenceClass || generated.evidenceClass,
        licenseNote: given.licenseNote || generated.licenseNote || null,
      });
    } else {
      citations.push(generated);
    }
  }
  return citations;
}

function failPacket({
  clock,
  evidenceClass,
  join,
  citations,
  findings,
  caseKind = "negative",
  groups = [],
  sources,
}) {
  const packet = createOutputPacket({
    clock,
    evidenceClass,
    decision: "fail",
    caseKind,
    sources: sources || citations,
    findings,
    citations,
    limitations: LIMITATIONS,
    join,
    groups,
  });
  packet.inventTotals = false;
  packet.defaultMerge = false;
  packet.totals = { ...TOTALS_NOT_COMPUTED };
  packet.policies = POLICIES;
  return packet;
}

/**
 * Merge tables. `input` may be schema input.v1, a case.v1 document with
 * inlined table bodies, or `{ spec, tables }` from fixtures/load-case.mjs.
 */
export function reconcileTables(input = {}) {
  if (input && (input.strategy === "sum" || input.strategy === "average" || input.inventTotals === true)) {
    throw new Error("invented totals are forbidden; do not request sum/average/default merge");
  }

  const unpacked = unwrapTables(input);
  const clock = unpacked.clock;
  if (!clock) throw new Error("clock required (operator-supplied; do not invent)");
  const evidenceClass = unpacked.evidenceClass || "synthetic";
  const tables = unpacked.tables || [];
  const join = normalizeJoin(unpacked.join, tables.filter((t) => !t.raw && !t.missingBody));
  const citations = attachCitations(tables, unpacked.citations, evidenceClass);
  const fallbackCite = citations[0];

  if (!fallbackCite) {
    const made = makeCitation({
      id: "src:input",
      path: "synthetic://table-reconcile/input",
      body: stableStringify({ join, tableCount: tables.length }),
      evidenceClass,
      licenseNote: "operator input; no table source path",
    });
    citations.push(made.citation);
  }

  const findings = [];
  const groups = [];

  const cite = (...ids) => {
    const list = ids.filter(Boolean);
    return list.length ? list : [citations[0].id];
  };

  if (tables.some((table) => table.missingBody)) {
    const table = tables.find((item) => item.missingBody);
    addFinding(findings, citations, {
      id: `invalid:missing-body:${shortId(table)}`,
      surfaceKind: "invalid-input",
      message: "Table path was supplied without a body; transform does not fetch.",
      citationIds: cite(table.citationId),
      extra: { code: "missing-body", sourceId: shortId(table) },
    });
    return failPacket({ clock, evidenceClass, join, citations, findings });
  }

  for (const table of tables) {
    if (isUndeclaredTable(table)) {
      addFinding(findings, citations, {
        id: `invalid:missing-keys:${shortId(table)}`,
        surfaceKind: "invalid-input",
        message: "Raw table has no keys/unit/timeWindow; join keys are not inferred.",
        citationIds: cite(table.citationId),
        extra: { code: "missing-keys", sourceId: shortId(table) },
      });
      return failPacket({ clock, evidenceClass, join, citations, findings });
    }
  }

  if (!Array.isArray(join.keys) || join.keys.length === 0) {
    addFinding(findings, citations, {
      id: "invalid:missing-join-keys",
      surfaceKind: "invalid-input",
      message: "join.keys must be a non-empty array; keys are not inferred.",
      citationIds: cite(),
      extra: { code: "missing-keys" },
    });
    return failPacket({ clock, evidenceClass, join, citations, findings });
  }

  for (const table of tables) {
    if (Array.isArray(table.rows) && table.rows.length === 0) {
      addFinding(findings, citations, {
        id: `invalid:empty-rows:${shortId(table)}`,
        surfaceKind: "invalid-input",
        message: "Empty rows cannot reconcile; absence is not a zero total.",
        citationIds: cite(table.citationId),
        extra: { code: "empty-rows", sourceId: shortId(table) },
      });
      return failPacket({ clock, evidenceClass, join, citations, findings });
    }
  }

  if (tables.length === 0) {
    addFinding(findings, citations, {
      id: "invalid:no-tables",
      surfaceKind: "invalid-input",
      message: "No tables were supplied.",
      citationIds: cite(),
      extra: { code: "empty-tables" },
    });
    return failPacket({ clock, evidenceClass, join, citations, findings });
  }

  const measures = measureNames(join, tables);
  const measure = measures[0];
  const conversions = join.conversions;
  const grains = [...new Set(tables.map(tableGrain).filter((g) => g != null))];
  const grainConflict = grains.length > 1;

  if (grainConflict) {
    const byMetric = new Map();
    for (const table of tables) {
      for (const row of table.rows || []) {
        const mk = metricKey(row, join.keys);
        const id = sha256Hex(stableStringify(mk));
        if (!byMetric.has(id)) byMetric.set(id, { key: mk, obs: [] });
        byMetric.get(id).obs.push({
          shortId: shortId(table),
          citationId: table.citationId,
          grain: tableGrain(table),
          window: table.timeWindow || null,
        });
      }
    }
    for (const group of byMetric.values()) {
      const present = new Set(group.obs.map((o) => o.shortId));
      if (present.size < 2 && tables.length >= 2) continue;
      const span = join.timeWindow || group.obs[0]?.window || null;
      const spanStart = span?.start || null;
      addFinding(findings, citations, {
        id: `conflict-window:${Object.values(group.key).join(":") || "row"}:span-${dateToken(spanStart)}`,
        surfaceKind: "time-window-mismatch",
        message: "Overlapping calendar span with different grains; daily rows are not rolled into a weekly total.",
        citationIds: cite(...group.obs.map((o) => o.citationId)),
        key: group.key,
        extra: {
          keys: group.key,
          grainBySource: valuesBySource(group.obs, "grain"),
          span: span ? { start: span.start || null, end: span.end || null } : null,
          timeWindow: span,
        },
      });
      groups.push({
        key: group.key,
        outcome: "window_mismatch",
        grainBySource: valuesBySource(group.obs, "grain"),
      });
    }
    return finish({
      clock,
      evidenceClass,
      join,
      citations,
      findings,
      groups,
      decision: "conflict",
      caseKind: "conflict",
    });
  }

  const buckets = new Map();
  for (const table of tables) {
    const seen = new Set();
    for (let r = 0; r < (table.rows || []).length; r += 1) {
      const row = table.rows[r];
      const keyed = keyTuple(row, join.keys, `/tables/${table.id}/rows/${r}`);
      if (!keyed.ok) {
        addFinding(findings, citations, {
          id: `unkeyed:${shortId(table)}:${r}`,
          surfaceKind: "unkeyed",
          message: `Row is missing join key ${keyed.missing || "column"}; not filled.`,
          citationIds: cite(table.citationId),
          extra: { code: keyed.code || "unkeyed", sourceId: shortId(table) },
        });
        continue;
      }
      if (seen.has(keyed.id)) {
        addFinding(findings, citations, {
          id: `duplicate:${shortId(table)}:${keyed.id.slice(0, 12)}`,
          surfaceKind: "duplicate_key",
          message: "Duplicate join key inside one table; neither row is chosen as default.",
          citationIds: cite(table.citationId),
          key: keyed.tuple,
          extra: { keys: keyed.tuple, sourceId: shortId(table) },
        });
        continue;
      }
      seen.add(keyed.id);
      if (!buckets.has(keyed.id)) buckets.set(keyed.id, { key: keyed.tuple, obs: [] });
      const unit = columnUnit(table, measure) || join.units[measure] || join.unit || null;
      buckets.get(keyed.id).obs.push({
        tableId: table.id,
        shortId: shortId(table),
        citationId: table.citationId,
        value: row[measure],
        unit,
        grain: tableGrain(table),
        windowEnd: row.windowEnd ?? null,
        windowStart: row.windowStart ?? keyed.tuple.windowStart ?? null,
        timeWindow: table.timeWindow || null,
      });
    }
  }

  const tableCount = tables.length;
  let anyConflict = findings.some((f) => f.kind === "conflict" || f.kind === "conflicting" || SURFACE_TO_CASE[f.surfaceKind] === "conflict");
  let anyPartial = findings.some((f) => f.kind === "partial" || f.surfaceKind === "missing-in-source");
  let anyNegative = findings.some((f) => f.kind === "negative" || f.kind === "invalid-input");
  let anyAgree = false;

  const sorted = [...buckets.values()].sort((a, b) =>
    stableStringify(a.key) < stableStringify(b.key) ? -1 : 1,
  );

  for (const bucket of sorted) {
    const { key, obs } = bucket;
    const metric = key.metric;
    const start = key.windowStart;
    const allCite = cite(...obs.map((o) => o.citationId));

    if (obs.length < tableCount) {
      const present = new Set(obs.map((o) => o.shortId));
      for (const table of tables) {
        const sid = shortId(table);
        if (present.has(sid)) continue;
        addFinding(findings, citations, {
          id: `missing:${metric || "row"}:${dateToken(start)}:${sid}`,
          surfaceKind: "missing-in-source",
          message: `Join key is present in other tables but missing in ${sid}; not zero-filled.`,
          citationIds: cite(...obs.map((o) => o.citationId)),
          key,
          extra: {
            keys: key,
            sourceId: sid,
            code: "missing-in-source",
          },
        });
        anyPartial = true;
      }
      if (obs.length >= 2) {
        // overlapping sources still compared below
      } else {
        groups.push({ key, outcome: "partial", tableIds: obs.map((o) => o.shortId) });
        continue;
      }
    }

    const units = [...new Set(obs.map((o) => o.unit).filter((u) => u != null))];

    if (units.length > 1) {
      const declared = obs.every((o, i) => {
        if (i === 0) return true;
        const left = obs[0];
        const compat = unitsCompatible(left.unit, o.unit);
        if (compat.compatible) return true;
        return applyConversion(o.value, o.unit, left.unit, conversions).ok
          || applyConversion(left.value, left.unit, o.unit, conversions).ok;
      });
      if (!declared) {
        addFinding(findings, citations, {
          id: `conflict-units:${metric || "row"}:${dateToken(start)}`,
          surfaceKind: "unit-conflict",
          message: "Same join key with incomparable units; numeric equality is not agreement. No conversion was supplied.",
          citationIds: allCite,
          key,
          extra: {
            keys: key,
            unitsBySource: valuesBySource(obs, "unit"),
            valuesBySource: valuesBySource(obs, "value"),
            code: "unit-conflict",
          },
        });
        groups.push({
          key,
          outcome: "unit_mismatch",
          values: obs.map((o) => o.value),
          unitsBySource: valuesBySource(obs, "unit"),
        });
        anyConflict = true;
        continue;
      }
    }

    const ends = [...new Set(obs.map((o) => o.windowEnd).filter((e) => e != null))];
    if (ends.length > 1) {
      addFinding(findings, citations, {
        id: `conflict-window:${metric || "row"}:span-${dateToken(start)}`,
        surfaceKind: "time-window-mismatch",
        message: "Same join key with different row windows; bounds are not interpolated.",
        citationIds: allCite,
        key,
        extra: {
          keys: key,
          span: { start: obs[0].windowStart, end: obs[0].windowEnd },
        },
      });
      groups.push({ key, outcome: "window_mismatch", values: obs.map((o) => o.value) });
      anyConflict = true;
      continue;
    }

    const targetUnit = join.units[measure] || join.unit || obs[0].unit;
    const comparable = obs.map((o) => {
      if (targetUnit && o.unit && o.unit !== targetUnit) {
        const conv = applyConversion(o.value, o.unit, targetUnit, conversions);
        if (conv.ok) return { ...o, compareValue: conv.value };
      }
      return { ...o, compareValue: o.value };
    });
    const texts = new Set(comparable.map((o) => canonicalizeMeasure(o.compareValue).text));
    if (texts.size > 1) {
      addFinding(findings, citations, {
        id: `conflict:${metric || "row"}:${dateToken(start)}`,
        surfaceKind: "value-conflict",
        message: "Same keys/units/window with disagreeing measures. Both values are kept; no average or total is invented.",
        citationIds: allCite,
        key,
        unit: targetUnit,
        extra: {
          keys: key,
          valuesBySource: valuesBySource(obs, "value"),
          code: "value-conflict",
        },
      });
      groups.push({
        key,
        outcome: "conflict",
        unit: targetUnit,
        values: obs.map((o) => o.value),
      });
      anyConflict = true;
      continue;
    }

    const agreed = obs[0].value;
    addFinding(findings, citations, {
      id: `agree:${metric || Object.values(key).join(":")}:${dateToken(start)}`,
      surfaceKind: "agree",
      message: "Keys, unit, grain, and measure agree across supplied tables.",
      citationIds: allCite,
      key,
      unit: targetUnit,
      extra: {
        keys: key,
        value: agreed,
        code: "agree",
      },
    });
    groups.push({
      key,
      outcome: "agree",
      unit: targetUnit,
      values: obs.map((o) => o.value),
    });
    anyAgree = true;
  }

  let decision = "unknown";
  let caseKind = null;
  if (anyNegative && !anyConflict && !anyPartial && !anyAgree) {
    decision = "fail";
    caseKind = "negative";
  } else if (anyConflict) {
    decision = "conflict";
    caseKind = "conflict";
  } else if (anyPartial) {
    decision = "partial";
    caseKind = "partial";
  } else if (anyAgree && !anyNegative) {
    decision = "pass";
    caseKind = "positive";
  } else if (anyNegative) {
    decision = "fail";
    caseKind = "negative";
  }

  return finish({
    clock,
    evidenceClass,
    join,
    citations,
    findings,
    groups,
    decision,
    caseKind,
  });
}

function finish({ clock, evidenceClass, join, citations, findings, groups, decision, caseKind }) {
  if (findings.length > LIMITS.maxFindings) {
    findings.length = LIMITS.maxFindings;
  }
  const packet = createOutputPacket({
    clock,
    evidenceClass,
    decision,
    caseKind,
    sources: citations,
    findings,
    citations,
    limitations: LIMITATIONS,
    join: {
      keys: join.keys,
      units: join.units,
      unit: join.unit,
      timeWindow: join.timeWindow,
      conversions: join.conversions,
    },
    groups,
  });
  packet.inventTotals = false;
  packet.defaultMerge = false;
  packet.totals = { ...TOTALS_NOT_COMPUTED };
  packet.policies = POLICIES;
  return packet;
}

export function transform(input) {
  return reconcileTables(input);
}

export { validateInput, validateOutput };

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

async function registerSelfChecks() {
  const { test } = await import("node:test");
  const assert = (await import("node:assert/strict")).default;
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = dirname(fileURLToPath(import.meta.url));
  const loadPath = join(here, "../../fixtures/synthetic/table-reconcile/load-case.mjs");
  const { loadCase, loadManifest } = await import(pathToFileURL(loadPath).href);

  function runCase(id) {
    return reconcileTables(loadCase(id));
  }

  function findingIds(packet) {
    return packet.findings.map((f) => f.id);
  }

  test("positive: agreeing tables pass without invented totals", () => {
    const packet = runCase("positive-agree");
    assert.equal(packet.decision, "pass");
    assert.equal(packet.inventTotals, false);
    assert.equal(packet.totals.computed, false);
    assert.equal(packet.totals.invented, false);
    assert.ok(!("value" in (packet.totals || {})));
    const ids = findingIds(packet);
    assert.ok(ids.includes("agree:synthetic.page_extracts:2026-08-03"));
    assert.ok(ids.includes("agree:synthetic.page_extracts:2026-08-10"));
    assert.ok(ids.includes("agree:synthetic.link_index_hits:2026-08-03"));
    const agree = packet.findings.find((f) => f.id === "agree:synthetic.page_extracts:2026-08-03");
    assert.equal(agree.value, 4);
    assert.equal(agree.unit, "count");
    assert.deepEqual(agree.citationIds.sort(), [
      "src:positive-agree/lab-a",
      "src:positive-agree/lab-b",
    ].sort());
    const checked = validateOutput(packet);
    assert.equal(checked.ok, true, JSON.stringify(checked.issues));
  });

  test("negative: empty rows fail and are not zero-filled", () => {
    const packet = runCase("negative-empty");
    assert.equal(packet.decision, "fail");
    assert.ok(findingIds(packet).includes("invalid:empty-rows:lab-a"));
    const finding = packet.findings[0];
    assert.equal(finding.code, "empty-rows");
    assert.deepEqual(finding.citationIds, ["src:negative-empty/lab-a"]);
    assert.equal(packet.totals.invented, false);
    assert.equal(validateOutput(packet).ok, true);
  });

  test("negative: raw array without keys fails; keys are not inferred", () => {
    const packet = runCase("negative-missing-keys");
    assert.equal(packet.decision, "fail");
    assert.ok(findingIds(packet).includes("invalid:missing-keys:lab-a"));
    assert.equal(packet.findings[0].code, "missing-keys");
    assert.deepEqual(packet.findings[0].citationIds, ["src:negative-missing-keys/lab-a"]);
    assert.equal(validateOutput(packet).ok, true);
  });

  test("partial: missing key stays missing; overlap still agrees", () => {
    const packet = runCase("partial-row-coverage");
    assert.equal(packet.decision, "partial");
    const ids = findingIds(packet);
    assert.ok(ids.includes("agree:synthetic.page_extracts:2026-08-03"));
    assert.ok(ids.includes("agree:synthetic.page_extracts:2026-08-10"));
    assert.ok(ids.includes("missing:synthetic.link_index_hits:2026-08-03:lab-b"));
    const missing = packet.findings.find((f) => f.id.startsWith("missing:"));
    assert.equal(missing.sourceId, "lab-b");
    assert.deepEqual(missing.citationIds, ["src:partial-row-coverage/lab-a"]);
    assert.equal(packet.totals.computed, false);
    assert.equal(validateOutput(packet).ok, true);
  });

  test("conflict: disagreeing values are listed, not averaged", () => {
    const packet = runCase("conflict-value");
    assert.equal(packet.decision, "conflict");
    const conflict = packet.findings.find((f) => f.id === "conflict:synthetic.page_extracts:2026-08-03");
    assert.ok(conflict);
    assert.equal(conflict.code, "value-conflict");
    assert.deepEqual(conflict.valuesBySource, { "lab-a": 4, "lab-b": 9 });
    assert.ok(findingIds(packet).includes("agree:synthetic.page_extracts:2026-08-10"));
    const sum = 4 + 9;
    assert.ok(!packet.findings.some((f) => f.value === sum));
    assert.equal(packet.totals.invented, false);
    assert.equal(validateOutput(packet).ok, true);
  });

  test("conflict: count vs count_per_day is not agreement", () => {
    const packet = runCase("conflict-units");
    assert.equal(packet.decision, "conflict");
    const finding = packet.findings.find((f) => f.id === "conflict-units:synthetic.page_extracts:2026-08-03");
    assert.ok(finding);
    assert.equal(finding.code, "unit-conflict");
    assert.deepEqual(finding.unitsBySource, { "lab-a": "count", "lab-b": "count_per_day" });
    assert.deepEqual(finding.valuesBySource, { "lab-a": 4, "lab-b": 4 });
    assert.equal(validateOutput(packet).ok, true);
  });

  test("conflict: P7D vs P1D is a window mismatch; daily rows are not summed", () => {
    const packet = runCase("conflict-time-window");
    assert.equal(packet.decision, "conflict");
    const finding = packet.findings.find((f) => f.code === "time-window-mismatch");
    assert.ok(finding);
    assert.equal(finding.id, "conflict-window:synthetic.page_extracts:span-2026-08-03");
    assert.deepEqual(finding.grainBySource, { "lab-a": "P7D", "lab-b": "P1D" });
    const dailySum = 2 + 0 + 1 + 3 + 0 + 1 + 0;
    assert.ok(!packet.findings.some((f) => f.value === dailySum || f.value === 11));
    assert.equal(packet.totals.computed, false);
    assert.equal(validateOutput(packet).ok, true);
  });

  test("schema exampleCases: positive/negative/partial/conflicting map to decisions", async () => {
    const schema = await import("./schema.mjs");
    const examples = schema.exampleCases("2026-09-10T00:00:00Z");
    const positive = reconcileTables(examples.positive.input);
    assert.equal(positive.decision, "pass");
    const negative = reconcileTables({
      ...examples.negative.input,
      clock: "2026-09-10T00:00:00Z",
      tables: examples.negative.input.tables,
      join: examples.negative.input.join,
    });
    assert.equal(negative.decision, "fail");
    const partial = reconcileTables(examples.partial.input);
    assert.ok(["partial", "pass"].includes(partial.decision));
    const conflicting = reconcileTables((examples.conflict || examples.conflicting).input);
    assert.equal(conflicting.decision, "conflict");
  });

  test("manifest lists required kinds and transform covers each", () => {
    const manifest = loadManifest();
    const kinds = new Set(manifest.cases.map((c) => c.kind));
    for (const kind of ["positive", "negative", "partial", "conflict"]) {
      assert.ok(kinds.has(kind), `missing kind ${kind}`);
    }
    for (const entry of manifest.cases) {
      const packet = runCase(entry.id);
      assert.equal(packet.decision, entry.expectDecision, entry.id);
      assert.equal(packet.jobId, JOB_ID);
      assert.equal(packet.offline, true);
      assert.equal(packet.payment.attempted, false);
      assert.equal(packet.claims.inventsFacts, false);
    }
  });
}

if (isMain) {
  await registerSelfChecks();
}
