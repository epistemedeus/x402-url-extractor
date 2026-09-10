import { lstatSync } from "node:fs";

/**
 * Translate CLI ctx into sibling src module APIs and back into packet overlays.
 * Sibling cells own the modules; this file only adapts.
 */

export async function adaptStage(stage, ctx) {
  const adapter = ADAPTERS[stage.id];
  if (!adapter) return genericCall(stage, ctx);
  return adapter(stage, ctx);
}

const ADAPTERS = {
  normalize: adaptNormalize,
  lockfile: adaptLockfile,
  acquire: adaptAcquire,
  imports: adaptImports,
  exportDiff: adaptExportDiff,
  bind: adaptBind,
  unknown: adaptUnknown,
  prior: adaptPrior,
};

async function adaptNormalize(stage, ctx) {
  const fn =
    stage.extraExports.normalizeCallerInput ||
    stage.extraExports.normalize ||
    stage.fn;
  if (typeof fn !== "function") return skipped(stage);
  const input = ctx.input;
  const raw = {
    clock: input.clock,
    name: input.dep,
    oldVersion: input.old,
    newVersion: input.new,
    manifestPath: input.manifestPath,
    lockfilePath: input.lockfilePath,
    sourceRoots: input.sourceRoots,
    evidenceClass: input.evidenceClass,
    caller: {
      manifestPath: input.manifestPath,
      lockfilePath: input.lockfilePath,
      sourceRoots: input.sourceRoots,
      evidenceClass: input.evidenceClass,
    },
    dependency: {
      name: input.dep,
      oldVersion: input.old,
      newVersion: input.new,
    },
  };
  const result = await fn(raw, { cwd: process.cwd(), workspaceRoot: process.cwd() });
  if (!result || typeof result !== "object") return { overlay: {} };
  const overlay = {
    limitations: result.limitations,
    unknownReasons: result.unknownReasons,
  };
  if (result.caller) overlay.caller = result.caller;
  if (result.dependency) overlay.dependency = result.dependency;
  if (result.ok === false) {
    overlay.unknownReasons = [
      ...(overlay.unknownReasons || []),
      ...(Array.isArray(result.issues) ? result.issues.map((row) => row.code || row.message).filter(Boolean) : []),
      "normalize_incomplete",
    ];
  }
  return { overlay };
}

async function adaptLockfile(stage, ctx) {
  const extras = stage.extraExports;
  const packet = ctx.packet;
  const manifestPath = ctx.input.manifestPath || packet.caller?.manifestPath;
  const lockfilePath = ctx.input.lockfilePath || packet.caller?.lockfilePath;
  if (!manifestPath && !lockfilePath) {
    return {
      overlay: {
        unknownReasons: ["lockfile_skipped_no_manifest"],
        limitations: ["lockfile stage skipped: no --manifest or --lockfile"],
      },
    };
  }

  let result;
  if (typeof extras.resolveCallerDependency === "function") {
    result = await extras.resolveCallerDependency({
      manifestPath,
      lockfilePath,
      name: packet.dependency?.name,
      clock: ctx.input.clock,
      evidenceClass: packet.caller?.evidenceClass,
    });
  } else {
    const fn = extras.resolveLockfile || extras.analyzeLockfile || extras.run;
    if (typeof fn !== "function") return skipped(stage);
    result = await fn({
      lockfilePath,
      manifestPath,
      name: packet.dependency?.name,
      oldVersion: packet.dependency?.oldVersion,
      newVersion: packet.dependency?.newVersion,
      dependency: packet.dependency,
      clock: ctx.input.clock,
    });
  }
  if (!result || typeof result !== "object") return { overlay: {} };

  const identity = result.identity || {};
  const conflicts = result.conflicts || result.disagreements || [];
  const disagreement =
    result.disagreement === true ||
    result.agreement === "conflict" ||
    result.agreement === "override" ||
    (Array.isArray(conflicts) && conflicts.length > 0);
  const overlay = {
    limitations: result.limitations,
    unknownReasons: result.unknownReasons,
    provenance: result.provenance,
    lockfile: {
      disagreement,
      agreement: result.agreement ?? null,
      identityStatus: result.identityStatus ?? null,
      conflicts,
      kind: result.lockfile?.kind || result.kind || null,
    },
    dependency: {
      resolvedOld: identity.resolvedVersion || result.resolvedOld || packet.dependency?.resolvedOld,
      lockfileDisagreement: disagreement,
    },
  };
  if (result.dependency) overlay.dependency = { ...overlay.dependency, ...result.dependency };
  return { overlay };
}

