/**
 * Cell-local pnpm-lock.yaml resolver (S127 c19).
 *
 * Extracts resolved version, npm: alias, and workspace package path from
 * lockfile v6 / v9. Compares importer specifiers to package.json.
 *
 * Disagreement, missing entry, unparseable YAML, or unsupported lockfile
 * family ⇒ unknown (packet contract rule 5). Never action. Never fetches.
 * Never runs lifecycle scripts.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  classifyLockfileVersion,
  inspectRelativePath,
  isExactVersion,
  packageLookupCandidates,
  parseCatalogSpec,
  parseFileLinkSpec,
  parseNpmAlias,
  parsePackageKey,
  parseSpecifier,
  parseVersionRef,
  parseWorkspaceSpec,
} from "./dep-path.mjs";
import { isPlainObject, isPoisonKey, parseYamlSubset } from "./yaml-subset.mjs";

export const SCHEMA = "s127.upgrade-impact.pnpm-lock.v1";
export const PACKET_SCHEMA = "s127.upgrade-impact.packet.v1";
export const CELL_ID = "c19-pnpm-lock";
export const EVIDENCE_LABEL = "fixture";

export const DEP_FIELDS = Object.freeze([
  "dependencies",
  "optionalDependencies",
  "devDependencies",
  "peerDependencies",
]);

export const BASE_LIMITATIONS = Object.freeze([
  "Cell-local YAML 1.2 subset parser; not libyaml / yaml / js-yaml / @pnpm/lockfile-file",
  "Supports pnpm-lock.yaml v6 and v9. v5 and other families are unknown",
  "Peer/patch suffixes are recorded, not fully expanded into a graph",
  "Does not claim full YAML 1.2, TypeScript, or runtime resolution",
  "Does not execute package lifecycle scripts or fetch registries",
  "A new version is not itself a break; this module only resolves identity",
  "Alias/workspace/lockfile disagreement ⇒ unknown until resolved (packet rule 5)",
]);

const HERE = dirname(fileURLToPath(import.meta.url));
export const CELL_ROOT = HERE;
export const CELL_FIXTURE_ROOT = join(HERE, "fixtures");

export function sha256Hex(value) {
  const input = typeof value === "string" || Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return createHash("sha256").update(input).digest("hex");
}

export function analyzeLockfile(input = {}) {
  return analyzePnpmLock(input);
}

export function resolveLockfile(input = {}) {
  return analyzePnpmLock(input);
}

export function run(input = {}) {
  const name = input?.name ?? input?.packageName ?? input?.dependency?.name ?? input?.input?.name;
  if (name) return resolveDependency({ ...input, name });
  return analyzePnpmLock(input);
}

/**
 * Resolve a single dependency name against one lockfile + one manifest.
 */
export function resolveDependency(input = {}) {
  const name = input.name ?? input.packageName ?? input.dependency?.name;
  const full = analyzePnpmLock(input);
  const importerPath = normalizeImporterPath(input.importerPath ?? input.importer ?? ".");
  const match = (full.resolutions || []).find(
    (row) => row.name === name && normalizeImporterPath(row.importerPath) === importerPath,
  );
  const disagreements = (full.disagreements || []).filter(
    (row) => row.name === name && normalizeImporterPath(row.importerPath || importerPath) === importerPath,
  );
  const missing = name && !match;
  const disagreement = disagreements.length > 0 || Boolean(match?.disagreement);
  const unknownReasons = [...(full.unknownReasons || [])];
  if (missing && name) unknownReasons.push("missing_lockfile_entry");
  if (disagreement) unknownReasons.push("lockfile_disagreement");
  return {
    schema: SCHEMA,
    ok: full.ok && Boolean(match) && !disagreement && unknownReasons.length === 0,
    coverage: missing ? "unknown" : full.coverage,
    lockfileVersion: full.lockfileVersion,
    lockfileFamily: full.lockfileFamily,
    name: name ?? null,
    importerPath,
    resolution: match || null,
    disagreements,
    disagreement,
    aliasUnresolved: Boolean(match?.alias && match.alias.unresolved),
    workspaceUnresolved: Boolean(match?.workspace && match.workspace.unresolved),
    conflict: disagreement || missing || !full.ok,
    decision: !full.ok || missing || disagreement ? "unknown" : "resolved",
    unknownReasons: unique(unknownReasons),
    limitations: full.limitations,
    provenance: full.provenance,
  };
}

