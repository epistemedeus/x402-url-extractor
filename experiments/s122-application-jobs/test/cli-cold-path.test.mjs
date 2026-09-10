import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";
import { parseCliJson, runCli } from "./helpers.mjs";

test("CLI --list names three application recipes with operator inputs", () => {
  const proc = runCli(["--list"]);
  assert.equal(proc.status, 0, proc.stderr);
  const recipes = parseCliJson(proc);
  const ids = recipes.map((row) => row.recipeId);
  assert.deepEqual(ids, [
    "npm-cli-release-followup",
    "runtime-eol-watch",
    "agent-cli-release-followup",
  ]);
  for (const recipe of recipes) {
    assert.ok(recipe.userBenefit.length > 20);
    assert.ok(Array.isArray(recipe.operatorSupplies));
    assert.ok(recipe.officialSource.startsWith("https://"));
  }
});

test("CLI cold path: vercel follow-up", () => {
  const proc = runCli([
    "--recipe",
    "npm-cli-release-followup",
    "--prior",
    "fixtures/npm-vercel/prior.seq-1.json",
    "--current-fixture",
    "fixtures/npm-vercel/current.json",
    "--operator",
    "fixtures/npm-vercel/operator.json",
    "--schedule",
    "weekly",
    "--clock",
    "2026-09-10T09:54:59.000Z",
  ]);
  assert.equal(proc.status, 0, proc.stderr + proc.stdout);
  const result = parseCliJson(proc);
  assert.equal(result.outcome, "changed");
  assert.equal(result.nextAction, "review_changelog");
  assert.equal(result.execute, false);
});

test("CLI cold path: runtime eol watch", () => {
  const proc = runCli([
    "--recipe",
    "runtime-eol-watch",
    "--prior",
    "fixtures/eol-nodejs/prior.seq-1.json",
    "--current-fixture",
    "fixtures/eol-nodejs/current.json",
    "--operator",
    "fixtures/eol-nodejs/operator.json",
    "--schedule",
    "monthly",
    "--clock",
    "2026-09-10T09:54:59.000Z",
    "--horizon-days",
    "90",
  ]);
  assert.equal(proc.status, 0, proc.stderr + proc.stdout);
  const result = parseCliJson(proc);
  assert.equal(result.nextAction, "upgrade_now");
});

test("CLI cold path: agent CLI follow-up", () => {
  const proc = runCli([
    "--recipe",
    "agent-cli-release-followup",
    "--prior",
    "fixtures/npm-claude-code/prior.seq-1.json",
    "--current-fixture",
    "fixtures/npm-claude-code/current.json",
    "--operator",
    "fixtures/npm-claude-code/operator.json",
    "--schedule",
    "weekly",
    "--clock",
    "2026-09-10T09:54:59.000Z",
  ]);
  assert.equal(proc.status, 0, proc.stderr + proc.stdout);
  const result = parseCliJson(proc);
  assert.equal(result.nextAction, "refresh_agent_tool_notes");
});

test("CLI continue correction on a second snapshot", () => {
  const packetDir = mkdtempSync(`${tmpdir()}/s122-cli-pkt-`);
  rmSync(packetDir, { recursive: true, force: true });
  const first = runCli([
    "--recipe",
    "agent-cli-release-followup",
    "--prior",
    "fixtures/npm-claude-code/prior.seq-1.json",
    "--current-fixture",
    "fixtures/npm-claude-code/current.json",
    "--operator",
    "fixtures/npm-claude-code/operator.json",
    "--schedule",
    "weekly",
    "--clock",
    "2026-09-10T09:54:59.000Z",
    "--continue-out",
    packetDir,
    "--revision",
    "seq-2",
    "--phase",
    "followup",
  ]);
  assert.equal(first.status, 0, first.stderr + first.stdout);
  const firstJson = parseCliJson(first);
  assert.equal(firstJson.continuation.ok, true, JSON.stringify(firstJson.continuation));

  const outDir = mkdtempSync(`${tmpdir()}/s122-cli-out-`);
  rmSync(outDir, { recursive: true, force: true });
  const correction = runCli([
    "continue",
    "correction",
    "--recipe",
    "agent-cli-release-followup",
    "--packet",
    packetDir,
    "--prior",
    "fixtures/npm-claude-code/prior.seq-1.json",
    "--current-fixture",
    "fixtures/npm-claude-code/current.json",
    "--operator",
    "fixtures/npm-claude-code/operator.json",
    "--schedule",
    "weekly",
    "--clock",
    "2026-09-10T09:54:59.000Z",
    "--out-dir",
    outDir,
  ]);
  assert.equal(correction.status, 0, correction.stderr + correction.stdout);
  const body = parseCliJson(correction);
  assert.equal(body.correction, "return");
  assert.equal(body.second.nextAction, "refresh_agent_tool_notes");
  assert.equal(body.execute, false);
});

test("CLI --help is a cold instruction path", () => {
  const proc = runCli(["--help"]);
  assert.equal(proc.status, 0);
  assert.match(proc.stdout, /npm-cli-release-followup/);
  assert.match(proc.stdout, /Does not install cron/);
});
