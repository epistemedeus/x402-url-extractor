/**
 * Classify an already-held CDP x402 /validate JSON: valid is not indexed.
 * Does not call CDP unless the caller already did so unpaid and passed the
 * result in. Never pays.
 *
 * Related: coinbase/cdp-sdk#806 (opened 2026-09-05, still open) and the
 * HyperXosist seller residual after KG-NINJA/HyperXosist-Agent#32.
 */

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function classifyValidateVsIndex(input = {}) {
  const evidenceClass = input.evidenceClass;
  if (evidenceClass !== "independently_observed" && evidenceClass !== "provided_report") {
    throw new Error("evidenceClass must be independently_observed or provided_report");
  }
  const resource = String(input.resource || "").trim();
  if (!/^https:\/\//.test(resource)) throw new Error("resource must be an https URL");
  const report = isPlainObject(input.cdpValidate) ? input.cdpValidate : {};
  const valid = report.valid === true;
  const indexed = report.index !== undefined && report.index !== null;
  const bazaarPresent = report.bazaarPresent === true
    || report.bazaarExtension !== undefined && report.bazaarExtension !== null;
  const failed = Array.isArray(report.preflightFailed) ? report.preflightFailed : [];
  let decision;
  if (!valid) decision = "not_valid";
  else if (!indexed) decision = "validates_but_not_indexed";
  else decision = "indexed";

  return Object.freeze({
    schemaVersion: "s117.validate-vs-index.v1",
    evidenceClass,
    observedAt: input.observedAt || null,
    resource,
    method: input.method || null,
    valid,
    indexed,
    bazaarPresent,
    simulationOutcome: report.simulationOutcome || report.simulation?.outcome || null,
    preflightFailed: Object.freeze([...failed]),
    decision,
    notes: Object.freeze({
      valid_is_not_indexed: true,
      local_recipe_is_not_cdp_index_repair: true,
    }),
  });
}