export function analyzePnpmLock(input = {}) {
  const ctx = isPlainObject(input) ? input : {};
  const limitations = [...BASE_LIMITATIONS];
  const unknownReasons = [];
  const evidenceClass = readEvidenceClass(ctx);

  let text = ctx.lockfileText ?? ctx.text ?? ctx.input?.lockfileText ?? null;
  let readError = null;
  if (text == null && ctx.lockfilePath) {
    const loaded = readConfinedFile(ctx.lockfilePath, ctx.root ?? ctx.workspaceRoot ?? null);
    if (!loaded.ok) {
      readError = loaded;
    } else {
      text = loaded.text;
    }
  }

  let manifest = ctx.manifest ?? ctx.packageJson ?? ctx.input?.manifest ?? null;
  if (manifest == null && ctx.manifestPath) {
    const loaded = readConfinedFile(ctx.manifestPath, ctx.root ?? ctx.workspaceRoot ?? null);
    if (!loaded.ok) {
      unknownReasons.push("manifest_unreadable");
      limitations.push(`manifest read failed: ${loaded.reason}`);
    } else {
      try {
        manifest = JSON.parse(loaded.text);
      } catch {
        unknownReasons.push("manifest_invalid_json");
      }
    }
  }

  const provenance = {
    label: evidenceClass,
    lockfileSha256: typeof text === "string" ? sha256Hex(text) : null,
    liveCapture: evidenceClass === "live-capture",
    paidDemand: false,
  };

  if (readError) {
    return emptyResult({
      ok: false,
      coverage: "unknown",
      unknownReasons: ["lockfile_unreadable", readError.reason],
      limitations: [...limitations, `lockfile path refused: ${readError.reason}`],
      provenance,
      decision: "unknown",
    });
  }

  if (typeof text !== "string") {
    return emptyResult({
      ok: false,
      coverage: "unknown",
      unknownReasons: ["missing_lockfile_text"],
      limitations,
      provenance,
      decision: "unknown",
    });
  }

  const yaml = parseYamlSubset(text);
  if (!yaml.ok) {
    limitations.push(...(yaml.limitations || []).filter((l) => !limitations.includes(l)));
    return emptyResult({
      ok: false,
      coverage: "unknown",
      unknownReasons: ["lockfile_unparseable", yaml.error?.code].filter(Boolean),
      limitations,
      provenance,
      decision: "unknown",
      parseError: yaml.error,
    });
  }

  const doc = yaml.value;
  if (!isPlainObject(doc)) {
    return emptyResult({
      ok: false,
      coverage: "unknown",
      unknownReasons: ["lockfile_not_mapping"],
      limitations,
      provenance,
      decision: "unknown",
    });
  }

  const versionInfo = classifyLockfileVersion(doc.lockfileVersion);
  if (versionInfo.reason) unknownReasons.push(versionInfo.reason);
  const supported = versionInfo.family === "v6" || versionInfo.family === "v9";
  if (!supported) {
    limitations.push(
      `lockfileVersion ${String(doc.lockfileVersion)} is not v6/v9; identity stays unknown`,
    );
  }

  const packages = isPlainObject(doc.packages) ? doc.packages : {};
  const snapshots = isPlainObject(doc.snapshots) ? doc.snapshots : {};
  const catalogs = isPlainObject(doc.catalogs) ? doc.catalogs : {};
  const overrides = isPlainObject(doc.overrides) ? doc.overrides : {};
  const hasOverrides = Object.keys(overrides).length > 0;
  if (hasOverrides) {
    limitations.push("lockfile overrides present; they may shift resolved versions versus package.json ranges");
  }

  const importers = collectImporters(doc);
  const manifestPins = collectManifestPins(manifest);
  const importerPathFilter = ctx.importerPath != null ? normalizeImporterPath(ctx.importerPath) : null;
  const nameFilter = ctx.name ?? ctx.packageName ?? ctx.dependency?.name ?? null;

  const resolutions = [];
  const disagreements = [];

  for (const importer of importers) {
    if (importerPathFilter && importer.path !== importerPathFilter) continue;
    const pins = importer.path === "." ? manifestPins : emptyPins();
    const usePins = importer.path === "." && manifestPins.size > 0;
    for (const dep of importer.deps) {
      if (nameFilter && dep.name !== nameFilter) continue;
      const row = resolveOneDep({
        dep,
        importerPath: importer.path,
        family: versionInfo.family,
        packages,
        snapshots,
        catalogs,
        overrides,
        manifestSpec: usePins ? pins.get(dep.name)?.spec ?? null : null,
        manifestField: usePins ? pins.get(dep.name)?.field ?? null : null,
        hasManifest: usePins,
      });
      resolutions.push(row);
      if (row.disagreement) {
        disagreements.push({
          kind: "lockfile_disagreement",
          name: row.name,
          importerPath: row.importerPath,
          versions: {
            "package.json": row.manifestSpec,
            specifier: row.specifier,
            resolved: row.resolvedVersion,
          },
          reasons: row.reasons,
          decision: "unknown",
          rationale: "Alias/workspace/lockfile disagreement ⇒ unknown until resolved (packet rule 5)",
        });
      }
    }
    if (usePins) {
      for (const [name, pin] of pins) {
        if (nameFilter && name !== nameFilter) continue;
        const seen = resolutions.some(
          (r) => r.name === name && r.importerPath === importer.path,
        );
        if (!seen) {
          const missing = {
            kind: "missing_lockfile_entry",
            name,
            importerPath: importer.path,
            versions: { "package.json": pin.spec, specifier: null, resolved: null },
            reasons: ["missing_lockfile_entry"],
            decision: "unknown",
            rationale: "package.json lists a dependency that this importer lockfile entry does not",
          };
          disagreements.push(missing);
          resolutions.push({
            importerPath: importer.path,
            name,
            field: pin.field,
            specifier: null,
            manifestSpec: pin.spec,
            resolvedVersion: null,
            resolvedName: name,
            alias: parseNpmAlias(pin.spec)
              ? { present: true, unresolved: true, ...parseNpmAlias(pin.spec) }
              : null,
            workspace: parseWorkspaceSpec(pin.spec)
              ? { present: true, unresolved: true, path: null, ...parseWorkspaceSpec(pin.spec) }
              : null,
            packageKey: null,
            snapshotKey: null,
            integrity: null,
            tarball: null,
            disagreement: true,
            reasons: ["missing_lockfile_entry"],
            decision: "unknown",
          });
        }
      }
    }
  }

  if (!supported) {
    for (const row of resolutions) {
      if (!row.reasons.includes("unsupported_lockfile_version")) {
        row.reasons.push("unsupported_lockfile_version");
      }
      row.decision = "unknown";
      row.disagreement = row.disagreement || false;
    }
  }

  const anyDisagreement = disagreements.length > 0;
  if (anyDisagreement) unknownReasons.push("lockfile_disagreement");

  const coverage = !supported
    ? "unknown"
    : yaml.coverage !== "complete"
      ? yaml.coverage
      : anyDisagreement
        ? "partial"
        : "complete";

  if (anyDisagreement || !supported || unknownReasons.length) {
    unknownReasons.push("identity_unknown");
  }

  const ok = supported && yaml.ok && !anyDisagreement && !unknownReasons.includes("lockfile_unparseable");

  return {
    schema: SCHEMA,
    ok,
    coverage,
    lockfileVersion: doc.lockfileVersion ?? null,
    lockfileFamily: versionInfo.family,
    importers: importers.map((i) => ({ path: i.path, names: i.deps.map((d) => d.name) })),
    resolutions,
    disagreements,
    disagreement: anyDisagreement,
    aliasUnresolved: resolutions.some((r) => r.alias?.unresolved),
    workspaceUnresolved: resolutions.some((r) => r.workspace?.unresolved),
    conflict: anyDisagreement || !supported,
    decision: ok ? "resolved" : "unknown",
    unknownReasons: unique(unknownReasons),
    limitations: unique(limitations),
    provenance,
    hasOverrides,
    parseError: null,
  };
}

