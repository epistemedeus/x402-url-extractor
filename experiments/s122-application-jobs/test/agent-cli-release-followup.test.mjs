import assert from "node:assert/strict";
import test from "node:test";
import { runRecipe } from "../recipes/lib/run.mjs";
import { fixture } from "./helpers.mjs";

const CLOCK = "2026-09-10T09:54:59.000Z";

test("claude-code patch 2.1.260 -> 2.1.267 refreshes agent tool notes", async () => {
  const result = await runRecipe("agent-cli-release-followup", {
    priorPath: fixture("npm-claude-code/prior.seq-1.json"),
    currentFixturePath: fixture("npm-claude-code/current.json"),
    operatorPath: fixture("npm-claude-code/operator.json"),
    scheduleHint: "weekly",
    clock: CLOCK,
  });
  assert.equal(result.ok, true);
  assert.equal(result.outcome, "changed");
  assert.equal(result.nextAction, "refresh_agent_tool_notes");
  assert.equal(result.justification.ruleId, "patch_refresh_agent_notes");
  assert.equal(result.justification.delta, "patch");
  assert.equal(result.justification.followUp, "bump_pin");
  assert.equal(result.justification.flagSensitive, true);
  assert.equal(result.observation.package, "@anthropic-ai/claude-code");
  assert.equal(result.observation.version, "2.1.267");
  assert.equal(result.observation.priorVersion, "2.1.260");
  assert.match(result.justification.because, /2\.1\.260 -> 2\.1\.267/);
});

test("operator ignorePatch yields no_action on the same patch evidence", async () => {
  const result = await runRecipe("agent-cli-release-followup", {
    priorPath: fixture("npm-claude-code/prior.seq-1.json"),
    currentFixturePath: fixture("npm-claude-code/current.json"),
    operatorPath: fixture("npm-claude-code/operator-ignore-patch.json"),
    scheduleHint: "weekly",
    clock: CLOCK,
  });
  assert.equal(result.outcome, "changed");
  assert.equal(result.nextAction, "no_action");
  assert.equal(result.justification.ruleId, "operator_ignore_patch");
});

test("unchanged claude replay is no_action", async () => {
  const result = await runRecipe("agent-cli-release-followup", {
    priorPath: fixture("npm-claude-code/prior.seq-1.json"),
    currentFixturePath: fixture("npm-claude-code/unchanged.json"),
    operatorPath: fixture("npm-claude-code/operator.json"),
    scheduleHint: "weekly",
    clock: CLOCK,
  });
  assert.equal(result.outcome, "unchanged");
  assert.equal(result.nextAction, "no_action");
});

test("partial claude snapshot does not claim a runbook refresh", async () => {
  const result = await runRecipe("agent-cli-release-followup", {
    priorPath: fixture("npm-claude-code/prior.seq-1.json"),
    currentFixturePath: fixture("npm-claude-code/partial-missing-version.json"),
    operatorPath: fixture("npm-claude-code/operator.json"),
    scheduleHint: "weekly",
    clock: CLOCK,
  });
  assert.equal(result.outcome, "partial");
  assert.equal(result.nextAction, null);
});

test("identity mismatch vercel current against claude prior is an error", async () => {
  const result = await runRecipe("agent-cli-release-followup", {
    priorPath: fixture("npm-claude-code/prior.seq-1.json"),
    currentFixturePath: fixture("npm-vercel/current.json"),
    operatorPath: fixture("npm-claude-code/operator.json"),
    scheduleHint: "weekly",
    clock: CLOCK,
  });
  assert.equal(result.ok, false);
  assert.equal(result.evidence.code, "identity_mismatch");
});
