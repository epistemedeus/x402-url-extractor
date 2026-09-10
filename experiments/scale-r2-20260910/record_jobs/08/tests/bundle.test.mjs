import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildJobManifest,
  loadJobCatalog,
  resolveSiblingRoot,
  runBundle,
  runNativeJob,
  validateBundleRequest,
} from "../src/bundle.mjs";
import {
  BUNDLE_STATUS,
  JOB_STATUS,
  NATIVE_JOB_IDS,
  SCHEMA,
} from "../src/constants.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = join(root, "fixtures");
const clock = () => Date.parse("2026-09-10T19:00:00.000Z");

function load(name) {
  return JSON.parse(readFileSync(join(fixtures, name), "utf8"));
}

const MISSING_SIBLINGS = {
  "route-regression": "/tmp/r2-record-jobs-08-missing-05",
  "deadline-calendar": "/tmp/r2-record-jobs-08-missing-06",
  "dependency-footprint": "/tmp/r2-record-jobs-08-missing-07",
};

test("manifest: three ready native jobs and four owned_by_heavy stubs", () => {
  const catalog = loadJobCatalog();
  assert.equal(catalog.get("route-regression").status, JOB_STATUS.READY);
  assert.equal(catalog.get("deadline-calendar").status, JOB_STATUS.READY);
  assert.equal(catalog.get("dependency-footprint").status, JOB_STATUS.READY);
  const manifest = buildJobManifest({ clock });
  assert.equal(manifest.summary.readyCount, 3);
  assert.equal(manifest.summary.ownedByHeavyCount, 4);
  const heavy = manifest.jobs.filter((j) => j.status === JOB_STATUS.OWNED_BY_HEAVY);
  assert.equal(heavy.length, 4);
  for (const h of heavy) {
    assert.equal(h.ownedBy, "heavy");
    assert.notEqual(h.status, "ready");
    assert.match(h.note || "", /not_bundled_here|owned_by_heavy/i);
  }
});

test("positive: runs 05+06+07 when siblings present", async () => {
  for (const id of NATIVE_JOB_IDS) {
    const resolved = resolveSiblingRoot(id);
    assert.equal(resolved.found, true, `expected sibling for ${id}`);
  }
  const pkg = await runBundle(load("positive-bundle.json"), { clock });
  assert.equal(pkg.schema, SCHEMA);
  assert.equal(pkg.status, BUNDLE_STATUS.READY);
  assert.equal(pkg.jobs.length, 3);
  assert.equal(pkg.summary.readyCount, 3);
  assert.equal(pkg.hasInvestmentRecommendation, false);
  assert.equal(Object.prototype.hasOwnProperty.call(pkg, "investmentRecommendation"), false);

  const byId = Object.fromEntries(pkg.jobs.map((j) => [j.jobId, j]));
  assert.equal(byId["route-regression"].status, JOB_STATUS.READY);
  assert.equal(
    byId["route-regression"].output?.schema,
    "x402.r2.record.route_regression_report.v1",
  );
  assert.equal(byId["route-regression"].output?.status, "ready");
  assert.equal(byId["deadline-calendar"].status, JOB_STATUS.READY);
  assert.equal(byId["deadline-calendar"].output?.schema, "x402.r2.record.deadline_calendar.v1");
  assert.equal(byId["dependency-footprint"].status, JOB_STATUS.READY);
  assert.equal(
    byId["dependency-footprint"].output?.schema,
    "x402.r2.record.dependency_footprint_overlap.v1",
  );
});

test("partial: missing sibling marks unavailable_sibling without inventing output", async () => {
  const pkg = await runBundle(load("partial-missing-sibling.json"), {
    clock,
    siblingRoots: MISSING_SIBLINGS,
  });
  assert.equal(pkg.status, BUNDLE_STATUS.PARTIAL);
  assert.equal(pkg.summary.unavailableSiblingCount, 1);
  assert.equal(pkg.summary.ownedByHeavyCount, 1);
  const native = pkg.jobs.find((j) => j.jobId === "route-regression");
  assert.equal(native.status, JOB_STATUS.UNAVAILABLE_SIBLING);
  assert.equal(native.output, null);
  assert.equal(native.error?.code, "missing_sibling");
  assert.ok(native.fixtureSchema);
  const heavy = pkg.jobs.find((j) => j.jobId === "heavy-01-not-bundled");
  assert.equal(heavy.status, JOB_STATUS.OWNED_BY_HEAVY);
  assert.equal(heavy.output, null);
});

test("partial: incomplete fixture yields partial_input when sibling present", async () => {
  const pkg = await runBundle(load("partial-incomplete-fixture.json"), { clock });
  assert.equal(pkg.status, BUNDLE_STATUS.PARTIAL);
  assert.equal(pkg.jobs[0].status, JOB_STATUS.PARTIAL_INPUT);
  assert.equal(pkg.jobs[0].output?.status, "partial_input");
  assert.ok(pkg.jobs[0].output);
});

test("negative: forbidden fields on request reject", async () => {
  const pkg = await runBundle(load("negative-forbidden.json"), { clock });
  assert.equal(pkg.status, BUNDLE_STATUS.REJECTED);
  assert.equal(pkg.error?.code, "forbidden_claim");
  assert.equal(pkg.jobs.length, 0);
  assert.equal(pkg.hasInvestmentRecommendation, false);
});

test("negative: unknown job rejects", async () => {
  const pkg = await runBundle(load("negative-unknown-job.json"), { clock });
  assert.equal(pkg.status, BUNDLE_STATUS.REJECTED);
  assert.equal(pkg.jobs[0].status, JOB_STATUS.UNKNOWN);
  assert.equal(pkg.jobs[0].error?.code, "unknown_job");
});

test("negative: malformed nested job fixture rejects when sibling present", async () => {
  const slot = await runNativeJob(
    "route-regression",
    "fixtures/jobs/05-route-regression-negative.json",
    { clock },
  );
  assert.equal(slot.status, JOB_STATUS.REJECTED);
  assert.equal(slot.output?.status, "rejected");
  assert.ok(slot.output?.error?.code === "forbidden_claim" || slot.error);
});

test("validateBundleRequest rejects empty jobs and forbidden fields", () => {
  assert.throws(() => validateBundleRequest({ jobs: [] }), /jobs/);
  assert.throws(
    () =>
      validateBundleRequest({
        jobs: ["route-regression"],
        investmentRecommendation: "buy",
      }),
    /Forbidden field/,
  );
});

test("validateBundleRequest accepts string job ids", () => {
  const n = validateBundleRequest({
    requestId: "str-ids",
    jobs: ["route-regression", "deadline-calendar"],
  });
  assert.equal(n.jobs.length, 2);
  assert.equal(n.jobs[0].id, "route-regression");
  assert.equal(n.jobs[0].inputPath, null);
});
