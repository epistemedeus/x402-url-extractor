import { constants } from "node:fs";
import { lstat, open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { assert, digest, fail, MAX_RECEIPT_BYTES } from "./value.mjs";
import { verifyReceipt } from "./consumer.mjs";

export async function readJsonFile(file, max = MAX_RECEIPT_BYTES) {
  const fd = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await fd.stat();
    assert(before.isFile() && before.nlink === 1 && before.size <= max, "file_bounds_or_type");
    const bytes = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await fd.read(bytes, length, bytes.length - length, length);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    const after = await fd.stat();
    assert(length === before.size && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs, "file_changed_during_read");
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length))); }
    catch { fail("file_json_invalid"); }
  } finally { await fd.close(); }
}
async function syncDir(file) {
  const dir = await open(path.dirname(path.resolve(file)), constants.O_RDONLY | constants.O_DIRECTORY);
  try { await dir.sync(); } finally { await dir.close(); }
}

// One caller-owned document, created before HTTP. It is not a service store or
// financial journal. An existing in-flight document is quarantined, never sent again.
export async function reserveReceipt(file, raw) {
  const prepared = verifyReceipt(raw);
  assert(prepared.state === "in_flight", "receipt_not_pending");
  let fd;
  try { fd = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existing = verifyReceipt(await readJsonFile(file));
    assert(existing.contractDigest === prepared.contractDigest && existing.origin === prepared.origin, "receipt_scope_conflict");
    return { acquired: false, receipt: existing };
  }
  try {
    await fd.writeFile(JSON.stringify(prepared)); await fd.sync(); await syncDir(file);
    return { acquired: true, receipt: prepared };
  } catch { fail("receipt_write_outcome_unknown"); }
  finally { await fd.close(); }
}

export async function completeReceipt(file, expected, raw) {
  const completed = verifyReceipt(raw);
  const pending = verifyReceipt(expected);
  assert(completed.state === "captured" && pending.state === "in_flight"
    && completed.attemptId === pending.attemptId && completed.contractDigest === pending.contractDigest
    && completed.origin === pending.origin && completed.startedAt === pending.startedAt, "receipt_scope_conflict");
  const old = verifyReceipt(await readJsonFile(file));
  assert(digest(old) === digest(pending), "receipt_changed_before_completion");
  const st = await lstat(file);
  assert(st.isFile() && !st.isSymbolicLink() && st.nlink === 1, "file_bounds_or_type");
  const temp = path.join(path.dirname(path.resolve(file)), `.delivery-${completed.attemptId}.tmp`);
  let fd;
  try {
    fd = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await fd.writeFile(JSON.stringify(completed)); await fd.sync(); await fd.close(); fd = null;
    await syncDir(file);
    await rename(temp, file); await syncDir(file);
    return completed;
  } catch { fail("receipt_write_outcome_unknown"); }
  finally { await fd?.close(); await unlink(temp).catch(() => {}); }
}
