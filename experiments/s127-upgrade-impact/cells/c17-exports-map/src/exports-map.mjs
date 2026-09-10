/**
 * Deep-diff Node package.json "exports" conditional maps plus legacy
 * entry fields (main/module/browser/types).
 *
 * This cell diffs the declared public *path* surface, not JS named
 * exports (c05) and not .d.ts contents (c18).
 *
 * Decision rules:
 * - A new version is not itself a break.
 * - Unused export/subpath change is not a caller defect (usage is c03/c06).
 * - Environment-dependent conditions, missing/invalid maps, wildcards,
 *   and TS `types` stay unknown — never action.
 */

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  NODE_RUNTIME_SET_IDS,
  STANDARD_CONDITION_SETS,
  classifyCondition,
  classifyConditionChain,
  conditionSet,
} from "./conditions.mjs";
import {
  MANIFEST_BYTES_CAP,
  classifyExportsShape,
  entrySymbol,
  flattenExports,
  isPlainObject,
  listSubpaths,
  normalizeExports,
  normalizeTarget,
  resolveExport,
} from "./flatten.mjs";

export const SCHEMA = "s127.c17.exports-map.diff.v1";
export const CELL_ID = "c17-exports-map";

export {
  STANDARD_CONDITION_SETS,
  classifyCondition,
  classifyConditionChain,
} from "./conditions.mjs";
export {
  EXPORT_DEPTH_CAP,
  EXPORT_ENTRY_CAP,
  EXPORT_TARGET_CAP,
  MANIFEST_BYTES_CAP,
  classifyExportsShape,
  flattenExports,
  inspectTargetString,
  listSubpaths,
  normalizeExports,
  normalizeSubpath,
  normalizeTarget,
  resolveExport,
  resolveTarget,
} from "./flatten.mjs";

const LEGACY_FIELDS = Object.freeze(["main", "module", "browser", "types", "typings"]);
const LIMITATIONS = Object.freeze([
  "exports-map cell diffs package.json entry maps, not JS named exports (c05)",
  "no full TypeScript analysis; types-condition and .d.ts stay unknown (c18)",
  "condition matching emulates Node key-order (first match wins); TypeScript may differ",
  "import/require/node/browser/custom conditions are environment-dependent without caller usage",
  "wildcard subpaths are not expanded; coverage partial",
  "no runtime execution of untrusted packages or lifecycle scripts",
  "a newer version alone is not a break",
  "unused export change is not a caller defect",
]);

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function jsonEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function uniquePush(list, value) {
  if (value == null || value === "") return;
  if (!list.includes(value)) list.push(value);
}

function fieldString(manifest, field) {
  const value = manifest?.[field];
  if (typeof value === "string") return value;
  return undefined;
}

export function extractLegacyEntries(manifest) {
  const out = {
    main: fieldString(manifest, "main"),
    module: fieldString(manifest, "module"),
    types: fieldString(manifest, "types") || fieldString(manifest, "typings"),
    typings: fieldString(manifest, "typings"),
    browser: undefined,
    browserKind: "absent",
    packageType: typeof manifest?.type === "string" ? manifest.type : undefined,
    hasImportsField: manifest != null && Object.prototype.hasOwnProperty.call(manifest, "imports"),
  };
  const browser = manifest?.browser;
  if (typeof browser === "string") {
    out.browser = browser;
    out.browserKind = "string";
  } else if (isPlainObject(browser)) {
    out.browser = browser;
    out.browserKind = "object";
  } else if (browser !== undefined) {
    out.browser = browser;
    out.browserKind = "invalid";
  }
  return out;
}

