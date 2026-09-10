/**
 * Hostile-input gate for S127 upgrade-impact.
 *
 * Reads untrusted package trees with lstat/readFile only. Never spawns a
 * package manager, never dynamically loads caller/dep sources, never follows
 * escaping symlinks via realpath, never runs lifecycle scripts.
 *
 * Packet rules applied here:
 *  3. Conflicting/missing/partial source ⇒ unknown, not action
 *  5. Lockfile disagreement ⇒ unknown
 * Hostile path/symlink escape ⇒ invalid input; nextAction stays unknown.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { countExportTree, EXPORT_ENTRY_CAP, EXPORT_TARGET_CAP, isOversizeExports } from "./exports-bounds.mjs";
import {
  collectManifestPins,
  detectLockfileDisagreement,
  parsePackageLock,
  parsePnpmLock,
  parseYarnLock,
} from "./lockfile-conflict.mjs";
import { inspectExportKey, inspectManifestPath, inspectSymlinkTarget } from "./path-safety.mjs";
import { listLifecycleScripts } from "./script-policy.mjs";
import { classifySourceBuffer, looksLikeSourceName } from "./source-kind.mjs";

export const HOSTILE_SCAN_SCHEMA = "s127.upgrade-impact.hostile-scan.v1";
export const MAX_MANIFEST_BYTES = 512 * 1024;
export const MAX_SOURCE_BYTES = 256 * 1024;
export const MAX_WALK_ENTRIES = 256;
export const MAX_WALK_DEPTH = 4;

const PATH_FIELDS = Object.freeze([
  "main",
  "module",
  "browser",
  "types",
  "typings",
  "jsnext:main",
  "esnext",
  "unpkg",
  "jsdelivr",
  "svelte",
  "umd:main",
  "source",
  "react-native",
]);

const LOCKFILE_NAMES = Object.freeze(["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml"]);

const DEFAULT_IO = Object.freeze({
  readFileSync: fs.readFileSync,
  lstatSync: fs.lstatSync,
  readdirSync: fs.readdirSync,
  readlinkSync: fs.readlinkSync,
});

export function scanHostileInputs(options = {}) {
  const clock = options.clock || new Date().toISOString();
  const createdAt = options.createdAt || clock;
  const io = { ...DEFAULT_IO, ...(options.io || {}) };
  const evidenceClass = options.evidenceClass || "fixture";
  const label = options.label || "fixture";
  const findings = [];
  const limitations = [
    "no full TS",
    "no runtime exec",
    "no package lifecycle scripts",
    "no realpath follow of untrusted symlinks",
    "lockfile parsers are heuristic (yarn v1 / pnpm importer deps)",
  ];
  const unknownReasons = [];
  const readPaths = [];
  const scriptsExecuted = false;
  const spawnInvocations = [];

  const packageRoot = options.packageRoot ? path.resolve(options.packageRoot) : null;
  if (!packageRoot) {
    return finalize({
      clock,
      createdAt,
      evidenceClass,
      label,
      findings: [{ kind: "missing_package_root", decision: "invalid" }],
      limitations,
      unknownReasons: ["missing_package_root"],
      readPaths,
      scriptsExecuted,
      spawnInvocations,
      inputValidity: "invalid",
      packageRoot: null,
    });
  }

  const rootStat = lstatSafe(io, packageRoot);
  if (!rootStat.ok || !rootStat.stat.isDirectory()) {
    findings.push({
      kind: "package_root_unreadable",
      path: packageRoot,
      reason: rootStat.reason || "not_directory",
      decision: "invalid",
    });
    return finalize({
      clock,
      createdAt,
      evidenceClass,
      label,
      findings,
      limitations,
      unknownReasons: ["package_root_unreadable"],
      readPaths,
      scriptsExecuted,
      spawnInvocations,
      inputValidity: "invalid",
      packageRoot,
    });
  }

  const manifestPath = path.join(packageRoot, "package.json");
  const manifestRead = readBoundedFile(io, packageRoot, manifestPath, MAX_MANIFEST_BYTES, readPaths);
  if (!manifestRead.ok) {
    findings.push({
      kind: manifestRead.kind || "manifest_unreadable",
      path: manifestPath,
      reason: manifestRead.reason,
      decision: manifestRead.decision || "invalid",
    });
    unknownReasons.push("manifest_unreadable");
    walkTree(io, packageRoot, findings, unknownReasons);
    return finalize({
      clock,
      createdAt,
      evidenceClass,
      label,
      findings,
      limitations,
      unknownReasons,
      readPaths,
      scriptsExecuted,
      spawnInvocations,
      inputValidity: "invalid",
      packageRoot,
    });
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestRead.text);
  } catch {
    findings.push({
      kind: "manifest_invalid_json",
      path: manifestPath,
      decision: "invalid",
    });
    walkTree(io, packageRoot, findings, unknownReasons);
    return finalize({
      clock,
      createdAt,
      evidenceClass,
      label,
      findings,
      limitations,
      unknownReasons: [...unknownReasons, "manifest_invalid_json"],
      readPaths,
      scriptsExecuted,
      spawnInvocations,
      inputValidity: "invalid",
      packageRoot,
      provenance: hashProvenance(manifestPath, manifestRead.buf, label, createdAt),
    });
  }

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    findings.push({ kind: "manifest_not_object", decision: "invalid" });
    return finalize({
      clock,
      createdAt,
      evidenceClass,
      label,
      findings,
      limitations,
      unknownReasons: ["manifest_not_object"],
      readPaths,
      scriptsExecuted,
      spawnInvocations,
      inputValidity: "invalid",
      packageRoot,
    });
  }

  const lifecycle = listLifecycleScripts(manifest);
  if (lifecycle.length > 0) {
    findings.push({
      kind: "lifecycle_scripts_present",
      names: lifecycle.map((s) => s.name),
      commands: lifecycle.map((s) => s.command),
      executed: false,
      decision: "unknown",
      rationale: "Lifecycle scripts recorded and not executed; installed shape remains unknown",
    });
    unknownReasons.push("lifecycle_scripts_present_not_executed");
    limitations.push("lifecycle scripts present but not executed");
  }

  const pathStrings = collectPathStrings(manifest);
  for (const item of pathStrings) {
    if (item.role === "export_key") {
      const inspected = inspectExportKey(packageRoot, item.value);
      if (!inspected.ok) findings.push({ ...inspected, field: item.field });
      continue;
    }
    const inspected = inspectManifestPath(packageRoot, item.field, item.value);
    if (!inspected.ok) findings.push(inspected);
  }

  const exportStats = countExportTree(manifest.exports);
  const importStats = countExportTree(manifest.imports);
  if (manifest.exports !== undefined && isOversizeExports(exportStats)) {
    findings.push({
      kind: "exports_map_oversize",
      entries: exportStats.entries,
      targets: exportStats.targets,
      capEntries: EXPORT_ENTRY_CAP,
      capTargets: EXPORT_TARGET_CAP,
      truncated: exportStats.truncated,
      coverage: "partial",
      decision: "unknown",
      rationale: "Enormous exports map; do not open one file per entry",
    });
    unknownReasons.push("exports_map_oversize");
    limitations.push("exports map truncated at cap; coverage partial");
  }
  if (manifest.imports !== undefined && isOversizeExports(importStats)) {
    findings.push({
      kind: "imports_map_oversize",
      entries: importStats.entries,
      targets: importStats.targets,
      coverage: "partial",
      decision: "unknown",
    });
    unknownReasons.push("imports_map_oversize");
  }

  const skipPerExportReads = isOversizeExports(exportStats) || isOversizeExports(importStats);

  const lockSources = [];
  for (const name of LOCKFILE_NAMES) {
    const lockPath = path.join(packageRoot, name);
    const st = lstatSafe(io, lockPath);
    if (!st.ok) continue;
    if (st.stat.isSymbolicLink()) {
      const target = readlinkSafe(io, lockPath);
      const inspected = inspectSymlinkTarget(packageRoot, lockPath, target.value || "");
      if (!inspected.ok) {
        findings.push(inspected);
        continue;
      }
    }
    if (!st.stat.isFile() && !st.stat.isSymbolicLink()) continue;
    const read = readBoundedFile(io, packageRoot, lockPath, MAX_MANIFEST_BYTES, readPaths);
    if (!read.ok) {
      findings.push({
        kind: "lockfile_unreadable",
        file: name,
        reason: read.reason,
        decision: "unknown",
      });
      unknownReasons.push("lockfile_unreadable");
      continue;
    }
    if (name === "package-lock.json" || name === "npm-shrinkwrap.json") {
      lockSources.push({ file: name, ...parsePackageLock(read.text) });
    } else if (name === "yarn.lock") {
      lockSources.push({ file: name, ...parseYarnLock(read.text) });
    } else if (name === "pnpm-lock.yaml") {
      lockSources.push({ file: name, ...parsePnpmLock(read.text) });
    }
  }

  const pins = collectManifestPins(manifest);
  const lockFindings = detectLockfileDisagreement({ manifestPins: pins, sources: lockSources });
  for (const f of lockFindings) {
    findings.push(f);
    if (f.kind === "lockfile_disagreement") unknownReasons.push("lockfile_disagreement");
    if (f.kind === "lockfile_unparseable") unknownReasons.push("lockfile_unparseable");
  }
  if (lockFindings.some((f) => f.kind === "lockfile_disagreement")) {
    limitations.push("lockfile disagreement");
  }

  walkTree(io, packageRoot, findings, unknownReasons);

  if (!skipPerExportReads) {
    classifyDeclaredSources(io, packageRoot, manifest, findings, unknownReasons, readPaths);
  } else {
    findings.push({
      kind: "source_reads_skipped",
      reason: "exports_or_imports_oversize",
      decision: "unknown",
      coverage: "partial",
    });
  }

  const hasInvalid = findings.some((f) => f.decision === "invalid");
  const inputValidity = hasInvalid ? "invalid" : findings.length > 0 ? "partial" : "ok";
  if (inputValidity !== "ok" && unknownReasons.length === 0) {
    unknownReasons.push(hasInvalid ? "invalid_hostile_input" : "partial_hostile_input");
  }

  return finalize({
    clock,
    createdAt,
    evidenceClass,
    label,
    findings,
    limitations,
    unknownReasons: dedupe(unknownReasons),
    readPaths,
    scriptsExecuted,
    spawnInvocations,
    inputValidity,
    packageRoot,
    lifecycle,
    exportStats,
    provenance: hashProvenance(manifestPath, manifestRead.buf, label, createdAt),
    callerRoot: options.callerRoot ? path.resolve(options.callerRoot) : null,
  });
}

export function toPacketPatch(scan) {
  return {
    schema: "s127.upgrade-impact.packet.v1",
    summary: scan.summary,
    limitations: scan.limitations,
    bindings: [],
    exportDiff: {
      added: [],
      removed: [],
      coverage: scan.inputValidity === "ok" ? "unknown" : "none",
    },
    usage: {
      dynamicImport: false,
      note: "c14 does not extract usage; hostile input short-circuits binding",
    },
  };
}

function finalize(state) {
  const decision = state.inputValidity === "invalid" ? "invalid" : "unknown";
  return {
    schema: HOSTILE_SCAN_SCHEMA,
    createdAt: state.createdAt,
    clock: state.clock,
    evidenceClass: state.evidenceClass,
    label: state.label,
    packageRoot: state.packageRoot,
    callerRoot: state.callerRoot || null,
    inputValidity: state.inputValidity,
    decision,
    summary: {
      nextAction: "unknown",
      unknownReasons: state.unknownReasons,
      unusedChanges: [],
      actionableChanges: [],
    },
    findings: state.findings,
    scripts: {
      present: (state.lifecycle || []).map((s) => s.name),
      commands: (state.lifecycle || []).map((s) => s.command),
      executed: state.scriptsExecuted,
      spawnInvocations: state.spawnInvocations,
    },
    exportStats: state.exportStats || null,
    readPaths: state.readPaths,
    limitations: dedupe(state.limitations),
    provenance: state.provenance || {
      label: state.label,
      coverage: "hostile-scan",
      retrievedAt: state.createdAt,
    },
    bindings: [],
    paidDemand: false,
  };
}

function collectPathStrings(manifest) {
  const out = [];
  for (const field of PATH_FIELDS) {
    if (manifest[field] !== undefined) collectStrings(manifest[field], field, out, { keysToo: field === "browser" });
  }
  if (manifest.bin !== undefined) collectStrings(manifest.bin, "bin", out, { keysToo: false });
  if (Array.isArray(manifest.files)) collectStrings(manifest.files, "files", out, { keysToo: false });
  if (manifest.directories !== undefined) collectStrings(manifest.directories, "directories", out, { keysToo: false });
  if (manifest.exports !== undefined) {
    collectStrings(manifest.exports, "exports", out, { keysToo: true, exportKeys: true });
  }
  if (manifest.imports !== undefined) {
    collectStrings(manifest.imports, "imports", out, { keysToo: true });
  }
  if (manifest.typesVersions !== undefined) {
    collectStrings(manifest.typesVersions, "typesVersions", out, { keysToo: false });
  }
  return out;
}

function collectStrings(node, field, out, { keysToo = false, exportKeys = false } = {}, depth = 0) {
  if (depth > 8) return;
  if (typeof node === "string") {
    out.push({ field, value: node, role: "path" });
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectStrings(item, field, out, { keysToo, exportKeys }, depth + 1);
    return;
  }
  if (node && typeof node === "object") {
    for (const key of Object.keys(node)) {
      if (keysToo && typeof key === "string" && (key.startsWith(".") || key.startsWith("/") || key.includes(".."))) {
        out.push({ field: `${field}.key`, value: key, role: exportKeys ? "export_key" : "path" });
      }
      collectStrings(node[key], `${field}.${key}`, out, { keysToo, exportKeys }, depth + 1);
    }
  }
}

function walkTree(io, packageRoot, findings, unknownReasons) {
  const queue = [{ dir: packageRoot, depth: 0 }];
  let n = 0;
  const seen = new Set();
  while (queue.length) {
    const { dir, depth } = queue.shift();
    if (seen.has(dir)) continue;
    seen.add(dir);
    let entries;
    try {
      entries = io.readdirSync(dir, { withFileTypes: true });
    } catch {
      findings.push({ kind: "readdir_failed", path: dir, decision: "unknown" });
      unknownReasons.push("readdir_failed");
      continue;
    }
    for (const ent of entries) {
      n += 1;
      if (n > MAX_WALK_ENTRIES) {
        findings.push({
          kind: "walk_capped",
          cap: MAX_WALK_ENTRIES,
          coverage: "partial",
          decision: "unknown",
        });
        unknownReasons.push("walk_capped");
        return;
      }
      const full = path.join(dir, ent.name);
      const isLink = typeof ent.isSymbolicLink === "function" ? ent.isSymbolicLink() : false;
      if (isLink) {
        const target = readlinkSafe(io, full);
        if (!target.ok) {
          findings.push({ kind: "symlink_unreadable", path: full, decision: "unknown" });
          unknownReasons.push("symlink_unreadable");
          continue;
        }
        const inspected = inspectSymlinkTarget(packageRoot, full, target.value);
        if (!inspected.ok) findings.push(inspected);
        else {
          findings.push({
            kind: "symlink_internal",
            path: full,
            target: target.value,
            decision: null,
          });
        }
        continue;
      }
      const isDir = typeof ent.isDirectory === "function" ? ent.isDirectory() : false;
      if (isDir && depth < MAX_WALK_DEPTH) {
        queue.push({ dir: full, depth: depth + 1 });
      }
    }
  }
}

function classifyDeclaredSources(io, packageRoot, manifest, findings, unknownReasons, readPaths) {
  const candidates = [];
  if (typeof manifest.main === "string") candidates.push({ field: "main", value: manifest.main });
  if (typeof manifest.module === "string") candidates.push({ field: "module", value: manifest.module });
  if (typeof manifest.types === "string") candidates.push({ field: "types", value: manifest.types });
  if (typeof manifest.exports === "string") candidates.push({ field: "exports", value: manifest.exports });

  for (const c of candidates) {
    const inspected = inspectManifestPath(packageRoot, c.field, c.value);
    if (!inspected.ok) continue;
    if (!looksLikeSourceName(c.value) && !looksLikeSourceName(inspected.resolved)) continue;
    const read = readBoundedFile(io, packageRoot, inspected.resolved, MAX_SOURCE_BYTES, readPaths);
    if (!read.ok) {
      if (read.kind === "path_traversal" || read.kind === "symlink_escape") {
        findings.push({ ...read, field: c.field });
      } else {
        findings.push({
          kind: "source_unreadable",
          field: c.field,
          path: inspected.resolved,
          reason: read.reason,
          decision: "unknown",
        });
        unknownReasons.push("source_unreadable");
      }
      continue;
    }
    const kind = classifySourceBuffer(read.buf);
    if (kind.kind === "binary" || kind.parseable === false) {
      findings.push({
        kind: "binary_source",
        field: c.field,
        path: inspected.resolved,
        reason: kind.reason,
        decision: "unknown",
        rationale: "Binary or non-UTF8 file declared as source; not parsed; not a caller defect",
      });
      unknownReasons.push("binary_source");
    }
  }
}

function readBoundedFile(io, packageRoot, absPath, maxBytes, readPaths) {
  const resolved = path.resolve(absPath);
  if (!pathIsInside(packageRoot, resolved)) {
    return { ok: false, kind: "path_traversal", reason: "escapes_package_root", decision: "invalid" };
  }
  const st = lstatSafe(io, resolved);
  if (!st.ok) return { ok: false, reason: st.reason, decision: "unknown", kind: "source_unreadable" };
  if (st.stat.isSymbolicLink()) {
    const target = readlinkSafe(io, resolved);
    const inspected = inspectSymlinkTarget(packageRoot, resolved, target.value || "");
    if (!inspected.ok) return { ok: false, ...inspected };
    return { ok: false, reason: "refusing_to_read_via_symlink", decision: "unknown", kind: "symlink_internal" };
  }
  if (!st.stat.isFile()) return { ok: false, reason: "not_file", decision: "unknown", kind: "source_unreadable" };
  if (st.stat.size > maxBytes) {
    return { ok: false, reason: "oversize", decision: "unknown", kind: "file_oversize", size: st.stat.size, cap: maxBytes };
  }
  let buf;
  try {
    buf = io.readFileSync(resolved);
    readPaths.push(resolved);
  } catch (err) {
    return { ok: false, reason: err?.code || "read_failed", decision: "unknown", kind: "source_unreadable" };
  }
  if (buf.length > maxBytes) {
    return { ok: false, reason: "oversize", decision: "unknown", kind: "file_oversize" };
  }
  const text = buf.includes(0) ? null : buf.toString("utf8");
  return { ok: true, buf, text };
}

function lstatSafe(io, p) {
  try {
    return { ok: true, stat: io.lstatSync(p) };
  } catch (err) {
    return { ok: false, reason: err?.code || "lstat_failed" };
  }
}

function readlinkSafe(io, p) {
  try {
    return { ok: true, value: String(io.readlinkSync(p)) };
  } catch (err) {
    return { ok: false, reason: err?.code || "readlink_failed" };
  }
}

function pathIsInside(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  const rel = path.relative(resolvedRoot, resolved);
  if (rel === "") return true;
  if (path.isAbsolute(rel)) return false;
  return rel !== ".." && !rel.startsWith(`..${path.sep}`);
}

function hashProvenance(filePath, buf, label, retrievedAt) {
  return {
    path: filePath,
    retrievedAt,
    contentSha256: crypto.createHash("sha256").update(buf).digest("hex"),
    coverage: "hostile-scan",
    label,
  };
}

function dedupe(list) {
  return [...new Set(list)];
}
