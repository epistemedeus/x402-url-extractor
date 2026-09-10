/**
 * S127 c02 — caller dependency identity from package.json + lockfile.
 *
 * Offline. Direct declared names only. A resolved identity is not an upgrade
 * action. Alias / workspace / lockfile disagreement → unknown + structured
 * conflict. Unsupported lockfile formats stay unknown.
 *
 * Schema: s127.upgrade-impact.lockfile.v1
 */

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export const SCHEMA = "s127.upgrade-impact.lockfile.v1";
export const MAX_LOCKFILE_BYTES = 8 * 1024 * 1024;

export const SUPPORTED_LOCKFILE_KINDS = Object.freeze([
  "npm-lock",
  "npm-shrinkwrap",
  "pnpm",
  "yarn-v1",
  "yarn-berry",
]);

export const PARTIAL_LOCKFILE_KINDS = Object.freeze(["bun-lock"]);

export const UNSUPPORTED_LOCKFILE_KINDS = Object.freeze([
  "bun-binary",
  "cargo",
  "poetry",
  "composer",
  "bundler",
  "yarn-unknown",
  "unknown",
]);

export const DEP_TYPES = Object.freeze([
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
  "devDependencies",
]);

const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const LOCKFILE_FILENAMES = Object.freeze([
  "npm-shrinkwrap.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "pnpm-lock.yml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
]);

const SEMVER_RE =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

// ---------------------------------------------------------------------------
// Hash / clock / IO
// ---------------------------------------------------------------------------

export function sha256Hex(value) {
  const buf = typeof value === "string" || Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return createHash("sha256").update(buf).digest("hex");
}

function isoClock(clock) {
  if (typeof clock === "string" && clock.trim()) return clock.trim();
  return new Date().toISOString();
}

function lstatOrNull(path) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

export function readBoundedFile(path, { maxBytes = MAX_LOCKFILE_BYTES } = {}) {
  if (!path || typeof path !== "string") {
    return { ok: false, code: "missing_path", message: "path required" };
  }
  const st = lstatOrNull(path);
  if (!st) return { ok: false, code: "missing_path", message: `path not found: ${path}`, path };
  if (st.isSymbolicLink()) {
    return { ok: false, code: "symlink_refused", message: `symlink refused: ${path}`, path };
  }
  if (!st.isFile()) {
    return { ok: false, code: "not_a_file", message: `regular file required: ${path}`, path };
  }
  if (st.size > maxBytes) {
    return {
      ok: false,
      code: "oversize",
      message: `file exceeds ${maxBytes} byte budget: ${path}`,
      path,
      bytes: st.size,
    };
  }
  let buf;
  try {
    buf = readFileSync(path);
  } catch (err) {
    return { ok: false, code: "unreadable", message: err.message, path };
  }
  return {
    ok: true,
    path,
    bytes: buf.length,
    sha256: sha256Hex(buf),
    text: buf.toString("utf8"),
  };
}

function provenanceRecord({ path, sha256, bytes, retrievedAt, label, coverage }) {
  return {
    path: path || null,
    retrievedAt,
    contentSha256: sha256 || null,
    bytes: bytes ?? null,
    coverage: coverage || "full-file",
    label: label || "synthetic",
  };
}

function emptyPlain() {
  return Object.create(null);
}

function setPlain(obj, key, value) {
  if (key == null) return obj;
  const k = String(key);
  if (DANGEROUS_KEYS.has(k)) return obj;
  obj[k] = value;
  return obj;
}

function asPlain(value) {
  if (Array.isArray(value)) return value.map(asPlain);
  if (value && typeof value === "object") {
    const out = emptyPlain();
    for (const [k, v] of Object.entries(value)) {
      if (DANGEROUS_KEYS.has(k)) continue;
      out[k] = asPlain(v);
    }
    return out;
  }
  return value;
}

function parseJsonText(text, path) {
  try {
    return { ok: true, value: asPlain(JSON.parse(text.replace(/^\uFEFF/, ""))) };
  } catch (err) {
    return { ok: false, code: "invalid_json", message: `not JSON (${path || "input"}): ${err.message}` };
  }
}

function stripJsonc(text) {
  let out = "";
  let i = 0;
  let q = null;
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (q) {
      out += c;
      if (c === "\\" && q === '"') {
        out += n || "";
        i += 2;
        continue;
      }
      if (c === q) q = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && n === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && n === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Semver (conservative; prerelease / unparsed → unknown)
// ---------------------------------------------------------------------------

export function parseSemver(version) {
  if (typeof version !== "string" || !version.trim()) return null;
  const match = version.trim().match(SEMVER_RE);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : [],
    raw: version.trim(),
  };
}

export function classifySemverDelta(before, after) {
  if (before == null && after == null) return "none";
  if (before === after) return "none";
  const left = parseSemver(before);
  const right = parseSemver(after);
  if (!left || !right) return "unknown";
  if (right.major !== left.major) return "major";
  if (right.minor !== left.minor) return "minor";
  if (right.patch !== left.patch) return "patch";
  return "none";
}

function cmpRelease(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  return 0;
}

function parsePartialVersion(expr) {
  const raw = String(expr || "")
    .trim()
    .replace(/^v/, "");
  if (!raw) return { ok: false };
  if (raw === "*" || raw === "x" || raw === "X") {
    return { ok: true, wildcard: "any" };
  }
  if (/-/.test(raw) && !/^\d+\.\d+\.\d+-/.test(raw)) {
    // hyphen in non-complete version: unknown (could be range leftover)
  }
  const prereleaseSplit = raw.split("-");
  const core = prereleaseSplit[0];
  const pre = prereleaseSplit.slice(1).join("-");
  const parts = core.split(".");
  if (parts.length > 3) return { ok: false };
  const nums = [];
  let wildcardAt = null;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === "x" || p === "X" || p === "*") {
      wildcardAt = i;
      break;
    }
    if (!/^\d+$/.test(p)) return { ok: false };
    nums.push(Number(p));
  }
  if (pre && wildcardAt != null) return { ok: false };
  if (pre && parts.length < 3) return { ok: false };
  return {
    ok: true,
    major: nums[0],
    minor: nums[1],
    patch: nums[2],
    filled: parts.length,
    wildcardAt,
    prerelease: pre || null,
  };
}

function asSemverTriple(p, fill = 0) {
  return {
    major: p.major ?? fill,
    minor: p.minor ?? fill,
    patch: p.patch ?? fill,
    prerelease: [],
    raw: `${p.major ?? fill}.${p.minor ?? fill}.${p.patch ?? fill}`,
  };
}

function combineSatisfaction(results) {
  let unknown = false;
  for (const r of results) {
    if (r.status === "unsatisfied") return r;
    if (r.status === "unknown") unknown = true;
  }
  if (unknown) return { status: "unknown", reason: "partial_range_parse" };
  return { status: "satisfied", reason: "all_comparators" };
}

function ge(v, other) {
  return cmpRelease(v, other) >= 0;
}
function gt(v, other) {
  return cmpRelease(v, other) > 0;
}
function lt(v, other) {
  return cmpRelease(v, other) < 0;
}
function le(v, other) {
  return cmpRelease(v, other) <= 0;
}

function satisfyCaret(v, expr) {
  const p = parsePartialVersion(expr);
  if (!p.ok) return { status: "unknown", reason: "caret_unparseable" };
  if (p.prerelease) return { status: "unknown", reason: "prerelease_in_range" };
  if (p.wildcard === "any") return { status: "satisfied", reason: "caret_any" };
  const major = p.major ?? 0;
  const minor = p.minor ?? 0;
  const patch = p.patch ?? 0;
  let lower;
  let upper;
  if (p.wildcardAt === 0 || p.filled === 0) {
    return { status: "satisfied", reason: "caret_any" };
  }
  if (p.wildcardAt === 1 || (p.filled === 1 && p.wildcardAt == null)) {
    lower = { major, minor: 0, patch: 0, prerelease: [] };
    upper = { major: major + 1, minor: 0, patch: 0, prerelease: [] };
  } else if (p.wildcardAt === 2 || (p.filled === 2 && p.wildcardAt == null)) {
    lower = { major, minor, patch: 0, prerelease: [] };
    if (major === 0) {
      upper = { major, minor: minor + 1, patch: 0, prerelease: [] };
    } else {
      upper = { major: major + 1, minor: 0, patch: 0, prerelease: [] };
    }
  } else {
    lower = { major, minor, patch, prerelease: [] };
    if (major !== 0) {
      upper = { major: major + 1, minor: 0, patch: 0, prerelease: [] };
    } else if (minor !== 0) {
      upper = { major: 0, minor: minor + 1, patch: 0, prerelease: [] };
    } else {
      upper = { major: 0, minor: 0, patch: patch + 1, prerelease: [] };
    }
  }
  if (ge(v, lower) && lt(v, upper)) return { status: "satisfied", reason: "caret" };
  return { status: "unsatisfied", reason: "caret" };
}

