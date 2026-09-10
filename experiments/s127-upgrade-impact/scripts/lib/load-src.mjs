import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveSrcRoot } from "./paths.mjs";

/**
 * Expected sibling src modules (owned by other cells; may be missing).
 * CLI calls the first function export in `exports` with a single ctx object:
 *   { command, input, packet, stages }
 * Return an overlay of packet fields, or { packet } / { overlay }.
 *
 * Stage ids and files:
 *   normalize     src/normalize.mjs     normalizeCallerInput | normalize | normalizeInput | run
 *   lockfile      src/lockfile.mjs      resolveLockfile | resolveDependency | analyzeLockfile | run
 *   acquire       src/acquire.mjs       acquirePair | acquire | acquireSources | run
 *   imports       src/imports.mjs       analyzeStaticImports | analyzeImports | analyzeUsage | run
 *   exportDiff    src/export-diff.mjs   diffExports | exportDiff | run
 *   bind          src/bind.mjs          bind | bindUsageToExportDiff | applyBindToPacket | run
 *   unknown       src/unknown.mjs       applyUnknownPolicy | collectReasonsFromDraft | run
 *   prior         src/prior.mjs         attachPrior | correctPrior | createPrior | loadPrior | run
 */
export const STAGE_SPECS = Object.freeze([
  {
    id: "normalize",
    file: "normalize.mjs",
    exports: ["normalizeCallerInput", "normalize", "normalizeInput", "run"],
  },
  {
    id: "lockfile",
    file: "lockfile.mjs",
    exports: ["resolveCallerDependency", "resolveLockfile", "resolveDependency", "analyzeLockfile", "run"],
  },
  {
    id: "acquire",
    file: "acquire.mjs",
    exports: ["acquirePair", "acquire", "acquireSources", "run"],
  },
  {
    id: "imports",
    file: "imports.mjs",
    exports: ["analyzeStaticImports", "analyzeImports", "analyzeUsage", "scanImports", "run"],
  },
  {
    id: "exportDiff",
    file: "export-diff.mjs",
    exports: ["diffExports", "exportDiff", "run"],
  },
  {
    id: "bind",
    file: "bind.mjs",
    exports: ["bind", "bindUsage", "run"],
  },
  {
    id: "unknown",
    file: "unknown.mjs",
    exports: ["applyUnknownPolicy", "collectReasonsFromDraft", "applyUnknownRules", "applyPartialRules", "applyUnknown", "run"],
  },
  {
    id: "prior",
    file: "prior.mjs",
    exports: ["run", "attachPrior", "replay", "correct", "correctPrior", "createPrior", "loadPrior"],
  },
]);

export async function loadSrcModules(srcRoot = resolveSrcRoot()) {
  const root = resolveSrcRoot(srcRoot);
  const stages = {};
  for (const spec of STAGE_SPECS) {
    stages[spec.id] = await loadStage(root, spec);
  }
  return {
    srcRoot: root,
    stages,
    status: Object.fromEntries(
      Object.entries(stages).map(([id, row]) => [
        id,
        {
          present: row.present,
          path: row.path,
          exportName: row.exportName,
          exportNames: Object.keys(row.extraExports || {}),
          error: row.error,
          code: row.code,
        },
      ]),
    ),
  };
}

async function loadStage(root, spec) {
  const path = join(root, spec.file);
  const base = {
    id: spec.id,
    file: spec.file,
    path,
    present: false,
    exportName: null,
    extraExports: {},
    fn: null,
    mod: null,
    error: null,
    code: null,
  };

  if (!existsSync(path)) {
    return { ...base, error: "module_not_found", code: "ERR_MODULE_NOT_FOUND" };
  }

  try {
    const mod = await import(pathToFileURL(path).href);
    const exportName = pickExport(mod, spec.exports);
    const extraExports = {};
    for (const [name, value] of Object.entries(mod)) {
      if (typeof value === "function") extraExports[name] = value;
    }
    if (typeof mod.default === "function" && !extraExports.default) {
      extraExports.default = mod.default;
    }
    if (!exportName && Object.keys(extraExports).length === 0) {
      return {
        ...base,
        present: true,
        mod,
        extraExports,
        error: `no callable export (tried ${spec.exports.join(", ")})`,
        code: "no_callable_export",
      };
    }
    return {
      ...base,
      present: true,
      mod,
      exportName: exportName || "default",
      extraExports,
      fn: exportName ? mod[exportName] : extraExports.default,
      error: null,
      code: null,
    };
  } catch (error) {
    return {
      ...base,
      present: true,
      error: error instanceof Error ? error.message : String(error),
      code: error?.code || "import_failed",
    };
  }
}

function pickExport(mod, names) {
  for (const name of names) {
    if (typeof mod[name] === "function") return name;
  }
  if (typeof mod.default === "function") return "default";
  return null;
}

export function missingModuleReasons(loaded) {
  const reasons = [];
  for (const spec of STAGE_SPECS) {
    const row = loaded.stages[spec.id];
    if (!row?.present) reasons.push(`missing_module:src/${spec.file}`);
    else if (row.error) reasons.push(`module_error:src/${spec.file}:${row.code || "error"}`);
  }
  return reasons;
}

export function missingModuleLimitations(loaded) {
  const lines = [];
  for (const spec of STAGE_SPECS) {
    const row = loaded.stages[spec.id];
    if (!row?.present) {
      lines.push(`src/${spec.file} not present; ${spec.id} stage skipped`);
    } else if (row.error) {
      lines.push(`src/${spec.file} present but unusable (${row.error})`);
    }
  }
  return lines;
}
