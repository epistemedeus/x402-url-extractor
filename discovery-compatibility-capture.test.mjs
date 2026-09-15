import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runDiscoveryCompatibilityCapture } from "./discovery-compatibility-capture.mjs";

describe("discovery compatibility capture", () => {
  it("fills omitted/empty indexing fields, retains conflicting resource, and distinguishes extension-response states", async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), "h37-discovery-capture-"));
    try {
      const report = await runDiscoveryCompatibilityCapture({ outDir });
      assert.equal(report.ok, true, JSON.stringify(report.assertions));
      assert.equal(report.automaticPaidRetry, false);
      assert.equal(report.cases.wrongRouteOpportunityPayloadOnSia.facilitatorCalls.verify, 0);
      assert.equal(report.cases.opportunityEmptyBazaarObject.facilitatorCalls.verify, 0);
      assert.equal(
        report.cases.opportunityConflictingResource.verify.envelope.resourceUrl,
        "https://evil.example/work/opportunity-preflight",
      );
      assert.equal(report.cases.headerAbsent.verify.extensionHeaderClassification.headerState, "absent");
      assert.equal(report.cases.headerEmpty.verify.extensionHeaderClassification.headerState, "empty");
      assert.equal(report.cases.headerMalformed.verify.extensionHeaderClassification.headerState, "malformed");
      assert.equal(
        report.cases.headerDecodedEmptyObject.verify.extensionHeaderClassification.headerState,
        "decoded",
      );
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
