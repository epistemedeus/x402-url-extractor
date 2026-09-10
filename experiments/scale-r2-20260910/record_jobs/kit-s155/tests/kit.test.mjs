import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildKitManifest,
  runCleanInstallCheck,
  runKitJourney,
  runKitRequest,
  validateKitRequest,
} from "../src/kit.mjs";
import { HEAVY_PIN_SHA, JOB_STATUS, KIT_STATUS } from "../src/constants.mjs";
import { resolveHeavyRoot } from "../src/heavy-invoke.mjs";
import { resolveNativeRoot } from "../src/native-invoke.mjs";
import { probeCsvS154Semantics, runCsvDriftWrapped } from "../src/csv-wrapper.mjs";

const clock = () => Date.parse("2026-09-10T20:00:00.000Z");

test("manifest: 7 ready + 1 meta; Heavy pin 65ce1867; CSV included", () => {
  const m = buildKitManifest({ clock });
  assert.equal(m.heavyPin.sha, HEAVY_PIN_SHA);
  assert.equal(m.summary.readyCount, 7);
  assert.equal(m.summary.metaCount, 1);
  assert.ok(m.jobs.some((j) => j.id === "csv-drift" && j.status === "ready"));
  assert.ok(m.jobs.some((j) => j.id === "openapi-impact"));
  assert.ok(m.jobs.some((j) => j.id === "pricing-table-change"));
  assert.ok(m.jobs.some((j) => j.id === "rss-atom-brief"));
  assert.ok(m.jobs.some((j) => j.id === "source-record-kit" && j.status === "meta"));
  assert.equal(m.hasInvestmentRecommendation, undefined);
});

test("clean-install check passes with heavy + native paths", () => {
  const c = runCleanInstallCheck();
  assert.equal(c.ok, true, JSON.stringify(c.checks.filter((x) => !x.pass)));
});

test("heavy/native path resolution defaults", () => {
  const h = resolveHeavyRoot();
  assert.equal(h.found, true);
  assert.match(h.root, /samedaydesk-s154-record-65ce1867/);
  for (const id of ["route-regression", "deadline-calendar", "dependency-footprint"]) {
    const n = resolveNativeRoot(id);
    assert.equal(n.found, true, id);
  }
});

test("positive journey request runs heavy+native+meta", async () => {
  const pkg = await runKitRequest(
    {
      requestId: "t-positive",
      jobIds: [
        "openapi-impact",
        "pricing-table-change",
        "csv-drift",
        "rss-atom-brief",
        "route-regression",
        "source-record-kit",
      ],
    },
    { clock },
  );
  assert.equal(pkg.status, KIT_STATUS.READY, JSON.stringify(pkg.summary));
  assert.equal(pkg.hasInvestmentRecommendation, false);
  const byId = Object.fromEntries(pkg.jobs.map((j) => [j.jobId, j]));
  assert.equal(byId["openapi-impact"].status, JOB_STATUS.READY);
  assert.equal(byId["pricing-table-change"].status, JOB_STATUS.READY);
  assert.equal(byId["csv-drift"].status, JOB_STATUS.READY);
  assert.equal(byId["rss-atom-brief"].status, JOB_STATUS.READY);
  assert.equal(byId["route-regression"].status, JOB_STATUS.READY);
  assert.equal(byId["source-record-kit"].status, JOB_STATUS.META);
});

test("partial: missing native sibling → unavailable_native / partial kit", async () => {
  const pkg = await runKitRequest(
    { requestId: "t-partial", jobIds: ["openapi-impact", "route-regression"] },
    {
      clock,
      nativeRoots: { "route-regression": "/tmp/r2-kit-s155-no-05" },
    },
  );
  assert.equal(pkg.status, KIT_STATUS.PARTIAL);
  const route = pkg.jobs.find((j) => j.jobId === "route-regression");
  assert.equal(route.status, JOB_STATUS.UNAVAILABLE_NATIVE);
  const oa = pkg.jobs.find((j) => j.jobId === "openapi-impact");
  assert.equal(oa.status, JOB_STATUS.READY);
});

