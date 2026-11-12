import assert from "node:assert/strict";
import { chmod, chown, link, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createHash, createHmac } from "node:crypto";
import {
  CORRELATION_ID_RE,
  ContinuationError,
  ERROR_CODES,
  ERROR_MESSAGES,
  EXIT_CATEGORIES,
  MODULE_VERSION,
  canonicalJson,
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

// ---- 1.2.0 ----

const LEGACY_HASH = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function legacyToken(secretEntry, payload) {
  const body = `tc1.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  return `${body}.${createHmac("sha256", secretEntry.secret).update(body).digest("base64url")}`;
}

test("module version is 1.3.0", () => {
  assert.equal(MODULE_VERSION, "1.3.0");
});

test("hashJson is canonical: key order never changes the hash", () => {
  const a = { url: "https://example.invalid/a", fields: { title: 1, body: [{ y: 2, x: 1 }] }, n: null };
  const b = { n: null, fields: { body: [{ x: 1, y: 2 }], title: 1 }, url: "https://example.invalid/a" };
  assert.equal(hashJson(a), hashJson(b));
  assert.equal(canonicalJson(b), '{"fields":{"body":[{"x":1,"y":2}],"title":1},"n":null,"url":"https://example.invalid/a"}');
  assert.notEqual(hashJson([1, 2]), hashJson([2, 1]));
  // Same bytes as 1.1.0 for arrays and scalars; different for unsorted objects.
  assert.equal(hashJson(["https://example.invalid/a"]), LEGACY_HASH(["https://example.invalid/a"]));
  assert.notEqual(hashJson(b), LEGACY_HASH(b));
  for (const bad of [{ a: undefined }, [undefined], Number.NaN, Infinity, 1n, new Date(0)]) {
    assert.equal(code(() => hashJson(bad)), "continuation_invalid");
  }
});

test("migration: a 1.1.0 token or file (no hash marker) is refused with continuation_hash_legacy", async (t) => {
  const issued = issueContinuation({ keyring, tool, subject });
  const payload = JSON.parse(Buffer.from(issued.token.split(".")[1], "base64url").toString("utf8"));
  assert.equal(payload.h, "cj1");
  const { h, ...oldPayload } = payload;
  const old = legacyToken(NEW, oldPayload);
  assert.equal(code(() => verifyContinuation(old, { keyring, tool, subject, correlationId: issued.correlationId })), "continuation_hash_legacy");
  // A forged legacy token is still a signature failure, not a migration hint.
  const forged = legacyToken({ secret: "q".repeat(40) }, oldPayload);
  assert.equal(code(() => verifyContinuation(forged, { keyring, tool, subject, correlationId: issued.correlationId })), "continuation_token_invalid");
  const dir = await scratch(t);
  const file = path.join(dir, "old.json");
  const { hashAlg, ...oldRecord } = issued;
  await writeFile(file, `${JSON.stringify({ ...oldRecord, token: old, schema: "task-continuation.file.v1" })}\n`, { mode: 0o600 });
  await chmod(file, 0o600);
  await refusedWith(loadContinuationFile(file), "continuation_hash_legacy");
  assert.equal(ERROR_CODES.continuation_hash_legacy.retryable, false);
});

test("load validates step, expiresAt and tool", async (t) => {
  const dir = await scratch(t);
  const issued = issueContinuation({ keyring, tool, subject });
  const file = await saveContinuationFile(path.join(dir, "chain.json"), issued);
  assert.equal((await loadContinuationFile(file, { tool })).tool, tool);
  await refusedWith(loadContinuationFile(file, { tool: "extract" }), "continuation_wrong_tool");
  await refusedWith(loadContinuationFile(file, { nowMs: Date.parse(issued.expiresAt) }), "continuation_expired");
  const stale = issueContinuation({ keyring, tool, subject, nowMs: Date.now() - 400 * 86_400_000 });
  const staleFile = await saveContinuationFile(path.join(dir, "stale.json"), stale);
  await refusedWith(loadContinuationFile(staleFile), "continuation_expired");
  const raw = async (name, record) => {
    const target = path.join(dir, name);
    await writeFile(target, `${JSON.stringify({ ...record, schema: "task-continuation.file.v1" })}\n`, { mode: 0o600 });
    await chmod(target, 0o600);
    return target;
  };
  for (const [name, patch] of [
    ["neg-step", { step: -1 }], ["frac-step", { step: 1.5 }], ["str-step", { step: "1" }], ["no-step", { step: undefined }],
    ["bad-exp", { expiresAt: "tomorrow" }], ["exp-no-ms", { expiresAt: "2099-01-01T00:00:00Z" }], ["exp-feb30", { expiresAt: "2099-02-30T00:00:00.000Z" }],
    ["empty-tool", { tool: "" }], ["num-tool", { tool: 7 }], ["no-tool", { tool: undefined }],
  ]) {
    await refusedWith(loadContinuationFile(await raw(`${name}.json`, { ...issued, ...patch })), "continuation_file_invalid");
  }
  await refusedWith(saveContinuationFile(path.join(dir, "neg.json"), { ...issued, step: -1 }), "continuation_file_invalid");
});

test("store refuses a hard-linked file on load and save", async (t) => {
  const dir = await scratch(t);
  const issued = issueContinuation({ keyring, tool, subject });
  const file = await saveContinuationFile(path.join(dir, "chain.json"), issued);
  const second = path.join(dir, "second.json");
  await link(file, second);
  await refusedWith(loadContinuationFile(file), "continuation_file_hardlink");
  await refusedWith(loadContinuationFile(second), "continuation_file_hardlink");
  await refusedWith(saveContinuationFile(file, { ...issued, step: 1 }), "continuation_file_hardlink");
  await rm(second);
  assert.equal((await loadContinuationFile(file)).step, 0);
});

test("/tmp-style sticky world-writable directory is refused as a parent", async (t) => {
  const dir = await scratch(t);
  const sticky = path.join(dir, "sticky");
  await mkdir(sticky);
  await chmod(sticky, 0o1777);
  await refusedWith(saveContinuationFile(path.join(sticky, "chain.json"), issueContinuation({ keyring, tool, subject })), "continuation_file_parent_writable");
});

// Tiny dependency-free checker for the subset record.schema.json uses.
function check(schema, value, at = "$") {
  const errors = [];
  if (Object.hasOwn(schema, "const") && value !== schema.const) errors.push(`${at}: const`);
  if (schema.type === "object" && (typeof value !== "object" || value === null || Array.isArray(value))) return [`${at}: type object`];
  if (schema.type === "string" && typeof value !== "string") return [`${at}: type string`];
  if (schema.type === "integer" && !Number.isInteger(value)) return [`${at}: type integer`];
  if (typeof schema.minimum === "number" && !(value >= schema.minimum)) errors.push(`${at}: minimum`);
  if (typeof schema.maxLength === "number" && value.length > schema.maxLength) errors.push(`${at}: maxLength`);
  if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) errors.push(`${at}: pattern`);
  for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) errors.push(`${at}.${key}: required`);
  for (const [key, sub] of Object.entries(schema.properties ?? {})) if (Object.hasOwn(value, key)) errors.push(...check(sub, value[key], `${at}.${key}`));
  if (schema.not && check(schema.not, value, at).length === 0) errors.push(`${at}: not`);
  return errors;
}

test("saved output validates against the published record.schema.json", async (t) => {
  const schema = JSON.parse(await readFile(new URL("../record.schema.json", import.meta.url), "utf8"));
  const known = new Set(["$schema", "$id", "title", "description", "type", "required", "properties", "not", "const", "pattern", "minimum", "maxLength"]);
  const walk = (node) => { for (const [key, value] of Object.entries(node)) { if (!known.has(key)) assert.fail(`checker does not support ${key}`); if (key === "properties") Object.values(value).forEach(walk); if (key === "not") walk(value); } };
  walk(schema);
  const dir = await scratch(t);
  const first = issueContinuation({ keyring, tool, subject, bindings: { termsVersion: terms } });
  const verified = verifyContinuation(first.token, { keyring, tool, subject, bindings: { termsVersion: terms }, correlationId: first.correlationId });
  for (const issued of [first, issueContinuation({ keyring, tool, subject, bindings: { termsVersion: terms }, previous: verified })]) {
    const file = await saveContinuationFile(path.join(dir, `chain-${issued.step}.json`), issued);
    const saved = JSON.parse(await readFile(file, "utf8"));
    assert.deepEqual(check(schema, saved), []);
    assert.deepEqual(check(schema, await loadContinuationFile(file)), []);
  }
  const saved = JSON.parse(await readFile(path.join(dir, "chain-0.json"), "utf8"));
  assert.notDeepEqual(check(schema, { ...saved, step: -1 }), []);
  assert.notDeepEqual(check(schema, { ...saved, hashAlg: undefined }), []);
  assert.notDeepEqual(check(schema, { ...saved, discovery: { status: "declared", source: "cli" } }), []);
  const { hashAlg, ...legacy } = saved;
  assert.notDeepEqual(check(schema, legacy), []);
});

test("ERROR_CODES covers every code the module throws, with a valid exit row", async () => {
  const source = await readFile(new URL("../index.mjs", import.meta.url), "utf8");
  const thrown = new Set([...source.matchAll(/(?:fail|storeFail)\("([a-z_]+)"\)/g)].map((match) => match[1]));
  assert.ok(thrown.size >= 20);
  for (const name of thrown) assert.ok(Object.hasOwn(ERROR_CODES, name), `${name} missing from ERROR_CODES`);
  assert.deepEqual(Object.keys(ERROR_CODES).sort(), Object.keys(ERROR_MESSAGES).sort());
  assert.deepEqual([...EXIT_CATEGORIES].sort(), ["auth", "conflict", "expired", "integrity", "io", "not_found", "usage"]);
  assert.ok(Object.isFrozen(ERROR_CODES));
  const exitByCategory = new Map();
  for (const [name, entry] of Object.entries(ERROR_CODES)) {
    assert.ok(Object.isFrozen(entry), name);
    assert.deepEqual(Object.keys(entry).sort(), ["exitCategory", "exitCode", "retryable"]);
    assert.ok(EXIT_CATEGORIES.includes(entry.exitCategory), name);
    assert.equal(typeof entry.retryable, "boolean");
    assert.ok(Number.isInteger(entry.exitCode) && entry.exitCode > 1 && entry.exitCode < 64, name);
    if (exitByCategory.has(entry.exitCategory)) assert.equal(exitByCategory.get(entry.exitCategory), entry.exitCode);
    exitByCategory.set(entry.exitCategory, entry.exitCode);
    assert.equal(new ContinuationError(name).code, name);
    assert.equal(refusal(name).message, ERROR_MESSAGES[name]);
  }
  assert.equal(ERROR_CODES.continuation_expired.exitCategory, "expired");
  assert.equal(ERROR_CODES.continuation_file_missing.exitCategory, "not_found");
  assert.equal(ERROR_CODES.continuation_file_io.retryable, true);
});

test("a caller with no issuer may mint a declared, non-authorizing correlationId", () => {
  const correlationId = mintCorrelationId();
  const record = measurementRecord({ correlationId, discovery: { status: "declared", source: "cli" }, step: 0, tool });
  assert.equal(record.discovery.status, "declared");
  // It authorizes nothing: a token issued under another correlationId refuses it.
  const issued = issueContinuation({ keyring, tool, subject });
  assert.equal(code(() => verifyContinuation(issued.token, { keyring, tool, subject, correlationId })), "continuation_correlation_mismatch");
  for (const status of ["observed", "declared", "unknown"]) {
    assert.equal(measurementRecord({ correlationId, discovery: { status, source: "cli" }, step: 0, tool }).discovery.status, status);
  }
  assert.equal(measurementRecord({ correlationId, discovery: { status: "verified", source: "cli" }, step: 0, tool }).discovery.status, "unknown");
});
