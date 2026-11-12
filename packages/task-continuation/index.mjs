// task-continuation v1 (module 1.2.0): portable caller-held continuation for one task chain.
// Dependency-free ESM. The issuer stores nothing. A continuation is an
// HMAC-signed bearer token the caller keeps, plus a separate non-authorizing
// correlationId. See CONTRACT.md for the stable v1 contract.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const CONTRACT_VERSION = 1;
export const MODULE_VERSION = "1.2.0";
export const TOKEN_PREFIX = "tc1";
export const TOKEN_MAX_CHARS = 1024;
export const TOKEN_RE = /^tc1\.[A-Za-z0-9_-]{16,900}\.[A-Za-z0-9_-]{43}$/;
export const CORRELATION_ID_RE = /^ae:corr:v1:[A-Za-z0-9_-]{22}$/;
export const KID_RE = /^[a-z0-9-]{1,16}$/;
export const TOOL_RE = /^[A-Za-z0-9_.:/-]{1,128}$/;
export const HASH_RE = /^[a-f0-9]{64}$/;
export const BINDING_NAME_RE = /^[A-Za-z][A-Za-z0-9]{0,31}$/;
export const BINDING_VALUE_RE = /^(sha256:)?[a-f0-9]{64}$/;
export const TERMS_VERSION_RE = /^sha256:[a-f0-9]{64}$/;
export const DISCOVERY_STATUSES = Object.freeze(["observed", "declared", "unknown"]);
export const FILE_SCHEMA = "task-continuation.file.v1";
// 1.2.0: hashJson is canonical JSON. Tokens and files carry this marker so a
// 1.1.0 artifact (insertion-order hashJson) is refused, never silently mixed.
export const HASH_ALG = "cj1";
export const EXPIRES_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
export const FILE_MAX_BYTES = 64 * 1024;
export const MIN_SECRET_CHARS = 32;
export const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;
export const MAX_TTL_SECONDS = 30 * 24 * 60 * 60;
const MIN_TTL_SECONDS = 60;
const MAX_BINDINGS = 8;

export const ERROR_MESSAGES = Object.freeze({
  continuation_unavailable: "continuation is not configured",
  continuation_invalid: "continuation request is not a supported shape",
  continuation_token_oversized: "continuation token exceeds the size limit",
  continuation_token_invalid: "continuation token failed verification",
  continuation_unknown_key: "continuation token key is not in the current keyring",
  continuation_expired: "continuation token has expired",
  continuation_wrong_tool: "continuation token belongs to another tool",
  continuation_subject_mismatch: "continuation subject does not match",
  continuation_binding_mismatch: "continuation binding does not match",
  continuation_correlation_mismatch: "correlationId does not match this continuation token",
  continuation_file_invalid: "continuation file is not a supported shape",
  // 1.1.0 store hardening (EIN activation-continuation store standard).
  continuation_file_missing: "continuation file does not exist",
  continuation_file_symlink: "continuation path is a symlink",
  continuation_file_not_regular: "continuation path is not a regular file",
  continuation_file_mode: "continuation file must be mode 0600 with no group or other bits",
  continuation_file_owner: "continuation file is not owned by this user",
  continuation_file_oversized: "continuation file exceeds 64 KiB",
  continuation_file_parent_writable: "continuation directory is writable by group or other",
  continuation_file_record_mixed: "continuation record must not hold discovery beside the token",
  // 1.2.0.
  continuation_hash_legacy: "continuation was issued before canonical hashing; start a new chain",
  continuation_file_hardlink: "continuation file has more than one hard link",
  continuation_file_io: "continuation file could not be read or written",
});

const EXIT_CODES = Object.freeze({ usage: 2, auth: 3, not_found: 4, conflict: 5, integrity: 6, io: 7, expired: 8 });
const row = (exitCategory, retryable) => Object.freeze({ exitCategory, retryable, exitCode: EXIT_CODES[exitCategory] });

/**
 * Frozen code -> { exitCategory, retryable, exitCode } for every refusal code
 * this module throws. A CLI maps a ContinuationError to its exit status with
 * this table. retryable means the same call may succeed unchanged later.
 */
