/**
 * Usage → exportDiff binding (S127 c06).
 *
 * Pure function. Does not fetch, parse TypeScript, or run package scripts.
 * Consumes c03 (`src/imports.mjs` / `s127.upgrade-impact.usage.v1`) and
 * c05 (`src/export-diff.mjs` / `s127.upgrade-impact.export-diff.v1`) output
 * objects. Does not import those parsers. Local stubs remain valid.
 *
 * PACKET-CONTRACT decision rules:
 * 1. Newer version alone ≠ break.
 * 2. Unused export change ≠ caller defect.
 * 3. Conflicting / missing / partial source ⇒ unknown, not action.
 * 4. Dynamic import of a package ⇒ unknown for that surface.
 * 5. Alias / workspace / lockfile disagreement ⇒ unknown.
 * 6. Same-version / no-op ⇒ no_action.
 *
 * nextAction priority (first match):
 *   review_breakages → upgrade_with_edits → unknown → no_action
 */

export const BIND_SCHEMA = "s127.upgrade-impact.bind.v1";
export const PACKET_SCHEMA = "s127.upgrade-impact.packet.v1";

export const NEXT_ACTIONS = Object.freeze([
  "upgrade_with_edits",
  "review_breakages",
  "no_action",
  "unknown",
]);

export const DECISIONS = Object.freeze(["action", "unknown", "no_action"]);

export const CHANGE_KINDS = Object.freeze([
  "added",
  "removed",
  "renamed",
  "signatureChanged",
  "unchanged",
  "unknown",
]);

export const ACTION_CHANGE_KINDS = Object.freeze(["removed", "signatureChanged", "renamed"]);

/** c03 usage list shape this binder accepts (usage.v1 or compact stub). */
export const USAGE_CONTRACT = Object.freeze({
  schema: "s127.upgrade-impact.usage.v1",
  ok: true,
  coverage: "complete|full|static|partial|unknown|missing|conflict",
  dynamicImport: false,
  missingEvidence: false,
  conflicting: false,
  usage: Object.freeze([
    Object.freeze({
      names: Object.freeze(["exportedName"]),
      dynamicImport: false,
      kind: "import|require|export-from|dynamic-import",
      namespaceImport: false,
      defaultImport: false,
      coverage: "static|partial|unknown",
      file: "optional",
    }),
  ]),
  references: Object.freeze([
    Object.freeze({
      symbol: "exportedName|default|*",
      kind: "named|default|namespace|sideEffect|reexport",
      dynamicImport: false,
      used: true,
      file: "optional",
    }),
  ]),
  limitations: Object.freeze([]),
});

/** c05 exportDiff shape this binder accepts (inner object or full diffExports result). */
export const EXPORT_DIFF_CONTRACT = Object.freeze({
  schema: "s127.upgrade-impact.export-diff.v1",
  ok: true,
  coverage: "complete|full|static|partial|unknown|missing|conflict",
  added: Object.freeze([]),
  removed: Object.freeze([]),
  renamed: Object.freeze([]),
  signatureChanged: Object.freeze([]),
  missingEvidence: false,
  conflicting: false,
  limitations: Object.freeze([]),
});

const BASE_LIMITATIONS = Object.freeze([
  "static bind only; no runtime execution of dependency code",
  "no full TypeScript program analysis in this cell; TS/dynamic limits stay unknown if the producer labeled them",
  "bind consumes c03/c05 output shapes and does not import their parsers",
]);

const COVERAGE_COMPLETE = new Set(["complete", "full", "js-complete", "static"]);
const COVERAGE_PARTIAL = new Set(["partial", "incomplete", "limited"]);
const COVERAGE_CONFLICT = new Set(["conflict", "conflicting", "disagreement"]);
const COVERAGE_MISSING = new Set(["missing", "none", "absent"]);

/**
 * Bind a c03 usage list to a c05 exportDiff.
 * Accepts either `{ usage, exportDiff, dependency?, lockfile? }` or a packet fragment.
 */
