/**
 * Normalize and flatten package.json "exports" maps.
 * Enumerates declared (subpath, condition-chain, target) branches.
 * Does not execute packages, does not follow filesystem targets.
 *
 * Caps mirror cells/c14-hostile/exports-bounds.mjs (do not write to c14).
 */

import {
  classifyConditionChain,
  isSubpathKey,
} from "./conditions.mjs";

export const EXPORT_ENTRY_CAP = 1024;
export const EXPORT_TARGET_CAP = 4096;
export const EXPORT_DEPTH_CAP = 8;
export const MANIFEST_BYTES_CAP = 1024 * 1024;

const URL_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const WINDOWS_DRIVE_RE = /^[a-zA-Z]:[\\/]/;

export function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeSubpath(key) {
  if (key === "." || key === "./") return ".";
  return key;
}

export function normalizeTarget(target) {
  if (typeof target !== "string") return target;
  if (
    target.startsWith("./") ||
    target.startsWith("../") ||
    target.startsWith("/") ||
    target.startsWith("node:") ||
    URL_SCHEME_RE.test(target)
  ) {
    return target;
  }
  return `./${target}`;
}

export function inspectTargetString(target) {
  if (typeof target !== "string") {
    return { ok: false, reasons: ["target_not_string"], target };
  }
  const reasons = [];
  if (target.includes("\0")) reasons.push("target_nul_byte");
  if (target.includes("..")) reasons.push("target_dotdot");
  if (target.startsWith("/") || WINDOWS_DRIVE_RE.test(target) || /^[\\/]{2}/.test(target)) {
    reasons.push("target_absolute");
  }
  if (URL_SCHEME_RE.test(target) && !target.startsWith("node:")) {
    reasons.push("target_url_scheme");
  }
  if (
    !target.startsWith("./") &&
    !target.startsWith("../") &&
    !target.startsWith("node:") &&
    !URL_SCHEME_RE.test(target)
  ) {
    reasons.push("target_missing_dot_slash");
  }
  if (target.includes("*")) reasons.push("target_wildcard");
  return { ok: reasons.length === 0, reasons, target };
}

export function classifyExportsShape(exportsField) {
  if (exportsField === undefined) return { shape: "absent" };
  if (exportsField === null) return { shape: "blocked_root" };
  if (typeof exportsField === "string") return { shape: "string" };
  if (Array.isArray(exportsField)) return { shape: "array" };
  if (!isPlainObject(exportsField)) {
    return { shape: "invalid", reason: "exports_not_object_string_or_array" };
  }
  const keys = Object.keys(exportsField);
  if (keys.length === 0) return { shape: "empty_object" };
  const dots = keys.filter((key) => isSubpathKey(key));
  const conds = keys.filter((key) => !isSubpathKey(key));
  if (dots.length && conds.length) {
    return { shape: "invalid", reason: "mixed_subpath_and_conditions" };
  }
  if (dots.length) return { shape: "subpath_map", keys: dots };
  return { shape: "condition_map", keys: conds };
}

/**
 * Sugar: string / array / condition-map / null become a `{ ".": ... }` map.
 * Invalid mixed maps are not rewritten.
 */
export function normalizeExports(exportsField) {
  const shape = classifyExportsShape(exportsField);
  if (shape.shape === "absent") {
    return { ok: true, map: null, shape, unknownReasons: ["exports_field_absent"] };
  }
  if (shape.shape === "invalid") {
    return {
      ok: false,
      map: null,
      shape,
      unknownReasons: ["invalid_exports_map", shape.reason].filter(Boolean),
    };
  }
  if (
    shape.shape === "string" ||
    shape.shape === "array" ||
    shape.shape === "condition_map" ||
    shape.shape === "blocked_root"
  ) {
    return { ok: true, map: { ".": exportsField }, shape, unknownReasons: [] };
  }
  if (shape.shape === "empty_object") {
    return { ok: true, map: {}, shape, unknownReasons: [] };
  }
  return { ok: true, map: exportsField, shape, unknownReasons: [] };
}

export function conditionPathOf(conditions) {
  return (conditions || []).join(">");
}

export function entrySymbol({ kind = "exports", subpath, conditionPath, field }) {
  if (kind === "legacy") return `legacy:${field}`;
  if (kind === "resolve") return `resolve:${field}:${subpath || "."}`;
  const cond = conditionPath ? `:${conditionPath}` : "";
  return `exports:${subpath}${cond}`;
}

function addReason(stats, reason) {
  if (!reason) return;
  if (!stats.reasons.includes(reason)) stats.reasons.push(reason);
}

