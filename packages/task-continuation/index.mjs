// task-continuation v1 (module 1.3.0): portable caller-held continuation for one task chain.
// Dependency-free ESM. The issuer stores nothing. A continuation is an
// HMAC-signed bearer token the caller keeps, plus a separate non-authorizing
// correlationId. See CONTRACT.md for the stable v1 contract.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const CONTRACT_VERSION = 1;
export const MODULE_VERSION = "1.3.0";
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
  // 1.3.0 consumer contract.
  continuation_revoked: "continuation key or chain has been revoked",
  continuation_task_changed: "the task changed; start a new chain",
  continuation_measurement_invalid: "measurement record is not a supported shape",
  continuation_measurement_late: "measurement record occurred at or after the continuation expired",
  continuation_handback_invalid: "handback is not a supported shape",
  continuation_dispatch_pending: "a dispatch for this step may already have taken effect; read back, do not dispatch again",
  continuation_result_unknown: "the result of the pending dispatch is unknown",
  continuation_state_invalid: "this state change is not allowed",
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
  continuation_revoked: row("auth", false),
  continuation_task_changed: row("conflict", false),
  continuation_measurement_invalid: row("integrity", false),
  continuation_measurement_late: row("expired", false),
  continuation_handback_invalid: row("integrity", false),
  continuation_dispatch_pending: row("conflict", false),
  continuation_result_unknown: row("conflict", true),
  continuation_state_invalid: row("usage", false),
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
export function verifyContinuation(token, { keyring, tool, subject, bindings, correlationId, revoked = null, nowMs = Date.now() }) {
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
  // 1.3.0, check 12: issuer-side revocation of a key or of one chain. Runs
  // last so a revoked token never reveals more than an authentic one would.
  if (revoked !== null && revoked !== undefined) {
    if (!plain(revoked)) fail("continuation_invalid");
    const kids = revoked.kids ?? [];
    const chains = revoked.correlationIds ?? [];
    if (!Array.isArray(kids) || !Array.isArray(chains)) fail("continuation_invalid");
    if (kids.includes(payload.kid) || chains.includes(correlationId)) fail("continuation_revoked");
  }
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
    nextMethod: typeof nextMethod === "string" ? nextMethod : (NEXT_DEFAULTS[known]?.nextMethod ?? null),
    nextStep: typeof nextStep === "string" ? nextStep : (NEXT_DEFAULTS[known]?.nextStep ?? null),
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
 * and outcome, plus the optional 1.3.0 fields occurredAt, discoveryBasis and
 * entrySurface. Never a token, kid, or any token-derived field.
 *
 * Without the 1.3.0 options the result is the 1.2.0 shape, unchanged. The
 * optional fields appear only when supplied: occurredAt from occurredAt or
 * nowMs, discoveryBasis (null allowed) and entrySurface (null allowed). When
 * discoveryBasis is supplied it must agree with discovery (observed needs a
 * server-side basis), and expiresAt, when supplied, refuses a late record.
 */
export function measurementRecord({ correlationId, discovery: value, step, tool, outcome = null, occurredAt, nowMs, discoveryBasis, entrySurface, expiresAt }) {
  if (!isCorrelationId(correlationId) || !Number.isSafeInteger(step) || step < 0) fail("continuation_invalid");
  if (typeof tool !== "string" || !TOOL_RE.test(tool)) fail("continuation_invalid");
  const status = DISCOVERY_STATUSES.includes(value?.status) ? value.status : "unknown";
  const source = status === "unknown" || typeof value?.source !== "string" ? null : value.source;
  if (outcome !== null && (typeof outcome !== "string" || !MEASUREMENT_OUTCOME_RE.test(outcome))) fail("continuation_invalid");
  const record = { v: CONTRACT_VERSION, kind: "measurement", tool, correlationId, step, discovery: { status, source }, outcome };
  if (occurredAt !== undefined || nowMs !== undefined) {
    if (occurredAt !== undefined) record.occurredAt = occurredAt;
    else if (Number.isFinite(nowMs)) record.occurredAt = new Date(nowMs).toISOString();
    else fail("continuation_invalid");
  }
  if (discoveryBasis !== undefined) record.discoveryBasis = discoveryBasis;
  if (entrySurface !== undefined) record.entrySurface = entrySurface;
  return checkMeasurementRecord(record, { expiresAt, nowMs: occurredAt === undefined ? undefined : nowMs });
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
  return writeOwnerFile(file, `${JSON.stringify({ ...record, schema: FILE_SCHEMA })}\n`);
}

// Shared owner-only atomic write kernel (caller file and, from 1.3.0, handback file).
async function writeOwnerFile(file, body) {
  const path = resolve(file);
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
  const bytes = await readOwnerFile(file);
  let record;
  try { record = JSON.parse(bytes.toString("utf8")); } catch { fail("continuation_file_invalid"); }
  if (!plain(record) || record.schema !== FILE_SCHEMA) fail("continuation_file_invalid");
  checkRecord(record, { tool, nowMs });
  return record;
}

// Shared owner-only read kernel: lstat, O_NOFOLLOW open, same-inode fstat.
async function readOwnerFile(file) {
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
  return bytes;
}

// ---------------------------------------------------------------------------
// 1.3.0: measurement fields, truthful discovery acquisition, task binding,
// portable non-secret handback and the dispatch state kernel. See CONTRACT.md
// "Consumer contract (1.3.0)". Nothing here stores, sends or pays anything.
// ---------------------------------------------------------------------------

/** Why discovery has its status. The SameDayDesk page-change emitter re-exports these. */
export const DISCOVERY_BASIS_KINDS = Object.freeze(["request_referer", "mount_hook", "caller_meta"]);
/** Basis kinds that only the issuer can produce from its own request evidence. */
export const SERVER_EVIDENCE_KINDS = Object.freeze(["request_referer", "mount_hook"]);
export const ENTRY_SURFACES = Object.freeze(["hosted", "installed"]);
export const ENTRY_BASES = Object.freeze(["deployment_marker", "no_deployment_marker", "local_cli"]);
export const ENTRY_TRANSPORTS = Object.freeze(["mcp_streamable_http", "cli"]);
export const BASIS_MATCHED_MAX_CHARS = 128;
export const DISCOVERY_SOURCE_RE = /^[a-z][a-z0-9_-]{0,31}$/;
/** A record stamped more than this far ahead of the loader's clock is refused as malformed. */
export const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
export const HANDBACK_SCHEMA = "task-continuation.handback.v1";
export const HANDBACK_MAX_BYTES = 16 * 1024;
/**
 * Distinct per-step states. preview and quote come before any effect;
 * execution means a dispatch was saved as pending before it was sent;
 * result_unknown means the reply was lost; result, acceptance and settlement
 * follow a known result. The module records them and never moves money.
 */
export const HANDBACK_STATES = Object.freeze(["preview", "quote", "execution", "result_unknown", "result", "acceptance", "settlement"]);
const PENDING_STATES = new Set(["execution", "result_unknown"]);
const RESULT_STATES = new Set(["result", "acceptance", "settlement"]);
const ORIGIN_HASH_RE = /^sha256:[a-f0-9]{64}$/;
const STEP_EVENT_ID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MEASUREMENT_KEYS = new Set(["v", "kind", "tool", "correlationId", "step", "discovery", "outcome", "occurredAt", "discoveryBasis", "entrySurface"]);
const HANDBACK_KEYS = ["schema", "v", "hashAlg", "task", "correlationId", "step", "expiresAt", "state", "pending", "result"];
const TASK_KEYS = ["tool", "origin", "subject", "termsVersion"];

const NEXT_DEFAULTS = Object.freeze({
  continuation_revoked: { nextMethod: "start_new_chain", nextStep: "This continuation was revoked by the issuer. Start a new chain; do not retry it." },
  continuation_task_changed: { nextMethod: "start_new_chain", nextStep: "The tool, origin, terms or subject changed. Start a new chain for the new task; the old chain is not rebound." },
  continuation_measurement_invalid: { nextMethod: null, nextStep: "Drop the record; it does not match the measurement shape." },
  continuation_measurement_late: { nextMethod: null, nextStep: "Drop the record; it is stamped at or after the continuation expired." },
  continuation_handback_invalid: { nextMethod: "start_new_chain", nextStep: "The handback does not validate. Start a new chain." },
  continuation_dispatch_pending: { nextMethod: "readback", nextStep: "A dispatch for this step is pending. Read back its stepEventId; do not dispatch again." },
  continuation_result_unknown: { nextMethod: "readback", nextStep: "Read back the same stepEventId later. Do not dispatch again. To give up, reconcile this stepEventId out of band and start a new chain." },
  continuation_state_invalid: { nextMethod: null, nextStep: "Follow preview, quote, execution, result, acceptance, settlement in order." },
});

const measurementFail = () => fail("continuation_measurement_invalid");
const handbackFail = () => fail("continuation_handback_invalid");
const exactKeys = (value, keys) => {
  const names = Object.keys(value);
  return names.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
};
const isoMs = (text) => {
  if (typeof text !== "string" || !EXPIRES_AT_RE.test(text)) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) && new Date(ms).toISOString() === text ? ms : null;
};

