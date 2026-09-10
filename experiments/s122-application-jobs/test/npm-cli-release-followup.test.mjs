import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runRecipe, persistResult } from "../recipes/lib/run.mjs";
import { classifySemverDelta } from "../recipes/lib/semver.mjs";
import { selectNpmNextAction, DEFAULT_VERCEL_POLICY } from "../recipes/lib/npm-decision.mjs";
import { loadPrior, assertImmutable } from "../recipes/lib/prior.mjs";
import { fixture } from "./helpers.mjs";

const CLOCK = "2026-09-10T09:54:59.000Z";

test("semver 59.9.1 -> 59.15.1 is minor, not patch", () => {
  assert.equal(classifySemverDelta("59.9.1", "59.15.1"), "minor");
  assert.equal(classifySemverDelta("2.1.260", "2.1.267"), "patch");
});

test("decision policy: minor requires changelog before pin bump", () => {
  const decision = selectNpmNextAction({
    outcome: "changed",
    priorVersion: "59.9.1",
    currentVersion: "59.15.1",
    pinVersion: "59.9.1",
    notesLastReviewedVersion: "59.9.1",
    policy: DEFAULT_VERCEL_POLICY,
  });
  assert.equal(decision.nextAction, "review_changelog");
  assert.equal(decision.ruleId, "minor_or_major_requires_changelog");
});

test("vercel changed: 59.9.1 -> 59.15.1 yields review_changelog justified by minor delta", async () => {
  const result = await runRecipe("npm-cli-release-followup", {
    priorPath: fixture("npm-vercel/prior.seq-1.json"),
    currentFixturePath: fixture("npm-vercel/current.json"),
    operatorPath: fixture("npm-vercel/operator.json"),
    scheduleHint: "weekly",
    clock: CLOCK,
  });
  assert.equal(result.ok, true);
  assert.equal(result.outcome, "changed");
  assert.equal(result.nextAction, "review_changelog");
  assert.equal(result.justification.ruleId, "minor_or_major_requires_changelog");
  assert.equal(result.justification.delta, "minor");
  assert.equal(result.observation.version, "59.15.1");
  assert.equal(result.observation.priorVersion, "59.9.1");
  assert.equal(result.observation.publishedAt, "2026-09-10T01:12:17.696Z");
  assert.equal(result.evidence.evidenceClass, "fixture");
  assert.equal(result.execute, false);
  assert.equal(result.payment.replayBlocked, true);
  assert.equal(result.cost.assignmentSpend.amount, 0);
  const versionChange = result.diff.changed.find((row) => row.field === "version");
  assert.equal(versionChange.before, "59.9.1");
  assert.equal(versionChange.after, "59.15.1");
  assert.match(result.justification.because, /59\.9\.1 -> 59\.15\.1/);
});

test("unchanged replay keeps prior and emits no_action", async () => {
  const result = await runRecipe("npm-cli-release-followup", {
    priorPath: fixture("npm-vercel/prior.seq-1.json"),
    currentFixturePath: fixture("npm-vercel/unchanged.json"),
    operatorPath: fixture("npm-vercel/operator.json"),
    scheduleHint: "weekly",
    clock: CLOCK,
  });
  assert.equal(result.outcome, "unchanged");
  assert.equal(result.nextAction, "no_action");
  assert.equal(result.justification.ruleId, "unchanged_and_notes_current");
  assert.equal(result.recovery.action, "keep_prior");
  assert.equal(result.diff.changed.length, 0);
});

test("partial input missing version is not a successful next-action claim", async () => {
  const result = await runRecipe("npm-cli-release-followup", {
    priorPath: fixture("npm-vercel/prior.seq-1.json"),
    currentFixturePath: fixture("npm-vercel/partial-missing-version.json"),
    operatorPath: fixture("npm-vercel/operator.json"),
    scheduleHint: "weekly",
    clock: CLOCK,
  });
  assert.equal(result.outcome, "partial");
  assert.equal(result.nextAction, null);
  assert.equal(result.justification.ruleId, "no_decision_on_partial");
  assert.equal(result.recovery.action, "keep_partial_rows");
  assert.ok(result.diff.missing.some((row) => row.field === "version"));
});

test("syntactically valid JSON without registry fields is not success", async () => {
  const dir = mkdtempSync(join(tmpdir(), "s122-json-"));
  const bogus = join(dir, "ok.json");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(bogus, `${JSON.stringify({ ok: true, status: "changed" }, null, 2)}\n`);
  const result = await runRecipe("npm-cli-release-followup", {
    priorPath: fixture("npm-vercel/prior.seq-1.json"),
    currentFixturePath: bogus,
    operatorPath: fixture("npm-vercel/operator.json"),
    scheduleHint: "weekly",
    clock: CLOCK,
  });
  rmSync(dir, { recursive: true, force: true });
  assert.notEqual(result.nextAction, "review_changelog");
  assert.notEqual(result.nextAction, "bump_pin");
  assert.ok(result.outcome === "partial" || result.outcome === "error");
});