function satisfyTilde(v, expr) {
  const p = parsePartialVersion(expr);
  if (!p.ok) return { status: "unknown", reason: "tilde_unparseable" };
  if (p.prerelease) return { status: "unknown", reason: "prerelease_in_range" };
  if (p.wildcard === "any") return { status: "satisfied", reason: "tilde_any" };
  const major = p.major ?? 0;
  const minor = p.minor ?? 0;
  const patch = p.patch ?? 0;
  let lower;
  let upper;
  if (p.filled === 1 || p.wildcardAt === 1) {
    lower = { major, minor: 0, patch: 0, prerelease: [] };
    upper = { major: major + 1, minor: 0, patch: 0, prerelease: [] };
  } else if (p.filled === 2 || p.wildcardAt === 2) {
    lower = { major, minor, patch: 0, prerelease: [] };
    upper = { major, minor: minor + 1, patch: 0, prerelease: [] };
  } else {
    lower = { major, minor, patch, prerelease: [] };
    upper = { major, minor: minor + 1, patch: 0, prerelease: [] };
  }
  if (ge(v, lower) && lt(v, upper)) return { status: "satisfied", reason: "tilde" };
  return { status: "unsatisfied", reason: "tilde" };
}

function satisfyEqPartial(v, p) {
  if (p.wildcard === "any") return { status: "satisfied", reason: "any" };
  if (p.wildcardAt === 0) return { status: "satisfied", reason: "any" };
  if (p.wildcardAt === 1 || (p.filled === 1 && p.wildcardAt == null)) {
    const lower = { major: p.major, minor: 0, patch: 0, prerelease: [] };
    const upper = { major: p.major + 1, minor: 0, patch: 0, prerelease: [] };
    if (ge(v, lower) && lt(v, upper)) return { status: "satisfied", reason: "partial" };
    return { status: "unsatisfied", reason: "partial" };
  }
  if (p.wildcardAt === 2 || (p.filled === 2 && p.wildcardAt == null)) {
    const lower = { major: p.major, minor: p.minor, patch: 0, prerelease: [] };
    const upper = { major: p.major, minor: p.minor + 1, patch: 0, prerelease: [] };
    if (ge(v, lower) && lt(v, upper)) return { status: "satisfied", reason: "partial" };
    return { status: "unsatisfied", reason: "partial" };
  }
  const other = asSemverTriple(p);
  return { status: cmpRelease(v, other) === 0 ? "satisfied" : "unsatisfied", reason: "exact" };
}

function satisfyComparator(v, op, versionExpr) {
  const expr = String(versionExpr || "")
    .trim()
    .replace(/^v/, "");
  if (op === "^") return satisfyCaret(v, expr);
  if (op === "~") return satisfyTilde(v, expr);
  const p = parsePartialVersion(expr);
  if (!p.ok) return { status: "unknown", reason: "unparseable_comparator_version" };
  if (p.prerelease) return { status: "unknown", reason: "prerelease_in_range" };
  if (op === "=" || op === "") return satisfyEqPartial(v, p);
  const lowerFilled = asSemverTriple({
    major: p.major ?? 0,
    minor: p.minor ?? 0,
    patch: p.patch ?? 0,
  });
  if (p.wildcard === "any") {
    if (op === ">" || op === "<") return { status: "unsatisfied", reason: "compare_any" };
    return { status: "satisfied", reason: "any" };
  }
  // >=1.2 means >=1.2.0; >1.2 is unknown-ish in npm (treat as >1.2.0 with partial → unknown if incomplete)
  if ((op === ">" || op === "<") && p.filled != null && p.filled < 3 && p.wildcardAt == null) {
    return { status: "unknown", reason: "partial_strict_compare" };
  }
  if (op === ">=") return { status: ge(v, lowerFilled) ? "satisfied" : "unsatisfied", reason: ">=" };
  if (op === "<=") {
    let upper = lowerFilled;
    if (p.filled === 1) upper = { major: p.major, minor: 0, patch: 0, prerelease: [] };
    if (p.filled === 2) upper = { major: p.major, minor: p.minor, patch: 0, prerelease: [] };
    // <=1.2.3 standard; <=1.2 means <1.3.0
    if (p.filled === 1) {
      return { status: lt(v, { major: p.major + 1, minor: 0, patch: 0, prerelease: [] }) ? "satisfied" : "unsatisfied", reason: "<=" };
    }
    if (p.filled === 2) {
      return { status: lt(v, { major: p.major, minor: p.minor + 1, patch: 0, prerelease: [] }) ? "satisfied" : "unsatisfied", reason: "<=" };
    }
    return { status: le(v, upper) ? "satisfied" : "unsatisfied", reason: "<=" };
  }
  if (op === ">") return { status: gt(v, lowerFilled) ? "satisfied" : "unsatisfied", reason: ">" };
  if (op === "<") return { status: lt(v, lowerFilled) ? "satisfied" : "unsatisfied", reason: "<" };
  return { status: "unknown", reason: "unknown_operator" };
}

function tokenizeComparators(expr) {
  const parts = [];
  let rest = expr.trim();
  if (!rest) return { ok: false, reason: "empty_range" };
  while (rest) {
    const m = rest.match(/^(>=|<=|>|<|=|~|\^)?\s*([v*xX0-9][^\s]*)\s*/);
    if (!m) return { ok: false, reason: `unparsed_range:${rest}` };
    parts.push({ op: m[1] || "=", version: m[2] });
    rest = rest.slice(m[0].length);
  }
  return { ok: true, parts };
}

function satisfyIntersection(v, expr) {
  const trimmed = expr.trim();
  const hyphen = trimmed.match(/^(.+?)\s+-\s+(.+)$/);
  if (hyphen) {
    return combineSatisfaction([
      satisfyComparator(v, ">=", hyphen[1]),
      satisfyComparator(v, "<=", hyphen[2]),
    ]);
  }
  const tokens = tokenizeComparators(trimmed);
  if (!tokens.ok) return { status: "unknown", reason: tokens.reason };
  return combineSatisfaction(tokens.parts.map((p) => satisfyComparator(v, p.op, p.version)));
}

export function rangeSatisfaction(version, range) {
  if (version == null || range == null || range === "") {
    return { status: "unknown", reason: "missing_version_or_range" };
  }
  const versionText = stripPeerSuffix(String(version).trim());
  const v = parseSemver(versionText);
  if (!v) return { status: "unknown", reason: "unparseable_version" };
  const r = String(range).trim();
  if (v.prerelease.length) {
    if (r === v.raw || r === versionText || r === `${v.major}.${v.minor}.${v.patch}-${v.prerelease.join(".")}`) {
      return { status: "satisfied", reason: "exact_prerelease" };
    }
    return { status: "unknown", reason: "prerelease_version" };
  }
  if (r === "*" || r === "x" || r === "X") return { status: "satisfied", reason: "any" };
  if (/^(latest|next|canary|unstable|beta|alpha)$/i.test(r)) {
    return { status: "unknown", reason: "dist_tag_range" };
  }
  if (/[/:#]/.test(r)) return { status: "unknown", reason: "non_semver_range" };
  const unions = r.split(/\s*\|\|\s*/);
  let sawUnknown = false;
  for (const union of unions) {
    const one = satisfyIntersection(v, union);
    if (one.status === "satisfied") return { status: "satisfied", reason: one.reason || "union" };
    if (one.status === "unknown") sawUnknown = true;
  }
  if (sawUnknown) return { status: "unknown", reason: "partial_range_parse" };
  return { status: "unsatisfied", reason: "no_union_matched" };
}

export function stripPeerSuffix(version) {
  if (typeof version !== "string") return version;
  const cut = version.indexOf("(");
  return cut === -1 ? version : version.slice(0, cut);
}

// ---------------------------------------------------------------------------
// package.json spec protocols
// ---------------------------------------------------------------------------

export function splitNameAtSpec(rest) {
  const text = String(rest || "").trim();
  if (!text) return { name: "", spec: "*" };
  if (text.startsWith("@")) {
    const slash = text.indexOf("/");
    if (slash === -1) return { name: text, spec: "*" };
    const at = text.indexOf("@", slash);
    if (at === -1) return { name: text, spec: "*" };
    return { name: text.slice(0, at), spec: text.slice(at + 1) || "*" };
  }
  const at = text.indexOf("@");
  if (at <= 0) return { name: text, spec: "*" };
  return { name: text.slice(0, at), spec: text.slice(at + 1) || "*" };
}

export function parseDependencySpec(spec) {
  if (spec == null) {
    return { protocol: "unknown", raw: spec, unknownReason: "missing_spec" };
  }
  const raw = String(spec).trim();
  if (!raw) return { protocol: "unknown", raw, unknownReason: "empty_spec" };

  if (raw.startsWith("npm:")) {
    const rest = raw.slice(4);
    const target = splitNameAtSpec(rest);
    if (!target.name) {
      return { protocol: "alias", raw, unknownReason: "alias_missing_target", alias: null };
    }
    return {
      protocol: "alias",
      raw,
      alias: { targetName: target.name, targetSpec: target.spec || "*", source: "npm" },
    };
  }
  if (raw.startsWith("workspace:")) {
    return { protocol: "workspace", raw, workspace: { range: raw.slice("workspace:".length) || "*" } };
  }
  if (raw.startsWith("file:")) {
    return { protocol: "file", raw, path: raw.slice(5) };
  }
  if (raw.startsWith("link:")) {
    return { protocol: "link", raw, path: raw.slice(5) };
  }
  if (raw.startsWith("portal:")) {
    return { protocol: "portal", raw, path: raw.slice(7) };
  }
  if (raw.startsWith("catalog:")) {
    return { protocol: "catalog", raw };
  }
  if (raw.startsWith("patch:")) {
    return { protocol: "patch", raw };
  }
  if (raw.startsWith("jsr:")) {
    return { protocol: "jsr", raw };
  }
  if (
    raw.startsWith("git+") ||
    raw.startsWith("git:") ||
    raw.startsWith("github:") ||
    raw.startsWith("gitlab:") ||
    raw.startsWith("bitbucket:") ||
    raw.startsWith("ssh://") ||
    raw.startsWith("git@")
  ) {
    return { protocol: "git", raw };
  }
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return { protocol: "url", raw };
  }
  if (/^(latest|next|canary|unstable|beta|alpha)$/i.test(raw)) {
    return { protocol: "dist-tag", raw, range: raw };
  }
  return { protocol: "registry", raw, range: raw };
}

function protocolIsRegistryLike(protocol) {
  return protocol === "registry" || protocol === "alias";
}

// ---------------------------------------------------------------------------
// YAML subset (pnpm-lock / yarn berry). Not a full YAML 1.2 parser.
// ---------------------------------------------------------------------------

function stripYamlComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === "\\" && q === '"') {
        i++;
        continue;
      }
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      continue;
    }
    if (c === "#" && (i === 0 || line[i - 1] === " " || line[i - 1] === "\t")) {
      return line.slice(0, i).trimEnd();
    }
  }
  return line.trimEnd();
}