function emptyResult(extra) {
  return {
    schema: SCHEMA,
    ok: false,
    coverage: extra.coverage ?? "unknown",
    lockfileVersion: null,
    lockfileFamily: "unknown",
    importers: [],
    resolutions: [],
    disagreements: [],
    disagreement: false,
    aliasUnresolved: false,
    workspaceUnresolved: false,
    conflict: true,
    decision: extra.decision ?? "unknown",
    unknownReasons: extra.unknownReasons ?? [],
    limitations: extra.limitations ?? [...BASE_LIMITATIONS],
    provenance: extra.provenance ?? { label: "fixture", liveCapture: false, paidDemand: false },
    hasOverrides: false,
    parseError: extra.parseError ?? null,
  };
}

function collectImporters(doc) {
  const out = [];
  if (isPlainObject(doc.importers)) {
    for (const [path, body] of Object.entries(doc.importers)) {
      if (isPoisonKey(path) || !isPlainObject(body)) continue;
      out.push({ path: normalizeImporterPath(path), deps: collectImporterDeps(body) });
    }
    return out;
  }
  if (hasDepFields(doc) || isPlainObject(doc.specifiers)) {
    out.push({ path: ".", deps: collectImporterDeps(doc) });
  }
  return out;
}

function hasDepFields(obj) {
  return DEP_FIELDS.some((f) => isPlainObject(obj?.[f]));
}

