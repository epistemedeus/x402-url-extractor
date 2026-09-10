import assert from "node:assert/strict";
import test from "node:test";
import { runRecipe } from "../recipes/lib/run.mjs";
import { daysUntil } from "../recipes/lib/dates.mjs";
import { fixture } from "./helpers.mjs";

const CURRENT_CLOCK = "2026-09-10T09:54:59.000Z";
const PRIOR_CLOCK = "2026-03-01T00:00:00.000Z";

test("day counts for labeled clocks", () => {
  assert.equal(daysUntil("2026-04-30", PRIOR_CLOCK), 60);
  assert.ok(daysUntil("2026-04-30", CURRENT_CLOCK) < 0);
  assert.equal(daysUntil("2026-10-20", CURRENT_CLOCK), 40);
});

test("Node 20 is already EOL on 2026-09-10: upgrade_now even when source rows are unchanged", async () => {
  const result = await runRecipe("runtime-eol-watch", {
    priorPath: fixture("eol-nodejs/prior.seq-1.json"),
    currentFixturePath: fixture("eol-nodejs/current.json"),
    operatorPath: fixture("eol-nodejs/operator.json"),
    scheduleHint: "monthly",
    clock: CURRENT_CLOCK,
    horizonDays: 90,
  });
  assert.equal(result.ok, true);
  assert.equal(result.outcome, "changed");
  assert.equal(result.nextAction, "upgrade_now");
  assert.equal(result.justification.deadlineCrossed, true);
  assert.equal(result.justification.priorNextAction, "schedule_upgrade");
  assert.equal(result.diff.changed.length, 0);
  const row20 = result.justification.perCycle.find((row) => row.cycle === "20");
  assert.equal(row20.ruleId, "already_eol");
  assert.ok(row20.daysToEol < 0);
  assert.equal(result.evidence.evidenceClass, "fixture");
  assert.equal(result.execute, false);
  assert.match(result.justification.because, /cycle 20/);
});

test("unchanged replay at the prior clock still schedules upgrade (60 days to Node 20 EOL)", async () => {
  const result = await runRecipe("runtime-eol-watch", {
    priorPath: fixture("eol-nodejs/prior.seq-1.json"),
    currentFixturePath: fixture("eol-nodejs/unchanged.json"),
    operatorPath: fixture("eol-nodejs/operator.json"),
    scheduleHint: "monthly",
    clock: PRIOR_CLOCK,
    horizonDays: 90,
    urgentDays: 14,
  });
  assert.equal(result.outcome, "unchanged");
  assert.equal(result.nextAction, "schedule_upgrade");
  assert.equal(result.justification.deadlineCrossed, false);
  assert.equal(result.recovery.action, "keep_prior");
  const row20 = result.justification.perCycle.find((row) => row.cycle === "20");
  assert.equal(row20.daysToEol, 60);
  assert.equal(row20.ruleId, "eol_within_horizon");
});

test("partial missing eol does not justify upgrade_now", async () => {
  const result = await runRecipe("runtime-eol-watch", {
    priorPath: fixture("eol-nodejs/prior.seq-1.json"),
    currentFixturePath: fixture("eol-nodejs/partial-missing-eol.json"),
    operatorPath: fixture("eol-nodejs/operator.json"),
    scheduleHint: "monthly",
    clock: CURRENT_CLOCK,
    horizonDays: 90,
  });
  assert.equal(result.outcome, "partial");
  assert.equal(result.nextAction, null);
  assert.equal(result.recovery.action, "keep_partial_rows");
});

test("second independently sourced full API still upgrade_now for watch 20/22/24", async () => {
  const result = await runRecipe("runtime-eol-watch", {
    priorPath: fixture("eol-nodejs/prior.seq-1.json"),
    currentFixturePath: fixture("eol-nodejs/second-snapshot-full-api.json"),
    operatorPath: fixture("eol-nodejs/operator.json"),
    scheduleHint: "monthly",
    clock: CURRENT_CLOCK,
    horizonDays: 90,
  });
  assert.equal(result.outcome, "changed");
  assert.equal(result.nextAction, "upgrade_now");
  assert.equal(result.observation.complete, true);
  assert.deepEqual(result.observation.watchCycles, ["20", "22", "24"]);
});

test("watching only Node 24: support ends within 90 days so schedule_upgrade", async () => {
  const result = await runRecipe("runtime-eol-watch", {
    priorPath: fixture("eol-nodejs/prior.seq-1.json"),
    currentFixturePath: fixture("eol-nodejs/current.json"),
    operatorPath: fixture("eol-nodejs/operator-node24-only.json"),
    scheduleHint: "monthly",
    clock: CURRENT_CLOCK,
    horizonDays: 90,
  });
  assert.equal(result.nextAction, "schedule_upgrade");
  const row24 = result.justification.perCycle.find((row) => row.cycle === "24");
  assert.equal(row24.ruleId, "support_within_horizon");
  assert.equal(row24.daysToSupport, 40);
});

test("missing horizonDays is an error, not a defaulted marketing horizon", async () => {
  const result = await runRecipe("runtime-eol-watch", {
    priorPath: fixture("eol-nodejs/prior.seq-1.json"),
    currentFixturePath: fixture("eol-nodejs/current.json"),
    scheduleHint: "monthly",
    clock: CURRENT_CLOCK,
    watchCycles: ["20"],
  });
  assert.equal(result.ok, false);
  assert.equal(result.evidence.code, "missing_horizon_days");
});