/**
 * Truthful discovery acquisition. evidence is what the issuer saw on its own
 * request ({ source, basis: { kind: "request_referer" | "mount_hook", matched } }),
 * never anything the caller sent. declared is the caller's own claim (a bare
 * string). Returns { discovery, discoveryBasis }. observed is only produced
 * from server-side evidence; a caller value can at most be declared.
 */
export function acquireDiscovery({ evidence = null, declared = null, sources = [] } = {}) {
  const allowed = new Set(sources);
  if (plain(evidence) && typeof evidence.source === "string" && allowed.has(evidence.source) && plain(evidence.basis)) {
    const { kind, matched } = evidence.basis;
    if (kind === "request_referer" && typeof matched === "string" && matched.length >= 1 && matched.length <= BASIS_MATCHED_MAX_CHARS) {
      return { discovery: { status: "observed", source: evidence.source }, discoveryBasis: { kind, matched } };
    }
    if (kind === "mount_hook") return { discovery: { status: "observed", source: evidence.source }, discoveryBasis: { kind, matched: null } };
  }
  if (typeof declared === "string" && allowed.has(declared)) {
    return { discovery: { status: "declared", source: declared }, discoveryBasis: { kind: "caller_meta", matched: null } };
  }
  return { discovery: { status: "unknown", source: null }, discoveryBasis: null };
}

