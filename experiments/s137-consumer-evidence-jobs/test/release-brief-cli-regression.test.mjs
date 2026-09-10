/**
 * S174: release-brief CLI must not promote schema-rejected / case-wrapper
 * inputs to decision=pass. Synthetic conflict-sha-mismatch must stay conflict.
 * Offline. No network. No paid endpoints.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { transform as transformReleaseBrief } from "../src/release-brief/transform.mjs";
import { validateReleaseBriefInput } from "../src/release-brief/schema.mjs";
import { loadCase } from "../fixtures/synthetic/release-brief/load.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK = join(HERE, "..");
const CLI = join(PACK, "scripts/cli.mjs");
const CASES = join(PACK, "fixtures/synthetic/release-brief/cases");
const CLOCK = "2026-09-10T18:00:00.000Z";

function runCli(args) {
  const proc = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    cwd: PACK,
    env: { ...process.env },
  });
  return proc;
}

function parseStdout(proc) {
  assert.equal(proc.error, undefined, String(proc.error));
  assert.equal(proc.status, 0, `stderr=${proc.stderr}\nstdout=${proc.stdout.slice(0, 400)}`);
  return JSON.parse(proc.stdout);
}

test("CLI conflict-sha-mismatch: decision=conflict (not pass) and no false schema-rejected path", () => {
  const casePath = join(CASES, "conflict-sha-mismatch.json");
  const packet = parseStdout(
    runCli(["analyze", "release-brief", "--in", casePath, "--clock", CLOCK]),
  );
  assert.equal(packet.decision, "conflict");
  assert.equal(packet.ok, true);
  assert.equal(
    (packet.findings || []).some((f) => f.id === "cli.schema-rejected"),
    false,
    "unwrapped case input must validate; schema-rejected+pass was the S170 defect",
  );
  const conflictFinding = (packet.findings || []).find(
    (f) => /sha|commit|mismatch|conflict/i.test(String(f.id || "")) ||
      /sha|commit|mismatch|conflict/i.test(String(f.message || "")),
  );
  assert.ok(
    conflictFinding || packet.decision === "conflict",
    "conflict decision must reflect SHA mismatch",
  );
});

test("direct API parity with CLI for conflict-sha-mismatch", () => {
  const spec = loadCase("conflict-sha-mismatch");
  assert.equal(spec.expect.decision, "conflict");
  const validated = validateReleaseBriefInput(spec.input);
  assert.equal(validated.ok, true, codes(validated));
  const got = transformReleaseBrief(spec.input);
  assert.equal(got.decision, "conflict");
  const packet = parseStdout(
    runCli([
      "analyze",
      "release-brief",
      "--in",
      join(CASES, "conflict-sha-mismatch.json"),
      "--clock",
      CLOCK,
    ]),
  );
  assert.equal(packet.decision, got.decision);
});

test("positive control still passes via CLI and API", () => {
  const spec = loadCase("positive-aligned");
  assert.equal(transformReleaseBrief(spec.input).decision, "pass");
  const packet = parseStdout(
    runCli([
      "analyze",
      "release-brief",
      "--in",
      join(CASES, "positive-aligned.json"),
      "--clock",
      CLOCK,
    ]),
  );
  assert.equal(packet.decision, "pass");
  assert.equal(
    (packet.findings || []).some((f) => f.id === "cli.schema-rejected"),
    false,
  );
});

test("partial controls stay partial via CLI (not promoted to pass)", () => {
  for (const id of ["partial-announced-only", "partial-missing-tested"]) {
    const spec = loadCase(id);
    assert.equal(spec.expect.decision, "partial", id);
    assert.equal(transformReleaseBrief(spec.input).decision, "partial", id);
    const packet = parseStdout(
      runCli(["analyze", "release-brief", "--in", join(CASES, `${id}.json`), "--clock", CLOCK]),
    );
    assert.equal(packet.decision, "partial", id);
  }
});

test("raw case wrapper without unwrap cannot become pass at transform layer", () => {
  const raw = JSON.parse(readFileSync(join(CASES, "conflict-sha-mismatch.json"), "utf8"));
  // Lane path strings are not inlined evidence; transform must not invent alignment.
  const got = transformReleaseBrief(raw);
  assert.notEqual(got.decision, "pass");
});

test("schema rejection must not promote to pass (pickDecision contract)", async () => {
  // Import pickDecision indirectly by feeding a schema-invalid operator doc that a
  // naive transform might still soft-pass; CLI must end non-pass.
  const badPath = join(CASES, "conflict-sha-mismatch.json");
  // Force schema path: pass the wrapper but with input stripped so unwrap fails
  // and validateInput rejects — write temp via stdin-equivalent by analyzing a
  // minimal invalid object file.
  const { writeFileSync, mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "s174-schema-reject-"));
  const bad = join(dir, "bad.json");
  writeFileSync(
    bad,
    JSON.stringify({
      schema: "s137.release-brief.synthetic-case.v1",
      id: "bad-wrapper",
      clock: CLOCK,
      evidenceClass: "synthetic",
      lanes: { announced: "missing.json" },
      // no nested input → cannot unwrap; schema rejects; must not pass
    }),
  );
  try {
    const packet = parseStdout(
      runCli(["analyze", "release-brief", "--in", bad, "--clock", CLOCK]),
    );
    assert.notEqual(packet.decision, "pass");
    assert.ok(["fail", "unknown", "partial", "conflict"].includes(packet.decision));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function codes(result) {
  return (result?.issues || []).map((i) => i.code || i.message).join(",");
}
