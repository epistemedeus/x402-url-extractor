/**
 * Diff two lexer-bounded .d.ts surfaces and bind to caller type usage.
 *
 * Packet-contract rules:
 * 1. Newer version alone ≠ break.
 * 2. Unused export change ≠ caller defect.
 * 3. Conflicting/missing/partial source ⇒ unknown, not action.
 * 4. Dynamic import of package ⇒ unknown for that surface.
 * 5. Same-version/no-op ⇒ no_action.
 *
 * Does not claim signatureChanged (no checker, no arity for types).
 * Unused export= / export as namespace changes are no_action.
 * Global `export as namespace` consumption without an import is unknown.
 */

import { uniqueStrings } from "./lib/hash.mjs";

export const DIFF_SCHEMA = "s127.c18.dts-diff.v1";
export const BIND_SCHEMA = "s127.c18.dts-bind.v1";

const ACTION_KINDS = new Set(["removed"]);

export function diffDtsSurfaces(oldSurface, newSurface) {
  const oldNames = nameMap(oldSurface);
  const newNames = nameMap(newSurface);
  const added = [];
  const removed = [];
  const unchanged = [];

  for (const name of oldNames.keys()) {
    if (!newNames.has(name)) removed.push(name);
    else unchanged.push(name);
  }
  for (const name of newNames.keys()) {
    if (!oldNames.has(name)) added.push(name);
  }

  added.sort();
  removed.sort();
  unchanged.sort();

  const oldCov = coverageOf(oldSurface);
  const newCov = coverageOf(newSurface);
  const coverage = mergeCoverage(oldCov, newCov);

  const limitations = uniqueStrings([
    ...(oldSurface?.limitations || []),
    ...(newSurface?.limitations || []),
    "signatureChanged is not claimed; no TypeScript checker and no type-structure compare",
    "rename detection is not claimed; ambiguous add+remove pairs stay added/removed",
  ]);

  return {
    schema: DIFF_SCHEMA,
    added,
    removed,
    renamed: [],
    signatureChanged: [],
    unchanged,
    coverage,
    oldCoverage: oldCov,
    newCoverage: newCov,
    limitations,
    claimsFullChecker: false,
  };
}