function parseQuoted(text, start = 0) {
  const q = text[start];
  let i = start + 1;
  let out = "";
  while (i < text.length) {
    const c = text[i];
    if (q === "'" && c === "'" && text[i + 1] === "'") {
      out += "'";
      i += 2;
      continue;
    }
    if (q === '"' && c === "\\") {
      const n = text[i + 1];
      const map = { n: "\n", t: "\t", r: "\r", "\\": "\\", '"': '"', "/": "/" };
      out += map[n] ?? n ?? "";
      i += 2;
      continue;
    }
    if (c === q) return { ok: true, value: out, end: i + 1 };
    out += c;
    i++;
  }
  return { ok: false, value: out, end: i };
}

function splitFlow(inner) {
  const parts = [];
  let depth = 0;
  let q = null;
  let cur = "";
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (q) {
      if (c === "\\" && q === '"') {
        cur += c + (inner[i + 1] || "");
        i++;
        continue;
      }
      if (c === q) q = null;
      cur += c;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      cur += c;
      continue;
    }
    if (c === "{" || c === "[") {
      depth++;
      cur += c;
      continue;
    }
    if (c === "}" || c === "]") {
      depth--;
      cur += c;
      continue;
    }
    if (c === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function yamlParseScalar(raw) {
  const t = String(raw).trim();
  if (t === "" || t === "~" || t === "null" || t === "Null" || t === "NULL") return null;
  if (t === "true" || t === "True" || t === "TRUE") return true;
  if (t === "false" || t === "False" || t === "FALSE") return false;
  if (t.startsWith("{")) return parseFlowMap(t);
  if (t.startsWith("[")) return parseFlowSeq(t);
  if (t.startsWith('"') || t.startsWith("'")) {
    const q = parseQuoted(t, 0);
    return q.ok ? q.value : t;
  }
  return t;
}

function parseFlowMap(text) {
  const obj = emptyPlain();
  const trimmed = text.trim();
  const end = trimmed.endsWith("}") ? trimmed.length - 1 : trimmed.length;
  const inner = trimmed.slice(1, end).trim();
  if (!inner) return obj;
  for (const part of splitFlow(inner)) {
    const idx = indexOfKeyColon(part);
    if (idx === -1) continue;
    const k = unquoteScalar(part.slice(0, idx).trim());
    const v = yamlParseScalar(part.slice(idx + 1).trim());
    setPlain(obj, k, v);
  }
  return obj;
}

function parseFlowSeq(text) {
  const trimmed = text.trim();
  const end = trimmed.endsWith("]") ? trimmed.length - 1 : trimmed.length;
  const inner = trimmed.slice(1, end).trim();
  if (!inner) return [];
  return splitFlow(inner).map((part) => yamlParseScalar(part));
}

function indexOfKeyColon(text) {
  if (text[0] === '"' || text[0] === "'") {
    const q = parseQuoted(text, 0);
    if (!q.ok) return -1;
    if (text[q.end] === ":") return q.end;
    return -1;
  }
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ":" && (i === text.length - 1 || text[i + 1] === " " || text[i + 1] === "\t")) return i;
  }
  return -1;
}

function unquoteScalar(text) {
  const t = String(text).trim();
  if (t.startsWith('"') || t.startsWith("'")) {
    const q = parseQuoted(t, 0);
    if (q.ok) return q.value;
  }
  return t;
}

function splitYamlKey(text) {
  if (text[0] === '"' || text[0] === "'") {
    const q = parseQuoted(text, 0);
    if (!q.ok) return { ok: false };
    const rest = text.slice(q.end);
    if (!rest.startsWith(":")) return { ok: false };
    return { ok: true, key: q.value, rest: rest.slice(1).trim() };
  }
  const idx = indexOfKeyColon(text);
  if (idx === -1) return { ok: false };
  return { ok: true, key: text.slice(0, idx), rest: text.slice(idx + 1).trim() };
}

function preprocessYamlLines(text, limitations) {
  const out = [];
  const rawLines = String(text).replace(/^\uFEFF/, "").split(/\r?\n/);
  for (let n = 0; n < rawLines.length; n++) {
    let raw = rawLines[n];
    if (raw.includes("\t")) {
      limitations.push("yaml_tab_indentation");
      raw = raw.replace(/\t/g, "  ");
    }
    const stripped = stripYamlComment(raw);
    const trimmed = stripped.trim();
    if (!trimmed || trimmed === "---" || trimmed === "...") continue;
    if (/^[&*]/.test(trimmed) || trimmed.startsWith("|") || trimmed.startsWith(">")) {
      limitations.push("yaml_anchors_aliases_or_multiline");
    }
    const indent = stripped.match(/^ */)[0].length;
    out.push({ indent, text: stripped.slice(indent), line: n + 1 });
  }
  return out;
}

function yamlParseNode(lines, i, parentIndent) {
  if (i >= lines.length) return { value: null, next: i };
  const indent = lines[i].indent;
  if (indent <= parentIndent) return { value: null, next: i };
  const seq = lines[i].text.startsWith("- ") || lines[i].text === "-";
  if (seq) return yamlParseSeq(lines, i, indent);
  return yamlParseMap(lines, i, indent);
}

function yamlParseMap(lines, i, indent) {
  const obj = emptyPlain();
  while (i < lines.length && lines[i].indent === indent) {
    if (lines[i].text.startsWith("- ") || lines[i].text === "-") break;
    const split = splitYamlKey(lines[i].text);
    if (!split.ok) break;
    i += 1;
    if (split.rest !== "") {
      if (split.rest === "|" || split.rest === ">" || split.rest.startsWith("|") || split.rest.startsWith(">")) {
        const buf = [];
        while (i < lines.length && lines[i].indent > indent) {
          buf.push(" ".repeat(lines[i].indent - indent - 1) + lines[i].text);
          i++;
        }
        setPlain(obj, split.key, buf.join("\n"));
      } else {
        setPlain(obj, split.key, yamlParseScalar(split.rest));
        if (i < lines.length && lines[i].indent > indent) {
          const nested = yamlParseNode(lines, i, indent);
          i = nested.next;
        }
      }
    } else if (i < lines.length && lines[i].indent > indent) {
      const nested = yamlParseNode(lines, i, indent);
      setPlain(obj, split.key, nested.value);
      i = nested.next;
    } else {
      setPlain(obj, split.key, null);
    }
  }
  return { value: obj, next: i };
}

function yamlParseSeq(lines, i, indent) {
  const arr = [];
  while (i < lines.length && lines[i].indent === indent && (lines[i].text.startsWith("- ") || lines[i].text === "-")) {
    const rest = lines[i].text === "-" ? "" : lines[i].text.slice(2);
    i += 1;
    if (rest === "") {
      const nested = yamlParseNode(lines, i, indent);
      arr.push(nested.value);
      i = nested.next;
    } else {
      const split = splitYamlKey(rest);
      if (split.ok && (rest.includes(": ") || /:\s*$/.test(rest))) {
        const obj = emptyPlain();
        if (split.rest !== "") setPlain(obj, split.key, yamlParseScalar(split.rest));
        else setPlain(obj, split.key, null);
        if (i < lines.length && lines[i].indent > indent) {
          const nested = yamlParseNode(lines, i, indent);
          i = nested.next;
          if (nested.value && typeof nested.value === "object" && !Array.isArray(nested.value)) {
            for (const [k, v] of Object.entries(nested.value)) setPlain(obj, k, v);
          } else if (split.rest === "") {
            setPlain(obj, split.key, nested.value);
          }
        }
        arr.push(obj);
      } else {
        arr.push(yamlParseScalar(rest));
        while (i < lines.length && lines[i].indent > indent) i++;
      }
    }
  }
  return { value: arr, next: i };
}

export function parseYamlSubset(text) {
  const limitations = [];
  const lines = preprocessYamlLines(text, limitations);
  if (!lines.length) return { ok: true, value: emptyPlain(), limitations: unique(limitations) };
  const { value, next } = yamlParseNode(lines, 0, -1);
  if (next < lines.length) limitations.push("yaml_trailing_unparsed");
  return { ok: true, value: value && typeof value === "object" ? value : emptyPlain(), limitations: unique(limitations) };
}

