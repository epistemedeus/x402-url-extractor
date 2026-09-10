/**
 * Isolation helpers for c18: path jail, no lifecycle execution, owned writes.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isInsideRoot } from "./lib/paths.mjs";
import { inspectRelPath } from "./lib/paths.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const CELL_ROOT = HERE;
export const OWNED_WRITE_ROOT = HERE;

export function listFilesRecursive(root = CELL_ROOT) {
  const out = [];
  const stack = [resolve(root)];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === "node_modules" || ent.name === ".git") continue;
        stack.push(full);
      } else if (ent.isFile()) {
        out.push(full);
      }
    }
  }
  out.sort();
  return out;
}

export function assertOwnedWrites(files, ownedRoot = OWNED_WRITE_ROOT) {
  const escapes = [];
  for (const file of files) {
    if (!isInsideRoot(ownedRoot, file)) escapes.push(file);
  }
  return { ok: escapes.length === 0, escapes, ownedRoot };
}

export function scriptRanMarkerPath(packageRoot) {
  return join(packageRoot, "SCRIPT_RAN.marker");
}

export function assertNoScriptRan(packageRoot) {
  const marker = scriptRanMarkerPath(packageRoot);
  return {
    ok: !existsSync(marker),
    marker,
    existed: existsSync(marker),
  };
}

export function refuseEscapingTypesField(packageRoot, typesValue) {
  return inspectRelPath(packageRoot, "types", typesValue);
}

export function cellFileCount() {
  return listFilesRecursive(CELL_ROOT).length;
}

export function ownedPathCheck(absPath) {
  return isInsideRoot(CELL_ROOT, absPath);
}

export function isolationSnapshot() {
  const files = listFilesRecursive(CELL_ROOT);
  const owned = assertOwnedWrites(files, CELL_ROOT);
  return {
    cellRoot: CELL_ROOT,
    fileCount: files.length,
    ownedWritesOk: owned.ok,
    escapes: owned.escapes,
    cwd: process.cwd(),
    noDaemon: true,
    noNpmInstall: true,
    claimsFullChecker: false,
  };
}