export function bindDtsUsage({
  usage,
  exportDiff,
  oldSurface,
  newSurface,
  dependency,
} = {}) {
  const diff = exportDiff || diffDtsSurfaces(oldSurface, newSurface);
  const usageNorm = normalizeUsage(usage);
  const unknownReasons = [];
  const limitations = uniqueStrings([
    ...(diff.limitations || []),
    ...(usageNorm.limitations || []),
    "c18 binds the .d.ts surface only; runtime JS exports are a different cell",
    "type-only usage can justify action for TypeScript callers; it is not a runtime crash claim",
  ]);

  let sourceBlocksAction = false;

  if (usageNorm.coverage === "missing" || usageNorm.missing) {
    sourceBlocksAction = true;
    unknownReasons.push("usage evidence missing");
  } else if (usageNorm.coverage === "partial") {
    sourceBlocksAction = true;
    unknownReasons.push("usage coverage is partial");
  } else if (usageNorm.coverage !== "full" && usageNorm.coverage !== "complete") {
    sourceBlocksAction = true;
    unknownReasons.push("usage coverage is unknown");
  }

  if (diff.coverage === "missing") {
    sourceBlocksAction = true;
    unknownReasons.push("exportDiff evidence missing");
  } else if (diff.coverage === "partial") {
    sourceBlocksAction = true;
    unknownReasons.push("type surface coverage is partial");
  } else if (diff.coverage !== "full" && diff.coverage !== "complete") {
    sourceBlocksAction = true;
    unknownReasons.push("type surface coverage is unknown");
  }

  const sameVersion = isSameVersion(dependency);
  if (sameVersion && (diff.added.length || diff.removed.length)) {
    sourceBlocksAction = true;
    unknownReasons.push("same declared version but type surface reports changes");
  }

  const packageDynamic = Boolean(usageNorm.dynamicImport);
  if (packageDynamic) {
    unknownReasons.push("dynamic import of package; non-static usage is unknown");
  }

  const namespaceImport = usageNorm.namespaceImport;
  const usedExportEquals = Boolean(usageNorm.bySymbol.get("export=")?.used);

  const symbols = new Set();
  for (const name of diff.added) symbols.add(name);
  for (const name of diff.removed) symbols.add(name);
  for (const name of diff.unchanged) {
    if (usageNorm.bySymbol.has(name) || namespaceImport) symbols.add(name);
  }
  for (const name of usageNorm.bySymbol.keys()) {
    if (name !== "*" && name !== "export=" || usageNorm.bySymbol.get(name)?.used) {
      if (name !== "*") symbols.add(name);
    }
  }

  const bindings = [];
  for (const symbol of [...symbols].sort()) {
    const row = decideSymbol({
      symbol,
      used:
        Boolean(usageNorm.bySymbol.get(symbol)?.used) ||
        (namespaceImport && symbol !== "export=" && symbol !== "namespace") ||
        (usedExportEquals && symbol === "export="),
      changeKind: changeKindOf(symbol, diff),
      sourceBlocksAction,
      packageDynamic,
      sameVersion,
      namespaceImport,
    });
    if (row) bindings.push(row);
  }

  const actionableChanges = [];
  const unusedChanges = [];
  let hasUsedRemoved = false;

  for (const row of bindings) {
    if (row.decision === "action") {
      actionableChanges.push({ symbol: row.symbol, changeKind: row.changeKind, rationale: row.rationale });
      if (row.changeKind === "removed") hasUsedRemoved = true;
    } else if (row.decision === "no_action" && row.used === false && row.changeKind !== "unchanged") {
      unusedChanges.push({ symbol: row.symbol, changeKind: row.changeKind, rationale: row.rationale });
    }
  }

  const extraUnknown = bindings.filter((b) => b.decision === "unknown").map((b) => b.rationale);
  const mergedUnknown = uniqueStrings([...unknownReasons, ...extraUnknown]);

  let nextAction = "no_action";
  if (sameVersion && !diff.added.length && !diff.removed.length && !packageDynamic) {
    nextAction = "no_action";
  } else if (hasUsedRemoved && !sourceBlocksAction && !packageDynamic) {
    nextAction = "action";
  } else if (sourceBlocksAction || packageDynamic || mergedUnknown.length) {
    nextAction = hasUsedRemoved && !sourceBlocksAction && !packageDynamic ? "action" : "unknown";
    if (packageDynamic) nextAction = "unknown";
    if (sourceBlocksAction) nextAction = "unknown";
  }

  if (sameVersion && !sourceBlocksAction) nextAction = "no_action";

  bindings.sort(compareBindings);

  return {
    schema: BIND_SCHEMA,
    exportDiff: {
      added: diff.added,
      removed: diff.removed,
      renamed: diff.renamed,
      signatureChanged: diff.signatureChanged,
      coverage: diff.coverage,
    },
    bindings,
    summary: {
      nextAction,
      bindNextAction: nextAction === "action" ? "review_breakages" : nextAction,
      unknownReasons: nextAction === "no_action" ? uniqueStrings(unknownReasons) : mergedUnknown,
      unusedChanges,
      actionableChanges,
    },
    limitations,
    claimsFullChecker: false,
  };
}

function decideSymbol({
  symbol,
  used,
  changeKind,
  sourceBlocksAction,
  packageDynamic,
  sameVersion,
}) {
  if (!changeKind) return null;

  if (sameVersion) {
    return makeBinding({
      symbol,
      used,
      changeKind,
      decision: "no_action",
      rationale: `same version; no-op for '${symbol}'`,
      ruleId: "same_version_noop",
    });
  }

  if (sourceBlocksAction) {
    return makeBinding({
      symbol,
      used,
      changeKind: changeKind === "unchanged" ? "unknown" : changeKind,
      decision: "unknown",
      rationale: `missing, partial, or conflicting source; cannot claim action for '${symbol}'`,
      ruleId: "missing_or_partial_source",
    });
  }

  if (packageDynamic && !used) {
    return makeBinding({
      symbol,
      used: false,
      changeKind,
      decision: "unknown",
      rationale: `package is also loaded dynamically; unused claim for '${symbol}' is unknown`,
      ruleId: "dynamic_import",
    });
  }

  if (packageDynamic && used && ACTION_KINDS.has(changeKind)) {
    return makeBinding({
      symbol,
      used: true,
      changeKind,
      decision: "unknown",
      rationale: `dynamic import of package; usage of '${symbol}' is unknown`,
      ruleId: "dynamic_import",
    });
  }

  if (changeKind === "unchanged") {
    if (!used) return null;
    return makeBinding({
      symbol,
      used: true,
      changeKind: "unchanged",
      decision: "no_action",
      rationale: `used export '${symbol}' is unchanged`,
      ruleId: "used_unchanged",
    });
  }

  if (changeKind === "added") {
    return makeBinding({
      symbol,
      used,
      changeKind: "added",
      decision: "no_action",
      rationale: used
        ? `used export '${symbol}' is newly added; newer version alone is not a caller defect`
        : `added export '${symbol}' is unused; newer version alone is not a break`,
      ruleId: "newer_version_not_break",
    });
  }

  if (!used) {
    return makeBinding({
      symbol,
      used: false,
      changeKind,
      decision: "no_action",
      rationale: `export '${symbol}' ${changeKind} but is not statically used; unused change is not a caller defect`,
      ruleId: "unused_change_not_caller_defect",
    });
  }

  if (changeKind === "removed") {
    return makeBinding({
      symbol,
      used: true,
      changeKind: "removed",
      decision: "action",
      rationale: `used type export '${symbol}' was removed`,
      ruleId: "used_removed",
    });
  }

  return makeBinding({
    symbol,
    used,
    changeKind,
    decision: "unknown",
    rationale: `unclassified change for used export '${symbol}'`,
    ruleId: "unclassified_change",
  });
}