function unique(list) {
  return [...new Set(list.filter(Boolean))];
}

// ---------------------------------------------------------------------------
// Lockfile kind detection
// ---------------------------------------------------------------------------

export function detectLockfileKind(path, text = "") {
  const base = basename(path || "").toLowerCase();
  if (base === "package-lock.json") return "npm-lock";
  if (base === "npm-shrinkwrap.json") return "npm-shrinkwrap";
  if (base === "pnpm-lock.yaml" || base === "pnpm-lock.yml") return "pnpm";
  if (base === "bun.lockb") return "bun-binary";
  if (base === "bun.lock") return "bun-lock";
  if (base === "cargo.lock") return "cargo";
  if (base === "poetry.lock") return "poetry";
  if (base === "composer.lock") return "composer";
  if (base === "gemfile.lock") return "bundler";
  if (base === "yarn.lock") return detectYarnKind(text);
  const t = String(text).trim();
  if (t.startsWith("{")) {
    try {
      const j = JSON.parse(t.replace(/^\uFEFF/, ""));
      if (j && j.lockfileVersion != null && (j.packages || j.dependencies)) return "npm-lock";
    } catch {
      /* content sniff only */
    }
  }
  if (/^lockfileVersion:/m.test(t) && (/^importers:/m.test(t) || /^packages:/m.test(t))) return "pnpm";
  if (/__metadata\s*:/.test(t) && /languageName:/.test(t)) return "yarn-berry";
  if (/yarn lockfile v1/.test(t)) return "yarn-v1";
  return "unknown";
}

function detectYarnKind(text) {
  if (/yarn lockfile v1/.test(text)) return "yarn-v1";
  if (/__metadata\s*:/.test(text) || /languageName:/.test(text) || /linkType:/.test(text)) return "yarn-berry";
  if (/^[\t ]*version "/m.test(text) && !/^[\t ]*version:/m.test(text)) return "yarn-v1";
  if (/^[\t ]*version:/m.test(text)) return "yarn-berry";
  return "yarn-unknown";
}

export function lockfileFormatSupport(kind) {
  if (SUPPORTED_LOCKFILE_KINDS.includes(kind)) return "supported";
  if (PARTIAL_LOCKFILE_KINDS.includes(kind)) return "partial";
  return "unsupported";
}

export function detectLockfiles(manifestDir) {
  const found = [];
  for (const name of LOCKFILE_FILENAMES) {
    const path = join(manifestDir, name);
    const st = lstatOrNull(path);
    if (!st) continue;
    if (st.isSymbolicLink()) {
      found.push({ path, name, kind: detectLockfileKind(path), skipped: "symlink_refused" });
      continue;
    }
    if (!st.isFile()) continue;
    found.push({ path, name, kind: detectLockfileKind(path), skipped: null });
  }
  return found;
}

// ---------------------------------------------------------------------------
// Registry URL / locator helpers
// ---------------------------------------------------------------------------

export function packageNameFromResolvedUrl(url) {
  if (typeof url !== "string" || !url.trim()) return null;
  const raw = url.trim().split("#")[0];
  if (raw.startsWith("packages/") || raw.startsWith("file:") || raw.startsWith("link:")) return null;
  try {
    const u = new URL(raw);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts[0]?.startsWith("@") && parts[1] && parts[2] === "-") return `${parts[0]}/${parts[1]}`;
    if (parts[1] === "-") return decodeURIComponent(parts[0]);
    return null;
  } catch {
    return null;
  }
}

export function parsePnpmPackageKey(key) {
  let text = String(key || "").trim();
  if (text.startsWith("/")) text = text.slice(1);
  text = stripPeerSuffix(text);
  if (!text) return null;
  if (text.startsWith("@")) {
    const slash = text.indexOf("/");
    if (slash === -1) return { name: text, version: null };
    const at = text.indexOf("@", slash);
    if (at === -1) return { name: text, version: null };
    return { name: text.slice(0, at), version: text.slice(at + 1) || null };
  }
  const at = text.indexOf("@");
  if (at <= 0) return { name: text, version: null };
  return { name: text.slice(0, at), version: text.slice(at + 1) || null };
}

function parseYarnDescriptor(descriptor) {
  const raw = String(descriptor || "").trim();
  if (!raw) return null;
  let name;
  let rest;
  if (raw.startsWith("@")) {
    const slash = raw.indexOf("/");
    const at = raw.indexOf("@", slash === -1 ? 1 : slash);
    if (at === -1) return { name: raw, protocol: "registry", spec: "*" };
    name = raw.slice(0, at);
    rest = raw.slice(at + 1);
  } else {
    const at = raw.indexOf("@");
    if (at <= 0) return { name: raw, protocol: "registry", spec: "*" };
    name = raw.slice(0, at);
    rest = raw.slice(at + 1);
  }
  if (rest.startsWith("npm:")) {
    const inner = rest.slice(4);
    if (inner.includes("@") && !inner.startsWith("^") && !inner.startsWith("~") && !inner.startsWith("*") && !inner.startsWith("<") && !inner.startsWith(">") && !/^\d/.test(inner)) {
      const target = splitNameAtSpec(inner);
      return { name, protocol: "alias", spec: rest, alias: target };
    }
    return { name, protocol: "registry", spec: inner, locatorProtocol: "npm" };
  }
  if (rest.startsWith("workspace:")) {
    return { name, protocol: "workspace", spec: rest.slice("workspace:".length) };
  }
  if (rest.startsWith("file:") || rest.startsWith("link:") || rest.startsWith("portal:")) {
    return { name, protocol: rest.split(":")[0], spec: rest };
  }
  if (rest.startsWith("patch:") || rest.startsWith("catalog:")) {
    return { name, protocol: rest.split(":")[0], spec: rest };
  }
  return { name, protocol: "registry", spec: rest };
}

function parseYarnResolution(resolution) {
  if (typeof resolution !== "string" || !resolution.trim()) return null;
  return parseYarnDescriptor(resolution.trim());
}

function firstNonEmpty(...values) {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function versionFromNpmLockEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const raw = firstNonEmpty(entry.version);
  if (!raw) return null;
  if (raw.startsWith("npm:")) {
    const target = splitNameAtSpec(raw.slice(4));
    return { version: target.spec, name: target.name, raw };
  }
  return { version: stripPeerSuffix(raw), name: entry.name || null, raw };
}

// ---------------------------------------------------------------------------
// npm package-lock / shrinkwrap
// ---------------------------------------------------------------------------

function normalizeNpmLock(body, kind) {
  const packages = body.packages && typeof body.packages === "object" ? body.packages : emptyPlain();
  const dependencies = body.dependencies && typeof body.dependencies === "object" ? body.dependencies : emptyPlain();
  const root = packages[""] && typeof packages[""] === "object" ? packages[""] : emptyPlain();
  const entries = emptyPlain();

  const record = (name, extra) => {
    if (!name || DANGEROUS_KEYS.has(name)) return;
    const prev = entries[name];
    if (prev && prev.version && extra.version && prev.version !== extra.version) {
      extra.ambiguous = true;
      extra.versions = unique([prev.version, extra.version, ...(prev.versions || [])]);
    }
    entries[name] = { ...prev, ...extra, requestedName: name };
  };

  for (const depType of DEP_TYPES) {
    const block = root[depType];
    if (!block || typeof block !== "object") continue;
    for (const [name, spec] of Object.entries(block)) {
      record(name, { specifier: String(spec), depTypeFromLock: depType, source: "packages-root" });
    }
  }

  for (const [key, entry] of Object.entries(packages)) {
    if (!key.startsWith("node_modules/")) continue;
    if (key.slice("node_modules/".length).includes("node_modules/")) continue;
    const name = key.slice("node_modules/".length);
    if (!name) continue;
    const parsed = versionFromNpmLockEntry(entry);
    const linkedPath = entry.link ? entry.resolved || null : null;
    let linked = null;
    if (linkedPath && packages[linkedPath]) linked = packages[linkedPath];
    const resolvedName = firstNonEmpty(
      entry.name,
      linked?.name,
      parsed?.name,
      packageNameFromResolvedUrl(entry.resolved),
      name,
    );
    const version = firstNonEmpty(linked?.version, parsed?.version);
    record(name, {
      resolvedName,
      version,
      versionRaw: parsed?.raw || version,
      resolvedUrl: firstNonEmpty(entry.resolved, linked?.resolved),
      integrity: firstNonEmpty(entry.integrity, linked?.integrity),
      link: Boolean(entry.link),
      linkedPath,
      optional: Boolean(entry.optional),
      dev: Boolean(entry.dev),
      source: "packages",
    });
  }

  for (const [name, entry] of Object.entries(dependencies)) {
    if (entries[name]?.version) continue;
    const parsed = versionFromNpmLockEntry(entry);
    record(name, {
      resolvedName: firstNonEmpty(parsed?.name, packageNameFromResolvedUrl(entry.resolved), name),
      version: parsed?.version,
      versionRaw: parsed?.raw || parsed?.version,
      resolvedUrl: firstNonEmpty(entry.resolved),
      integrity: firstNonEmpty(entry.integrity),
      source: "dependencies-tree",
    });
  }

  return {
    kind,
    lockfileVersion: body.lockfileVersion ?? null,
    formatSupport: "supported",
    entries,
    packages,
    limitations: [],
  };
}