export function readManifest(packageRoot, { bytesCap = MANIFEST_BYTES_CAP } = {}) {
  if (typeof packageRoot !== "string" || packageRoot === "") {
    return { ok: false, code: "missing_package_root", unknownReasons: ["missing_package_root"] };
  }
  const path = join(packageRoot, "package.json");
  let st;
  try {
    st = statSync(path);
  } catch {
    return { ok: false, code: "missing_package_json", path, unknownReasons: ["missing_package_json"] };
  }
  if (!st.isFile()) {
    return { ok: false, code: "package_json_not_file", path, unknownReasons: ["missing_package_json"] };
  }
  if (st.size > bytesCap) {
    return {
      ok: false,
      code: "manifest_oversize",
      path,
      bytes: st.size,
      unknownReasons: ["manifest_oversize"],
      coverage: "partial",
    };
  }
  let raw;
  try {
    raw = readFileSync(path);
  } catch {
    return { ok: false, code: "unreadable_package_json", path, unknownReasons: ["unreadable_package_json"] };
  }
  let manifest;
  try {
    manifest = JSON.parse(raw.toString("utf8"));
  } catch {
    return { ok: false, code: "package_json_invalid", path, unknownReasons: ["package_json_invalid"] };
  }
  if (!isPlainObject(manifest)) {
    return { ok: false, code: "package_json_not_object", path, unknownReasons: ["package_json_not_object"] };
  }
  return { ok: true, path, bytes: raw.length, manifest };
}

function branchKey(entry) {
  const fb = entry.fallbackIndex == null ? "" : `#${entry.fallbackIndex}`;
  return `${entry.subpath}\0${entry.conditionPath}\0${fb}`;
}

function groupBySubpath(entries) {
  const map = new Map();
  for (const entry of entries) {
    const list = map.get(entry.subpath) || [];
    list.push(entry);
    map.set(entry.subpath, list);
  }
  return map;
}

function legacyDiff(oldLegacy, newLegacy) {
  const changed = [];
  const signatureChanged = [];
  for (const field of LEGACY_FIELDS) {
    const oldValue = oldLegacy[field];
    const newValue = newLegacy[field];
    if (jsonEqual(oldValue ?? null, newValue ?? null)) continue;
    changed.push(field);
    signatureChanged.push({
      symbol: entrySymbol({ kind: "legacy", field }),
      kind: "legacy_field",
      field,
      from: oldValue ?? null,
      to: newValue ?? null,
    });
  }
  const packageTypeChanged = oldLegacy.packageType !== newLegacy.packageType;
  return { changed, signatureChanged, packageTypeChanged };
}

function resolveAll(exportsField, subpaths, setIds) {
  const resolved = {};
  for (const id of setIds) {
    const conditions = conditionSet(id);
    resolved[id] = {};
    for (const subpath of subpaths) {
      if (typeof subpath === "string" && subpath.includes("*")) {
        resolved[id][subpath] = {
          ok: false,
          reason: "exports_wildcard_subpath",
          target: null,
          resolver: "node-condition-order",
        };
        continue;
      }
      if (exportsField === undefined) {
        resolved[id][subpath] = {
          ok: false,
          reason: "exports_field_absent",
          target: null,
          resolver: "node-condition-order",
        };
        continue;
      }
      const result = resolveExport(exportsField, subpath, conditions);
      resolved[id][subpath] = {
        ok: Boolean(result.ok),
        reason: result.reason || null,
        target: result.target ?? null,
        blocked: Boolean(result.blocked),
        matchedCondition: result.matchedCondition ?? null,
        fallbackIndex: result.fallbackIndex ?? null,
        resolver: "node-condition-order",
      };
    }
  }
  return resolved;
}

function collectExactSubpaths(oldFlat, newFlat, oldExports, newExports) {
  const set = new Set();
  for (const p of listSubpaths(oldExports)) set.add(p);
  for (const p of listSubpaths(newExports)) set.add(p);
  if (set.size === 0) set.add(".");
  return [...set].filter((p) => !p.includes("*")).sort();
}