function makeEntry({
  subpath,
  conditions,
  target,
  blocked,
  fallbackIndex,
  fallbackLength,
  wildcard,
  targetReasons,
}) {
  const conditionPath = conditionPathOf(conditions);
  const classified = classifyConditionChain(conditions);
  return {
    kind: "exports",
    subpath,
    conditions: [...conditions],
    conditionPath,
    target,
    blocked: Boolean(blocked),
    wildcard: Boolean(wildcard) || (typeof subpath === "string" && subpath.includes("*")),
    fallbackIndex,
    fallbackLength,
    targetReasons: targetReasons || [],
    environmentDependent: classified.environmentDependent,
    hasTypes: classified.hasTypes,
    unknownReasons: classified.reasons,
    symbol: entrySymbol({ subpath, conditionPath }),
  };
}

function walkTarget(node, ctx) {
  const { stats, out } = ctx;
  if (stats.truncated) return;
  if (ctx.depth > EXPORT_DEPTH_CAP) {
    stats.truncated = true;
    addReason(stats, "exports_map_depth_cap");
    return;
  }
  if (stats.depth < ctx.depth) stats.depth = ctx.depth;

  if (typeof node === "string") {
    stats.targets += 1;
    if (stats.targets > EXPORT_TARGET_CAP) {
      stats.truncated = true;
      addReason(stats, "exports_map_target_cap");
      return;
    }
    const inspected = inspectTargetString(node);
    for (const reason of inspected.reasons) addReason(stats, reason);
    out.push(
      makeEntry({
        subpath: ctx.subpath,
        conditions: ctx.conditions,
        target: node,
        blocked: false,
        fallbackIndex: ctx.fallbackIndex,
        fallbackLength: ctx.fallbackLength,
        wildcard: ctx.wildcard,
        targetReasons: inspected.reasons,
      }),
    );
    return;
  }

  if (node === null) {
    stats.targets += 1;
    if (stats.targets > EXPORT_TARGET_CAP) {
      stats.truncated = true;
      addReason(stats, "exports_map_target_cap");
      return;
    }
    out.push(
      makeEntry({
        subpath: ctx.subpath,
        conditions: ctx.conditions,
        target: null,
        blocked: true,
        fallbackIndex: ctx.fallbackIndex,
        fallbackLength: ctx.fallbackLength,
        wildcard: ctx.wildcard,
        targetReasons: [],
      }),
    );
    return;
  }

  if (Array.isArray(node)) {
    if (node.length === 0) {
      stats.targets += 1;
      out.push(
        makeEntry({
          subpath: ctx.subpath,
          conditions: ctx.conditions,
          target: null,
          blocked: true,
          fallbackIndex: ctx.fallbackIndex,
          fallbackLength: ctx.fallbackLength,
          wildcard: ctx.wildcard,
          targetReasons: ["empty_fallback_array"],
        }),
      );
      addReason(stats, "empty_fallback_array");
      return;
    }
    const len = node.length;
    for (let i = 0; i < len; i += 1) {
      walkTarget(node[i], {
        ...ctx,
        fallbackIndex: i,
        fallbackLength: len,
        depth: ctx.depth + 1,
      });
    }
    return;
  }

  if (isPlainObject(node)) {
    const keys = Object.keys(node);
    stats.entries += keys.length;
    if (stats.entries > EXPORT_ENTRY_CAP) {
      stats.truncated = true;
      addReason(stats, "exports_map_entry_cap");
      return;
    }
    const hasDot = keys.some((key) => isSubpathKey(key));
    const hasCond = keys.some((key) => !isSubpathKey(key));
    if (hasDot && hasCond) {
      addReason(stats, "invalid_exports_map_mixed_keys");
      stats.unknown = true;
      return;
    }
    if (hasDot) {
      addReason(stats, "nested_subpath_map");
      stats.unknown = true;
      return;
    }
    for (const key of keys) {
      walkTarget(node[key], {
        ...ctx,
        conditions: [...ctx.conditions, key],
        depth: ctx.depth + 1,
      });
    }
    return;
  }

  addReason(stats, "invalid_exports_target_type");
  stats.unknown = true;
}

/**
 * Flatten an exports field into declared branches.
 * `coverage` is about whether we fully walked the declared map, not
 * whether we know which branch a caller would hit.
 */