// ---------------------------------------------------------------------------
// yarn v1
// ---------------------------------------------------------------------------

function splitYarnSelectors(line) {
  const out = [];
  let q = null;
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === "\\" && q === '"') {
        cur += c + (line[i + 1] || "");
        i++;
        continue;
      }
      if (c === q) q = null;
      cur += c;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      cur += c;
      continue;
    }
    if (c === ",") {
      const t = unquoteScalar(cur.trim());
      if (t) out.push(t);
      cur = "";
      continue;
    }
    cur += c;
  }
  const t = unquoteScalar(cur.trim());
  if (t) out.push(t);
  return out;
}

function parseYarnV1(text) {
  const entries = emptyPlain();
  const limitations = [];
  const lines = String(text).replace(/^\uFEFF/, "").split(/\r?\n/);
  let current = null;

  const flush = () => {
    if (!current) return;
    for (const selector of current.selectors) {
      const desc = parseYarnDescriptor(selector);
      if (!desc?.name) continue;
      const version = current.fields.version || null;
      const resolvedUrl = current.fields.resolved || null;
      const resolvedName = firstNonEmpty(
        desc.alias?.name,
        packageNameFromResolvedUrl(resolvedUrl),
        desc.name,
      );
      const prev = entries[desc.name];
      const next = {
        requestedName: desc.name,
        resolvedName,
        version: version ? stripPeerSuffix(unquoteScalar(version)) : null,
        versionRaw: version || null,
        resolvedUrl,
        integrity: current.fields.integrity || null,
        specifier: desc.spec || null,
        protocolHint: desc.protocol,
        alias: desc.alias || null,
        source: "yarn-v1",
        selectors: current.selectors,
      };
      if (prev && prev.version && next.version && prev.version !== next.version) {
        next.ambiguous = true;
        next.versions = unique([prev.version, next.version, ...(prev.versions || [])]);
      }
      entries[desc.name] = { ...prev, ...next };
    }
    current = null;
  };

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) {
      if (!line.trim()) flush();
      continue;
    }
    if (!line.startsWith(" ") && !line.startsWith("\t")) {
      flush();
      const selectorLine = line.replace(/:\s*$/, "");
      current = { selectors: splitYarnSelectors(selectorLine), fields: emptyPlain(), depMode: null };
      continue;
    }
    if (!current) continue;
    const field = line.match(/^ {2}([A-Za-z]+) (.+)$/);
    if (field) {
      const key = field[1];
      if (key === "dependencies" || key === "optionalDependencies") {
        current.depMode = key;
        continue;
      }
      current.fields[key] = unquoteScalar(field[2]);
      current.depMode = null;
      continue;
    }
    const bare = line.match(/^ {2}([A-Za-z]+):\s*$/);
    if (bare) {
      current.depMode = bare[1];
      continue;
    }
    const dep = line.match(/^ {4}(.+?) (.+)$/);
    if (dep && current.depMode) continue;
  }
  flush();
  return { kind: "yarn-v1", lockfileVersion: 1, formatSupport: "supported", entries, limitations };
}

// ---------------------------------------------------------------------------
// yarn berry (YAML)
// ---------------------------------------------------------------------------

function parseYarnBerry(text) {
  const yaml = parseYamlSubset(text);
  const entries = emptyPlain();
  const limitations = [...(yaml.limitations || [])];
  const doc = yaml.value || emptyPlain();
  const meta = doc.__metadata && typeof doc.__metadata === "object" ? doc.__metadata : emptyPlain();
  for (const [key, value] of Object.entries(doc)) {
    if (key === "__metadata") continue;
    if (!value || typeof value !== "object") continue;
    const selectors = splitYarnSelectors(key);
    for (const selector of selectors) {
      const desc = parseYarnDescriptor(selector);
      if (!desc?.name) continue;
      const resolution = parseYarnResolution(value.resolution);
      const version = value.version != null ? String(value.version) : null;
      const resolvedName = firstNonEmpty(resolution?.alias?.name, resolution?.name, desc.alias?.name, desc.name);
      const prev = entries[desc.name];
      const next = {
        requestedName: desc.name,
        resolvedName,
        version: version ? stripPeerSuffix(version) : null,
        versionRaw: version,
        resolvedUrl: firstNonEmpty(typeof value.resolved === "string" ? value.resolved : null),
        integrity: firstNonEmpty(value.checksum, value.integrity),
        specifier: desc.spec || null,
        protocolHint: desc.protocol,
        alias: desc.alias || resolution?.alias || null,
        link: value.linkType === "soft" || desc.protocol === "workspace",
        source: "yarn-berry",
        selectors,
      };
      if (prev && prev.version && next.version && prev.version !== next.version) {
        next.ambiguous = true;
        next.versions = unique([prev.version, next.version, ...(prev.versions || [])]);
      }
      entries[desc.name] = { ...prev, ...next };
    }
  }
  return {
    kind: "yarn-berry",
    lockfileVersion: meta.version ?? null,
    formatSupport: yamlSerious(limitations) ? "partial" : "supported",
    entries,
    limitations,
  };
}

function yamlSerious(limitations) {
  return (limitations || []).some(
    (l) => l === "yaml_anchors_aliases_or_multiline" || l === "yaml_trailing_unparsed",
  );
}

// ---------------------------------------------------------------------------
// pnpm-lock.yaml
// ---------------------------------------------------------------------------

function pnpmImporterDeps(importer) {
  const out = emptyPlain();
  if (!importer || typeof importer !== "object") return out;
  for (const depType of DEP_TYPES) {
    const block = importer[depType];
    if (!block || typeof block !== "object") continue;
    for (const [name, info] of Object.entries(block)) {
      if (info == null) continue;
      if (typeof info === "string") {
        out[name] = { specifier: info, version: null, depType };
        continue;
      }
      if (typeof info === "object") {
        out[name] = {
          specifier: info.specifier != null ? String(info.specifier) : null,
          version: info.version != null ? String(info.version) : null,
          depType,
        };
      }
    }
  }
  return out;
}

function parsePnpmLock(text) {
  const yaml = parseYamlSubset(text);
  const limitations = [...(yaml.limitations || [])];
  const doc = yaml.value || emptyPlain();
  const entries = emptyPlain();
  const packages = doc.packages && typeof doc.packages === "object" ? doc.packages : emptyPlain();
  const importers = doc.importers && typeof doc.importers === "object" ? doc.importers : emptyPlain();
  const rootImporter = importers["."] || importers[""] || null;
  const rootDeps = rootImporter
    ? pnpmImporterDeps(rootImporter)
    : pnpmImporterDeps({
        dependencies: doc.dependencies,
        optionalDependencies: doc.optionalDependencies,
        peerDependencies: doc.peerDependencies,
        devDependencies: doc.devDependencies,
      });

  const packageIndex = [];
  for (const [key, value] of Object.entries(packages)) {
    const parsed = parsePnpmPackageKey(key);
    const resolution = value && typeof value === "object" ? value.resolution || emptyPlain() : emptyPlain();
    packageIndex.push({
      key,
      name: firstNonEmpty(value?.name, parsed?.name),
      version: firstNonEmpty(parsed?.version, value?.version != null ? String(value.version) : null),
      resolvedUrl: firstNonEmpty(resolution.tarball, value?.resolved),
      integrity: firstNonEmpty(resolution.integrity, value?.integrity),
    });
  }

  const lookupPackage = (name, versionRaw) => {
    const version = versionRaw ? stripPeerSuffix(String(versionRaw).replace(/^link:/, "").replace(/^file:/, "")) : null;
    const fromKey = versionRaw ? parsePnpmPackageKey(String(versionRaw).replace(/^link:/, "")) : null;
    const wantName = fromKey?.name && fromKey.name !== versionRaw ? fromKey.name : name;
    const wantVersion = fromKey?.version || version;
    return (
      packageIndex.find((p) => p.name === wantName && wantVersion && stripPeerSuffix(p.version || "") === stripPeerSuffix(wantVersion)) ||
      packageIndex.find((p) => p.name === wantName && wantVersion && String(p.version || "").startsWith(String(wantVersion))) ||
      packageIndex.find((p) => p.key === versionRaw || p.key === `/${versionRaw}`) ||
      null
    );
  };

  for (const [name, info] of Object.entries(rootDeps)) {
    const specParsed = parseDependencySpec(info.specifier || "");
    const versionRaw = info.version;
    const isLink = typeof versionRaw === "string" && (versionRaw.startsWith("link:") || versionRaw.startsWith("file:"));
    const pkg = isLink ? null : lookupPackage(specParsed.alias?.targetName || name, versionRaw);
    const resolvedName = firstNonEmpty(
      specParsed.alias?.targetName,
      pkg?.name,
      packageNameFromResolvedUrl(pkg?.resolvedUrl),
      name,
    );
    let version = null;
    if (isLink) version = null;
    else if (pkg?.version) version = stripPeerSuffix(pkg.version);
    else if (versionRaw) {
      const parsed = parsePnpmPackageKey(versionRaw);
      version = stripPeerSuffix(parsed?.version || versionRaw);
      if (version && version.startsWith("link:")) version = null;
    }
    entries[name] = {
      requestedName: name,
      resolvedName,
      version,
      versionRaw,
      resolvedUrl: pkg?.resolvedUrl || null,
      integrity: pkg?.integrity || null,
      specifier: info.specifier,
      link: isLink,
      linkedPath: isLink ? String(versionRaw).replace(/^link:/, "").replace(/^file:/, "") : null,
      source: "pnpm-importer",
      depTypeFromLock: info.depType,
    };
  }

  const otherImporters = [];
  for (const key of Object.keys(importers)) {
    if (key === "." || key === "") continue;
    otherImporters.push(key);
  }

  return {
    kind: "pnpm",
    lockfileVersion: doc.lockfileVersion ?? null,
    formatSupport: yamlSerious(limitations) ? "partial" : "supported",
    entries,
    limitations,
    otherImporters,
  };
}

