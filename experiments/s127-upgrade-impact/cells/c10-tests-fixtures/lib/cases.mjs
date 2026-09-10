import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tryReadJson } from "./fs-utils.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const CELL_ROOT = join(here, "..");
export const PACK_ROOT = join(CELL_ROOT, "../..");
export const SYNTHETIC_ROOT = join(PACK_ROOT, "fixtures/synthetic");

export function loadManifest(syntheticRoot = SYNTHETIC_ROOT) {
  const loaded = tryReadJson(join(syntheticRoot, "MANIFEST.json"));
  if (!loaded.ok) throw new Error(`synthetic MANIFEST.json missing: ${loaded.code}`);
  return loaded.body;
}

export function listCaseIds(syntheticRoot = SYNTHETIC_ROOT) {
  const dir = join(syntheticRoot, "cases");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.replace(/\.json$/, ""))
    .sort();
}

export function loadCaseSpec(id, syntheticRoot = SYNTHETIC_ROOT) {
  const loaded = tryReadJson(join(syntheticRoot, "cases", `${id}.json`));
  if (!loaded.ok) throw new Error(`case ${id} not found: ${loaded.code}`);
  return loaded.body;
}

function resolveFromSynthetic(syntheticRoot, rel) {
  if (!rel) return null;
  return join(syntheticRoot, rel);
}

export function caseToInput(spec, { syntheticRoot = SYNTHETIC_ROOT, packRoot = PACK_ROOT } = {}) {
  const resolve = (rel) => resolveFromSynthetic(syntheticRoot, rel);
  return {
    clock: spec.clock,
    createdAt: spec.clock,
    evidenceClass: spec.evidenceClass || spec.label || "synthetic",
    baseDir: syntheticRoot,
    packRoot,
    caller: {
      root: resolve(spec.caller.root),
      manifestPath: resolve(spec.caller.manifestPath),
      lockfilePath: spec.caller.lockfilePath ? resolve(spec.caller.lockfilePath) : null,
      sourceRoots: (spec.caller.sourceRoots || []).map(resolve),
      evidenceClass: spec.evidenceClass || spec.label || "synthetic",
    },
    dependency: {
      name: spec.dependency.name,
      oldVersion: spec.dependency.oldVersion,
      newVersion: spec.dependency.newVersion,
      oldTree: resolve(spec.dependency.oldTree),
      newTree: resolve(spec.dependency.newTree),
    },
    priorPath: spec.priorPath ? resolve(spec.priorPath) : null,
  };
}

export function loadSyntheticCase(id, options) {
  const syntheticRoot = options?.syntheticRoot || SYNTHETIC_ROOT;
  const spec = loadCaseSpec(id, syntheticRoot);
  return {
    spec,
    input: caseToInput(spec, { syntheticRoot, packRoot: options?.packRoot || PACK_ROOT }),
  };
}