export function flattenExports(exportsField, options = {}) {
  const stats = {
    entries: 0,
    targets: 0,
    depth: 0,
    truncated: false,
    unknown: false,
    reasons: [],
  };
  const normalized = normalizeExports(exportsField);
  if (!normalized.ok) {
    return {
      ok: false,
      entries: [],
      map: null,
      shape: normalized.shape,
      stats,
      unknownReasons: [...normalized.unknownReasons],
      coverage: "unknown",
    };
  }
  if (normalized.map == null) {
    // Absent is a complete observation: there is no exports map.
    // Resolution without exports is a legacy-entry concern (diff layer).
    return {
      ok: true,
      entries: [],
      map: null,
      shape: normalized.shape,
      stats,
      unknownReasons: [...normalized.unknownReasons],
      coverage: "full",
    };
  }

  const out = [];
  for (const key of Object.keys(normalized.map)) {
    stats.entries += 1;
    if (stats.entries > EXPORT_ENTRY_CAP) {
      stats.truncated = true;
      addReason(stats, "exports_map_entry_cap");
      break;
    }
    const subpath = normalizeSubpath(key);
    const wildcard = key.includes("*");
    if (wildcard) addReason(stats, "exports_wildcard_subpath");
    walkTarget(normalized.map[key], {
      subpath,
      conditions: [],
      fallbackIndex: null,
      fallbackLength: null,
      depth: 1,
      wildcard,
      stats,
      out,
    });
  }

  const unknownReasons = [...stats.reasons];
  let coverage = "full";
  if (stats.truncated || stats.unknown) {
    coverage = stats.truncated ? "partial" : "unknown";
    if (stats.truncated && !unknownReasons.includes("exports_map_oversize")) {
      unknownReasons.push("exports_map_oversize");
    }
  }
  if (unknownReasons.includes("exports_wildcard_subpath") && coverage === "full") {
    coverage = "partial";
  }

  return {
    ok: !stats.unknown || out.length > 0,
    entries: out,
    map: normalized.map,
    shape: normalized.shape,
    stats,
    unknownReasons,
    coverage,
    entryCap: options.entryCap ?? EXPORT_ENTRY_CAP,
  };
}

/**
 * Node PACKAGE_TARGET_RESOLVE subset: string / null / array fallback /
 * condition object in key insertion order.
 * Does not read files; a string target is a successful match.
 */
export function resolveTarget(node, requestConditions, depth = 0) {
  if (depth > EXPORT_DEPTH_CAP) {
    return { ok: false, reason: "exports_map_depth_cap", target: null };
  }
  if (node === undefined) return { ok: false, reason: "undefined_target", target: null };
  if (node === null) return { ok: false, reason: "blocked", blocked: true, target: null };
  if (typeof node === "string") {
    return { ok: true, target: node, blocked: false };
  }
  if (Array.isArray(node)) {
    const attempts = [];
    for (let i = 0; i < node.length; i += 1) {
      const result = resolveTarget(node[i], requestConditions, depth + 1);
      attempts.push({ index: i, ...result });
      if (result.ok) {
        return { ...result, fallbackIndex: i, fallbackLength: node.length, attempts };
      }
      if (result.blocked) {
        return { ...result, fallbackIndex: i, fallbackLength: node.length, attempts };
      }
    }
    return { ok: false, reason: "no_fallback_match", target: null, attempts };
  }
  if (isPlainObject(node)) {
    const keys = Object.keys(node);
    const hasDot = keys.some((key) => isSubpathKey(key));
    if (hasDot) {
      return { ok: false, reason: "nested_subpath_map", target: null };
    }
    const set = requestConditions instanceof Set ? requestConditions : new Set(requestConditions || []);
    for (const key of keys) {
      if (key === "default" || set.has(key)) {
        const result = resolveTarget(node[key], set, depth + 1);
        if (result.ok || result.blocked) {
          return { ...result, matchedCondition: key };
        }
      }
    }
    return { ok: false, reason: "no_condition_match", target: null };
  }
  return { ok: false, reason: "invalid_exports_target_type", target: null };
}

function exactSubpathKey(map, subpath) {
  if (!map) return null;
  if (Object.prototype.hasOwnProperty.call(map, subpath)) return subpath;
  if (subpath === "." && Object.prototype.hasOwnProperty.call(map, "./")) return "./";
  if (subpath === "./" && Object.prototype.hasOwnProperty.call(map, ".")) return ".";
  return null;
}

/**
 * Resolve one subpath under a request condition set.
 * Wildcard keys are not expanded (unknown).
 */
export function resolveExport(exportsField, subpath, requestConditions) {
  const normalized = normalizeExports(exportsField);
  if (!normalized.ok) {
    return { ok: false, reason: "invalid_exports_map", target: null, unknownReasons: normalized.unknownReasons };
  }
  if (normalized.map == null) {
    return { ok: false, reason: "exports_field_absent", target: null };
  }
  const want = normalizeSubpath(subpath || ".");
  const key = exactSubpathKey(normalized.map, want);
  if (!key) {
    const wild = Object.keys(normalized.map).filter((k) => k.includes("*"));
    if (wild.length) {
      return {
        ok: false,
        reason: "exports_wildcard_subpath",
        target: null,
        wildcardKeys: wild,
      };
    }
    return { ok: false, reason: "subpath_not_exported", target: null };
  }
  if (key.includes("*")) {
    return { ok: false, reason: "exports_wildcard_subpath", target: null };
  }
  return resolveTarget(normalized.map[key], requestConditions);
}

export function listSubpaths(exportsField) {
  const normalized = normalizeExports(exportsField);
  if (!normalized.ok || !normalized.map) return [];
  return Object.keys(normalized.map).map(normalizeSubpath);
}
