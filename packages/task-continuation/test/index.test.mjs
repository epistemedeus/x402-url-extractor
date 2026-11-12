import assert from "node:assert/strict";
import { chmod, chown, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CORRELATION_ID_RE,
  ContinuationError,
  createKeyring,
  discovery,
  hashJson,
  isCorrelationId,
  issueContinuation,
  keyringFromString,
  loadContinuationFile,
  measurementRecord,
  mintCorrelationId,
  publicView,
  refusal,
  saveContinuationFile,
  stepEventId,
  verifyContinuation,
} from "../index.mjs";

const OLD = { kid: "k1", secret: "a".repeat(40) };
const NEW = { kid: "k2", secret: "b".repeat(40) };
const keyring = createKeyring([NEW, OLD]);
const tool = "compare_page_observations";
const subject = hashJson(["https://example.invalid/a"]);
const terms = `sha256:${"c".repeat(64)}`;

function code(fn) {
  try { fn(); } catch (error) { assert.ok(error instanceof ContinuationError); return error.code; }
  return "no_error";
}

test("issue, verify and continue a chain with one correlationId", () => {
  const first = issueContinuation({ keyring, tool, subject, bindings: { termsVersion: terms } });
  assert.match(first.correlationId, CORRELATION_ID_RE);
  assert.equal(first.step, 0);
  assert.equal(first.kid, "k2");
  assert.ok(first.token.length <= 1024);
  const verified = verifyContinuation(first.token, { keyring, tool, subject, bindings: { termsVersion: terms }, correlationId: first.correlationId });
  const next = issueContinuation({ keyring, tool, subject, bindings: { termsVersion: terms }, previous: verified });
  assert.equal(next.step, 1);
  assert.equal(next.correlationId, first.correlationId);
  const payload = Buffer.from(first.token.split(".")[1], "base64url").toString("utf8");
  assert.equal(payload.includes(first.correlationId), false);
  assert.equal(payload.includes("example.invalid"), false);
});

test("rotation keeps an old kid valid; unknown kid, tamper and expiry are refused", () => {
  const oldOnly = createKeyring([OLD]);
  const old = issueContinuation({ keyring: oldOnly, tool, subject });
  assert.equal(verifyContinuation(old.token, { keyring, tool, subject, correlationId: old.correlationId }).kid, "k1");
  const stranger = issueContinuation({ keyring: createKeyring([{ kid: "k9", secret: "z".repeat(40) }]), tool, subject });
  assert.equal(code(() => verifyContinuation(stranger.token, { keyring, tool, subject, correlationId: stranger.correlationId })), "continuation_unknown_key");
  const tampered = `${old.token.slice(0, -4)}${old.token.endsWith("AAAA") ? "BBBB" : "AAAA"}`;
  assert.equal(code(() => verifyContinuation(tampered, { keyring, tool, subject, correlationId: old.correlationId })), "continuation_token_invalid");
  assert.equal(code(() => verifyContinuation(`tc1.${"A".repeat(2000)}.x`, { keyring, tool, subject })), "continuation_token_oversized");
  const stale = issueContinuation({ keyring, tool, subject, nowMs: Date.now() - 400 * 86_400_000 });
  assert.equal(code(() => verifyContinuation(stale.token, { keyring, tool, subject, correlationId: stale.correlationId })), "continuation_expired");
  assert.equal(code(() => verifyContinuation(old.token, { keyring: null, tool, subject })), "continuation_unavailable");
});

test("wrong tool, subject, binding or correlationId are refused", () => {
  const issued = issueContinuation({ keyring, tool, subject, bindings: { termsVersion: terms } });
  const base = { keyring, tool, subject, bindings: { termsVersion: terms }, correlationId: issued.correlationId };
  assert.equal(code(() => verifyContinuation(issued.token, { ...base, tool: "extract" })), "continuation_wrong_tool");
  assert.equal(code(() => verifyContinuation(issued.token, { ...base, subject: hashJson(["other"]) })), "continuation_subject_mismatch");
  assert.equal(code(() => verifyContinuation(issued.token, { ...base, bindings: { termsVersion: `sha256:${"d".repeat(64)}` } })), "continuation_binding_mismatch");
  assert.equal(code(() => verifyContinuation(issued.token, { ...base, correlationId: mintCorrelationId() })), "continuation_correlation_mismatch");
  assert.equal(code(() => issueContinuation({ keyring, tool, subject, bindings: { termsVersion: 3 } })), "continuation_invalid");
  assert.equal(code(() => issueContinuation({ keyring, tool, subject, bindings: { termsVersion: "c".repeat(64) } })), "continuation_invalid");
});

test("correlationId shape, keyring parsing, discovery and refusal shape", () => {
  for (let index = 0; index < 32; index += 1) assert.match(mintCorrelationId(), /^ae:corr:v1:[A-Za-z0-9_-]{22}$/);
  assert.equal(isCorrelationId("ae:corr:v1:short"), false);
  assert.equal(keyringFromString(`k2:${"b".repeat(40)},k1:${"a".repeat(40)}`).current.kid, "k2");
  assert.equal(keyringFromString("k1:short"), null);
  assert.equal(keyringFromString(`K1:${"a".repeat(40)}`), null);
  const sources = ["a2a", "cli", "mcp"];
  assert.deepEqual(discovery({ observed: "mcp", declared: "cli", sources }), { status: "observed", source: "mcp" });
  assert.deepEqual(discovery({ declared: "cli", sources }), { status: "declared", source: "cli" });
  assert.deepEqual(discovery({ declared: "nope", sources }), { status: "unknown", source: null });
  const body = refusal("continuation_expired", { nextMethod: "tools/call", nextStep: "Start a new chain." });
  assert.deepEqual(Object.keys(body).sort(), ["charged", "code", "error", "message", "nextMethod", "nextStep", "ok", "paymentRequired"]);
  assert.equal(body.charged, false);
  assert.equal(refusal("made_up").code, "continuation_invalid");
});

