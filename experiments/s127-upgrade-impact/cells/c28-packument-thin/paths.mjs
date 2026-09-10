/**
 * Package-name, registry URL, and fixture-path confinement.
 * Never follows symlinks. Never includes credentials in URLs.
 */

import { lstatSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  DEFAULT_REGISTRY,
  MAX_URL_LENGTH,
} from "./constants.mjs";

export class PackumentError extends Error {
  constructor(message, code = "invalid_input") {
    super(message);
    this.name = "PackumentError";
    this.code = code;
  }
}

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

export function assertSafePackageName(name) {
  if (typeof name !== "string" || !name.trim() || name !== name.trim()) {
    throw new PackumentError("name must be a non-empty trimmed npm package name", "invalid_name");
  }
  if (name.length > 214 || name.includes("\\") || name.includes("..") || name.includes("\0")) {
    throw new PackumentError(`refusing package name: ${name}`, "invalid_name");
  }
  if (!/^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/.test(name)) {
    throw new PackumentError(`refusing package name: ${name}`, "invalid_name");
  }
  return name;
}

export function assertExactVersion(version) {
  if (typeof version !== "string" || !version.trim() || version !== version.trim()) {
    throw new PackumentError("version must be a non-empty trimmed exact version", "invalid_version");
  }
  if (/[\s\\]/.test(version) || version.includes("\0") || version.includes("..")) {
    throw new PackumentError(`refusing version: ${version}`, "invalid_version");
  }
  if (/^[~^<>*=]|x|X|\|\||latest|next|^v/i.test(version)) {
    throw new PackumentError(`version ranges and tags are not selected: ${version}`, "invalid_version");
  }
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new PackumentError(`version is not an exact semver: ${version}`, "invalid_version");
  }
  return version;
}

export function encodePackageNameForRegistryPath(name) {
  const safe = assertSafePackageName(name);
  if (safe.startsWith("@")) {
    const slash = safe.indexOf("/");
    if (slash === -1) {
      throw new PackumentError(`scoped package name is missing a slash: ${safe}`, "invalid_name");
    }
    return `${safe.slice(0, slash)}%2f${encodeURIComponent(safe.slice(slash + 1))}`;
  }
  return encodeURIComponent(safe);
}

export function stripTrailingSlash(url) {
  return String(url).replace(/\/+$/, "");
}

export function parseRegistryOrigin(registry, { allowHttpLocalhost = true } = {}) {
  let url;
  try {
    url = new URL(registry);
  } catch {
    throw new PackumentError(`registry is not a URL: ${registry}`, "url_not_allowlisted");
  }
  if (url.username || url.password) {
    throw new PackumentError("registry URL must not include credentials", "url_not_allowlisted");
  }
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol === "https:") {
    // ok
  } else if (url.protocol === "http:" && allowHttpLocalhost && local) {
    // tests / mounted origin only
  } else {
    throw new PackumentError(`registry must be https (http only for localhost): ${registry}`, "url_not_allowlisted");
  }
  return url.origin;
}

export function packumentUrl(registry, name) {
  const base = stripTrailingSlash(registry);
  return `${base}/${encodePackageNameForRegistryPath(name)}`;
}

export function versionDocumentUrl(registry, name, version) {
  const base = stripTrailingSlash(registry);
  return `${base}/${encodePackageNameForRegistryPath(name)}/${encodeURIComponent(assertExactVersion(version))}`;
}

export function isAllowedSourceUrl(candidate, registry = DEFAULT_REGISTRY) {
  if (typeof candidate !== "string" || !candidate || candidate.length > MAX_URL_LENGTH) return false;
  if (/[\s\\]/.test(candidate) || candidate.includes("\0")) return false;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash) return false;
  if (!["http:", "https:"].includes(url.protocol)) return false;
  let origin;
  try {
    origin = parseRegistryOrigin(registry);
  } catch {
    return false;
  }
  return url.origin === origin;
}

export function confineToRoot(maybePath, root) {
  if (typeof maybePath !== "string" || !maybePath.trim()) {
    return { ok: false, code: "missing_path", message: "path required" };
  }
  if (maybePath.includes("\0")) {
    return { ok: false, code: "nul_byte", message: "nul byte in path" };
  }
  const resolved = isAbsolute(maybePath) ? resolve(maybePath) : resolve(root, maybePath);
  if (!isInsideRoot(root, resolved)) {
    return {
      ok: false,
      code: "path_escape",
      message: `path escapes fixture root: ${maybePath}`,
      path: resolved,
    };
  }
  return { ok: true, path: resolved };
}

export function inspectRegularFile(path) {
  if (typeof path !== "string" || path.includes("\0")) {
    return { ok: false, code: "nul_byte", message: "nul byte in path", path };
  }
  let st;
  try {
    st = lstatSync(path);
  } catch {
    return { ok: false, code: "not_found", message: `path not found: ${path}`, path };
  }
  if (st.isSymbolicLink()) {
    return { ok: false, code: "symlink_refused", message: `symlink refused: ${path}`, path };
  }
  if (!st.isFile()) {
    return { ok: false, code: "not_a_file", message: `regular file required: ${path}`, path };
  }
  return { ok: true, path, size: st.size };
}

export function resolveFixturePath(maybePath, fixtureRoot, { confineRelative = true } = {}) {
  if (typeof maybePath !== "string" || !maybePath.trim()) {
    return { ok: false, code: "missing_path", message: "path required" };
  }
  if (maybePath.includes("\0")) {
    return { ok: false, code: "nul_byte", message: "nul byte in path" };
  }
  if (!isAbsolute(maybePath) && confineRelative) {
    return confineToRoot(maybePath, fixtureRoot);
  }
  if (isAbsolute(maybePath) && fixtureRoot) {
    const abs = resolve(maybePath);
    if (isInsideRoot(fixtureRoot, abs)) return { ok: true, path: abs };
    // Operator-supplied absolute path outside the default fixture root is allowed
    // only as an explicit fixture file; still refuse NUL (checked) and later symlink.
    return { ok: true, path: abs, external: true };
  }
  const abs = isAbsolute(maybePath) ? resolve(maybePath) : join(fixtureRoot, maybePath);
  return { ok: true, path: abs };
}
