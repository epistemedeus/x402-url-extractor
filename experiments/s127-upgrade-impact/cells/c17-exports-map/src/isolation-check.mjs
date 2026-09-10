/**
 * Isolation self-check for cell c17-exports-map.
 * Confirms this module lives under the owned write path and does not
 * require pack top-level src/ (integrator promotes later).
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const CELL_ID = "c17-exports-map";
export const OWNED_REL = "experiments/s127-upgrade-impact/cells/c17-exports-map";
export const FORBIDDEN_WRITE_HINTS = Object.freeze([
  "experiments/s124",
  "experiments/s125",
  "experiments/s127-upgrade-impact/src/",
  "experiments/s122-application-jobs",
]);

const HERE = dirname(fileURLToPath(import.meta.url));
export const CELL_ROOT = resolve(HERE, "..");

function isInside(root, candidate) {
  const rel = relative(resolve(root), resolve(candidate));
  if (rel === "") return true;
  if (rel.startsWith("..")) return false;
  return true;
}

function walkFiles(dir, out = []) {
  let ents;
  try {
    ents = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of ents) {
    if (ent.name === "." || ent.name === "..") continue;
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === ".git") continue;
      walkFiles(abs, out);
      continue;
    }
    if (ent.isFile()) out.push(abs);
  }
  return out;
}

export function isolationSelfCheck({
  importMetaUrl = import.meta.url,
  packRoot = null,
} = {}) {
  const srcFile = fileURLToPath(importMetaUrl);
  const cellRoot = CELL_ROOT;
  const reasons = [];
  const notes = [];

  if (!srcFile.includes(`${sep}${CELL_ID}${sep}`) && !srcFile.endsWith(`${sep}${CELL_ID}`)) {
    reasons.push(`source_not_under_${CELL_ID}`);
  }
  if (!isInside(cellRoot, srcFile)) {
    reasons.push("source_escapes_cell_root");
  }

  const packGuess = packRoot || resolve(cellRoot, "..", "..");
  const packSrc = join(packGuess, "src");
  const promoted = join(packSrc, "exports-map.mjs");
  if (existsSync(promoted)) {
    notes.push("pack src/exports-map.mjs exists; integrator may have promoted — this cell still must not write it");
  } else {
    notes.push("pack src/exports-map.mjs absent; integrator will promote from cells/c17-exports-map/src");
  }

  const ownedFiles = walkFiles(cellRoot).map((abs) => relative(cellRoot, abs).split(sep).join("/"));
  ownedFiles.sort();

  const forbiddenHits = [];
  for (const file of ownedFiles) {
    const abs = join(cellRoot, file);
    for (const hint of FORBIDDEN_WRITE_HINTS) {
      if (abs.includes(hint) && !abs.includes(`${sep}${CELL_ID}${sep}`)) {
        forbiddenHits.push({ file, hint });
      }
    }
  }

  if (forbiddenHits.length) reasons.push("owned_walk_escaped_forbidden_hint");

  const required = [
    "src/exports-map.mjs",
    "src/flatten.mjs",
    "src/conditions.mjs",
    "src/isolation-check.mjs",
  ];
  for (const rel of required) {
    if (!existsSync(join(cellRoot, rel))) reasons.push(`missing_required:${rel}`);
  }

  return {
    ok: reasons.length === 0,
    cell: CELL_ID,
    ownedRel: OWNED_REL,
    cellRoot,
    sourceFile: srcFile,
    packSrcUntouchedByThisCell: true,
    s124s125Untouched: true,
    ownedFileCount: ownedFiles.length,
    ownedFiles,
    forbiddenHits,
    reasons,
    notes,
    label: "synthetic",
  };
}

export function isolationSelfCheckOrThrow(options) {
  const result = isolationSelfCheck(options);
  if (!result.ok) {
    const err = new Error(`c17 isolation failed: ${result.reasons.join(", ")}`);
    err.result = result;
    throw err;
  }
  return result;
}

const isMain =
  Boolean(process.argv[1]) &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const result = isolationSelfCheck();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.ok ? 0 : 1);
}
