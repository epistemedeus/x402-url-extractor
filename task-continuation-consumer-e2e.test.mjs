// End to end with a normal consumer: the existing SameDayDesk page-change CLI,
// each step a new process, on a new task (fresh directory, new chain), with one
// failed call and a useful recovery. Its measurement line is checked with the
// portable task-continuation 1.3.0 validator, so both emitters share one shape.
// Dependency-free. Offline: nothing is fetched, paid or sent.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkMeasurementRecord, ERROR_CODES } from "./packages/task-continuation/index.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(ROOT, "examples/customer-x402/bin/page-change.mjs");
const C1 = path.join(ROOT, "examples/customer-x402/fixtures/page-change/c1");
const NEXT = path.join(ROOT, "recipes/free-continuation/fixtures/next.json");
const OTHER = path.join(ROOT, "recipes/free-continuation/fixtures/other-sources.json");
const cli = (cwd, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", timeout: 60_000 });
const lastJson = (text) => JSON.parse(text.trim().split("\n").at(-1));

test("CLI as a normal consumer: new process per step, one failed call, recovery on the same chain", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "sdd-consumer-"));
  await chmod(dir, 0o700);
  t.after(() => rm(dir, { recursive: true, force: true }));

  const start = cli(dir, "compare", "--before", path.join(C1, "before.json"), "--after", path.join(C1, "after.json"), "--fields", "title,description", "--save-continuation", "chain.json", "--discovery", "cli");
  assert.equal(start.status, 0, start.stderr);
  const first = lastJson(start.stderr).measurement;
  assert.deepEqual(checkMeasurementRecord(first), first);
  assert.deepEqual(first.discovery, { status: "declared", source: "cli" });
  assert.deepEqual(first.entrySurface, { surface: "installed", basis: "local_cli", transport: "cli" });
  const saved = JSON.parse(await readFile(path.join(dir, "chain.json"), "utf8"));
  assert.equal(saved.token, null, "a local step never holds a server token");

  // The failed call: a new process continues with an observation of other sources.
  const failed = cli(dir, "compare", "--continue", "chain.json", "--after", OTHER);
  assert.equal(failed.status, 2);
  const refusal = lastJson(failed.stderr);
  assert.equal(refusal.code, "continuation_subject_mismatch");
  assert.equal(refusal.charged, false);
  assert.match(refusal.nextStep, /new after observation|new chain/);
  assert.equal(ERROR_CODES[refusal.code].exitCategory, "conflict");
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, "chain.json"), "utf8")), saved, "a refused call leaves the recovery record unchanged");

  // Recovery: a new process, the same held chain, a valid next observation.
  const recovered = cli(dir, "compare", "--continue", "chain.json", "--after", NEXT, "--save-continuation", "chain.json");
  assert.equal(recovered.status, 0, recovered.stderr);
  const second = lastJson(recovered.stderr).measurement;
  assert.deepEqual(checkMeasurementRecord(second), second);
  assert.equal(second.correlationId, first.correlationId);
  assert.equal(second.step, 1);
  assert.ok(Date.parse(second.occurredAt) >= Date.parse(first.occurredAt));
  assert.deepEqual(second.discovery, { status: "unknown", source: null });
  assert.equal(second.discoveryBasis, null);
});
