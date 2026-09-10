#!/usr/bin/env node
/**
 * Public export-surface diff between two extracted package roots.
 *
 * A newer package version is not itself an export change. Identical tree
 * hashes short-circuit to an empty diff. Rename is heuristic and only
 * emitted when both sides supply a comparable signature plus name proximity.
 *
 * Schema: s127.upgrade-impact.export-diff.v1
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyExportDiff } from "../cells/c05-export-diff/classify.mjs";
import { scanExportSurface, initLexers } from "../cells/c05-export-diff/scan.mjs";
import {
  computeTreeHash,
  computeTreeHashIgnoringPackageVersion,
} from "../cells/c05-export-diff/tree-hash.mjs";

export const SCHEMA = "s127.upgrade-impact.export-diff.v1";
export const CELL_ID = "c05-export-diff";

export { computeTreeHash, computeTreeHashIgnoringPackageVersion, initLexers, scanExportSurface };

/**
 * @param {object} input
 * @param {string} input.oldRoot
 * @param {string} input.newRoot
 * @param {string} [input.oldTreeHash]
 * @param {string} [input.newTreeHash]
 * @param {number} [input.maxFiles]
 * @param {number} [input.maxBytesPerFile]
 * @param {number} [input.maxReexportDepth]
 * @param {number} [input.maxSignatureChars]
 * @param {string} [input.clock]
 */
export async function diffExports(input = {}) {
  const clock = input.clock || new Date().toISOString();
  const oldRoot = input.oldRoot ? resolve(input.oldRoot) : null;
  const newRoot = input.newRoot ? resolve(input.newRoot) : null;

  const limitations = [
    "Not a full TypeScript checker; .d.ts uses es-module-lexer plus bounded head extract.",
    "Dynamic import and unexpanded exports globs stay unknown/partial.",
    "Rename is heuristic; emitted only with same comparable signature and name proximity.",
    "No runtime execution of package code.",
  ];

  if (!oldRoot || !newRoot) {
    return fail("missing-root", "oldRoot and newRoot are required", { clock, limitations });
  }
  if (!existsSync(oldRoot) || !existsSync(newRoot)) {
    return fail("missing-root", "extracted root does not exist", {
      clock,
      limitations,
      oldRoot,
      newRoot,
      oldExists: existsSync(oldRoot),
      newExists: existsSync(newRoot),
    });
  }

  const computedOld = computeTreeHash(oldRoot);
  const computedNew = computeTreeHash(newRoot);
  const providedOld = input.oldTreeHash || null;
  const providedNew = input.newTreeHash || null;
  const hashNotes = [];
  if (providedOld && providedOld !== computedOld) {
    hashNotes.push("provided oldTreeHash disagrees with computed tree hash; using computed");
  }
  if (providedNew && providedNew !== computedNew) {
    hashNotes.push("provided newTreeHash disagrees with computed tree hash; using computed");
  }

  const identicalTree = computedOld === computedNew;
  if (identicalTree) {
    return {
      schema: SCHEMA,
      ok: true,
      clock,
      oldRoot,
      newRoot,
      treeHash: { old: computedOld, new: computedNew, identical: true },
      versionBumpOnly: false,
      identicalTree: true,
      exportDiff: emptyDiff("full"),
      oldSurface: null,
      newSurface: null,
      provenance: [fixtureProvenance(oldRoot), fixtureProvenance(newRoot)],
      limitations,
      unknownReasons: hashNotes,
      notes: ["same tree hash ⇒ empty diff; version was not consulted"],
    };
  }

  const exportTreeOld = computeTreeHashIgnoringPackageVersion(oldRoot);
  const exportTreeNew = computeTreeHashIgnoringPackageVersion(newRoot);

  const scanOpts = {
    maxFiles: input.maxFiles,
    maxBytesPerFile: input.maxBytesPerFile,
    maxReexportDepth: input.maxReexportDepth,
    maxSignatureChars: input.maxSignatureChars,
  };
  const [oldSurface, newSurface] = await Promise.all([
    scanExportSurface(oldRoot, scanOpts),
    scanExportSurface(newRoot, scanOpts),
  ]);

  const classified = classifyExportDiff(oldSurface, newSurface);
  const versionsDiffer = (oldSurface.version || null) !== (newSurface.version || null);
  const surfacesEqual =
    classified.added.length === 0 &&
    classified.removed.length === 0 &&
    classified.renamed.length === 0 &&
    classified.signatureChanged.length === 0;
  const versionBumpOnly = versionsDiffer && surfacesEqual && exportTreeOld === exportTreeNew;

  if (versionBumpOnly) {
    classified.added = [];
    classified.removed = [];
    classified.renamed = [];
    classified.signatureChanged = [];
  }

  const coverage = joinCoverage(
    classified.coverage,
    oldSurface.ok === false || newSurface.ok === false ? "unknown" : classified.coverage,
  );

  const unknownReasons = unique([
    ...hashNotes,
    ...classified.unknownReasons,
    ...(oldSurface.ok ? [] : oldSurface.unknownReasons),
    ...(newSurface.ok ? [] : newSurface.unknownReasons),
  ]);
  const allLimits = unique([...limitations, ...classified.limitations]);

  return {
    schema: SCHEMA,
    ok: oldSurface.ok && newSurface.ok,
    clock,
    oldRoot,
    newRoot,
    treeHash: { old: computedOld, new: computedNew, identical: false },
    exportRelevantTreeHash: { old: exportTreeOld, new: exportTreeNew, identical: exportTreeOld === exportTreeNew },
    versionBumpOnly,
    identicalTree: false,
    versions: { old: oldSurface.version ?? null, new: newSurface.version ?? null },
    exportDiff: {
      added: classified.added,
      removed: classified.removed,
      renamed: classified.renamed,
      signatureChanged: classified.signatureChanged,
      coverage,
    },
    oldSurface: summarizeSurface(oldSurface),
    newSurface: summarizeSurface(newSurface),
    provenance: [fixtureProvenance(oldRoot), fixtureProvenance(newRoot)],
    limitations: allLimits,
    unknownReasons,
    notes: versionBumpOnly
      ? ["version bump alone is not an export change; surfaces and non-version tree match"]
      : [],
  };
}