// ---------------------------------------------------------------------------
// bun.lock (JSONC, partial)
// ---------------------------------------------------------------------------

function parseBunLock(text) {
  const stripped = stripJsonc(text.replace(/^\uFEFF/, ""));
  const json = parseJsonText(stripped, "bun.lock");
  if (!json.ok) {
    return {
      kind: "bun-lock",
      lockfileVersion: null,
      formatSupport: "unsupported",
      entries: emptyPlain(),
      limitations: ["bun_lock_unparsed"],
    };
  }
  const entries = emptyPlain();
  const packages = json.value.packages && typeof json.value.packages === "object" ? json.value.packages : emptyPlain();
  for (const [name, info] of Object.entries(packages)) {
    let version = null;
    let resolvedName = name;
    if (typeof info === "string") {
      const parsed = splitNameAtSpec(info);
      resolvedName = parsed.name || name;
      version = parsed.spec && parsed.spec !== "*" ? parsed.spec : info;
    } else if (Array.isArray(info)) {
      const first = info[0];
      if (typeof first === "string") {
        const parsed = splitNameAtSpec(first);
        resolvedName = parsed.name || name;
        version = /^\d/.test(parsed.spec) ? parsed.spec : stripPeerSuffix(first);
      } else if (Array.isArray(first) && typeof first[1] === "string") {
        resolvedName = typeof first[0] === "string" ? first[0] : name;
        version = first[1];
      }
    } else if (info && typeof info === "object") {
      version = info.version != null ? String(info.version) : null;
      resolvedName = info.name || name;
    }
    entries[name] = {
      requestedName: name,
      resolvedName,
      version: version ? stripPeerSuffix(String(version)) : null,
      versionRaw: version,
      source: "bun-lock",
    };
  }
  return {
    kind: "bun-lock",
    lockfileVersion: json.value.lockfileVersion ?? null,
    formatSupport: "partial",
    entries,
    limitations: ["bun_lock_partial_parser"],
  };
}

// ---------------------------------------------------------------------------
// parseLockfile dispatcher
// ---------------------------------------------------------------------------

export function parseLockfileText(text, { path = "lockfile", kind: kindHint } = {}) {
  const kind = kindHint || detectLockfileKind(path, text);
  const support = lockfileFormatSupport(kind);
  if (kind === "npm-lock" || kind === "npm-shrinkwrap") {
    const json = parseJsonText(text, path);
    if (!json.ok) return { ok: false, ...json, kind, formatSupport: "unsupported", entries: emptyPlain() };
    return { ok: true, ...normalizeNpmLock(json.value, kind) };
  }
  if (kind === "yarn-v1") return { ok: true, ...parseYarnV1(text) };
  if (kind === "yarn-berry") return { ok: true, ...parseYarnBerry(text) };
  if (kind === "pnpm") return { ok: true, ...parsePnpmLock(text) };
  if (kind === "bun-lock") return { ok: true, ...parseBunLock(text) };
  return {
    ok: true,
    kind,
    lockfileVersion: null,
    formatSupport: support,
    entries: emptyPlain(),
    limitations: [`unsupported_lockfile_kind:${kind}`],
  };
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export function parseManifestText(text, { path = "package.json" } = {}) {
  const json = parseJsonText(text, path);
  if (!json.ok) return json;
  const body = json.value;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, code: "invalid_manifest", message: "package.json must be an object" };
  }
  const declared = [];
  const byName = emptyPlain();
  for (const depType of DEP_TYPES) {
    const block = body[depType];
    if (!block || typeof block !== "object" || Array.isArray(block)) continue;
    for (const [name, spec] of Object.entries(block)) {
      if (DANGEROUS_KEYS.has(name)) continue;
      const rec = {
        name,
        spec: spec == null ? "" : String(spec),
        depType,
        parsed: parseDependencySpec(spec == null ? "" : String(spec)),
      };
      if (!byName[name]) {
        byName[name] = rec;
        declared.push(rec);
      }
    }
  }
  const overrides = [];
  collectOverrides(overrides, body.overrides, "overrides");
  collectOverrides(overrides, body.resolutions, "resolutions");
  collectOverrides(overrides, body.pnpm && typeof body.pnpm === "object" ? body.pnpm.overrides : null, "pnpm.overrides");
  const nestedOverrides = overrides.filter((o) => o.name.includes(">") || o.name.includes("/"));
  return {
    ok: true,
    name: typeof body.name === "string" ? body.name : null,
    version: typeof body.version === "string" ? body.version : null,
    workspaces: body.workspaces ?? null,
    declared,
    byName,
    overrides,
    nestedOverridesPresent: nestedOverrides.length > 0,
    body,
  };
}

function collectOverrides(out, block, kind) {
  if (!block || typeof block !== "object" || Array.isArray(block)) return;
  for (const [name, spec] of Object.entries(block)) {
    if (DANGEROUS_KEYS.has(name)) continue;
    if (spec && typeof spec === "object") {
      collectOverrides(out, spec, kind);
      continue;
    }
    out.push({ name, spec: spec == null ? "" : String(spec), kind });
  }
}

function overrideFor(manifest, name) {
  if (!manifest?.overrides) return null;
  return manifest.overrides.find((o) => o.name === name) || null;
}

// ---------------------------------------------------------------------------
// Resolve
// ---------------------------------------------------------------------------

function failResult(partial) {
  return {
    schema: SCHEMA,
    ok: false,
    identityStatus: "unknown",
    decisionHint: "unknown",
    agreement: partial.agreement || "unknown",
    conflicts: partial.conflicts || [],
    unknownReasons: partial.unknownReasons || [partial.code || "error"],
    limitations: partial.limitations || [],
    coverage: partial.coverage || { manifest: false, lockfile: false },
    provenance: partial.provenance || [],
    identity: partial.identity || null,
    lockfile: partial.lockfile || null,
    caller: partial.caller || null,
    ...partial,
  };
}

function okFrame({ clock, evidenceClass, caller, provenance, lockfile, limitations }) {
  return {
    schema: SCHEMA,
    createdAt: clock,
    clock,
    ok: true,
    caller,
    lockfile,
    provenance,
    limitations: unique(limitations || []),
    evidenceClass: evidenceClass || "synthetic",
  };
}

