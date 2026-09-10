import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { analyzeArgs, assertPacketShape, CLOCK, FIXTURES, PACK_ROOT, SKILL, fixture, parseCliJson, runCli, runIsolated } from "./helpers.mjs";

test("CLI --help is a cold instruction path", () => {
  const proc = runCli(["--help"]);
  assert.equal(proc.status, 0, proc.stderr);
  assert.match(proc.stdout, /analyze \| replay \| correct/);
  assert.match(proc.stdout, /Offline default/);
  assert.match(proc.stdout, /unused export change is not a caller defect/i);
  assert.match(proc.stdout, /Kill condition/);
});

test("CLI with no args prints usage to stderr and exits 2", () => {
  const proc = runCli([]);
  assert.equal(proc.status, 2);
  assert.match(proc.stderr, /subcommand required/);
  assert.match(proc.stderr, /analyze \| replay \| correct/);
});

test("unknown subcommand exits 2", () => {
  const proc = runCli(["publish"]);
  assert.equal(proc.status, 2);
  assert.match(proc.stderr, /unknown subcommand/);
});

test("analyze without --clock exits 2", () => {
  const proc = runCli(["analyze", "--dep", "demo-dep", "--old", "1.0.0", "--new", "2.0.0"]);
  assert.equal(proc.status, 2);
  assert.match(proc.stderr, /--clock/);
});

test("analyze without --dep exits 2", () => {
  const proc = runCli(["analyze", "--old", "1.0.0", "--new", "2.0.0", "--clock", CLOCK]);
  assert.equal(proc.status, 2);
  assert.match(proc.stderr, /--dep/);
});

test("analyze same version with missing src modules is no_action", () => {
  const proc = runIsolated([
    "analyze",
    "--dep",
    "demo-dep",
    "--old",
    "1.0.0",
    "--new",
    "1.0.0",
    "--clock",
    CLOCK,
  ]);
  assert.equal(proc.status, 0, proc.stderr + proc.stdout);
  const packet = parseCliJson(proc);
  assertPacketShape(assert, packet);
  assert.equal(packet.summary.nextAction, "no_action");
  assert.equal(packet.caller.evidenceClass, "synthetic");
  assert.equal(packet.offline, true);
  assert.ok(packet.limitations.some((row) => /src\/bind\.mjs not present/.test(row)));
  assert.equal(packet.pipeline.modules.bind.present, false);
});

test("analyze version bump with missing src modules is unknown, not action", () => {
  const proc = runIsolated(analyzeArgs());
  assert.equal(proc.status, 0, proc.stderr + proc.stdout);
  const packet = parseCliJson(proc);
  assertPacketShape(assert, packet);
  assert.equal(packet.summary.nextAction, "unknown");
  assert.notEqual(packet.summary.nextAction, "action");
  assert.deepEqual(packet.summary.actionableChanges, []);
  assert.equal(packet.dependency.name, "demo-dep");
  assert.equal(packet.dependency.oldVersion, "1.0.0");
  assert.equal(packet.dependency.newVersion, "2.0.0");
  assert.equal(packet.caller.evidenceClass, "fixture");
  assert.ok(packet.caller.sourceRoots.some((row) => row.endsWith("source-root")));
  assert.ok(packet.provenance.some((row) => row.role === "dep-old" && row.label === "fixture"));
  assert.ok(packet.provenance.some((row) => row.role === "dep-new" && row.label === "fixture"));
  assert.match(proc.stderr, /src module\(s\) missing/);
});

test("--source-root is repeatable", () => {
  const proc = runIsolated(
    analyzeArgs(["--source-root", fixture("source-root"), "--source-root", fixture("source-root")]),
  );
  assert.equal(proc.status, 0, proc.stderr);
  const packet = parseCliJson(proc);
  assert.ok(packet.caller.sourceRoots.length >= 2);
});

