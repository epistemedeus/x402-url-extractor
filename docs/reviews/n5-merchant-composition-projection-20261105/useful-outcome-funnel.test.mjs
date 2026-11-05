import assert from "node:assert/strict";
import test from "node:test";
import {
  assertFunnelHonest,
  projectUsefulOutcomeFunnel,
} from "./useful-outcome-funnel.mjs";

test("empty window keeps every stage unknown, not zero", () => {
  const funnel = projectUsefulOutcomeFunnel([]);
  assert.equal(funnel.unknownCoverage, true);
  assert.equal(funnel.stageCounts.discovery, null);
  assert.equal(funnel.stageCounts.retained_use, null);
  assert.equal(funnel.bingCitations.status, "unknown");
  assert.equal(funnel.bingCitations.count, null);
  assert.equal(funnel.recognizedRevenueAtomic, "0");
  assertFunnelHonest(funnel);
});

test("observed stages count; usefulness unknown stays counted as unknown", () => {
  const funnel = projectUsefulOutcomeFunnel([
    { stage: "discovery", usefulness: "unknown" },
    { stage: "call", usefulness: null },
    {
      stage: "delivery",
      usefulness: "unknown",
      schemaVersion: "samedaydesk.outcome-binding.forward.v2",
    },
    {
      stage: "settlement",
      usefulness: "unknown",
      schemaVersion: "samedaydesk.commerce-rare-funnel-evidence.v1",
      captureVersion: "rare_funnel_capture_v1",
    },
    { stage: "not-a-stage", usefulness: "unknown" },
  ]);
  assert.equal(funnel.rowsAccepted, 4);
  assert.equal(funnel.rowsRejected, 1);
  assert.equal(funnel.forwardRows, 1);
  assert.equal(funnel.rareFunnelRows, 1);
  assert.equal(funnel.stageCounts.discovery, 1);
  assert.equal(funnel.stageCounts.call, 1);
  assert.equal(funnel.stageCounts.transport, 0);
  assert.equal(funnel.stageCounts.delivery, 1);
  assert.equal(funnel.stageCounts.settlement, 1);
  assert.equal(funnel.stageCounts.retained_use, 0);
  assert.equal(funnel.usefulnessUnknownCount, 4);
  assert.equal(funnel.unknownCoverage, false);
  assertFunnelHonest(funnel);
});

test("Bing stays unknown unless a citation cut is supplied", () => {
  const funnel = projectUsefulOutcomeFunnel(
    [{ stage: "call", usefulness: "unknown" }],
    { bingCitations: { count: 3 } },
  );
  assert.equal(funnel.bingCitations.status, "supplied");
  assert.equal(funnel.bingCitations.count, 3);
  assertFunnelHonest(funnel);
});