function emptyDiff(coverage) {
  return { added: [], removed: [], renamed: [], signatureChanged: [], coverage };
}

function fail(code, message, extra) {
  return {
    schema: SCHEMA,
    ok: false,
    code,
    message,
    exportDiff: emptyDiff("unknown"),
    identicalTree: false,
    versionBumpOnly: false,
    provenance: [],
    unknownReasons: [message],
    ...extra,
  };
}

function summarizeSurface(surface) {
  if (!surface) return null;
  return {
    ok: surface.ok,
    coverage: surface.coverage,
    packageName: surface.packageName,
    version: surface.version,
    filesScanned: surface.filesScanned,
    symbolCount: (surface.symbols || []).length,
    unknownReasons: surface.unknownReasons,
    limitations: surface.limitations,
  };
}

function fixtureProvenance(root) {
  return {
    path: root,
    label: "fixture",
    coverage: "extracted-root",
    note: "Caller supplies extracted package roots. This cell does not fetch the network.",
  };
}

function joinCoverage(a, b) {
  const ranks = { unknown: 0, partial: 1, full: 2 };
  const left = ranks[a] ?? 0;
  const right = ranks[b] ?? 0;
  const rank = Math.min(left, right);
  return rank === 2 ? "full" : rank === 1 ? "partial" : "unknown";
}

function unique(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--old") out.oldRoot = argv[++i];
    else if (a === "--new") out.newRoot = argv[++i];
    else if (a === "--old-hash") out.oldTreeHash = argv[++i];
    else if (a === "--new-hash") out.newTreeHash = argv[++i];
    else if (a === "--clock") out.clock = argv[++i];
  }
  return out;
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  diffExports(args)
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exitCode = result.ok ? 0 : 1;
    })
    .catch((err) => {
      process.stderr.write(`${err?.stack || err}\n`);
      process.exitCode = 1;
    });
}