function compareResolved(oldResolved, newResolved, setIds, subpaths) {
  const changed = [];
  const signatureChanged = [];
  let runtimeChanged = false;
  for (const id of setIds) {
    for (const subpath of subpaths) {
      const oldRow = oldResolved[id]?.[subpath];
      const newRow = newResolved[id]?.[subpath];
      const oldTarget = oldRow?.ok ? normalizeTarget(oldRow.target) : oldRow?.reason || null;
      const newTarget = newRow?.ok ? normalizeTarget(newRow.target) : newRow?.reason || null;
      const oldOk = Boolean(oldRow?.ok);
      const newOk = Boolean(newRow?.ok);
      if (oldOk === newOk && oldTarget === newTarget) continue;
      const symbol = entrySymbol({ kind: "resolve", field: id, subpath });
      const row = {
        symbol,
        kind: "resolved_target",
        conditionSet: id,
        subpath,
        from: oldRow?.ok ? oldRow.target : null,
        to: newRow?.ok ? newRow.target : null,
        fromReason: oldRow?.ok ? null : oldRow?.reason || null,
        toReason: newRow?.ok ? null : newRow?.reason || null,
      };
      signatureChanged.push(row);
      changed.push(symbol);
      if (NODE_RUNTIME_SET_IDS.includes(id) && subpath === ".") runtimeChanged = true;
    }
  }
  return { changed, signatureChanged, runtimeChanged };
}

function environmentDivergence(resolved, setIds, subpath = ".") {
  const byTarget = new Map();
  for (const id of setIds) {
    const row = resolved[id]?.[subpath];
    const key = row?.ok ? `ok:${normalizeTarget(row.target)}` : `err:${row?.reason || "unknown"}`;
    const list = byTarget.get(key) || [];
    list.push(id);
    byTarget.set(key, list);
  }
  return {
    diverge: byTarget.size > 1,
    groups: Object.fromEntries([...byTarget.entries()].map(([k, v]) => [k, v])),
  };
}

function unknownResult(reason, extra = {}) {
  const unknownReasons = Array.isArray(reason) ? [...reason] : [reason];
  return {
    ok: false,
    schema: SCHEMA,
    coverage: extra.coverage || "unknown",
    added: [],
    removed: [],
    renamed: [],
    signatureChanged: [],
    mainStableExportsChanged: false,
    exportsStableMainChanged: false,
    mapStructureChanged: false,
    runtimeResolutionChanged: false,
    environmentDependent: true,
    decisionHint: "unknown",
    unknownReasons,
    limitations: [...LIMITATIONS],
    subpaths: { added: [], removed: [], changed: [], unchanged: [] },
    resolved: { old: {}, new: {} },
    ...extra,
  };
}

/**
 * Diff two package.json objects' public entry surface.
 * Never returns decisionHint "action" — usage binding is c06.
 */
