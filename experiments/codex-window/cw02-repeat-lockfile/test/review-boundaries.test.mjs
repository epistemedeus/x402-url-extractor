import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { approvalTemplate, assertApproval, executeJob, prepareJob } from "../src/binder.mjs";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "cw35-boundary-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const job = JSON.parse(await readFile(join(ROOT, "examples/npm-change.job.json"), "utf8"));
  const previous = { lockfileVersion: 3, packages: { "workspace/lib": { name: "lib", version: "1", integrity: "sha512-test", resolved: "https://registry.example/lib" } } };
  const before = join(dir, "before.json"), after = join(dir, "after.json"), path = join(dir, "job.json");
  job.inputs = { previous: before, current: after };
  const save = async (a = previous, b = previous) => {
    await writeFile(before, JSON.stringify(a)); await writeFile(after, JSON.stringify(b));
    await writeFile(path, JSON.stringify(job));
  };
  await save();
  return { dir, job, previous, path, before, after, save };
}
test("prepared normalization agrees with maintained pin identity", async (t) => {
  const f = await fixture(t);
  const next = structuredClone(f.previous);
  next.packages["workspace/lib"] = { name: " lib ", version: 1, integrity: " sha512-test ", resolved: " https://registry.example/lib " };
  await f.save(f.previous, next);
  assert.equal(prepareJob({ jobPath: f.path, stateDir: f.dir }).intent.analysis, "informational");
});
test("non-string integrity is partial and array package entries are ignored", async (t) => {
  const f = await fixture(t);
  f.previous.packages["workspace/lib"].integrity = 123;
  f.previous.packages["node_modules/invalid"] = [];
  await f.save();
  const { intent } = prepareJob({ jobPath: f.path, stateDir: f.dir });
  assert.equal(intent.analysis, "partial");
  assert.equal(intent.counts.beforePins, 1);
});
test("malformed terms are refused before an approval request is produced", async (t) => {
  const f = await fixture(t);
  for (const [field, value] of [["amountCapAtomic", "0"], ["asset", "not-address"], ["maxTimeoutSeconds", "300"], ["network", "foreign"], ["requiredOutput", {}]]) {
    const original = f.job.terms[field]; f.job.terms[field] = value; await f.save();
    assert.throws(() => prepareJob({ jobPath: f.path, stateDir: f.dir }), (e) => e.code === "invalid_terms", field);
    f.job.terms[field] = original;
  }
});
test("truthy strings are not the separate execution approval", async (t) => {
  const f = await fixture(t);
  const { intent } = prepareJob({ jobPath: f.path, stateDir: f.dir });
  const approval = join(f.dir, "approval.json");
  await writeFile(approval, JSON.stringify({ ...approvalTemplate(intent), permissionToSign: true, approvedAt: "2026-09-12T00:00:00Z", approvedBy: "fixture" }));
  await assert.rejects(executeJob({ jobPath: f.path, stateDir: f.dir, approvalPath: approval, approve: "false", privateKeyEnv: "MISSING", customerCli: join(f.dir, "missing.mjs") }), (e) => e.code === "approval_refused");
});
test("approval attribution must be valid text and time, not truthy objects", async (t) => {
  const f = await fixture(t); const { intent } = prepareJob({ jobPath: f.path, stateDir: f.dir });
  assert.throws(() => assertApproval(intent, { ...approvalTemplate(intent), permissionToSign: true, approvedAt: {}, approvedBy: {} }), (e) => e.code === "approval_refused");
});
test("CLI refuses unknown or missing flags without preparing an intent", async (t) => {
  const f = await fixture(t);
  const cli = join(ROOT, "bin/repeat-lockfile.mjs");
  for (const suffix of [["--permission-to-sign", "true"], ["--customer-cli"]]) {
    const out = spawnSync(process.execPath, [cli, "prepare", "--job", f.path, "--state-dir", f.dir, ...suffix], { encoding: "utf8" });
    assert.notEqual(out.status, 0, out.stdout);
  }
});

