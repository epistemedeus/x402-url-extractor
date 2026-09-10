/**
 * pnpm dependency-path / specifier helpers for lockfile v6 and v9.
 *
 * v6 package keys: `/name@version` or `/@scope/name@version` plus optional
 * peer suffix `(peer@ver)(peer2@ver)`.
 * v9 package keys: `name@version` (no leading slash).
 *
 * Does not implement the full @pnpm/dependency-path package (many pnpm
 * internals). Peer/patch suffixes are recorded as opaque remainder.
 */

const NPM_ALIAS = /^npm:(@[^/]+\/[^@]+|[^@\s]+)(?:@(.+))?$/;
const WORKSPACE = /^workspace:(.*)$/;
const FILE_PROTO = /^(file|link|portal):(.*)$/i;
const GIT_PROTO = /^(git\+|git:|github:|gist:|bitbucket:|gitlab:|ssh:|https?:)/i;
const CATALOG = /^catalog:(.*)$/;
const BARE_VERSION = /^(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]*)?)(\(.*\))?$/;

export function classifyLockfileVersion(raw) {
  if (raw == null || raw === "") {
    return { family: "unknown", major: null, raw, reason: "missing_lockfile_version" };
  }
  const s = String(raw).trim();
  const m = s.match(/^(\d+)(?:\.(\d+))?/);
  if (!m) {
    return { family: "unknown", major: null, raw: s, reason: "unparsed_lockfile_version" };
  }
  const major = Number(m[1]);
  if (major === 9) return { family: "v9", major: 9, raw: s, reason: null };
  if (major === 6) return { family: "v6", major: 6, raw: s, reason: null };
  if (major === 7) {
    return { family: "v7", major: 7, raw: s, reason: "v7_alpha_lockfile_unknown" };
  }
  if (major === 5) {
    return { family: "v5", major: 5, raw: s, reason: "unsupported_lockfile_version" };
  }
  return { family: "unknown", major, raw: s, reason: "unsupported_lockfile_version" };
}

export function parseNpmAlias(spec) {
  if (typeof spec !== "string") return null;
  const trimmed = spec.trim();
  const m = trimmed.match(NPM_ALIAS);
  if (!m) return null;
  return {
    protocol: "npm",
    targetName: m[1],
    targetSpec: m[2] ?? null,
    raw: trimmed,
  };
}

export function parseWorkspaceSpec(spec) {
  if (typeof spec !== "string") return null;
  const trimmed = spec.trim();
  const m = trimmed.match(WORKSPACE);
  if (!m) return null;
  const inner = m[1];
  const rangeLike = inner === "" || inner === "*" || inner === "~" || inner === "^" || looksLikeRange(inner);
  const pathLike = inner.startsWith(".") || inner.includes("/");
  const alias = parseWorkspaceAlias(inner);
  return {
    protocol: "workspace",
    inner,
    rangeLike,
    pathLike,
    path: pathLike ? inner : null,
    alias,
    raw: trimmed,
  };
}

function parseWorkspaceAlias(inner) {
  if (!inner || inner === "*" || inner === "~" || inner === "^") return null;
  if (inner.startsWith(".") || inner.startsWith("/")) return null;
  if (inner.startsWith("@")) {
    const idx = inner.indexOf("@", 1);
    if (idx === -1) return { name: inner, range: "*" };
    return { name: inner.slice(0, idx), range: inner.slice(idx + 1) || "*" };
  }
  const idx = inner.indexOf("@");
  if (idx <= 0) return null;
  if (looksLikeRange(inner) && idx === -1) return null;
  if (/^\d/.test(inner)) return null;
  return { name: inner.slice(0, idx), range: inner.slice(idx + 1) || "*" };
}

export function parseFileLinkSpec(spec) {
  if (typeof spec !== "string") return null;
  const trimmed = spec.trim();
  const m = trimmed.match(FILE_PROTO);
  if (!m) return null;
  return {
    protocol: m[1].toLowerCase(),
    path: m[2],
    raw: trimmed,
  };
}

export function parseCatalogSpec(spec) {
  if (typeof spec !== "string") return null;
  const trimmed = spec.trim();
  const m = trimmed.match(CATALOG);
  if (!m) return null;
  const name = m[1] === "" ? "default" : m[1];
  return { protocol: "catalog", catalog: name, raw: trimmed };
}

export function parseSpecifier(spec) {
  if (typeof spec !== "string") {
    return { kind: "missing", raw: spec ?? null };
  }
  const raw = spec.trim();
  if (!raw) return { kind: "missing", raw };
  const alias = parseNpmAlias(raw);
  if (alias) return { kind: "npm-alias", raw, alias };
  const workspace = parseWorkspaceSpec(raw);
  if (workspace) return { kind: "workspace", raw, workspace };
  const file = parseFileLinkSpec(raw);
  if (file) return { kind: "file", raw, file };
  const catalog = parseCatalogSpec(raw);
  if (catalog) return { kind: "catalog", raw, catalog };
  if (GIT_PROTO.test(raw)) return { kind: "remote", raw };
  if (raw === "*" || raw === "latest" || raw === "next" || raw === "canary") {
    return { kind: "dist-tag-or-star", raw };
  }
  if (isExactVersion(raw)) return { kind: "exact", raw, version: stripV(raw) };
  if (looksLikeRange(raw)) return { kind: "range", raw };
  return { kind: "other", raw };
}

export function isExactVersion(spec) {
  if (typeof spec !== "string") return false;
  const s = stripV(spec.trim());
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]*)?$/.test(s);
}

