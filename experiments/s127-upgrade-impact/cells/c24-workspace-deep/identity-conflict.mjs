/**
 * Workspace protocol identity oracle for S127 c24.
 *
 * Detects when a lockfile identity is a workspace/file/link path and the
 * upgrade target is a registry locator of the same package name.
 * Same name is not same identity. Decision is unknown (packet rules 3 and 5).
 *
 * Heuristic parsers only (no YAML library, no install, no network).
 * Unparseable lockfile ⇒ unknown, not action.
 */

export const CELL_ID = "c24-workspace-deep";
export const CLOCK = "2026-09-10T12:00:00.000Z";
export const PACKET_SCHEMA = "s127.upgrade-impact.packet.v1";

export const DECISION = "unknown";
export const CONFLICT_KIND = "workspace_vs_registry_identity_conflict";

export const UNKNOWN_REASONS = Object.freeze([
  "workspace_vs_registry_identity_conflict",
  "lockfile_alias_or_workspace_disagreement",
  "workspace_disagreement",
]);

const WORKSPACE_SPEC = /^(workspace:)/i;
const LINK_SPEC = /^(link:)/i;
const FILE_SPEC = /^(file:)/i;
const NPM_ALIAS = /^(npm:)/i;
const HTTP = /^(https?:)\/\//i;
const BARE_SEMVER = /^(v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/;
const RANGE_SPEC = /^[~^>=<\s*]|^\d+\.\d+/;

const DIRECT_DEP_FIELDS = Object.freeze([
  "dependencies",
  "optionalDependencies",
  "devDependencies",
  "peerDependencies",
]);

export function classifyLocator(value) {
  if (value == null) return { kind: "missing", raw: null };
  const raw = String(value).trim();
  if (!raw) return { kind: "missing", raw: "" };
  if (WORKSPACE_SPEC.test(raw)) {
    return { kind: "workspace", raw, path: stripProtocol(raw, "workspace:") };
  }
  if (LINK_SPEC.test(raw)) {
    return { kind: "workspace_link", raw, path: stripProtocol(raw, "link:") };
  }
  if (FILE_SPEC.test(raw)) {
    return { kind: "file", raw, path: stripProtocol(raw, "file:") };
  }
  if (NPM_ALIAS.test(raw)) return { kind: "alias", raw };
  // Yarn resolution / descriptor: name@workspace:path or @scope/name@workspace:path
  const yarnWorkspace = raw.match(/^(?:@[^/]+\/)?[^@\s]+@workspace:(.+)$/);
  if (yarnWorkspace) {
    return { kind: "workspace", raw, path: yarnWorkspace[1] };
  }
  const yarnFile = raw.match(/^(?:@[^/]+\/)?[^@\s]+@(file|link):(.+)$/);
  if (yarnFile) {
    return {
      kind: yarnFile[1] === "link" ? "workspace_link" : "file",
      raw,
      path: yarnFile[2],
    };
  }
  if (HTTP.test(raw) || /^registry:/i.test(raw)) return { kind: "registry", raw };
  if (/\.tgz(?:[?#].*)?$/i.test(raw)) return { kind: "registry", raw };
  if (BARE_SEMVER.test(raw)) return { kind: "semver", raw };
  if (raw === "*" || RANGE_SPEC.test(raw)) return { kind: "semver_range", raw };
  if (/^(?:\.\.?(?:\/|$)|[A-Za-z0-9._-]+\/)/.test(raw) && !raw.includes("://")) {
    return { kind: "path", raw, path: raw };
  }
  return { kind: "unknown", raw };
}

export function isLocalIdentity(loc) {
  return Boolean(loc && ["workspace", "workspace_link", "file", "path"].includes(loc.kind));
}

export function isRegistryIdentity(loc) {
  return Boolean(loc && ["registry", "semver", "semver_range"].includes(loc.kind));
}

export function isWorkspaceSpec(spec) {
  return typeof spec === "string" && WORKSPACE_SPEC.test(spec.trim());
}

/**
 * Compare lockfile-resolved old identity to the upgrade-target new identity.
 * Does not treat a newer version as a break. Does not claim action.
 */
export function detectWorkspaceIdentityConflict(input = {}) {
  try {
    return detectInner(input);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return makeFinding({
      conflict: true,
      decision: "unknown",
      kind: "unparseable",
      reasons: ["lockfile_or_manifest_unparseable", CONFLICT_KIND],
      notes: [
        `parser threw (${message}); conflicting/missing source ⇒ unknown, not action`,
      ],
    });
  }
}

function detectInner(input) {
  const name = typeof input.dependencyName === "string" ? input.dependencyName : input.dependency?.name;
  const oldVersion = input.oldVersion ?? input.dependency?.oldVersion ?? null;
  const newVersion = input.newVersion ?? input.dependency?.newVersion ?? null;
  const resolvedOldIn = input.resolvedOld ?? input.dependency?.resolvedOld ?? null;
  const resolvedNewIn = input.resolvedNew ?? input.dependency?.resolvedNew ?? null;

  const manifest = parseManifest(input.manifest ?? input.manifestText);
  const rootManifest = parseManifest(input.rootManifest ?? input.rootManifestText);
  const lock = parseLockfile(input.lockfileText, input.lockfileKind);

  const spec = findManifestSpec(manifest.body, name) || findManifestSpec(rootManifest.body, name);
  const lockId = lock.ok ? findLockfileIdentity(lock, name) : null;

  const resolvedOld = resolvedOldIn || lockId?.resolved || (spec && isWorkspaceSpec(spec.spec) ? spec.spec : null);
  const resolvedNew = resolvedNewIn;

  const oldLoc = classifyLocator(resolvedOld);
  const newLoc = classifyLocator(resolvedNew);
  const specLoc = classifyLocator(spec?.spec);

  const reasons = [];
  const notes = [];
  const lockfileDisagreement = Boolean(
    spec &&
      lockId &&
      spec.spec &&
      lockId.resolved &&
      !sameLocalPath(spec.spec, lockId.resolved) &&
      !(isWorkspaceSpec(spec.spec) && isLocalIdentity(classifyLocator(lockId.resolved))),
  );

  const manifestIsWorkspace = Boolean(spec && isWorkspaceSpec(spec.spec));
  const lockfileIsLocal = Boolean(lockId && (lockId.link === true || isLocalIdentity(classifyLocator(lockId.resolved))));
  const oldIsLocal = isLocalIdentity(oldLoc) || manifestIsWorkspace || lockfileIsLocal;
  const newIsRegistry = isRegistryIdentity(newLoc);
  const newMissing = newLoc.kind === "missing";

  if (!lock.ok) {
    reasons.push(lock.reason || "lockfile_unparseable");
    notes.push("Unparseable lockfile ⇒ unknown until resolved (packet rule 3/5).");
  }

  if (manifestIsWorkspace && lockfileIsLocal && isRegistryIdentity(specLoc) === false) {
    notes.push(
      `Manifest specifier ${JSON.stringify(spec.spec)} is a workspace protocol; lockfile points at ${JSON.stringify(lockId.resolved)}.`,
    );
  }

  if (lockfileDisagreement) {
    reasons.push("lockfile_alias_or_workspace_disagreement");
    notes.push(
      "Manifest specifier and lockfile resolved locator disagree; alias/workspace/lockfile disagreement ⇒ unknown (packet rule 5).",
    );
  }

  // Manifest rewritten to a registry range while lockfile still links the workspace.
  if (spec && isRegistryIdentity(classifyLocator(spec.spec)) && lockfileIsLocal) {
    reasons.push("manifest_registry_range_vs_workspace_lockfile");
    reasons.push("lockfile_alias_or_workspace_disagreement");
    notes.push(
      `package.json pins ${JSON.stringify(spec.spec)} (registry/semver) but lockfile still links ${JSON.stringify(lockId.resolved)}.`,
    );
  }

  let kind = "not_workspace";
  let conflict = false;
  let decision = "no_conflict";

  const sameLocal =
    oldIsLocal &&
    isLocalIdentity(newLoc) &&
    sameLocalPath(oldLoc.path || oldLoc.raw, newLoc.path || newLoc.raw);

  if (sameLocal) {
    kind = "workspace_internal_same_identity";
    conflict = false;
    decision = "no_conflict";
    notes.push(
      "Old and new resolved locators are the same workspace/file path. This is not an identity conflict. Bind usage to exportDiff as usual. A newer version alone is still not a break.",
    );
  } else if (oldIsLocal && newMissing) {
    kind = CONFLICT_KIND;
    conflict = true;
    decision = "unknown";
    reasons.push(CONFLICT_KIND, "upgrade_target_resolved_missing");
    notes.push(
      "Lockfile/manifest identity is a workspace path, but resolvedNew is missing. Cannot tell whether the upgrade target is the same local package or a registry package of the same name ⇒ unknown.",
    );
  } else if (oldIsLocal && newIsRegistry) {
    kind = CONFLICT_KIND;
    conflict = true;
    decision = "unknown";
    reasons.push(CONFLICT_KIND);
    reasons.push("lockfile_alias_or_workspace_disagreement");
    reasons.push("workspace_disagreement");
    notes.push(
      decisionNoteWorkspaceVsRegistry({
        name,
        oldVersion,
        newVersion,
        resolvedOld: oldLoc.raw,
        resolvedNew: newLoc.raw,
        spec: spec?.spec ?? null,
      }),
    );
  } else if (oldIsLocal && isLocalIdentity(newLoc) && !sameLocal) {
    kind = "workspace_path_mismatch";
    conflict = true;
    decision = "unknown";
    reasons.push("workspace_path_mismatch", "workspace_disagreement");
    notes.push(
      `Workspace/file paths differ (${JSON.stringify(oldLoc.raw)} vs ${JSON.stringify(newLoc.raw)}); same name is not proof of same identity ⇒ unknown.`,
    );
  } else if (!oldIsLocal && !lockfileIsLocal && !manifestIsWorkspace) {
    kind = "not_workspace";
    conflict = false;
    decision = "no_conflict";
    notes.push("No workspace/file/link identity on the old side; c24 does not claim a workspace identity conflict.");
  } else {
    kind = "unknown";
    conflict = true;
    decision = "unknown";
    reasons.push("workspace_identity_unknown");
    notes.push("Could not classify both locators; missing/conflicting source ⇒ unknown, not action.");
  }

  if (conflict) {
    notes.push("Do not emit action: a used-export removal across two identities is not a caller defect of the workspace package.");
    notes.push("Do not emit no_action from unused-export rules either: unused-change attribution requires a single identity.");
    notes.push("A new version is not itself a break.");
  }

  return makeFinding({
    conflict,
    decision,
    kind,
    reasons: unique(reasons),
    notes,
    name: name || null,
    oldVersion,
    newVersion,
    spec: spec ? { field: spec.field, spec: spec.spec } : null,
    lockfileIdentity: lockId,
    locators: { old: oldLoc, new: newLoc, spec: specLoc },
    lockfile: {
      ok: lock.ok,
      kind: lock.kind,
      coverage: lock.coverage,
      reason: lock.reason || null,
    },
    lockfileDisagreement,
    manifestWorkspace: manifestIsWorkspace,
  });
}

export function decisionNoteWorkspaceVsRegistry({
  name,
  oldVersion,
  newVersion,
  resolvedOld,
  resolvedNew,
  spec,
} = {}) {
  const pkg = name || "(unnamed)";
  const specText = spec ? ` Manifest specifier ${JSON.stringify(spec)}.` : "";
  return (
    `Identity conflict for ${pkg}: lockfile/old resolved locator ${JSON.stringify(resolvedOld)} ` +
    `is a workspace/file/link path (version ${JSON.stringify(oldVersion ?? "unknown")}), ` +
    `but the upgrade target ${JSON.stringify(resolvedNew)} is a registry/semver locator ` +
    `(version ${JSON.stringify(newVersion ?? "unknown")}). Same package name is not same identity.` +
    specText +
    " Alias/workspace/lockfile disagreement ⇒ unknown until resolved (packet rule 5). " +
    "Conflicting source ⇒ unknown, not action (packet rule 3). " +
    "A newer registry version is not itself a break (packet rule 1)."
  );
}

export function parseLockfile(text, kindHint) {
  if (typeof text !== "string" || text.length === 0) {
    return { ok: false, kind: kindHint || "unknown", reason: "lockfile_missing", identities: new Map(), coverage: "missing" };
  }
  const kind = kindHint || inferLockfileKind(text);
  if (kind === "npm") return parsePackageLock(text);
  if (kind === "pnpm") return parsePnpmLock(text);
  if (kind === "yarn" || kind === "yarn-berry" || kind === "yarn-v1") return parseYarnLock(text, kind);
  const asNpm = parsePackageLock(text);
  if (asNpm.ok) return asNpm;
  return { ok: false, kind, reason: "lockfile_kind_unknown", identities: new Map(), coverage: "unknown" };
}

export function inferLockfileKind(text) {
  const head = text.slice(0, 400);
  if (/"lockfileVersion"\s*:/.test(head)) return "npm";
  if (/^lockfileVersion:/m.test(text) || /^importers:/m.test(text)) return "pnpm";
  if (/^__metadata:/m.test(text) || /@workspace:/.test(text)) return "yarn-berry";
  if (/^# yarn lockfile v1/m.test(text)) return "yarn-v1";
  if (/^[\w@].*:\s*$/m.test(text) && /version "/.test(text)) return "yarn-v1";
  return "unknown";
}

export function parsePackageLock(text) {
  const identities = new Map();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, kind: "npm", reason: "package_lock_invalid_json", identities, coverage: "unknown" };
  }
  if (!body || typeof body !== "object") {
    return { ok: false, kind: "npm", reason: "package_lock_not_object", identities, coverage: "unknown" };
  }
  const packages = body.packages && typeof body.packages === "object" ? body.packages : {};
  for (const [pkgPath, meta] of Object.entries(packages)) {
    if (!meta || typeof meta !== "object") continue;
    if (pkgPath === "") continue;
    const name = packageLockName(pkgPath, meta);
    if (!name) continue;
    if (meta.link === true && typeof meta.resolved === "string") {
      const abs = resolveLockPath(pkgPath, meta.resolved);
      const target = packages[abs] || packages[meta.resolved] || {};
      rememberIdentity(identities, name, {
        name,
        lockPath: pkgPath,
        resolved: abs || meta.resolved,
        link: true,
        version: (target && target.version) || meta.version || null,
        kind: "workspace_link",
      });
      continue;
    }
    const underNodeModules = pkgPath.includes("node_modules/");
    if (!underNodeModules) {
      rememberIdentity(identities, name, {
        name,
        lockPath: pkgPath,
        resolved: pkgPath,
        link: false,
        version: meta.version || null,
        kind: "workspace_package",
      });
      continue;
    }
    if (typeof meta.version === "string") {
      rememberIdentity(identities, name, {
        name,
        lockPath: pkgPath,
        resolved: meta.resolved || pkgPath,
        link: false,
        version: meta.version,
        kind: typeof meta.resolved === "string" && HTTP.test(meta.resolved) ? "registry" : "lockfile_entry",
      });
    }
  }
  return { ok: true, kind: "npm", identities, coverage: "npm_packages_link", lockfileVersion: body.lockfileVersion ?? null };
}

export function parsePnpmLock(text) {
  const identities = new Map();
  if (typeof text !== "string") {
    return { ok: false, kind: "pnpm", reason: "pnpm_lock_not_text", identities, coverage: "unknown" };
  }
  const skipKeys = new Set(["specifier", "version", "resolution", "id"]);
  const depFields = new Set([
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
    "specifiers",
  ]);
  const lines = text.split(/\n/);
  let section = null;
  let importer = null;
  let inDeps = false;
  let dep = null;
  let depIndent = 0;

  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = line.match(/^ */)[0].length;
    const trimmed = line.trim();

    if (indent === 0 && trimmed.endsWith(":")) {
      section = trimmed.slice(0, -1);
      importer = null;
      inDeps = false;
      dep = null;
      continue;
    }
    if (section !== "importers") continue;

    if (indent === 2) {
      const name = trimmed.split(":")[0].trim();
      importer = name;
      inDeps = false;
      dep = null;
      continue;
    }
    if (!importer) continue;

    if (indent === 4 && depFields.has(trimmed.replace(/:\s*$/, ""))) {
      inDeps = true;
      dep = null;
      continue;
    }
    if (indent === 4) {
      inDeps = false;
      dep = null;
      continue;
    }
    if (!inDeps) continue;

    const one = trimmed.match(/^(@?[^:]+):\s+(.+)$/);
    if (indent === 6 && one && !skipKeys.has(one[1].trim())) {
      const depName = one[1].trim();
      const value = stripQuotes(one[2]);
      const loc = classifyLocator(value);
      if (isLocalIdentity(loc) || isWorkspaceSpec(value)) {
        rememberIdentity(identities, depName, {
          name: depName,
          lockPath: importer,
          resolved: loc.path || value,
          specifier: value,
          link: true,
          version: null,
          kind: loc.kind,
        });
      }
      dep = null;
      continue;
    }

    if (indent === 6 && trimmed.endsWith(":") && !(one && one[2])) {
      const depName = trimmed.slice(0, -1).trim();
      if (!skipKeys.has(depName)) {
        dep = { name: depName, importer, specifier: null, version: null };
        depIndent = indent;
      }
      continue;
    }

    if (dep && indent > depIndent) {
      const spec = trimmed.match(/^specifier:\s*(.+)$/);
      if (spec) {
        dep.specifier = stripQuotes(spec[1]);
        continue;
      }
      const ver = trimmed.match(/^version:\s*(.+)$/);
      if (ver) {
        dep.version = stripQuotes(ver[1]);
        const loc = classifyLocator(dep.version);
        const specLoc = classifyLocator(dep.specifier);
        if (isLocalIdentity(loc) || isLocalIdentity(specLoc) || isWorkspaceSpec(dep.specifier || "")) {
          rememberIdentity(identities, dep.name, {
            name: dep.name,
            lockPath: dep.importer,
            resolved: loc.path || specLoc.path || dep.version,
            specifier: dep.specifier,
            link: true,
            version: null,
            kind: loc.kind === "missing" ? specLoc.kind : loc.kind,
          });
        }
        dep = null;
      }
    }
  }

  return { ok: true, kind: "pnpm", identities, coverage: "heuristic_pnpm_importers" };
}

export function parseYarnLock(text, kindHint = "yarn") {
  const identities = new Map();
  if (typeof text !== "string") {
    return { ok: false, kind: kindHint, reason: "yarn_lock_not_text", identities, coverage: "unknown" };
  }
  const lines = text.split(/\n/);
  let currentKeys = [];
  let current = null;
  const berry = kindHint === "yarn-berry" || /__metadata:/.test(text) || /@workspace:/.test(text);

  const flush = () => {
    if (!current || currentKeys.length === 0) return;
    for (const key of currentKeys) {
      const parsed = parseYarnDescriptor(key);
      if (!parsed.name) continue;
      const resolution = current.resolution || current.resolved || null;
      const loc = classifyLocator(resolution || parsed.range);
      const rangeLoc = classifyLocator(parsed.range);
      const local = isLocalIdentity(loc) || isLocalIdentity(rangeLoc) || /workspace:/i.test(key);
      rememberIdentity(identities, parsed.name, {
        name: parsed.name,
        lockPath: key,
        resolved: loc.path || resolution || parsed.range,
        specifier: parsed.range,
        link: local,
        version: current.version || null,
        kind: local ? loc.kind || "workspace" : loc.kind || "lockfile_entry",
        linkType: current.linkType || null,
      });
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    if (!line || line.startsWith("#")) continue;
    if (!line.startsWith(" ") && line.trim().endsWith(":")) {
      flush();
      const header = line.trim().slice(0, -1);
      currentKeys = header
        .split(",")
        .map((s) => stripQuotes(s.trim()))
        .filter((s) => s && s !== "__metadata");
      current = { version: null, resolved: null, resolution: null, linkType: null };
      continue;
    }
    if (!current) continue;
    const trimmed = line.trim();
    const version = trimmed.match(/^version:?\s*(.+)$/);
    if (version) {
      current.version = stripQuotes(version[1]);
      continue;
    }
    const resolved = trimmed.match(/^resolved:?\s*(.+)$/);
    if (resolved) {
      current.resolved = stripQuotes(resolved[1]);
      continue;
    }
    const resolution = trimmed.match(/^resolution:?\s*(.+)$/);
    if (resolution) {
      current.resolution = stripQuotes(resolution[1]);
      continue;
    }
    const linkType = trimmed.match(/^linkType:?\s*(.+)$/);
    if (linkType) current.linkType = stripQuotes(linkType[1]);
  }
  flush();
  return {
    ok: true,
    kind: berry ? "yarn-berry" : kindHint,
    identities,
    coverage: berry ? "heuristic_yarn_berry" : "heuristic_yarn_v1",
  };
}

export function parseYarnDescriptor(key) {
  const k = stripQuotes(String(key || ""));
  if (!k || k === "__metadata") return { name: null, range: null };
  if (k.startsWith("@")) {
    const idx = k.indexOf("@", 1);
    if (idx === -1) return { name: k, range: null };
    return { name: k.slice(0, idx), range: k.slice(idx + 1) };
  }
  const idx = k.indexOf("@");
  if (idx === -1) return { name: k, range: null };
  return { name: k.slice(0, idx), range: k.slice(idx + 1) };
}

export function expectedLockfileOverlay(finding) {
  const conflict = Boolean(finding?.conflict);
  return {
    disagreement: conflict,
    workspaceUnresolved: conflict && finding?.kind === CONFLICT_KIND,
    identityConflict: conflict,
    conflicts: conflict
      ? [
          {
            kind: finding.kind,
            name: finding.name,
            decision: "unknown",
            rationale: finding.notes?.[0] || "workspace/registry identity conflict",
          },
        ]
      : [],
    resolvedOldKind: finding?.locators?.old?.kind ?? null,
    resolvedNewKind: finding?.locators?.new?.kind ?? null,
  };
}

function parseManifest(source) {
  if (source == null || source === "") return { ok: false, body: null };
  if (typeof source === "object") return { ok: true, body: source };
  try {
    return { ok: true, body: JSON.parse(source) };
  } catch {
    return { ok: false, body: null, reason: "manifest_invalid_json" };
  }
}

function findManifestSpec(manifest, name) {
  if (!manifest || typeof manifest !== "object" || !name) return null;
  for (const field of DIRECT_DEP_FIELDS) {
    const block = manifest[field];
    if (!block || typeof block !== "object") continue;
    if (typeof block[name] === "string") return { field, spec: block[name] };
  }
  return null;
}

function findLockfileIdentity(lock, name) {
  if (!lock || !lock.identities || !name) return null;
  if (lock.identities.has(name)) return lock.identities.get(name);
  for (const rec of lock.identities.values()) {
    if (rec && rec.name === name) return rec;
  }
  return null;
}

function identityRank(rec) {
  if (!rec) return 0;
  let rank = 1;
  if (rec.link === true || rec.kind === "workspace_link" || rec.kind === "workspace") rank = 3;
  else if (rec.kind === "workspace_package" || rec.kind === "file" || rec.kind === "path") rank = 2;
  else if (isLocalIdentity(classifyLocator(rec.resolved))) rank = 2;
  const resolved = String(rec.resolved || "");
  const lockPath = String(rec.lockPath || "");
  if (resolved === `packages/${rec.name}` || lockPath === `packages/${rec.name}` || lockPath === `node_modules/${rec.name}`) {
    rank += 0.5;
  }
  if (lockPath.includes("/node_modules/")) rank -= 0.2;
  return rank;
}

function preferResolved(a, b) {
  if (!a) return b;
  if (!b) return a;
  const as = String(a);
  const bs = String(b);
  if (as.startsWith("packages/") && !bs.startsWith("packages/")) return a;
  if (bs.startsWith("packages/") && !as.startsWith("packages/")) return b;
  return as.length <= bs.length ? a : b;
}

function rememberIdentity(map, name, rec) {
  const prev = map.get(name);
  if (!prev) {
    map.set(name, rec);
    return;
  }
  const prevRank = identityRank(prev);
  const nextRank = identityRank(rec);
  if (nextRank > prevRank) {
    map.set(name, { ...rec, version: rec.version || prev.version });
    return;
  }
  if (nextRank === prevRank) {
    map.set(name, {
      ...prev,
      ...rec,
      version: rec.version || prev.version,
      resolved: preferResolved(prev.resolved, rec.resolved),
    });
    return;
  }
  if (!prev.version && rec.version) {
    map.set(name, { ...prev, version: rec.version });
  }
}

function packageLockName(pkgPath, meta) {
  if (typeof meta.name === "string") return meta.name;
  const parts = String(pkgPath).split("node_modules/");
  return parts[parts.length - 1] || null;
}

function resolveLockPath(fromPkgPath, resolved) {
  if (!resolved) return null;
  const loc = classifyLocator(resolved);
  if (loc.kind === "registry" || loc.kind === "alias") return resolved;
  if (loc.kind === "workspace" || loc.kind === "workspace_link" || loc.kind === "file") {
    return normalizePath(loc.path);
  }
  // npm lockfile v3 workspace links store the packages{} key (root-relative),
  // not a filesystem walk from the nested node_modules slot.
  if (!resolved.includes("://") && !resolved.startsWith(".")) {
    return normalizePath(resolved);
  }
  if (resolved.startsWith(".")) {
    const fromDir = fromPkgPath.includes("/") ? fromPkgPath.split("/").slice(0, -1).join("/") : "";
    return normalizePath(fromDir ? `${fromDir}/${resolved}` : resolved);
  }
  return resolved;
}

function sameLocalPath(a, b) {
  const na = normalizePath(stripLocatorPath(a));
  const nb = normalizePath(stripLocatorPath(b));
  if (!na || !nb) return false;
  return na === nb;
}

function stripLocatorPath(value) {
  if (value == null) return "";
  const loc = classifyLocator(value);
  return loc.path || loc.raw || "";
}

function normalizePath(p) {
  if (!p) return "";
  const parts = [];
  for (const part of String(p).replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

function stripProtocol(value, prefix) {
  return value.slice(prefix.length).replace(/^\/\//, "");
}

function stripQuotes(value) {
  return String(value || "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

function unique(values) {
  const out = [];
  const seen = new Set();
  for (const value of values || []) {
    if (value == null || value === "") continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function makeFinding(fields) {
  return {
    conflict: Boolean(fields.conflict),
    decision: fields.decision || "unknown",
    kind: fields.kind || "unknown",
    reasons: unique(fields.reasons || []),
    notes: fields.notes || [],
    name: fields.name ?? null,
    oldVersion: fields.oldVersion ?? null,
    newVersion: fields.newVersion ?? null,
    spec: fields.spec ?? null,
    lockfileIdentity: fields.lockfileIdentity ?? null,
    locators: fields.locators ?? null,
    lockfile: fields.lockfile ?? null,
    lockfileDisagreement: Boolean(fields.lockfileDisagreement),
    manifestWorkspace: Boolean(fields.manifestWorkspace),
  };
}
