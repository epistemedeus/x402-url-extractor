/**
 * Owned-path jail for c22-kill-harness.
 * Writes stay under this cell unless the operator explicitly allows a tmp out.
 */
import { existsSync, lstatSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

export const CELL_ID = "c22-kill-harness";
export const LIB_DIR = dirname(fileURLToPath(import.meta.url));
export const CELL_ROOT = resolve(LIB_DIR, "..");
export const PACK_ROOT = resolve(CELL_ROOT, "../..");
export const REPO_ROOT = resolve(PACK_ROOT, "../..");

export const FORBIDDEN_WRITE_ROOTS = Object.freeze([
  resolve(PACK_ROOT, "cells/c11-real-a"),
  resolve(PACK_ROOT, "cells/c12-real-b"),
  resolve(PACK_ROOT, "fixtures/real-a"),
  resolve(PACK_ROOT, "fixtures/real-b"),
  resolve(PACK_ROOT, "src"),
  resolve(PACK_ROOT, "scripts"),
  resolve(PACK_ROOT, "skills"),
  resolve(PACK_ROOT, "test"),
  resolve(REPO_ROOT, "experiments/s124-marketplace"),
  resolve(REPO_ROOT, "experiments/s125-pulse"),
]);

export function isInsideRoot(root, candidateAbs) {
  const resolvedRoot = resolve(root);
  const resolved = resolve(candidateAbs);
  const rel = relative(resolvedRoot, resolved);
  if (rel === "") return true;
  if (isAbsolute(rel)) return false;
  if (rel === "..") return false;
  if (rel.startsWith(`..${sep}`)) return false;
  return true;
}

export function assertNotSymlink(path) {
  let st;
  try {
    st = lstatSync(path);
  } catch {
    return { ok: true, path, missing: true };
  }
  if (st.isSymbolicLink()) {
    return { ok: false, code: "symlink_refused", path, message: `symlink refused: ${path}` };
  }
  return { ok: true, path, missing: false, isFile: st.isFile(), isDirectory: st.isDirectory(), size: st.size };
}

export function resolveUnderCell(maybeRelative) {
  if (typeof maybeRelative !== "string" || !maybeRelative.trim()) {
    return { ok: false, code: "missing_path", message: "path required" };
  }
  if (maybeRelative.includes("\0")) {
    return { ok: false, code: "nul_byte", message: "nul byte in path" };
  }
  const abs = isAbsolute(maybeRelative) ? resolve(maybeRelative) : resolve(CELL_ROOT, maybeRelative);
  return { ok: true, path: abs, insideCell: isInsideRoot(CELL_ROOT, abs) };
}

/**
 * Output jail: default writes must stay in this cell.
 * Tests may write to os.tmpdir() when allowTmp is true.
 * Never write into sibling cells, pack src, or S124/S125 trees.
 */
export function assertWritableOut(path, { allowTmp = false } = {}) {
  const resolved = resolve(path);
  const link = assertNotSymlink(dirname(resolved));
  if (!link.ok) return link;

  for (const forbidden of FORBIDDEN_WRITE_ROOTS) {
    if (existsSync(forbidden) && isInsideRoot(forbidden, resolved)) {
      return {
        ok: false,
        code: "forbidden_write_root",
        path: resolved,
        message: `refusing write under forbidden root ${forbidden}`,
      };
    }
  }

  if (isInsideRoot(CELL_ROOT, resolved)) {
    return { ok: true, path: resolved, zone: "cell" };
  }
  if (allowTmp && isInsideRoot(resolve(tmpdir()), resolved)) {
    return { ok: true, path: resolved, zone: "tmpdir" };
  }
  return {
    ok: false,
    code: "out_escapes_cell",
    path: resolved,
    message: `refusing --out outside ${CELL_ID}: ${resolved}`,
  };
}

export function cellJoin(...parts) {
  return join(CELL_ROOT, ...parts);
}
