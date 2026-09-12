import { createHash } from "node:crypto";
import { validateBuyerOutput } from "./output.mjs";

const categories = ["fieldChanges", "unitChanges", "added", "removed", "conflicting", "unknown"];
const fieldKey = row => row.field.trim().toLowerCase().replace(/\s+/g, "_");
const require = (condition, message) => { if (!condition) throw new Error(message); };
const project = (value, keys) => Object.fromEntries(keys.map(key => [key, value?.[key]]));
const shapes = {
  fieldChanges: ["fieldKey", "beforeValue", "afterValue", "unit"],
  unitChanges: ["fieldKey", "beforeUnit", "afterUnit", "numericComparison", "beforeValueRaw", "afterValueRaw"],
  conflicting: ["fieldKey", "reason", "beforeCount", "afterCount", "before", "after"],
  unknown: ["fieldKey", "reason"],
};
const publicRow = row => ({ field: row.field.trim(), fieldKey: fieldKey(row), value: row.value,
  unit: row.unit.trim(), unitKey: row.unit.trim() });
const compact = (category, row) => category === "added" || category === "removed"
  ? { fieldKey: row?.fieldKey, [category === "added" ? "after" : "before"]:
      project(row?.[category === "added" ? "after" : "before"], ["field", "fieldKey", "value", "unit", "unitKey"]) }
  : project(row, shapes[category]);

// Independent narrow verifier for the purchased rows, not a merchant import.
// Presence-only checks cannot establish product identity or the requested delta.
export function validateVendorBudgetBuyerOutput(body, authorization) {
  const generic = validateBuyerOutput(body, authorization.requiredOutput);
  if (!generic.valid || generic.delivery !== "useful") return generic;
  try {
    require(body.product === "samedaydesk-vendor-budget-impact", "vendor-budget product mismatch");
    require(body.schemaVersion === "samedaydesk.vendor-budget-impact-http.v0", "vendor-budget schema mismatch");
    require(body.charged === true && body.transport === "ok", "vendor-budget response is not completed");
    require(/^[1-9][0-9]*$/.test(body.quote?.amountAtomic || ""), "invalid quote amount");
    require(BigInt(body.quote.amountAtomic) <= BigInt(authorization.amountCapAtomic), "quote exceeds authorized cap");
    const engine = body.engine;
    require(engine?.ok === true && engine.appId === "vendor-budget-impact"
      && engine.schema === "samedaydesk.vendor-budget-impact.v1", "invalid vendor-budget engine");
    require(engine.purchaseAuthority === false && engine.paidValueClaim === false
      && body.boundary?.purchaseAuthority === false && body.boundary?.soldFlag === false, "invalid purchase boundary");
    require(body.digest === createHash("sha256").update(JSON.stringify(engine) + "\n").digest("hex"), "engine digest mismatch");
    const input = JSON.parse(authorization.bodyRaw);
    const group = rows => {
      const map = new Map();
      for (const row of rows) {
        const key = fieldKey(row);
        map.set(key, [...(map.get(key) || []), row]);
      }
      return map;
    };
    const before = group(input.before.rows), after = group(input.after.rows);
    const expected = Object.fromEntries(categories.map(key => [key, []]));
    let unchanged = 0;
    for (const key of [...new Set([...before.keys(), ...after.keys()])].sort()) {
      const bs = before.get(key) || [], as = after.get(key) || [];
      const b = bs[0], a = as[0];
      if (bs.length === 0 && as.length === 1) {
        expected.added.push({ fieldKey: key, after: publicRow(a) });
      } else if (bs.length === 1 && as.length === 0) {
        expected.removed.push({ fieldKey: key, before: publicRow(b) });
      } else if (bs.length > 1 || as.length > 1) {
        expected.conflicting.push({ fieldKey: key, reason: "duplicate-rows-prevent-unique-compare",
          beforeCount: bs.length, afterCount: as.length });
      } else if (b.unit.trim() !== a.unit.trim()) {
        expected.conflicting.push({ fieldKey: key, reason: "cross-unit-incomparable",
          before: { value: b.value, unit: b.unit.trim() }, after: { value: a.value, unit: a.unit.trim() } });
        expected.unitChanges.push({ fieldKey: key, beforeUnit: b.unit.trim(), afterUnit: a.unit.trim(),
          numericComparison: "not-applicable-across-units", beforeValueRaw: b.value, afterValueRaw: a.value });
      } else if (b.value !== a.value) {
        expected.fieldChanges.push({ fieldKey: key, beforeValue: b.value, afterValue: a.value, unit: a.unit.trim() });
      } else unchanged += 1;
    }
    for (const key of categories) {
      require(Array.isArray(engine[key]), "missing engine evidence: " + key);
      require(engine.counts?.[key] === expected[key].length, "incorrect engine count: " + key);
      require(JSON.stringify(engine[key].map(row => compact(key, row))) ===
        JSON.stringify(expected[key].map(row => compact(key, row))), "evidence does not match authorized rows: " + key);
    }
    require(engine.counts.beforeRows === input.before.rows.length &&
      engine.counts.afterRows === input.after.rows.length && engine.counts.unchanged === unchanged, "row count mismatch");
    const partial = expected.conflicting.length > 0 || expected.unknown.length > 0
      || expected.fieldChanges.some(row => !Number.isFinite(row.afterValue - row.beforeValue));
    const status = partial ? "partial" : ["fieldChanges", "unitChanges", "added", "removed"]
      .some(key => expected[key].length) ? "actionable" : "informational";
    require(engine.status === status && body.analysis === status, "analysis does not match authorized rows");
    return { valid: true, delivery: partial ? "partial" : "useful", report: generic.report };
  } catch (error) {
    return { valid: false, delivery: "invalid", reason: error.message, report: generic.report };
  }
}
