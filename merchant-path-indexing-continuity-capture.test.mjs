import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runIndexingContinuityCapture } from "./merchant-path-indexing-continuity-capture.mjs";

describe("merchant-path indexing continuity capture", () => {
  it("fills omitted indexing fields on verify+settle and rejects mismatches", async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), "s241-capture-test-"));
    try {
      const report = await runIndexingContinuityCapture({ outDir });
      assert.equal(report.ok, true, JSON.stringify(report.assertions));
      assert.equal(report.cases.callerOmitsResource.verify["resource.url"], true);
      assert.equal(report.cases.callerOmitsResource.settle["extensions.bazaar"], true);
      assert.equal(report.cases.mismatchedResource.facilitatorCalls.verify, 0);
      assert.equal(report.cases.wrongTypedResource.merchantResponseStatus >= 400, true);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
