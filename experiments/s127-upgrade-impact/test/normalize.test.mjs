import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { SYNTHETIC, loadPipeline } from "./helpers.mjs";

test("normalizeInput refuses a missing clock", async () => {
  const { impl } = await loadPipeline();
  const result = impl.normalizeInput({
    caller: { manifestPath: join(SYNTHETIC, "callers/same-version-noop/package.json") },
    dependency: { name: "demo-widget" },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "missing_clock");
});

test("normalizeInput requires a dependency name", async () => {
  const { impl } = await loadPipeline();
  const result = impl.normalizeInput({
    clock: "2026-09-10T12:00:00.000Z",
    caller: { manifestPath: join(SYNTHETIC, "callers/same-version-noop/package.json") },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "missing_dependency_name");
});

test("normalizeInput resolves synthetic caller paths", async () => {
  const { impl } = await loadPipeline();
  const result = impl.normalizeInput({
    clock: "2026-09-10T12:00:00.000Z",
    evidenceClass: "synthetic",
    caller: {
      root: join(SYNTHETIC, "callers/removed-export-used"),
      manifestPath: join(SYNTHETIC, "callers/removed-export-used/package.json"),
      lockfilePath: join(SYNTHETIC, "callers/removed-export-used/package-lock.json"),
      sourceRoots: [join(SYNTHETIC, "callers/removed-export-used/src")],
      evidenceClass: "synthetic",
    },
    dependency: {
      name: "demo-widget",
      oldVersion: "1.0.0",
      newVersion: "2.0.0",
      oldTree: join(SYNTHETIC, "packages/demo-widget/1.0.0"),
      newTree: join(SYNTHETIC, "packages/demo-widget/2.0.0-removed-alpha"),
    },
  });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.clock, "2026-09-10T12:00:00.000Z");
  assert.equal(result.dependency.name, "demo-widget");
  assert.ok(result.caller.manifestPath.endsWith("package.json"));
});
