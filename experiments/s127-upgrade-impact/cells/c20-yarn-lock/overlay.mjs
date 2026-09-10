/**
 * Packet overlay for classic yarn.lock resolution (c20).
 *
 * Fills dependency.resolvedOld from the caller lockfile when unique.
 * Conflict / alias disagreement / berry / missing → unknown, not action.
 * Does not write outside this cell. Does not spawn yarn/npm. Does not fetch.
 */

import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { parseYarnLock, MAX_LOCKFILE_BYTES } from "./parse.mjs";
import { collectManifestPins, resolveYarnPackage } from "./resolve.mjs";

export const SCHEMA = "s127.c20.yarn-lock.overlay.v1";
export const PACKET_SCHEMA = "s127.upgrade-impact.packet.v1";

export const EVIDENCE_LABELS = Object.freeze(["fixture", "live-capture", "synthetic"]);

const BASE_LIMITATIONS = Object.freeze([
  "classic yarn.lock v1 only; yarn berry stays unknown",
  "single lockfile supplies resolvedOld; resolvedNew is not inferred from a declared version",
  "a newer version alone is not a break",
  "unused export change is not a caller defect",
  "no package-manager execution; no registry fetch; no lifecycle scripts",
]);

export function sha256Hex(value) {
  const input = typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value);
  return createHash("sha256").update(input).digest("hex");
}

export function readLockfileText(path, { maxBytes = MAX_LOCKFILE_BYTES } = {}) {
  if (!path || typeof path !== "string") {
    return { ok: false, code: "missing_path", path: path ?? null };
  }
  let st;
  try {
    st = lstatSync(path);
  } catch {
    return { ok: false, code: "missing_path", path };
  }
  if (st.isSymbolicLink()) {
    return { ok: false, code: "symlink_refused", path };
  }
  if (!st.isFile()) {
    return { ok: false, code: "not_a_file", path };
  }
  if (st.size > maxBytes) {
    return { ok: false, code: "oversize", path, bytes: st.size };
  }
  const buffer = readFileSync(path);
  if (buffer.includes(0)) {
    return { ok: false, code: "nul_byte", path, bytes: buffer.length };
  }
  return {
    ok: true,
    path,
    bytes: buffer.length,
    text: buffer.toString("utf8"),
    sha256: sha256Hex(buffer),
  };
}

