/**
 * Product-level kill: B never changes action vs A on required cases A and B.
 *
 * unknown if any required case is missing or unreadable.
 * kill if every required case is present and none changed.
 * keep if at least one required case changed.
 */
import { dirname, isAbsolute, resolve } from "node:path";
import { KILL_CONDITION, STUB_LIMITATIONS, SUITE_RESULT_SCHEMA } from "./constants.mjs";
import { compareExtracts } from "./compare.mjs";
import { extractFromFileResult, isPlainObject, readString } from "./extract.mjs";
import { tryReadJsonFile } from "./io.mjs";
import { CELL_ROOT } from "./paths.mjs";

export function resolveSuitePath(baseDir, maybePath) {
  if (typeof maybePath !== "string" || !maybePath.trim()) return null;
  if (isAbsolute(maybePath)) return resolve(maybePath);
  const fromManifest = resolve(baseDir, maybePath);
  return fromManifest;
}

export function runSuite(manifest, { manifestPath = null, mode = "coarse" } = {}) {
  if (!isPlainObject(manifest)) {
    return makeSuiteResult({
      verdict: "unknown",
      rationale: "suite manifest is not a plain object",
      unknownReasons: ["invalid_manifest"],
      cases: [],
      manifestPath,
      mode,
      clock: null,
      label: "synthetic",
      requiredIds: [],
    });
  }

  const baseDir = manifestPath ? dirname(resolve(manifestPath)) : CELL_ROOT;
  const clock = readString(manifest.clock) || null;
  const label = readString(manifest.label) || readString(manifest.evidenceClass) || "synthetic";
  const casesIn = Array.isArray(manifest.cases) ? manifest.cases : [];
  const requiredIds = normalizeRequired(manifest, casesIn);
  const pairResults = [];
  const unknownReasons = [];

  for (const row of casesIn) {
    if (!isPlainObject(row)) {
      unknownReasons.push("case_not_object");
      continue;
    }
    const caseId = readString(row.id) || `case-${pairResults.length + 1}`;
    const aPath = resolveSuitePath(baseDir, row.methodA || row.a || row.registrySkim);
    const bPath = resolveSuitePath(baseDir, row.methodB || row.b || row.bindingPacket);
    const aLoaded = aPath ? tryReadJsonFile(aPath) : { ok: false, path: null, code: "missing_path", message: "method A path missing" };
    const bLoaded = bPath ? tryReadJsonFile(bPath) : { ok: false, path: null, code: "missing_path", message: "method B path missing" };
    const aExtract = extractFromFileResult(aLoaded, {
      path: aPath,
      method: row.aMethod || "registry_version_changelog_skim",
    });
    const bExtract = extractFromFileResult(bLoaded, {
      path: bPath,
      method: row.bMethod || "usage_binding_packet",
    });
    const pair = compareExtracts(aExtract, bExtract, {
      mode,
      clock: readString(row.clock) || clock,
      caseId,
      role: readString(row.role) || null,
      label: readString(row.label) || label,
      scope: "pair",
    });
    pairResults.push(pair);
  }

  return foldSuite({
    pairResults,
    requiredIds,
    manifestPath,
    mode,
    clock,
    label,
    extraUnknown: unknownReasons,
    expect: isPlainObject(manifest.expect) ? manifest.expect : null,
    id: readString(manifest.id) || null,
  });
}

function normalizeRequired(manifest, casesIn) {
  if (Array.isArray(manifest.required) && manifest.required.length > 0) {
    return manifest.required.map((id) => String(id));
  }
  if (manifest.required === true) {
    return casesIn.filter(isPlainObject).map((row) => readString(row.id)).filter(Boolean);
  }
  const flagged = casesIn
    .filter((row) => isPlainObject(row) && row.required !== false)
    .map((row) => readString(row.id))
    .filter(Boolean);
  return flagged;
}

export function foldSuite({
  pairResults,
  requiredIds,
  manifestPath,
  mode,
  clock,
  label,
  extraUnknown = [],
  expect = null,
  id = null,
}) {
  const required = requiredIds.length > 0 ? requiredIds : pairResults.map((row) => row.caseId).filter(Boolean);
  const byId = new Map(pairResults.map((row) => [row.caseId, row]));
  const unknownReasons = [...extraUnknown];
  const requiredPairs = [];

  for (const caseId of required) {
    const pair = byId.get(caseId);
    if (!pair) {
      unknownReasons.push(`missing_required_case:${caseId}`);
      continue;
    }
    requiredPairs.push(pair);
    if (pair.verdict === "unknown") {
      unknownReasons.push(`unreadable_required_case:${caseId}`);
    }
  }

  const changedIds = requiredPairs.filter((row) => row.changed).map((row) => row.caseId);
  const presentReadable = requiredPairs.filter((row) => row.verdict !== "unknown");
  const allRequiredPresent = required.every((caseId) => byId.has(caseId));
  const allRequiredReadable = allRequiredPresent && unknownReasons.filter((r) => r.startsWith("unreadable_required_case:") || r.startsWith("missing_required_case:")).length === 0;

  let verdict;
  let rationale;
  if (!allRequiredReadable) {
    verdict = "unknown";
    rationale =
      `required cases ${required.join(", ") || "(none)"} are incomplete (${unknownReasons.join("; ") || "unspecified"}). ` +
      `Do not record a product kill and do not package as a paid job. Missing source stays unknown.`;
  } else if (changedIds.length === 0) {
    verdict = "kill";
    rationale =
      `B never changed the ${mode} decision vs A on required cases ${required.join(", ")}. ` +
      `Negative evidence: usage-binding added no different operator move than registry+changelog skim. Stop packaging as a paid job.`;
  } else {
    verdict = "keep";
    rationale =
      `B changed the ${mode} decision vs A on ${changedIds.join(", ")} ` +
      `(${changedIds.length}/${required.length} required cases). Keep: mapping added a different operator move than registry+changelog skim.`;
  }

  return makeSuiteResult({
    id,
    verdict,
    rationale,
    unknownReasons,
    cases: pairResults,
    requiredIds: required,
    changedIds,
    manifestPath,
    mode,
    clock,
    label,
    expect,
    allRequiredReadable,
  });
}

function makeSuiteResult({
  id,
  verdict,
  rationale,
  unknownReasons,
  cases,
  requiredIds,
  changedIds = [],
  manifestPath,
  mode,
  clock,
  label,
  expect,
  allRequiredReadable = false,
}) {
  const expectVerdict = expect?.verdict ? readString(expect.verdict) : null;
  return {
    schema: SUITE_RESULT_SCHEMA,
    id: id || null,
    scope: "suite",
    clock,
    label,
    mode,
    verdict,
    changed: changedIds.length > 0,
    changedIds,
    requiredIds,
    allRequiredReadable,
    rationale,
    killCondition: KILL_CONDITION,
    payment: { attempted: false },
    cost: {
      assignmentSpendUsd: 0,
      note: "offline suite; no purchase; do not invent paid demand",
    },
    expect: expectVerdict ? { verdict: expectVerdict, matched: expectVerdict === verdict } : null,
    cases,
    unknownReasons,
    limitations: [
      ...STUB_LIMITATIONS,
      "Product kill requires every required case to be present and readable.",
      "Synthetic stand-ins are not real-source cases A/B (c11/c12).",
    ],
    manifestPath,
  };
}