export function bindUsageToExportDiff(input) {
  try {
    return bindInner(input);
  } catch (err) {
    const message = err && typeof err.message === "string" ? err.message : "bind error";
    return makeResult({
      bindings: [],
      nextAction: "unknown",
      unknownReasons: [`bind failed on hostile or invalid input (${message})`],
      unusedChanges: [],
      actionableChanges: [],
      limitations: [...BASE_LIMITATIONS, "binder caught an exception and refused to claim action"],
    });
  }
}

/** Alias used by the CLI/integrator. */
export function bind(input) {
  return bindUsageToExportDiff(input);
}

/**
 * Fill packet `bindings`, `summary`, and merged `limitations`.
 * Copies only known packet fields so hostile extras are not forwarded.
 */
export function applyBindToPacket(packet) {
  const bound = bindUsageToExportDiff(isPlainObject(packet) ? packet : undefined);
  if (!isPlainObject(packet)) return bound;
  return {
    schema: typeof packet.schema === "string" ? packet.schema : PACKET_SCHEMA,
    createdAt: packet.createdAt ?? null,
    clock: packet.clock ?? null,
    caller: packet.caller ?? null,
    dependency: packet.dependency ?? null,
    provenance: packet.provenance ?? null,
    usage: packet.usage ?? null,
    exportDiff: packet.exportDiff ?? null,
    bindings: bound.bindings,
    summary: bound.summary,
    prior: packet.prior ?? null,
    limitations: uniqueStrings([
      ...asArray(packet.limitations).filter((row) => typeof row === "string"),
      ...bound.limitations,
    ]),
  };
}

export function selectBindNextAction({
  hasUsedRemoved = false,
  hasUsedEdits = false,
  unknownReasons = [],
} = {}) {
  if (hasUsedRemoved) return "review_breakages";
  if (hasUsedEdits) return "upgrade_with_edits";
  if (asArray(unknownReasons).length > 0) return "unknown";
  return "no_action";
}

function bindInner(input) {
  const ctx = isPlainObject(input) ? input : {};
  const usage = normalizeUsage(ctx.usage);
  const exportDiff = normalizeExportDiff(ctx.exportDiff);
  const lockfile = normalizeLockfile(ctx);
  const version = normalizeVersion(ctx.dependency);

  const unknownReasons = [];
  const limitations = [...BASE_LIMITATIONS];
  pushAll(limitations, usage.limitations);
  pushAll(limitations, exportDiff.limitations);

  if (usage.assumedCoverage) {
    limitations.push("usage supplied as an array; coverage assumed complete for listed references");
  }
  if (exportDiff.assumedCoverage) {
    limitations.push("exportDiff supplied as a change list; coverage assumed complete for listed changes");
  }

  let sourceBlocksAction = false;
  let sameVersionNoop = false;

  if (lockfile.disagreement) {
    sourceBlocksAction = true;
    unknownReasons.push("alias, workspace, or lockfile disagreement; unknown until resolved");
  }

  if (version.kind === "resolved_disagreement") {
    sourceBlocksAction = true;
    unknownReasons.push("resolved version disagrees with declared old/new version");
  }

  const versionTrusted = !lockfile.disagreement && version.kind !== "resolved_disagreement";
  if (versionTrusted && version.kind === "same") {
    if (exportDiff.present && exportDiff.hasAnyChange) {
      sourceBlocksAction = true;
      unknownReasons.push("same declared version but exportDiff reports changes");
    } else {
      sameVersionNoop = true;
    }
  } else if (!sameVersionNoop) {
    pushAll(unknownReasons, sourceCompletenessReasons(usage, "usage"));
    pushAll(unknownReasons, sourceCompletenessReasons(exportDiff, "exportDiff"));
    if (unknownReasons.length > 0) sourceBlocksAction = true;
  }

  const packageDynamic = usage.dynamicPackage;
  const dynamicCanHideUsage = packageDynamic && hasNonAddedChange(exportDiff) && !sameVersionNoop;
  if (dynamicCanHideUsage) {
    unknownReasons.push("dynamic import of package; non-static usage is unknown");
  }

  const symbols = new Set();
  for (const symbol of usage.bySymbol.keys()) {
    if (symbol && symbol !== "*") symbols.add(symbol);
  }
  for (const symbol of exportDiff.bySymbol.keys()) symbols.add(symbol);

  const bindings = [];
  for (const symbol of sortSymbols(symbols)) {
    const ref = usage.bySymbol.get(symbol);
    const change = exportDiff.bySymbol.get(symbol);
    const staticallyUsed = Boolean(ref?.used) || usage.namespaceImport;
    const dynamicSymbol = Boolean(ref?.dynamicImport) && !ref?.used;
    const used = staticallyUsed;

    const row = decideSymbol({
      symbol,
      used,
      staticallyUsed,
      dynamicSymbol,
      change,
      sourceBlocksAction,
      packageDynamic,
      sameVersionNoop,
      sourceBlockMessage: sourceBlocksAction ? unknownReasons[0] || "" : "",
    });
    if (row) bindings.push(row);
  }

  const actionableChanges = [];
  const unusedChanges = [];
  let hasUsedRemoved = false;
  let hasUsedEdits = false;

  for (const row of bindings) {
    if (row.decision === "action") {
      actionableChanges.push(summarizeChange(row));
      if (row.changeKind === "removed") hasUsedRemoved = true;
      if (row.changeKind === "signatureChanged" || row.changeKind === "renamed") {
        hasUsedEdits = true;
      }
    } else if (
      row.decision === "no_action" &&
      row.used === false &&
      row.changeKind !== "unchanged"
    ) {
      unusedChanges.push(summarizeChange(row));
    }
  }

  const extraUnknown = [];
  for (const row of bindings) {
    if (row.decision === "unknown") extraUnknown.push(row.rationale);
  }

  const mergedUnknown = uniqueStrings([...unknownReasons, ...extraUnknown]);
  const nextAction = sameVersionNoop
    ? "no_action"
    : selectBindNextAction({
        hasUsedRemoved,
        hasUsedEdits,
        unknownReasons: hasUsedRemoved || hasUsedEdits ? [] : mergedUnknown,
      });

  bindings.sort(compareBindings);

  return makeResult({
    bindings,
    nextAction,
    unknownReasons: nextAction === "no_action" ? [] : mergedUnknown,
    unusedChanges,
    actionableChanges,
    limitations: uniqueStrings(limitations),
  });
}