export function loadCallerLock(options = {}) {
  const clock = isoClock(options.clock);
  const evidenceClass = options.evidenceClass || "synthetic";
  const limitations = [];
  const provenance = [];
  const unknownReasons = [];

  if (!options.manifestPath && !options.manifestText) {
    return failResult({
      code: "missing_manifest",
      message: "manifestPath or manifestText is required",
      clock,
      createdAt: clock,
      unknownReasons: ["missing_manifest"],
    });
  }

  let manifestPath = options.manifestPath || null;
  let manifestText = options.manifestText || null;
  let manifestSha = options.manifestSha || null;
  let manifestBytes = options.manifestBytes ?? null;

  if (manifestText == null) {
    const file = readBoundedFile(manifestPath);
    if (!file.ok) {
      return failResult({
        ...file,
        clock,
        createdAt: clock,
        caller: { manifestPath, lockfilePath: options.lockfilePath || null, evidenceClass },
        unknownReasons: [file.code],
      });
    }
    manifestText = file.text;
    manifestSha = file.sha256;
    manifestBytes = file.bytes;
  } else {
    manifestSha = manifestSha || sha256Hex(manifestText);
    manifestBytes = manifestBytes ?? Buffer.byteLength(manifestText);
  }

  provenance.push(
    provenanceRecord({
      path: manifestPath,
      sha256: manifestSha,
      bytes: manifestBytes,
      retrievedAt: clock,
      label: evidenceClass,
      coverage: "package.json",
    }),
  );

  const manifest = parseManifestText(manifestText, { path: manifestPath || "package.json" });
  if (!manifest.ok) {
    return failResult({
      ...manifest,
      clock,
      createdAt: clock,
      caller: { manifestPath, lockfilePath: options.lockfilePath || null, evidenceClass },
      provenance,
      unknownReasons: [manifest.code],
    });
  }

  if (manifest.nestedOverridesPresent) limitations.push("nested_overrides_not_applied");

  const manifestDir = manifestPath ? dirname(manifestPath) : options.manifestDir || null;
  const detected = manifestDir ? detectLockfiles(manifestDir) : [];
  const usableDetected = detected.filter((d) => !d.skipped);

  let lockfilePath = options.lockfilePath || null;
  let lockfileText = options.lockfileText || null;
  let multipleLockfiles = false;

  if (!lockfilePath && !lockfileText && usableDetected.length > 1) {
    multipleLockfiles = true;
  }
  if (!lockfilePath && !lockfileText && usableDetected.length === 1) {
    lockfilePath = usableDetected[0].path;
  }
  if (!lockfilePath && !lockfileText && usableDetected.length === 0) {
    unknownReasons.push("lockfile_missing");
  }

  let lockfileSha = options.lockfileSha || null;
  let lockfileBytes = options.lockfileBytes ?? null;
  let parsedLock = null;

  if (lockfileText == null && lockfilePath) {
    const file = readBoundedFile(lockfilePath);
    if (!file.ok) {
      return failResult({
        ...file,
        clock,
        createdAt: clock,
        caller: { manifestPath, lockfilePath, evidenceClass },
        provenance,
        unknownReasons: [file.code],
        coverage: { manifest: true, lockfile: false },
      });
    }
    lockfileText = file.text;
    lockfileSha = file.sha256;
    lockfileBytes = file.bytes;
  }

  if (lockfileText != null) {
    if (!lockfileSha) lockfileSha = sha256Hex(lockfileText);
    if (lockfileBytes == null) lockfileBytes = Buffer.byteLength(lockfileText);
    provenance.push(
      provenanceRecord({
        path: lockfilePath,
        sha256: lockfileSha,
        bytes: lockfileBytes,
        retrievedAt: clock,
        label: evidenceClass,
        coverage: "lockfile",
      }),
    );
    parsedLock = parseLockfileText(lockfileText, { path: lockfilePath || "lockfile" });
    if (parsedLock.limitations) limitations.push(...parsedLock.limitations);
    if (!parsedLock.ok) {
      return failResult({
        ...parsedLock,
        clock,
        createdAt: clock,
        caller: { manifestPath, lockfilePath, evidenceClass },
        provenance,
        unknownReasons: [parsedLock.code || "lockfile_parse_error"],
        coverage: { manifest: true, lockfile: false },
      });
    }
    if (parsedLock.formatSupport === "unsupported") {
      unknownReasons.push(`unsupported_lockfile_kind:${parsedLock.kind}`);
    } else if (parsedLock.formatSupport === "partial") {
      unknownReasons.push(`partial_lockfile_kind:${parsedLock.kind}`);
      limitations.push(`partial_lockfile_kind:${parsedLock.kind}`);
    }
  }

  if (multipleLockfiles) {
    unknownReasons.push("multiple_lockfiles");
    limitations.push("multiple_lockfiles_present_unspecified");
  }

  const caller = {
    manifestPath,
    lockfilePath: lockfilePath || null,
    evidenceClass,
    detectedLockfiles: detected.map((d) => ({ path: d.path, kind: d.kind, skipped: d.skipped })),
  };

  return {
    ...okFrame({
      clock,
      evidenceClass,
      caller,
      provenance,
      lockfile: parsedLock
        ? {
            kind: parsedLock.kind,
            formatSupport: parsedLock.formatSupport,
            lockfileVersion: parsedLock.lockfileVersion ?? null,
            path: lockfilePath,
          }
        : lockfilePath || lockfileText
          ? { kind: "unknown", formatSupport: "unsupported", lockfileVersion: null, path: lockfilePath }
          : { kind: null, formatSupport: "missing", lockfileVersion: null, path: null },
      limitations,
    }),
    manifest,
    parsedLock,
    multipleLockfiles,
    unknownReasons: unique(unknownReasons),
    coverage: {
      manifest: true,
      lockfile: Boolean(parsedLock?.ok && parsedLock.formatSupport !== "unsupported"),
    },
  };
}

function workspaceRangeSatisfaction(workspaceVersion, workspaceRange) {
  const range = workspaceRange == null || workspaceRange === "" ? "*" : String(workspaceRange);
  if (range === "*" || range === "^" || range === "~") {
    return { status: "satisfied", reason: `workspace:${range || "*"}` };
  }
  if (!workspaceVersion) return { status: "unknown", reason: "workspace_version_missing" };
  return rangeSatisfaction(workspaceVersion, range);
}

function pushConflict(conflicts, row) {
  conflicts.push(row);
}

