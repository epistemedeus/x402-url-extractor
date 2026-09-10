import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
export const PACK_ROOT = join(here, "..");
export const SYNTHETIC = join(PACK_ROOT, "fixtures/synthetic");
export const STUB_LIB = join(PACK_ROOT, "cells/c10-tests-fixtures/lib");
export const CLI = join(PACK_ROOT, "scripts/cli.mjs");
export const CLOCK = "2026-09-10T12:00:00.000Z";

const STUB_MODULES = [
  "normalize",
  "lockfile",
  "imports",
  "acquire",
  "export-diff",
  "bind",
  "unknown",
  "prior",
  "packet",
  "validate",
  "cases",
  "scan-source",
];

const SRC_MODULES = [
  "normalize",
  "lockfile",
  "imports",
  "acquire",
  "export-diff",
  "bind",
  "unknown",
  "prior",
];

export function jsonReady(value) {
  return JSON.parse(JSON.stringify(value));
}

export async function importMaybe(absPath) {
  if (!absPath || !existsSync(absPath)) return null;
  return import(pathToFileURL(absPath).href);
}

export async function loadStubModules() {
  const stub = {};
  for (const name of STUB_MODULES) {
    stub[name] = await import(pathToFileURL(join(STUB_LIB, `${name}.mjs`)).href);
  }
  const impl = {
    normalizeInput: stub.normalize.normalizeInput,
    resolveDependency: stub.lockfile.resolveDependency,
    rangeSatisfies: stub.lockfile.rangeSatisfies,
    analyzeImports: stub.imports.analyzeImports,
    acquirePackageTree: stub.acquire.acquirePackageTree,
    diffExports: stub["export-diff"].diffExports,
    bindUsageToDiff: stub.bind.bindUsageToDiff,
    applyUnknownRules: stub.unknown.applyUnknownRules,
    summarizeBindings: stub.unknown.summarizeBindings,
    loadPrior: stub.prior.loadPrior,
    attachPrior: stub.prior.attachPrior,
    applyCorrection: stub.prior.applyCorrection,
    assertImmutable: stub.prior.assertImmutable,
    writeSequencedArtifact: stub.prior.writeSequencedArtifact,
    composePacket: stub.packet.composePacket,
    buildPacket: stub.packet.buildPacket,
    validatePacket: stub.validate.validatePacket,
    scanModuleSource: stub["scan-source"].scanModuleSource,
  };
  const stubCompose = (input) => stub.packet.composePacket(input, stub.packet.stubImpl());
  return { stub, impl, compose: stubCompose, stubCompose };
}

export async function loadSrcModules() {
  const src = {};
  const present = {};
  for (const name of SRC_MODULES) {
    const path = join(PACK_ROOT, "src", `${name}.mjs`);
    src[name] = await importMaybe(path);
    present[name] = Boolean(src[name]);
  }
  return { src, present };
}

/**
 * Catalog / golden / decision-rule tests always use the c10 stub so they
 * pin PACKET-CONTRACT.md against synthetic fixtures. `src` is the live
 * sibling modules (different export names); see test/src-modules.test.mjs.
 */
export async function loadPipeline() {
  const stubPart = await loadStubModules();
  const srcPart = await loadSrcModules();
  return {
    ...stubPart,
    src: srcPart.src,
    srcPresent: srcPart.present,
    sources: Object.fromEntries(STUB_MODULES.map((name) => [name, "stub"])),
  };
}

export function assertCaseExpectations(assert, packet, spec) {
  const expect = spec.expect || {};
  if (expect["summary.nextAction"]) {
    assert.equal(packet.summary.nextAction, expect["summary.nextAction"], spec.id);
  }
  if (expect["exportDiff.removed"]) {
    assert.deepEqual(packet.exportDiff.removed, expect["exportDiff.removed"]);
  }
  if (expect["exportDiff.added"]) {
    assert.deepEqual(packet.exportDiff.added, expect["exportDiff.added"]);
  }
  if (expect["exportDiff.renamed"]) {
    assert.deepEqual(packet.exportDiff.renamed, expect["exportDiff.renamed"]);
  }
  if (expect["exportDiff.signatureChanged"]) {
    assert.deepEqual(packet.exportDiff.signatureChanged, expect["exportDiff.signatureChanged"]);
  }
  if (expect["exportDiff.coverage"]) {
    assert.equal(packet.exportDiff.coverage, expect["exportDiff.coverage"]);
  }
  if (expect.actionableSymbols) {
    assert.deepEqual(
      packet.summary.actionableChanges.map((row) => row.symbol).sort(),
      expect.actionableSymbols.slice().sort(),
    );
  }
  if (expect.unusedSymbols) {
    assert.deepEqual(
      packet.summary.unusedChanges.map((row) => row.symbol).sort(),
      expect.unusedSymbols.slice().sort(),
    );
  }
  if (expect.unknownReasonsInclude) {
    for (const reason of expect.unknownReasonsInclude) {
      assert.ok(
        packet.summary.unknownReasons.includes(reason),
        `${spec.id}: expected unknown reason ${reason}, got ${JSON.stringify(packet.summary.unknownReasons)}`,
      );
    }
  }
  if (expect.limitationsInclude) {
    for (const note of expect.limitationsInclude) {
      assert.ok(
        packet.limitations.some((row) => String(row).includes(note)),
        `${spec.id}: expected limitation containing ${note}, got ${JSON.stringify(packet.limitations)}`,
      );
    }
  }
  if (expect.usageDynamicImport) {
    assert.ok(
      packet.usage.some((row) => row.dynamicImport === true),
      `${spec.id}: expected a dynamicImport usage row`,
    );
  }
  if (expect.bindings) {
    for (const want of expect.bindings) {
      const found = packet.bindings.find((row) => row.symbol === want.symbol && row.used === want.used);
      assert.ok(found, `${spec.id}: missing binding ${want.symbol} used=${want.used}`);
      if (want.changeKind) assert.equal(found.changeKind, want.changeKind, spec.id);
      if (want.decision) assert.equal(found.decision, want.decision, spec.id);
    }
  }
}

export function runCli(args, { timeout = 20000 } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    timeout,
    cwd: PACK_ROOT,
  });
}

export function skipIfNoCli(t) {
  if (!existsSync(CLI)) {
    t.skip("TODO: scripts/cli.mjs not present yet (c09)");
    return true;
  }
  return false;
}

export function changeNames(list) {
  return (list || []).map((row) => (typeof row === "string" ? row : row?.name || row?.symbol || row?.from)).filter(Boolean);
}

export function usageNames(usage) {
  const names = [];
  for (const row of usage || []) {
    if (row.typeOnly) continue;
    if (Array.isArray(row.names)) names.push(...row.names);
    if (typeof row.symbol === "string") names.push(row.symbol);
  }
  return names;
}
