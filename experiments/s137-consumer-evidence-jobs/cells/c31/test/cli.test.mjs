import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ARTIFACTS,
  CLOCK,
  EMPTY_SRC,
  OWNED_JOBS,
  SKILL,
  assertPacketShape,
  fixture,
  parseCliJson,
  runCli,
  runIsolated,
  runStub,
} from "./helpers.mjs";

const OWNED_SHA = "240c9640f12d8212b5f6574cf2c5c5f0de6272fe675e7d916f0cf99e404a7bc3";

test("CLI --help is a cold instruction path", () => {
  const proc = runCli(["--help"]);
  assert.equal(proc.status, 0, proc.stderr);
  assert.match(proc.stdout, /analyze <artifact>/);
  assert.match(proc.stdout, /Offline default/);
  assert.match(proc.stdout, /migration-checklist/);
  assert.match(proc.stdout, /freshness-receipt/);
  assert.match(proc.stdout, /Jobs 07\/08 are out of scope/);
  assert.match(proc.stdout, /Kill condition/);
});

test("no args prints usage to stderr and exits 2", () => {
  const proc = runCli([]);
  assert.equal(proc.status, 2);
  assert.match(proc.stderr, /subcommand required/);
});

test("unknown subcommand exits 2 (negative)", () => {
  const proc = runCli(["publish"]);
  assert.equal(proc.status, 2);
  assert.match(proc.stderr, /unknown subcommand/);
});

test("jobs 07/08 are refused (negative, out of scope)", () => {
  const proc = runCli(["analyze", "07", "--clock", CLOCK]);
  assert.equal(proc.status, 2);
  assert.match(proc.stderr, /out of scope/);
});

test("analyze without --clock exits 2 (negative)", () => {
  const proc = runCli(["analyze", "migration-checklist"]);
  assert.equal(proc.status, 2);
  assert.match(proc.stderr, /--clock/);
});

test("analyze unknown artifact exits 2 (negative)", () => {
  const proc = runCli(["analyze", "not-a-job", "--clock", CLOCK]);
  assert.equal(proc.status, 2);
  assert.match(proc.stderr, /unknown artifact/);
});

test("bad evidence-class exits 2 (negative)", () => {
  const proc = runCli(["analyze", "migration-checklist", "--clock", CLOCK, "--evidence-class", "oracle"]);
  assert.equal(proc.status, 2);
  assert.match(proc.stderr, /evidence-class/);
});

test("--in URL is refused (negative, offline default)", () => {
  const proc = runCli([
    "analyze",
    "migration-checklist",
    "--clock",
    CLOCK,
    "--in",
    "https://example.invalid/docs.json",
  ]);
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /local path/);
});

test("unreadable --in exits 1 (negative)", () => {
  const proc = runIsolated([
    "analyze",
    "migration-checklist",
    "--clock",
    CLOCK,
    "--in",
    join(EMPTY_SRC, "does-not-exist.json"),
  ]);
  assert.equal(proc.status, 1, proc.stderr + proc.stdout);
  const packet = parseCliJson(proc);
  assert.equal(packet.ok, false);
  assert.equal(packet.decision, "fail");
});

test("list wires six owned jobs and cites OWNED-JOBS hash (positive, real fixture)", () => {
  const proc = runCli(["list"]);
  assert.equal(proc.status, 0, proc.stderr);
  const doc = parseCliJson(proc);
  assert.equal(doc.schema, "s137.consumer-evidence.catalog.v1");
  assert.equal(doc.artifacts.length, 6);
  assert.deepEqual(
    doc.artifacts.map((row) => row.jobId),
    ARTIFACTS.map((row) => row.jobId),
  );
  assert.deepEqual(doc.excludedJobs, ["R2-CONSUMER-JOBS-07", "R2-CONSUMER-JOBS-08"]);
  const owned = doc.citations.find((row) => row.id === "owned-jobs");
  assert.ok(owned);
  assert.equal(owned.sha256, OWNED_SHA);
  const local = createHash("sha256").update(readFileSync(OWNED_JOBS)).digest("hex");
  assert.equal(owned.sha256, local);
  assert.equal(doc.decision, "pass");
  assert.equal(doc.payment.attempted, false);
  assert.equal(doc.offline, true);
});

test("analyze each of six artifacts with missing src is partial (partial)", () => {
  for (const artifact of ARTIFACTS) {
    const proc = runIsolated(["analyze", artifact.id, "--clock", CLOCK, "--in", fixture("synthetic/positive.json")]);
    assert.equal(proc.status, 0, `${artifact.id}: ${proc.stderr}`);
    const packet = parseCliJson(proc);
    assertPacketShape(assert, packet);
    assert.equal(packet.jobId, artifact.jobId);
    assert.equal(packet.artifactKind, artifact.id);
    assert.equal(packet.decision, "partial");
    assert.equal(packet.modules.transform.present, false);
    assert.equal(packet.evidenceClass, "synthetic");
    assert.ok(packet.findings.some((row) => row.id.includes("missing-transform")));
  }
});

test("analyze --all with empty src returns six partial packets (partial)", () => {
  const proc = runIsolated(["analyze", "--all", "--clock", CLOCK, "--in", fixture("synthetic/positive.json")]);
  assert.equal(proc.status, 0, proc.stderr);
  const family = parseCliJson(proc);
  assert.equal(family.schema, "s137.consumer-evidence.family.v1");
  assert.equal(family.packets.length, 6);
  assert.equal(family.decision, "partial");
  assert.ok(family.packets.every((row) => row.decision === "partial"));
  assert.ok(family.packets.every((row) => row.payment.attempted === false));
});