function hasNonAddedChange(exportDiff) {
  for (const change of exportDiff.bySymbol.values()) {
    if (change.kind && change.kind !== "added" && change.kind !== "unchanged") return true;
  }
  return false;
}

function sourceCompletenessReasons(source, label) {
  if (!source.present || source.invalid || source.missingEvidence || source.coverage === "missing") {
    return [`${label} evidence missing`];
  }
  if (source.conflicting || source.coverage === "conflict") {
    return [`conflicting ${label} source`];
  }
  if (source.coverage === "partial") return [`${label} coverage is partial`];
  if (source.coverage !== "complete") return [`${label} coverage is unknown`];
  return [];
}

function decideSymbol(args) {
  const {
    symbol,
    used,
    staticallyUsed,
    dynamicSymbol,
    change,
    sourceBlocksAction,
    packageDynamic,
    sameVersionNoop,
    sourceBlockMessage,
  } = args;

  const changeKind = change?.kind ?? (staticallyUsed ? "unchanged" : null);
  if (!changeKind) return null;

  if (sameVersionNoop) {
    return makeBinding({
      symbol,
      used: staticallyUsed,
      changeKind: change?.kind ?? "unchanged",
      decision: "no_action",
      rationale: `same version; no-op for '${symbol}'`,
      ruleId: "same_version_noop",
      renamedTo: change?.to,
    });
  }

  if (sourceBlocksAction) {
    const head = sourceBlockMessage || "missing, partial, or conflicting source";
    return makeBinding({
      symbol,
      used: staticallyUsed,
      changeKind: change?.kind ?? "unknown",
      decision: "unknown",
      rationale: `${head}; cannot claim action for '${symbol}'`,
      ruleId: "missing_or_partial_source",
      renamedTo: change?.to,
    });
  }

  if (dynamicSymbol) {
    return makeBinding({
      symbol,
      used: false,
      changeKind: change?.kind ?? "unknown",
      decision: "unknown",
      rationale: `dynamic import; usage of '${symbol}' is unknown`,
      ruleId: "dynamic_import",
      renamedTo: change?.to,
    });
  }

  if (packageDynamic && !staticallyUsed && change && change.kind !== "added") {
    return makeBinding({
      symbol,
      used: false,
      changeKind: change.kind,
      decision: "unknown",
      rationale: `package is also loaded dynamically; unused claim for '${symbol}' is unknown`,
      ruleId: "dynamic_import",
      renamedTo: change.to,
    });
  }

  if (!change || change.kind === "unchanged") {
    return makeBinding({
      symbol,
      used: true,
      changeKind: "unchanged",
      decision: "no_action",
      rationale: `used export '${symbol}' is unchanged`,
      ruleId: "used_unchanged",
    });
  }

  if (change.kind === "added") {
    return makeBinding({
      symbol,
      used: staticallyUsed,
      changeKind: "added",
      decision: "no_action",
      rationale: staticallyUsed
        ? `used export '${symbol}' is newly added; newer version alone is not a caller defect`
        : `added export '${symbol}' is unused; newer version alone is not a break`,
      ruleId: "newer_version_not_break",
    });
  }

  if (!staticallyUsed) {
    return makeBinding({
      symbol,
      used: false,
      changeKind: change.kind,
      decision: "no_action",
      rationale: `export '${symbol}' ${changePhrase(change)} but is not statically used; unused change is not a caller defect`,
      ruleId: "unused_change_not_caller_defect",
      renamedTo: change.to,
    });
  }

  if (change.kind === "removed") {
    return makeBinding({
      symbol,
      used: true,
      changeKind: "removed",
      decision: "action",
      rationale: `used export '${symbol}' was removed`,
      ruleId: "used_removed",
    });
  }

  if (change.kind === "signatureChanged") {
    return makeBinding({
      symbol,
      used: true,
      changeKind: "signatureChanged",
      decision: "action",
      rationale: `used export '${symbol}' has a signature change`,
      ruleId: "used_signature_changed",
    });
  }

  if (change.kind === "renamed") {
    const to = change.to || "(unknown)";
    return makeBinding({
      symbol,
      used: true,
      changeKind: "renamed",
      decision: "action",
      rationale: `used export '${symbol}' was renamed to '${to}'`,
      ruleId: "used_renamed",
      renamedTo: change.to,
    });
  }

  return makeBinding({
    symbol,
    used,
    changeKind: change.kind,
    decision: "unknown",
    rationale: `unclassified change for used export '${symbol}'`,
    ruleId: "unclassified_change",
  });
}

