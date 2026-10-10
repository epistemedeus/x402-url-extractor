// Optional caller statement for one retained paid result.
// The token is a response-scoped reporting capability. It is not a payer identity,
// not a settlement, and not measured usefulness. Bearers stay off journals and URLs.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";

import { admitCommerceJournal } from "./commerce-journal-admission.mjs";
import { USEFULNESS_UNKNOWN } from "./http-delivery-evidence/classify.mjs";
import { isSupportedTarget } from "./http-delivery-evidence/contract.mjs";
import { digestMcpDeliveryBinding } from "./http-delivery-evidence/digest.mjs";
import {
  PAID_EVIDENCE_FILENAME,
  PAID_EVIDENCE_ID_PATTERN,
  isHistoricalV1PaidSuccess,
  parseNdjson,
} from "./http-delivery-evidence/historical.mjs";
import { MCP_MORPHO_RESOURCE, MCP_MORPHO_TOOL } from "./http-delivery-evidence/mcp-delivery.mjs";
import { isSealedDeliveryObservation } from "./http-delivery-evidence/observation.mjs";
import {
  VALIDATION_FILENAME,
  canonicalizeValidationRecord,
  openStore,
} from "./http-delivery-evidence/store.mjs";

export const CALLER_RESULT_FEEDBACK_PATH = "/commerce/caller-result-feedback";
export const CALLER_RESULT_FEEDBACK_HEADER = "x-samedaydesk-caller-result-feedback";
export const CALLER_RESULT_FEEDBACK_LINK = `</commerce/caller-result-feedback>; rel="caller-result-feedback"`;
export const CALLER_RESULT_FEEDBACK_SCHEMA = "samedaydesk.caller-result-feedback.v1";
export const CALLER_RESULT_FEEDBACK_MCP_SCHEMA = "samedaydesk.caller-result-feedback.mcp.v1";
export const MCP_CALLER_RESULT_TOOL = "report_caller_result";
export const MCP_CALLER_RESULT_META_KEY = "samedaydesk/mcp-caller-result";
export const MCP_CALLER_RESULT_METHOD = "tools/call";
export const CALLER_RESULT_FEEDBACK_FILENAME = "caller-result-feedback.ndjson";
export const CALLER_RESULT_FEEDBACK_ROTATED_FILENAME = "caller-result-feedback.1.ndjson";
export const CALLER_RESULT_FEEDBACK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const CALLER_RESULT_FEEDBACK_DURABILITY = "local-filesystem-fsync-v1";
export const CALLER_RESULT_DISPOSITIONS = Object.freeze(["useful", "not_useful"]);
export const CALLER_RESULT_REASON_CATEGORIES = Object.freeze([
  "matched_task",
  "saved_a_step",
  "wrong_output",
  "missing_field",
  "not_actionable",
]);

