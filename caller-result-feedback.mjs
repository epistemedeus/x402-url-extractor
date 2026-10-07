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
import {
  PAID_EVIDENCE_FILENAME,
  PAID_EVIDENCE_ID_PATTERN,
  isHistoricalV1PaidSuccess,
  parseNdjson,
} from "./http-delivery-evidence/historical.mjs";
import {
  VALIDATION_FILENAME,
  canonicalizeValidationRecord,
} from "./http-delivery-evidence/store.mjs";

export const CALLER_RESULT_FEEDBACK_PATH = "/commerce/caller-result-feedback";
export const CALLER_RESULT_FEEDBACK_HEADER = "x-samedaydesk-caller-result-feedback";
export const CALLER_RESULT_FEEDBACK_LINK = `</commerce/caller-result-feedback>; rel="caller-result-feedback"`;
export const CALLER_RESULT_FEEDBACK_SCHEMA = "samedaydesk.caller-result-feedback.v1";
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

function sameStatement(left, right) {
  return left.disposition === right.disposition
    && left.reasonCategory === right.reasonCategory
    && left.requestDigest === right.requestDigest
    && left.responseDigest === right.responseDigest
    && left.route === right.route
    && left.method === right.method
    && left.settlementReference === right.settlementReference
    && left.paidEvidenceId === right.paidEvidenceId;
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
    const statement = canonicalStatement(row);
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
        if (!record) return refusal("malformed_statement", 400);
        if (JSON.stringify(record).includes(token)) return refusal("bearer_retained", 500);
        const existing = await readFiles();
        const prior = existing.rows.filter((row) => row.paidEvidenceId === record.paidEvidenceId);
        if (prior.some((row) => sameStatement(row, record))) {
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
        return acceptance({
          disposition: record.disposition,
          reasonCategory: record.reasonCategory,
          idempotentReplay: false,
        });
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
    readDeclarations,
  });
}