export function normalizeUsage(usage) {
  if (usage == null) {
    return emptyUsage({ present: false });
  }
  if (Array.isArray(usage)) {
    return finishUsage({
      present: true,
      coverage: "complete",
      assumedCoverage: true,
      references: expandUsageRecords(usage),
      dynamicPackage: false,
      missingEvidence: false,
      conflicting: false,
      limitations: [],
    });
  }
  if (!isPlainObject(usage)) {
    return emptyUsage({ present: false, invalid: true });
  }

  const records = [];
  pushAll(records, usage.references);
  pushAll(records, usage.imports);
  pushAll(records, usage.namedImports);
  pushAll(records, usage.usage);
  if (Array.isArray(usage.named)) {
    for (const symbol of usage.named) records.push({ symbol, kind: "named" });
  }
  if (Array.isArray(usage.symbols)) {
    for (const symbol of usage.symbols) records.push({ symbol, kind: "named" });
  }
  if (usage.default === true) records.push({ symbol: "default", kind: "default" });
  if (usage.namespace === true || usage.namespaceImport === true) {
    records.push({ symbol: "*", kind: "namespace" });
  }

  const derived = deriveUsageCoverage(usage);
  return finishUsage({
    present: true,
    coverage: derived.coverage,
    assumedCoverage: derived.assumedCoverage,
    references: expandUsageRecords(records),
    dynamicPackage: Boolean(usage.dynamicImport || usage.dynamic || usage.hasDynamicImport),
    missingEvidence: Boolean(usage.missingEvidence) || usage.ok === false || derived.coverage === "missing",
    conflicting: Boolean(usage.conflicting || usage.conflict),
    limitations: asStringList(usage.limitations),
  });
}

