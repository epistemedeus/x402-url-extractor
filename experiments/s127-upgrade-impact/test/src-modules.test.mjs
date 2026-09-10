import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { CLOCK, SYNTHETIC, changeNames, loadSrcModules, usageNames } from "./helpers.mjs";

function skipMissing(t, mod, label) {
  if (!mod) {
    t.skip(`TODO: src/${label}.mjs not present yet`);
    return true;
  }
  return false;
}

test("src/normalize.mjs refuses a missing clock", async (t) => {
  const { src } = await loadSrcModules();
  if (skipMissing(t, src.normalize, "normalize")) return;
  const fn = src.normalize.normalizeCallerInput || src.normalize.normalizeInput;
  assert.equal(typeof fn, "function");
  const result = fn(
    {
      caller: { manifestPath: join(SYNTHETIC, "callers/same-version-noop/package.json") },
      dependency: { name: "demo-widget" },
    },
    { workspaceRoot: SYNTHETIC },
  );
  assert.equal(result.ok, false);
  const codes = (result.issues || []).map((row) => row.code);
  assert.ok(
    result.code === "missing_clock" ||
      codes.includes("required") ||
      (result.unknownReasons || []).includes("missing_clock") ||
      result.status === "invalid",
  );
});

test("src/imports.mjs finds alpha/beta and marks type-only Alpha", async (t) => {
  const { src } = await loadSrcModules();
  if (skipMissing(t, src.imports, "imports")) return;
  const fn = src.imports.analyzeStaticImports || src.imports.analyzeImports;
  assert.equal(typeof fn, "function");
  const result = fn({
    packageName: "demo-widget",
    sourceRoots: [join(SYNTHETIC, "callers/removed-export-used/src")],
    cwd: join(SYNTHETIC, "callers/removed-export-used"),
  });
  assert.equal(result.ok ?? true, true);
  const runtime = usageNames(result.usage);
  assert.ok(runtime.includes("alpha"));
  assert.ok(runtime.includes("beta"));
  const typeOnly = (result.usage || []).filter((row) => row.typeOnly);
  assert.ok(
    typeOnly.some((row) => (row.names || [row.symbol]).includes("Alpha")) ||
      !runtime.includes("Alpha"),
  );
});

test("src/imports.mjs marks dynamic import() as unknown contribution", async (t) => {
  const { src } = await loadSrcModules();
  if (skipMissing(t, src.imports, "imports")) return;
  const fn = src.imports.analyzeStaticImports || src.imports.analyzeImports;
  const result = fn({
    packageName: "demo-widget",
    sourceRoots: [join(SYNTHETIC, "callers/dynamic-import/src")],
    cwd: join(SYNTHETIC, "callers/dynamic-import"),
  });
  assert.ok((result.usage || []).some((row) => row.dynamicImport === true || row.dynamic === true));
});

test("src/export-diff.mjs reports alpha removed on synthetic trees", async (t) => {
  const { src } = await loadSrcModules();
  if (skipMissing(t, src["export-diff"], "export-diff")) return;
  const fn = src["export-diff"].diffExports;
  assert.equal(typeof fn, "function");
  const result = await fn({
    oldRoot: join(SYNTHETIC, "packages/demo-widget/1.0.0"),
    newRoot: join(SYNTHETIC, "packages/demo-widget/2.0.0-removed-alpha"),
    clock: CLOCK,
  });
  const diff = result.exportDiff || result;
  assert.ok(changeNames(diff.removed).includes("alpha"), JSON.stringify(diff.removed));
  assert.equal(diff.coverage, "full");
});

test("src/export-diff.mjs partial new tree is not full coverage", async (t) => {
  const { src } = await loadSrcModules();
  if (skipMissing(t, src["export-diff"], "export-diff")) return;
  const result = await src["export-diff"].diffExports({
    oldRoot: join(SYNTHETIC, "packages/demo-widget/1.0.0"),
    newRoot: join(SYNTHETIC, "packages/demo-widget/2.0.0-partial"),
    clock: CLOCK,
  });
  const diff = result.exportDiff || result;
  assert.notEqual(diff.coverage, "full");
});

