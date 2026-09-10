import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runRecipe } from "../recipes/lib/run.mjs";
import {
  captureFromResult,
  compareResultToPacket,
  consumePacket,
  loadTaskKit,
} from "../recipes/lib/continue-adapter.mjs";
import { fixture } from "./helpers.mjs";

const CLOCK = "2026-09-10T09:54:59.000Z";

test("task-kit 0.1.2 continue capture/compare return after a matching second run", async () => {
  const kit = await loadTaskKit();
  assert.equal(kit.ok, true, kit.message);

  const first = await runRecipe("npm-cli-release-followup", {
    priorPath: fixture("npm-vercel/prior.seq-1.json"),
    currentFixturePath: fixture("npm-vercel/current.json"),
    operatorPath: fixture("npm-vercel/operator.json"),
    scheduleHint: "weekly",
    clock: CLOCK,
  });
  assert.equal(first.nextAction, "review_changelog");

  const packetDir = mkdtempSync(join(tmpdir(), "s122-pkt-"));
  rmSync(packetDir, { recursive: true, force: true });
  const captured = await captureFromResult(first, {
    revision: "seq-2",
    phase: "followup",
    outDir: packetDir,
    now: CLOCK,
  });
  assert.equal(captured.ok, true, captured.message);
  assert.equal(captured.execute, false);
  assert.equal(captured.packet.execute, false);
  assert.equal(captured.packet.wakeSource, false);
  assert.equal(captured.packet.schema, "agent-task-kit.v1.continuation-packet");

  const second = await runRecipe("npm-cli-release-followup", {
    priorPath: fixture("npm-vercel/prior.seq-1.json"),
    currentFixturePath: fixture("npm-vercel/current.json"),
    operatorPath: fixture("npm-vercel/operator.json"),
    scheduleHint: "weekly",
    clock: CLOCK,
  });
  const compared = await compareResultToPacket(packetDir, second);
  assert.equal(compared.ok, true);
  assert.equal(compared.correction, "return");
  assert.ok(compared.compare.outcomes.some((row) => row.code === "body_unchanged"));
  assert.equal(compared.cycle.cycle, false);

  const consumeDir = mkdtempSync(join(tmpdir(), "s122-consume-"));
  rmSync(consumeDir, { recursive: true, force: true });
  const consumed = await consumePacket(packetDir, {
    outDir: consumeDir,
    compareResult: compared.compare,
  });
  assert.equal(consumed.execute, false);
  assert.equal(consumed.artifact.execute, false);
  assert.equal(consumed.artifact.executionAuthorized, false);
  assert.equal(consumed.artifact.status, "blocked_pending_prerequisites");
  assert.ok(consumed.artifact.blockedByPrerequisites.includes("operator-review"));

  rmSync(packetDir, { recursive: true, force: true });
  rmSync(consumeDir, { recursive: true, force: true });
});

test("second independently sourced version document corrects to partial and does not overwrite the packet", async () => {
  const first = await runRecipe("npm-cli-release-followup", {
    priorPath: fixture("npm-vercel/prior.seq-1.json"),
    currentFixturePath: fixture("npm-vercel/current.json"),
    operatorPath: fixture("npm-vercel/operator.json"),
    scheduleHint: "weekly",
    clock: CLOCK,
  });
  const packetDir = mkdtempSync(join(tmpdir(), "s122-pkt2-"));
  rmSync(packetDir, { recursive: true, force: true });
  const captured = await captureFromResult(first, {
    revision: "seq-2",
    phase: "followup",
    outDir: packetDir,
    now: CLOCK,
  });
  assert.equal(captured.ok, true, captured.message);

  const second = await runRecipe("npm-cli-release-followup", {
    priorPath: fixture("npm-vercel/prior.seq-1.json"),
    currentFixturePath: fixture("npm-vercel/second-snapshot-version-doc.json"),
    operatorPath: fixture("npm-vercel/operator.json"),
    scheduleHint: "weekly",
    clock: CLOCK,
  });
  assert.equal(second.outcome, "partial");
  assert.equal(second.nextAction, null);

  const compared = await compareResultToPacket(packetDir, second);
  assert.equal(compared.correction, "update");
  assert.ok(compared.compare.outcomes.some((row) => row.code === "body_changed"));

  const kit = await loadTaskKit();
  const reloaded = await kit.kit.loadContinuationPacket(packetDir);
  assert.equal(reloaded.packetId, captured.packet.packetId);
  assert.equal(reloaded.approvedState.bodyHash, captured.packet.approvedState.bodyHash);

  rmSync(packetDir, { recursive: true, force: true });
});

test("eol full-API second snapshot returns the same upgrade_now plan", async () => {
  const first = await runRecipe("runtime-eol-watch", {
    priorPath: fixture("eol-nodejs/prior.seq-1.json"),
    currentFixturePath: fixture("eol-nodejs/current.json"),
    operatorPath: fixture("eol-nodejs/operator.json"),
    scheduleHint: "monthly",
    clock: CLOCK,
    horizonDays: 90,
  });
  const packetDir = mkdtempSync(join(tmpdir(), "s122-eol-pkt-"));
  rmSync(packetDir, { recursive: true, force: true });
  const captured = await captureFromResult(first, {
    revision: "seq-2",
    phase: "eol-followup",
    outDir: packetDir,
    now: CLOCK,
  });
  assert.equal(captured.ok, true, captured.message);

  const second = await runRecipe("runtime-eol-watch", {
    priorPath: fixture("eol-nodejs/prior.seq-1.json"),
    currentFixturePath: fixture("eol-nodejs/second-snapshot-full-api.json"),
    operatorPath: fixture("eol-nodejs/operator.json"),
    scheduleHint: "monthly",
    clock: CLOCK,
    horizonDays: 90,
  });
  assert.equal(second.nextAction, "upgrade_now");
  const compared = await compareResultToPacket(packetDir, second);
  assert.equal(compared.correction, "return");
  rmSync(packetDir, { recursive: true, force: true });
});