export function diffExportsMap(oldManifest, newManifest, options = {}) {
  if (!isPlainObject(oldManifest) || !isPlainObject(newManifest)) {
    return unknownResult("manifest_not_object");
  }

  const unknownReasons = [];
  const limitations = [...LIMITATIONS];
  const setIds = options.conditionSets
    ? [...options.conditionSets]
    : Object.keys(STANDARD_CONDITION_SETS);

  const oldHasExports = Object.prototype.hasOwnProperty.call(oldManifest, "exports");
  const newHasExports = Object.prototype.hasOwnProperty.call(newManifest, "exports");
  const oldExports = oldHasExports ? oldManifest.exports : undefined;
  const newExports = newHasExports ? newManifest.exports : undefined;

  const oldShape = classifyExportsShape(oldExports);
  const newShape = classifyExportsShape(newExports);
  if (oldShape.shape === "invalid") uniquePush(unknownReasons, "invalid_exports_map");
  if (newShape.shape === "invalid") uniquePush(unknownReasons, "invalid_exports_map");

  const oldFlat = flattenExports(oldExports);
  const newFlat = flattenExports(newExports);
  for (const reason of oldFlat.unknownReasons) uniquePush(unknownReasons, reason);
  for (const reason of newFlat.unknownReasons) uniquePush(unknownReasons, reason);

  const oldLegacy = extractLegacyEntries(oldManifest);
  const newLegacy = extractLegacyEntries(newManifest);
  const legacy = legacyDiff(oldLegacy, newLegacy);
  if (oldLegacy.hasImportsField || newLegacy.hasImportsField) {
    uniquePush(limitations, "package.json imports (#specifiers) are not flattened here");
    uniquePush(unknownReasons, "package_imports_field_unanalyzed");
  }
  if (
    Object.prototype.hasOwnProperty.call(oldManifest, "typesVersions") ||
    Object.prototype.hasOwnProperty.call(newManifest, "typesVersions")
  ) {
    uniquePush(limitations, "package.json typesVersions is not applied; TypeScript path remaps stay unknown (c18)");
    uniquePush(unknownReasons, "typesVersions_unexpanded");
  }
  if (legacy.packageTypeChanged) {
    uniquePush(unknownReasons, "package_type_changed");
  }

  const oldMain = oldLegacy.main;
  const newMain = newLegacy.main;
  const mainEqual =
    normalizeTarget(oldMain || "") === normalizeTarget(newMain || "") &&
    Boolean(oldMain) === Boolean(newMain);
  const exportsEqual = jsonEqual(oldExports ?? null, newExports ?? null);
  const mainStableExportsChanged = mainEqual && !exportsEqual;
  const exportsStableMainChanged = exportsEqual && !mainEqual && (oldHasExports || newHasExports);

  if (exportsStableMainChanged) {
    uniquePush(unknownReasons, "main_changed_exports_stable");
    uniquePush(unknownReasons, "legacy_entry_environment_dependent");
  }
  if (mainStableExportsChanged) {
    uniquePush(unknownReasons, "exports_changed_main_stable");
  }
  if (!oldHasExports && !newHasExports) {
    uniquePush(unknownReasons, "no_exports_field_legacy_entry_unknown");
  }
  if (oldHasExports !== newHasExports) {
    uniquePush(unknownReasons, "exports_field_presence_changed");
    uniquePush(
      limitations,
      "when exports is present Node ignores main for package entry; older Node and some bundlers still use main",
    );
  }
  if (!oldHasExports && !oldMain && !newHasExports && !newMain) {
    uniquePush(unknownReasons, "missing_entry_fields");
  }

  const oldByKey = new Map(oldFlat.entries.map((e) => [branchKey(e), e]));
  const newByKey = new Map(newFlat.entries.map((e) => [branchKey(e), e]));

  const added = [];
  const removed = [];
  const signatureChanged = [...legacy.signatureChanged];

  for (const [key, entry] of newByKey) {
    if (!oldByKey.has(key)) {
      added.push({
        symbol: entry.symbol,
        kind: "exports_branch",
        subpath: entry.subpath,
        conditionPath: entry.conditionPath,
        target: entry.target,
        blocked: entry.blocked,
      });
    }
  }
  for (const [key, entry] of oldByKey) {
    if (!newByKey.has(key)) {
      removed.push({
        symbol: entry.symbol,
        kind: "exports_branch",
        subpath: entry.subpath,
        conditionPath: entry.conditionPath,
        target: entry.target,
        blocked: entry.blocked,
      });
    }
  }

  for (const [key, newEntry] of newByKey) {
    const oldEntry = oldByKey.get(key);
    if (!oldEntry) continue;
    const oldT = oldEntry.blocked ? null : oldEntry.target;
    const newT = newEntry.blocked ? null : newEntry.target;
    if (oldT === newT && oldEntry.blocked === newEntry.blocked) continue;
    signatureChanged.push({
      symbol: newEntry.symbol,
      kind: oldEntry.blocked !== newEntry.blocked ? "exports_blocked" : "exports_target",
      subpath: newEntry.subpath,
      conditionPath: newEntry.conditionPath,
      from: oldT,
      to: newT,
      fromBlocked: oldEntry.blocked,
      toBlocked: newEntry.blocked,
    });
  }

  const oldSub = new Set(oldFlat.entries.map((e) => e.subpath));
  const newSub = new Set(newFlat.entries.map((e) => e.subpath));
  if (!oldHasExports && oldMain) oldSub.add(".");
  if (!newHasExports && newMain) newSub.add(".");
  const subpaths = {
    added: [...newSub].filter((s) => !oldSub.has(s)).sort(),
    removed: [...oldSub].filter((s) => !newSub.has(s)).sort(),
    changed: [],
    unchanged: [],
  };
  const oldGrouped = groupBySubpath(oldFlat.entries);
  const newGrouped = groupBySubpath(newFlat.entries);
  for (const sub of new Set([...oldSub, ...newSub])) {
    if (subpaths.added.includes(sub) || subpaths.removed.includes(sub)) continue;
    const a = JSON.stringify((oldGrouped.get(sub) || []).map(branchFingerprint));
    const b = JSON.stringify((newGrouped.get(sub) || []).map(branchFingerprint));
    if (a === b) subpaths.unchanged.push(sub);
    else subpaths.changed.push(sub);
  }
  subpaths.changed.sort();
  subpaths.unchanged.sort();

  const exactSubpaths = collectExactSubpaths(oldFlat, newFlat, oldExports, newExports);
  const oldResolved = resolveAll(oldExports, exactSubpaths, setIds);
  const newResolved = resolveAll(newExports, exactSubpaths, setIds);
  const resolvedCmp = compareResolved(oldResolved, newResolved, setIds, exactSubpaths);
  for (const row of resolvedCmp.signatureChanged) signatureChanged.push(row);

  const oldDiv = environmentDivergence(oldResolved, setIds, ".");
  const newDiv = environmentDivergence(newResolved, setIds, ".");
  const importRequireDiverge =
    importRequireTargetsDiverge(oldResolved) || importRequireTargetsDiverge(newResolved);

  if (importRequireDiverge) uniquePush(unknownReasons, "caller_module_system_unknown");

  const allEntries = [...oldFlat.entries, ...newFlat.entries];
  let environmentDependent = false;
  let sawTypes = false;
  let sawCustom = false;
  let sawRuntimeEnv = false;
  let sawModuleSystem = false;
  for (const entry of allEntries) {
    const classified = classifyConditionChain(entry.conditions);
    if (classified.environmentDependent) environmentDependent = true;
    if (classified.hasTypes) sawTypes = true;
    if (classified.hasCustom) sawCustom = true;
    if (classified.hasRuntimeEnv) sawRuntimeEnv = true;
    if (classified.hasModuleSystem) sawModuleSystem = true;
  }
  if (sawModuleSystem && !importRequireDiverge) {
    uniquePush(
      limitations,
      "import/require conditions present; resolved targets currently agree, but caller module system is not observed here",
    );
  }
  if (oldDiv.diverge || newDiv.diverge) {
    environmentDependent = true;
    uniquePush(unknownReasons, "exports_conditions_environment_dependent");
  }
  if (sawRuntimeEnv) uniquePush(unknownReasons, "runtime_environment_dependent");
  if (sawTypes) uniquePush(unknownReasons, "typescript_types_condition");
  if (sawCustom) uniquePush(unknownReasons, "custom_exports_condition");
  if (oldLegacy.browserKind !== "absent" || newLegacy.browserKind !== "absent") {
    environmentDependent = true;
    uniquePush(unknownReasons, "legacy_browser_field_environment_dependent");
  }
  if (oldLegacy.module || newLegacy.module) {
    environmentDependent = true;
    uniquePush(unknownReasons, "legacy_module_field_bundler_dependent");
  }
  if (exportsStableMainChanged || (!oldHasExports && !newHasExports && legacy.changed.includes("main"))) {
    environmentDependent = true;
  }
  if (oldHasExports && oldMain) {
    const nodeTarget = oldResolved["node-import"]?.["."];
    if (nodeTarget?.ok && normalizeTarget(nodeTarget.target) !== normalizeTarget(oldMain)) {
      uniquePush(unknownReasons, "exports_overrides_main");
      environmentDependent = true;
    }
  }
  if (newHasExports && newMain) {
    const nodeTarget = newResolved["node-import"]?.["."];
    if (nodeTarget?.ok && normalizeTarget(nodeTarget.target) !== normalizeTarget(newMain)) {
      uniquePush(unknownReasons, "exports_overrides_main");
      environmentDependent = true;
    }
  }

  const mapStructureChanged = !exportsEqual;
  const runtimeResolutionChanged = resolvedCmp.runtimeChanged;
  const surfaceChanged =
    mapStructureChanged ||
    runtimeResolutionChanged ||
    legacy.changed.length > 0 ||
    added.length > 0 ||
    removed.length > 0 ||
    signatureChanged.length > 0 ||
    legacy.packageTypeChanged;

  let coverage = "full";
  if (oldFlat.coverage === "unknown" || newFlat.coverage === "unknown" || oldShape.shape === "invalid" || newShape.shape === "invalid") {
    coverage = "unknown";
  } else if (oldFlat.coverage === "partial" || newFlat.coverage === "partial") {
    coverage = "partial";
  } else if (!oldHasExports && !newHasExports) {
    coverage = "partial";
  }

  if (allEntries.some((e) => e.wildcard) || unknownReasons.includes("exports_wildcard_subpath")) {
    if (coverage === "full") coverage = "partial";
  }

  // Identical declared surface (including version-only bumps): not a break.
  let decisionHint = "unknown";
  if (!surfaceChanged && coverage !== "unknown") {
    decisionHint = "no_action";
  }
  if (coverage === "unknown") decisionHint = "unknown";
  const hardUnknown = unknownReasons.some((reason) =>
    [
      "invalid_exports_map",
      "typesVersions_unexpanded",
      "package_imports_field_unanalyzed",
      "manifest_oversize",
      "package_json_invalid",
      "missing_entry_fields",
    ].includes(reason),
  );
  if (hardUnknown) decisionHint = "unknown";

  // Never action: this cell has no usage graph.
  if (decisionHint === "action") decisionHint = "unknown";

  return {
    ok: true,
    schema: SCHEMA,
    coverage,
    added,
    removed,
    renamed: [],
    signatureChanged,
    mainStableExportsChanged,
    exportsStableMainChanged,
    mapStructureChanged,
    runtimeResolutionChanged,
    environmentDependent,
    decisionHint,
    unknownReasons,
    limitations,
    subpaths,
    resolved: { old: oldResolved, new: newResolved },
    legacy: {
      old: oldLegacy,
      new: newLegacy,
      changed: legacy.changed,
      packageTypeChanged: legacy.packageTypeChanged,
    },
    shapes: { old: oldShape, new: newShape },
    flatten: {
      old: { coverage: oldFlat.coverage, stats: oldFlat.stats, unknownReasons: oldFlat.unknownReasons },
      new: { coverage: newFlat.coverage, stats: newFlat.stats, unknownReasons: newFlat.unknownReasons },
    },
    environment: {
      oldDiverge: oldDiv,
      newDiverge: newDiv,
      importRequireDiverge,
    },
    versions: {
      old: typeof oldManifest.version === "string" ? oldManifest.version : null,
      new: typeof newManifest.version === "string" ? newManifest.version : null,
    },
  };
}

