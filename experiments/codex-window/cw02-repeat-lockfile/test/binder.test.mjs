import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  approvalTemplate,
  assertApproval,
  BinderRefusal,
  classifyLockfile,
  prepareJob,
  RUNTIME_FORMATS,
} from "../src/binder.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const JOB = join(ROOT, "examples/npm-change.job.json");

test("binds exact npm bytes, meaningful pin change, route, body, and stable resume identity", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "cw02-bind-"));
  const first = prepareJob({ jobPath: JOB, stateDir });
  const second = prepareJob({ jobPath: JOB, stateDir });
  assert.equal(first.intent.analysis, "actionable");
  assert.equal(first.intent.counts.changed, 1);
  assert.equal(first.intent.request.method, "POST");
  assert.equal(first.intent.source.previous.format, "npm-package-lock-v3");
  assert.ok(first.intent.source.previous.bytes > 0);
  assert.match(first.intent.source.previous.sha256, /^[0-9a-f]{64}$/);
  assert.equal(first.intent.intentId, second.intent.intentId);
  assert.equal(first.intent.resumeId, second.intent.resumeId);
  const authorization = JSON.parse(await readFile(first.intent.authorizationPath, "utf8"));
  assert.equal(authorization.body.before.packages["node_modules/is-number"].version, "6.0.0");
  assert.equal(authorization.body.after.packages["node_modules/is-number"].version, "7.0.0");
  assert.equal(approvalTemplate(first.intent).permissionToSign, false);
});

test("correct no-change is informational success with its own content identity", async () => {
  const temp = await mkdtemp(join(tmpdir(), "cw02-no-change-"));
  const job = JSON.parse(await readFile(JOB, "utf8"));
  job.jobId = "cw02-no-change";
  job.inputs.current = job.inputs.previous;
  const jobPath = join(dirname(JOB), ".no-change.test.json");
  await writeFile(jobPath, `${JSON.stringify(job)}\n`);
  try {
    const prepared = prepareJob({ jobPath, stateDir: temp });
    assert.equal(prepared.intent.analysis, "informational");
    assert.equal(prepared.intent.counts.changed, 0);
    assert.equal(prepared.intent.counts.added, 0);
    assert.equal(prepared.intent.counts.removed, 0);
  } finally {
    await import("node:fs/promises").then(({ unlink }) => unlink(jobPath));
  }
});

test("runtime advertises npm only and refuses pnpm/yarn honestly", async () => {
  assert.deepEqual(RUNTIME_FORMATS, ["npm-package-lock-v2", "npm-package-lock-v3"]);
  for (const name of ["pnpm-lock.yaml", "yarn.lock"]) {
    const path = join(ROOT, "fixtures/unsupported", name);
    const bytes = await readFile(path, "utf8");
    assert.throws(() => classifyLockfile(path, bytes), (error) => error instanceof BinderRefusal && error.code === "unsupported_format");
  }
});

test("approval is separate, exact, and stale when priced terms change", async () => {
  const temp = await mkdtemp(join(tmpdir(), "cw02-terms-"));
  const original = prepareJob({ jobPath: JOB, stateDir: join(temp, "one") });
  const approval = { ...approvalTemplate(original.intent), permissionToSign: true, approvedAt: "2026-09-12T00:00:00Z", approvedBy: "fixture-operator" };
  assert.equal(assertApproval(original.intent, approval), true);
  const changedJob = JSON.parse(await readFile(JOB, "utf8"));
  changedJob.terms.amountCapAtomic = "6000";
  const changedPath = join(dirname(JOB), ".terms-change.test.json");
  await writeFile(changedPath, `${JSON.stringify(changedJob)}\n`);
  try {
    const changed = prepareJob({ jobPath: changedPath, stateDir: join(temp, "two") });
    assert.notEqual(changed.intent.intentId, original.intent.intentId);
    assert.throws(() => assertApproval(changed.intent, approval), (error) => error instanceof BinderRefusal && ["approval_stale", "terms_changed"].includes(error.code));
  } finally {
    await import("node:fs/promises").then(({ unlink }) => unlink(changedPath));
  }
});

test("scheduled input cannot smuggle permission to sign", async () => {
  const job = JSON.parse(await readFile(JOB, "utf8"));
  job.permissionToSign = true;
  const path = join(dirname(JOB), ".embedded-approval.test.json");
  await writeFile(path, `${JSON.stringify(job)}\n`);
  try {
    assert.throws(() => prepareJob({ jobPath: path, stateDir: join(ROOT, ".test-state") }), (error) => error instanceof BinderRefusal && error.code === "embedded_approval_refused");
  } finally {
    await import("node:fs/promises").then(({ unlink }) => unlink(path));
  }
});