test("byte and depth ceilings refuse oversized local inputs before approval", async (t) => {
  const f = await fixture(t);
  await writeFile(f.before, " ".repeat(128 * 1024 + 1));
  assert.throws(() => prepareJob({ jobPath: f.path, stateDir: f.dir }), (e) => e.code === "input_too_large");
  let deep = {};
  for (let i = 0; i < 34; i++) deep = { child: deep };
  f.previous.extra = deep; await f.save();
  assert.throws(() => prepareJob({ jobPath: f.path, stateDir: f.dir }), (e) => e.code === "input_too_large");
});
test("BOM input and workspace fallback names retain canonical meaning", async (t) => {
  const f = await fixture(t);
  delete f.previous.packages["workspace/lib"].name;
  const after = structuredClone(f.previous); after.packages["workspace/lib"].name = "workspace/lib";
  await f.save(f.previous, after);
  await writeFile(f.before, "\uFEFF" + JSON.stringify(f.previous));
  assert.equal(prepareJob({ jobPath: f.path, stateDir: f.dir }).intent.analysis, "informational");
});
test("equivalent network and address formatting keeps approved terms stable", async (t) => {
  const f = await fixture(t), initial = prepareJob({ jobPath: f.path, stateDir: f.dir }).intent;
  f.job.terms.network = " eip155:8453 ";
  f.job.terms.asset = f.job.terms.asset.toLowerCase();
  f.job.terms.recipient = f.job.terms.recipient.toLowerCase();
  f.job.terms.requiredOutput.requiredFields.reverse();
  await f.save();
  assert.equal(prepareJob({ jobPath: f.path, stateDir: f.dir }).intent.termsSha256, initial.termsSha256);
});
test("preexisting dispatch lock blocks wallet child even if state still says prepared", async (t) => {
  const f = await fixture(t), prepared = prepareJob({ jobPath: f.path, stateDir: f.dir });
  const approval = join(f.dir, "approval.json");
  await writeFile(approval, JSON.stringify({ ...approvalTemplate(prepared.intent), permissionToSign: true, approvedAt: "2026-09-12T00:00:00Z", approvedBy: "fixture" }));
  await writeFile(join(prepared.intentDir, "dispatch.lock"), "");
  await assert.rejects(executeJob({ jobPath: f.path, stateDir: f.dir, approvalPath: approval, approve: true, privateKeyEnv: "MISSING", customerCli: join(ROOT, "bin/repeat-lockfile.mjs") }), (e) => e.code === "resume_required");
  assert.equal(JSON.parse(await readFile(prepared.statePath, "utf8")).phase, "prepared");
});

test("non-regular FIFO inputs are rejected without a blocking read", async (t) => {
  const f = await fixture(t), fifo = join(f.dir, "input.fifo");
  assert.equal(spawnSync("mkfifo", [fifo]).status, 0);
  f.job.inputs.previous = fifo; await writeFile(f.path, JSON.stringify(f.job));
  const result = spawnSync(process.execPath, [join(ROOT, "bin/repeat-lockfile.mjs"), "prepare", "--job", f.path, "--state-dir", f.dir], { encoding: "utf8", timeout: 2000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stderr).code, "invalid_input");
});
test("split UTF-8 child output is preserved and unknown zero-exit output cannot claim success", async (t) => {
  const f = await fixture(t), prepared = prepareJob({ jobPath: f.path, stateDir: f.dir });
  const approval = join(f.dir, "approval.json"), cli = join(f.dir, "fixture-cli.mjs");
  await writeFile(approval, JSON.stringify({ ...approvalTemplate(prepared.intent), permissionToSign: true, approvedAt: "2026-09-12T00:00:00Z", approvedBy: "fixture" }));
  await writeFile(cli, 'const bytes = Buffer.from(JSON.stringify({outcome:"unknown", message:"🌐"})); const at = bytes.indexOf(Buffer.from("🌐"))+1; process.stdout.write(bytes.subarray(0,at)); setTimeout(()=>process.stdout.write(bytes.subarray(at)),10);');
  const result = await executeJob({ jobPath: f.path, stateDir: f.dir, approvalPath: approval, approve: true, privateKeyEnv: "MISSING", customerCli: cli });
  assert.equal(result.payload.message, "🌐");
  assert.equal(result.code, 2);
  assert.equal(result.phase, "failed_before_identity");
});
test("oversized child output is killed and kept unconfirmed", async (t) => {
  const f = await fixture(t), prepared = prepareJob({ jobPath: f.path, stateDir: f.dir });
  const approval = join(f.dir, "approval.json"), cli = join(f.dir, "fixture-cli.mjs");
  await writeFile(approval, JSON.stringify({ ...approvalTemplate(prepared.intent), permissionToSign: true, approvedAt: "2026-09-12T00:00:00Z", approvedBy: "fixture" }));
  await writeFile(cli, 'process.stdout.write("x".repeat(3*1024*1024));');
  const result = await executeJob({ jobPath: f.path, stateDir: f.dir, approvalPath: approval, approve: true, privateKeyEnv: "MISSING", customerCli: cli });
  assert.equal(result.limitExceeded, true);
  assert.equal(result.code, 2);
  assert.equal(result.payload.outcome, "unknown");
  assert.ok(result.stdout.length + result.stderr.length < 1000);
  await assert.rejects(executeJob({ jobPath: f.path, stateDir: f.dir, approvalPath: approval, approve: true, privateKeyEnv: "MISSING", customerCli: cli }), (e) => e.code === "resume_required");
});
