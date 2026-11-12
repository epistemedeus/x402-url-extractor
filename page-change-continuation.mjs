// Caller-held continuation for the free compare_page_observations tool.
// The server stores nothing new. A continuation is an HMAC-signed bearer token
// the caller keeps, plus a separate correlationId that never authorizes a
// restore. The token binds the tool, the source subject, the selected fields,
// and a digest of the held observation. It carries no page text, URL, or field
// value. Old callers that send no continuation see no change.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const PAGE_CHANGE_CONTINUATION_META = "samedaydesk/continuation";
export const PAGE_CHANGE_CONTINUATION_TOOL = "compare_page_observations";
export const PAGE_CHANGE_CONTINUATION_VERSION = 1;
export const PAGE_CHANGE_CONTINUATION_TOKEN_MAX_CHARS = 1024;
export const PAGE_CHANGE_CONTINUATION_TOKEN_RE = /^pc1\.[A-Za-z0-9_-]{16,900}\.[A-Za-z0-9_-]{43}$/;
// Shared with cross-owner consumers (Agent Money uses it as taskRef). Random,
// carries no authority, and is neither stored in nor derivable from the token.
export const PAGE_CHANGE_CORRELATION_RE = /^ae:corr:v1:[A-Za-z0-9_-]{22}$/;
export const PAGE_CHANGE_DISCOVERY_STATUSES = Object.freeze(["observed", "declared", "unknown"]);
export const PAGE_CHANGE_DISCOVERY_SOURCES = Object.freeze(["a2a", "mcp", "cli", "llms", "skill", "registry", "other"]);
export const PAGE_CHANGE_CONTINUATION_TEST_KID = "test";

// Publicly known. Used only when PAGE_CHANGE_CONTINUATION_TEST_KEY=1 and no
// keyring is configured. Never a production secret.
const TEST_SECRET = "samedaydesk-page-change-continuation-test-only-key";
const KID_RE = /^[a-z0-9-]{1,16}$/;
const MIN_SECRET_CHARS = 32;
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;
const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 30 * 24 * 60 * 60;
const HEX_64 = /^[a-f0-9]{64}$/;
const META_KEYS = new Set(["save", "token", "correlationId", "discovery"]);
const SUBJECT_SCHEMA = "samedaydesk/page-change-subject/v1";
const SCAN_NODE_LIMIT = 50_000;

const NEXT_START = "Start a new chain: tools/call compare_page_observations with before, after, fields and _meta samedaydesk/continuation {save:true}.";
const NEXT_CONTINUE = "Send the held after observation of the saved step as before, the same fields, and a new after for the same sources.";
const NEXT_PLAIN = "Call tools/call compare_page_observations without _meta samedaydesk/continuation.";
const NEXT_CLEAN = "Remove credentials, cookies, keys and payment signatures from the arguments, then call again.";

// Fixed server text only. No refusal repeats a token, URL, field or value.
const REFUSALS = Object.freeze({
  continuation_unavailable: ["continuation is not configured on this server", NEXT_PLAIN],
  continuation_invalid: ["continuation request is not a supported shape", NEXT_START],
  continuation_token_oversized: ["continuation token exceeds the size limit", NEXT_START],
  continuation_token_invalid: ["continuation token failed verification", NEXT_START],
  continuation_unknown_key: ["continuation token key is not in the current keyring", NEXT_START],
  continuation_expired: ["continuation token has expired", NEXT_START],
  continuation_wrong_tool: ["continuation token belongs to another tool", NEXT_START],
  continuation_correlation_mismatch: ["correlationId does not match this continuation token", "Send the correlationId returned with this token in _meta samedaydesk/continuation."],
  continuation_subject_mismatch: ["after observation is not for the same sources", NEXT_CONTINUE],
  continuation_fields_mismatch: ["fields differ from the saved step", NEXT_CONTINUE],
  continuation_observation_mismatch: ["before observation is not the held observation of the saved step", NEXT_CONTINUE],
  continuation_second_observation_incomplete: ["a complete second observation with source identities is required", NEXT_CONTINUE],
  continuation_credential_input: ["arguments look like they contain a credential", NEXT_CLEAN],
});

export const PAGE_CHANGE_CONTINUATION_REFUSAL_CODES = Object.freeze(Object.keys(REFUSALS));

