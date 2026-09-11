import { cliRefuse } from "./errors.mjs";
import { createHashTermsAdapter } from "./hash-terms.mjs";

const HTML_RE = /^\s*(<!DOCTYPE\s+html|<html[\s>]|<head[\s>]|<body[\s>])/i;

export function looksLikeHtml(text) {
  return HTML_RE.test(String(text || ""));
}

export function stripBom(text) {
  return String(text || "").replace(/^\uFEFF/, "");
}

function nameFromPackagesKey(key) {
  if (!key) return null;
  const marker = "node_modules/";
  const idx = key.lastIndexOf(marker);
  const rest = idx >= 0 ? key.slice(idx + marker.length) : key;
  return rest || null;
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
  const name = asVersion(entry.name) || nameFromPackagesKey(id);
  const version = asVersion(entry.version);
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
  for (const [name, entry] of Object.entries(deps)) {
    if (!isPlainObject(entry)) continue;
    const id = prefix ? `${prefix}/node_modules/${name}` : `node_modules/${name}`;
    const version = asVersion(entry.version);
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