export function normalizeExportDiff(exportDiff) {
  if (exportDiff == null) {
    return emptyExportDiff({ present: false });
  }
  if (Array.isArray(exportDiff)) {
    return finishExportDiff({
      present: true,
      coverage: "complete",
      assumedCoverage: true,
      added: [],
      removed: [],
      renamed: [],
      signatureChanged: [],
      changes: exportDiff,
      missingEvidence: false,
      conflicting: false,
      limitations: [],
    });
  }
  if (!isPlainObject(exportDiff)) {
    return emptyExportDiff({ present: false, invalid: true });
  }

  const inner = isPlainObject(exportDiff.exportDiff) ? exportDiff.exportDiff : exportDiff;
  const limitations = uniqueStrings([
    ...asStringList(exportDiff.limitations),
    ...asStringList(inner.limitations),
  ]);
  const coverage = inner.coverage ?? exportDiff.coverage;
  const missing =
    Boolean(exportDiff.missingEvidence) ||
    Boolean(inner.missingEvidence) ||
    exportDiff.ok === false;

  return finishExportDiff({
    present: true,
    coverage,
    assumedCoverage: false,
    added: inner.added,
    removed: inner.removed,
    renamed: inner.renamed,
    signatureChanged: inner.signatureChanged,
    changes: inner.changes,
    missingEvidence: missing,
    conflicting: Boolean(inner.conflicting || inner.conflict || exportDiff.conflicting),
    limitations,
  });
}

function deriveUsageCoverage(usage) {
  if (usage.coverage != null && usage.coverage !== "") {
    return { coverage: usage.coverage, assumedCoverage: false };
  }
  if (usage.ok === false) return { coverage: "missing", assumedCoverage: false };
  const filesUnknown = asArray(usage.filesUnknown);
  const filesPartial = asArray(usage.filesPartial);
  const filesSkipped = asArray(usage.filesSkipped);
  const filesScanned = Number.isFinite(usage.filesScanned) ? usage.filesScanned : null;
  if (filesScanned === 0 && filesSkipped.length > 0) {
    return { coverage: "missing", assumedCoverage: false };
  }
  if (filesUnknown.length > 0 || filesPartial.length > 0) {
    return { coverage: "partial", assumedCoverage: false };
  }
  if (filesSkipped.length > 0 && filesScanned > 0) {
    return { coverage: "partial", assumedCoverage: false };
  }
  if (Array.isArray(usage.usage) || Array.isArray(usage.references) || Array.isArray(usage.imports)) {
    return { coverage: "complete", assumedCoverage: true };
  }
  return { coverage: usage.coverage, assumedCoverage: false };
}

function expandUsageRecords(records) {
  const out = [];
  for (const rec of asArray(records)) {
    if (typeof rec === "string" || typeof rec === "number") {
      out.push(rec);
      continue;
    }
    if (!isPlainObject(rec)) continue;

    const dynamic = Boolean(rec.dynamicImport || rec.dynamic || rec.kind === "dynamic-import");
    const names = Array.isArray(rec.names) ? rec.names : [];
    const seen = new Set();

    if (dynamic && names.length === 0 && !rec.symbol && !rec.name) {
      out.push({ ...rec, dynamicImport: true, kind: rec.kind || "dynamic-import" });
    }

    for (const n of names) {
      const symbol = normalizeSymbol(n);
      if (!symbol || seen.has(symbol)) continue;
      seen.add(symbol);
      out.push({
        ...rec,
        symbol,
        kind: symbol === "*" ? "namespace" : symbol === "default" ? "default" : rec.kind || "named",
        dynamicImport: dynamic,
      });
    }

    const direct = normalizeSymbol(rec.symbol ?? rec.name ?? "");
    if (direct && !seen.has(direct)) {
      seen.add(direct);
      out.push({ ...rec, symbol: direct, dynamicImport: dynamic });
    }

    if (rec.defaultImport && !seen.has("default")) {
      seen.add("default");
      out.push({ ...rec, symbol: "default", kind: "default", dynamicImport: dynamic });
    }
    if (rec.namespaceImport && !seen.has("*")) {
      seen.add("*");
      out.push({ ...rec, symbol: "*", kind: "namespace", dynamicImport: dynamic });
    }
    if (
      names.length === 0 &&
      !direct &&
      !rec.defaultImport &&
      !rec.namespaceImport &&
      !dynamic &&
      (rec.kind === "sideEffect" || rec.kind === "import" || rec.sideEffect === true)
    ) {
      out.push({ ...rec, sideEffect: true, kind: "sideEffect" });
    }
  }
  return out;
}