export class PageChangeContinuationError extends Error {
  constructor(code) {
    super(REFUSALS[code]?.[0] || "continuation refused");
    this.code = Object.hasOwn(REFUSALS, code) ? code : "continuation_invalid";
  }
}

const refuse = (code) => { throw new PageChangeContinuationError(code); };
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const plain = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const b64url = (buffer) => Buffer.from(buffer).toString("base64url");

export function pageChangeContinuationRefusalBody(code, { product, schemaVersion }) {
  const known = Object.hasOwn(REFUSALS, code) ? code : "continuation_invalid";
  const [message, nextStep] = REFUSALS[known];
  return {
    ok: false,
    product,
    schemaVersion,
    charged: false,
    paymentRequired: false,
    error: known,
    code: known,
    message,
    nextMethod: "tools/call",
    nextTool: PAGE_CHANGE_CONTINUATION_TOOL,
    nextStep,
  };
}

/**
 * Keyring from PAGE_CHANGE_CONTINUATION_KEYS="kid:secret,kid:secret". The first
 * entry signs. Every entry verifies, so a rotated key keeps saved tokens alive
 * until the old kid is removed. Returns null when continuation is off.
 */
export function pageChangeContinuationKeyring(env = process.env) {
  const raw = typeof env?.PAGE_CHANGE_CONTINUATION_KEYS === "string" ? env.PAGE_CHANGE_CONTINUATION_KEYS.trim() : "";
  const keys = [];
  if (raw) {
    for (const entry of raw.split(",")) {
      const split = entry.indexOf(":");
      const kid = entry.slice(0, split).trim();
      const secret = entry.slice(split + 1).trim();
      if (split <= 0 || !KID_RE.test(kid) || secret.length < MIN_SECRET_CHARS) return null;
      if (keys.some((key) => key.kid === kid)) return null;
      keys.push({ kid, secret });
    }
  } else if (env?.PAGE_CHANGE_CONTINUATION_TEST_KEY === "1") {
    keys.push({ kid: PAGE_CHANGE_CONTINUATION_TEST_KID, secret: TEST_SECRET });
  }
  if (!keys.length) return null;
  return { current: keys[0], byKid: new Map(keys.map((key) => [key.kid, key])) };
}

export function pageChangeContinuationTtlSeconds(env = process.env) {
  const value = Number(env?.PAGE_CHANGE_CONTINUATION_TTL_SECONDS);
  if (!Number.isSafeInteger(value)) return DEFAULT_TTL_SECONDS;
  return Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, value));
}

function unwrap(artifact) {
  if (plain(artifact) && plain(artifact.body) && !Array.isArray(artifact.sources) && !Array.isArray(artifact.items)) return artifact.body;
  return artifact;
}

function normalizeSource(value) {
  const text = value.trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    url.hash = "";
    return url.href;
  } catch {
    return text.replace(/#.*$/, "") || null;
  }
}

/**
 * Digest of the sorted, fragment-free source identities in one observation.
 * Null when the observation has no usable source identity (incomplete).
 */
export function pageChangeSubjectDigest(artifact) {
  const body = unwrap(artifact);
  if (!plain(body) || body.missing === true) return null;
  const rows = Array.isArray(body.sources) ? body.sources : Array.isArray(body.items) ? body.items : null;
  if (!rows || rows.length === 0) return null;
  const keys = new Set();
  for (const row of rows) {
    if (plain(row) && typeof row.source === "string") {
      const key = normalizeSource(row.source);
      if (key) keys.add(key);
    }
  }
  if (!keys.size) return null;
  return sha256(JSON.stringify([SUBJECT_SCHEMA, ...[...keys].sort()]));
}

export function pageChangeObservationDigest(artifact) {
  return sha256(JSON.stringify(artifact));
}

export function pageChangeFieldsDigest(fields) {
  if (!Array.isArray(fields) || fields.some((field) => typeof field !== "string")) return null;
  return sha256(JSON.stringify(["fields", ...[...new Set(fields)].sort()]));
}

