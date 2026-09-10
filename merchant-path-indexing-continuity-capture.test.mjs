import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runIndexingContinuityCapture } from "./merchant-path-indexing-continuity-capture.mjs";

describe("merchant-path indexing continuity capture", () => {
  it("fills omitted indexing fields without declining supported buyers", async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), "s245-capture-test-"));
    try {
      const report = await runIndexingContinuityCapture({ outDir });
      assert.equal(report.ok, true, JSON.stringify(report.assertions));
      assert.equal(report.cases.callerOmitsResource.verify["resource.url"], true);
      assert.equal(report.cases.callerOmitsResource.settle["extensions.bazaar"], true);
      assert.ok(report.cases.mismatchedResourceRetained.facilitatorCalls.verify >= 1);
      assert.equal(
        report.cases.mismatchedResourceRetained.verify.resourceUrlValue,
        "https://evil.example/commerce/seller-integrity-audit",
      );
      assert.equal(report.cases.mismatchedBazaarSdkEcho.facilitatorCalls.verify, 0);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