const DISPOSITIONS = new Set(CALLER_RESULT_DISPOSITIONS);
const REASONS = new Set(CALLER_RESULT_REASON_CATEGORIES);
const HEX64 = /^[0-9a-f]{64}$/;
const TX = /^0x[0-9a-fA-F]{64}$/;
const METHODS = new Set(["GET", "POST"]);
const TOKEN_RE = /^[A-Za-z0-9_-]{20,1500}\.[A-Za-z0-9_-]{43}$/;
const STATEMENT_ID_RE = /^crf_[0-9a-f]{32}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_BODY_BYTES = 512;
const MAX_FILE_BYTES = 256 * 1024;
const STATEMENT_KEYS = Object.freeze([
  "capabilityHash",
  "channel",
  "disposition",
  "method",
  "paidEvidenceId",
  "reasonCategory",
  "receivedAt",
  "requestDigest",
  "responseDigest",
  "route",
  "schemaVersion",
  "settlementReference",
  "source",
  "statementId",
  "usefulness",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function keyReady(key) {
  return typeof key === "string" && Buffer.byteLength(key, "utf8") >= 32;
}

function sameBytes(left, right) {
  if (!Buffer.isBuffer(left) || !Buffer.isBuffer(right) || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function plain(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function headerValue(headers, name) {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
  return typeof value === "string" ? value : "";
}

function refusal(code, statusCode) {
  return {
    statusCode,
    body: {
      ok: false,
      accepted: false,
      bound: false,
      charged: false,
      payerIdentity: false,
      usefulness: USEFULNESS_UNKNOWN,
      code,
      coverage: "this_retained_result_only",
    },
  };
}

function acceptance({ disposition, reasonCategory, idempotentReplay }) {
  return {
    statusCode: 200,
    body: {
      ok: true,
      accepted: true,
      bound: true,
      idempotentReplay: idempotentReplay === true,
      charged: false,
      payerIdentity: false,
      usefulness: USEFULNESS_UNKNOWN,
      disposition,
      reasonCategory,
      coverage: "this_retained_result_only",
    },
  };
}

export function issueCallerResultFeedbackToken({
  key,
  eventId,
  method,
  route,
  requestDigest,
  responseDigest,
  now = Date.now(),
  ttlMs = CALLER_RESULT_FEEDBACK_TTL_MS,
} = {}) {
  try {
    if (!keyReady(key)) return null;
    if (!PAID_EVIDENCE_ID_PATTERN.test(String(eventId || ""))) return null;
    if (!METHODS.has(method) || !isSupportedTarget(method, route)) return null;
    if (!HEX64.test(String(requestDigest || "")) || !HEX64.test(String(responseDigest || ""))) return null;
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > CALLER_RESULT_FEEDBACK_TTL_MS) return null;
    const issuedAt = Number(now);
    if (!Number.isSafeInteger(issuedAt)) return null;
    const exp = issuedAt + ttlMs;
    const payload = Buffer.from(JSON.stringify({
      v: 1,
      c: "http",
      e: eventId,
      m: method,
      r: route,
      q: requestDigest,
      b: responseDigest,
      x: exp,
    }));
    const mac = createHmac("sha256", key).update(payload).digest();
    return `${payload.toString("base64url")}.${mac.toString("base64url")}`;
  } catch {
    return null;
  }
}

export function readCallerResultFeedbackToken(token, key, now = Date.now()) {
  if (!keyReady(key)) return { ok: false, code: "key_absent" };
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return { ok: false, code: "malformed_capability" };
  const dot = token.indexOf(".");
  let payload;
  let mac;
  try {
    payload = Buffer.from(token.slice(0, dot), "base64url");
    mac = Buffer.from(token.slice(dot + 1), "base64url");
  } catch {
    return { ok: false, code: "malformed_capability" };
  }
  if (payload.length === 0 || payload.length > 1024 || mac.length !== 32) {
    return { ok: false, code: "malformed_capability" };
  }
  const expected = createHmac("sha256", key).update(payload).digest();
  if (!sameBytes(mac, expected)) return { ok: false, code: "tampered_capability" };
  let claims;
  try {
    claims = JSON.parse(payload.toString("utf8"));
  } catch {
    return { ok: false, code: "tampered_capability" };
  }
  if (!plain(claims) || claims.v !== 1 || claims.c !== "http") return { ok: false, code: "tampered_capability" };
  if (!PAID_EVIDENCE_ID_PATTERN.test(claims.e || "")) return { ok: false, code: "tampered_capability" };
  if (!METHODS.has(claims.m) || typeof claims.r !== "string" || !isSupportedTarget(claims.m, claims.r)) {
    return { ok: false, code: "tampered_capability" };
  }
  if (!HEX64.test(claims.q || "") || !HEX64.test(claims.b || "")) return { ok: false, code: "tampered_capability" };
  if (!Number.isSafeInteger(claims.x)) return { ok: false, code: "tampered_capability" };
  const clock = Number(now);
  if (!Number.isSafeInteger(clock) || clock >= claims.x) return { ok: false, code: "expired_capability" };
  return {
    ok: true,
    claims: {
      eventId: claims.e,
      method: claims.m,
      route: claims.r,
      requestDigest: claims.q,
      responseDigest: claims.b,
      expiresAtMs: claims.x,
      channel: "http",
    },
  };
}

export function mcpCallerResultFeedbackPublicContract() {
  return {
    optional: true,
    charged: false,
    payerIdentity: false,
    usefulness: USEFULNESS_UNKNOWN,
    channel: "mcp",
    schema: CALLER_RESULT_FEEDBACK_MCP_SCHEMA,
    tool: MCP_CALLER_RESULT_TOOL,
    dispositions: [...CALLER_RESULT_DISPOSITIONS],
    reasonCategories: [...CALLER_RESULT_REASON_CATEGORIES],
  };
}

function mcpFeedbackClaims(observation) {
  if (!isSealedDeliveryObservation(observation)) return null;
  if (observation.source !== "mcp_tool_result" || observation.applicationIsError === true) return null;
  if (observation.tool !== MCP_MORPHO_TOOL || observation.resource !== MCP_MORPHO_RESOURCE) return null;
  if (typeof observation.settlementReference !== "string" || !TX.test(observation.settlementReference)) return null;
  if (!HEX64.test(observation.callDigest || "") || !HEX64.test(observation.issuedOfferDigest || "")) return null;
  if (!HEX64.test(observation.responseDigest || "")) return null;
  const requestDigest = digestMcpDeliveryBinding({
    tool: observation.tool,
    callDigest: observation.callDigest,
    issuedOfferDigest: observation.issuedOfferDigest,
  });
  if (!HEX64.test(requestDigest)) return null;
  return {
    tool: observation.tool,
    resource: observation.resource,
    requestDigest,
    responseDigest: observation.responseDigest,
    callDigest: observation.callDigest,
    issuedOfferDigest: observation.issuedOfferDigest,
    settlementReference: observation.settlementReference.toLowerCase(),
  };
}

export function issueMcpCallerResultFeedbackToken({
  key,
  observation,
  now = Date.now(),
  ttlMs = CALLER_RESULT_FEEDBACK_TTL_MS,
} = {}) {
  try {
    if (!keyReady(key)) return null;
    const bound = mcpFeedbackClaims(observation);
    if (!bound) return null;
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > CALLER_RESULT_FEEDBACK_TTL_MS) return null;
    const issuedAt = Number(now);
    if (!Number.isSafeInteger(issuedAt)) return null;
    const payload = Buffer.from(JSON.stringify({
      v: 1,
      c: "mcp",
      t: bound.tool,
      u: bound.resource,
      q: bound.requestDigest,
      b: bound.responseDigest,
      d: bound.callDigest,
      o: bound.issuedOfferDigest,
      s: bound.settlementReference,
      x: issuedAt + ttlMs,
    }));
    const mac = createHmac("sha256", key).update(payload).digest();
    return `${payload.toString("base64url")}.${mac.toString("base64url")}`;
  } catch {
    return null;
  }
}

export function readMcpCallerResultFeedbackToken(token, key, now = Date.now()) {
  if (!keyReady(key)) return { ok: false, code: "key_absent" };
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return { ok: false, code: "malformed_capability" };
  const dot = token.indexOf(".");
  let payload;
  let mac;
  try {
    payload = Buffer.from(token.slice(0, dot), "base64url");
    mac = Buffer.from(token.slice(dot + 1), "base64url");
  } catch {
    return { ok: false, code: "malformed_capability" };
  }
  if (payload.length === 0 || payload.length > 1024 || mac.length !== 32) {
    return { ok: false, code: "malformed_capability" };
  }
  const expected = createHmac("sha256", key).update(payload).digest();
  if (!sameBytes(mac, expected)) return { ok: false, code: "tampered_capability" };
  let claims;
  try {
    claims = JSON.parse(payload.toString("utf8"));
  } catch {
    return { ok: false, code: "tampered_capability" };
  }
  if (!plain(claims) || claims.v !== 1) return { ok: false, code: "tampered_capability" };
  if (claims.c !== "mcp") return { ok: false, code: "channel_rejected" };
  const claimKeys = Object.keys(claims).sort();
  const mcpClaimKeys = ["b", "c", "d", "o", "q", "s", "t", "u", "v", "x"];
  if (claimKeys.length !== mcpClaimKeys.length || claimKeys.some((item, index) => item !== mcpClaimKeys[index])) {
    return { ok: false, code: "tampered_capability" };
  }
  if (claims.t !== MCP_MORPHO_TOOL || claims.u !== MCP_MORPHO_RESOURCE) {
    return { ok: false, code: "foreign_tool" };
  }
  if (!HEX64.test(claims.q || "") || !HEX64.test(claims.b || "") || !HEX64.test(claims.d || "") || !HEX64.test(claims.o || "")) {
    return { ok: false, code: "tampered_capability" };
  }
  if (typeof claims.s !== "string" || !TX.test(claims.s)) return { ok: false, code: "tampered_capability" };
  if (!Number.isSafeInteger(claims.x)) return { ok: false, code: "tampered_capability" };
  const clock = Number(now);
  if (!Number.isSafeInteger(clock) || clock >= claims.x) return { ok: false, code: "expired_capability" };
  const serialized = JSON.stringify(claims);
  if (serialized.includes("http://") || serialized.includes("https://") || serialized.includes("?")) {
    return { ok: false, code: "tampered_capability" };
  }
  return {
    ok: true,
    claims: {
      tool: claims.t,
      resource: claims.u,
      requestDigest: claims.q,
      responseDigest: claims.b,
      callDigest: claims.d,
      issuedOfferDigest: claims.o,
      settlementReference: claims.s.toLowerCase(),
      expiresAtMs: claims.x,
      channel: "mcp",
    },
  };
}

export function attachMcpCallerResultFeedback(result, { key, observation, eligible } = {}) {
  try {
    if (eligible !== true || !result || typeof result !== "object" || Array.isArray(result)) return false;
    const token = issueMcpCallerResultFeedbackToken({ key, observation });
    if (!token) return false;
    const text = result.content?.[0]?.text;
    if (typeof text === "string" && text.includes(token)) return false;
    const meta = { ...mcpCallerResultFeedbackPublicContract(), token };
    const published = JSON.stringify(meta);
    if (published.includes("http://") || published.includes("https://") || published.includes(CALLER_RESULT_FEEDBACK_PATH)) {
      return false;
    }
    result._meta = {
      ...(result._meta && typeof result._meta === "object" && !Array.isArray(result._meta) ? result._meta : {}),
      [MCP_CALLER_RESULT_META_KEY]: meta,
    };
    return true;
  } catch {
    return false;
  }
}

export function attachCallerResultFeedbackHeader(res, input = {}) {
  try {
    if (!res || res.headersSent) return false;
    if (typeof res.setHeader !== "function" || typeof res.append !== "function") return false;
    const status = Number(input.statusCode);
    if (!(status >= 200 && status < 300)) return false;
    if (input.replayed === true) return false;
    const token = issueCallerResultFeedbackToken(input);
    if (!token) return false;
    res.append("Link", CALLER_RESULT_FEEDBACK_LINK);
    res.setHeader(CALLER_RESULT_FEEDBACK_HEADER, token);
    return true;
  } catch {
    return false;
  }
}

export function callerResultFeedbackPublicContract() {
  return {
    optional: true,
    charged: false,
    payerIdentity: false,
    usefulness: USEFULNESS_UNKNOWN,
    method: "POST",
    path: CALLER_RESULT_FEEDBACK_PATH,
    header: CALLER_RESULT_FEEDBACK_HEADER,
    dispositions: [...CALLER_RESULT_DISPOSITIONS],
    reasonCategories: [...CALLER_RESULT_REASON_CATEGORIES],
  };
}

export function callerResultFeedbackMetaFromHeaders(headers) {
  const token = headerValue(headers, CALLER_RESULT_FEEDBACK_HEADER).trim();
  if (!TOKEN_RE.test(token)) return null;
  return { ...callerResultFeedbackPublicContract(), token };
}

function statementIdFor(eventId) {
  return `crf_${sha256(eventId).slice(0, 32)}`;
}

function canonicalStatement(value) {
  if (!plain(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.length !== STATEMENT_KEYS.length || keys.some((key, index) => key !== STATEMENT_KEYS[index])) return null;
  if (value.schemaVersion !== CALLER_RESULT_FEEDBACK_SCHEMA) return null;
  if (!STATEMENT_ID_RE.test(value.statementId || "")) return null;
  if (!PAID_EVIDENCE_ID_PATTERN.test(value.paidEvidenceId || "")) return null;
  if (value.statementId !== statementIdFor(value.paidEvidenceId)) return null;
  if (!METHODS.has(value.method) || typeof value.route !== "string") return null;
  if (!HEX64.test(value.requestDigest || "") || !HEX64.test(value.responseDigest || "")) return null;
  if (!HEX64.test(value.capabilityHash || "")) return null;
  if (typeof value.settlementReference !== "string" || !TX.test(value.settlementReference)) return null;
  if (!DISPOSITIONS.has(value.disposition)) return null;
  if (value.reasonCategory !== null && !REASONS.has(value.reasonCategory)) return null;
  if (value.channel !== "http" || value.source !== "caller") return null;
  if (value.usefulness !== USEFULNESS_UNKNOWN) return null;
  if (!ISO_RE.test(value.receivedAt || "")) return null;
  return {
    schemaVersion: value.schemaVersion,
    statementId: value.statementId,
    paidEvidenceId: value.paidEvidenceId,
    requestDigest: value.requestDigest,
    responseDigest: value.responseDigest,
    route: value.route,
    method: value.method,
    settlementReference: value.settlementReference.toLowerCase(),
    disposition: value.disposition,
    reasonCategory: value.reasonCategory,
    capabilityHash: value.capabilityHash,
    channel: "http",
    receivedAt: value.receivedAt,
    usefulness: USEFULNESS_UNKNOWN,
    source: "caller",
  };
}

function canonicalMcpStatement(value) {
  if (!plain(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.length !== STATEMENT_KEYS.length || keys.some((key, index) => key !== STATEMENT_KEYS[index])) return null;
  if (value.schemaVersion !== CALLER_RESULT_FEEDBACK_MCP_SCHEMA) return null;
  if (!STATEMENT_ID_RE.test(value.statementId || "")) return null;
  if (!PAID_EVIDENCE_ID_PATTERN.test(value.paidEvidenceId || "")) return null;
  if (value.statementId !== statementIdFor(value.paidEvidenceId)) return null;
  if (value.method !== MCP_CALLER_RESULT_METHOD || value.route !== MCP_MORPHO_RESOURCE) return null;
  if (!HEX64.test(value.requestDigest || "") || !HEX64.test(value.responseDigest || "")) return null;
  if (!HEX64.test(value.capabilityHash || "")) return null;
  if (typeof value.settlementReference !== "string" || !TX.test(value.settlementReference)) return null;
  if (!DISPOSITIONS.has(value.disposition)) return null;
  if (value.reasonCategory !== null && !REASONS.has(value.reasonCategory)) return null;
  if (value.channel !== "mcp" || value.source !== "caller") return null;
  if (value.usefulness !== USEFULNESS_UNKNOWN) return null;
  if (!ISO_RE.test(value.receivedAt || "")) return null;
  return {
    schemaVersion: value.schemaVersion,
    statementId: value.statementId,
    paidEvidenceId: value.paidEvidenceId,
    requestDigest: value.requestDigest,
    responseDigest: value.responseDigest,
    route: value.route,
    method: value.method,
    settlementReference: value.settlementReference.toLowerCase(),
    disposition: value.disposition,
    reasonCategory: value.reasonCategory,
    capabilityHash: value.capabilityHash,
    channel: "mcp",
    receivedAt: value.receivedAt,
    usefulness: USEFULNESS_UNKNOWN,
    source: "caller",
  };
}

function sameStatement(left, right) {
  return left.disposition === right.disposition
    && left.reasonCategory === right.reasonCategory
    && left.requestDigest === right.requestDigest
    && left.responseDigest === right.responseDigest
    && left.route === right.route
    && left.method === right.method
    && left.settlementReference === right.settlementReference
    && left.paidEvidenceId === right.paidEvidenceId
    && left.channel === right.channel;
}

function declarationFrom(statement) {
  return {
    source: "caller",
    inferred: false,
    disposition: statement.disposition,
    reasonCategory: statement.reasonCategory,
    paidEvidenceId: statement.paidEvidenceId,
    requestDigest: statement.requestDigest,
    settlementReference: statement.settlementReference,
  };
}

function sameDeclaration(left, right) {
  return left.source === right.source
    && left.disposition === right.disposition
    && left.paidEvidenceId === right.paidEvidenceId
    && left.requestDigest === right.requestDigest
    && String(left.settlementReference || "").toLowerCase() === String(right.settlementReference || "").toLowerCase();
}

async function readRegular(file) {
  try {
    const info = await lstat(file);
    if (info.isSymbolicLink() || !info.isFile()) return { text: "", rejected: 1 };
    return { text: await readFile(file, "utf8"), rejected: 0 };
  } catch (error) {
    if (error?.code === "ENOENT") return { text: "", rejected: 0 };
    throw error;
  }
}

function statementsFrom(text) {
  let rejected = 0;
  const rows = [];
  for (const row of parseNdjson(text)) {
    if (row?._unparseable) {
      rejected += 1;
      continue;
    }
    const statement = canonicalStatement(row) || canonicalMcpStatement(row);
    if (!statement) rejected += 1;
    else rows.push(statement);
  }
  return { rows, rejected };
}

async function syncDirectory(dataDir) {
  const dir = await open(dataDir, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    await dir.sync();
  } finally {
    await dir.close();
  }
}

export function createCallerResultFeedbackService({
  dataDir,
  key = "",
  maxFileBytes = MAX_FILE_BYTES,
  now = () => Date.now(),
} = {}) {
  if (typeof dataDir !== "string" || dataDir.length === 0) throw new Error("data directory is required");
  const currentPath = path.join(dataDir, CALLER_RESULT_FEEDBACK_FILENAME);
  const rotatedPath = path.join(dataDir, CALLER_RESULT_FEEDBACK_ROTATED_FILENAME);
  const boundedMax = Number.isSafeInteger(maxFileBytes) && maxFileBytes >= 256 ? maxFileBytes : MAX_FILE_BYTES;

  async function readFiles() {
    const rotated = await readRegular(rotatedPath);
    const current = await readRegular(currentPath);
    const older = statementsFrom(rotated.text);
    const newer = statementsFrom(current.text);
    return {
      rows: [...older.rows, ...newer.rows],
      rejected: rotated.rejected + current.rejected + older.rejected + newer.rejected,
    };
  }

  async function appendStatement(record) {
    const line = `${JSON.stringify(record)}\n`;
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    const entry = await lstat(currentPath).catch((error) => (error?.code === "ENOENT" ? null : Promise.reject(error)));
    if (entry?.isSymbolicLink()) throw new Error("unsafe feedback journal");
    if (entry && !entry.isFile()) throw new Error("unsafe feedback journal");
    if (entry && entry.size + Buffer.byteLength(line) > boundedMax) {
      const prior = await open(currentPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        await prior.sync();
      } finally {
        await prior.close();
      }
      await unlink(rotatedPath).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
      await rename(currentPath, rotatedPath);
    }
    const handle = await open(
      currentPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      const current = await handle.stat();
      if (!current.isFile() || current.nlink !== 1) throw new Error("unsafe feedback journal");
      const payload = Buffer.from(line);
      let offset = 0;
      while (offset < payload.length) {
        const { bytesWritten } = await handle.write(payload.subarray(offset));
        if (bytesWritten <= 0) throw new Error("feedback journal write failed");
        offset += bytesWritten;
      }
      await handle.sync();
      await handle.chmod(0o600).catch(() => {});
    } finally {
      await handle.close();
    }
    await syncDirectory(dataDir);
  }

  async function loadCaptures() {
    const paidFile = await readRegular(path.join(dataDir, PAID_EVIDENCE_FILENAME));
    const validationFile = await readRegular(path.join(dataDir, VALIDATION_FILENAME));
    const paid = [];
    for (const row of parseNdjson(paidFile.text)) {
      if (row?._unparseable) continue;
      if (isHistoricalV1PaidSuccess(row)) paid.push(row);
    }
    const validations = [];
    for (const row of parseNdjson(validationFile.text)) {
      if (row?._unparseable) continue;
      try {
        validations.push(canonicalizeValidationRecord(row));
      } catch {
        // A non-canonical validation row is not a retained result.
      }
    }
    return { paid, validations };
  }

  function bindClaims(claims, captures) {
    const paidRows = captures.paid.filter((row) => row.id === claims.eventId);
    if (paidRows.length === 0) return { ok: false, code: "missing_capture" };
    if (paidRows.length > 1) return { ok: false, code: "duplicate_capture" };
    const paid = paidRows[0];
    if (paid.route !== claims.route || paid.method !== claims.method) return { ok: false, code: "route_mismatch" };
    if (paid.requestDigest !== claims.requestDigest) return { ok: false, code: "request_mismatch" };
    if (paid.responseDigest !== claims.responseDigest) return { ok: false, code: "response_mismatch" };
    if (typeof paid.settlementReference !== "string" || !TX.test(paid.settlementReference)) {
      return { ok: false, code: "settlement_unbound" };
    }
    const exact = captures.validations.filter((row) => (
      row.paidEvidenceId === paid.id
      && row.method === paid.method
      && row.resource === paid.route
      && row.requestDigest === paid.requestDigest
      && row.responseDigest === paid.responseDigest
      && typeof row.settlementReference === "string"
      && row.settlementReference.toLowerCase() === paid.settlementReference.toLowerCase()
      && row.usefulness === USEFULNESS_UNKNOWN
    ));
    if (exact.length === 0) return { ok: false, code: "missing_capture" };
    return {
      ok: true,
      paid,
      settlementReference: paid.settlementReference.toLowerCase(),
    };
  }

  function parseBody(body, rawBody) {
    if (Buffer.isBuffer(rawBody) && rawBody.length > MAX_BODY_BYTES) return { ok: false, code: "body_too_large" };
    if (typeof rawBody === "string" && Buffer.byteLength(rawBody) > MAX_BODY_BYTES) return { ok: false, code: "body_too_large" };
    if (!plain(body)) return { ok: false, code: "malformed_body" };
    const keys = Object.keys(body).sort();
    const allowed = body.reasonCategory === undefined ? ["disposition"] : ["disposition", "reasonCategory"];
    if (keys.length !== allowed.length || keys.some((item, index) => item !== allowed[index])) {
      return { ok: false, code: "unbounded_field" };
    }
    if (!DISPOSITIONS.has(body.disposition)) return { ok: false, code: "disposition_rejected" };
    if (body.reasonCategory !== undefined && !REASONS.has(body.reasonCategory)) {
      return { ok: false, code: "reason_rejected" };
    }
    return {
      ok: true,
      disposition: body.disposition,
      reasonCategory: body.reasonCategory === undefined ? null : body.reasonCategory,
    };
  }

  async function submit({ token, body, rawBody, query } = {}) {
    if (query && typeof query === "object" && Object.keys(query).length > 0) return refusal("query_rejected", 400);
    if (!keyReady(key)) return refusal("key_absent", 503);
    const parsedBody = parseBody(body, rawBody);
    if (!parsedBody.ok) {
      const status = parsedBody.code === "body_too_large" ? 413 : 400;
      return refusal(parsedBody.code, status);
    }
    const verified = readCallerResultFeedbackToken(token, key, now());
    if (!verified.ok) {
      const status = verified.code === "key_absent" ? 503 : 401;
      return refusal(verified.code, status);
    }
    try {
      return await admitCommerceJournal(dataDir, async () => {
        const captures = await loadCaptures();
        const bound = bindClaims(verified.claims, captures);
        if (!bound.ok) return refusal(bound.code, 409);
        const record = canonicalStatement({
          schemaVersion: CALLER_RESULT_FEEDBACK_SCHEMA,
          statementId: statementIdFor(verified.claims.eventId),
          paidEvidenceId: verified.claims.eventId,
          requestDigest: verified.claims.requestDigest,
          responseDigest: verified.claims.responseDigest,
          route: verified.claims.route,
          method: verified.claims.method,
          settlementReference: bound.settlementReference,
          disposition: parsedBody.disposition,
          reasonCategory: parsedBody.reasonCategory,
          capabilityHash: sha256(token),
          channel: "http",
          receivedAt: new Date(now()).toISOString(),
          usefulness: USEFULNESS_UNKNOWN,
          source: "caller",
        });
        return commitStatement(record, token);
      });
    } catch {
      return refusal("journal_write_failed", 503);
    }
  }

  function parseMcpArguments(args) {
    if (!plain(args)) return { ok: false, code: "malformed_body" };
    const keys = Object.keys(args).sort();
    const allowed = args.reasonCategory === undefined
      ? ["disposition", "token"]
      : ["disposition", "reasonCategory", "token"];
    if (keys.length !== allowed.length || keys.some((item, index) => item !== allowed[index])) {
      return { ok: false, code: "unbounded_field" };
    }
    if (typeof args.token !== "string" || !TOKEN_RE.test(args.token)) return { ok: false, code: "malformed_capability" };
    if (!DISPOSITIONS.has(args.disposition)) return { ok: false, code: "disposition_rejected" };
    if (args.reasonCategory !== undefined && !REASONS.has(args.reasonCategory)) {
      return { ok: false, code: "reason_rejected" };
    }
    const serialized = JSON.stringify({ disposition: args.disposition, reasonCategory: args.reasonCategory ?? null });
    if (serialized.includes(args.token) || serialized.includes("http://") || serialized.includes("https://")) {
      return { ok: false, code: "unbounded_field" };
    }
    return {
      ok: true,
      token: args.token,
      disposition: args.disposition,
      reasonCategory: args.reasonCategory === undefined ? null : args.reasonCategory,
    };
  }

  async function loadMcpCaptures() {
    const { isCanonicalMcpTypedCommerceEvent } = await import("./commerce-events.mjs");
    const deliveries = await openStore(dataDir).readMcpDeliveries();
    const current = await readRegular(path.join(dataDir, "commerce-events.ndjson"));
    const rotated = await readRegular(path.join(dataDir, "commerce-events.1.ndjson"));
    const events = [];
    for (const row of parseNdjson(`${rotated.text}\n${current.text}`)) {
      if (row?._unparseable) continue;
      if (isCanonicalMcpTypedCommerceEvent(row)) events.push(row);
    }
    return { deliveries, events };
  }

  function bindMcpClaims(claims, captures) {
    const sameSettlement = captures.deliveries.filter((row) => (
      typeof row.settlementReference === "string"
      && row.settlementReference.toLowerCase() === claims.settlementReference
    ));
    const matches = sameSettlement.filter((row) => (
      row.tool === claims.tool
      && row.resource === claims.resource
      && row.requestDigest === claims.requestDigest
      && row.responseDigest === claims.responseDigest
      && row.callDigest === claims.callDigest
      && row.issuedOfferDigest === claims.issuedOfferDigest
      && row.usefulness === USEFULNESS_UNKNOWN
    ));
    if (matches.length === 0) {
      if (sameSettlement.length === 0) return { ok: false, code: "missing_capture" };
      if (sameSettlement.some((row) => row.tool !== claims.tool || row.resource !== claims.resource)) {
        return { ok: false, code: "foreign_tool" };
      }
      if (sameSettlement.some((row) => row.requestDigest !== claims.requestDigest || row.callDigest !== claims.callDigest)) {
        return { ok: false, code: "request_mismatch" };
      }
      if (sameSettlement.some((row) => row.responseDigest !== claims.responseDigest)) {
        return { ok: false, code: "response_mismatch" };
      }
      return { ok: false, code: "missing_capture" };
    }
    if (matches.length > 1) return { ok: false, code: "duplicate_capture" };
    const delivery = matches[0];
    const events = captures.events.filter((event) => event.id === delivery.paidEvidenceId);
    if (events.length !== 1) return { ok: false, code: "missing_capture" };
    const event = events[0];
    if (event.binding?.tool !== claims.tool || event.binding?.resource !== claims.resource) {
      return { ok: false, code: "foreign_tool" };
    }
    if (event.result !== "paid_success" || event.settlementState !== "succeeded") {
      return { ok: false, code: "settlement_unbound" };
    }
    return {
      ok: true,
      eventId: event.id,
      settlementReference: delivery.settlementReference.toLowerCase(),
    };
  }

  async function retainProspectiveCallerFeedback() {
    try {
      const { bindStoredCallerResultFeedback } = await import("./commerce-prospective-delivery.mjs");
      await bindStoredCallerResultFeedback(dataDir);
    } catch {
      // Prospective retention cannot refuse an already accepted caller statement.
    }
  }

  async function commitStatement(record, token) {
    if (!record) return refusal("malformed_statement", 400);
    if (typeof token !== "string" || token.length === 0 || JSON.stringify(record).includes(token)) {
      return refusal("bearer_retained", 500);
    }
    const existing = await readFiles();
    const prior = existing.rows.filter((row) => row.paidEvidenceId === record.paidEvidenceId && row.channel === record.channel);
    if (prior.some((row) => sameStatement(row, record))) {
      await retainProspectiveCallerFeedback();
      return acceptance({
        disposition: record.disposition,
        reasonCategory: record.reasonCategory,
        idempotentReplay: true,
      });
    }
    if (prior.length > 0) {
      const retained = prior[0];
      return {
        statusCode: 409,
        body: {
          ...refusal("conflicting_statement", 409).body,
          retainedDisposition: retained.disposition,
          retainedReasonCategory: retained.reasonCategory,
        },
      };
    }
    await appendStatement(record);
    await retainProspectiveCallerFeedback();
    return acceptance({
      disposition: record.disposition,
      reasonCategory: record.reasonCategory,
      idempotentReplay: false,
    });
  }

  async function submitMcp({ arguments: args } = {}) {
    if (!keyReady(key)) return refusal("key_absent", 503);
    const parsed = parseMcpArguments(args);
    if (!parsed.ok) {
      const status = parsed.code === "malformed_capability" ? 401 : 400;
      return refusal(parsed.code, status);
    }
    const verified = readMcpCallerResultFeedbackToken(parsed.token, key, now());
    if (!verified.ok) {
      const status = verified.code === "key_absent" ? 503 : 401;
      return refusal(verified.code, status);
    }
    try {
      return await admitCommerceJournal(dataDir, async () => {
        const captures = await loadMcpCaptures();
        const bound = bindMcpClaims(verified.claims, captures);
        if (!bound.ok) return refusal(bound.code, 409);
        const record = canonicalMcpStatement({
          schemaVersion: CALLER_RESULT_FEEDBACK_MCP_SCHEMA,
          statementId: statementIdFor(bound.eventId),
          paidEvidenceId: bound.eventId,
          requestDigest: verified.claims.requestDigest,
          responseDigest: verified.claims.responseDigest,
          route: verified.claims.resource,
          method: MCP_CALLER_RESULT_METHOD,
          settlementReference: bound.settlementReference,
          disposition: parsed.disposition,
          reasonCategory: parsed.reasonCategory,
          capabilityHash: sha256(parsed.token),
          channel: "mcp",
          receivedAt: new Date(now()).toISOString(),
          usefulness: USEFULNESS_UNKNOWN,
          source: "caller",
        });
        return commitStatement(record, parsed.token);
      });
    } catch {
      return refusal("journal_write_failed", 503);
    }
  }

  async function readDeclarations() {
    const loaded = await readFiles();
    const declarations = [];
    for (const statement of loaded.rows) {
      const declaration = declarationFrom(statement);
      if (declarations.some((item) => sameDeclaration(item, declaration))) continue;
      declarations.push(declaration);
    }
    return { declarations, rejected: loaded.rejected };
  }

  return Object.freeze({
    dataDir,
    currentPath,
    rotatedPath,
    durability: CALLER_RESULT_FEEDBACK_DURABILITY,
    submit,
    submitMcp,
    readDeclarations,
  });
}