test("stub transform positive.json is pass with cited finding (positive)", () => {
  const proc = runStub([
    "analyze",
    "migration-checklist",
    "--clock",
    CLOCK,
    "--in",
    fixture("synthetic/positive.json"),
  ]);
  assert.equal(proc.status, 0, proc.stderr + proc.stdout);
  const packet = parseCliJson(proc);
  assertPacketShape(assert, packet);
  assert.equal(packet.decision, "pass");
  assert.equal(packet.modules.transform.present, true);
  assert.equal(packet.modules.schema.present, true);
  assert.equal(packet.artifact.oldPath, "docs/old.md");
  assert.equal(packet.artifact.newPath, "docs/new.md");
  const expected = createHash("sha256").update(readFileSync(fixture("synthetic/positive.json"))).digest("hex");
  assert.ok(packet.citations.some((row) => row.sha256 === expected));
});

test("stub schema rejects negative.json (negative)", () => {
  const proc = runStub([
    "analyze",
    "migration-checklist",
    "--clock",
    CLOCK,
    "--in",
    fixture("synthetic/negative.json"),
  ]);
  assert.equal(proc.status, 0, proc.stderr);
  const packet = parseCliJson(proc);
  assertPacketShape(assert, packet);
  assert.equal(packet.decision, "fail");
  assert.ok(packet.findings.some((row) => row.id === "cli.schema-rejected"));
});

test("stub transform partial.json is partial (partial)", () => {
  const proc = runStub([
    "analyze",
    "migration-checklist",
    "--clock",
    CLOCK,
    "--in",
    fixture("synthetic/partial.json"),
  ]);
  assert.equal(proc.status, 0, proc.stderr);
  const packet = parseCliJson(proc);
  assertPacketShape(assert, packet);
  assert.equal(packet.decision, "partial");
  assert.ok(packet.findings.some((row) => row.id === "stub.partial-missing-new"));
});

test("stub transform conflict.json is conflict (conflicting)", () => {
  const proc = runStub([
    "analyze",
    "migration-checklist",
    "--clock",
    CLOCK,
    "--in",
    fixture("synthetic/conflict.json"),
  ]);
  assert.equal(proc.status, 0, proc.stderr);
  const packet = parseCliJson(proc);
  assertPacketShape(assert, packet);
  assert.equal(packet.decision, "conflict");
  assert.ok(packet.findings.some((row) => row.id === "stub.conflict-old-hash"));
});

test("live-capture label without --live-capture is conflict (conflicting)", () => {
  const proc = runIsolated([
    "analyze",
    "release-brief",
    "--clock",
    CLOCK,
    "--in",
    fixture("synthetic/positive.json"),
    "--evidence-class",
    "live-capture",
  ]);
  assert.equal(proc.status, 0, proc.stderr);
  const packet = parseCliJson(proc);
  assertPacketShape(assert, packet);
  assert.equal(packet.decision, "conflict");
  assert.equal(packet.evidenceClass, "live-capture");
  assert.ok(packet.findings.some((row) => row.id === "cli.evidence-class-conflict"));
});

test("--live-capture with synthetic class is conflict (conflicting)", () => {
  const proc = runIsolated([
    "analyze",
    "table-reconcile",
    "--clock",
    CLOCK,
    "--in",
    fixture("synthetic/positive.json"),
    "--evidence-class",
    "synthetic",
    "--live-capture",
  ]);
  assert.equal(proc.status, 0, proc.stderr);
  const packet = parseCliJson(proc);
  assert.equal(packet.decision, "conflict");
  assert.equal(packet.pipeline.liveCaptureRequested, true);
  assert.equal(packet.offline, true);
  assert.ok(packet.limitations.some((row) => /no network I\/O/.test(row)));
});

test("--out writes the same packet JSON as stdout", () => {
  const dir = mkdtempSync(join(tmpdir(), "s137-c31-out-"));
  const out = join(dir, "packet.json");
  try {
    const proc = runStub([
      "analyze",
      "migration-checklist",
      "--clock",
      CLOCK,
      "--in",
      fixture("synthetic/positive.json"),
      "--out",
      out,
    ]);
    assert.equal(proc.status, 0, proc.stderr);
    const packet = parseCliJson(proc);
    const written = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(written.schema, packet.schema);
    assert.equal(written.decision, packet.decision);
    assert.equal(packet.persisted.path, out);
    assert.ok(packet.persisted.bytes > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("SKILL.md names six artifacts and stays unpublished / offline", () => {
  const text = readFileSync(SKILL, "utf8");
  assert.match(text, /^---\nname: consumer-evidence-jobs\n/);
  for (const id of ARTIFACTS.map((row) => row.id)) {
    assert.match(text, new RegExp(`analyze ${id}`));
  }
  assert.match(text, /Offline default/);
  assert.match(text, /Do not publish/);
  assert.match(text, /Jobs 07\/08 are out of scope/);
  assert.match(text, /payment\.attempted/);
  assert.match(text, /stays false/);
  assert.doesNotMatch(text, /R2-CONSUMER-JOBS-07/);
});

test("real PROVENANCE hash matches local OWNED-JOBS file", () => {
  const prov = JSON.parse(readFileSync(fixture("real/PROVENANCE.json"), "utf8"));
  const local = createHash("sha256").update(readFileSync(OWNED_JOBS)).digest("hex");
  assert.equal(prov.sha256, local);
  assert.equal(prov.evidenceClass, "fixture");
  assert.match(prov.licenseNote, /MIT License/);
  assert.ok(prov.retrievedAt);
  assert.ok(prov.url);
});