function readJsonIfFile(path) {
  if (!path) return { ok: false, code: "missing_path", body: null };
  const loaded = readLockfileText(path, { maxBytes: 4 * 1024 * 1024 });
  if (!loaded.ok) return { ...loaded, body: null };
  try {
    return { ...loaded, body: JSON.parse(loaded.text) };
  } catch (err) {
    return {
      ok: false,
      code: "invalid_json",
      path,
      body: null,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function evidenceLabel(input, packet) {
  const raw =
    input?.evidenceClass ||
    packet?.caller?.evidenceClass ||
    input?.label ||
    null;
  if (EVIDENCE_LABELS.includes(raw)) return raw;
  if (input?.lockfilePath || input?.manifestPath) return "fixture";
  return "synthetic";
}

function packageNameOf(input, packet) {
  return (
    input?.dep ||
    input?.name ||
    input?.packageName ||
    packet?.dependency?.name ||
    null
  );
}

function declaredVersions(input, packet) {
  return {
    oldVersion: input?.old ?? input?.oldVersion ?? packet?.dependency?.oldVersion ?? null,
    newVersion: input?.new ?? input?.newVersion ?? packet?.dependency?.newVersion ?? null,
  };
}

function flattenCtx(ctx) {
  if (ctx == null) return { input: {}, packet: null, command: null };
  if (typeof ctx === "string") return { input: { lockfileText: ctx }, packet: null, command: null };
  if (ctx.input || ctx.packet) {
    return { input: ctx.input || {}, packet: ctx.packet || null, command: ctx.command || null };
  }
  return { input: ctx, packet: ctx.packet || null, command: ctx.command || null };
}

function provenanceRow({ path, sha256, bytes, clock, label, coverage, note }) {
  const row = {
    path: path || null,
    url: null,
    retrievedAt: clock || null,
    contentSha256: sha256 || null,
    coverage: coverage || "unknown",
    label,
  };
  if (typeof bytes === "number") row.bytes = bytes;
  if (note) row.note = note;
  return row;
}

function lockfileBlock(side, resolved, loaded, path) {
  return {
    side,
    kind: "yarn",
    path: path || null,
    format: resolved.format,
    coverage: resolved.coverage,
    parser: SCHEMA,
    status: resolved.status,
    resolvedVersion: resolved.version,
    resolvedUrl: resolved.resolvedUrl,
    integrity: resolved.integrity,
    uniqueVersions: resolved.uniqueVersions,
    aliases: resolved.aliases,
    conflicts: resolved.conflicts,
    disagreement: resolved.disagreement === true,
    aliasDisagreement: resolved.aliasDisagreement === true,
    unknownReasons: resolved.unknownReasons,
    bytes: loaded?.bytes ?? null,
    sha256: loaded?.sha256 ?? null,
  };
}

/**
 * Analyze one yarn.lock (optional second lockfile for resolvedNew).
 */
export function analyzeLockfile(options = {}) {
  const name = options.name || options.dep || null;
  const clock = options.clock || null;
  const label = EVIDENCE_LABELS.includes(options.evidenceClass)
    ? options.evidenceClass
    : options.lockfilePath
      ? "fixture"
      : "synthetic";

  const loaded = loadLockSource(options.lockfilePath, options.lockfileText);
  const manifestLoaded = options.manifest
    ? { ok: true, body: options.manifest }
    : options.manifestPath
      ? readJsonIfFile(options.manifestPath)
      : { ok: false, body: null };

  const provenance = [];
  const limitations = [...BASE_LIMITATIONS];
  if (!clock) limitations.push("clock not provided; provenance.retrievedAt omitted");

  if (!loaded.ok) {
    const reason = `yarn_lock_${loaded.code || "unreadable"}`;
    return {
      ok: false,
      schema: SCHEMA,
      status: "unknown",
      name,
      resolved: null,
      lockfile: {
        kind: "yarn",
        path: options.lockfilePath || null,
        format: "unknown",
        coverage: "unknown",
        disagreement: false,
        unknownReasons: [reason],
      },
      unknownReasons: [reason],
      limitations,
      provenance,
      decision: "unknown",
    };
  }

  provenance.push(
    provenanceRow({
      path: options.lockfilePath || "(inline)",
      sha256: loaded.sha256,
      bytes: loaded.bytes,
      clock,
      label,
      coverage: "classic-v1-or-unknown-until-parsed",
      note: "cell-local yarn.lock bytes; not a registry tarball",
    }),
  );

  const parsed = parseYarnLock(loaded.text);
  provenance[0].coverage = parsed.coverage;

  const resolved = resolveYarnPackage({
    parsed,
    name,
    manifest: manifestLoaded.ok ? manifestLoaded.body : null,
    declaredVersion: options.declaredVersion || options.oldVersion || null,
  });

  let resolvedNew = null;
  let newBlock = null;
  if (options.newLockfilePath || options.newLockfileText) {
    const newLoaded = loadLockSource(options.newLockfilePath, options.newLockfileText);
    if (!newLoaded.ok) {
      resolvedNew = {
        ok: false,
        status: "unknown",
        unknownReasons: [`yarn_lock_new_${newLoaded.code || "unreadable"}`],
        version: null,
        disagreement: false,
        aliasDisagreement: false,
        format: "unknown",
        coverage: "unknown",
        uniqueVersions: [],
        aliases: [],
        conflicts: [],
        resolvedUrl: null,
        integrity: null,
      };
    } else {
      provenance.push(
        provenanceRow({
          path: options.newLockfilePath || "(inline-new)",
          sha256: newLoaded.sha256,
          bytes: newLoaded.bytes,
          clock,
          label,
          coverage: "classic-v1-or-unknown-until-parsed",
          note: "optional second yarn.lock for resolvedNew",
        }),
      );
      const newParsed = parseYarnLock(newLoaded.text);
      provenance[provenance.length - 1].coverage = newParsed.coverage;
      resolvedNew = resolveYarnPackage({
        parsed: newParsed,
        name,
        manifest: manifestLoaded.ok ? manifestLoaded.body : null,
        declaredVersion: options.newVersion || null,
      });
      newBlock = lockfileBlock("new", resolvedNew, newLoaded, options.newLockfilePath);
    }
  }

  const disagreement =
    resolved.disagreement === true || resolvedNew?.disagreement === true;
  const aliasDisagreement =
    resolved.aliasDisagreement === true || resolvedNew?.aliasDisagreement === true;

  const unknownReasons = unique([
    ...(resolved.unknownReasons || []),
    ...(resolvedNew?.unknownReasons || []),
  ]);

  return {
    ok: parsed.ok === true && (resolvedNew ? resolvedNew.ok !== false || resolvedNew.status === "unknown" : true),
    schema: SCHEMA,
    status: disagreement || aliasDisagreement || resolved.status !== "resolved"
      ? "unknown"
      : "resolved",
    name,
    resolved,
    resolvedNew,
    lockfile: {
      ...lockfileBlock("old", resolved, loaded, options.lockfilePath),
      new: newBlock,
      disagreement,
      aliasDisagreement,
      pins: manifestLoaded.ok ? collectManifestPins(manifestLoaded.body) : [],
    },
    unknownReasons,
    limitations: unique([...limitations, ...(resolved.limitations || [])]),
    provenance,
    decision: disagreement || aliasDisagreement || resolved.status !== "resolved" ? "unknown" : "no_action",
    label,
  };
}

function loadLockSource(path, text) {
  if (typeof text === "string") {
    if (text.includes("\0")) return { ok: false, code: "nul_byte" };
    if (Buffer.byteLength(text, "utf8") > MAX_LOCKFILE_BYTES) return { ok: false, code: "oversize" };
    return { ok: true, text, bytes: Buffer.byteLength(text, "utf8"), sha256: sha256Hex(text), path: path || null };
  }
  if (path) return readLockfileText(path);
  return { ok: false, code: "missing_lockfile" };
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

/**
 * Integrator entry: resolveLockfile(ctx) → packet overlay.
 * Also exported as resolveDependency, analyzeLockfile-via-run, run.
 */
export function resolveLockfile(ctx) {
  const { input, packet, command } = flattenCtx(ctx);
  const name = packageNameOf(input, packet);
  const { oldVersion, newVersion } = declaredVersions(input, packet);
  const clock = input.clock || packet?.clock || packet?.createdAt || null;
  const label = evidenceLabel(input, packet);

  const analyzed = analyzeLockfile({
    lockfilePath: input.lockfilePath || packet?.caller?.lockfilePath || null,
    lockfileText: input.lockfileText || input.yarnLockText || null,
    newLockfilePath: input.newLockfilePath || null,
    newLockfileText: input.newLockfileText || null,
    manifestPath: input.manifestPath || packet?.caller?.manifestPath || null,
    manifest: input.manifest || null,
    name,
    oldVersion,
    newVersion,
    declaredVersion: oldVersion,
    clock,
    evidenceClass: label,
  });

  const resolvedOld = analyzed.resolved?.status === "resolved" ? analyzed.resolved.version : null;
  const resolvedNew =
    analyzed.resolvedNew?.status === "resolved" ? analyzed.resolvedNew.version : null;

  const disagreement = analyzed.lockfile?.disagreement === true;
  const aliasDisagreement = analyzed.lockfile?.aliasDisagreement === true;

  const overlay = {
    lockfile: analyzed.lockfile,
    dependency: {
      name,
      oldVersion,
      newVersion,
      resolvedOld,
      resolvedNew,
      lockfileDisagreement: disagreement,
      aliasDisagreement,
    },
    provenance: analyzed.provenance,
    limitations: analyzed.limitations,
    summary: {
      unknownReasons: analyzed.unknownReasons,
    },
  };

  if (disagreement || aliasDisagreement || analyzed.status === "unknown") {
    overlay.dependency.lockfileDisagreement = disagreement || analyzed.status === "unknown" && analyzed.resolved?.disagreement === true;
    overlay.summary.unknownReasons = unique([
      ...overlay.summary.unknownReasons,
      ...(disagreement || aliasDisagreement ? ["lockfile_alias_or_workspace_disagreement"] : []),
    ]);
  }

  overlay._c20 = {
    schema: SCHEMA,
    command: command || null,
    status: analyzed.status,
    decision: analyzed.decision,
    label,
    packetSchema: PACKET_SCHEMA,
  };

  return { overlay };
}

export function resolveDependency(ctx) {
  return resolveLockfile(ctx);
}

export function run(ctx) {
  return resolveLockfile(ctx);
}
