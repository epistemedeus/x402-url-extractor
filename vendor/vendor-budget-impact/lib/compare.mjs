/**
 * Factual extracted pricing-table field/unit change (offline).
 * Projection of epistemedeus/samedaydesk
 * experiments/s134-record-jobs/modules/pricing-table-change/cli.mjs
 * at SDS PR74 b23260e6a2b74452075f73da1631da24d8ae6906.
 * Inputs are already-extracted table JSON (rows of {field, value, unit?}).
 * Does not scrape URLs, invent prices, or claim paid catalog value.
 * Merchant HTTP must not call the original CLI file reader.
 */

export const CASH_BOUNDARY_USD = 0;
export const PAID_VALUE_CLAIM = false;

export const FREE_BASELINE = {
  kind: "competent-free-baseline",
  description:
    "Diff supplied local artifacts with maintained offline parsers. No URL fetch, no LLM, no notifications, no marketplace listing.",
  paidValueClaim: false,
};

export function uncertainty(code, detail, evidence = {}) {
  return { code, detail, evidence };
}

export function stableSort(arr, keyFn) {
  return [...arr].sort((a, b) => {
    const ka = keyFn(a);
    const kb = keyFn(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

function normalizeUnit(u) {
  if (u == null) return null;
  const s = String(u).trim();
  return s === "" ? null : s;
}

function normalizeField(f) {
  return String(f ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function publicRow(row) {
  if (!row) return null;
  return {
    field: row.field,
    fieldKey: row.fieldKey,
    value: row.value,
    unit: row.unit,
    unitKey: row.unitKey,
  };
}

export function loadPricingTable(doc, label) {
  const uncertainties = [];
  if (doc == null) return { ok: false, error: "null-document", label, rows: [], uncertainties };
  if (typeof doc === "string") {
    try {
      doc = JSON.parse(doc);
    } catch (e) {
      return { ok: false, error: "parse-error", detail: String(e.message || e), label, rows: [], uncertainties };
    }
  }
  let rows = [];
  if (Array.isArray(doc)) rows = doc;
  else if (doc && Array.isArray(doc.rows)) rows = doc.rows;
  else if (doc && Array.isArray(doc.items)) rows = doc.items;
  else {
    return {
      ok: false,
      error: "unsupported-shape",
      label,
      rows: [],
      uncertainties: [uncertainty("unsupported-shape", "Need array or {rows|items:[...]}")],
    };
  }
  if (rows.length === 0) {
    uncertainties.push(uncertainty("empty-table", `${label} has zero rows`));
  }
  const normalized = [];
  for (const [i, r] of rows.entries()) {
    if (!r || typeof r !== "object") {
      uncertainties.push(uncertainty("malformed-row", `row ${i} not object`, { index: i }));
      continue;
    }
    const field = r.field ?? r.name ?? r.key ?? null;
    if (field == null || String(field).trim() === "") {
      uncertainties.push(uncertainty("missing-field", `row ${i} missing field/name/key`, { index: i }));
      continue;
    }
    const value = r.value ?? r.amount ?? r.price ?? null;
    const unit = r.unit ?? r.currency ?? r.uom ?? null;
    if (value == null) {
      uncertainties.push(uncertainty("missing-value", `row ${i} missing value`, { field }));
    }
    normalized.push({
      field: String(field),
      fieldKey: normalizeField(field),
      value,
      unit: unit == null ? null : String(unit),
      unitKey: normalizeUnit(unit),
    });
  }
  const seen = new Map();
  for (const row of normalized) {
    if (!seen.has(row.fieldKey)) seen.set(row.fieldKey, []);
    seen.get(row.fieldKey).push(row);
  }
  for (const [fk, list] of seen) {
    if (list.length > 1) {
      uncertainties.push(
        uncertainty("duplicate-field", `multiple rows for fieldKey=${fk}`, {
          fieldKey: fk,
          count: list.length,
        }),
      );
    }
  }
  return { ok: true, label, rows: normalized, byKey: seen, uncertainties };
}

export function comparePricingTables(beforeDoc, afterDoc) {
  const before = loadPricingTable(beforeDoc, "before");
  const after = loadPricingTable(afterDoc, "after");
  const uncertainties = [...before.uncertainties, ...after.uncertainties];
  if (!before.ok || !after.ok) {
    return {
      module: "pricing-table-change",
      ok: false,
      errors: [before.ok ? null : before, after.ok ? null : after].filter(Boolean),
      uncertainties,
      freeBaseline: FREE_BASELINE,
      differenceInDeliveredOutput: "No pricing delta: input tables failed local structural load.",
    };
  }

  const fieldChanges = [];
  const unitChanges = [];
  const added = [];
  const removed = [];
  const unchanged = [];
  const conflicting = [];
  const unknown = [];

  const keys = new Set([...before.byKey.keys(), ...after.byKey.keys()]);
  for (const key of [...keys].sort()) {
    const bList = before.byKey.get(key) || [];
    const aList = after.byKey.get(key) || [];
    if (bList.length === 0 && aList.length === 1) {
      added.push({ fieldKey: key, after: publicRow(aList[0]) });
      continue;
    }
    if (bList.length === 1 && aList.length === 0) {
      removed.push({ fieldKey: key, before: publicRow(bList[0]) });
      continue;
    }
    if (bList.length === 0 && aList.length === 0) {
      unknown.push({ fieldKey: key, reason: "empty-both" });
      continue;
    }
    if (bList.length > 1 || aList.length > 1) {
      conflicting.push({
        fieldKey: key,
        reason: "duplicate-rows-prevent-unique-compare",
        beforeCount: bList.length,
        afterCount: aList.length,
      });
      continue;
    }
    const b = bList[0];
    const a = aList[0];
    const bMissing = b.value == null;
    const aMissing = a.value == null;
    const valueChanged = JSON.stringify(b.value) !== JSON.stringify(a.value);
    const unitChanged = b.unitKey !== a.unitKey;
    const bUnitMissing = b.unitKey == null;
    const aUnitMissing = a.unitKey == null;
    if (bUnitMissing || aUnitMissing) {
      unknown.push({
        fieldKey: key,
        reason: "unit-unknown",
        before: { value: b.value, unit: b.unit },
        after: { value: a.value, unit: a.unit },
        note: "Missing or blank unit is outside definitive price comparability; values are not compared.",
      });
      uncertainties.push(
        uncertainty("missing-unit", `field ${key} missing/blank unit; price comparison withheld`, {
          fieldKey: key,
          beforeUnit: b.unit,
          afterUnit: a.unit,
        }),
      );
      continue;
    }
    if (!valueChanged && !unitChanged) {
      unchanged.push({ fieldKey: key });
      continue;
    }
    if (bMissing || aMissing) {
      conflicting.push({
        fieldKey: key,
        reason: "missing-cell",
        before: { value: b.value, unit: b.unit },
        after: { value: a.value, unit: a.unit },
        note: "One or both values are missing; refusing price comparison for this field.",
      });
      uncertainties.push(
        uncertainty("missing-cell", `field ${key} has missing value(s); comparison withheld`, {
          fieldKey: key,
          beforeMissing: bMissing,
          afterMissing: aMissing,
        }),
      );
      continue;
    }
    if (unitChanged) {
      conflicting.push({
        fieldKey: key,
        reason: "cross-unit-incomparable",
        before: { value: b.value, unit: b.unit },
        after: { value: a.value, unit: a.unit },
        note: "Units differ; numeric values are not compared and are not asserted equal or changed.",
      });
      uncertainties.push(
        uncertainty("cross-unit", `field ${key} units differ; no conversion table supplied`, {
          fieldKey: key,
          beforeUnit: b.unit,
          afterUnit: a.unit,
        }),
      );
      unitChanges.push({
        fieldKey: key,
        beforeUnit: b.unit,
        afterUnit: a.unit,
        numericComparison: "not-applicable-across-units",
        beforeValueRaw: b.value,
        afterValueRaw: a.value,
      });
      continue;
    }
    if (valueChanged) {
      fieldChanges.push({
        fieldKey: key,
        beforeValue: b.value,
        afterValue: a.value,
        unit: a.unit ?? b.unit,
      });
    }
  }

  const hasDelta =
    added.length
      + removed.length
      + fieldChanges.length
      + unitChanges.length
      + conflicting.length
      + unknown.length
    > 0;

  return {
    module: "pricing-table-change",
    ok: true,
    counts: {
      beforeRows: before.rows.length,
      afterRows: after.rows.length,
      added: added.length,
      removed: removed.length,
      fieldChanges: fieldChanges.length,
      unitChanges: unitChanges.length,
      conflicting: conflicting.length,
      unchanged: unchanged.length,
      unknown: unknown.length,
    },
    added: stableSort(added, (x) => x.fieldKey),
    removed: stableSort(removed, (x) => x.fieldKey),
    fieldChanges: stableSort(fieldChanges, (x) => x.fieldKey),
    unitChanges: stableSort(unitChanges, (x) => x.fieldKey),
    conflicting: stableSort(conflicting, (x) => x.fieldKey),
    unchanged: stableSort(unchanged, (x) => x.fieldKey),
    unknown: stableSort(unknown, (x) => x.fieldKey),
    uncertainties,
    freeBaseline: FREE_BASELINE,
    differenceInDeliveredOutput: hasDelta
      ? "Emits field/unit deltas over supplied extracted rows. Does not scrape live pages, convert currencies, or assert SKU truth."
      : "No field/unit deltas (or only empty/unknown inputs). Still not a marketplace price proof.",
  };
}