function importRequireTargetsDiverge(resolved) {
  const nodeImport = resolved["node-import"]?.["."];
  const nodeRequire = resolved["node-require"]?.["."];
  if (!nodeImport?.ok || !nodeRequire?.ok) return false;
  return normalizeTarget(nodeImport.target) !== normalizeTarget(nodeRequire.target);
}

function branchFingerprint(entry) {
  return {
    conditionPath: entry.conditionPath,
    target: entry.target,
    blocked: entry.blocked,
    fallbackIndex: entry.fallbackIndex,
  };
}

export function toExportDiffOverlay(diff) {
  return {
    exportDiff: {
      added: diff.added || [],
      removed: diff.removed || [],
      renamed: diff.renamed || [],
      signatureChanged: diff.signatureChanged || [],
      coverage: diff.coverage || "unknown",
      exportsMap: {
        schema: SCHEMA,
        cell: CELL_ID,
        mainStableExportsChanged: Boolean(diff.mainStableExportsChanged),
        exportsStableMainChanged: Boolean(diff.exportsStableMainChanged),
        mapStructureChanged: Boolean(diff.mapStructureChanged),
        runtimeResolutionChanged: Boolean(diff.runtimeResolutionChanged),
        environmentDependent: Boolean(diff.environmentDependent),
        decisionHint: diff.decisionHint || "unknown",
        subpaths: diff.subpaths || { added: [], removed: [], changed: [], unchanged: [] },
        resolved: diff.resolved || { old: {}, new: {} },
        unknownReasons: diff.unknownReasons || [],
      },
    },
    limitations: diff.limitations || [...LIMITATIONS],
    summary: {
      nextAction: diff.decisionHint || "unknown",
      unknownReasons: diff.unknownReasons || [],
      unusedChanges: [],
      actionableChanges: [],
    },
  };
}

