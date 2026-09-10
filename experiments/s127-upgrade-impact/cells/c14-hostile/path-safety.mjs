/**
 * Path-safety helpers for untrusted package manifests.
 * Never follow realpath; never read a target that escapes packageRoot.
 */

import path from "node:path";

export const TRAVERSAL_REASONS = Object.freeze({
  nul_byte: "nul_byte",
  absolute_path: "absolute_path",
  windows_drive: "windows_drive",
  unc_path: "unc_path",
  home_prefix: "home_prefix",
  url_scheme: "url_scheme",
  percent_encoded: "percent_encoded",
  escapes_package_root: "escapes_package_root",
  unicode_dot_segments: "unicode_dot_segments",
});

const URL_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const WINDOWS_DRIVE_RE = /^[a-zA-Z]:[\\/]/;
const UNC_RE = /^[\\/]{2}[^\\/]/;
const PERCENT_DOT_RE = /%(?:2e|2E|2f|2F|5c|5C)/;
const UNICODE_DOT_RE = /[\u2024\uFF0E\u3002]{2}|．．/;

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

export function decodePathCandidate(value) {
  if (typeof value !== "string") return { ok: false, reason: "not_string" };
  if (value.includes("\0")) return { ok: false, reason: TRAVERSAL_REASONS.nul_byte, decoded: value };
  let decoded = value;
  try {
    if (PERCENT_DOT_RE.test(value) || /%[0-9a-fA-F]{2}/.test(value)) {
      decoded = decodeURIComponent(value);
    }
  } catch {
    return { ok: false, reason: TRAVERSAL_REASONS.percent_encoded, decoded: value };
  }
  if (decoded.includes("\0")) return { ok: false, reason: TRAVERSAL_REASONS.nul_byte, decoded };
  return { ok: true, decoded, nfkc: decoded.normalize("NFKC") };
}

/**
 * Inspect a single manifest path string. Does not touch the filesystem.
 * @returns {{ ok: true, resolved: string } | { ok: false, kind: "path_traversal", reason: string, field: string, value: string, decision: "invalid" }}
 */
export function inspectManifestPath(packageRoot, field, value) {
  if (typeof value !== "string") {
    return { ok: false, kind: "path_traversal", reason: "not_string", field, value, decision: "invalid" };
  }

  if (value.includes("\0")) {
    return fail(field, value, TRAVERSAL_REASONS.nul_byte);
  }
  if (WINDOWS_DRIVE_RE.test(value)) {
    return fail(field, value, TRAVERSAL_REASONS.windows_drive);
  }
  if (UNC_RE.test(value)) {
    return fail(field, value, TRAVERSAL_REASONS.unc_path);
  }
  if (value.startsWith("~") || value.startsWith("$HOME") || value.includes("${HOME}")) {
    return fail(field, value, TRAVERSAL_REASONS.home_prefix);
  }
  if (URL_SCHEME_RE.test(value) && !value.startsWith("./") && !value.startsWith("../")) {
    // Relative paths like "./foo.js" have no scheme. file:/http:/node: are hostile here.
    return fail(field, value, TRAVERSAL_REASONS.url_scheme);
  }
  if (PERCENT_DOT_RE.test(value)) {
    const decoded = decodePathCandidate(value);
    if (!decoded.ok) return fail(field, value, decoded.reason);
    const inner = inspectManifestPath(packageRoot, field, decoded.decoded);
    if (!inner.ok) return fail(field, value, TRAVERSAL_REASONS.percent_encoded);
  }
  if (UNICODE_DOT_RE.test(value) || UNICODE_DOT_RE.test(value.normalize("NFKC"))) {
    const nfkc = value.normalize("NFKC");
    if (nfkc.includes("..")) {
      return fail(field, value, TRAVERSAL_REASONS.unicode_dot_segments);
    }
  }

  if (path.isAbsolute(value)) {
    return fail(field, value, TRAVERSAL_REASONS.absolute_path);
  }

  const resolved = path.resolve(packageRoot, value);
  if (!isInsideRoot(packageRoot, resolved)) {
    return fail(field, value, TRAVERSAL_REASONS.escapes_package_root);
  }

  const nfkc = value.normalize("NFKC");
  if (nfkc !== value) {
    const resolvedNfkc = path.resolve(packageRoot, nfkc);
    if (!isInsideRoot(packageRoot, resolvedNfkc)) {
      return fail(field, value, TRAVERSAL_REASONS.unicode_dot_segments);
    }
  }

  return { ok: true, resolved };
}

export function inspectExportKey(packageRoot, key) {
  if (typeof key !== "string") {
    return fail("exports.key", key, "not_string");
  }
  if (key === "." || key === "./") return { ok: true, resolved: packageRoot };
  // Subpath export keys must start with '.' per Node; anything else is still inspected.
  if (key.startsWith("/") || WINDOWS_DRIVE_RE.test(key) || UNC_RE.test(key)) {
    return fail("exports.key", key, TRAVERSAL_REASONS.absolute_path);
  }
  if (key.includes("\0")) return fail("exports.key", key, TRAVERSAL_REASONS.nul_byte);
  if (key === ".." || key.startsWith("../") || key.includes("/../") || key.endsWith("/..")) {
    return fail("exports.key", key, TRAVERSAL_REASONS.escapes_package_root);
  }
  if (key.startsWith("./") || key.startsWith(".")) {
    return inspectManifestPath(packageRoot, "exports.key", key);
  }
  return { ok: true, resolved: null };
}

/**
 * lstat-only symlink inspection. Never fs.realpath / never read the target
 * when it escapes packageRoot.
 */
export function inspectSymlinkTarget(packageRoot, linkPath, target) {
  if (typeof target !== "string" || target.includes("\0")) {
    return {
      ok: false,
      kind: "symlink_escape",
      reason: TRAVERSAL_REASONS.nul_byte,
      path: linkPath,
      target,
      decision: "invalid",
    };
  }
  const absTarget = path.resolve(path.dirname(linkPath), target);
  if (!isInsideRoot(packageRoot, absTarget)) {
    return {
      ok: false,
      kind: "symlink_escape",
      reason: TRAVERSAL_REASONS.escapes_package_root,
      path: linkPath,
      target,
      resolvedTarget: absTarget,
      decision: "invalid",
    };
  }
  return {
    ok: true,
    kind: "symlink_internal",
    path: linkPath,
    target,
    resolvedTarget: absTarget,
  };
}

function fail(field, value, reason) {
  return {
    ok: false,
    kind: "path_traversal",
    reason,
    field,
    value,
    decision: "invalid",
  };
}
