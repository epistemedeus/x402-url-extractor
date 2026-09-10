import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { requiredPacketFields } from "../../../scripts/lib/packet.mjs";

export const CELL_ROOT = resolveCellRoot();
export const PACK_ROOT = join(CELL_ROOT, "../..");
export const CLI = join(PACK_ROOT, "scripts/cli.mjs");
export const FIXTURES = join(CELL_ROOT, "fixtures");
export const SKILL = join(PACK_ROOT, "skills/upgrade-impact/SKILL.md");
export const CLOCK = "2026-09-10T12:00:00.000Z";
export const EMPTY_SRC = join(FIXTURES, "empty-src");

function resolveCellRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}

export function fixture(...parts) {
  return join(FIXTURES, ...parts);
}

export function runCli(args, { env = {}, timeout = 15000, cwd = PACK_ROOT } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    timeout,
    cwd,
    env: { ...process.env, ...env },
  });
}

/** Isolation: ignore pack src/ siblings so this cell's contract is tested alone. */
export function runIsolated(args, opts = {}) {
  return runCli(args, {
    ...opts,
    env: { S127_UPGRADE_IMPACT_SRC: EMPTY_SRC, ...(opts.env || {}) },
  });
}

export function parseCliJson(proc) {
  if (proc.error) throw proc.error;
  const text = proc.stdout || "";
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`stdout was not JSON: ${error.message}\nstdout=${text}\nstderr=${proc.stderr}`);
  }
}

export function analyzeArgs(extra = []) {
  return [
    "analyze",
    "--manifest",
    fixture("manifest.json"),
    "--source-root",
    fixture("source-root"),
    "--dep",
    "demo-dep",
    "--old",
    "1.0.0",
    "--new",
    "2.0.0",
    "--fixture-old",
    fixture("old-exports.json"),
    "--fixture-new",
    fixture("new-exports.json"),
    "--clock",
    CLOCK,
    ...extra,
  ];
}

export function assertPacketShape(assert, packet) {
  for (const key of requiredPacketFields()) {
    assert.ok(key in packet, `missing packet field ${key}`);
  }
  assert.equal(packet.schema, "s127.upgrade-impact.packet.v1");
  assert.equal(packet.clock, CLOCK);
  assert.equal(packet.createdAt, CLOCK);
  assert.equal(packet.execute, false);
  assert.equal(packet.posted, false);
  assert.equal(packet.payment.attempted, false);
  assert.ok(["fixture", "live-capture", "synthetic"].includes(packet.caller.evidenceClass));
  assert.ok(Array.isArray(packet.caller.sourceRoots));
  assert.ok(Array.isArray(packet.provenance));
  assert.ok(Array.isArray(packet.bindings));
  assert.ok(Array.isArray(packet.limitations));
  assert.ok(Array.isArray(packet.summary.unknownReasons));
  assert.ok(Array.isArray(packet.summary.unusedChanges));
  assert.ok(Array.isArray(packet.summary.actionableChanges));
  assert.ok(["action", "unknown", "no_action"].includes(packet.summary.nextAction));
  assert.equal(typeof packet.dependency.name, "string");
}