function finishUsage(raw) {
  const bySymbol = new Map();
  let namespaceImport = false;
  let dynamicPackage = Boolean(raw.dynamicPackage);
  let sideEffect = false;

  for (const item of asArray(raw.references)) {
    if (typeof item === "string" || typeof item === "number") {
      const symbol = normalizeSymbol(item);
      if (!symbol || symbol === "*") {
        if (symbol === "*") namespaceImport = true;
        continue;
      }
      mergeRef(bySymbol, { symbol, used: true, dynamicImport: false, files: [] });
      continue;
    }
    if (!isPlainObject(item)) continue;

    const kind = readString(item.kind || item.type).toLowerCase();
    const dynamic = Boolean(
      item.dynamicImport || item.dynamic || item.isDynamic || kind === "dynamic-import",
    );
    if (dynamic) dynamicPackage = true;

    if (kind === "sideeffect" || kind === "side-effect" || item.sideEffect === true) {
      sideEffect = true;
      if (dynamic) dynamicPackage = true;
      continue;
    }

    let symbol = symbolFromItem(item);
    if (kind === "default") symbol = symbol || "default";
    if (kind === "namespace" || symbol === "*") {
      namespaceImport = true;
      if (dynamic) dynamicPackage = true;
      continue;
    }
    if (!symbol) continue;

    const explicitUsed = item.used === true;
    const staticallyUsed = explicitUsed || (item.used !== false && !dynamic);
    mergeRef(bySymbol, {
      symbol,
      used: staticallyUsed,
      dynamicImport: dynamic,
      files: collectFiles(item),
    });
  }

  return {
    present: true,
    invalid: false,
    coverage: normalizeCoverage(raw.coverage, { assumedComplete: raw.assumedCoverage }),
    assumedCoverage: Boolean(raw.assumedCoverage),
    missingEvidence: Boolean(raw.missingEvidence),
    conflicting: Boolean(raw.conflicting),
    dynamicPackage,
    namespaceImport,
    sideEffect,
    bySymbol,
    limitations: asStringList(raw.limitations),
  };
}

function finishExportDiff(raw) {
  const bySymbol = new Map();
  const renameTargets = new Set();

  for (const item of asArray(raw.renamed)) {
    const pair = renamedPair(item);
    if (!pair) continue;
    if (pair.to) renameTargets.add(pair.to);
    if (!pair.to) {
      setChange(bySymbol, pair.from, { kind: "removed", rank: 4 });
    } else {
      setChange(bySymbol, pair.from, { kind: "renamed", to: pair.to, rank: 3 });
    }
  }

  for (const item of asArray(raw.removed)) {
    const symbol = symbolFromItem(item);
    if (!symbol) continue;
    setChange(bySymbol, symbol, { kind: "removed", rank: 4 });
  }

  for (const item of asArray(raw.signatureChanged)) {
    const symbol = symbolFromItem(item);
    if (!symbol) continue;
    setChange(bySymbol, symbol, { kind: "signatureChanged", rank: 2 });
  }

  for (const item of asArray(raw.added)) {
    const symbol = symbolFromItem(item);
    if (!symbol || renameTargets.has(symbol)) continue;
    setChange(bySymbol, symbol, { kind: "added", rank: 1 });
  }

  for (const item of asArray(raw.changes)) {
    if (!isPlainObject(item) && typeof item !== "string") continue;
    const symbol = symbolFromItem(item);
    if (!symbol) continue;
    const kind = isPlainObject(item)
      ? normalizeChangeKind(item.changeKind || item.kind || item.type)
      : "";
    if (!kind) continue;
    const rank = changeRank(kind);
    setChange(bySymbol, symbol, {
      kind,
      to: isPlainObject(item) ? normalizeSymbol(item.to || item.renamedTo || "") : "",
      rank,
    });
  }

  let hasAnyChange = false;
  for (const change of bySymbol.values()) {
    if (change.kind && change.kind !== "unchanged") hasAnyChange = true;
  }

  return {
    present: true,
    invalid: false,
    coverage: normalizeCoverage(raw.coverage, { assumedComplete: raw.assumedCoverage }),
    assumedCoverage: Boolean(raw.assumedCoverage),
    missingEvidence: Boolean(raw.missingEvidence),
    conflicting: Boolean(raw.conflicting),
    bySymbol,
    hasAnyChange,
    limitations: asStringList(raw.limitations),
  };
}

