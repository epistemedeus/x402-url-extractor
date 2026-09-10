/**
 * S184: release-brief identity linkage + rejected-ok/pass.
 * S194: strict-source rejects cannot launder into pass; item-level linkage
 * (no plane-union false bridge). API and CLI must agree.
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

function roleMismatchAnnounced() {
  const input = linkedThreePlanes();
  input.sources[0].identity.role = "observed";
  return input;
}

function missingAnnouncedLocator() {
  const input = linkedThreePlanes();
  delete input.sources[0].path;
  delete input.sources[0].url;
  return input;
}

function unknownFourthKind() {
  const input = linkedThreePlanes();
  input.sources.push({
    id: "m",
    plane: "announced",
    kind: "mystery-doc",
    path: "m.json",
    identity: { role: "claimed", tag: "v1.2.0" },
    payload: { title: "mystery" },
  });
  return input;
}

function falsePlaneUnionBridge() {
  return {
    schema: INPUT_SCHEMA,
    clock: CLOCK,
    evidenceClass: "synthetic",
    sources: [
      {
        id: "a-tag",
        plane: "announced",
        kind: "release-notes",
        path: "a-tag.json",
        identity: { role: "claimed", tag: "v1.2.0" },
        payload: { title: "v1.2.0" },
      },
      {
        id: "a-sha",
        plane: "announced",
        kind: "changelog",
        path: "a-sha.json",
        identity: { role: "claimed", commitSha: SHA },
        payload: { title: "unrelated sha note" },
      },
      {
        id: "s",
        plane: "shipped",
        kind: "git-tag",
        path: "s.json",
        identity: { role: "observed", tag: "v1.2.0" },
        payload: { ref: "refs/tags/v1.2.0" },
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

function genuineItemBridge() {
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
        identity: { role: "observed", tag: "v1.2.0", commitSha: SHA },
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

function missingKindConvenience() {
  const input = linkedThreePlanes();
  for (const source of input.sources) delete source.kind;
  return input;
}

function rawLaneDocuments() {
  return {
    schema: INPUT_SCHEMA,
    clock: CLOCK,
    evidenceClass: "synthetic",
    announced: { title: "v1.2.0", tag_name: "v1.2.0", body: "notes" },
    shipped: { ref: "refs/tags/v1.2.0", object: { sha: SHA }, tag: "v1.2.0" },
    tested: { command: "node --test", exitCode: 0, head_sha: SHA },
  };
}

function missingRoleConvenience() {
  const input = linkedThreePlanes();
  delete input.sources[0].identity.role;
  return input;
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

function assertStrictRejectNotPass(got, code) {
  assert.equal(got.ok, false, JSON.stringify({ ok: got.ok, issues: got.issues }));
  assert.notEqual(got.decision, "pass");
  assert.notEqual(got.brief?.decision, "pass");
  assert.equal(got.decision, "fail");
  assert.equal(got.brief?.decision, "fail");
  assert.equal(got.brief?.decision, got.decision);
  assert.ok((got.issues || []).some((issue) => issue.code === code), JSON.stringify(got.issues));
  assert.equal(
    (got.brief?.findings || []).some((finding) => finding.code === "three_planes_aligned"),
    false,
  );
  assert.ok((got.brief?.findings || []).some((finding) => finding.code === code));
}

test("S194 R1 API: announced identity.role observed cannot pass", () => {
  const input = roleMismatchAnnounced();
  const checked = validateReleaseBriefInput(input);
  assert.equal(checked.ok, false);
  assert.ok(checked.issues.some((issue) => issue.code === "identity_role_mismatch"));
  const got = buildReleaseBrief(input);
  assertStrictRejectNotPass(got, "identity_role_mismatch");
});

test("S194 R1 CLI: announced identity.role observed cannot pass", () => {
  const got = buildReleaseBrief(roleMismatchAnnounced());
  const { packet } = runCli(roleMismatchAnnounced());
  assert.notEqual(packet.decision, "pass");
  assert.equal(packet.decision, got.decision);
  assert.equal(packet.decision, "fail");
});

test("S194 R1 API: missing locator on explicit-kind source cannot pass", () => {
  const input = missingAnnouncedLocator();
  const checked = validateReleaseBriefInput(input);
  assert.equal(checked.ok, false);
  assert.ok(checked.issues.some((issue) => issue.code === "missing_locator"));
  const got = buildReleaseBrief(input);
  assertStrictRejectNotPass(got, "missing_locator");
});

test("S194 R1 CLI: missing locator on explicit-kind source cannot pass", () => {
  const got = buildReleaseBrief(missingAnnouncedLocator());
  const { packet } = runCli(missingAnnouncedLocator());
  assert.notEqual(packet.decision, "pass");
  assert.equal(packet.decision, got.decision);
  assert.equal(packet.decision, "fail");
});

test("S194 R1 API: unknown fourth source kind cannot pass", () => {
  const input = unknownFourthKind();
  const checked = validateReleaseBriefInput(input);
  assert.equal(checked.ok, false);
  assert.ok(checked.issues.some((issue) => issue.code === "unknown_source_kind"));
  const got = buildReleaseBrief(input);
  assertStrictRejectNotPass(got, "unknown_source_kind");
});

test("S194 R1 CLI: unknown fourth source kind cannot pass", () => {
  const got = buildReleaseBrief(unknownFourthKind());
  const { packet } = runCli(unknownFourthKind());
  assert.notEqual(packet.decision, "pass");
  assert.equal(packet.decision, got.decision);
  assert.equal(packet.decision, "fail");
});

test("S194 R2 API+CLI: plane-union false bridge is not linked/pass", () => {
  const input = falsePlaneUnionBridge();
  assert.equal(validateReleaseBriefInput(input).ok, true);
  const got = buildReleaseBrief(input);
  assert.notEqual(got.decision, "pass");
  assert.notEqual(got.brief?.decision, "pass");
  assert.equal(got.brief?.decision, got.decision);
  assert.equal(got.brief?.alignment?.linked, false);
  assert.ok(["unknown", "partial"].includes(got.decision), got.decision);
  assert.equal(
    (got.brief?.findings || []).some((finding) => finding.code === "three_planes_aligned"),
    false,
  );
  assert.notEqual(impliedDecision(got.brief), "pass");
  const { packet } = runCli(input);
  assert.notEqual(packet.decision, "pass");
  assert.equal(packet.decision, got.decision);
});

test("S194 R2 API+CLI: genuine item bridge still passes", () => {
  const input = genuineItemBridge();
  const got = buildReleaseBrief(input);
  assert.equal(got.ok, true);
  assert.equal(got.decision, "pass");
  assert.equal(got.brief.decision, "pass");
  assert.equal(got.brief.alignment.linked, true);
  assert.equal(got.brief.findings.some((finding) => finding.code === "three_planes_aligned"), true);
  const { packet } = runCli(input);
  assert.equal(packet.decision, "pass");
});

test("S194 convenience: missing source.kind still infers and may pass", () => {
  const input = missingKindConvenience();
  const checked = validateReleaseBriefInput(input);
  assert.equal(checked.ok, true);
  assert.ok(checked.normalization.some((issue) => issue.code === "unknown_source_kind"));
  const got = buildReleaseBrief(input);
  assert.equal(got.ok, true);
  assert.equal(got.decision, "pass");
  assert.equal(got.brief.decision, "pass");
});

test("S194 convenience: missing identity.role is filled and may pass", () => {
  const input = missingRoleConvenience();
  assert.equal(validateReleaseBriefInput(input).ok, true);
  const got = buildReleaseBrief(input);
  assert.equal(got.ok, true);
  assert.equal(got.decision, "pass");
  assert.equal(got.brief.decision, "pass");
  assert.equal(got.brief.announced.items[0].identity.role, "claimed");
});

test("S194 convenience: raw lane documents without sources[] may still pass", () => {
  const input = rawLaneDocuments();
  const checked = validateReleaseBriefInput(input);
  assert.equal(checked.ok, true);
  assert.ok(checked.normalization.some((issue) => issue.code === "missing_sources"));
  const got = buildReleaseBrief(input);
  assert.equal(got.decision, "pass");
  assert.equal(got.brief.decision, "pass");
  assert.equal(got.ok, true);
});