export const ERROR_CODES = Object.freeze({
  continuation_unavailable: row("auth", false),
  continuation_invalid: row("usage", false),
  continuation_token_oversized: row("usage", false),
  continuation_token_invalid: row("integrity", false),
  continuation_unknown_key: row("auth", false),
  continuation_expired: row("expired", false),
  continuation_wrong_tool: row("usage", false),
  continuation_subject_mismatch: row("conflict", false),
  continuation_binding_mismatch: row("conflict", false),
  continuation_correlation_mismatch: row("conflict", false),
  continuation_file_invalid: row("integrity", false),
  continuation_file_missing: row("not_found", false),
  continuation_file_symlink: row("integrity", false),
  continuation_file_not_regular: row("integrity", false),
  continuation_file_mode: row("integrity", false),
  continuation_file_owner: row("auth", false),
  continuation_file_oversized: row("integrity", false),
  continuation_file_parent_writable: row("integrity", false),
  continuation_file_record_mixed: row("usage", false),
  continuation_hash_legacy: row("conflict", false),
  continuation_file_hardlink: row("integrity", false),
  continuation_file_io: row("io", true),
});
export const EXIT_CATEGORIES = Object.freeze(Object.keys(EXIT_CODES));

export class ContinuationError extends Error {
  constructor(code) {
    const known = Object.hasOwn(ERROR_CODES, code) ? code : "continuation_invalid";
    super(ERROR_MESSAGES[known]);
    this.code = known;
  }
}

const fail = (code) => { throw new ContinuationError(code); };
const plain = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const b64url = (bytes) => Buffer.from(bytes).toString("base64url");
const hmac = (secret, text) => createHmac("sha256", secret).update(text).digest();

/**
 * Canonical JSON: object keys sorted recursively by UTF-16 code unit order,
 * arrays kept in order, no whitespace. Values JSON cannot carry (undefined,
 * functions, symbols, bigint, non-finite numbers) are refused, not dropped.
 */
export function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("continuation_invalid");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  fail("continuation_invalid");
}

/** sha256 hex of canonicalJson(value). Use for subject and binding hashes. Key order never changes the hash. */
export function hashJson(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/** Keyring from [{kid, secret}]. The first entry signs, every entry verifies. */
export function createKeyring(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const byKid = new Map();
  for (const entry of entries) {
    if (!plain(entry) || typeof entry.kid !== "string" || !KID_RE.test(entry.kid)) return null;
    if (typeof entry.secret !== "string" || entry.secret.length < MIN_SECRET_CHARS || byKid.has(entry.kid)) return null;
    byKid.set(entry.kid, { kid: entry.kid, secret: entry.secret });
  }
  return Object.freeze({ current: byKid.get(entries[0].kid), byKid });
}

/** Parse "kid:secret,kid:secret". Any bad entry returns null (continuation off). */
export function keyringFromString(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  const entries = [];
  for (const part of text.split(",")) {
    const split = part.indexOf(":");
    if (split <= 0) return null;
    entries.push({ kid: part.slice(0, split).trim(), secret: part.slice(split + 1).trim() });
  }
  return createKeyring(entries);
}

export function keyringFromEnv(env = process.env, name = "TASK_CONTINUATION_KEYS") {
  return keyringFromString(env?.[name]);
}

export function ttlSeconds(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) return DEFAULT_TTL_SECONDS;
  return Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, number));
}

export function mintCorrelationId() {
  return `ae:corr:v1:${randomBytes(16).toString("base64url")}`;
}

export function isCorrelationId(value) {
  return typeof value === "string" && CORRELATION_ID_RE.test(value);
}

function correlationCommitment(secret, correlationId) {
  return hmac(secret, `task-continuation/correlation|${correlationId}`).toString("hex");
}

function checkBindings(bindings) {
  if (bindings === undefined) return {};
  if (!plain(bindings)) fail("continuation_invalid");
  const names = Object.keys(bindings).sort();
  if (names.length > MAX_BINDINGS) fail("continuation_invalid");
  const out = {};
  for (const name of names) {
    const value = bindings[name];
    if (!BINDING_NAME_RE.test(name) || typeof value !== "string" || !BINDING_VALUE_RE.test(value)) fail("continuation_invalid");
    if (name === "termsVersion" && !TERMS_VERSION_RE.test(value)) fail("continuation_invalid");
    out[name] = value;
  }
  return out;
}

/**
 * Issue a continuation. tool and subject are caller-supplied; subject is a
 * 64-hex hash the caller computed (for example hashJson of normalized URLs).
 * Pass previous (a verified payload) to continue a chain at step + 1.
 */
