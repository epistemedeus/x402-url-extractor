import { lstatSync, readlinkSync } from "node:fs";
import path from "node:path";

export const OWNED_REL = "experiments/s127-upgrade-impact/cells/c18-dts-surface";

const WINDOWS_DRIVE_RE = /^[a-zA-Z]:[\\/]/;
const UNC_RE = /^[\\/]{2}[^\\/]/;
const URL_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const PERCENT_DOT_RE = /%(?:2e|2E|2f|2F|5c|5C)/;

export function isInsideRoot(root, candidateAbs) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidateAbs);
  const rel = path.relative(resolvedRoot, resolved);
  if (rel === "") return true;
  if (path.isAbsolute(rel)) return false;
  if (rel === "..") return false;
  if (rel.startsWith(`..${path.sep}`)) return false;
  return true;
}

export function posixRel(from, to) {
  const rel = path.relative(from, to);
  return rel.split(path.sep).join("/");
}

/**
 * Inspect a package-relative path. Does not touch the filesystem.
 * Never treats a traversal as readable.
 */
export function inspectRelPath(packageRoot, field, value) {
  if (typeof value !== "string") {
    return fail(field, value, "not_string");
  }
  if (value.includes("\0")) return fail(field, value, "nul_byte");
  if (WINDOWS_DRIVE_RE.test(value)) return fail(field, value, "windows_drive");
  if (UNC_RE.test(value)) return fail(field, value, "unc_path");
  if (value.startsWith("~") || value.startsWith("$HOME") || value.includes("${HOME}")) {
    return fail(field, value, "home_prefix");
  }
  if (URL_SCHEME_RE.test(value) && !value.startsWith("./") && !value.startsWith("../")) {
    return fail(field, value, "url_scheme");
  }
  if (PERCENT_DOT_RE.test(value)) return fail(field, value, "percent_encoded");
  if (path.isAbsolute(value)) return fail(field, value, "absolute_path");

  const resolved = path.resolve(packageRoot, value);
  if (!isInsideRoot(packageRoot, resolved)) {
    return fail(field, value, "escapes_package_root");
  }
  return { ok: true, resolved, field, value };
}

/**
 * lstat-only symlink check. Never fs.realpath. Refuse escaping targets.
 */
export function inspectExistingPath(packageRoot, absPath) {
  let st;
  try {
    st = lstatSync(absPath);
  } catch {
    return { ok: false, reason: "missing", path: absPath };
  }
  if (st.isSymbolicLink()) {
    let target;
    try {
      target = readlinkSync(absPath);
    } catch {
      return { ok: false, reason: "symlink_unreadable", path: absPath };
    }
    const absTarget = path.resolve(path.dirname(absPath), String(target));
    if (!isInsideRoot(packageRoot, absTarget)) {
      return {
        ok: false,
        reason: "symlink_escape",
        path: absPath,
        target: String(target),
      };
    }
    return { ok: true, symlink: true, path: absPath, resolvedTarget: absTarget, stat: st };
  }
  if (!isInsideRoot(packageRoot, absPath)) {
    return { ok: false, reason: "escapes_package_root", path: absPath };
  }
  return { ok: true, symlink: false, path: absPath, stat: st };
}

function fail(field, value, reason) {
  return { ok: false, reason, field, value, decision: "unknown" };
}