async function adaptAcquire(stage, ctx) {
  const extras = stage.extraExports;
  const dep = ctx.packet.dependency || {};
  const input = ctx.input;
  const oldDir = directoryIfExists(input.fixtureOld);
  const newDir = directoryIfExists(input.fixtureNew);
  if (oldDir && newDir) {
    return {
      overlay: {
        acquired: { oldRoot: oldDir, newRoot: newDir, mode: "fixture-dir" },
        limitations: ["using --fixture-old/--fixture-new directories as package roots (not registry tarballs)"],
      },
    };
  }

  const shared = {
    name: dep.name,
    oldVersion: dep.oldVersion,
    newVersion: dep.newVersion,
    clock: input.clock,
    mode: input.liveCapture === true ? "live" : "fixture",
  };

  if (input.liveCapture !== true && typeof extras.acquirePair === "function") {
    const pair = await extras.acquirePair(shared);
    return overlayFromAcquirePair(pair);
  }

  if (typeof extras.acquire === "function" && dep.name && dep.oldVersion && dep.newVersion) {
    const [oldResult, newResult] = await Promise.all([
      extras.acquire({ name: dep.name, version: dep.oldVersion, mode: shared.mode, clock: input.clock }),
      extras.acquire({ name: dep.name, version: dep.newVersion, mode: shared.mode, clock: input.clock }),
    ]);
    return overlayFromAcquirePair({ old: oldResult, new: newResult, name: dep.name });
  }

  return skipped(stage);
}

function overlayFromAcquirePair(pair) {
  if (!pair || typeof pair !== "object") return { overlay: {} };
  const oldResult = pair.old || null;
  const newResult = pair.new || null;
  const provenance = [];
  if (oldResult?.provenance) provenance.push(oldResult.provenance);
  if (newResult?.provenance) provenance.push(newResult.provenance);
  const limitations = [];
  const unknownReasons = [];
  if (oldResult && oldResult.ok === false) {
    limitations.push(`acquire old: ${oldResult.provenance?.error?.message || oldResult.message || "failed"}`);
    unknownReasons.push("acquire_old_failed");
  }
  if (newResult && newResult.ok === false) {
    limitations.push(`acquire new: ${newResult.provenance?.error?.message || newResult.message || "failed"}`);
    unknownReasons.push("acquire_new_failed");
  }
  return {
    overlay: {
      provenance,
      limitations,
      unknownReasons,
      acquired: {
        oldRoot: oldResult?.rootDir || null,
        newRoot: newResult?.rootDir || null,
        mode: oldResult?.provenance?.mode || null,
      },
    },
  };
}

async function adaptImports(stage, ctx) {
  const fn =
    stage.extraExports.analyzeStaticImports ||
    stage.extraExports.analyzeImports ||
    stage.extraExports.analyzeUsage ||
    stage.fn;
  if (typeof fn !== "function") return skipped(stage);
  const packet = ctx.packet;
  const sourceRoots = packet.caller?.sourceRoots?.length ? packet.caller.sourceRoots : ctx.input.sourceRoots;
  const result = await fn({
    packageName: packet.dependency?.name,
    sourceRoots,
    cwd: process.cwd(),
    provenanceLabel: packet.caller?.evidenceClass || "fixture",
  });
  if (!result || typeof result !== "object") return { overlay: {} };
  if (result.ok === false && result.error) {
    return {
      overlay: {
        usage: { items: [], dynamicImport: false, coverage: "unknown" },
        limitations: [result.error.message || "import analysis failed"],
        unknownReasons: [result.error.code || "imports_failed"],
      },
    };
  }
  const items = Array.isArray(result.usage) ? result.usage : Array.isArray(result.items) ? result.items : [];
  const dynamicImport = items.some((row) => row && (row.dynamicImport === true || row.dynamic === true));
  let coverage = "unknown";
  if (result.ok && items.length >= 0) {
    const unknownFiles = (result.filesUnknown || []).length + (result.filesPartial || []).length;
    coverage = unknownFiles > 0 ? "partial" : "complete";
  }
  if ((result.filesScanned || 0) === 0 && (result.filesSkipped || []).length > 0) coverage = "missing";
  return {
    overlay: {
      usage: {
        items,
        usage: items,
        references: items,
        dynamicImport,
        coverage,
        filesScanned: result.filesScanned,
        filesSkipped: result.filesSkipped,
        filesPartial: result.filesPartial,
        filesUnknown: result.filesUnknown,
        unresolvedDynamics: result.unresolvedDynamics,
        limitations: result.limitations,
        ok: result.ok !== false,
      },
      limitations: result.limitations,
      provenance: result.provenance?.parsers
        ? result.provenance.parsers.map((row) => ({
            url: row.url || null,
            path: row.vendored || null,
            retrievedAt: row.retrievedAt || null,
            contentSha256: row.contentSha256 || null,
            coverage: row.coverage || "unknown",
            label: row.label || "live-capture",
            role: "parser-vendor",
          }))
        : undefined,
    },
  };
}

