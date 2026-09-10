import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { SYNTHETIC, loadPipeline } from "./helpers.mjs";

test("synthetic catalog lists required cases and all files exist", async () => {
  const { stub } = await loadPipeline();
  const manifest = stub.cases.loadManifest();
  assert.equal(manifest.label, "synthetic");
  assert.equal(manifest.liveCapture ?? false, false);
  const required = manifest.requiredCaseIds;
  assert.deepEqual(required, [
    "removed-export-used",
    "removed-export-unused",
    "same-version-noop",
    "partial-missing-source",
    "dynamic-import",
    "renamed-export",
    "version-range-prerelease",
  ]);
  for (const id of [...required, ...manifest.extraCaseIds]) {
    const spec = stub.cases.loadCaseSpec(id);
    assert.equal(spec.label, "synthetic");
    assert.equal(spec.evidenceClass, "synthetic");
    assert.ok(existsSync(join(SYNTHETIC, spec.caller.manifestPath)), spec.caller.manifestPath);
    assert.ok(existsSync(join(SYNTHETIC, spec.caller.lockfilePath)), spec.caller.lockfilePath);
    for (const root of spec.caller.sourceRoots) {
      assert.ok(existsSync(join(SYNTHETIC, root)), root);
    }
    assert.ok(existsSync(join(SYNTHETIC, spec.dependency.oldTree)), spec.dependency.oldTree);
    assert.ok(existsSync(join(SYNTHETIC, spec.dependency.newTree)), spec.dependency.newTree);
    assert.ok(existsSync(join(SYNTHETIC, "goldens", `${id}.packet.json`)), id);
  }
  assert.ok(existsSync(join(SYNTHETIC, manifest.goldenPacket)));
  assert.ok(existsSync(join(SYNTHETIC, "PROVENANCE.json")));
  const provenance = JSON.parse(readFileSync(join(SYNTHETIC, "PROVENANCE.json"), "utf8"));
  assert.equal(provenance.label, "synthetic");
  assert.equal(provenance.liveCapture, false);
  assert.equal(provenance.paidDemand, false);
  assert.deepEqual(provenance.originalUrls, {});
});

test("partial new tree is missing the entry module on purpose", () => {
  assert.equal(existsSync(join(SYNTHETIC, "packages/demo-widget/2.0.0-partial/package.json")), true);
  assert.equal(existsSync(join(SYNTHETIC, "packages/demo-widget/2.0.0-partial/index.js")), false);
});

test("type-only import fixture exists next to runtime caller", () => {
  const ts = readFileSync(join(SYNTHETIC, "callers/removed-export-used/src/types.ts"), "utf8");
  assert.match(ts, /import type/);
  const js = readFileSync(join(SYNTHETIC, "callers/removed-export-used/src/app.js"), "utf8");
  assert.match(js, /import \{ alpha, beta \}/);
});