/**
 * Entry surface from runtime facts only, never from a request. markerEnv names
 * a platform-set deployment marker; only its presence is read, never its value.
 */
export function entrySurfaceFromRuntime({ env = process.env, markerEnv = null, transport = "mcp_streamable_http" } = {}) {
  if (transport === "cli") return { surface: "installed", basis: "local_cli", transport: "cli" };
  if (transport !== "mcp_streamable_http") fail("continuation_invalid");
  const marker = typeof markerEnv === "string" && markerEnv ? env?.[markerEnv] : undefined;
  const hosted = typeof marker === "string" && marker.trim().length > 0;
  return { surface: hosted ? "hosted" : "installed", basis: hosted ? "deployment_marker" : "no_deployment_marker", transport };
}

function checkDiscoveryBasis(discoveryValue, basis) {
  const { status } = discoveryValue;
  if (basis === null) {
    if (status !== "unknown") measurementFail();
    return;
  }
  if (!plain(basis) || !exactKeys(basis, ["kind", "matched"]) || !DISCOVERY_BASIS_KINDS.includes(basis.kind)) measurementFail();
  if (basis.kind === "request_referer") {
    if (typeof basis.matched !== "string" || basis.matched.length < 1 || basis.matched.length > BASIS_MATCHED_MAX_CHARS) measurementFail();
  } else if (basis.matched !== null) measurementFail();
  // Truthful acquisition: observed only with a server-side basis, declared only from caller meta.
  if (status === "observed" && !SERVER_EVIDENCE_KINDS.includes(basis.kind)) measurementFail();
  if (status === "declared" && basis.kind !== "caller_meta") measurementFail();
  if (status === "unknown") measurementFail();
}

