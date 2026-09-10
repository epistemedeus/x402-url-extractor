import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { PACK_ROOT, SYNTHETIC, loadPipeline } from "./helpers.mjs";

test("acquirePackageTree hashes synthetic old tree as full coverage", async () => {
  const { impl } = await loadPipeline();
  const acq = impl.acquirePackageTree({
    path: join(SYNTHETIC, "packages/demo-widget/1.0.0"),
    label: "synthetic",
    retrievedAt: "2026-09-10T12:00:00.000Z",
    packRoot: PACK_ROOT,
  });
  assert.equal(acq.coverage, "full");
  assert.ok(acq.entryPath);
  assert.ok(acq.treeSha256);
  assert.ok(acq.provenance.every((row) => row.label === "synthetic"));
  assert.ok(acq.provenance.every((row) => row.contentSha256));
  assert.ok(acq.provenance.some((row) => String(row.path).endsWith("index.js")));
});

test("acquirePackageTree reports partial when the entry is missing", async () => {
  const { impl } = await loadPipeline();
  const acq = impl.acquirePackageTree({
    path: join(SYNTHETIC, "packages/demo-widget/2.0.0-partial"),
    label: "synthetic",
    retrievedAt: "2026-09-10T12:00:00.000Z",
    packRoot: PACK_ROOT,
  });
  assert.equal(acq.coverage, "partial");
  assert.equal(acq.entryPath, null);
  assert.ok((acq.limitations || []).some((row) => /entry/i.test(row) || /partial/i.test(row) || /missing/i.test(row)));
});

test("acquirePackageTree unknown when path does not exist", async () => {
  const { impl } = await loadPipeline();
  const acq = impl.acquirePackageTree({
    path: join(SYNTHETIC, "packages/demo-widget/not-a-tree"),
    label: "synthetic",
    retrievedAt: "2026-09-10T12:00:00.000Z",
  });
  assert.equal(acq.coverage, "unknown");
  assert.equal(acq.ok, false);
});
