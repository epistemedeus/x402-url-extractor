import { cliRefuse } from "./errors.mjs";
import { createHashTermsAdapter } from "./hash-terms.mjs";

const HTML_RE = /^\s*(<!DOCTYPE\s+html|<html[\s>]|<head[\s>]|<body[\s>])/i;

export function looksLikeHtml(text) {
  return HTML_RE.test(String(text || ""));
}

export function stripBom(text) {
  return String(text || "").replace(/^\uFEFF/, "");
}

const MAX_ALIAS_SPEC_LENGTH = 512;
const MAX_PACKAGE_NAME_LENGTH = 214;
const URL_FRIENDLY_PART = /^[A-Za-z0-9._~!'()*-]+$/;
const NUMERIC_ID = "(?:0|[1-9]\\d{0,16})";
const NONNUMERIC_ID = "(?:\\d{0,16}[A-Za-z-][A-Za-z0-9-]{0,32})";
const PRERELEASE_ID = `(?:${NUMERIC_ID}|${NONNUMERIC_ID})`;
const BUILD_ID = "[0-9A-Za-z-]{1,32}";
// Strict semver only. Ranges, tags, and loose forms such as v1.2.3 stay undecoded.
const LOCKED_SEMVER = new RegExp(
  `^${NUMERIC_ID}\\.${NUMERIC_ID}\\.${NUMERIC_ID}(?:-${PRERELEASE_ID}(?:\\.${PRERELEASE_ID}){0,16})?(?:\\+${BUILD_ID}(?:\\.${BUILD_ID}){0,16})?$`,
);

function nameFromPackagesKey(key) {
  if (!key) return null;
  const segments = String(key).split("/");
  let boundary = -1;
  for (let i = 0; i < segments.length; i += 1) {
    if (segments[i] === "node_modules") boundary = i;
  }
  if (boundary < 0) return key;
  const rest = segments.slice(boundary + 1).join("/");
  return rest || null;
}

function isLockedPackageName(name) {
  if (typeof name !== "string") return false;
  if (name.length < 1 || name.length > MAX_PACKAGE_NAME_LENGTH) return false;
  if (name !== name.trim() || name.startsWith(".") || name.startsWith("_")) return false;
  const lower = name.toLowerCase();
  if (lower === "node_modules" || lower === "favicon.ico") return false;
  if (name[0] === "@") {
    const slash = name.indexOf("/");
    if (slash <= 1 || name.indexOf("/", slash + 1) !== -1) return false;
    const scope = name.slice(1, slash);
    const pkg = name.slice(slash + 1);
    if (pkg.startsWith(".")) return false;
    return URL_FRIENDLY_PART.test(scope) && URL_FRIENDLY_PART.test(pkg);
  }
  return URL_FRIENDLY_PART.test(name);
}

// Locked legacy alias written by npm as npm:<name>@<exact version>.
// Returns null for ranges, tags, git, file, remote, nested npm:, and other non-locked text.
export function decodeLockedNpmAlias(specifier) {
  if (typeof specifier !== "string" || specifier.length > MAX_ALIAS_SPEC_LENGTH) return null;
  if (!specifier.startsWith("npm:")) return null;
  const body = specifier.slice(4);
  if (!body || body.toLowerCase().startsWith("npm:")) return null;
  const versionAt = body.startsWith("@")
    ? body.indexOf("@", body.indexOf("/") + 1)
    : body.indexOf("@");
  if (versionAt <= 0) return null;
  const name = body.slice(0, versionAt);
  const version = body.slice(versionAt + 1);
  if (!isLockedPackageName(name) || !LOCKED_SEMVER.test(version)) return null;
  return { name, version };
}

function identityFromLockFields({ explicitName, rawVersion, fallbackName }) {
  const decoded = decodeLockedNpmAlias(rawVersion);
  return {
    name: explicitName || (decoded ? decoded.name : fallbackName),
    version: decoded ? decoded.version : rawVersion,
  };
}

function asIntegrity(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function asResolved(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text === "" ? null : text;
}

export function gitCommitFromResolved(resolved) {
  if (typeof resolved !== "string" || resolved === "") return null;
  const looksGit = /(?:^git\+|github:|\.git(?:#|$))/i.test(resolved);
  if (!looksGit) return null;
  const hashIdx = resolved.lastIndexOf("#");
  if (hashIdx < 0) return null;
  const frag = resolved.slice(hashIdx + 1).trim();
  if (!/^[0-9a-f]{7,40}$/i.test(frag)) return null;
  return frag.toLowerCase();
}

function asVersion(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPackageJsonOnly(doc) {
  if (!isPlainObject(doc)) return false;
  if (typeof doc.lockfileVersion === "number") return false;
  if (isPlainObject(doc.packages)) return false;
  const deps = doc.dependencies;
  if (isPlainObject(deps)) {
    const values = Object.values(deps);
    if (values.length > 0 && values.every((v) => typeof v === "string")) return true;
  }
  if (typeof doc.name === "string" && (doc.scripts || doc.devDependencies || doc.main)) return true;
  if (typeof doc.name === "string" && typeof doc.version === "string" && !doc.packages && !doc.dependencies) {
    return true;
  }
  return false;
}

function pinFromPackagesEntry(id, entry, hashPinTerms) {
  const identity = identityFromLockFields({
    explicitName: asVersion(entry.name),
    rawVersion: asVersion(entry.version),
    fallbackName: nameFromPackagesKey(id),
  });
  const name = identity.name;
  const version = identity.version;
  const integrity = asIntegrity(entry.integrity);
  const resolved = asResolved(entry.resolved);
  const pin = {
    id,
    name,
    version,
    integrity,
    resolved,
    gitCommit: gitCommitFromResolved(resolved),
  };
  pin.termsHash = hashPinTerms(pin);
  pin.missingIntegrity = integrity == null;
  return pin;
}

function collectFromPackages(packages, hashPinTerms) {
  const pins = [];
  for (const [id, entry] of Object.entries(packages)) {
    if (id === "") continue;
    if (!isPlainObject(entry)) continue;
    if (entry.link === true) continue;
    pins.push(pinFromPackagesEntry(id, entry, hashPinTerms));
  }
  return pins;
}

function walkDependencies(deps, prefix, hashPinTerms, pins) {
  if (!isPlainObject(deps)) return;
  for (const [installName, entry] of Object.entries(deps)) {
    if (!isPlainObject(entry)) continue;
    const id = prefix ? `${prefix}/node_modules/${installName}` : `node_modules/${installName}`;
    const identity = identityFromLockFields({
      explicitName: asVersion(entry.name),
      rawVersion: asVersion(entry.version),
      fallbackName: installName,
    });
    const name = identity.name;
    const version = identity.version;
    const integrity = asIntegrity(entry.integrity);
    const resolved = asResolved(entry.resolved);
    const pin = {
      id,
      name,
      version,
      integrity,
      resolved,
      gitCommit: gitCommitFromResolved(resolved),
    };
    pin.termsHash = hashPinTerms(pin);
    pin.missingIntegrity = integrity == null;
    pins.push(pin);
    if (entry.dependencies) walkDependencies(entry.dependencies, id, hashPinTerms, pins);
  }
}

export function classifyLockfileText(text, label) {
  const raw = stripBom(text);
  if (looksLikeHtml(raw)) {
    throw cliRefuse("html-input", `${label} is HTML, not a package-lock.json`, { label });
  }
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    throw cliRefuse("parse-error", `${label} is not JSON: ${err.message}`, { label });
  }
  if (!isPlainObject(doc)) {
    throw cliRefuse("not-a-lockfile", `${label} is not a lockfile object`, { label });
  }
  if (isPackageJsonOnly(doc)) {
    throw cliRefuse("package-json-only", `${label} looks like package.json, not package-lock.json`, {
      label,
    });
  }
  return doc;
}

export function extractPins(doc, { hashPinTerms } = {}) {
  const adapter = createHashTermsAdapter(hashPinTerms);
  const hasher = adapter.hashPinTerms;
  if (typeof doc.lockfileVersion !== "number") {
    throw cliRefuse("not-a-lockfile", "JSON is not an npm lockfile (missing lockfileVersion)", {});
  }
  if (doc.lockfileVersion !== 2 && doc.lockfileVersion !== 3) {
    throw cliRefuse(
      "unsupported-lockfile-version",
      `lockfileVersion ${doc.lockfileVersion} is not 2 or 3`,
      { lockfileVersion: doc.lockfileVersion },
    );
  }
  const hasPackages = isPlainObject(doc.packages);
  const hasDependencies = isPlainObject(doc.dependencies);
  if (!hasPackages && !hasDependencies) {
    throw cliRefuse("missing-packages-and-dependencies", "lockfile has neither packages nor dependencies maps", {
      lockfileVersion: doc.lockfileVersion,
    });
  }
  let mapSource = "packages";
  let pins;
  if (hasPackages) {
    pins = collectFromPackages(doc.packages, hasher);
    mapSource = "packages";
  } else {
    pins = [];
    walkDependencies(doc.dependencies, "", hasher, pins);
    mapSource = "dependencies";
  }
  return {
    lockfileVersion: doc.lockfileVersion,
    mapSource,
    rootName: typeof doc.name === "string" ? doc.name : null,
    pins,
    missingIntegrityCount: pins.filter((p) => p.missingIntegrity).length,
  };
}

export function parseLockfileText(text, { label = "lockfile", hashPinTerms } = {}) {
  const doc = classifyLockfileText(text, label);
  const extracted = extractPins(doc, { hashPinTerms });
  return { ok: true, label, doc, ...extracted };
}