function emptyUsage(extra) {
  return {
    present: false,
    invalid: false,
    coverage: "missing",
    assumedCoverage: false,
    missingEvidence: true,
    conflicting: false,
    dynamicPackage: false,
    namespaceImport: false,
    sideEffect: false,
    bySymbol: new Map(),
    limitations: [],
    ...extra,
  };
}

function emptyExportDiff(extra) {
  return {
    present: false,
    invalid: false,
    coverage: "missing",
    assumedCoverage: false,
    missingEvidence: true,
    conflicting: false,
    bySymbol: new Map(),
    hasAnyChange: false,
    limitations: [],
    ...extra,
  };
}

function normalizeLockfile(ctx) {
  const lock = isPlainObject(ctx.lockfile) ? ctx.lockfile : {};
  const disagreement = Boolean(
    ctx.lockfileDisagreement ||
      ctx.aliasUnresolved ||
      ctx.workspaceUnresolved ||
      lock.disagreement ||
      lock.aliasUnresolved ||
      lock.workspaceUnresolved ||
      lock.conflict,
  );
  return { disagreement };
}

function normalizeVersion(dependency) {
  if (!isPlainObject(dependency)) return { kind: "absent" };
  const oldV = readString(dependency.oldVersion).trim();
  const newV = readString(dependency.newVersion).trim();
  if (!oldV || !newV) return { kind: "unknown_version" };
  const resolvedOld = readString(dependency.resolvedOld).trim();
  const resolvedNew = readString(dependency.resolvedNew).trim();
  if (oldV === newV) {
    if (resolvedOld && resolvedNew && resolvedOld !== resolvedNew) {
      return { kind: "resolved_disagreement" };
    }
    if (resolvedOld && resolvedOld !== oldV) return { kind: "resolved_disagreement" };
    if (resolvedNew && resolvedNew !== newV) return { kind: "resolved_disagreement" };
    return { kind: "same" };
  }
  return { kind: "different" };
}

function normalizeCoverage(value, { assumedComplete = false } = {}) {
  if (assumedComplete && (value == null || value === "")) return "complete";
  if (value == null || value === "") return "unknown";
  const v = String(value).trim().toLowerCase();
  if (COVERAGE_COMPLETE.has(v)) return "complete";
  if (COVERAGE_PARTIAL.has(v)) return "partial";
  if (COVERAGE_CONFLICT.has(v)) return "conflict";
  if (COVERAGE_MISSING.has(v)) return "missing";
  return "unknown";
}

function normalizeChangeKind(value) {
  const v = readString(value).trim();
  if (v === "added" || v === "removed" || v === "renamed" || v === "signatureChanged") return v;
  const lower = v.toLowerCase();
  if (lower === "add" || lower === "added") return "added";
  if (lower === "remove" || lower === "removed" || lower === "deleted") return "removed";
  if (lower === "rename" || lower === "renamed") return "renamed";
  if (lower === "signaturechanged" || lower === "signature" || lower === "signature-changed") {
    return "signatureChanged";
  }
  return "";
}

function changeRank(kind) {
  if (kind === "removed") return 4;
  if (kind === "renamed") return 3;
  if (kind === "signatureChanged") return 2;
  if (kind === "added") return 1;
  return 0;
}

