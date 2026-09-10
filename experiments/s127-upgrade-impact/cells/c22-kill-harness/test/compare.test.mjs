import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { compareDecisions } from "../lib/compare.mjs";
import { coarseBucket, extractDecision } from "../lib/extract.mjs";
import { runSuite } from "../lib/suite.mjs";
import { skimRegistryChangelog } from "../lib/skim.mjs";

const cellRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = (...parts) => join(cellRoot, "fixtures", ...parts);
const load = (...parts) => JSON.parse(readFileSync(fixture(...parts), "utf8"));

test("coarseBucket maps skim and bind vocabularies onto action|no_action|unknown", () => {
  assert.equal(coarseBucket("review_changelog"), "action");
  assert.equal(coarseBucket("bump_pin"), "action");
  assert.equal(coarseBucket("action"), "action");
  assert.equal(coarseBucket("review_breakages"), "action");
  assert.equal(coarseBucket("no_action"), "no_action");
  assert.equal(coarseBucket("unknown"), "unknown");
  assert.equal(coarseBucket(null), "unknown");
  assert.equal(coarseBucket("not-a-real-action"), "unknown");
});

test("pair keep: unused major removal withholds action vs changelog skim", () => {
  const a = load("cases/synthetic-standin-a/registry-skim-decision.json");
  const b = load("cases/synthetic-standin-a/binding-packet.json");
  const pair = compareDecisions(a, b, { caseId: "synthetic-standin-a" });
  assert.equal(pair.verdict, "keep");
  assert.equal(pair.changed, true);
  assert.equal(pair.a.coarse, "action");
  assert.equal(pair.b.coarse, "no_action");
  assert.equal(pair.payment.attempted, false);
});

test("pair kill-signal: used removal stays action-like vs skim review_changelog", () => {
  const a = load("cases/synthetic-standin-b/registry-skim-decision.json");
  const b = load("cases/synthetic-standin-b/binding-packet.json");
  const pair = compareDecisions(a, b, { caseId: "synthetic-standin-b" });
  assert.equal(pair.verdict, "kill");
  assert.equal(pair.changed, false);
  assert.equal(pair.a.coarse, "action");
  assert.equal(pair.b.coarse, "action");
});

test("pair keep: silent patch changelog vs used signature change", () => {
  const a = load("cases/changelog-silent-used-break/registry-skim-decision.json");
  const b = load("cases/changelog-silent-used-break/binding-packet.json");
  const pair = compareDecisions(a, b);
  assert.equal(pair.verdict, "keep");
  assert.equal(pair.a.coarse, "no_action");
  assert.equal(pair.b.coarse, "action");
});

test("exact mode treats review_changelog vs action as a change", () => {
  const a = load("cases/synthetic-standin-b/registry-skim-decision.json");
  const b = load("cases/synthetic-standin-b/binding-packet.json");
  const coarse = compareDecisions(a, b, { mode: "coarse" });
  const exact = compareDecisions(a, b, { mode: "exact" });
  assert.equal(coarse.verdict, "kill");
  assert.equal(exact.verdict, "keep");
  assert.equal(exact.a.raw, "review_changelog");
  assert.equal(exact.b.raw, "action");
});

test("unreadable method B is unknown, not kill", () => {
  const a = load("cases/synthetic-standin-a/registry-skim-decision.json");
  const pair = compareDecisions(a, null, {
    bExtract: {
      ok: false,
      path: "missing.json",
      method: "usage_binding_packet",
      raw: null,
      coarse: "unknown",
      source: "unreadable",
      code: "missing_path",
      message: "path not found",
    },
  });
  assert.equal(pair.verdict, "unknown");
  assert.equal(pair.changed, false);
});

test("synthetic-keep suite: case A changed, case B did not → keep", () => {
  const manifest = load("suites/synthetic-keep.json");
  const result = runSuite(manifest, {
    manifestPath: fixture("suites/synthetic-keep.json"),
  });
  assert.equal(result.verdict, "keep");
  assert.deepEqual(result.changedIds, ["synthetic-standin-a"]);
  assert.equal(result.expect.matched, true);
  assert.equal(result.payment.attempted, false);
});

test("synthetic-kill suite: neither required case changed → kill", () => {
  const manifest = load("suites/synthetic-kill.json");
  const result = runSuite(manifest, {
    manifestPath: fixture("suites/synthetic-kill.json"),
  });
  assert.equal(result.verdict, "kill");
  assert.deepEqual(result.changedIds, []);
  assert.equal(result.expect.matched, true);
});

test("real-ab suite with drop-ins yields kill under coarse buckets", () => {
  // Both real majors: skim review_changelog and binding action share the
  // coarse "action" bucket, so mapping adds no different operator move.
  const manifest = load("suites/real-ab.json");
  const result = runSuite(manifest, {
    manifestPath: fixture("suites/real-ab.json"),
  });
  assert.equal(result.verdict, "kill");
  assert.equal(result.allRequiredReadable, true);
  assert.equal(result.changed, false);
});

test("incomplete required case is unknown, not kill", () => {
  const manifest = load("suites/incomplete.json");
  const result = runSuite(manifest, {
    manifestPath: fixture("suites/incomplete.json"),
  });
  assert.equal(result.verdict, "unknown");
  assert.equal(result.expect.matched, true);
});

test("extractDecision reads packet summary and S122-shaped nextAction", () => {
  const packet = extractDecision(load("cases/synthetic-standin-a/binding-packet.json"));
  assert.equal(packet.raw, "no_action");
  assert.equal(packet.method, "usage_binding_packet");
  const s122 = extractDecision({
    nextAction: "review_changelog",
    justification: { ruleId: "minor_or_major_requires_changelog", because: "minor" },
    observation: { package: "vercel", priorVersion: "59.9.1", version: "59.15.1" },
  });
  assert.equal(s122.raw, "review_changelog");
  assert.equal(s122.coarse, "action");
});

test("skim goldens match live stub output", () => {
  for (const rel of [
    "cases/synthetic-standin-a",
    "cases/synthetic-standin-b",
    "cases/changelog-silent-used-break",
    "cases/partial-changelog",
    "cases/same-version",
  ]) {
    const input = load(rel, "registry-skim-input.json");
    const golden = load(rel, "registry-skim-decision.json");
    const live = skimRegistryChangelog(input);
    assert.equal(live.summary.nextAction, golden.summary.nextAction, rel);
    assert.equal(live.summary.ruleId, golden.summary.ruleId, rel);
    assert.equal(live.payment.attempted, false);
  }
});
