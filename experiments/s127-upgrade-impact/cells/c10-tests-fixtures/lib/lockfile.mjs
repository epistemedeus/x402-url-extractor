import { tryReadJson } from "./fs-utils.mjs";
import { uniqueStrings } from "./hash.mjs";

export function parseSemver(version) {
  if (typeof version !== "string") return null;
  const m = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4]
      ? m[4].split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part))
      : [],
  };
}

function cmpIdent(a, b) {
  const aNum = typeof a === "number";
  const bNum = typeof b === "number";
  if (aNum && bNum) return a - b;
  if (aNum) return -1;
  if (bNum) return 1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function cmpSemver(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;
  const n = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < n; i += 1) {
    if (a.prerelease[i] == null) return -1;
    if (b.prerelease[i] == null) return 1;
    const c = cmpIdent(a.prerelease[i], b.prerelease[i]);
    if (c) return c;
  }
  return 0;
}

function eqTuple(a, b) {
  return a.major === b.major && a.minor === b.minor && a.patch === b.patch;
}

function rangeExcludesPrerelease(rangeHasPre, version) {
  if (!version.prerelease.length) return false;
  return !rangeHasPre;
}

function satisfiesCaret(base, version) {
  if (rangeExcludesPrerelease(base.prerelease.length > 0, version) && !eqTuple(base, version)) {
    return false;
  }
  if (cmpSemver(version, base) < 0) return false;
  if (base.major > 0) return version.major === base.major;
  if (base.minor > 0) return version.major === 0 && version.minor === base.minor;
  return version.major === 0 && version.minor === 0 && version.patch === base.patch;
}

function satisfiesTilde(base, version) {
  if (rangeExcludesPrerelease(base.prerelease.length > 0, version) && !eqTuple(base, version)) {
    return false;
  }
  if (cmpSemver(version, base) < 0) return false;
  return version.major === base.major && version.minor === base.minor;
}

export function rangeSatisfies(range, version) {
  if (range == null || version == null || range === "" || version === "") {
    return { ok: false, unknown: true, reason: "missing_range_or_version" };
  }
  const r = String(range).trim();
  const parsedVersion = parseSemver(version);
  if (r.startsWith("workspace:")) {
    return { ok: false, unknown: true, reason: "workspace_protocol" };
  }
  if (r.startsWith("npm:")) {
    return { ok: false, unknown: true, reason: "npm_alias" };
  }
  if (/^(file:|link:|git\+|github:|http:|https:|git:)/i.test(r)) {
    return { ok: false, unknown: true, reason: "non_registry_range" };
  }
  if (!parsedVersion) {
    return { ok: false, unknown: true, reason: "unparsed_version" };
  }
  if (r === "*" || r === "x" || r === "*.*.*") {
    return { ok: true, unknown: false };
  }
  if (r.includes("||") || r.includes(" - ") || r.includes(">=") || r.includes("<=") || r.includes(" <")) {
    return { ok: false, unknown: true, reason: "compound_range_unparsed" };
  }
  if (r.startsWith("^")) {
    const base = parseSemver(r.slice(1));
    if (!base) return { ok: false, unknown: true, reason: "unparsed_range" };
    return { ok: satisfiesCaret(base, parsedVersion), unknown: false };
  }
  if (r.startsWith("~")) {
    const base = parseSemver(r.slice(1));
    if (!base) return { ok: false, unknown: true, reason: "unparsed_range" };
    return { ok: satisfiesTilde(base, parsedVersion), unknown: false };
  }
  const exact = parseSemver(r);
  if (exact) {
    return { ok: cmpSemver(exact, parsedVersion) === 0, unknown: false };
  }
  return { ok: false, unknown: true, reason: "unparsed_range" };
}

function requestedFromManifest(manifest, name) {
  const buckets = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
  for (const bucket of buckets) {
    const range = manifest?.[bucket]?.[name];
    if (typeof range === "string") return { range, bucket };
  }
  return { range: null, bucket: null };
}