test("src/bind.mjs: used removal is actionable; unused removal is not", async (t) => {
  const { src } = await loadSrcModules();
  if (skipMissing(t, src.bind, "bind")) return;
  if (skipMissing(t, src.imports, "imports")) return;
  if (skipMissing(t, src["export-diff"], "export-diff")) return;
  const bindFn = src.bind.bind || src.bind.bindUsageToExportDiff || src.bind.bindUsageToDiff;
  const usageUsed = (src.imports.analyzeStaticImports || src.imports.analyzeImports)({
    packageName: "demo-widget",
    sourceRoots: [join(SYNTHETIC, "callers/removed-export-used/src")],
    cwd: join(SYNTHETIC, "callers/removed-export-used"),
  });
  const usageUnused = (src.imports.analyzeStaticImports || src.imports.analyzeImports)({
    packageName: "demo-widget",
    sourceRoots: [join(SYNTHETIC, "callers/removed-export-unused/src")],
    cwd: join(SYNTHETIC, "callers/removed-export-unused"),
  });
  const diff = await src["export-diff"].diffExports({
    oldRoot: join(SYNTHETIC, "packages/demo-widget/1.0.0"),
    newRoot: join(SYNTHETIC, "packages/demo-widget/2.0.0-removed-alpha"),
    clock: CLOCK,
  });
  const used = bindFn({
    usage: usageUsed,
    exportDiff: diff.exportDiff || diff,
    dependency: { name: "demo-widget", oldVersion: "1.0.0", newVersion: "2.0.0" },
  });
  const unused = bindFn({
    usage: usageUnused,
    exportDiff: diff.exportDiff || diff,
    dependency: { name: "demo-widget", oldVersion: "1.0.0", newVersion: "2.0.0" },
  });
  const usedNext = used.summary?.nextAction || used.nextAction;
  const unusedNext = unused.summary?.nextAction || unused.nextAction;
  assert.ok(["action", "review_breakages"].includes(usedNext), `used nextAction=${usedNext}`);
  assert.ok(used.bindings.some((row) => row.symbol === "alpha" && row.used === true && row.decision === "action"));
  assert.equal(unusedNext, "no_action");
  assert.ok(
    (unused.summary?.unusedChanges || unused.unusedChanges || []).some(
      (row) => (row.symbol || row) === "alpha",
    ),
  );
});

test("src/unknown.mjs demotes action on missing_source", async (t) => {
  const { src } = await loadSrcModules();
  if (skipMissing(t, src.unknown, "unknown")) return;
  const fn = src.unknown.applyUnknownPolicy || src.unknown.applyUnknownRules;
  const result = fn({
    bindings: [
      {
        symbol: "alpha",
        used: true,
        changeKind: "removed",
        decision: "action",
        rationale: "used removed",
      },
    ],
    reasons: ["missing_source"],
  });
  const next = result.summary?.nextAction || result.nextAction;
  assert.equal(next, "unknown");
  assert.equal((result.summary?.actionableChanges || []).length, 0);
});

test("src/lockfile.mjs flags prerelease range vs lockfile 2.0.0-beta.1", async (t) => {
  const { src } = await loadSrcModules();
  if (skipMissing(t, src.lockfile, "lockfile")) return;
  const fn = src.lockfile.resolveCallerDependency;
  if (typeof fn !== "function") {
    t.skip("TODO: src/lockfile.mjs resolveCallerDependency not present");
    return;
  }
  const resolved = fn({
    name: "demo-widget",
    manifestPath: join(SYNTHETIC, "callers/version-range-prerelease/package.json"),
    lockfilePath: join(SYNTHETIC, "callers/version-range-prerelease/package-lock.json"),
    clock: CLOCK,
    evidenceClass: "synthetic",
  });
  assert.equal(resolved.identity?.resolvedVersion, "2.0.0-beta.1");
  assert.equal(resolved.identity?.requestedSpec, "^1.0.0");
  const reasons = resolved.unknownReasons || [];
  assert.ok(
    resolved.agreement !== "match" ||
      reasons.length > 0 ||
      (resolved.conflicts || []).length > 0,
    `expected disagreement, got agreement=${resolved.agreement} reasons=${JSON.stringify(reasons)}`,
  );
});

test("src/prior.mjs loads the synthetic immutable prior", async (t) => {
  const { src } = await loadSrcModules();
  if (skipMissing(t, src.prior, "prior")) return;
  const loaded = src.prior.loadPrior(join(SYNTHETIC, "priors/removed-export-used.seq-1.json"));
  assert.equal(loaded.ok, true, loaded.message || loaded.code);
  assert.equal(loaded.prior.immutable, true);
  assert.equal(loaded.prior.sequence, 1);
});