function checkEntrySurface(value) {
  if (value === null) return;
  if (!plain(value) || !exactKeys(value, ["surface", "basis", "transport"])) measurementFail();
  const { surface, basis, transport } = value;
  if (!ENTRY_SURFACES.includes(surface) || !ENTRY_BASES.includes(basis) || !ENTRY_TRANSPORTS.includes(transport)) measurementFail();
  if ((surface === "hosted") !== (basis === "deployment_marker")) measurementFail();
  if ((basis === "local_cli") !== (transport === "cli")) measurementFail();
}

/**
 * Validate a measurement record on load (for example one read back from a
 * journal or another runtime). 1.2.0 records without the optional fields still
 * load. Malformed -> continuation_measurement_invalid. Late, meaning occurredAt
 * at or after expiresAt (when the loader passes expiresAt) ->
 * continuation_measurement_late. An occurredAt that is not a canonical ISO
 * time is malformed, not late: its moment cannot be placed. One stamped more
 * than MAX_FUTURE_SKEW_MS ahead of nowMs (when passed) is malformed too.
 * Returns a fresh copy.
 */
export function checkMeasurementRecord(record, { expiresAt, nowMs } = {}) {
  if (!plain(record)) measurementFail();
  for (const key of Object.keys(record)) if (!MEASUREMENT_KEYS.has(key)) measurementFail();
  if (record.v !== CONTRACT_VERSION || record.kind !== "measurement") measurementFail();
  if (typeof record.tool !== "string" || !TOOL_RE.test(record.tool)) measurementFail();
  if (!isCorrelationId(record.correlationId) || !Number.isSafeInteger(record.step) || record.step < 0) measurementFail();
  const value = record.discovery;
  if (!plain(value) || !exactKeys(value, ["status", "source"]) || !DISCOVERY_STATUSES.includes(value.status)) measurementFail();
  if (value.status === "unknown" ? value.source !== null : (typeof value.source !== "string" || !DISCOVERY_SOURCE_RE.test(value.source))) measurementFail();
  if (record.outcome !== null && (typeof record.outcome !== "string" || !MEASUREMENT_OUTCOME_RE.test(record.outcome))) measurementFail();
  const out = { v: record.v, kind: record.kind, tool: record.tool, correlationId: record.correlationId, step: record.step, discovery: { status: value.status, source: value.source }, outcome: record.outcome };
  if (Object.hasOwn(record, "occurredAt")) {
    const occurredMs = isoMs(record.occurredAt);
    if (occurredMs === null) measurementFail();
    if (nowMs !== undefined && nowMs !== null) {
      if (!Number.isFinite(nowMs)) fail("continuation_invalid");
      if (occurredMs - nowMs > MAX_FUTURE_SKEW_MS) measurementFail();
    }
    if (expiresAt !== undefined && expiresAt !== null) {
      const expiresMs = isoMs(expiresAt);
      if (expiresMs === null) fail("continuation_invalid");
      if (occurredMs >= expiresMs) fail("continuation_measurement_late");
    }
    out.occurredAt = record.occurredAt;
  }
  if (Object.hasOwn(record, "discoveryBasis")) {
    checkDiscoveryBasis(value, record.discoveryBasis);
    out.discoveryBasis = record.discoveryBasis === null ? null : { kind: record.discoveryBasis.kind, matched: record.discoveryBasis.matched };
  }
  if (Object.hasOwn(record, "entrySurface")) {
    checkEntrySurface(record.entrySurface);
    out.entrySurface = record.entrySurface === null ? null : { ...record.entrySurface };
  }
  return out;
}

