import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { EVIDENCE_LABELS } from "./constants.mjs";

function asCaller(input) {
  if (input?.caller && typeof input.caller === "object") return input.caller;
  return {
    root: input.callerRoot ?? input.root ?? null,
    manifestPath: input.manifestPath ?? null,
    lockfilePath: input.lockfilePath ?? null,
    sourceRoots: input.sourceRoots ?? null,
    evidenceClass: input.evidenceClass ?? null,
  };
}

function resolveMaybe(base, value) {
  if (!value) return null;
  if (isAbsolute(value)) return value;
  if (base) return resolve(base, value);
  return resolve(value);
}

export function normalizeInput(input = {}) {
  const errors = [];
  const clock = input.clock ?? null;
  if (!clock || typeof clock !== "string") {
    return {
      ok: false,
      code: "missing_clock",
      message: "clock is required; refusing to invent Date.now()",
      errors: ["missing_clock"],
    };
  }

  const rawCaller = asCaller(input);
  const root = resolveMaybe(input.baseDir ?? null, rawCaller.root);
  const manifestPath = resolveMaybe(root || input.baseDir, rawCaller.manifestPath);
  if (!manifestPath) {
    return {
      ok: false,
      code: "missing_manifest",
      message: "caller.manifestPath is required",
      errors: ["missing_manifest"],
    };
  }
  if (!existsSync(manifestPath)) {
    errors.push("manifest_missing_on_disk");
  }

  const lockfilePath = resolveMaybe(root || input.baseDir, rawCaller.lockfilePath);
  let sourceRoots = rawCaller.sourceRoots;
  if (!sourceRoots && root) sourceRoots = [join(root, "src"), root];
  if (!Array.isArray(sourceRoots) || sourceRoots.length === 0) {
    sourceRoots = root ? [root] : [];
  }
  sourceRoots = sourceRoots.map((entry) => resolveMaybe(root || input.baseDir, entry)).filter(Boolean);

  const evidenceClass = rawCaller.evidenceClass || input.evidenceClass || null;
  if (!evidenceClass) errors.push("missing_evidence_class");
  else if (!EVIDENCE_LABELS.includes(evidenceClass)) {
    errors.push(`invalid_evidence_class:${evidenceClass}`);
  }

  const depIn = input.dependency && typeof input.dependency === "object" ? input.dependency : {};
  const name = depIn.name || input.packageName || null;
  if (!name) {
    return {
      ok: false,
      code: "missing_dependency_name",
      message: "dependency.name is required",
      errors: ["missing_dependency_name"],
    };
  }

  const oldTree = resolveMaybe(input.baseDir, depIn.oldTree);
  const newTree = resolveMaybe(input.baseDir, depIn.newTree);

  return {
    ok: errors.length === 0,
    code: errors[0] || null,
    message: errors.length ? errors.join("; ") : null,
    errors,
    clock,
    createdAt: input.createdAt || clock,
    evidenceClass,
    caller: {
      root,
      manifestPath,
      lockfilePath: lockfilePath || null,
      sourceRoots,
      evidenceClass,
    },
    dependency: {
      name,
      oldVersion: depIn.oldVersion ?? null,
      newVersion: depIn.newVersion ?? null,
      oldTree,
      newTree,
      resolvedOld: depIn.resolvedOld ?? null,
      resolvedNew: depIn.resolvedNew ?? null,
    },
    priorPath: input.priorPath ? resolveMaybe(input.baseDir, input.priorPath) : null,
    packRoot: input.packRoot || null,
  };
}
