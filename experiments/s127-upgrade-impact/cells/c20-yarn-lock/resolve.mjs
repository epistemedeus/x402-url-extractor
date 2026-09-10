/**
 * Resolve a package name against a parsed classic yarn.lock.
 *
 * Unique resolved version is reported. Multiple versions for one name,
 * alias/target mismatch, and berry/unparsed input stay unknown.
 *
 * A new version is not itself a break. This module does not decide
 * export-level action vs no_action.
 */

import { parseYarnLock } from "./parse.mjs";

export const SCHEMA = "s127.c20.yarn-lock.resolve.v1";

export const DIRECT_DEP_FIELDS = Object.freeze([
  "dependencies",
  "optionalDependencies",
  "devDependencies",
  "peerDependencies",
]);

const PROTOCOL_RE = /^([A-Za-z][A-Za-z0-9+.-]*):(.*)$/;

/** Protocols that introduce a locator rather than a semver range. */
export const LOCATOR_PROTOCOLS = Object.freeze([
  "npm",
  "file",
  "link",
  "portal",
  "workspace",
  "patch",
  "exec",
  "git",
  "http",
  "https",
  "ssh",
]);

/**
 * Split a classic yarn descriptor (`name@range` / `@scope/name@range`).
 */
export function splitNameRange(descriptor) {
  if (typeof descriptor !== "string" || descriptor.length === 0) {
    return { name: null, range: null, raw: descriptor };
  }
  const raw = descriptor;
  if (raw.startsWith("@")) {
    const at = raw.indexOf("@", 1);
    if (at === -1) return { name: raw, range: "*", raw };
    return { name: raw.slice(0, at), range: raw.slice(at + 1), raw };
  }
  const at = raw.indexOf("@");
  if (at === -1) return { name: raw, range: "*", raw };
  return { name: raw.slice(0, at), range: raw.slice(at + 1), raw };
}

/**
 * Parse the range side of a descriptor into protocol + optional npm alias.
 */
export function parseRange(range) {
  if (typeof range !== "string" || range.length === 0) {
    return { protocol: "semver", range: range ?? null };
  }
  // git+https / git+ssh keep the full scheme as protocol git+https
  const m = range.match(PROTOCOL_RE);
  if (!m) return { protocol: "semver", range };

  const protocol = m[1].toLowerCase();
  const rest = m[2];

  if (protocol === "npm") {
    const inner = splitNameRange(rest);
    return {
      protocol: "npm",
      range,
      aliasTarget: inner.name,
      aliasRange: inner.range,
      inner,
    };
  }

  return { protocol, range, locator: rest };
}

export function parseDescriptor(raw) {
  const { name, range } = splitNameRange(raw);
  const parsedRange = parseRange(range);
  return {
    raw,
    name,
    range,
    protocol: parsedRange.protocol,
    aliasTarget: parsedRange.aliasTarget ?? null,
    aliasRange: parsedRange.aliasRange ?? null,
    locator: parsedRange.locator ?? null,
    workspace: parsedRange.protocol === "workspace",
    fileish: parsedRange.protocol === "file" || parsedRange.protocol === "link",
  };
}

/**
 * Registry tarball URL → package name.
 * `https://registry.yarnpkg.com/@scope/pkg/-/pkg-1.0.0.tgz#sha1`
 */
export function packageNameFromResolved(url) {
  if (typeof url !== "string" || url.length === 0) return null;
  if (url.startsWith("file:") || url.startsWith("link:")) return null;
  let parsed;
  try {
    parsed = new URL(url.split("#")[0]);
  } catch {
    return null;
  }
  const parts = parsed.pathname.split("/").filter(Boolean);
  const dash = parts.indexOf("-");
  if (dash >= 1) return parts.slice(0, dash).join("/");
  return null;
}

export function collectManifestPins(manifest) {
  const pins = [];
  if (!manifest || typeof manifest !== "object") return pins;
  for (const field of DIRECT_DEP_FIELDS) {
    const block = manifest[field];
    if (!block || typeof block !== "object") continue;
    for (const [name, spec] of Object.entries(block)) {
      if (typeof name !== "string" || typeof spec !== "string") continue;
      const alias = spec.startsWith("npm:") ? parseRange(spec) : null;
      pins.push({
        field,
        name,
        spec,
        aliasTarget: alias?.aliasTarget ?? null,
        aliasRange: alias?.aliasRange ?? null,
        protocol: alias?.protocol ?? (PROTOCOL_RE.test(spec) ? spec.split(":")[0] : "semver"),
      });
    }
  }
  return pins;
}

function decorateEntry(entry) {
  const descriptors = (entry.keys || []).map((k) => parseDescriptor(k));
  const resolvedName = packageNameFromResolved(entry.resolved);
  const aliasTargets = [
    ...new Set(descriptors.map((d) => d.aliasTarget).filter(Boolean)),
  ];
  const requestedNames = [...new Set(descriptors.map((d) => d.name).filter(Boolean))];
  const isAlias = descriptors.some((d) => d.protocol === "npm" && d.aliasTarget);
  const fileish = descriptors.some((d) => d.fileish);
  const workspace = descriptors.some((d) => d.workspace);
  return {
    keys: entry.keys,
    version: entry.version,
    resolved: entry.resolved,
    integrity: entry.integrity,
    dependencies: entry.dependencies,
    optionalDependencies: entry.optionalDependencies,
    descriptors,
    resolvedName,
    requestedNames,
    aliasTargets,
    alias: isAlias,
    fileish,
    workspace,
  };
}