/** True only when a record's observed discovery rests on a server-side basis. 1.2.0-shaped observed records are unproven. */
export function observedIsProven(record) {
  return record?.discovery?.status === "observed" && SERVER_EVIDENCE_KINDS.includes(record?.discoveryBasis?.kind);
}

/** Canonical http(s) origin (scheme, host, non-default port). Paths, queries and credentials are dropped or refused. */
export function normalizeOrigin(value) {
  let url;
  try { url = new URL(value); } catch { fail("continuation_invalid"); }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) fail("continuation_invalid");
  return url.origin;
}

/**
 * The binding of one eligible task: tool, origin, subject and terms. origin is
 * kept only as a hash. Pass bindings(task) to issueContinuation and
 * verifyContinuation so the token is bound to the same origin and terms.
 */
export function taskBinding({ tool, origin, subject, termsVersion = null }) {
  if (typeof tool !== "string" || !TOOL_RE.test(tool)) fail("continuation_invalid");
  if (typeof subject !== "string" || !HASH_RE.test(subject)) fail("continuation_invalid");
  if (termsVersion !== null && (typeof termsVersion !== "string" || !TERMS_VERSION_RE.test(termsVersion))) fail("continuation_invalid");
  const originHash = `sha256:${createHash("sha256").update(`task-continuation/origin|${normalizeOrigin(origin)}`).digest("hex")}`;
  return Object.freeze({ tool, origin: originHash, subject, termsVersion });
}

/** Token bindings for a task: origin always, termsVersion when the task has terms. */
export function taskBindings(task) {
  checkTask(task);
  return task.termsVersion ? { origin: task.origin, termsVersion: task.termsVersion } : { origin: task.origin };
}

function checkTask(task) {
  if (!plain(task) || !exactKeys(task, TASK_KEYS)) handbackFail();
  if (typeof task.tool !== "string" || !TOOL_RE.test(task.tool)) handbackFail();
  if (typeof task.origin !== "string" || !ORIGIN_HASH_RE.test(task.origin)) handbackFail();
  if (typeof task.subject !== "string" || !HASH_RE.test(task.subject)) handbackFail();
  if (task.termsVersion !== null && (typeof task.termsVersion !== "string" || !TERMS_VERSION_RE.test(task.termsVersion))) handbackFail();
}

/** Which of tool, origin, terms, subject differ. Empty means the same task. */
export function taskChanges(held, next) {
  checkTask(held);
  checkTask(next);
  const changed = [];
  if (held.tool !== next.tool) changed.push("tool");
  if (held.origin !== next.origin) changed.push("origin");
  if (held.termsVersion !== next.termsVersion) changed.push("terms");
  if (held.subject !== next.subject) changed.push("subject");
  return changed;
}

/** Throws continuation_task_changed (error.changed lists the fields) unless the task is the same. Never rebinds. */
export function assertSameTask(handback, task) {
  const changed = taskChanges(checkHandback(handback).task, task);
  if (changed.length) {
    const error = new ContinuationError("continuation_task_changed");
    error.changed = changed;
    throw error;
  }
}

/**
 * Validate a handback. Closed shape: every string field is a hash, an id, an
 * enum or a canonical time, so a token, key or raw input cannot ride inside.
 * Returns a fresh copy.
 */
