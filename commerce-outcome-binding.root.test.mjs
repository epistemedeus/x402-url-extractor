import assert from "node:assert/strict";
import { mkdtemp, open, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { TASK_REF_FILENAME, authorizeOutcomeBinding, buildTaskRefRecord, createForwardOutcomeWriter } from "./commerce-outcome-binding.mjs";

const TOKEN = "root-task-ref-regression-secret-32-bytes";
const A = "10000000-0000-4000-8000-000000000001";
const B = "10000000-0000-4000-8000-000000000002";
function record(id) {
  const claim = authorizeOutcomeBinding({
    "x-samedaydesk-internal": TOKEN,
    "x-samedaydesk-outcome-operation": "op-root-regression",
    "x-samedaydesk-outcome-cohort": "controlled_test",
    "x-samedaydesk-outcome-task": "task-root-regression",
  }, TOKEN);
  return buildTaskRefRecord({ claim, commerceEventId: id });
}
function writer(dir, maxBytes = 65536) {
  return createForwardOutcomeWriter({ dataDir: dir, maxBytes, internalToken: TOKEN });
}

test("restart reads a bounded tail from a huge sparse file, not the whole file", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "root-task-ref-sparse-"));
  try {
    const target = path.join(dir, TASK_REF_FILENAME);
    const handle = await open(target, "w", 0o600);
    const bytes = Buffer.from(`\n${JSON.stringify(record(A))}\n`);
    try {
      // readFile rejects files this large; a bounded descriptor read succeeds.
      const logicalSize = 2 ** 32;
      await handle.truncate(logicalSize);
      await handle.write(bytes, 0, bytes.length, logicalSize - bytes.length);
    } finally {
      await handle.close();
    }
    assert.equal((await writer(dir, 1024).appendTaskRef(record(A))).reason, "duplicate");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("append separates an unterminated complete or torn record without rewriting evidence", async () => {
  for (const suffix of ["", "\n{torn-record"]) {
    const dir = await mkdtemp(path.join(tmpdir(), "root-task-ref-tail-"));
    try {
      const target = path.join(dir, TASK_REF_FILENAME);
      const before = JSON.stringify(record(A)) + suffix;
      await writeFile(target, before, { mode: 0o600 });
      assert.equal((await writer(dir).appendTaskRef(record(B))).accepted, true);
      const after = await readFile(target, "utf8");
      assert.equal(after.startsWith(before + "\n"), true);
      assert.equal(after.split("\n").filter(line => line === JSON.stringify(record(B))).length, 1);
      const reopened = writer(dir);
      assert.equal((await reopened.appendTaskRef(record(A))).reason, "duplicate");
      assert.equal((await reopened.appendTaskRef(record(B))).reason, "duplicate");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("a symlink cannot redirect the task-reference append or expose another file", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "root-task-ref-symlink-"));
  try {
    const target = path.join(dir, "other-evidence.txt");
    await writeFile(target, "preserved evidence", { mode: 0o600 });
    await symlink(target, path.join(dir, TASK_REF_FILENAME));
    const result = await writer(dir).appendTaskRef(record(A));
    assert.equal(result.accepted, false);
    assert.equal(result.reason, "write_outcome_unknown");
    assert.equal(await readFile(target, "utf8"), "preserved evidence");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