const CREDENTIAL_KEY = /^(authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|client[-_]?secret|api[-_]?key|access[-_]?token|refresh[-_]?token|bearer|private[-_]?key|seed[-_]?phrase|mnemonic|payment[-_]?signature|x[-_]payment)$/i;
const CREDENTIAL_VALUE = [
  /^(bearer|basic)\s+[A-Za-z0-9._~+/=-]{12,}$/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /^(sk|rk)_(live|test)_[A-Za-z0-9]{10,}$/,
  /^gh[pousr]_[A-Za-z0-9]{20,}$/,
  /^xox[abprs]-[A-Za-z0-9-]{10,}$/,
  /^eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/,
];

/** True when a key or string value looks like a credential. Bounded walk. */
export function containsCredentialLikeInput(value) {
  const stack = [value];
  let nodes = 0;
  while (stack.length) {
    const item = stack.pop();
    nodes += 1;
    if (nodes > SCAN_NODE_LIMIT) return false;
    if (typeof item === "string") {
      if (item.length <= 8192 && CREDENTIAL_VALUE.some((pattern) => pattern.test(item))) return true;
    } else if (Array.isArray(item)) {
      for (const child of item) stack.push(child);
    } else if (plain(item)) {
      for (const [key, child] of Object.entries(item)) {
        if (CREDENTIAL_KEY.test(key)) return true;
        stack.push(child);
      }
    }
  }
  return false;
}

/** Validate the caller's _meta request. Returns null when absent. */
export function readPageChangeContinuationRequest(meta) {
  if (!plain(meta) || !Object.hasOwn(meta, PAGE_CHANGE_CONTINUATION_META)) return null;
  const request = meta[PAGE_CHANGE_CONTINUATION_META];
  if (!plain(request)) return { invalid: true };
  for (const key of Object.keys(request)) if (!META_KEYS.has(key)) return { invalid: true };
  if (request.save !== undefined && typeof request.save !== "boolean") return { invalid: true };
  if (request.token !== undefined && typeof request.token !== "string") return { invalid: true };
  if (request.token === undefined && request.save !== true) return { invalid: true };
  if (request.correlationId !== undefined && typeof request.correlationId !== "string") return { invalid: true };
  const declared = typeof request.discovery === "string" && PAGE_CHANGE_DISCOVERY_SOURCES.includes(request.discovery)
    ? request.discovery
    : null;
  return { invalid: false, token: request.token ?? null, correlationId: request.correlationId ?? null, save: request.save !== false, declared };
}

/**
 * Discovery is separate from the token. Observed comes only from server-side
 * request evidence. Declared comes from the caller. Otherwise unknown.
 */
export function pageChangeDiscovery({ observed = null, declared = null } = {}) {
  if (typeof observed === "string" && PAGE_CHANGE_DISCOVERY_SOURCES.includes(observed)) return { status: "observed", source: observed };
  if (typeof declared === "string" && PAGE_CHANGE_DISCOVERY_SOURCES.includes(declared)) return { status: "declared", source: declared };
  return { status: "unknown", source: null };
}

function sign(secret, body) {
  return createHmac("sha256", secret).update(body).digest();
}

export function newPageChangeCorrelationId() {
  return `ae:corr:v1:${randomBytes(16).toString("base64url")}`;
}

// Keyed commitment: the server can check a presented correlationId, but the
// token alone does not reveal it and the correlationId alone cannot mint one.
function correlationCommitment(secret, correlationId) {
  return createHmac("sha256", secret).update(`samedaydesk/page-change-correlation|${correlationId}`).digest("hex");
}

export function signPageChangeContinuationPayload(payload, key) {
  const body = `pc1.${b64url(JSON.stringify(payload))}`;
  return `${body}.${b64url(sign(key.secret, body))}`;
}