function changeKindOf(symbol, diff) {
  if (diff.removed.includes(symbol)) return "removed";
  if (diff.added.includes(symbol)) return "added";
  if (diff.unchanged.includes(symbol)) return "unchanged";
  return "unchanged";
}

function nameMap(surface) {
  const map = new Map();
  const rows = surface?.exports || surface?.names || [];
  if (Array.isArray(surface?.added) && surface.schema === DIFF_SCHEMA) return map;
  if (Array.isArray(rows)) {
    for (const row of rows) {
      const name = typeof row === "string" ? row : row?.name;
      if (!name) continue;
      map.set(name, row);
    }
  }
  return map;
}

function coverageOf(surface) {
  if (!surface) return "missing";
  const c = surface.coverage;
  if (c === "full" || c === "complete") return "full";
  if (c === "partial") return "partial";
  if (c === "missing") return "missing";
  return c || "unknown";
}

function mergeCoverage(a, b) {
  const rank = { missing: 0, unknown: 1, partial: 2, full: 3, complete: 3 };
  const ra = rank[a] ?? 1;
  const rb = rank[b] ?? 1;
  const m = Math.min(ra, rb);
  if (m === 0) return "unknown";
  if (m === 1) return "unknown";
  if (m === 2) return "partial";
  return "full";
}

function isSameVersion(dependency) {
  if (!dependency || typeof dependency !== "object") return false;
  const oldV = String(dependency.oldVersion || "").trim();
  const newV = String(dependency.newVersion || "").trim();
  return Boolean(oldV) && oldV === newV;
}

function normalizeUsage(usage) {
  if (!usage) {
    return {
      coverage: "missing",
      missing: true,
      dynamicImport: false,
      namespaceImport: false,
      bySymbol: new Map(),
      limitations: [],
    };
  }
  const bySymbol = new Map();
  const refs = [];
  if (Array.isArray(usage.references)) refs.push(...usage.references);
  if (Array.isArray(usage.imports)) refs.push(...usage.imports);
  if (usage.bySymbol && typeof usage.bySymbol === "object" && !Array.isArray(usage.bySymbol)) {
    for (const [symbol, row] of Object.entries(usage.bySymbol)) {
      bySymbol.set(symbol, {
        symbol,
        used: row?.used !== false,
        dynamicImport: Boolean(row?.dynamicImport),
        typeOnly: Boolean(row?.typeOnly),
      });
    }
  }
  let namespaceImport = Boolean(usage.namespaceImport);
  let dynamicImport = Boolean(usage.dynamicImport);
  for (const item of refs) {
    if (typeof item === "string") {
      bySymbol.set(item, { symbol: item, used: true, dynamicImport: false, typeOnly: true });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    if (item.kind === "namespace" || item.symbol === "*") {
      if (item.dynamicImport) dynamicImport = true;
      else namespaceImport = true;
      continue;
    }
    if (item.kind === "dynamic" || item.dynamicImport) dynamicImport = true;
    const symbol = item.symbol || item.name;
    if (!symbol || symbol === "*") continue;
    const prev = bySymbol.get(symbol);
    const next = {
      symbol,
      used: item.used !== false && !item.dynamicImport,
      dynamicImport: Boolean(item.dynamicImport),
      typeOnly: Boolean(item.typeOnly),
    };
    if (!prev) bySymbol.set(symbol, next);
    else {
      prev.used = prev.used || next.used;
      prev.dynamicImport = prev.dynamicImport || next.dynamicImport;
    }
  }
  return {
    coverage: usage.coverage || "unknown",
    missing: false,
    dynamicImport,
    namespaceImport,
    bySymbol,
    limitations: Array.isArray(usage.limitations) ? usage.limitations : [],
  };
}

function makeBinding({ symbol, used, changeKind, decision, rationale, ruleId }) {
  return { symbol, used: Boolean(used), changeKind, decision, rationale, ruleId };
}

function compareBindings(a, b) {
  const rank = { action: 0, unknown: 1, no_action: 2 };
  const d = (rank[a.decision] ?? 9) - (rank[b.decision] ?? 9);
  if (d !== 0) return d;
  return String(a.symbol).localeCompare(String(b.symbol));
}