export function checkHandback(value) {
  if (!plain(value) || !exactKeys(value, HANDBACK_KEYS)) handbackFail();
  if (value.schema !== HANDBACK_SCHEMA || value.v !== CONTRACT_VERSION) handbackFail();
  if (value.hashAlg !== HASH_ALG) fail("continuation_hash_legacy");
  checkTask(value.task);
  if (!isCorrelationId(value.correlationId) || !Number.isSafeInteger(value.step) || value.step < 0) handbackFail();
  if (isoMs(value.expiresAt) === null || !HANDBACK_STATES.includes(value.state)) handbackFail();
  const eventId = stepEventId(value.correlationId, value.step);
  let pending = null;
  if (PENDING_STATES.has(value.state)) {
    const p = value.pending;
    if (!plain(p) || !exactKeys(p, ["stepEventId", "step", "savedAt"]) || p.stepEventId !== eventId || p.step !== value.step || isoMs(p.savedAt) === null) handbackFail();
    pending = { stepEventId: p.stepEventId, step: p.step, savedAt: p.savedAt };
  } else if (value.pending !== null) handbackFail();
  let result = null;
  if (RESULT_STATES.has(value.state)) {
    const r = value.result;
    if (!plain(r) || !exactKeys(r, ["stepEventId", "step", "digest"]) || r.stepEventId !== eventId || r.step !== value.step || typeof r.digest !== "string" || !HASH_RE.test(r.digest)) handbackFail();
    result = { stepEventId: r.stepEventId, step: r.step, digest: r.digest };
  } else if (value.result !== null) handbackFail();
  return {
    schema: HANDBACK_SCHEMA, v: CONTRACT_VERSION, hashAlg: HASH_ALG,
    task: { tool: value.task.tool, origin: value.task.origin, subject: value.task.subject, termsVersion: value.task.termsVersion },
    correlationId: value.correlationId, step: value.step, expiresAt: value.expiresAt, state: value.state, pending, result,
  };
}

/**
 * Start a handback from an issue result (or a loaded caller record) and the
 * task it was issued for. The token is dropped: it stays caller-held and is
 * passed separately.
 */
export function createHandback({ task, issued, state = "preview" }) {
  if (!plain(issued)) fail("continuation_invalid");
  if (state !== "preview" && state !== "quote") fail("continuation_state_invalid");
  if (plain(task) && issued.tool !== task.tool) fail("continuation_wrong_tool");
  return checkHandback({
    schema: HANDBACK_SCHEMA, v: CONTRACT_VERSION, hashAlg: issued.hashAlg,
    task, correlationId: issued.correlationId, step: issued.step, expiresAt: issued.expiresAt, state, pending: null, result: null,
  });
}

/** Serialized handback (canonical JSON). The only export: it never holds a token, a key or raw input. */
export function exportHandback(handback) {
  return canonicalJson(checkHandback(handback));
}

/** Parse and validate a handback exported by any runtime. */
export function importHandback(text) {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > HANDBACK_MAX_BYTES) handbackFail();
  let value;
  try { value = JSON.parse(text); } catch { handbackFail(); }
  return checkHandback(value);
}

/**
 * Before continuing a held chain in a fresh process: same task, not expired,
 * nothing pending. Returns what the next call needs except the token:
 * { correlationId, step, bindings }.
 */
export function assertResumable(handback, task, { nowMs = Date.now() } = {}) {
  const held = checkHandback(handback);
  assertSameTask(held, task);
  if (isoMs(held.expiresAt) <= nowMs) fail("continuation_expired");
  if (PENDING_STATES.has(held.state)) fail("continuation_dispatch_pending");
  return { correlationId: held.correlationId, step: held.step, bindings: taskBindings(held.task) };
}

/** preview -> quote, result -> acceptance, acceptance -> settlement. Nothing else. */
export function advanceHandback(handback, to) {
  const held = checkHandback(handback);
  const allowed = { quote: "preview", acceptance: "result", settlement: "acceptance" };
  if (!Object.hasOwn(allowed, to) || held.state !== allowed[to]) fail("continuation_state_invalid");
  return checkHandback({ ...held, state: to });
}