test("--out writes the same packet JSON as stdout", () => {
  const dir = mkdtempSync(join(tmpdir(), "s127-c09-out-"));
  const out = join(dir, "packet.json");
  try {
    const proc = runIsolated(analyzeArgs(["--out", out]));
    assert.equal(proc.status, 0, proc.stderr);
    const packet = parseCliJson(proc);
    const written = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(written.schema, packet.schema);
    assert.equal(written.summary.nextAction, packet.summary.nextAction);
    assert.equal(packet.persisted.path, out);
    assert.ok(packet.persisted.bytes > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fixture files are hashed into provenance (fixture, not live-capture)", () => {
  const proc = runIsolated(analyzeArgs());
  const packet = parseCliJson(proc);
  const oldBuf = readFileSync(fixture("old-exports.json"));
  const expected = createHash("sha256").update(oldBuf).digest("hex");
  const row = packet.provenance.find((item) => item.role === "dep-old");
  assert.equal(row.contentSha256, expected);
  assert.equal(row.label, "fixture");
  assert.ok(!packet.provenance.some((item) => item.label === "live-capture"));
});

test("replay does not overwrite the immutable prior", () => {
  const dir = mkdtempSync(join(tmpdir(), "s127-c09-replay-"));
  const priorPath = join(dir, "prior.json");
  const replayPath = join(dir, "replay.json");
  try {
    const first = runIsolated(analyzeArgs(["--out", priorPath]));
    assert.equal(first.status, 0, first.stderr);
    const before = readFileSync(priorPath);
    const replay = runIsolated([
      "replay",
      "--prior",
      priorPath,
      "--clock",
      CLOCK,
      "--out",
      replayPath,
    ]);
    assert.equal(replay.status, 0, replay.stderr);
    const after = readFileSync(priorPath);
    assert.equal(Buffer.compare(before, after), 0);
    const packet = parseCliJson(replay);
    assert.equal(packet.command, "replay");
    assert.equal(packet.prior.immutable, true);
    assert.equal(packet.prior.path, priorPath);
    assert.equal(packet.prior.sha256, createHash("sha256").update(before.toString("utf8").trimEnd()).digest("hex"));
    assert.equal(packet.prior.correction, null);
    assert.equal(packet.summary.nextAction, "unknown");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("correct refuses to write --out onto --prior and does not mutate prior when writing elsewhere", () => {
  const dir = mkdtempSync(join(tmpdir(), "s127-c09-correct-"));
  const priorPath = join(dir, "prior.json");
  const outPath = join(dir, "corrected.json");
  try {
    const first = runIsolated(analyzeArgs(["--out", priorPath]));
    assert.equal(first.status, 0, first.stderr);
    const before = readFileSync(priorPath);

    const blocked = runIsolated([
      "correct",
      "--prior",
      priorPath,
      "--out",
      priorPath,
      "--clock",
      CLOCK,
      "--correction",
      "should-not-write",
    ]);
    assert.equal(blocked.status, 1, blocked.stderr);
    assert.match(blocked.stderr, /immutable prior/);
    assert.equal(Buffer.compare(before, readFileSync(priorPath)), 0);

    const ok = runIsolated([
      "correct",
      "--prior",
      priorPath,
      "--clock",
      CLOCK,
      "--out",
      outPath,
      "--correction",
      "second snapshot / operator note",
    ]);
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(Buffer.compare(before, readFileSync(priorPath)), 0);
    const packet = parseCliJson(ok);
    assert.equal(packet.command, "correct");
    assert.equal(packet.prior.immutable, true);
    assert.equal(packet.prior.correction.note, "second snapshot / operator note");
    assert.equal(packet.prior.correction.appliedAt, CLOCK);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stub bind used-removed yields action", () => {
  const proc = runCli(analyzeArgs(), { env: { S127_UPGRADE_IMPACT_SRC: fixture("stub-src-used") } });
  assert.equal(proc.status, 0, proc.stderr + proc.stdout);
  const packet = parseCliJson(proc);
  assert.equal(packet.summary.nextAction, "action");
  assert.deepEqual(packet.summary.actionableChanges, ["alpha"]);
  assert.equal(packet.pipeline.modules.bind.present, true);
  assert.equal(packet.pipeline.modules.bind.exportName, "bind");
});

test("stub bind unused-removed is coerced to no_action", () => {
  const proc = runCli(analyzeArgs(), { env: { S127_UPGRADE_IMPACT_SRC: fixture("stub-src-unused") } });
  assert.equal(proc.status, 0, proc.stderr + proc.stdout);
  const packet = parseCliJson(proc);
  assert.notEqual(packet.summary.nextAction, "action");
  assert.equal(packet.summary.nextAction, "no_action");
  assert.deepEqual(packet.summary.unusedChanges, ["gamma"]);
  assert.equal(packet.bindings[0].decision, "no_action");
});

test("stub bind dynamic import is unknown not action", () => {
  const proc = runCli(analyzeArgs(), { env: { S127_UPGRADE_IMPACT_SRC: fixture("stub-src-dynamic") } });
  assert.equal(proc.status, 0, proc.stderr + proc.stdout);
  const packet = parseCliJson(proc);
  assert.equal(packet.summary.nextAction, "unknown");
  assert.equal(packet.bindings[0].decision, "unknown");
});

test("CLI sources do not perform network I/O", () => {
  const scriptsDir = join(PACK_ROOT, "scripts");
  const texts = collectJs(scriptsDir).map((path) => `${path}\n${readFileSync(path, "utf8")}`);
  const blob = texts.join("\n");
  assert.doesNotMatch(blob, /globalThis\.fetch/);
  assert.doesNotMatch(blob, /\bawait fetch\s*\(/);
  assert.doesNotMatch(blob, /node:https/);
  assert.doesNotMatch(blob, /https\.request/);
  assert.doesNotMatch(blob, /spawn(?:Sync)?\([^)]*["']npm["']/);
});

test("SKILL.md describes when to run vs registry fetch, I/O, and kill condition", () => {
  const text = readFileSync(SKILL, "utf8");
  assert.match(text, /^---\nname: upgrade-impact\n/m);
  assert.match(text, /When to run this vs raw registry fetch/);
  assert.match(text, /Kill condition/);
  assert.match(text, /Do not publish/i);
  assert.match(text, /scripts\/cli\.mjs/);
  assert.match(text, /--manifest/);
  assert.match(text, /action \| unknown \| no_action/);
});

test("missing --out file parent is created; compact is valid JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "s127-c09-nested-"));
  const out = join(dir, "nested", "packet.json");
  try {
    const proc = runIsolated(analyzeArgs(["--out", out, "--compact"]));
    assert.equal(proc.status, 0, proc.stderr);
    const packet = parseCliJson(proc);
    assert.equal(packet.schema, "s127.upgrade-impact.packet.v1");
    const written = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(written.clock, CLOCK);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unreadable --manifest yields ok false and a packet", () => {
  const proc = runIsolated([
    "analyze",
    "--manifest",
    join(FIXTURES, "does-not-exist.json"),
    "--dep",
    "demo-dep",
    "--old",
    "1.0.0",
    "--new",
    "2.0.0",
    "--clock",
    CLOCK,
  ]);
  assert.equal(proc.status, 1, proc.stderr);
  const packet = parseCliJson(proc);
  assert.equal(packet.ok, false);
  assert.equal(packet.error.code, "input_file_error");
  assert.equal(packet.summary.nextAction, "unknown");
});

test("analyze against pack src still emits a contract packet and never treats a version bump as action without used bindings from this cell", () => {
  const proc = runCli(analyzeArgs());
  assert.ok(proc.status === 0 || proc.status === 1, proc.stderr);
  const packet = parseCliJson(proc);
  assert.equal(packet.schema, "s127.upgrade-impact.packet.v1");
  assert.ok(["action", "unknown", "no_action"].includes(packet.summary.nextAction));
  assert.equal(packet.execute, false);
  assert.equal(packet.offline, true);
});

function collectJs(dir) {
  const out = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, name.name);
    if (name.isDirectory()) out.push(...collectJs(path));
    else if (name.name.endsWith(".mjs")) out.push(path);
  }
  return out;
}