test("stale current vs operator horizon refuses a next-action", async () => {
  const result = await runRecipe("npm-cli-release-followup", {
    priorPath: fixture("npm-vercel/prior.seq-1.json"),
    currentFixturePath: fixture("npm-vercel/stale-current.json"),
    operatorPath: fixture("npm-vercel/operator.json"),
    scheduleHint: "weekly",
    clock: CLOCK,
    horizonHours: 168,
  });
  assert.equal(result.outcome, "stale_baseline");
  assert.equal(result.nextAction, null);
  assert.equal(result.recovery.action, "refresh_baseline");
});

test("second independently sourced version document is partial (no published_at)", async () => {
  const result = await runRecipe("npm-cli-release-followup", {
    priorPath: fixture("npm-vercel/prior.seq-1.json"),
    currentFixturePath: fixture("npm-vercel/second-snapshot-version-doc.json"),
    operatorPath: fixture("npm-vercel/operator.json"),
    scheduleHint: "weekly",
    clock: CLOCK,
  });
  assert.equal(result.observation.version, "59.15.1");
  assert.equal(result.outcome, "partial");
  assert.equal(result.nextAction, null);
  assert.ok(result.diff.missing.some((row) => row.field === "publishedAt"));
});

test("after review, seq-2 prior vs current slim returns no_action", async () => {
  const result = await runRecipe("npm-cli-release-followup", {
    priorPath: fixture("npm-vercel/prior.seq-2-after-review.json"),
    currentFixturePath: fixture("npm-vercel/current.json"),
    operatorPath: fixture("npm-vercel/operator-notes-refreshed.json"),
    scheduleHint: "weekly",
    clock: CLOCK,
  });
  assert.equal(result.outcome, "unchanged");
  assert.equal(result.nextAction, "no_action");
  assert.equal(result.observation.version, "59.15.1");
});

test("missing operator clock is an error, not a fabricated now()", async () => {
  const result = await runRecipe("npm-cli-release-followup", {
    priorPath: fixture("npm-vercel/prior.seq-1.json"),
    currentFixturePath: fixture("npm-vercel/current.json"),
    scheduleHint: "weekly",
  });
  assert.equal(result.ok, false);
  assert.equal(result.outcome, "error");
  assert.equal(result.evidence.code, "missing_clock");
});

test("payment replay is blocked", async () => {
  const result = await runRecipe("npm-cli-release-followup", {
    priorPath: fixture("npm-vercel/prior.seq-1.json"),
    currentFixturePath: fixture("npm-vercel/current.json"),
    operatorPath: fixture("npm-vercel/operator.json"),
    scheduleHint: "weekly",
    clock: CLOCK,
    replayPayment: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.evidence.code, "payment_authority_required");
  assert.equal(result.payment.replayBlocked, true);
});

test("sequenced artifact does not overwrite the immutable prior", async () => {
  const dir = mkdtempSync(join(tmpdir(), "s122-art-"));
  const priorPath = fixture("npm-vercel/prior.seq-1.json");
  const before = readFileSync(priorPath);
  const result = await runRecipe("npm-cli-release-followup", {
    priorPath,
    currentFixturePath: fixture("npm-vercel/current.json"),
    operatorPath: fixture("npm-vercel/operator.json"),
    scheduleHint: "weekly",
    clock: CLOCK,
  });
  const persisted = persistResult(result, { outDir: dir, writeArtifact: true });
  assert.equal(persisted.artifact.ok, true);
  assert.notEqual(persisted.artifact.path, priorPath);
  assert.equal(Buffer.compare(before, readFileSync(priorPath)), 0);
  const blocked = assertImmutable(priorPath, "tamper");
  assert.equal(blocked.ok, false);
  const prior = loadPrior(priorPath);
  assert.equal(prior.prior.immutable, true);
  rmSync(dir, { recursive: true, force: true });
});

test("default path does not call fetch", async () => {
  let called = 0;
  const result = await runRecipe("npm-cli-release-followup", {
    priorPath: fixture("npm-vercel/prior.seq-1.json"),
    currentFixturePath: fixture("npm-vercel/current.json"),
    operatorPath: fixture("npm-vercel/operator.json"),
    scheduleHint: "weekly",
    clock: CLOCK,
    fetchImpl: async () => {
      called += 1;
      throw new Error("network should stay off");
    },
  });
  assert.equal(called, 0);
  assert.equal(result.outcome, "changed");
});