export function issueContinuation({ keyring, tool, subject, bindings, previous = null, correlationId = null, ttl = DEFAULT_TTL_SECONDS, nowMs = Date.now() }) {
  if (!keyring?.current) fail("continuation_unavailable");
  if (typeof tool !== "string" || !TOOL_RE.test(tool)) fail("continuation_invalid");
  if (typeof subject !== "string" || !HASH_RE.test(subject)) fail("continuation_invalid");
  const bnd = checkBindings(bindings);
  const cor = previous?.correlationId ?? correlationId ?? mintCorrelationId();
  if (!isCorrelationId(cor)) fail("continuation_invalid");
  const step = previous ? previous.step + 1 : 0;
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + ttlSeconds(ttl);
  const payload = { v: CONTRACT_VERSION, kid: keyring.current.kid, tool, sub: subject, bnd, crh: correlationCommitment(keyring.current.secret, cor), step, iat, exp, h: HASH_ALG };
  const body = `${TOKEN_PREFIX}.${b64url(JSON.stringify(payload))}`;
  const token = `${body}.${b64url(hmac(keyring.current.secret, body))}`;
  if (token.length > TOKEN_MAX_CHARS) fail("continuation_token_oversized");
  return { v: CONTRACT_VERSION, tool, token, kid: payload.kid, correlationId: cor, step, expiresAt: new Date(exp * 1000).toISOString(), hashAlg: HASH_ALG };
}

/**
 * Verify a presented token against the expected tool, subject, bindings and
 * correlationId. Returns { ...payload, correlationId } or throws ContinuationError.
 * Check order is part of the contract (CONTRACT.md).
 */
export function verifyContinuation(token, { keyring, tool, subject, bindings, correlationId, nowMs = Date.now() }) {
  if (!keyring?.current) fail("continuation_unavailable");
  if (typeof token !== "string") fail("continuation_token_invalid");
  if (token.length > TOKEN_MAX_CHARS) fail("continuation_token_oversized");
  if (!TOKEN_RE.test(token)) fail("continuation_token_invalid");
  const [prefix, encoded, signature] = token.split(".");
  let payload;
  try { payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); } catch { fail("continuation_token_invalid"); }
  if (!plain(payload) || payload.v !== CONTRACT_VERSION || typeof payload.kid !== "string") fail("continuation_token_invalid");
  const key = keyring.byKid.get(payload.kid);
  if (!key) fail("continuation_unknown_key");
  const expected = hmac(key.secret, `${prefix}.${encoded}`);
  const presented = Buffer.from(signature, "base64url");
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) fail("continuation_token_invalid");
  if (typeof payload.tool !== "string" || !HASH_RE.test(payload.sub) || !HASH_RE.test(payload.crh) || !plain(payload.bnd)
    || !Number.isSafeInteger(payload.step) || payload.step < 0 || !Number.isSafeInteger(payload.exp)) fail("continuation_token_invalid");
  if (payload.h !== HASH_ALG) fail("continuation_hash_legacy");
  if (payload.exp * 1000 <= nowMs) fail("continuation_expired");
  if (payload.tool !== tool) fail("continuation_wrong_tool");
  if (payload.sub !== subject) fail("continuation_subject_mismatch");
  const expectedBindings = checkBindings(bindings);
  if (canonicalJson(payload.bnd) !== canonicalJson(expectedBindings)) fail("continuation_binding_mismatch");
  if (!isCorrelationId(correlationId)) fail("continuation_correlation_mismatch");
  const commitment = Buffer.from(correlationCommitment(key.secret, correlationId), "hex");
  if (!timingSafeEqual(commitment, Buffer.from(payload.crh, "hex"))) fail("continuation_correlation_mismatch");
  return { ...payload, correlationId };
}

/** observed (server evidence) > declared (caller) > unknown. Never from a token. */
export function discovery({ observed = null, declared = null, sources = [] } = {}) {
  const allowed = new Set(sources);
  if (typeof observed === "string" && allowed.has(observed)) return { status: "observed", source: observed };
  if (typeof declared === "string" && allowed.has(declared)) return { status: "declared", source: declared };
  return { status: "unknown", source: null };
}