function setChange(map, symbol, next) {
  const prev = map.get(symbol);
  if (!prev || (next.rank ?? 0) >= (prev.rank ?? 0)) {
    map.set(symbol, { kind: next.kind, to: next.to || prev?.to || "", rank: next.rank ?? 0 });
  }
}

function mergeRef(map, next) {
  const prev = map.get(next.symbol);
  if (!prev) {
    map.set(next.symbol, {
      symbol: next.symbol,
      used: Boolean(next.used),
      dynamicImport: Boolean(next.dynamicImport),
      files: [...next.files],
    });
    return;
  }
  prev.used = prev.used || Boolean(next.used);
  prev.dynamicImport = prev.dynamicImport || Boolean(next.dynamicImport);
  for (const file of next.files) {
    if (file && !prev.files.includes(file)) prev.files.push(file);
  }
}

function symbolFromItem(item) {
  if (typeof item === "string" || typeof item === "number") return normalizeSymbol(item);
  if (!isPlainObject(item)) return "";
  return normalizeSymbol(item.symbol ?? item.name ?? item.export ?? item.id ?? item.from ?? "");
}

function renamedPair(item) {
  if (typeof item === "string") {
    const symbol = normalizeSymbol(item);
    return symbol ? { from: symbol, to: "" } : null;
  }
  if (!isPlainObject(item)) return null;
  const from = normalizeSymbol(item.from ?? item.old ?? item.oldName ?? item.previous ?? item.symbol);
  const to = normalizeSymbol(item.to ?? item.new ?? item.newName ?? item.renamedTo ?? item.next);
  if (!from) return null;
  return { from, to };
}

function normalizeSymbol(raw) {
  const s = readString(raw).trim();
  if (!s) return "";
  const lower = s.toLowerCase();
  if (lower === "default" || lower === "export default") return "default";
  if (lower === "*" || lower === "namespace" || lower === "star") return "*";
  return s;
}

function collectFiles(item) {
  const files = [];
  if (typeof item.file === "string" && item.file) files.push(item.file);
  if (typeof item.path === "string" && item.path) files.push(item.path);
  if (Array.isArray(item.files)) {
    for (const file of item.files) {
      if (typeof file === "string" && file) files.push(file);
    }
  }
  return files;
}

function makeBinding({ symbol, used, changeKind, decision, rationale, ruleId, renamedTo }) {
  const row = {
    symbol,
    used: Boolean(used),
    changeKind,
    decision,
    rationale,
    ruleId,
  };
  if (renamedTo) row.renamedTo = renamedTo;
  return row;
}

function summarizeChange(row) {
  const out = { symbol: row.symbol, changeKind: row.changeKind, rationale: row.rationale };
  if (row.renamedTo) out.renamedTo = row.renamedTo;
  return out;
}

function makeResult({ bindings, nextAction, unknownReasons, unusedChanges, actionableChanges, limitations }) {
  return {
    schema: BIND_SCHEMA,
    bindings,
    summary: {
      nextAction,
      unknownReasons,
      unusedChanges,
      actionableChanges,
    },
    limitations,
  };
}

function compareBindings(a, b) {
  const rank = { action: 0, unknown: 1, no_action: 2 };
  const d = (rank[a.decision] ?? 9) - (rank[b.decision] ?? 9);
  if (d !== 0) return d;
  return String(a.symbol).localeCompare(String(b.symbol));
}

function sortSymbols(symbols) {
  return [...symbols].sort((a, b) => String(a).localeCompare(String(b)));
}

function changePhrase(change) {
  if (change.kind === "removed") return "was removed";
  if (change.kind === "signatureChanged") return "has a signature change";
  if (change.kind === "renamed") return `was renamed${change.to ? ` to '${change.to}'` : ""}`;
  if (change.kind === "added") return "was added";
  return "changed";
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function asStringList(value) {
  return asArray(value).filter((row) => typeof row === "string" && row.trim());
}

function pushAll(target, extra) {
  for (const item of asArray(extra)) target.push(item);
}

function uniqueStrings(items) {
  const out = [];
  const seen = new Set();
  for (const item of asArray(items)) {
    if (typeof item !== "string") continue;
    const s = item.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function readString(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}