function collectImporterDeps(body) {
  const deps = [];
  const specifiers = isPlainObject(body.specifiers) ? body.specifiers : {};
  for (const field of DEP_FIELDS) {
    const block = body[field];
    if (!isPlainObject(block)) continue;
    for (const [name, spec] of Object.entries(block)) {
      if (isPoisonKey(name)) continue;
      if (typeof spec === "string") {
        deps.push({
          name,
          field,
          specifier: typeof specifiers[name] === "string" ? specifiers[name] : null,
          version: spec,
        });
        continue;
      }
      if (isPlainObject(spec)) {
        deps.push({
          name,
          field,
          specifier: typeof spec.specifier === "string" ? spec.specifier : null,
          version: typeof spec.version === "string" ? spec.version : null,
        });
      }
    }
  }
  return deps;
}

function collectManifestPins(manifest) {
  const pins = new Map();
  if (!isPlainObject(manifest)) return pins;
  for (const field of DEP_FIELDS) {
    const block = manifest[field];
    if (!isPlainObject(block)) continue;
    for (const [name, spec] of Object.entries(block)) {
      if (typeof name === "string" && typeof spec === "string" && !isPoisonKey(name)) {
        if (!pins.has(name)) pins.set(name, { field, spec: spec.trim() });
      }
    }
  }
  return pins;
}

function emptyPins() {
  return new Map();
}