/** Fixed refusal body. Never pass caller input into nextStep. */
export function refusal(code, { nextMethod, nextStep, ...extra } = {}) {
  const known = Object.hasOwn(ERROR_CODES, code) ? code : "continuation_invalid";
  return {
    ...extra,
    ok: false,
    charged: false,
    paymentRequired: false,
    error: known,
    code: known,
    message: ERROR_MESSAGES[known],
    nextMethod: typeof nextMethod === "string" ? nextMethod : null,
    nextStep: typeof nextStep === "string" ? nextStep : null,
  };
}

/** Deterministic v4-shaped UUID for one step, for journal dedup. Not from the token. */
export function stepEventId(correlationId, step, namespace = "task-continuation") {
  if (!isCorrelationId(correlationId) || !Number.isSafeInteger(step) || step < 0) fail("continuation_invalid");
  const hex = createHash("sha256").update(`${namespace}/step-event|${correlationId}|${step}`).digest("hex");
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Token-free view for stdout and logs. Carries no discovery: discovery belongs
 * only on a separate measurement record (see measurementRecord).
 */
export function publicView(record) {
  if (!plain(record)) return null;
  return {
    tool: record.tool ?? null,
    correlationId: record.correlationId ?? null,
    step: record.step ?? null,
    expiresAt: record.expiresAt ?? null,
    tokenHeld: typeof record.token === "string",
  };
}

const MEASUREMENT_OUTCOME_RE = /^[a-z][a-z0-9_]{0,31}$/;

/**
 * Separate measurement record: correlationId, explicit discovery, step, tool
 * and outcome only. Never a token, kid, or any token-derived field.
 */
export function measurementRecord({ correlationId, discovery: value, step, tool, outcome = null }) {
  if (!isCorrelationId(correlationId) || !Number.isSafeInteger(step) || step < 0) fail("continuation_invalid");
  if (typeof tool !== "string" || !TOOL_RE.test(tool)) fail("continuation_invalid");
  const status = DISCOVERY_STATUSES.includes(value?.status) ? value.status : "unknown";
  const source = status === "unknown" || typeof value?.source !== "string" ? null : value.source;
  if (outcome !== null && (typeof outcome !== "string" || !MEASUREMENT_OUTCOME_RE.test(outcome))) fail("continuation_invalid");
  return { v: CONTRACT_VERSION, kind: "measurement", tool, correlationId, step, discovery: { status, source }, outcome };
}

function storeFail(code) {
  throw new ContinuationError(code);
}

async function checkParent(directory) {
  const stats = await lstat(directory);
  if (stats.isSymbolicLink()) storeFail("continuation_file_symlink");
  if (!stats.isDirectory()) storeFail("continuation_file_not_regular");
  if ((stats.mode & 0o022) !== 0) storeFail("continuation_file_parent_writable");
}

function checkFileStats(stats) {
  if (stats.isSymbolicLink()) storeFail("continuation_file_symlink");
  if (!stats.isFile()) storeFail("continuation_file_not_regular");
  if (stats.size > FILE_MAX_BYTES) storeFail("continuation_file_oversized");
  if ((stats.mode & 0o077) !== 0) storeFail("continuation_file_mode");
  if (typeof process.getuid === "function" && stats.uid !== process.getuid()) storeFail("continuation_file_owner");
  if (stats.nlink > 1) storeFail("continuation_file_hardlink");
}

/** Record checks shared by save and load. Returns nothing or throws. */
function checkRecord(record, { tool: expectedTool, nowMs } = {}) {
  if (record.token !== null && record.token !== undefined && (typeof record.token !== "string" || !TOKEN_RE.test(record.token))) fail("continuation_file_invalid");
  if (record.correlationId !== undefined && !isCorrelationId(record.correlationId)) fail("continuation_file_invalid");
  if (typeof record.tool !== "string" || !TOOL_RE.test(record.tool)) fail("continuation_file_invalid");
  if (!Number.isSafeInteger(record.step) || record.step < 0) fail("continuation_file_invalid");
  if (typeof record.expiresAt !== "string" || !EXPIRES_AT_RE.test(record.expiresAt)) fail("continuation_file_invalid");
  const expiresMs = Date.parse(record.expiresAt);
  if (!Number.isFinite(expiresMs) || new Date(expiresMs).toISOString() !== record.expiresAt) fail("continuation_file_invalid");
  if (record.hashAlg !== HASH_ALG) fail("continuation_hash_legacy");
  if (Object.hasOwn(record, "discovery") && typeof record.token === "string") storeFail("continuation_file_record_mixed");
  if (nowMs !== undefined && expiresMs <= nowMs) fail("continuation_expired");
  if (expectedTool !== undefined && expectedTool !== null) {
    if (typeof expectedTool !== "string" || !TOOL_RE.test(expectedTool)) fail("continuation_invalid");
    if (record.tool !== expectedTool) fail("continuation_wrong_tool");
  }
}

const ioFail = (error) => {
  if (error instanceof ContinuationError) throw error;
  storeFail("continuation_file_io");
};

/**
 * Atomic owner-only write. Refuses a symlinked target, a group/other writable
 * parent, an oversized record, and a record that holds discovery beside the
 * token. Temp file is O_CREAT|O_EXCL 0600 in the same directory, fsynced, then
 * renamed; the directory is fsynced and the result re-checked.
 */
export async function saveContinuationFile(file, record) {
  if (!plain(record)) fail("continuation_file_invalid");
  if (Object.hasOwn(record, "discovery") && record.token !== undefined && record.token !== null) storeFail("continuation_file_record_mixed");
  checkRecord(record);
  const path = resolve(file);
  const body = `${JSON.stringify({ ...record, schema: FILE_SCHEMA })}\n`;
  if (Buffer.byteLength(body, "utf8") > FILE_MAX_BYTES) storeFail("continuation_file_oversized");
  const directory = dirname(path);
  try { await mkdir(directory, { recursive: true, mode: 0o700 }); } catch (error) { ioFail(error); }
  try { await checkParent(directory); } catch (error) { ioFail(error); }
  let existing = null;
  try { existing = await lstat(path); } catch (error) { if (error?.code !== "ENOENT") ioFail(error); }
  if (existing?.isSymbolicLink()) storeFail("continuation_file_symlink");
  if (existing && !existing.isFile()) storeFail("continuation_file_not_regular");
  // A hard-linked target is refused before rename replaces it: the other name
  // would keep the old bytes and the caller would hold two diverging records.
  if (existing && existing.nlink > 1) storeFail("continuation_file_hardlink");
  const temp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  let handle;
  try { handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600); } catch (error) { ioFail(error); }
  try {
    await handle.writeFile(body);
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => {});
    await unlink(temp).catch(() => {});
    ioFail(error);
  }
  try {
    await handle.close();
    await chmod(temp, 0o600);
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => {});
    ioFail(error);
  }
  try {
    const dirHandle = await open(directory, constants.O_RDONLY);
    try { await dirHandle.sync(); } catch { /* Some filesystems refuse directory fsync. */ } finally { await dirHandle.close(); }
  } catch { /* Directory fsync is best effort. */ }
  checkFileStats(await lstat(path));
  return path;
}