function lockfileResolved(lock, name) {
  if (!lock || typeof lock !== "object") return { version: null, meta: null };
  const packages = lock.packages;
  if (packages && typeof packages === "object") {
    const key = `node_modules/${name}`;
    const row = packages[key];
    if (row && typeof row === "object") {
      return { version: row.version ?? null, meta: row, lockfileVersion: lock.lockfileVersion ?? 3 };
    }
  }
  const deps = lock.dependencies;
  if (deps && typeof deps === "object" && deps[name]) {
    return {
      version: deps[name].version ?? null,
      meta: deps[name],
      lockfileVersion: lock.lockfileVersion ?? 1,
    };
  }
  return { version: null, meta: null, lockfileVersion: lock.lockfileVersion ?? null };
}

function parseNpmAlias(range) {
  if (typeof range !== "string" || !range.startsWith("npm:")) return null;
  const body = range.slice(4);
  const at = body.lastIndexOf("@");
  if (at <= 0) return { to: body, version: null };
  return { to: body.slice(0, at), version: body.slice(at + 1) };
}

export function resolveDependency(input = {}) {
  const name = input.name;
  const limitations = [];
  const unknownReasons = [];
  const disagreements = [];
  const aliases = [];
  let workspace = false;

  if (!name) {
    return {
      ok: false,
      code: "missing_dependency_name",
      name: null,
      requestedRange: null,
      resolved: null,
      aliases,
      workspace,
      disagreements,
      unknownReasons: ["missing_dependency_name"],
      limitations,
    };
  }

  const manifestLoad = tryReadJson(input.manifestPath);
  if (!manifestLoad.ok) {
    return {
      ok: false,
      code: manifestLoad.code,
      name,
      requestedRange: null,
      resolved: null,
      aliases,
      workspace,
      disagreements,
      unknownReasons: ["missing_manifest"],
      limitations,
    };
  }

  const requested = requestedFromManifest(manifestLoad.body, name);
  let requestedRange = requested.range;
  const alias = parseNpmAlias(requestedRange);
  if (alias) {
    aliases.push({ from: name, to: alias.to, requested: alias.version, raw: requestedRange });
    unknownReasons.push("alias_or_workspace");
    unknownReasons.push("npm_alias");
  }
  if (typeof requestedRange === "string" && requestedRange.startsWith("workspace:")) {
    workspace = true;
    unknownReasons.push("alias_or_workspace");
    unknownReasons.push("workspace_protocol");
  }

  let resolved = null;
  let lockMeta = null;
  if (input.lockfilePath) {
    const lockLoad = tryReadJson(input.lockfilePath);
    if (!lockLoad.ok) {
      unknownReasons.push("missing_lockfile");
      limitations.push("lockfile path provided but unreadable");
    } else {
      const found = lockfileResolved(lockLoad.body, name);
      resolved = found.version;
      lockMeta = found.meta;
      if (found.meta?.name && found.meta.name !== name) {
        aliases.push({ from: name, to: found.meta.name, requested: resolved, raw: requestedRange });
        unknownReasons.push("alias_or_workspace");
      }
    }
  } else {
    limitations.push("no lockfile path; resolved version unknown from lock");
  }

  if (requestedRange && resolved) {
    const sat = rangeSatisfies(requestedRange, resolved);
    if (sat.unknown) {
      unknownReasons.push(sat.reason || "unparsed_range");
      disagreements.push({
        kind: sat.reason === "workspace_protocol" || sat.reason === "npm_alias" ? "alias_or_workspace" : sat.reason,
        requested: requestedRange,
        resolved,
      });
    } else if (!sat.ok) {
      disagreements.push({
        kind: "lockfile_range_disagreement",
        requested: requestedRange,
        resolved,
      });
      unknownReasons.push("lockfile_range_disagreement");
    }
  }

  if (parseSemver(resolved)?.prerelease?.length || parseSemver(requestedRange)?.prerelease?.length) {
    limitations.push("prerelease");
  }

  return {
    ok: true,
    name,
    requestedRange,
    requestedBucket: requested.bucket,
    resolved,
    lockMeta,
    aliases,
    workspace,
    disagreements,
    unknownReasons: uniqueStrings(unknownReasons),
    limitations: uniqueStrings(limitations),
  };
}