function resolveOneDep({
  dep,
  importerPath,
  family,
  packages,
  snapshots,
  catalogs,
  overrides,
  manifestSpec,
  manifestField,
  hasManifest,
}) {
  const reasons = [];
  const specifier = dep.specifier;
  const specInfo = parseSpecifier(specifier ?? "");
  const manifestInfo = manifestSpec != null ? parseSpecifier(manifestSpec) : null;
  const aliasSpec = parseNpmAlias(specifier) || parseNpmAlias(manifestSpec);
  const workspaceSpec = parseWorkspaceSpec(specifier) || parseWorkspaceSpec(manifestSpec);
  const fileSpec = parseFileLinkSpec(dep.version) || parseFileLinkSpec(specifier);
  const catalogSpec = parseCatalogSpec(specifier);

  const versionRef = parseVersionRef(dep.version, {
    importerName: aliasSpec?.targetName ?? dep.name,
    specifier,
    family,
  });

  let resolvedName = versionRef.name ?? aliasSpec?.targetName ?? dep.name;
  let resolvedVersion = versionRef.version ?? null;
  let workspacePath = null;
  let workspaceUnresolved = false;
  let aliasUnresolved = false;

  if (versionRef.kind === "link" || versionRef.kind === "file" || versionRef.kind === "portal") {
    workspacePath = versionRef.path ?? null;
    const inspected = inspectRelativePath(workspacePath);
    if (!inspected.ok) {
      workspaceUnresolved = true;
      reasons.push(`workspace_path_${inspected.reason}`);
    }
    resolvedVersion = resolvedVersion ?? null;
  }

  if (workspaceSpec && !workspacePath) {
    if (workspaceSpec.path) {
      workspacePath = workspaceSpec.path;
      const inspected = inspectRelativePath(workspacePath);
      if (!inspected.ok) {
        workspaceUnresolved = true;
        reasons.push(`workspace_path_${inspected.reason}`);
      }
    } else {
      workspaceUnresolved = true;
      reasons.push("workspace_path_missing");
    }
  }

  if (aliasSpec && versionRef.kind === "id" && versionRef.name && versionRef.name !== aliasSpec.targetName) {
    reasons.push("alias_target_mismatch");
    aliasUnresolved = true;
  }
  if (aliasSpec && versionRef.kind === "bare" && resolvedName && aliasSpec.targetName !== resolvedName) {
    // bare version uses alias target as resolvedName by construction; skip
  }
  if (specInfo.kind === "npm-alias" && !aliasSpec?.targetName) {
    aliasUnresolved = true;
    reasons.push("alias_unparsed");
  }

  if (catalogSpec) {
    const catName = catalogSpec.catalog || "default";
    const cat = isPlainObject(catalogs[catName])
      ? catalogs[catName]
      : isPlainObject(catalogs.default)
        ? catalogs.default
        : null;
    const pinned = cat && typeof cat[dep.name] === "string" ? cat[dep.name] : null;
    if (!pinned) reasons.push("catalog_section_missing");
    if (!pinned && !resolvedVersion) {
      reasons.push("catalog_unresolved");
    }
    if (pinned && !resolvedVersion) resolvedVersion = pinned;
  }

  const peers = versionRef.peers ?? null;
  const candidates = packageLookupCandidates({
    name: resolvedName,
    version: resolvedVersion,
    peers,
    family,
  });
  let packageKey = null;
  let snapshotKey = null;
  let pkgMeta = null;
  for (const key of candidates) {
    if (packageKey == null && Object.prototype.hasOwnProperty.call(packages, key)) {
      packageKey = key;
      pkgMeta = packages[key];
    }
    if (snapshotKey == null && Object.prototype.hasOwnProperty.call(snapshots, key)) {
      snapshotKey = key;
    }
  }
  if (!packageKey && resolvedName && resolvedVersion) {
    const parsedKeys = Object.keys(packages);
    for (const key of parsedKeys) {
      const parsed = parsePackageKey(key, family);
      if (parsed.ok && parsed.name === resolvedName && parsed.version === resolvedVersion) {
        packageKey = key;
        pkgMeta = packages[key];
        break;
      }
    }
  }

  let integrity = null;
  let tarball = null;
  if (isPlainObject(pkgMeta)) {
    const resolution = isPlainObject(pkgMeta.resolution) ? pkgMeta.resolution : {};
    if (typeof resolution.integrity === "string") integrity = resolution.integrity;
    if (typeof resolution.tarball === "string") tarball = resolution.tarball;
    if (typeof pkgMeta.version === "string" && !resolvedVersion) resolvedVersion = pkgMeta.version;
    if (typeof pkgMeta.name === "string") resolvedName = pkgMeta.name;
  }

  if (workspaceSpec && versionRef.kind !== "link" && versionRef.kind !== "file" && versionRef.kind !== "portal") {
    if (versionRef.kind === "bare" || versionRef.kind === "id") {
      reasons.push("workspace_resolved_from_registry");
    }
  }

  if (hasManifest && manifestSpec != null) {
    if (normalizeSpec(manifestSpec) !== normalizeSpec(specifier ?? "")) {
      reasons.push("specifier_mismatch");
    }
    const manAlias = parseNpmAlias(manifestSpec);
    const lockAlias = parseNpmAlias(specifier);
    if (Boolean(manAlias) !== Boolean(lockAlias)) {
      reasons.push("alias_presence_mismatch");
      aliasUnresolved = true;
    } else if (manAlias && lockAlias && manAlias.targetName !== lockAlias.targetName) {
      reasons.push("alias_target_mismatch");
      aliasUnresolved = true;
    }
    const manWs = parseWorkspaceSpec(manifestSpec);
    const lockWs = parseWorkspaceSpec(specifier);
    if (Boolean(manWs) !== Boolean(lockWs)) {
      reasons.push("workspace_presence_mismatch");
      workspaceUnresolved = true;
    }
    if (isExactVersion(manifestSpec) && resolvedVersion && stripBuild(resolvedVersion) !== stripBuild(manifestSpec)) {
      reasons.push("exact_pin_mismatch");
    }
  } else if (hasManifest && manifestSpec == null) {
    reasons.push("manifest_missing_name");
  }

  if (isExactVersion(specifier) && resolvedVersion && stripBuild(specifier) !== stripBuild(resolvedVersion)) {
    if (!workspacePath) reasons.push("specifier_resolved_mismatch");
  }

  if (overrides && Object.prototype.hasOwnProperty.call(overrides, dep.name)) {
    reasons.push("override_present");
  }

  const disagreementReasons = new Set([
    "specifier_mismatch",
    "alias_presence_mismatch",
    "alias_target_mismatch",
    "workspace_presence_mismatch",
    "workspace_resolved_from_registry",
    "exact_pin_mismatch",
    "specifier_resolved_mismatch",
    "missing_lockfile_entry",
    "catalog_unresolved",
  ]);
  const disagreement = reasons.some((r) => disagreementReasons.has(r));
  if (workspaceUnresolved && workspaceSpec) reasons.push("workspace_unresolved");
  if (aliasUnresolved && aliasSpec) reasons.push("alias_unresolved");

  const unknown =
    disagreement ||
    workspaceUnresolved ||
    aliasUnresolved ||
    versionRef.kind === "unknown" ||
    versionRef.kind === "missing" ||
    family === "v5" ||
    family === "v7" ||
    family === "unknown";

  return {
    importerPath,
    name: dep.name,
    field: dep.field,
    specifier,
    manifestSpec,
    manifestField,
    resolvedVersion,
    resolvedName,
    alias: aliasSpec
      ? {
          present: true,
          protocol: "npm",
          targetName: aliasSpec.targetName,
          targetSpec: aliasSpec.targetSpec,
          unresolved: aliasUnresolved,
        }
      : null,
    workspace: workspaceSpec || workspacePath
      ? {
          present: Boolean(workspaceSpec) || Boolean(workspacePath),
          protocol: workspaceSpec?.protocol ?? versionRef.kind ?? "link",
          path: workspacePath,
          unresolved: workspaceUnresolved,
        }
      : null,
    packageKey,
    snapshotKey,
    integrity,
    tarball,
    peers,
    disagreement,
    reasons,
    decision: unknown ? "unknown" : "resolved",
  };
}