function entryMatchesName(entry, name) {
  if (!name) return false;
  if (entry.requestedNames.includes(name)) return true;
  if (entry.aliasTargets.includes(name)) return true;
  if (entry.resolvedName === name) return true;
  return false;
}

function uniqueSorted(values) {
  return [...new Set(values.filter((v) => v != null && v !== ""))].sort();
}

/**
 * Resolve `name` from lockfile text or a parseYarnLock() result.
 */
export function resolveYarnPackage({
  text,
  parsed,
  name,
  manifest = null,
  declaredVersion = null,
} = {}) {
  const limitations = [
    "classic yarn.lock v1 only; berry stays unknown",
    "lockfile resolved version is not an export-break claim",
  ];
  const unknownReasons = [];

  let parseResult = parsed;
  if (!parseResult) {
    parseResult = parseYarnLock(typeof text === "string" ? text : "");
  }

  if (!parseResult || parseResult.ok !== true) {
    const reason =
      parseResult?.unknownReasons?.[0] ||
      (parseResult?.format === "berry" ? "yarn_berry_unsupported" : parseResult?.reason) ||
      "yarn_lock_unparsed";
    unknownReasons.push(reason);
    return {
      ok: false,
      schema: SCHEMA,
      status: "unknown",
      name: name ?? null,
      version: null,
      resolvedUrl: null,
      integrity: null,
      uniqueVersions: [],
      matches: [],
      aliases: [],
      conflicts: [],
      disagreement: false,
      aliasDisagreement: false,
      format: parseResult?.format || "unknown",
      coverage: "unknown",
      unknownReasons,
      limitations: uniqueSorted([...(parseResult?.limitations || []), ...limitations]),
      parse: parseResult,
      decision: "unknown",
    };
  }

  const entries = (parseResult.entries || []).map(decorateEntry);
  const aliases = [];
  const conflicts = [];
  let aliasDisagreement = false;

  for (const entry of entries) {
    if (!entry.alias) continue;
    for (const d of entry.descriptors) {
      if (d.protocol !== "npm" || !d.aliasTarget) continue;
      const row = {
        requestedName: d.name,
        targetName: d.aliasTarget,
        targetRange: d.aliasRange,
        version: entry.version,
        resolvedUrl: entry.resolved,
        resolvedName: entry.resolvedName,
        descriptor: d.raw,
      };
      aliases.push(row);
      if (entry.resolvedName && entry.resolvedName !== d.aliasTarget) {
        aliasDisagreement = true;
        unknownReasons.push("alias_resolved_name_mismatch");
      }
    }
  }

  const aliasByRequested = new Map();
  for (const row of aliases) {
    const list = aliasByRequested.get(row.requestedName) || [];
    list.push(row);
    aliasByRequested.set(row.requestedName, list);
  }
  for (const [requestedName, rows] of aliasByRequested) {
    const targets = uniqueSorted(rows.map((r) => r.targetName));
    if (targets.length > 1) {
      aliasDisagreement = true;
      unknownReasons.push("alias_target_conflict");
      conflicts.push({
        kind: "alias_target_conflict",
        name: requestedName,
        targets,
        versions: uniqueSorted(rows.map((r) => r.version)),
      });
    }
  }

  if (manifest) {
    const pins = collectManifestPins(manifest);
    for (const pin of pins) {
      if (!pin.aliasTarget) continue;
      const lockRows = aliases.filter((a) => a.requestedName === pin.name);
      if (!lockRows.length) continue;
      const targets = uniqueSorted(lockRows.map((a) => a.targetName));
      if (targets.length && !targets.includes(pin.aliasTarget)) {
        aliasDisagreement = true;
        unknownReasons.push("alias_manifest_lockfile_disagreement");
        conflicts.push({
          kind: "alias_manifest_lockfile_disagreement",
          name: pin.name,
          manifestTarget: pin.aliasTarget,
          lockfileTargets: targets,
        });
      }
    }
  }

  const versionsByName = new Map();
  for (const entry of entries) {
    const names = new Set([
      ...entry.requestedNames,
      ...entry.aliasTargets,
      ...(entry.resolvedName ? [entry.resolvedName] : []),
    ]);
    for (const pkgName of names) {
      const list = versionsByName.get(pkgName) || [];
      if (entry.version) list.push(entry.version);
      versionsByName.set(pkgName, list);
    }
  }
  for (const [pkgName, versions] of versionsByName) {
    const uniq = uniqueSorted(versions);
    if (uniq.length > 1) {
      conflicts.push({
        kind: "multiple_resolved_versions",
        name: pkgName,
        versions: uniq,
      });
    }
  }

  if (!name) {
    const disagreement = conflicts.length > 0 || aliasDisagreement;
    if (disagreement) unknownReasons.push("lockfile_disagreement");
    return {
      ok: true,
      schema: SCHEMA,
      status: disagreement ? "unknown" : "indexed",
      name: null,
      version: null,
      resolvedUrl: null,
      integrity: null,
      uniqueVersions: [],
      matches: entries,
      aliases,
      conflicts,
      disagreement,
      aliasDisagreement,
      format: parseResult.format,
      coverage: parseResult.coverage,
      unknownReasons: uniqueSorted(unknownReasons),
      limitations: uniqueSorted([...(parseResult.limitations || []), ...limitations]),
      parse: parseResult,
      decision: disagreement ? "unknown" : "no_action",
      index: summarizeIndex(entries, versionsByName),
    };
  }

  const matches = entries.filter((e) => entryMatchesName(e, name));
  const uniqueVersions = uniqueSorted(matches.map((e) => e.version));
  const uniqueResolvedNames = uniqueSorted(
    matches.map((e) => e.resolvedName || (e.aliasTargets[0] ?? e.requestedNames[0])),
  );

  if (!matches.length) {
    unknownReasons.push("lockfile_package_missing");
    return finish({
      ok: true,
      status: "unknown",
      name,
      version: null,
      resolvedUrl: null,
      integrity: null,
      uniqueVersions: [],
      matches: [],
      aliases: aliases.filter((a) => a.requestedName === name || a.targetName === name),
      conflicts,
      disagreement: false,
      aliasDisagreement,
      parseResult,
      limitations,
      unknownReasons,
      decision: "unknown",
    });
  }

  const nameConflicts = conflicts.filter((c) => c.name === name);
  const versionConflict = uniqueVersions.length > 1;
  if (versionConflict) unknownReasons.push("lockfile_version_conflict");
  if (uniqueResolvedNames.length > 1) {
    aliasDisagreement = true;
    unknownReasons.push("lockfile_identity_conflict");
  }

  const disagreement = versionConflict || aliasDisagreement || nameConflicts.length > 0;

  if (matches.some((m) => m.workspace)) {
    unknownReasons.push("workspace_protocol");
    limitations.push("workspace: protocol is berry; classic parser does not resolve workspaces");
  }

  let version = uniqueVersions.length === 1 ? uniqueVersions[0] : null;
  let resolvedUrl = null;
  let integrity = null;
  if (version && !disagreement) {
    const chosen = matches.find((m) => m.version === version) || matches[0];
    resolvedUrl = chosen.resolved;
    integrity = chosen.integrity;
  }

  if (declaredVersion && version && declaredVersion !== version) {
    limitations.push(
      `declaredVersion ${declaredVersion} differs from lockfile ${version}; lockfile is the resolved pin`,
    );
  }

  if (disagreement) unknownReasons.push("lockfile_disagreement");

  return finish({
    ok: true,
    status: disagreement || uniqueVersions.length !== 1 ? "unknown" : "resolved",
    name,
    version: disagreement ? null : version,
    resolvedUrl: disagreement ? null : resolvedUrl,
    integrity: disagreement ? null : integrity,
    uniqueVersions,
    matches,
    aliases: aliases.filter((a) => a.requestedName === name || a.targetName === name),
    conflicts: [...nameConflicts, ...conflicts.filter((c) => c.kind !== "multiple_resolved_versions" || c.name === name)],
    disagreement,
    aliasDisagreement,
    parseResult,
    limitations,
    unknownReasons,
    decision: disagreement || uniqueVersions.length !== 1 ? "unknown" : "no_action",
  });
}

