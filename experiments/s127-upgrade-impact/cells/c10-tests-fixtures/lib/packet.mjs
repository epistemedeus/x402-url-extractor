import { acquirePackageTree } from "./acquire.mjs";
import { bindUsageToDiff } from "./bind.mjs";
import { BASELINE_LIMITATIONS, PACKET_SCHEMA } from "./constants.mjs";
import { diffExports } from "./export-diff.mjs";
import { posixRel } from "./fs-utils.mjs";
import { uniqueStrings } from "./hash.mjs";
import { analyzeImports } from "./imports.mjs";
import { resolveDependency } from "./lockfile.mjs";
import { normalizeInput } from "./normalize.mjs";
import { attachPrior, loadPrior } from "./prior.mjs";
import { applyUnknownRules, summarizeBindings } from "./unknown.mjs";
import { assertPacket } from "./validate.mjs";

export { PACKET_SCHEMA };

const STUB_IMPL = {
  normalizeInput,
  resolveDependency,
  analyzeImports,
  acquirePackageTree,
  diffExports,
  bindUsageToDiff,
  applyUnknownRules,
  loadPrior,
  attachPrior,
};

export function stubImpl() {
  return { ...STUB_IMPL };
}

function relMaybe(packRoot, value) {
  if (!value || !packRoot) return value;
  return posixRel(packRoot, value);
}

export function composePacket(input = {}, impl = STUB_IMPL) {
  const normalized = impl.normalizeInput(input);
  if (!normalized.ok) {
    return {
      ok: false,
      schema: PACKET_SCHEMA,
      code: normalized.code,
      message: normalized.message,
      clock: input.clock ?? null,
      createdAt: input.createdAt ?? input.clock ?? null,
      errors: normalized.errors || [normalized.code],
      limitations: [...BASELINE_LIMITATIONS],
    };
  }

  const packRoot = normalized.packRoot || input.packRoot || null;
  const clock = normalized.clock;
  const label = normalized.evidenceClass || "synthetic";

  const lockfile = impl.resolveDependency({
    lockfilePath: normalized.caller.lockfilePath,
    manifestPath: normalized.caller.manifestPath,
    name: normalized.dependency.name,
  });

  const usageResult = impl.analyzeImports(normalized.caller.sourceRoots, normalized.dependency.name, {
    callerRoot: normalized.caller.root,
  });

  const oldAcquire = impl.acquirePackageTree({
    path: normalized.dependency.oldTree,
    label,
    retrievedAt: clock,
    packRoot,
  });
  const newAcquire = impl.acquirePackageTree({
    path: normalized.dependency.newTree,
    label,
    retrievedAt: clock,
    packRoot,
  });

  const exportDiff = impl.diffExports(oldAcquire, newAcquire);
  const bound = impl.bindUsageToDiff({
    usage: usageResult,
    exportDiff,
    dependency: normalized.dependency,
  });

  const overlay = impl.applyUnknownRules({
    bindings: bound.bindings,
    unknownReasons: [...(bound.unknownReasons || []), ...(lockfile.unknownReasons || [])],
    exportDiff,
    usage: usageResult,
    lockfile,
    acquire: { old: oldAcquire, new: newAcquire },
    dependency: normalized.dependency,
    limitations: [
      ...BASELINE_LIMITATIONS,
      ...(usageResult.limitations || []),
      ...(exportDiff.limitations || []),
      ...(lockfile.limitations || []),
      ...(oldAcquire.limitations || []),
      ...(newAcquire.limitations || []),
    ],
  });

  const summary = summarizeBindings(overlay.bindings, overlay.unknownReasons);

  const resolvedOld = lockfile.resolved ?? normalized.dependency.resolvedOld ?? normalized.dependency.oldVersion;
  const resolvedNew = newAcquire.version ?? normalized.dependency.resolvedNew ?? normalized.dependency.newVersion;

  const provenance = dedupeProvenance([...(oldAcquire.provenance || []), ...(newAcquire.provenance || [])]);

  let packet = {
    schema: PACKET_SCHEMA,
    createdAt: normalized.createdAt,
    clock,
    caller: {
      manifestPath: relMaybe(packRoot, normalized.caller.manifestPath),
      lockfilePath: relMaybe(packRoot, normalized.caller.lockfilePath) || undefined,
      sourceRoots: (normalized.caller.sourceRoots || []).map((root) => relMaybe(packRoot, root)),
      evidenceClass: label,
    },
    dependency: {
      name: normalized.dependency.name,
      oldVersion: normalized.dependency.oldVersion,
      newVersion: normalized.dependency.newVersion,
      resolvedOld,
      resolvedNew,
      requestedRange: lockfile.requestedRange ?? null,
    },
    provenance,
    usage: usageResult.usage,
    exportDiff: {
      added: exportDiff.added,
      removed: exportDiff.removed,
      renamed: exportDiff.renamed || [],
      signatureChanged: exportDiff.signatureChanged || [],
      coverage: exportDiff.coverage,
    },
    bindings: overlay.bindings,
    summary,
    prior: { ref: null, sequence: 0, immutable: true, correction: null },
    limitations: uniqueStrings(overlay.limitations),
  };

  if (normalized.priorPath) {
    const priorLoad = impl.loadPrior(normalized.priorPath);
    packet = impl.attachPrior(packet, priorLoad);
    if (packet.prior?.ref && packRoot) {
      packet.prior = { ...packet.prior, ref: relMaybe(packRoot, packet.prior.ref) };
    }
  }

  packet.ok = true;
  assertPacket(packet);
  return packet;
}

export function buildPacket(input, impl) {
  return composePacket(input, impl);
}

function dedupeProvenance(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = `${row.url || ""}|${row.path || ""}|${row.contentSha256 || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  out.sort((a, b) => {
    const ka = `${a.path || a.url || ""}`;
    const kb = `${b.path || b.url || ""}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return out;
}