function normalizeSpec(spec) {
  return String(spec ?? "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

function stripBuild(version) {
  return String(version)
    .trim()
    .replace(/^v/, "")
    .replace(/^['"]|['"]$/g, "");
}

export function normalizeImporterPath(path) {
  if (path == null || path === "" || path === "./") return ".";
  return String(path).replace(/\\/g, "/").replace(/\/$/, "") || ".";
}

function readEvidenceClass(ctx) {
  const v = ctx.evidenceClass ?? ctx.provenance?.label ?? ctx.label;
  if (v === "live-capture" || v === "synthetic" || v === "fixture") return v;
  return "fixture";
}

export function readConfinedFile(candidate, root) {
  if (typeof candidate !== "string" || candidate.includes("\0")) {
    return { ok: false, reason: "nul_or_not_string" };
  }
  if (!root) {
    return { ok: false, reason: "root_required_for_path_read" };
  }
  const resolvedRoot = resolve(root);
  const resolved = isAbsolute(candidate) ? resolve(candidate) : resolve(resolvedRoot, candidate);
  const rel = relative(resolvedRoot, resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return { ok: false, reason: "path_escape" };
  }
  if (!existsSync(resolved)) {
    return { ok: false, reason: "missing_file" };
  }
  try {
    const text = readFileSync(resolved, "utf8");
    return { ok: true, text, path: resolved };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "read_failed" };
  }
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

export function loadFixture(name) {
  const dir = join(CELL_FIXTURE_ROOT, name);
  const lockPath = join(dir, "pnpm-lock.yaml");
  const manifestPath = join(dir, "package.json");
  const lockfileText = readFileSync(lockPath, "utf8");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  return { dir, lockfileText, manifest, lockPath, manifestPath };
}

function isMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(resolve(entry)).href;
  } catch {
    return false;
  }
}

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write(
      `${JSON.stringify(
        {
          schema: SCHEMA,
          usage: [
            "node cells/c19-pnpm-lock/pnpm-lock.mjs --self-check",
            "node cells/c19-pnpm-lock/pnpm-lock.mjs --json - < input.json",
          ],
          notes: [
            "No network. No lifecycle scripts. Label fixture vs live-capture on input.evidenceClass.",
            "Integrator: copy or re-export into src/lockfile.mjs as resolveLockfile.",
          ],
        },
        null,
        2,
      )}\n`,
    );
    process.exit(0);
    return;
  }
  if (process.argv.includes("--self-check")) {
    const testFile = join(HERE, "pnpm-lock.test.mjs");
    const isoFile = join(HERE, "isolation-self-check.mjs");
    const tests = spawnSync(process.execPath, ["--test", testFile], { stdio: "inherit" });
    const iso = spawnSync(process.execPath, [isoFile], { stdio: "inherit" });
    process.exit(tests.status === 0 && iso.status === 0 ? 0 : 1);
    return;
  }
  const jsonIdx = process.argv.indexOf("--json");
  let text = null;
  if (jsonIdx >= 0) {
    const spec = process.argv[jsonIdx + 1];
    if (!spec || spec === "-") text = readFileSync(0, "utf8");
    else {
      process.stdout.write(
        `${JSON.stringify({ ok: false, decision: "unknown", unknownReasons: ["cli_path_refused"] }, null, 2)}\n`,
      );
      process.exit(1);
      return;
    }
  } else if (!process.stdin.isTTY) {
    text = readFileSync(0, "utf8");
  } else {
    process.stdout.write(`${JSON.stringify({ ok: false, decision: "unknown", unknownReasons: ["no_input"] }, null, 2)}\n`);
    process.exit(2);
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, decision: "unknown", unknownReasons: ["invalid_json"], error: String(err) }, null, 2)}\n`,
    );
    process.exit(1);
    return;
  }
  const result = run(parsed);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.decision === "unknown" ? 0 : 0);
}

if (isMain()) {
  main();
}
