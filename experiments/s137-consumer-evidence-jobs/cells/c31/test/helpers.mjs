import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ARTIFACTS, PACKET_SCHEMA } from "../../../scripts/cli.mjs";

export const CELL_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const PACK_ROOT = join(CELL_ROOT, "../..");
export const CLI = join(PACK_ROOT, "scripts/cli.mjs");
export const SKILL = join(PACK_ROOT, "skills/consumer-evidence-jobs/SKILL.md");
export const FIXTURES = join(CELL_ROOT, "fixtures");
export const CLOCK = "2026-09-10T12:00:00.000Z";
export const EMPTY_SRC = join(FIXTURES, "empty-src");
export const STUB_SRC = join(FIXTURES, "stub-src");
export const OWNED_JOBS = join(PACK_ROOT, "docs/OWNED-JOBS-01-06.json");

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

export function runIsolated(args, opts = {}) {
  return runCli(args, {
    ...opts,
    env: { S137_CONSUMER_EVIDENCE_SRC: EMPTY_SRC, ...(opts.env || {}) },
  });
}

export function runStub(args, opts = {}) {
  return runCli(args, {
    ...opts,
    env: { S137_CONSUMER_EVIDENCE_SRC: STUB_SRC, ...(opts.env || {}) },
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

export function assertPacketShape(assert, packet) {
  assert.equal(packet.schema, PACKET_SCHEMA);
  assert.equal(packet.clock, CLOCK);
  assert.equal(packet.offline, true);
  assert.equal(packet.execute, false);
  assert.equal(packet.posted, false);
  assert.equal(packet.payment.attempted, false);
  assert.equal(packet.cost.assignmentSpendUsd, 0);
  assert.equal(packet.claims.inventsFacts, false);
  assert.equal(packet.claims.paidEndpoint, false);
  assert.equal(packet.claims.legalAttestation, false);
  assert.equal(packet.claims.modelAsOracle, false);
  assert.equal(packet.claims.assertsCustomerDemand, false);
  assert.ok(Array.isArray(packet.findings));
  assert.ok(Array.isArray(packet.citations));
  assert.ok(Array.isArray(packet.limitations));
  for (const finding of packet.findings) {
    assert.ok(Array.isArray(finding.citationIds) && finding.citationIds.length > 0, "finding needs citationIds");
    for (const id of finding.citationIds) {
      assert.ok(
        packet.citations.some((row) => row.id === id),
        `citation ${id} missing for finding ${finding.id}`,
      );
    }
  }
}

export { ARTIFACTS };