/**
 * Mark the step pending BEFORE the effectful call. Save the returned handback
 * first (saveHandbackFile), then dispatch with its pending.stepEventId as the
 * idempotency key. A step already pending or with an unknown result is refused
 * with continuation_dispatch_pending: no second uncertain effect.
 */
export function beginDispatch(handback, { nowMs = Date.now() } = {}) {
  const held = checkHandback(handback);
  if (PENDING_STATES.has(held.state)) fail("continuation_dispatch_pending");
  if (held.state !== "preview" && held.state !== "quote") fail("continuation_state_invalid");
  if (isoMs(held.expiresAt) <= nowMs) fail("continuation_expired");
  const pending = { stepEventId: stepEventId(held.correlationId, held.step), step: held.step, savedAt: new Date(nowMs).toISOString() };
  return checkHandback({ ...held, state: "execution", pending });
}

/** The reply arrived: execution -> result with the result digest. */
export function recordResult(handback, { digest }) {
  const held = checkHandback(handback);
  if (held.state !== "execution") fail("continuation_state_invalid");
  return checkHandback({ ...held, state: "result", pending: null, result: { stepEventId: held.pending.stepEventId, step: held.step, digest } });
}

/** The reply was lost or ambiguous: execution -> result_unknown. The pending stepEventId is kept. */
export function markResultUnknown(handback) {
  const held = checkHandback(handback);
  if (held.state !== "execution" && held.state !== "result_unknown") fail("continuation_state_invalid");
  return checkHandback({ ...held, state: "result_unknown" });
}

/**
 * Apply read-only evidence about a pending dispatch. readback is
 * { found: true, stepEventId, digest } when the issuer holds a result for that
 * exact stepEventId, otherwise anything else. Returns { handback, refusal }:
 * the stored result (state result, refusal null), or state result_unknown with
 * a typed continuation_result_unknown refusal. A readback never re-opens
 * dispatch: the returned handback is never in a state beginDispatch accepts.
 */
export function applyReadback(handback, readback) {
  const held = checkHandback(handback);
  if (!PENDING_STATES.has(held.state)) fail("continuation_state_invalid");
  if (plain(readback) && readback.found === true && readback.stepEventId === held.pending.stepEventId
    && typeof readback.digest === "string" && HASH_RE.test(readback.digest)) {
    return { handback: checkHandback({ ...held, state: "result", pending: null, result: { stepEventId: held.pending.stepEventId, step: held.step, digest: readback.digest } }), refusal: null };
  }
  return {
    handback: checkHandback({ ...held, state: "result_unknown" }),
    refusal: refusal("continuation_result_unknown", { stepEventId: held.pending.stepEventId, correlationId: held.correlationId, step: held.step }),
  };
}

/**
 * Move a finished step to the next step of the same chain, from a new issue
 * result for the same correlationId at step + 1.
 */
export function nextHandbackStep(handback, issued) {
  const held = checkHandback(handback);
  if (!RESULT_STATES.has(held.state)) fail("continuation_state_invalid");
  if (!plain(issued) || issued.tool !== held.task.tool) fail("continuation_wrong_tool");
  if (issued.correlationId !== held.correlationId) fail("continuation_correlation_mismatch");
  if (issued.step !== held.step + 1) fail("continuation_state_invalid");
  return checkHandback({ ...held, step: issued.step, expiresAt: issued.expiresAt, hashAlg: issued.hashAlg, state: "preview", pending: null, result: null });
}

/** Save a handback with the same owner-only atomic write as the caller file. */
export async function saveHandbackFile(file, handback) {
  return writeOwnerFile(file, `${exportHandback(handback)}\n`);
}

/** Load a handback with the same owner-only read checks as the caller file. */
export async function loadHandbackFile(file) {
  const bytes = await readOwnerFile(file);
  return importHandback(bytes.toString("utf8"));
}