/**
 * Owner-only read. lstat first (symlink, regular file, size, mode, owner),
 * then open with O_NOFOLLOW and re-check the same inode with fstat. Then
 * validate the record: tool, step, expiresAt, hashAlg. Options: { tool }
 * refuses another tool's record with continuation_wrong_tool; nowMs (default
 * Date.now()) refuses an expired record with continuation_expired.
 */
export async function loadContinuationFile(file, { tool = null, nowMs = Date.now() } = {}) {
  const path = resolve(file);
  let stats;
  try { stats = await lstat(path); } catch (error) {
    if (error?.code === "ENOENT") storeFail("continuation_file_missing");
    storeFail("continuation_file_io");
  }
  checkFileStats(stats);
  let handle;
  let bytes;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const opened = await handle.stat();
    if (opened.ino !== stats.ino || opened.dev !== stats.dev) storeFail("continuation_file_symlink");
    checkFileStats(opened);
    bytes = Buffer.alloc(opened.size);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    bytes = bytes.subarray(0, bytesRead);
  } catch (error) {
    if (error instanceof ContinuationError) throw error;
    if (error?.code === "ELOOP") storeFail("continuation_file_symlink");
    storeFail("continuation_file_io");
  } finally {
    await handle?.close().catch(() => {});
  }
  let record;
  try { record = JSON.parse(bytes.toString("utf8")); } catch { fail("continuation_file_invalid"); }
  if (!plain(record) || record.schema !== FILE_SCHEMA) fail("continuation_file_invalid");
  checkRecord(record, { tool, nowMs });
  return record;
}