export function resolveDependency(loaded, name, { importer } = {}) {
  const clock = loaded.clock;
  const evidenceClass = loaded.evidenceClass || "synthetic";
  const limitations = [...(loaded.limitations || [])];
  const conflicts = [];
  const unknownReasons = [...(loaded.unknownReasons || [])];
  const coverage = {
    manifest: Boolean(loaded.manifest?.ok),
    lockfile: Boolean(loaded.parsedLock?.ok && loaded.parsedLock.formatSupport !== "unsupported"),
    alias: false,
    workspace: false,
    rangeCheck: "unknown",
  };

  if (!loaded.ok && !loaded.manifest) {
    return failResult({ ...loaded, unknownReasons: loaded.unknownReasons || ["load_failed"] });
  }

  if (!name || typeof name !== "string" || !name.trim()) {
    return failResult({
      code: "invalid_name",
      message: "dependency name is required",
      clock,
      createdAt: clock,
      caller: loaded.caller,
      provenance: loaded.provenance,
      lockfile: loaded.lockfile,
      unknownReasons: ["invalid_name"],
    });
  }

  const requestedName = name.trim();
  const declared = loaded.manifest?.byName?.[requestedName] || null;
  if (!declared) {
    unknownReasons.push("not_declared_in_manifest");
    return {
      ...okFrame({
        clock,
        evidenceClass,
        caller: loaded.caller,
        provenance: loaded.provenance,
        lockfile: loaded.lockfile,
        limitations,
      }),
      ok: true,
      identityStatus: "unknown",
      decisionHint: "unknown",
      agreement: "manifest_missing",
      identity: {
        requestedName,
        requestedSpec: null,
        depType: null,
        protocol: "unknown",
        alias: null,
        workspace: null,
        resolvedName: null,
        resolvedVersion: null,
        resolvedVersionRaw: null,
        resolvedUrl: null,
        integrity: null,
        source: null,
        override: null,
      },
      conflicts,
      unknownReasons: unique(unknownReasons),
      coverage: { ...coverage, manifest: true },
    };
  }

  const parsedSpec = declared.parsed;
  const protocol = parsedSpec.protocol;
  const alias = parsedSpec.alias || null;
  const workspace = parsedSpec.workspace || null;
  if (alias) coverage.alias = true;
  if (workspace) coverage.workspace = true;

  const override = overrideFor(loaded.manifest, requestedName);
  const identity = {
    requestedName,
    requestedSpec: declared.spec,
    depType: declared.depType,
    protocol,
    alias,
    workspace: workspace ? { range: workspace.range, linkedPath: null } : null,
    resolvedName: alias?.targetName || requestedName,
    resolvedVersion: null,
    resolvedVersionRaw: null,
    resolvedUrl: null,
    integrity: null,
    source: "manifest",
    override: override ? { kind: override.kind, spec: override.spec } : null,
    importer: importer || ".",
  };

  if (protocol === "unknown") unknownReasons.push(parsedSpec.unknownReason || "unknown_spec");
  if (protocol === "catalog" || protocol === "patch" || protocol === "jsr" || protocol === "dist-tag") {
    unknownReasons.push(`unsupported_spec_protocol:${protocol}`);
  }
  if (protocol === "file" || protocol === "git" || protocol === "url" || protocol === "link" || protocol === "portal") {
    unknownReasons.push(`non_registry_protocol:${protocol}`);
  }
  if (protocol === "workspace") unknownReasons.push("workspace_protocol");

  const lock = loaded.parsedLock;
  if (loaded.multipleLockfiles) {
    pushConflict(conflicts, {
      kind: "multiple_lockfiles",
      requested: requestedName,
      locked: loaded.caller?.detectedLockfiles || [],
      message: "multiple lockfiles present; identity is unknown until lockfilePath is specified",
    });
  }

  if (!lock || !lock.ok) {
    if (!lock) unknownReasons.push("lockfile_missing");
    else unknownReasons.push(lock.code || "lockfile_parse_error");
    coverage.rangeCheck = "unknown";
    const exact = parseSemver(declared.spec);
    if (exact && protocol === "registry") {
      identity.resolvedVersion = exact.raw;
      identity.source = "manifest";
      unknownReasons.push("lockfile_missing_unconfirmed");
    }
    return finishResolve({
      loaded,
      identity,
      conflicts,
      unknownReasons,
      coverage,
      limitations,
      agreement: lock ? "unsupported_format" : "lockfile_missing",
    });
  }

  if (lock.formatSupport === "unsupported") {
    return finishResolve({
      loaded,
      identity,
      conflicts,
      unknownReasons,
      coverage,
      limitations,
      agreement: "unsupported_format",
    });
  }

  const entry = lock.entries?.[requestedName] || null;
  if (!entry) {
    unknownReasons.push("lockfile_entry_missing");
    pushConflict(conflicts, {
      kind: "entry_missing",
      requested: requestedName,
      locked: null,
      message: `declared ${requestedName} is not a top-level lockfile entry`,
    });
    return finishResolve({
      loaded,
      identity,
      conflicts,
      unknownReasons,
      coverage,
      limitations,
      agreement: "entry_missing",
    });
  }

  if (entry.ambiguous) {
    unknownReasons.push("ambiguous_lockfile_entries");
    pushConflict(conflicts, {
      kind: "ambiguous_lockfile_entries",
      requested: requestedName,
      locked: entry.versions || [entry.version],
      message: "multiple lockfile versions for the same declared name",
    });
  }

  identity.source = "both";
  identity.resolvedVersion = entry.version || null;
  identity.resolvedVersionRaw = entry.versionRaw || entry.version || null;
  identity.resolvedUrl = entry.resolvedUrl || null;
  identity.integrity = entry.integrity || null;
  if (entry.linkedPath && identity.workspace) identity.workspace.linkedPath = entry.linkedPath;
  if (entry.linkedPath && !identity.workspace && (protocol === "workspace" || entry.link)) {
    identity.workspace = { range: workspace?.range || "*", linkedPath: entry.linkedPath };
    coverage.workspace = true;
  }
  if (entry.resolvedName) identity.resolvedName = entry.resolvedName;

  if (alias) {
    coverage.alias = true;
    const expected = alias.targetName;
    const got = entry.resolvedName || identity.resolvedName;
    if (got && expected && got !== expected) {
      pushConflict(conflicts, {
        kind: "alias_target_mismatch",
        requested: expected,
        locked: got,
        message: `alias ${requestedName} → npm:${expected} but lockfile identity is ${got}`,
      });
      unknownReasons.push("alias_target_mismatch");
    } else if (!got) {
      unknownReasons.push("alias_target_unresolved");
    } else {
      identity.resolvedName = got;
    }
  } else if (entry.resolvedName && entry.resolvedName !== requestedName && protocol === "registry") {
    pushConflict(conflicts, {
      kind: "name_mismatch",
      requested: requestedName,
      locked: entry.resolvedName,
      message: `manifest name ${requestedName} vs lockfile identity ${entry.resolvedName} without npm: alias`,
    });
    unknownReasons.push("name_mismatch");
  }

  if (entry.specifier && declared.spec && entry.specifier !== declared.spec && protocol !== "workspace") {
    pushConflict(conflicts, {
      kind: "spec_mismatch",
      requested: declared.spec,
      locked: entry.specifier,
      message: "package.json specifier disagrees with lockfile recorded specifier",
    });
    unknownReasons.push("spec_mismatch");
  }

  const rangeTarget = alias?.targetSpec || (protocol === "registry" ? declared.spec : protocol === "workspace" ? workspace?.range : null);
  if (protocol === "workspace") {
    coverage.workspace = true;
    const ws = workspaceRangeSatisfaction(identity.resolvedVersion, workspace?.range);
    coverage.rangeCheck = ws.status;
    if (ws.status === "unsatisfied") {
      pushConflict(conflicts, {
        kind: "range_unsatisfied",
        requested: `workspace:${workspace?.range}`,
        locked: identity.resolvedVersion,
        message: "workspace package version does not satisfy workspace: range",
      });
      unknownReasons.push("lockfile_manifest_disagreement");
    } else if (ws.status === "unknown") {
      unknownReasons.push("workspace_range_unknown");
    }
    if (entry.link || entry.linkedPath) {
      identity.workspace = {
        range: workspace?.range || "*",
        linkedPath: entry.linkedPath || identity.workspace?.linkedPath || null,
      };
    }
  } else if (protocolIsRegistryLike(protocol) && rangeTarget && identity.resolvedVersion) {
    const sat = rangeSatisfaction(identity.resolvedVersion, rangeTarget);
    coverage.rangeCheck = sat.status;
    if (sat.status === "unsatisfied") {
      pushConflict(conflicts, {
        kind: "range_unsatisfied",
        requested: rangeTarget,
        locked: identity.resolvedVersion,
        message: `lockfile version ${identity.resolvedVersion} does not satisfy ${rangeTarget}`,
      });
      unknownReasons.push("lockfile_manifest_disagreement");
    } else if (sat.status === "unknown") {
      unknownReasons.push("range_check_unknown");
    }
  } else if (protocolIsRegistryLike(protocol) && !identity.resolvedVersion) {
    coverage.rangeCheck = "unknown";
    unknownReasons.push("lockfile_version_missing");
  }

  if (override) {
    unknownReasons.push("override_present");
    const ovSat =
      identity.resolvedVersion && override.spec
        ? rangeSatisfaction(identity.resolvedVersion, parseDependencySpec(override.spec).range || override.spec)
        : { status: "unknown" };
    if (ovSat.status === "unsatisfied") {
      pushConflict(conflicts, {
        kind: "override_mismatch",
        requested: override.spec,
        locked: identity.resolvedVersion,
        message: "lockfile version does not satisfy package.json override/resolution",
      });
    }
  }

  let agreement = "match";
  if (conflicts.some((c) => c.kind === "range_unsatisfied" || c.kind === "alias_target_mismatch" || c.kind === "name_mismatch")) {
    agreement = override ? "override" : "conflict";
  } else if (conflicts.some((c) => c.kind === "spec_mismatch")) {
    agreement = "conflict";
  } else if (override) {
    agreement = "override";
  } else if (unknownReasons.includes("lockfile_missing") || unknownReasons.includes("lockfile_entry_missing")) {
    agreement = unknownReasons.includes("lockfile_entry_missing") ? "entry_missing" : "lockfile_missing";
  } else if (!identity.resolvedVersion && protocolIsRegistryLike(protocol)) {
    agreement = "unknown";
  } else if (coverage.rangeCheck === "unknown" && protocolIsRegistryLike(protocol)) {
    agreement = "unknown";
  }

  if (agreement === "conflict" || agreement === "override") unknownReasons.push("lockfile_or_alias_disagreement");

  return finishResolve({
    loaded,
    identity,
    conflicts,
    unknownReasons,
    coverage,
    limitations,
    agreement,
  });
}

function finishResolve({ loaded, identity, conflicts, unknownReasons, coverage, limitations, agreement }) {
  const reasons = unique(unknownReasons);
  const hasConflict = conflicts.length > 0 || agreement === "conflict" || agreement === "override";
  const workspaceUnknown = identity.protocol === "workspace";
  const registryLike = protocolIsRegistryLike(identity.protocol);
  const leftover = reasons.filter((r) => r !== "lockfile_missing_unconfirmed");
  const identityResolved =
    registryLike &&
    !workspaceUnknown &&
    !hasConflict &&
    !loaded.multipleLockfiles &&
    agreement === "match" &&
    coverage.rangeCheck === "satisfied" &&
    Boolean(identity.resolvedName && identity.resolvedVersion) &&
    leftover.length === 0;

  // identity_resolved is not an upgrade action (packet rule 1).
  const decisionHint = identityResolved ? "identity_resolved" : "unknown";

  return {
    ...okFrame({
      clock: loaded.clock,
      evidenceClass: loaded.evidenceClass,
      caller: loaded.caller,
      provenance: loaded.provenance,
      lockfile: loaded.lockfile,
      limitations,
    }),
    ok: true,
    identityStatus: identityResolved ? "resolved" : "unknown",
    decisionHint,
    agreement,
    identity,
    conflicts,
    unknownReasons: reasons,
    coverage,
  };
}

export function resolveCallerDependency(options = {}) {
  const loaded = loadCallerLock(options);
  if (!options.name && options.name !== "") {
    if (!loaded.ok) return loaded;
    return failResult({
      code: "invalid_name",
      message: "name is required",
      clock: loaded.clock,
      createdAt: loaded.clock,
      caller: loaded.caller,
      provenance: loaded.provenance,
      lockfile: loaded.lockfile,
      unknownReasons: ["invalid_name"],
    });
  }
  if (!loaded.ok && !loaded.manifest) return loaded;
  return resolveDependency(loaded, options.name, { importer: options.importer });
}

export function listDeclaredDependencies(loadedOrOptions) {
  const loaded = loadedOrOptions?.manifest ? loadedOrOptions : loadCallerLock(loadedOrOptions);
  if (!loaded.manifest?.ok) {
    return { ok: false, declared: [], load: loaded };
  }
  return { ok: true, declared: loaded.manifest.declared, load: loaded };
}

export function listDisagreements(loadedOrOptions) {
  const loaded = loadedOrOptions?.manifest ? loadedOrOptions : loadCallerLock(loadedOrOptions);
  const rows = [];
  if (!loaded.manifest?.ok) {
    return { ok: false, load: loaded, rows };
  }
  for (const dep of loaded.manifest.declared) {
    const resolved = resolveDependency(loaded, dep.name);
    if (resolved.identityStatus !== "resolved" || resolved.conflicts.length || resolved.agreement !== "match") {
      rows.push(resolved);
    }
  }
  return {
    ok: true,
    load: loaded,
    rows,
    summary: {
      declaredCount: loaded.manifest.declared.length,
      disagreementCount: rows.length,
      conflictCount: rows.filter((r) => r.agreement === "conflict" || r.agreement === "override").length,
      unknownCount: rows.filter((r) => r.identityStatus === "unknown").length,
    },
  };
}

/**
 * Caller-side fields for packet `dependency` old identity. Does not invent
 * newVersion / resolvedNew (those come from source acquisition).
 */
export function toPacketDependencyOld(resolution) {
  const id = resolution?.identity || {};
  return {
    name: id.resolvedName || id.requestedName || null,
    requestedName: id.requestedName || null,
    oldVersion: id.resolvedVersion || null,
    resolvedOld: id.resolvedUrl || id.resolvedVersion || null,
    newVersion: null,
    resolvedNew: null,
  };
}