async function adaptExportDiff(stage, ctx) {
  const fn = stage.extraExports.diffExports || stage.extraExports.exportDiff || stage.fn;
  if (typeof fn !== "function") return skipped(stage);
  const acquired = ctx.stages.acquire?.overlay?.acquired || ctx.packet.pipeline?.acquired || {};
  const result = await fn({
    oldRoot: acquired.oldRoot,
    newRoot: acquired.newRoot,
    clock: ctx.input.clock,
  });
  if (!result || typeof result !== "object") return { overlay: {} };
  const exportDiff = result.exportDiff || {
    added: [],
    removed: [],
    renamed: [],
    signatureChanged: [],
    coverage: "unknown",
  };
  return {
    overlay: {
      exportDiff,
      limitations: result.limitations,
      unknownReasons: result.unknownReasons,
      provenance: result.provenance,
    },
  };
}

async function adaptBind(stage, ctx) {
  const apply = stage.extraExports.applyBindToPacket;
  const bindFn = stage.extraExports.bind || stage.extraExports.bindUsageToExportDiff || stage.fn;
  if (typeof apply === "function") {
    const bound = apply(ctx.packet);
    return {
      overlay: {
        bindings: bound.bindings,
        summary: bound.summary,
        limitations: bound.limitations,
      },
    };
  }
  if (typeof bindFn !== "function") return skipped(stage);
  const result = await bindFn({
    usage: ctx.packet.usage,
    exportDiff: ctx.packet.exportDiff,
    dependency: ctx.packet.dependency,
    lockfile: ctx.packet.lockfile,
  });
  if (!result || typeof result !== "object") return { overlay: {} };
  const overlay = {
    bindings: result.bindings,
    summary: result.summary || {
      nextAction: result.nextAction,
      unknownReasons: result.unknownReasons,
      unusedChanges: result.unusedChanges,
      actionableChanges: result.actionableChanges,
    },
    limitations: result.limitations,
  };
  if (result.usage) overlay.usage = result.usage;
  if (result.exportDiff) overlay.exportDiff = result.exportDiff;
  return { overlay };
}

async function adaptUnknown(stage, ctx) {
  const extras = stage.extraExports;
  const apply = extras.applyUnknownPolicy || extras.applyUnknownRules || extras.applyUnknown || extras.run;
  const collect = extras.collectReasonsFromDraft;
  if (typeof apply !== "function") return skipped(stage);
  const draft = {
    usage: ctx.packet.usage,
    exportDiff: ctx.packet.exportDiff,
    dependency: ctx.packet.dependency,
    lockfile: ctx.packet.lockfile,
    provenance: ctx.packet.provenance,
    bindings: ctx.packet.bindings,
  };
  let reasons = [];
  if (typeof collect === "function") {
    reasons = collect(draft) || [];
  }
  const result = await apply({ bindings: ctx.packet.bindings, reasons, packet: ctx.packet, draft });
  if (!result || typeof result !== "object") return { overlay: {} };
  return {
    overlay: {
      bindings: result.bindings,
      summary: result.summary,
      limitations: result.limitations,
    },
  };
}

async function adaptPrior(stage, ctx) {
  const extras = stage.extraExports;
  if (!ctx.priorDoc) return { overlay: {} };
  let priorLike = ctx.priorDoc.document;
  if (typeof extras.loadPrior === "function" && ctx.input.priorPath) {
    const loaded = extras.loadPrior(ctx.input.priorPath);
    if (loaded && loaded.ok && loaded.prior) priorLike = loaded.prior;
    else if (typeof extras.createPrior === "function" && ctx.priorDoc.document) {
      const created = extras.createPrior(ctx.priorDoc.document, { clock: ctx.input.clock });
      if (created && created.ok) priorLike = created.prior;
    }
  } else if (typeof extras.createPrior === "function") {
    const created = extras.createPrior(ctx.priorDoc.document, { clock: ctx.input.clock });
    if (created && created.ok) priorLike = created.prior;
  }

  let correction = null;
  if (ctx.command === "correct" && typeof extras.correctPrior === "function") {
    const corrected = extras.correctPrior(priorLike, ctx.packet, { clock: ctx.input.clock });
    if (corrected && corrected.ok) correction = corrected.correction;
  }

  if (typeof extras.attachPrior === "function") {
    const attached = extras.attachPrior(ctx.packet, priorLike, correction);
    if (attached && attached.ok && attached.packet?.prior) {
      return { overlay: { prior: attached.packet.prior } };
    }
  }
  return { overlay: {} };
}

async function genericCall(stage, ctx) {
  if (typeof stage.fn !== "function") return skipped(stage);
  const result = await stage.fn(ctx);
  if (result && result.overlay) return result;
  return { overlay: result && typeof result === "object" ? result : {} };
}

function skipped(stage) {
  return { skipped: true, error: stage.error || "no adapter target" };
}

function directoryIfExists(path) {
  if (!path) return null;
  try {
    const st = lstatSync(path);
    if (st.isSymbolicLink()) return null;
    if (st.isDirectory()) return path;
    return null;
  } catch {
    return null;
  }
}