test("partial: missing heavy root → unavailable_heavy (no invented OpenAPI)", async () => {
  const pkg = await runKitRequest(
    { requestId: "t-no-heavy", jobIds: ["openapi-impact", "csv-drift"] },
    { clock, heavyRoot: "/tmp/r2-kit-s155-no-heavy" },
  );
  assert.equal(pkg.status, KIT_STATUS.PARTIAL);
  for (const j of pkg.jobs) {
    assert.equal(j.status, JOB_STATUS.UNAVAILABLE_HEAVY);
    assert.equal(j.output, null);
  }
});

test("refusal: forbidden claim rejected", async () => {
  const pkg = await runKitRequest(
    {
      requestId: "t-forbid",
      jobIds: ["openapi-impact"],
      investmentRecommendation: "buy",
    },
    { clock },
  );
  assert.equal(pkg.status, KIT_STATUS.REJECTED);
  assert.equal(pkg.error.code, "forbidden_claim");
});

test("refusal: unknown job rejected", async () => {
  const pkg = await runKitRequest(
    { requestId: "t-unk", jobIds: ["not-a-real-job"] },
    { clock },
  );
  assert.equal(pkg.status, KIT_STATUS.REJECTED);
  assert.equal(pkg.jobs[0].status, JOB_STATUS.UNKNOWN);
});

test("refusal: malformed request rejected", async () => {
  const pkg = await runKitRequest(["nope"], { clock });
  assert.equal(pkg.status, KIT_STATUS.REJECTED);
});

test("validateKitRequest normalizes jobIds", () => {
  const n = validateKitRequest({ jobIds: ["csv-drift"], requestId: "v1" });
  assert.equal(n.requestId, "v1");
  assert.deepEqual(n.jobIds, ["csv-drift"]);
});

test("CSV held-not-run inverted: csv IS run in positive path", async () => {
  const pkg = await runKitRequest(
    { requestId: "t-csv", jobIds: ["csv-drift"] },
    { clock },
  );
  assert.equal(pkg.status, KIT_STATUS.READY);
  assert.equal(pkg.jobs[0].status, JOB_STATUS.READY);
  assert.ok(pkg.jobs[0].output?.report?.module === "csv-drift" || pkg.jobs[0].output?.tool === "s134-csv-drift");
});

test("csv wrapper S154 semantics probe all pass", async () => {
  const probe = await probeCsvS154Semantics();
  assert.equal(probe.available, true);
  assert.equal(probe.allPass, true, JSON.stringify(probe.probes));
});

test("csv wrapper columns:false / relax:false passthrough", async () => {
  const matrix = await runCsvDriftWrapped("a,b\n1,2\n3,4\n", "a,b\n1,2\n3,4\n", {
    columns: false,
    relax: true,
  });
  assert.equal(matrix.beforeParsed.headerRecord, null);
  assert.equal(matrix.beforeParsed.rows.length, 3);

  const bad = await runCsvDriftWrapped("a,b\n1\n", "a,b\n1,2\n", { relax: false });
  assert.equal(bad.beforeParsed.ok, false);
  assert.equal(bad.beforeParsed.parseStatus, "error");
});

test("full journey writes change-output and covers all step kinds", async () => {
  const journey = await runKitJourney({ clock });
  assert.equal(journey.journey, true);
  assert.equal(journey.heavyPin.sha, HEAVY_PIN_SHA);
  const names = journey.steps.map((s) => s.name);
  for (const need of [
    "clean-install",
    "example",
    "partial-missing-native",
    "refusal-forbidden",
    "csv-s154-probe",
    "manifest",
  ]) {
    assert.ok(names.includes(need), need);
  }
  assert.equal(journey.steps.find((s) => s.name === "clean-install").result.ok, true);
  assert.equal(journey.steps.find((s) => s.name === "example").result.status, "ready");
  assert.equal(journey.steps.find((s) => s.name === "partial-missing-native").result.status, "partial");
  assert.equal(journey.steps.find((s) => s.name === "refusal-forbidden").result.status, "rejected");
  assert.equal(journey.steps.find((s) => s.name === "csv-s154-probe").result.allPass, true);
  assert.equal(journey.hasInvestmentRecommendation, false);
});