export function looksLikeRange(spec) {
  if (typeof spec !== "string") return false;
  const s = spec.trim();
  if (!s) return false;
  if (s === "*" || s === "x" || s === "X") return true;
  if (/^(latest|next|canary|beta|rc|alpha|dev|nightly)$/i.test(s)) return true;
  if (/^[~^><=]| \|\| | - /.test(s)) return true;
  if (s.includes(" - ")) return true;
  if (/\s/.test(s) && /[<>]/.test(s)) return true;
  if (/^\d+\.\d+\.x$/.test(s) || /^\d+\.x$/.test(s)) return true;
  return false;
}

export function stripV(version) {
  return version.startsWith("v") && /^\d/.test(version.slice(1)) ? version.slice(1) : version;
}

export function splitPeerSuffix(id) {
  if (typeof id !== "string") return { base: id, peers: null };
  const idx = id.indexOf("(");
  if (idx === -1) return { base: id, peers: null };
  return { base: id.slice(0, idx), peers: id.slice(idx) };
}

/**
 * Parse a packages/snapshots key.
 * @param {string} key
 * @param {"v6"|"v9"|"v5"|"v7"|"unknown"} family
 */
export function parsePackageKey(key, family = "v9") {
  if (typeof key !== "string" || !key) {
    return { ok: false, reason: "empty_key", raw: key };
  }
  const raw = key.trim();
  if (raw.startsWith("file:") || raw.startsWith("link:") || raw.startsWith("portal:")) {
    const file = parseFileLinkSpec(raw);
    return { ok: true, kind: "file", ...file, raw };
  }
  if (GIT_PROTO.test(raw) && !raw.includes("@")) {
    return { ok: true, kind: "remote", raw };
  }

  let rest = raw;
  let leadingSlash = false;
  if (rest.startsWith("/")) {
    leadingSlash = true;
    rest = rest.slice(1);
  }

  const { base, peers } = splitPeerSuffix(rest);
  const nv = splitNameAtVersion(base);
  if (!nv) {
    return {
      ok: false,
      reason: "unparsed_package_key",
      raw,
      leadingSlash,
      family,
      peers,
    };
  }
  return {
    ok: true,
    kind: "registry",
    name: nv.name,
    version: nv.version,
    peers,
    leadingSlash,
    family,
    raw,
    id: `${nv.name}@${nv.version}`,
  };
}

export function splitNameAtVersion(base) {
  if (typeof base !== "string" || !base) return null;
  if (base.startsWith("@")) {
    const idx = base.indexOf("@", 1);
    if (idx === -1) return null;
    const name = base.slice(0, idx);
    const version = base.slice(idx + 1);
    if (!name.includes("/") || !version) return null;
    return { name, version };
  }
  const idx = base.indexOf("@");
  if (idx <= 0) return null;
  return { name: base.slice(0, idx), version: base.slice(idx + 1) };
}

/**
 * Interpret an importer `version:` field (resolved ref).
 */
export function parseVersionRef(version, { importerName, specifier, family } = {}) {
  if (typeof version !== "string" || !version.trim()) {
    return { kind: "missing", raw: version ?? null };
  }
  const raw = version.trim();
  const file = parseFileLinkSpec(raw);
  if (file) {
    return { kind: file.protocol, path: file.path, raw };
  }
  if (GIT_PROTO.test(raw) && !/^[^@]+@\d/.test(raw) && !raw.startsWith("@")) {
    return { kind: "remote", raw };
  }

  const { base, peers } = splitPeerSuffix(raw);

  if (base.startsWith("@") || /[A-Za-z]/.test(base[0] || "")) {
    const nv = splitNameAtVersion(base);
    if (nv) {
      return {
        kind: "id",
        name: nv.name,
        version: nv.version,
        peers,
        raw,
        key: raw,
      };
    }
  }

  const bare = base.match(BARE_VERSION) || (/^\d/.test(base) ? { 1: base, 2: null } : null);
  if (bare) {
    const alias = parseNpmAlias(specifier);
    const name = alias?.targetName ?? importerName ?? null;
    return {
      kind: "bare",
      name,
      version: bare[1] ?? base,
      peers: peers ?? bare[2] ?? null,
      raw,
    };
  }

  return { kind: "unknown", raw };
}

export function packageLookupCandidates({ name, version, peers, family }) {
  const keys = [];
  if (!name || !version) return keys;
  const id = `${name}@${version}`;
  const withPeers = peers ? `${id}${peers}` : id;
  if (family === "v6") {
    keys.push(`/${withPeers}`, `/${id}`);
    if (peers) keys.push(withPeers, id);
  } else {
    keys.push(withPeers, id);
    keys.push(`/${withPeers}`, `/${id}`);
  }
  return unique(keys);
}

export function inspectRelativePath(pathStr) {
  if (typeof pathStr !== "string") {
    return { ok: false, reason: "not_string", decision: "unknown" };
  }
  if (pathStr.includes("\0")) {
    return { ok: false, reason: "nul_byte", decision: "unknown" };
  }
  const posix = pathStr.replace(/\\/g, "/");
  if (posix.startsWith("/") || /^[a-zA-Z]:\//.test(posix) || posix.startsWith("//")) {
    return { ok: false, reason: "absolute_path", path: posix, decision: "unknown" };
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(posix) && !posix.startsWith("./") && !posix.startsWith("../")) {
    return { ok: false, reason: "url_scheme", path: posix, decision: "unknown" };
  }
  const parts = posix.split("/");
  let depth = 0;
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      depth -= 1;
      if (depth < 0) {
        return { ok: false, reason: "escapes_root", path: posix, decision: "unknown" };
      }
      continue;
    }
    depth += 1;
  }
  return { ok: true, path: posix, decision: null };
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}
