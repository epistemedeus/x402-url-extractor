/**
 * S184: release-brief identity linkage + rejected-ok/pass.
 * Assertions fail on S182 head for B1/B2; pass after the shared-path fix.
 * API (buildReleaseBrief) and CLI (scripts/cli.mjs) must agree.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  impliedDecision,
  INPUT_SCHEMA,
  validateReleaseBrief,
  validateReleaseBriefInput,
} from "../src/release-brief/schema.mjs";
import { buildReleaseBrief } from "../src/release-brief/transform.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK = join(HERE, "..");
const CLI = join(PACK, "scripts/cli.mjs");
const CLOCK = "2026-09-10T18:00:00.000Z";
const SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SHA2 = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function emptyThreePlanes() {
  return {
    schema: INPUT_SCHEMA,
    clock: CLOCK,
    evidenceClass: "synthetic",
    sources: [
      { id: "a", plane: "announced", kind: "release-notes", path: "a.json", payload: {} },
      { id: "s", plane: "shipped", kind: "git-tag", path: "s.json", payload: {} },
      { id: "t", plane: "tested", kind: "test-receipt", path: "t.json", payload: {} },
    ],
  };
}

function linkedThreePlanes() {
  return {
    schema: INPUT_SCHEMA,
    clock: CLOCK,
    evidenceClass: "synthetic",
    sources: [
      {
        id: "a",
        plane: "announced",
        kind: "release-notes",
        path: "a.json",
        identity: { role: "claimed", tag: "v1.2.0", version: "1.2.0", commitSha: SHA },
        payload: { title: "v1.2.0", body: "notes" },
      },
      {
        id: "s",
        plane: "shipped",
        kind: "git-tag",
        path: "s.json",
        identity: { role: "observed", tag: "v1.2.0", version: "1.2.0", commitSha: SHA },
        payload: { targetCommitish: SHA },
      },
      {
        id: "t",
        plane: "tested",
        kind: "test-receipt",
        path: "t.json",
        identity: { role: "observed", version: "1.2.0", commitSha: SHA },
        payload: { command: "node --test", exitCode: 0 },
      },
    ],
  };
}

function disjointThreePlanes() {
  return {
    schema: INPUT_SCHEMA,
    clock: CLOCK,
    evidenceClass: "synthetic",
    sources: [
      {
        id: "a",
        plane: "announced",
        kind: "release-notes",
        path: "a.json",
        identity: { role: "claimed", tag: "v1.2.0" },
        payload: { title: "v1.2.0" },
      },
      {
        id: "s",
        plane: "shipped",
        kind: "git-tag",
        path: "s.json",
        identity: { role: "observed", commitSha: SHA },
        payload: { targetCommitish: SHA },
      },
      {
        id: "t",
        plane: "tested",
        kind: "test-receipt",
        path: "t.json",
        identity: { role: "observed", commitSha: SHA },
        payload: { exitCode: 0 },
      },
    ],
  };
}

function conflictThreePlanes() {
  return {
    schema: INPUT_SCHEMA,
    clock: CLOCK,
    evidenceClass: "synthetic",
    sources: [
      {
        id: "a",
        plane: "announced",
        kind: "release-notes",
        path: "a.json",
        identity: { role: "claimed", tag: "v1.2.0", commitSha: SHA },
        payload: { title: "v1.2.0" },
      },
      {
        id: "s",
        plane: "shipped",
        kind: "git-tag",
        path: "s.json",
        identity: { role: "observed", tag: "v1.1.9", commitSha: SHA2 },
        payload: { targetCommitish: SHA2 },
      },
      {
        id: "t",
        plane: "tested",
        kind: "test-receipt",
        path: "t.json",
        identity: { role: "observed", commitSha: SHA2 },
        payload: { exitCode: 0 },
      },
    ],
  };
}

function malformedIdentity() {
  const input = emptyThreePlanes();
  input.sources[0] = {
    ...input.sources[0],
    identity: { commitSha: 7 },
  };
  return input;
}

function wrongSchema() {
  const input = linkedThreePlanes();
  input.schema = "s137.release-brief.input.v0";
  return input;
}

function announcedOnly() {
  return {
    schema: INPUT_SCHEMA,
    clock: CLOCK,
    evidenceClass: "synthetic",
    sources: [
      {
        id: "a",
        plane: "announced",
        kind: "release-notes",
        path: "a.json",
        identity: { role: "claimed", tag: "v1.2.0" },
        payload: { title: "v1.2.0" },
      },
    ],
  };
}

function runCli(input) {
  const dir = mkdtempSync(join(tmpdir(), "s184-rb-"));
  const path = join(dir, "in.json");
  writeFileSync(path, JSON.stringify(input));
  try {
    const proc = spawnSync(
      process.execPath,
      [CLI, "analyze", "release-brief", "--in", path, "--clock", CLOCK],
      { encoding: "utf8", cwd: PACK },
    );
    assert.equal(proc.error, undefined, String(proc.error));
    const packet = JSON.parse(proc.stdout);
    return { packet, status: proc.status, stderr: proc.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function notPass(decision) {
  return decision !== "pass";
}

test("B1 API: empty identities on three planes are not pass", () => {
  const got = buildReleaseBrief(emptyThreePlanes());
  assert.notEqual(got.decision, "pass");
  assert.ok(["partial", "unknown"].includes(got.decision), got.decision);
  assert.notEqual(got.brief?.decision, "pass");
  assert.equal(got.brief?.decision, got.decision);
  assert.notEqual(got.brief?.alignment?.status, "aligned");
  assert.equal(
    (got.brief?.findings || []).some((f) => f.code === "three_planes_aligned"),
    false,
  );
  assert.equal(impliedDecision(got.brief), got.decision);
});

test("B1 CLI: empty identities on three planes are not pass", () => {
  const { packet } = runCli(emptyThreePlanes());
  assert.notEqual(packet.decision, "pass", JSON.stringify({ decision: packet.decision }));
  assert.ok(["partial", "unknown"].includes(packet.decision), packet.decision);
});

test("B2 API: rejected identity cannot pass at top-level or nested brief", () => {
  const input = malformedIdentity();
  assert.equal(validateReleaseBriefInput(input).ok, false);
  const got = buildReleaseBrief(input);
  assert.equal(got.ok, false);
  assert.notEqual(got.decision, "pass");
  assert.notEqual(got.brief?.decision, "pass");
  assert.equal(got.brief?.decision, got.decision);
  assert.ok((got.issues || []).some((i) => i.code === "invalid_identity_field"));
});

test("B2 CLI: rejected identity is not pass", () => {
  const { packet } = runCli(malformedIdentity());
  assert.notEqual(packet.decision, "pass");
});

test("matrix API+CLI: disjoint identities are not pass", () => {
  const got = buildReleaseBrief(disjointThreePlanes());
  assert.notEqual(got.decision, "pass");
  assert.ok(["partial", "unknown", "conflict"].includes(got.decision), got.decision);
  assert.notEqual(got.brief.decision, "pass");
  const { packet } = runCli(disjointThreePlanes());
  assert.notEqual(packet.decision, "pass");
  assert.equal(packet.decision, got.decision);
});

test("matrix API+CLI: genuinely linked identities may pass", () => {
  const got = buildReleaseBrief(linkedThreePlanes());
  assert.equal(got.ok, true);
  assert.equal(got.decision, "pass");
  assert.equal(got.brief.decision, "pass");
  assert.equal(got.brief.alignment.status, "aligned");
  assert.equal(got.brief.findings.some((f) => f.code === "three_planes_aligned"), true);
  const { packet } = runCli(linkedThreePlanes());
  assert.equal(packet.decision, "pass");
});

test("matrix API+CLI: explicit identity conflict stays conflict", () => {
  const got = buildReleaseBrief(conflictThreePlanes());
  assert.equal(got.decision, "conflict");
  assert.equal(got.brief.decision, "conflict");
  assert.equal(got.brief.findings.some((f) => f.code === "identity_disagreement"), true);
  const { packet } = runCli(conflictThreePlanes());
  assert.equal(packet.decision, "conflict");
});

test("matrix API+CLI: unsupported schema id is not pass", () => {
  const input = wrongSchema();
  const checked = validateReleaseBriefInput(input);
  assert.equal(checked.ok, false);
  assert.ok(checked.issues.some((i) => i.code === "unexpected_schema"));
  const got = buildReleaseBrief(input);
  assert.notEqual(got.decision, "pass");
  assert.notEqual(got.brief?.decision, "pass");
  assert.equal(got.ok, false);
  const { packet } = runCli(input);
  assert.notEqual(packet.decision, "pass");
});

test("matrix API+CLI: missing plane stays partial (not malformed)", () => {
  const got = buildReleaseBrief(announcedOnly());
  assert.equal(got.ok, true);
  assert.equal(got.decision, "partial");
  assert.equal(got.brief.decision, "partial");
  assert.equal(got.brief.tested.items.length, 0);
  assert.equal(got.brief.shipped.items.length, 0);
  const { packet } = runCli(announcedOnly());
  assert.equal(packet.decision, "partial");
});

test("impliedDecision: three empty planes are not pass", () => {
  const got = buildReleaseBrief(emptyThreePlanes());
  assert.notEqual(impliedDecision(got.brief), "pass");
  assert.equal(validateReleaseBrief({ ...got.brief, decision: "pass" }).ok, false);
});