test("step event id is deterministic, v4-shaped and not the token", () => {
  const correlationId = mintCorrelationId();
  const id = stepEventId(correlationId, 3);
  assert.equal(id, stepEventId(correlationId, 3));
  assert.notEqual(id, stepEventId(correlationId, 4));
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

async function scratch(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "task-continuation-"));
  await chmod(dir, 0o700);
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function refusedWith(promise, expected) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof ContinuationError);
    assert.equal(error.code, expected);
    return true;
  });
}

test("happy path: caller file is 0600 and the public view never carries the token", async (t) => {
  const dir = await scratch(t);
  const issued = issueContinuation({ keyring, tool, subject });
  const file = await saveContinuationFile(path.join(dir, "chain.json"), issued);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  const loaded = await loadContinuationFile(file);
  assert.equal(loaded.token, issued.token);
  const view = publicView(loaded);
  assert.equal(JSON.stringify(view).includes(issued.token), false);
  assert.equal(Object.hasOwn(view, "discovery"), false);
  assert.equal(view.tokenHeld, true);
  assert.equal(view.correlationId, issued.correlationId);
  process.stdout.write(`# example correlationId ${view.correlationId}\n`);
  assert.ok((await readFile(file, "utf8")).includes("task-continuation.file.v1"));
  const again = await saveContinuationFile(file, { ...issued, step: 1 });
  assert.equal((await loadContinuationFile(again)).step, 1);
  assert.deepEqual((await readdir(dir)).filter((name) => name.endsWith(".tmp")), []);
});

test("store refuses missing, symlink, non-regular, wrong mode and oversized files", async (t) => {
  const dir = await scratch(t);
  const issued = issueContinuation({ keyring, tool, subject });
  const real = await saveContinuationFile(path.join(dir, "real.json"), issued);
  await refusedWith(loadContinuationFile(path.join(dir, "missing.json")), "continuation_file_missing");
  const link = path.join(dir, "link.json");
  await symlink(real, link);
  await refusedWith(loadContinuationFile(link), "continuation_file_symlink");
  await refusedWith(saveContinuationFile(link, issued), "continuation_file_symlink");
  const folder = path.join(dir, "folder.json");
  await mkdir(folder);
  await refusedWith(loadContinuationFile(folder), "continuation_file_not_regular");
  await refusedWith(saveContinuationFile(folder, issued), "continuation_file_not_regular");
  const loose = path.join(dir, "loose.json");
  await writeFile(loose, await readFile(real));
  await chmod(loose, 0o640);
  await refusedWith(loadContinuationFile(loose), "continuation_file_mode");
  await chmod(loose, 0o604);
  await refusedWith(loadContinuationFile(loose), "continuation_file_mode");
  const big = path.join(dir, "big.json");
  await writeFile(big, "x".repeat(70 * 1024), { mode: 0o600 });
  await chmod(big, 0o600);
  await refusedWith(loadContinuationFile(big), "continuation_file_oversized");
  await refusedWith(saveContinuationFile(path.join(dir, "huge.json"), { ...issued, padding: "x".repeat(70 * 1024) }), "continuation_file_oversized");
});

test("store refuses a group or other writable parent directory", async (t) => {
  const dir = await scratch(t);
  const open = path.join(dir, "shared");
  await mkdir(open);
  await chmod(open, 0o777);
  await refusedWith(saveContinuationFile(path.join(open, "chain.json"), issueContinuation({ keyring, tool, subject })), "continuation_file_parent_writable");
});

test("store refuses a file owned by another user", { skip: typeof process.getuid !== "function" || process.getuid() !== 0 ? "needs root to chown a fixture" : false }, async (t) => {
  const dir = await scratch(t);
  const file = await saveContinuationFile(path.join(dir, "chain.json"), issueContinuation({ keyring, tool, subject }));
  await chown(file, 65534, 65534);
  await refusedWith(loadContinuationFile(file), "continuation_file_owner");
});

test("measurement record is separate from the token", async (t) => {
  const issued = issueContinuation({ keyring, tool, subject });
  const record = measurementRecord({ correlationId: issued.correlationId, discovery: { status: "declared", source: "cli" }, step: issued.step, tool, outcome: "changed" });
  assert.deepEqual(Object.keys(record).sort(), ["correlationId", "discovery", "kind", "outcome", "step", "tool", "v"]);
  assert.deepEqual(record.discovery, { status: "declared", source: "cli" });
  const text = JSON.stringify(record);
  assert.equal(text.includes(issued.token), false);
  assert.equal(text.includes(issued.token.split(".")[2]), false);
  assert.equal(/"(token|continuation|kid)"/.test(text), false);
  assert.deepEqual(measurementRecord({ correlationId: issued.correlationId, step: 0, tool }).discovery, { status: "unknown", source: null });
  assert.equal(Object.hasOwn(issued, "discovery"), false);
  const dir = await scratch(t);
  await refusedWith(saveContinuationFile(path.join(dir, "mixed.json"), { ...issued, discovery: record.discovery }), "continuation_file_record_mixed");
});
