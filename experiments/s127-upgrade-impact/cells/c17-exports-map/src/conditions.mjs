/**
 * Classify package.json "exports" condition names.
 * Node matches object keys in insertion order; first match wins.
 * We do not invent a caller environment — environment-dependent
 * conditions stay unknown until usage/bind (c03/c06) says otherwise.
 */

export const SCHEMA = "s127.c17.exports-map.conditions.v1";

/** Keys that Node treats as always-matching fallbacks. */
export const UNIVERSAL_CONDITIONS = Object.freeze(["default"]);

/** ESM vs CJS vs module-sync. Node sets these from the request kind. */
export const MODULE_SYSTEM_CONDITIONS = Object.freeze([
  "import",
  "require",
  "module-sync",
]);

/** Node runtime flags. Still environment-dependent vs bundlers/browsers. */
export const NODE_RUNTIME_CONDITIONS = Object.freeze(["node", "node-addons"]);

/** TypeScript-only. Not a Node runtime condition. c18 owns .d.ts contents. */
export const TYPESCRIPT_CONDITIONS = Object.freeze(["types"]);

/**
 * Community / bundler / edge conditions. Presence means resolution
 * depends on the host. This list is not exhaustive; anything else is custom.
 */
export const ENVIRONMENT_CONDITIONS = Object.freeze([
  "browser",
  "deno",
  "bun",
  "react-native",
  "electron",
  "worker",
  "workerd",
  "edge-light",
  "edge-routine",
  "lagon",
  "netlify",
  "wintercg",
  "development",
  "production",
  "module",
]);

const UNIVERSAL = new Set(UNIVERSAL_CONDITIONS);
const MODULE_SYSTEM = new Set(MODULE_SYSTEM_CONDITIONS);
const NODE_RUNTIME = new Set(NODE_RUNTIME_CONDITIONS);
const ENVIRONMENT = new Set(ENVIRONMENT_CONDITIONS);

/**
 * Standard condition *sets* used to probe Node-like resolution.
 * "default" is not included: Node treats it as a map-side always-match,
 * not as a request condition.
 *
 * These are probes, not a claim that the caller uses them.
 */
export const STANDARD_CONDITION_SETS = Object.freeze({
  "node-import": Object.freeze(["node", "import", "node-addons"]),
  "node-require": Object.freeze(["node", "require", "node-addons"]),
  "node-module-sync": Object.freeze(["node", "module-sync", "node-addons"]),
  "types-import": Object.freeze(["types", "node", "import"]),
  "types-require": Object.freeze(["types", "node", "require"]),
  "browser-import": Object.freeze(["browser", "import"]),
  "browser-require": Object.freeze(["browser", "require"]),
  "deno-import": Object.freeze(["deno", "import"]),
  "development-import": Object.freeze(["development", "node", "import"]),
  "production-import": Object.freeze(["production", "node", "import"]),
});

/** Condition sets that represent Node runtime entry (not TS, not browser). */
export const NODE_RUNTIME_SET_IDS = Object.freeze(["node-import", "node-require"]);

export function isTypesCondition(name) {
  return name === "types" || (typeof name === "string" && name.startsWith("types@"));
}

export function classifyCondition(name) {
  if (typeof name !== "string" || name === "") {
    return {
      kind: "invalid",
      environmentDependent: true,
      reason: "invalid_condition_name",
    };
  }
  if (UNIVERSAL.has(name)) {
    return { kind: "universal", environmentDependent: false, reason: null };
  }
  if (MODULE_SYSTEM.has(name)) {
    return {
      kind: "module_system",
      environmentDependent: true,
      reason: "caller_module_system_unknown",
    };
  }
  if (NODE_RUNTIME.has(name)) {
    return {
      kind: "node_runtime",
      environmentDependent: true,
      reason: "runtime_environment_dependent",
    };
  }
  if (isTypesCondition(name)) {
    return {
      kind: "typescript",
      environmentDependent: true,
      reason: "typescript_types_condition",
    };
  }
  if (ENVIRONMENT.has(name)) {
    return {
      kind: "environment",
      environmentDependent: true,
      reason: name === "module" ? "bundler_module_condition" : "runtime_environment_dependent",
    };
  }
  if (name.startsWith(".")) {
    return {
      kind: "subpath_as_condition",
      environmentDependent: true,
      reason: "nested_subpath_map",
    };
  }
  return {
    kind: "custom",
    environmentDependent: true,
    reason: "custom_exports_condition",
  };
}

export function classifyConditionChain(conditions) {
  const kinds = [];
  const reasons = [];
  let environmentDependent = false;
  let hasTypes = false;
  let hasModuleSystem = false;
  let hasRuntimeEnv = false;
  let hasCustom = false;
  for (const name of conditions || []) {
    const row = classifyCondition(name);
    kinds.push({ name, ...row });
    if (row.environmentDependent) environmentDependent = true;
    if (row.reason && !reasons.includes(row.reason)) reasons.push(row.reason);
    if (row.kind === "typescript") hasTypes = true;
    if (row.kind === "module_system") hasModuleSystem = true;
    if (row.kind === "environment" || row.kind === "node_runtime") hasRuntimeEnv = true;
    if (row.kind === "custom" || row.kind === "invalid") hasCustom = true;
  }
  return {
    kinds,
    reasons,
    environmentDependent,
    hasTypes,
    hasModuleSystem,
    hasRuntimeEnv,
    hasCustom,
  };
}

export function conditionSet(idOrList) {
  if (Array.isArray(idOrList)) return new Set(idOrList);
  const listed = STANDARD_CONDITION_SETS[idOrList];
  if (!listed) return new Set();
  return new Set(listed);
}

export function isConditionKey(key) {
  return typeof key === "string" && !key.startsWith(".");
}

export function isSubpathKey(key) {
  return typeof key === "string" && key.startsWith(".");
}