function loadSide(ctx, side) {
  const cap = side[0].toUpperCase() + side.slice(1);
  if (isPlainObject(ctx[`${side}Manifest`])) {
    return { ok: true, manifest: ctx[`${side}Manifest`] };
  }
  if (isPlainObject(ctx.manifests?.[side])) {
    return { ok: true, manifest: ctx.manifests[side] };
  }
  const dir =
    ctx[`${side}Dir`] ||
    ctx[`fixture${cap}`] ||
    ctx.packet?.dependency?.[`${side}Tree`] ||
    ctx.input?.[`${side}Tree`];
  if (typeof dir === "string" && dir) {
    return readManifest(dir);
  }
  return { ok: false, unknownReasons: [`missing_${side}_manifest`] };
}

/**
 * Integrator entry. Accepts { oldManifest, newManifest } or directories
 * with package.json. Returns a packet overlay. Never decision=action.
 */
export function run(ctx = {}) {
  const oldSide = loadSide(ctx, "old");
  const newSide = loadSide(ctx, "new");
  if (!oldSide.ok || !newSide.ok) {
    const reasons = [
      ...(oldSide.unknownReasons || []),
      ...(newSide.unknownReasons || []),
      ...(!oldSide.ok && !oldSide.unknownReasons ? [oldSide.code || "missing_old_manifest"] : []),
      ...(!newSide.ok && !newSide.unknownReasons ? [newSide.code || "missing_new_manifest"] : []),
    ];
    const diff = unknownResult(reasons.length ? reasons : ["missing_manifest"]);
    return { overlay: toExportDiffOverlay(diff), diff };
  }
  const diff = diffExportsMap(oldSide.manifest, newSide.manifest, ctx);
  return { overlay: toExportDiffOverlay(diff), diff };
}

export function diffExports(oldManifest, newManifest, options) {
  return diffExportsMap(oldManifest, newManifest, options);
}

export function exportDiff(oldManifest, newManifest, options) {
  return diffExportsMap(oldManifest, newManifest, options);
}

export function diffPackageDirs(oldDir, newDir, options = {}) {
  const oldSide = readManifest(oldDir, options);
  const newSide = readManifest(newDir, options);
  if (!oldSide.ok || !newSide.ok) {
    const reasons = [
      ...(oldSide.unknownReasons || [oldSide.code]),
      ...(newSide.unknownReasons || [newSide.code]),
    ].filter(Boolean);
    return unknownResult(reasons);
  }
  const diff = diffExportsMap(oldSide.manifest, newSide.manifest, options);
  diff.paths = { old: oldSide.path, new: newSide.path };
  return diff;
}

export { cloneJson };
