import {
  DRY_RUN_NOTE,
  ERROR_CODES,
  MUTATION_BOUNDARY,
  REPORT_STATUS,
  REUSE_FROM,
  SCHEMA,
  SCOPE_NOTE,
  SEPARATE_FROM,
  UNKNOWN_LICENSE,
} from "./constants.mjs";
import { reportError, validateDependencyFootprintInput } from "./validate.mjs";

/**
 * Collect runtime (non-dev) occurrences of each package name across trees.
 * Also track all occurrences for license inventory.
 */
function indexFootprint(trees) {
  /** @type {Map<string, Array<{treeId,treeLabel,version,license,licenseUnknown,dev,incomplete,path}>>} */
  const byName = new Map();

  for (const tree of trees) {
    for (const dep of tree.dependencies) {
      const key = dep.name || `__incomplete_${tree.id}_${dep.path || "anon"}`;
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push({
        treeId: tree.id,
        treeLabel: tree.label,
        name: dep.name,
        version: dep.version,
        license: dep.license,
        licenseUnknown: dep.licenseUnknown,
        licenseDeclared: dep.licenseDeclared,
        dev: dep.dev,
        incomplete: dep.incomplete,
        path: dep.path,
      });
    }
  }
  return byName;
}

/**
 * Duplicate runtime dependency:
 * - same package name with multiple distinct versions among runtime (non-dev) entries, OR
 * - same package name appearing as runtime in multiple supplied trees.
 * Dev-only packages are excluded from duplicate-runtime surfacing but still
 * appear in license inventory when present.
 */