/** Mint the next continuation for the observation the caller now holds. */
export function issuePageChangeContinuation({ after, fields, previous = null, env = process.env, nowMs = Date.now(), discovery }) {
  const keyring = pageChangeContinuationKeyring(env);
  if (!keyring) refuse("continuation_unavailable");
  const sub = pageChangeSubjectDigest(after);
  if (!sub) refuse("continuation_second_observation_incomplete");
  const fld = pageChangeFieldsDigest(fields);
  if (!fld) refuse("continuation_invalid");
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + pageChangeContinuationTtlSeconds(env);
  const cor = previous?.correlationId || newPageChangeCorrelationId();
  const step = previous ? previous.step + 1 : 0;
  const payload = {
    v: PAGE_CHANGE_CONTINUATION_VERSION,
    kid: keyring.current.kid,
    tool: PAGE_CHANGE_CONTINUATION_TOOL,
    sub,
    obs: pageChangeObservationDigest(after),
    fld,
    crh: correlationCommitment(keyring.current.secret, cor),
    step,
    iat,
    exp,
  };
  const token = signPageChangeContinuationPayload(payload, keyring.current);
  if (token.length > PAGE_CHANGE_CONTINUATION_TOKEN_MAX_CHARS) refuse("continuation_token_oversized");
  return {
    v: PAGE_CHANGE_CONTINUATION_VERSION,
    tool: PAGE_CHANGE_CONTINUATION_TOOL,
    token,
    kid: payload.kid,
    correlationId: cor,
    step,
    expiresAt: new Date(exp * 1000).toISOString(),
    discovery: discovery || pageChangeDiscovery(),
    next: {
      method: "tools/call",
      tool: PAGE_CHANGE_CONTINUATION_TOOL,
      meta: PAGE_CHANGE_CONTINUATION_META,
      send: "before is the after observation you sent in this call, after is your new observation, fields stay the same, _meta carries {token}.",
    },
  };
}

/** Verify a presented token. Returns the bound payload or throws a refusal. */
export function verifyPageChangeContinuationToken(token, { env = process.env, nowMs = Date.now(), correlationId = null } = {}) {
  const keyring = pageChangeContinuationKeyring(env);
  if (!keyring) refuse("continuation_unavailable");
  if (typeof token !== "string") refuse("continuation_token_invalid");
  if (token.length > PAGE_CHANGE_CONTINUATION_TOKEN_MAX_CHARS) refuse("continuation_token_oversized");
  if (!PAGE_CHANGE_CONTINUATION_TOKEN_RE.test(token)) refuse("continuation_token_invalid");
  const [prefix, encoded, signature] = token.split(".");
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    refuse("continuation_token_invalid");
  }
  if (!plain(payload) || payload.v !== PAGE_CHANGE_CONTINUATION_VERSION || typeof payload.kid !== "string") refuse("continuation_token_invalid");
  const key = keyring.byKid.get(payload.kid);
  if (!key) refuse("continuation_unknown_key");
  const expected = sign(key.secret, `${prefix}.${encoded}`);
  const presented = Buffer.from(signature, "base64url");
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) refuse("continuation_token_invalid");
  if (!HEX_64.test(payload.sub) || !HEX_64.test(payload.obs) || !HEX_64.test(payload.fld)
    || !HEX_64.test(payload.crh) || !Number.isSafeInteger(payload.step) || payload.step < 0
    || !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp)) refuse("continuation_token_invalid");
  if (payload.exp * 1000 <= nowMs) refuse("continuation_expired");
  if (payload.tool !== PAGE_CHANGE_CONTINUATION_TOOL) refuse("continuation_wrong_tool");
  if (typeof correlationId !== "string" || !PAGE_CHANGE_CORRELATION_RE.test(correlationId)) refuse("continuation_correlation_mismatch");
  const commitment = Buffer.from(correlationCommitment(key.secret, correlationId), "hex");
  if (!timingSafeEqual(commitment, Buffer.from(payload.crh, "hex"))) refuse("continuation_correlation_mismatch");
  return { ...payload, correlationId };
}

/** Bind a verified payload to this call's arguments before any compare runs. */
export function bindPageChangeContinuation(payload, args) {
  const after = args?.after;
  if (!plain(after) || after.missing === true) refuse("continuation_second_observation_incomplete");
  const sub = pageChangeSubjectDigest(after);
  if (!sub) refuse("continuation_second_observation_incomplete");
  if (sub !== payload.sub) refuse("continuation_subject_mismatch");
  if (pageChangeFieldsDigest(args?.fields) !== payload.fld) refuse("continuation_fields_mismatch");
  if (args?.before === undefined || pageChangeObservationDigest(args.before) !== payload.obs) refuse("continuation_observation_mismatch");
  return payload;
}

/**
 * Deterministic journal id for one continued step, formatted as a v4-shaped
 * UUID so the existing canonical row check accepts it. Derived from the
 * non-authorizing correlationId and step only, never from the token.
 */
export function pageChangeContinuationEventId(correlationId, step) {
  const hex = sha256(`samedaydesk/page-change-continuation-event|${correlationId}|${step}`);
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