function finish(row) {
  return {
    ok: row.ok,
    schema: SCHEMA,
    status: row.status,
    name: row.name,
    version: row.version,
    resolvedUrl: row.resolvedUrl,
    integrity: row.integrity,
    uniqueVersions: row.uniqueVersions,
    matches: row.matches,
    aliases: row.aliases,
    conflicts: row.conflicts,
    disagreement: row.disagreement,
    aliasDisagreement: row.aliasDisagreement,
    format: row.parseResult.format,
    coverage: row.status === "resolved" ? row.parseResult.coverage : "unknown",
    unknownReasons: uniqueSorted(row.unknownReasons),
    limitations: uniqueSorted([...(row.parseResult.limitations || []), ...row.limitations]),
    parse: row.parseResult,
    decision: row.decision,
  };
}

function summarizeIndex(entries, versionsByName) {
  const packages = [];
  for (const [name, versions] of [...versionsByName.entries()].sort((a, b) =>
    a[0] < b[0] ? -1 : 1,
  )) {
    const uniq = uniqueSorted(versions);
    packages.push({
      name,
      versions: uniq,
      conflict: uniq.length > 1,
    });
  }
  return {
    entryCount: entries.length,
    packageCount: packages.length,
    conflictCount: packages.filter((p) => p.conflict).length,
    aliasCount: entries.filter((e) => e.alias).length,
    packages,
  };
}