export function findDuplicateRuntimeDependencies(byName) {
  const duplicates = [];

  for (const [name, occurrences] of [...byName.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    if (!name || name.startsWith("__incomplete_")) continue;

    const runtime = occurrences.filter((o) => !o.dev && o.name && !o.incomplete);
    if (runtime.length < 1) continue;

    const versions = [...new Set(runtime.map((o) => o.version).filter(Boolean))].sort();
    const treeIds = [...new Set(runtime.map((o) => o.treeId))].sort();

    const multiVersion = versions.length > 1;
    const multiTree = treeIds.length > 1;

    if (!multiVersion && !multiTree) continue;

    const reasons = [];
    if (multiVersion) reasons.push("multiple_versions");
    if (multiTree) reasons.push("multiple_trees");

    duplicates.push({
      name,
      versions,
      treeIds,
      reasons,
      occurrences: runtime.map((o) => ({
        treeId: o.treeId,
        treeLabel: o.treeLabel,
        version: o.version,
        license: o.license,
        path: o.path,
      })),
    });
  }

  return duplicates;
}

/**
 * Declared licenses from supplied data only.
 * Missing license → unknown (never invent SPDX).
 */
export function collectDeclaredLicenses(byName) {
  const licenses = [];

  for (const [name, occurrences] of [...byName.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    if (!name || name.startsWith("__incomplete_")) {
      // Still surface incomplete entries with unknown name under a placeholder.
      for (const o of occurrences) {
        if (o.incomplete) {
          licenses.push({
            name: o.name,
            version: o.version,
            treeId: o.treeId,
            license: o.license || UNKNOWN_LICENSE,
            licenseUnknown: true,
            licenseDeclared: false,
            incomplete: true,
            path: o.path,
          });
        }
      }
      continue;
    }

    for (const o of occurrences) {
      licenses.push({
        name: o.name,
        version: o.version,
        treeId: o.treeId,
        license: o.license || UNKNOWN_LICENSE,
        licenseUnknown: o.licenseUnknown !== false && !o.licenseDeclared,
        licenseDeclared: o.licenseDeclared === true,
        incomplete: o.incomplete === true,
        path: o.path,
        dev: o.dev === true,
      });
    }
  }

  return licenses;
}

function buildSummary({ trees, duplicates, licenses }) {
  const runtimeCount = trees.reduce(
    (n, t) => n + t.dependencies.filter((d) => !d.dev && !d.incomplete).length,
    0,
  );
  const unknownLicenseCount = licenses.filter((l) => l.licenseUnknown).length;
  return {
    treeCount: trees.length,
    dependencyEntryCount: trees.reduce((n, t) => n + t.dependencies.length, 0),
    runtimeEntryCount: runtimeCount,
    duplicateRuntimeCount: duplicates.length,
    licenseEntryCount: licenses.length,
    unknownLicenseCount,
    note: "Factual footprint overlap only. No CVE score, security certification, legal advice, compliance score, invest advice, SEO rank, or traffic projection.",
  };
}

/**
 * Build dependency footprint overlap report from caller-supplied lock inventories.
 */
export function buildDependencyFootprintOverlap(rawInput, { clock = () => Date.now() } = {}) {
  let input;
  try {
    input = validateDependencyFootprintInput(rawInput);
  } catch (err) {
    if (err && err.code) {
      return {
        schema: SCHEMA,
        generatedAt: new Date(clock()).toISOString(),
        status: REPORT_STATUS.REJECTED,
        error: {
          code: err.code,
          message: err.message,
          details: err.details ?? null,
        },
        separateFrom: SEPARATE_FROM,
        scopeNote: SCOPE_NOTE,
        reuseFrom: REUSE_FROM,
        mutationBoundary: MUTATION_BOUNDARY,
        dryRun: DRY_RUN_NOTE,
      };
    }
    throw err;
  }

  const byName = indexFootprint(input.trees);
  const duplicateRuntimeDependencies = findDuplicateRuntimeDependencies(byName);
  const declaredLicenses = collectDeclaredLicenses(byName);
  const summary = buildSummary({
    trees: input.trees,
    duplicates: duplicateRuntimeDependencies,
    licenses: declaredLicenses,
  });

  const incompleteCount = input.trees.reduce(
    (n, t) => n + t.dependencies.filter((d) => d.incomplete).length,
    0,
  );
  const unknownLicenseCount = declaredLicenses.filter((l) => l.licenseUnknown).length;

  const partialReasons = [];
  let status = REPORT_STATUS.READY;
  if (incompleteCount > 0) {
    status = REPORT_STATUS.PARTIAL_INPUT;
    partialReasons.push("incomplete_dependency_entries");
  }
  // Unknown licenses alone do not force partial — they are retained honestly.
  // But if EVERY entry lacks version/name completeness we already flagged.
  // Flag partial when some licenses missing AND incomplete entries exist was enough.
  // Also partial when trees provided but all runtime entries incomplete.
  const completeRuntime = input.trees.reduce(
    (n, t) => n + t.dependencies.filter((d) => !d.dev && !d.incomplete).length,
    0,
  );
  if (completeRuntime === 0 && incompleteCount > 0) {
    status = REPORT_STATUS.PARTIAL_INPUT;
    if (!partialReasons.includes("incomplete_dependency_entries")) {
      partialReasons.push("incomplete_dependency_entries");
    }
    partialReasons.push("no_complete_runtime_entries");
  }

  // Soft partial hint for unknown licenses is recorded but does not alone reject ready.
  // Contract: retain unknown; partial for incomplete lock entries.
  void unknownLicenseCount;

  const report = {
    schema: SCHEMA,
    generatedAt: new Date(clock()).toISOString(),
    status,
    reportId: input.reportId,
    title: input.title,
    demo: input.demo === true,
    sourceLabel: input.sourceLabel,
    trees: input.trees.map((t) => ({
      id: t.id,
      label: t.label,
      lockfileFormat: t.lockfileFormat,
      dependencyCount: t.dependencies.length,
      runtimeCount: t.dependencies.filter((d) => !d.dev && !d.incomplete).length,
      incompleteCount: t.dependencies.filter((d) => d.incomplete).length,
    })),
    duplicateRuntimeDependencies,
    declaredLicenses,
    summary,
    partialReasons: status === REPORT_STATUS.PARTIAL_INPUT ? [...new Set(partialReasons)] : [],
    separateFrom: SEPARATE_FROM,
    scopeNote: SCOPE_NOTE,
    reuseFrom: REUSE_FROM,
    mutationBoundary: MUTATION_BOUNDARY,
    dryRun: DRY_RUN_NOTE,
    consumerInstructions:
      "Supply one or more lockfile / dependency inventory snapshots (trees[] with dependencies[{name,version,license?,dev?}] or packages{}). " +
      "Run `node src/cli.mjs report <input.json>` (overlap is an alias). " +
      "Duplicates = same runtime package name with multiple versions or across multiple trees. " +
      "Licenses are copied as declared; missing → unknown (no invented SPDX). " +
      "Not security certification, legal advice, or S127 API impact analysis.",
  };

  for (const field of [
    "cveScore",
    "securityCertification",
    "legalAdvice",
    "complianceScore",
    "investAdvice",
    "seoRank",
    "trafficProjection",
    "s127ApiImpact",
  ]) {
    if (Object.prototype.hasOwnProperty.call(report, field)) {
      throw reportError(ERROR_CODES.FORBIDDEN_CLAIM, `${field} must not appear on report`);
    }
  }

  return report;
}
