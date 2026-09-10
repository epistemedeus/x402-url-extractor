/**
 * Official-example offline replay pack schema (R2-CONSUMER-JOBS-05 / c21).
 *
 * Validates supplied API examples into a no-spend offline pack shape.
 * Does not fetch, sign, pay, or execute providers. Does not invent responses.
 * Online replay is blocked unless every prerequisite is explicit and satisfied;
 * paid-endpoint / account-signup / spend-authorization can never be satisfied.
 */

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { isIsoClock } from "../common/clock.mjs";
import { isSha256Hex, sha256Hex as sha256Bytes } from "../common/hash.mjs";
import {
  PACKET_SCHEMA,
  EVIDENCE_CLASSES,
  DECISIONS,
  createEnvelope,
  requireCitedFinding,
} from "../packet.mjs";

export {
  PACKET_SCHEMA,
  EVIDENCE_CLASSES,
  DECISIONS,
  createEnvelope,
  requireCitedFinding,
};

export const INPUT_SCHEMA = "s137.replay-pack.input.v1";
export const OUTPUT_SCHEMA = "s137.replay-pack.output.v1";
export const JOB_ID = "R2-CONSUMER-JOBS-05";
export const ARTIFACT_KIND = "replay-pack";
export const CELL_ID = "c21";
export const REDACTED = "REDACTED";

export const EXAMPLE_KINDS = Object.freeze([
  "http-exchange",
  "openapi-example",
  "docs-snippet",
]);

export const HTTP_METHODS = Object.freeze([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
]);

export const COVERAGE = Object.freeze(["full", "partial", "missing"]);

export const REPLAY_MODES = Object.freeze([
  "offline-fixture",
  "online-blocked",
  "online-ready",
]);

export const EXECUTION_STATUSES = Object.freeze([
  "not-executed",
  "fixture-replay",
  "live-capture",
]);

export const ONLINE_PREREQ_KINDS = Object.freeze([
  "operator-consent",
  "network-https-get",
  "auth-credential",
  "paid-endpoint",
  "account-signup",
  "spend-authorization",
  "rate-limit-budget",
  "redirect-policy",
]);

export const BLOCKING_PREREQ_KINDS = Object.freeze([
  "paid-endpoint",
  "account-signup",
  "spend-authorization",
]);

export const SECRET_HEADER_NAMES = Object.freeze([
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "api-key",
  "x-github-token",
]);

export const FINDING_KINDS = Object.freeze([
  "positive",
  "negative",
  "partial",
  "conflict",
]);

export const ISSUE_KINDS = Object.freeze([
  "invalid",
  "unknown",
  "partial",
  "conflict",
]);

export const MAX_EXAMPLES = 64;
export const MAX_CITATIONS = 128;
export const MAX_FINDINGS = 128;
export const MAX_PREREQS = 32;
export const MAX_ALLOWLIST = 64;
export const MAX_HEADERS = 32;
export const MAX_CITATION_IDS = 16;
export const MAX_STRING = 8192;
export const MAX_URL = 4096;
export const MAX_ISSUES = 32;
export const MAX_STATUS = 599;
export const MIN_STATUS = 100;

const EVIDENCE_SET = new Set(EVIDENCE_CLASSES);
const DECISION_SET = new Set(DECISIONS);
const EXAMPLE_KIND_SET = new Set(EXAMPLE_KINDS);
const METHOD_SET = new Set(HTTP_METHODS);
const COVERAGE_SET = new Set(COVERAGE);
const REPLAY_MODE_SET = new Set(REPLAY_MODES);
const EXECUTION_SET = new Set(EXECUTION_STATUSES);
const PREREQ_KIND_SET = new Set(ONLINE_PREREQ_KINDS);
const BLOCKING_SET = new Set(BLOCKING_PREREQ_KINDS);
const SECRET_HEADER_SET = new Set(SECRET_HEADER_NAMES);
const FINDING_KIND_SET = new Set(FINDING_KINDS);
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REFUSED_NOW = new Set(["now", "NOW", "Date.now()", "new Date()"]);

export const SCHEMA_LIMITATIONS = Object.freeze([
  "Schema validation only; does not fetch, sign, pay, or execute providers.",
  "Missing recorded responses stay partial; responses are not synthesized.",
  "Online replay is blocked unless every prerequisite is explicit and satisfied.",
  "paid-endpoint, account-signup, and spend-authorization cannot be satisfied in this pack.",
  "Operator clock is required; 'now' and wall-clock invention are refused.",
  "Secret header values must be REDACTED; this pack does not store credentials.",
  "This cell does not transform examples (c22) or own pack fixtures (c23/c24).",
]);

export const INPUT_FIELDS = Object.freeze({
  required: Object.freeze(["schema", "clock", "evidenceClass", "examples", "citations"]),
  optional: Object.freeze(["online"]),
});

export const OUTPUT_FIELDS = Object.freeze({
  required: Object.freeze([
    "schema",
    "packetSchema",
    "jobId",
    "artifactKind",
    "clock",
    "evidenceClass",
    "offline",
    "payment",
    "cost",
    "examples",
    "citations",
    "findings",
    "online",
    "decision",
    "limitations",
    "claims",
    "summary",
  ]),
  optional: Object.freeze(["sources"]),
});

export const DEFAULT_CLAIMS = Object.freeze({
  inventsFacts: false,
  paidEndpoint: false,
  legalAttestation: false,
  modelAsOracle: false,
  assertsCustomerDemand: false,
});

export const DEFAULT_EXECUTION = Object.freeze({
  status: "not-executed",
  fakedProviderExecution: false,
  providerInvoked: false,
});

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasForbiddenKey(value) {
  if (!isPlainObject(value)) return false;
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) return true;
  }
  return false;
}

export function sha256Hex(value) {
  if (typeof value === "string" || Buffer.isBuffer(value)) return sha256Bytes(value);
  return sha256Bytes(Buffer.from(canonicalJson(value)));
}

export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const key of Object.keys(value).sort()) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    out[key] = sortValue(value[key]);
  }
  return out;
}

export { isIsoClock, isSha256Hex };

export function isId(value) {
  return typeof value === "string" && ID_PATTERN.test(value);
}

export function suggestedDecision(status) {
  if (status === "ok") return "pass";
  if (status === "partial") return "partial";
  if (status === "conflict") return "conflict";
  if (status === "invalid") return "fail";
  return "unknown";
}

export function makeIssue({
  kind,
  code,
  keyword,
  instancePath,
  message,
  params = {},
}) {
  return {
    kind,
    code,
    keyword: keyword || code,
    instancePath,
    schemaPath: `#${instancePath || ""}`,
    message,
    params,
  };
}

function pushIssue(issues, issue) {
  if (issues.length >= MAX_ISSUES) return issues;
  issues.push(issue);
  return issues;
}

export function makeCitation({
  id,
  path = null,
  url = null,
  sha256 = null,
  retrievedAt = null,
  licenseNote = null,
  evidenceClass = null,
  content = undefined,
} = {}) {
  const citation = {
    id,
    path,
    url,
    sha256,
    retrievedAt,
    licenseNote,
    evidenceClass,
  };
  if (content !== undefined) citation.content = content;
  return citation;
}

export function makeFinding({
  id,
  kind,
  code,
  message,
  citationIds,
  exampleId = null,
} = {}) {
  return requireCitedFinding({
    id,
    kind,
    code,
    message,
    citationIds,
    exampleId,
  });
}

export function makeOnlinePrereq({
  id,
  kind,
  required = true,
  satisfied = false,
  blocking = BLOCKING_SET.has(kind),
  citationIds = [],
  note = null,
} = {}) {
  return { id, kind, required, satisfied, blocking, citationIds, note };
}

export function defaultOnline({ requested = false, consent = false } = {}) {
  return {
    requested: requested === true,
    consent: consent === true,
    prereqs: requested === true ? requiredOnlinePrereqs() : [],
    allowlistedUrls: [],
  };
}

export function requiredOnlinePrereqs() {
  return [
    makeOnlinePrereq({
      id: "operator-consent",
      kind: "operator-consent",
      note: "Online replay requires explicit operator consent; default is offline.",
    }),
    makeOnlinePrereq({
      id: "network-https-get",
      kind: "network-https-get",
      note: "Live capture is GET-only over HTTPS; redirects refused.",
    }),
    makeOnlinePrereq({
      id: "redirect-policy",
      kind: "redirect-policy",
      note: "redirect: manual/error; 3xx is not followed.",
    }),
  ];
}

export function defaultExecution() {
  return { ...DEFAULT_EXECUTION };
}

export function coverageForExample(example = {}) {
  const hasRequest = isPlainObject(example.request);
  const hasResponse = isPlainObject(example.response);
  const hasOpenapiValue =
    isPlainObject(example.openapi) && Object.prototype.hasOwnProperty.call(example.openapi, "value");
  const recorded = hasResponse || hasOpenapiValue;
  if (hasRequest && recorded) return "full";
  if (hasRequest || recorded) return "partial";
  return "missing";
}

export function onlineReplayAllowed(online = {}) {
  if (!isPlainObject(online)) return false;
  if (online.requested !== true) return false;
  if (online.consent !== true) return false;
  const prereqs = Array.isArray(online.prereqs) ? online.prereqs : [];
  if (prereqs.length === 0) return false;
  for (const prereq of prereqs) {
    if (!isPlainObject(prereq)) return false;
    if (BLOCKING_SET.has(prereq.kind) || prereq.blocking === true) return false;
    if (prereq.required !== false && prereq.satisfied !== true) return false;
  }
  const allowlisted = Array.isArray(online.allowlistedUrls) ? online.allowlistedUrls : [];
  if (allowlisted.length === 0) return false;
  return true;
}

export function replayModeFor(example, online = {}) {
  if (onlineReplayAllowed(online) && exampleHasAbsoluteHttps(example)) {
    return "online-ready";
  }
  if (online?.requested === true) return "online-blocked";
  return "offline-fixture";
}

function exampleHasAbsoluteHttps(example) {
  const url = example?.request?.url;
  if (typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

export function urlAllowlisted(url, allowlistedUrls = []) {
  if (typeof url !== "string" || !Array.isArray(allowlistedUrls) || allowlistedUrls.length === 0) {
    return false;
  }
  return allowlistedUrls.includes(url);
}

function statusFromIssues(issues) {
  if (issues.some((row) => row.kind === "invalid")) return "invalid";
  if (issues.some((row) => row.kind === "conflict")) return "conflict";
  if (issues.some((row) => row.kind === "unknown")) return "unknown";
  if (issues.some((row) => row.kind === "partial")) return "partial";
  return "ok";
}

function boundedString(value, max = MAX_STRING) {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function checkClock(clock, issues, instancePath = "/clock") {
  if (clock == null || clock === "") {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "clock.required",
      instancePath,
      message: "clock required (operator-supplied; do not invent)",
    }));
    return;
  }
  if (typeof clock !== "string" || REFUSED_NOW.has(clock.trim())) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "clock.invented",
      instancePath,
      message: "clock must be an operator-supplied ISO-8601 timestamp; 'now' is refused",
      params: { clock },
    }));
    return;
  }
  if (!isIsoClock(clock)) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "clock.format",
      instancePath,
      message: "clock must be ISO-8601 with Z or numeric offset",
      params: { clock },
    }));
  }
}

function checkEvidenceClass(evidenceClass, issues, instancePath = "/evidenceClass") {
  if (!EVIDENCE_SET.has(evidenceClass)) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "evidenceClass.enum",
      instancePath,
      message: `evidenceClass must be one of ${EVIDENCE_CLASSES.join("|")}`,
      params: { evidenceClass },
    }));
  }
}

export function validateCitation(citation, { instancePath = "/citations/0", packEvidenceClass = null } = {}) {
  const issues = [];
  if (!isPlainObject(citation) || hasForbiddenKey(citation)) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "citation.type",
      instancePath,
      message: "citation must be a plain object",
    }));
    return issues;
  }
  if (!isId(citation.id)) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "citation.id",
      instancePath: `${instancePath}/id`,
      message: "citation.id must match [A-Za-z0-9][A-Za-z0-9._:-]{0,127}",
    }));
  }
  const hasPath = citation.path == null || citation.path === "" ? false : boundedString(citation.path, MAX_URL);
  const hasUrl = citation.url == null || citation.url === "" ? false : boundedString(citation.url, MAX_URL);
  if (citation.path != null && citation.path !== "" && !hasPath) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "citation.path",
      instancePath: `${instancePath}/path`,
      message: "citation.path must be a bounded string",
    }));
  }
  if (citation.url != null && citation.url !== "" && !hasUrl) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "citation.url",
      instancePath: `${instancePath}/url`,
      message: "citation.url must be a bounded string",
    }));
  }
  if (!hasPath && !hasUrl) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "citation.source",
      instancePath,
      message: "citation requires path and/or url",
    }));
  }
  if (citation.sha256 != null) {
    if (!isSha256Hex(citation.sha256)) {
      pushIssue(issues, makeIssue({
        kind: "invalid",
        code: "citation.sha256",
        instancePath: `${instancePath}/sha256`,
        message: "citation.sha256 must be 64 lowercase hex chars when present",
      }));
    } else if (citation.content !== undefined) {
      const actual = sha256Hex(
        typeof citation.content === "string" ? citation.content : canonicalJson(citation.content),
      );
      if (actual !== citation.sha256) {
        pushIssue(issues, makeIssue({
          kind: "conflict",
          code: "citation.hash_mismatch",
          instancePath: `${instancePath}/sha256`,
          message: "citation.sha256 does not match citation.content",
          params: { expected: citation.sha256, actual },
        }));
      }
    }
  } else {
    pushIssue(issues, makeIssue({
      kind: "partial",
      code: "citation.sha256_missing",
      instancePath: `${instancePath}/sha256`,
      message: "citation has no content hash; coverage is partial",
    }));
  }
  if (citation.evidenceClass != null && !EVIDENCE_SET.has(citation.evidenceClass)) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "citation.evidenceClass",
      instancePath: `${instancePath}/evidenceClass`,
      message: `citation.evidenceClass must be one of ${EVIDENCE_CLASSES.join("|")}`,
    }));
  }
  const effectiveClass = citation.evidenceClass || packEvidenceClass;
  if (effectiveClass === "live-capture") {
    if (!hasUrl) {
      pushIssue(issues, makeIssue({
        kind: "conflict",
        code: "citation.live_missing_url",
        instancePath: `${instancePath}/url`,
        message: "live-capture citation requires url",
      }));
    }
    if (citation.retrievedAt == null) {
      pushIssue(issues, makeIssue({
        kind: "conflict",
        code: "citation.live_missing_retrievedAt",
        instancePath: `${instancePath}/retrievedAt`,
        message: "live-capture citation requires retrievedAt",
      }));
    } else if (!isIsoClock(citation.retrievedAt)) {
      pushIssue(issues, makeIssue({
        kind: "invalid",
        code: "citation.retrievedAt",
        instancePath: `${instancePath}/retrievedAt`,
        message: "retrievedAt must be ISO-8601",
      }));
    }
  } else if (citation.retrievedAt != null && !isIsoClock(citation.retrievedAt)) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "citation.retrievedAt",
      instancePath: `${instancePath}/retrievedAt`,
      message: "retrievedAt must be ISO-8601 when present",
    }));
  }
  if (citation.licenseNote != null && !boundedString(citation.licenseNote)) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "citation.licenseNote",
      instancePath: `${instancePath}/licenseNote`,
      message: "licenseNote must be a bounded string when present",
    }));
  }
  return issues;
}

export function validateFinding(finding, { citationIds = new Set(), instancePath = "/findings/0" } = {}) {
  const issues = [];
  if (!isPlainObject(finding) || hasForbiddenKey(finding)) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "finding.type",
      instancePath,
      message: "finding must be a plain object",
    }));
    return issues;
  }
  if (!isId(finding.id)) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "finding.id",
      instancePath: `${instancePath}/id`,
      message: "finding.id must be a bounded id",
    }));
  }
  if (finding.kind != null && !FINDING_KIND_SET.has(finding.kind)) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "finding.kind",
      instancePath: `${instancePath}/kind`,
      message: `finding.kind must be one of ${FINDING_KINDS.join("|")}`,
    }));
  }
  if (!Array.isArray(finding.citationIds) || finding.citationIds.length === 0) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "finding.citationIds",
      instancePath: `${instancePath}/citationIds`,
      message: "every finding must cite at least one citationId",
    }));
  } else {
    if (finding.citationIds.length > MAX_CITATION_IDS) {
      pushIssue(issues, makeIssue({
        kind: "invalid",
        code: "finding.citationIds.maxItems",
        instancePath: `${instancePath}/citationIds`,
        message: `citationIds exceeds ${MAX_CITATION_IDS}`,
      }));
    }
    for (const [i, id] of finding.citationIds.entries()) {
      if (!citationIds.has(id)) {
        pushIssue(issues, makeIssue({
          kind: "invalid",
          code: "finding.citationIds.unknown",
          instancePath: `${instancePath}/citationIds/${i}`,
          message: "finding citationId is not in citations[]",
          params: { id },
        }));
      }
    }
  }
  if (finding.message != null && !boundedString(finding.message)) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "finding.message",
      instancePath: `${instancePath}/message`,
      message: "finding.message must be a bounded string when present",
    }));
  }
  return issues;
}

export function validateHttpMessage(message, { role, instancePath }) {
  const issues = [];
  if (!isPlainObject(message) || hasForbiddenKey(message)) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: `${role}.type`,
      instancePath,
      message: `${role} must be a plain object`,
    }));
    return issues;
  }
  if (role === "request") {
    const method = typeof message.method === "string" ? message.method.toUpperCase() : message.method;
    if (!METHOD_SET.has(method)) {
      pushIssue(issues, makeIssue({
        kind: "invalid",
        code: "request.method",
        instancePath: `${instancePath}/method`,
        message: `request.method must be one of ${HTTP_METHODS.join("|")}`,
      }));
    }
    validateRequestUrl(message.url, issues, `${instancePath}/url`);
  }
  if (role === "response") {
    if (!Number.isInteger(message.status) || message.status < MIN_STATUS || message.status > MAX_STATUS) {
      pushIssue(issues, makeIssue({
        kind: "invalid",
        code: "response.status",
        instancePath: `${instancePath}/status`,
        message: "response.status must be an integer 100-599",
      }));
    }
  }
  if (message.headers != null) {
    issues.push(...validateHeaders(message.headers, `${instancePath}/headers`));
  }
  if (Object.prototype.hasOwnProperty.call(message, "synthesized") && message.synthesized === true) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: `${role}.synthesized`,
      instancePath: `${instancePath}/synthesized`,
      message: "synthesized HTTP messages are refused; do not invent provider bytes",
    }));
  }
  return issues;
}

function validateRequestUrl(url, issues, instancePath) {
  if (typeof url !== "string" || url.length === 0 || url.length > MAX_URL) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "request.url",
      instancePath,
      message: "request.url must be a bounded string (absolute URL or path template)",
    }));
    return;
  }
  if (url.startsWith("/")) return;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "request.url.format",
      instancePath,
      message: "request.url must be an absolute URL or a path starting with /",
    }));
    return;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "request.url.protocol",
      instancePath,
      message: "request.url protocol must be http(s); file/mcp/javascript refused",
      params: { protocol: parsed.protocol },
    }));
  }
  if (parsed.username || parsed.password) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "request.url.userinfo",
      instancePath,
      message: "request.url must not embed credentials",
    }));
  }
}

export function validateHeaders(headers, instancePath = "/headers") {
  const issues = [];
  if (!isPlainObject(headers) || hasForbiddenKey(headers)) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "headers.type",
      instancePath,
      message: "headers must be a plain object",
    }));
    return issues;
  }
  const keys = Object.keys(headers);
  if (keys.length > MAX_HEADERS) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "headers.maxItems",
      instancePath,
      message: `headers exceed ${MAX_HEADERS}`,
    }));
  }
  for (const name of keys) {
    const value = headers[name];
    if (typeof name !== "string" || name.length === 0 || name.length > 256) {
      pushIssue(issues, makeIssue({
        kind: "invalid",
        code: "headers.name",
        instancePath: `${instancePath}/${name}`,
        message: "header name is empty or oversized",
      }));
      continue;
    }
    if (value != null && typeof value !== "string") {
      pushIssue(issues, makeIssue({
        kind: "invalid",
        code: "headers.value",
        instancePath: `${instancePath}/${name}`,
        message: "header values must be strings",
      }));
      continue;
    }
    if (SECRET_HEADER_SET.has(name.toLowerCase()) && value && value !== REDACTED) {
      pushIssue(issues, makeIssue({
        kind: "invalid",
        code: "headers.secret",
        instancePath: `${instancePath}/${name}`,
        message: `secret header ${name} must be ${REDACTED}; credentials are not stored`,
      }));
    }
  }
  return issues;
}

export function validateOnlinePrereq(prereq, { instancePath = "/online/prereqs/0" } = {}) {
  const issues = [];
  if (!isPlainObject(prereq) || hasForbiddenKey(prereq)) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "prereq.type",
      instancePath,
      message: "online prereq must be a plain object",
    }));
    return issues;
  }
  if (!isId(prereq.id)) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "prereq.id",
      instancePath: `${instancePath}/id`,
      message: "prereq.id must be a bounded id",
    }));
  }
  if (!PREREQ_KIND_SET.has(prereq.kind)) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "prereq.kind",
      instancePath: `${instancePath}/kind`,
      message: `prereq.kind must be one of ${ONLINE_PREREQ_KINDS.join("|")}`,
    }));
  }
  const blockingKind = BLOCKING_SET.has(prereq.kind);
  if (prereq.satisfied === true && (blockingKind || prereq.blocking === true)) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "prereq.blocking_satisfied",
      instancePath: `${instancePath}/satisfied`,
      message: "blocking prerequisites (paid-endpoint, account-signup, spend-authorization) cannot be satisfied",
      params: { kind: prereq.kind },
    }));
  }
  if (blockingKind && prereq.blocking === false) {
    pushIssue(issues, makeIssue({
      kind: "conflict",
      code: "prereq.blocking_denied",
      instancePath: `${instancePath}/blocking`,
      message: "blocking kind must keep blocking=true",
      params: { kind: prereq.kind },
    }));
  }
  if (prereq.required != null && typeof prereq.required !== "boolean") {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "prereq.required",
      instancePath: `${instancePath}/required`,
      message: "prereq.required must be boolean when present",
    }));
  }
  if (prereq.satisfied != null && typeof prereq.satisfied !== "boolean") {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "prereq.satisfied",
      instancePath: `${instancePath}/satisfied`,
      message: "prereq.satisfied must be boolean when present",
    }));
  }
  return issues;
}

export function validateOnlineBlock(online, { instancePath = "/online", examples = [] } = {}) {
  const issues = [];
  if (online == null) return issues;
  if (!isPlainObject(online) || hasForbiddenKey(online)) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "online.type",
      instancePath,
      message: "online must be a plain object",
    }));
    return issues;
  }
  if (online.requested != null && typeof online.requested !== "boolean") {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "online.requested",
      instancePath: `${instancePath}/requested`,
      message: "online.requested must be boolean",
    }));
  }
  if (online.consent != null && typeof online.consent !== "boolean") {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "online.consent",
      instancePath: `${instancePath}/consent`,
      message: "online.consent must be boolean",
    }));
  }
  const prereqs = online.prereqs == null ? [] : online.prereqs;
  if (!Array.isArray(prereqs)) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "online.prereqs.type",
      instancePath: `${instancePath}/prereqs`,
      message: "online.prereqs must be an array",
    }));
  } else {
    if (prereqs.length > MAX_PREREQS) {
      pushIssue(issues, makeIssue({
        kind: "invalid",
        code: "online.prereqs.maxItems",
        instancePath: `${instancePath}/prereqs`,
        message: `online.prereqs exceeds ${MAX_PREREQS}`,
      }));
    }
    const seen = new Set();
    for (const [i, prereq] of prereqs.entries()) {
      issues.push(...validateOnlinePrereq(prereq, { instancePath: `${instancePath}/prereqs/${i}` }));
      if (isPlainObject(prereq) && isId(prereq.id)) {
        if (seen.has(prereq.id)) {
          pushIssue(issues, makeIssue({
            kind: "conflict",
            code: "online.prereqs.duplicate",
            instancePath: `${instancePath}/prereqs/${i}/id`,
            message: "duplicate prereq.id",
            params: { id: prereq.id },
          }));
        }
        seen.add(prereq.id);
      }
    }
    if (online.requested === true && prereqs.length === 0) {
      pushIssue(issues, makeIssue({
        kind: "invalid",
        code: "online.prereqs.required",
        instancePath: `${instancePath}/prereqs`,
        message: "online.requested requires an explicit prereqs[] list",
      }));
    }
    if (online.requested === true && online.consent !== true) {
      pushIssue(issues, makeIssue({
        kind: "partial",
        code: "online.consent_missing",
        instancePath: `${instancePath}/consent`,
        message: "online requested without operator consent; replay stays blocked",
      }));
    }
  }
  const allowlisted = online.allowlistedUrls == null ? [] : online.allowlistedUrls;
  if (allowlisted != null && !Array.isArray(allowlisted)) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "online.allowlistedUrls.type",
      instancePath: `${instancePath}/allowlistedUrls`,
      message: "allowlistedUrls must be an array",
    }));
  } else if (Array.isArray(allowlisted)) {
    if (allowlisted.length > MAX_ALLOWLIST) {
      pushIssue(issues, makeIssue({
        kind: "invalid",
        code: "online.allowlistedUrls.maxItems",
        instancePath: `${instancePath}/allowlistedUrls`,
        message: `allowlistedUrls exceeds ${MAX_ALLOWLIST}`,
      }));
    }
    if (online.requested === true && allowlisted.length === 0) {
      pushIssue(issues, makeIssue({
        kind: "partial",
        code: "online.allowlist_empty",
        instancePath: `${instancePath}/allowlistedUrls`,
        message: "online requested with empty allowlist; live URLs are not authorized",
      }));
    }
    for (const example of examples) {
      const url = example?.request?.url;
      if (typeof url === "string" && url.startsWith("https://") && allowlisted.length > 0 && !urlAllowlisted(url, allowlisted)) {
        pushIssue(issues, makeIssue({
          kind: "partial",
          code: "online.url_not_allowlisted",
          instancePath: `${instancePath}/allowlistedUrls`,
          message: "example request URL is not in allowlistedUrls",
          params: { url, exampleId: example.id },
        }));
      }
    }
  }
  return issues;
}

export function validateExample(example, {
  instancePath = "/examples/0",
  citationIds = new Set(),
  packEvidenceClass = "synthetic",
} = {}) {
  const issues = [];
  if (!isPlainObject(example) || hasForbiddenKey(example)) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "example.type",
      instancePath,
      message: "example must be a plain object",
    }));
    return { issues, coverage: "missing" };
  }
  if (!isId(example.id)) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "example.id",
      instancePath: `${instancePath}/id`,
      message: "example.id must be a bounded id",
    }));
  }
  if (!EXAMPLE_KIND_SET.has(example.kind)) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "example.kind",
      instancePath: `${instancePath}/kind`,
      message: `example.kind must be one of ${EXAMPLE_KINDS.join("|")}`,
    }));
  }
  if (!Array.isArray(example.citationIds) || example.citationIds.length === 0) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "example.citationIds",
      instancePath: `${instancePath}/citationIds`,
      message: "every example must cite at least one citationId",
    }));
  } else {
    for (const [i, id] of example.citationIds.entries()) {
      if (!citationIds.has(id)) {
        pushIssue(issues, makeIssue({
          kind: "invalid",
          code: "example.citationIds.unknown",
          instancePath: `${instancePath}/citationIds/${i}`,
          message: "example citationId is not in citations[]",
          params: { id },
        }));
      }
    }
  }
  if (example.request != null) {
    issues.push(...validateHttpMessage(example.request, { role: "request", instancePath: `${instancePath}/request` }));
  }
  if (example.response != null) {
    issues.push(...validateHttpMessage(example.response, { role: "response", instancePath: `${instancePath}/response` }));
  }
  if (example.openapi != null) {
    if (!isPlainObject(example.openapi) || hasForbiddenKey(example.openapi)) {
      pushIssue(issues, makeIssue({
        kind: "invalid",
        code: "example.openapi.type",
        instancePath: `${instancePath}/openapi`,
        message: "openapi must be a plain object",
      }));
    } else if (!Object.prototype.hasOwnProperty.call(example.openapi, "value") && example.request == null) {
      pushIssue(issues, makeIssue({
        kind: "partial",
        code: "example.openapi.value_missing",
        instancePath: `${instancePath}/openapi/value`,
        message: "openapi example has no value and no HTTP request",
      }));
    }
  }
  if (example.synthesizedResponse === true || example.response?.synthesized === true) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "example.synthesizedResponse",
      instancePath: `${instancePath}/synthesizedResponse`,
      message: "synthesizedResponse is refused; never fake provider execution",
    }));
  }
  if (example.execution != null) {
    issues.push(...validateExecution(example.execution, {
      instancePath: `${instancePath}/execution`,
      hasResponse: isPlainObject(example.response) || isPlainObject(example.openapi),
      packEvidenceClass,
    }));
  }
  if (example.replayMode != null && !REPLAY_MODE_SET.has(example.replayMode)) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "example.replayMode",
      instancePath: `${instancePath}/replayMode`,
      message: `replayMode must be one of ${REPLAY_MODES.join("|")}`,
    }));
  }
  if (example.coverage != null && !COVERAGE_SET.has(example.coverage)) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "example.coverage",
      instancePath: `${instancePath}/coverage`,
      message: `coverage must be one of ${COVERAGE.join("|")}`,
    }));
  }
  const coverage = coverageForExample(example);
  if (coverage === "missing") {
    pushIssue(issues, makeIssue({
      kind: "unknown",
      code: "example.coverage_missing",
      instancePath,
      message: "example has neither request nor recorded response/value",
    }));
  } else if (coverage === "partial") {
    pushIssue(issues, makeIssue({
      kind: "partial",
      code: "example.coverage_partial",
      instancePath,
      message: "example is missing request or recorded response; do not invent the missing side",
    }));
  }
  if (example.coverage != null && example.coverage !== coverage) {
    pushIssue(issues, makeIssue({
      kind: "conflict",
      code: "example.coverage_mismatch",
      instancePath: `${instancePath}/coverage`,
      message: "declared coverage does not match supplied request/response",
      params: { declared: example.coverage, computed: coverage },
    }));
  }
  return { issues, coverage };
}

function validateExecution(execution, { instancePath, hasResponse, packEvidenceClass }) {
  const issues = [];
  if (!isPlainObject(execution) || hasForbiddenKey(execution)) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "execution.type",
      instancePath,
      message: "execution must be a plain object",
    }));
    return issues;
  }
  if (execution.fakedProviderExecution === true) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "execution.faked",
      instancePath: `${instancePath}/fakedProviderExecution`,
      message: "fakedProviderExecution is refused",
    }));
  }
  if (execution.status != null && !EXECUTION_SET.has(execution.status)) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "execution.status",
      instancePath: `${instancePath}/status`,
      message: `execution.status must be one of ${EXECUTION_STATUSES.join("|")}`,
    }));
  }
  if (execution.status === "fixture-replay" && !hasResponse) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "execution.fixture_without_response",
      instancePath: `${instancePath}/status`,
      message: "fixture-replay requires a supplied recorded response or openapi.value",
    }));
  }
  if (execution.status === "live-capture") {
    if (packEvidenceClass !== "live-capture") {
      pushIssue(issues, makeIssue({
        kind: "conflict",
        code: "execution.live_without_class",
        instancePath: `${instancePath}/status`,
        message: "live-capture execution requires pack evidenceClass live-capture",
      }));
    }
    if (execution.providerInvoked === true) {
      pushIssue(issues, makeIssue({
        kind: "invalid",
        code: "execution.provider_invoked",
        instancePath: `${instancePath}/providerInvoked`,
        message: "schema/transform must not invoke the provider; live-capture is a labeled supplied snapshot",
      }));
    }
  }
  if (execution.providerInvoked === true && execution.status === "not-executed") {
    pushIssue(issues, makeIssue({
      kind: "conflict",
      code: "execution.invoked_not_executed",
      instancePath: `${instancePath}/providerInvoked`,
      message: "providerInvoked contradicts status not-executed",
    }));
  }
  return issues;
}

export function detectExampleConflicts(examples = []) {
  const issues = [];
  const byId = new Map();
  for (const [i, example] of examples.entries()) {
    if (!isPlainObject(example) || !isId(example.id)) continue;
    const fingerprint = sha256Hex({
      kind: example.kind ?? null,
      request: example.request ?? null,
      response: example.response ?? null,
      openapi: example.openapi ?? null,
    });
    const prev = byId.get(example.id);
    if (!prev) {
      byId.set(example.id, { index: i, fingerprint });
      continue;
    }
    if (prev.fingerprint === fingerprint) {
      pushIssue(issues, makeIssue({
        kind: "invalid",
        code: "examples.duplicate",
        instancePath: `/examples/${i}/id`,
        message: "duplicate example.id with identical payload",
        params: { id: example.id, firstIndex: prev.index },
      }));
    } else {
      pushIssue(issues, makeIssue({
        kind: "conflict",
        code: "examples.conflict",
        instancePath: `/examples/${i}/id`,
        message: "duplicate example.id with differing request/response",
        params: { id: example.id, firstIndex: prev.index },
      }));
    }
  }
  return issues;
}

function indexCitations(citations, issues, packEvidenceClass) {
  const map = new Map();
  if (!Array.isArray(citations)) return map;
  for (const [i, citation] of citations.entries()) {
    const path = `/citations/${i}`;
    issues.push(...validateCitation(citation, { instancePath: path, packEvidenceClass }));
    if (isPlainObject(citation) && isId(citation.id)) {
      if (map.has(citation.id)) {
        pushIssue(issues, makeIssue({
          kind: "conflict",
          code: "citations.duplicate",
          instancePath: `${path}/id`,
          message: "duplicate citation.id",
          params: { id: citation.id },
        }));
      } else {
        map.set(citation.id, citation);
      }
    }
  }
  return map;
}

function validateCommonDocument(raw, { schemaId, requireCitations }) {
  const issues = [];
  if (!isPlainObject(raw) || hasForbiddenKey(raw)) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "document.type",
      instancePath: "",
      message: "document must be a plain object",
    }));
    return { ok: false, status: "invalid", issues, citationMap: new Map() };
  }
  if (raw.schema !== schemaId) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "schema.const",
      instancePath: "/schema",
      message: `schema must be ${schemaId}`,
      params: { schema: raw.schema },
    }));
  }
  checkClock(raw.clock, issues);
  checkEvidenceClass(raw.evidenceClass, issues);
  if (!Array.isArray(raw.examples)) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "examples.type",
      instancePath: "/examples",
      message: "examples must be an array",
    }));
  } else if (raw.examples.length === 0) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "examples.minItems",
      instancePath: "/examples",
      message: "examples must contain at least one supplied official or synthetic example",
    }));
  } else if (raw.examples.length > MAX_EXAMPLES) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "examples.maxItems",
      instancePath: "/examples",
      message: `examples exceeds ${MAX_EXAMPLES}`,
    }));
  }
  if (requireCitations && !Array.isArray(raw.citations)) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "citations.type",
      instancePath: "/citations",
      message: "citations must be an array",
    }));
  } else if (Array.isArray(raw.citations) && raw.citations.length > MAX_CITATIONS) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "citations.maxItems",
      instancePath: "/citations",
      message: `citations exceeds ${MAX_CITATIONS}`,
    }));
  }
  const citationMap = Array.isArray(raw.citations)
    ? indexCitations(raw.citations, issues, raw.evidenceClass)
    : new Map();
  const citationIds = new Set(citationMap.keys());
  const coverages = [];
  if (Array.isArray(raw.examples)) {
    for (const [i, example] of raw.examples.entries()) {
      if (issues.length >= MAX_ISSUES) break;
      const result = validateExample(example, {
        instancePath: `/examples/${i}`,
        citationIds,
        packEvidenceClass: raw.evidenceClass,
      });
      issues.push(...result.issues);
      coverages.push(result.coverage);
    }
    issues.push(...detectExampleConflicts(raw.examples));
  }
  issues.push(...validateOnlineBlock(raw.online, { examples: Array.isArray(raw.examples) ? raw.examples : [] }));
  return { issues, citationMap, citationIds, coverages };
}

export function validateReplayPackInput(raw) {
  const collected = validateCommonDocument(raw, { schemaId: INPUT_SCHEMA, requireCitations: true });
  if (!isPlainObject(raw)) {
    return finishValidation(collected.issues, { input: raw });
  }
  return finishValidation(collected.issues, {
    input: raw,
    citationIds: collected.citationIds,
    coverages: collected.coverages,
  });
}

export function validateReplayPackOutput(raw) {
  const collected = validateCommonDocument(raw, { schemaId: OUTPUT_SCHEMA, requireCitations: true });
  const issues = collected.issues;
  if (!isPlainObject(raw)) {
    return finishValidation(issues, { input: raw });
  }
  if (raw.packetSchema != null && raw.packetSchema !== PACKET_SCHEMA) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "packetSchema.const",
      instancePath: "/packetSchema",
      message: `packetSchema must be ${PACKET_SCHEMA}`,
    }));
  }
  if (raw.jobId != null && raw.jobId !== JOB_ID) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "jobId.const",
      instancePath: "/jobId",
      message: `jobId must be ${JOB_ID}`,
    }));
  }
  if (raw.artifactKind != null && raw.artifactKind !== ARTIFACT_KIND) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "artifactKind.const",
      instancePath: "/artifactKind",
      message: `artifactKind must be ${ARTIFACT_KIND}`,
    }));
  }
  if (raw.offline !== true) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "offline.const",
      instancePath: "/offline",
      message: "replay pack documents are offline:true; live work is a labeled snapshot, not an online session",
    }));
  }
  if (!isPlainObject(raw.payment) || raw.payment.attempted !== false) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "payment.attempted",
      instancePath: "/payment/attempted",
      message: "payment.attempted must be false",
    }));
  }
  if (!isPlainObject(raw.cost) || raw.cost.assignmentSpendUsd !== 0) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "cost.assignmentSpendUsd",
      instancePath: "/cost/assignmentSpendUsd",
      message: "assignmentSpendUsd must be 0; this pack does not spend",
    }));
  }
  if (!DECISION_SET.has(raw.decision)) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "decision.enum",
      instancePath: "/decision",
      message: `decision must be one of ${DECISIONS.join("|")}`,
    }));
  }
  if (!isPlainObject(raw.claims)) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "claims.type",
      instancePath: "/claims",
      message: "claims must be an object",
    }));
  } else {
    for (const [key, expected] of Object.entries(DEFAULT_CLAIMS)) {
      if (raw.claims[key] !== expected) {
        pushIssue(issues, makeIssue({
          kind: "invalid",
          code: `claims.${key}`,
          instancePath: `/claims/${key}`,
          message: `claims.${key} must be ${expected}`,
        }));
      }
    }
  }
  if (Array.isArray(raw.findings)) {
    if (raw.findings.length > MAX_FINDINGS) {
      pushIssue(issues, makeIssue({
        kind: "invalid",
        code: "findings.maxItems",
        instancePath: "/findings",
        message: `findings exceeds ${MAX_FINDINGS}`,
      }));
    }
    for (const [i, finding] of raw.findings.entries()) {
      issues.push(...validateFinding(finding, {
        citationIds: collected.citationIds || new Set(),
        instancePath: `/findings/${i}`,
      }));
    }
  } else if (raw.findings != null) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "findings.type",
      instancePath: "/findings",
      message: "findings must be an array",
    }));
  }
  if (!Array.isArray(raw.limitations) || raw.limitations.length === 0) {
    pushIssue(issues, makeIssue({
      kind: "partial",
      code: "limitations.minItems",
      instancePath: "/limitations",
      message: "output should list explicit limitations",
    }));
  }
  issues.push(...assertNoFakedExecution(raw));
  if (raw.decision === "pass" && issues.some((row) => row.kind === "conflict" || row.kind === "invalid")) {
    pushIssue(issues, makeIssue({
      kind: "conflict",
      code: "decision.pass_with_defects",
      instancePath: "/decision",
      message: "decision pass contradicts invalid or conflict issues",
    }));
  }
  return finishValidation(issues, {
    input: raw,
    citationIds: collected.citationIds,
    coverages: collected.coverages,
  });
}

export function assertNoFakedExecution(pack = {}) {
  const issues = [];
  const examples = Array.isArray(pack.examples) ? pack.examples : [];
  for (const [i, example] of examples.entries()) {
    if (!isPlainObject(example)) continue;
    if (example.synthesizedResponse === true) {
      pushIssue(issues, makeIssue({
        kind: "invalid",
        code: "example.synthesizedResponse",
        instancePath: `/examples/${i}/synthesizedResponse`,
        message: "synthesizedResponse is refused",
      }));
    }
    if (example.execution?.fakedProviderExecution === true) {
      pushIssue(issues, makeIssue({
        kind: "invalid",
        code: "execution.faked",
        instancePath: `/examples/${i}/execution/fakedProviderExecution`,
        message: "fakedProviderExecution is refused",
      }));
    }
  }
  if (pack.claims?.inventsFacts === true) {
    pushIssue(issues, makeIssue({
      kind: "invalid",
      code: "claims.inventsFacts",
      instancePath: "/claims/inventsFacts",
      message: "inventsFacts must remain false",
    }));
  }
  return issues;
}

function finishValidation(issues, extra = {}) {
  const status = statusFromIssues(issues);
  return {
    ok: status === "ok" || status === "partial",
    status,
    suggestedDecision: suggestedDecision(status),
    issues,
    onlineReplayAllowed: extra.input ? onlineReplayAllowed(extra.input.online) : false,
    ...extra,
  };
}

export function createReplayPackEnvelope({
  clock,
  evidenceClass = "synthetic",
  sources = [],
  findings = [],
  citations = [],
  decision = "unknown",
  limitations = SCHEMA_LIMITATIONS,
  examples = [],
  online = defaultOnline(),
} = {}) {
  const envelope = createEnvelope({
    jobId: JOB_ID,
    artifactKind: ARTIFACT_KIND,
    clock,
    evidenceClass,
    sources,
    findings,
    decision,
    limitations,
    citations,
  });
  return {
    ...envelope,
    schema: OUTPUT_SCHEMA,
    packetSchema: PACKET_SCHEMA,
    examples,
    online,
    summary: {
      exampleCount: examples.length,
      fullCount: examples.filter((row) => coverageForExample(row) === "full").length,
      partialCount: examples.filter((row) => coverageForExample(row) === "partial").length,
      missingCount: examples.filter((row) => coverageForExample(row) === "missing").length,
      onlineReplayAllowed: onlineReplayAllowed(online),
    },
  };
}

export function selfCheck() {
  const { positiveInput, negativeInputs, partialInput, conflictInput } = selfCheckFixtures();
  const pos = validateReplayPackInput(positiveInput);
  if (!pos.ok || pos.status !== "ok") {
    throw new Error(`positive input failed: ${JSON.stringify(pos.issues)}`);
  }
  if (pos.onlineReplayAllowed !== false) {
    throw new Error("positive offline input must not allow online replay");
  }
  for (const [name, doc] of Object.entries(negativeInputs)) {
    const result = validateReplayPackInput(doc);
    if (result.status !== "invalid") {
      throw new Error(`negative ${name} expected invalid, got ${result.status}`);
    }
  }
  const partial = validateReplayPackInput(partialInput);
  if (partial.status !== "partial") {
    throw new Error(`partial expected partial, got ${partial.status}: ${JSON.stringify(partial.issues)}`);
  }
  const conflict = validateReplayPackInput(conflictInput);
  if (conflict.status !== "conflict") {
    throw new Error(`conflict expected conflict, got ${conflict.status}: ${JSON.stringify(conflict.issues)}`);
  }
  const output = createReplayPackEnvelope({
    clock: positiveInput.clock,
    evidenceClass: "synthetic",
    citations: positiveInput.citations,
    examples: [{
      ...positiveInput.examples[0],
      coverage: "full",
      replayMode: "offline-fixture",
      execution: defaultExecution(),
    }],
    findings: [
      makeFinding({
        id: "f-positive",
        kind: "positive",
        code: "example.full",
        message: "supplied request and recorded response",
        citationIds: ["cit-widget"],
        exampleId: "widget-get",
      }),
    ],
    decision: "pass",
    online: defaultOnline(),
  });
  const out = validateReplayPackOutput(output);
  if (!out.ok) {
    throw new Error(`positive output failed: ${JSON.stringify(out.issues)}`);
  }
  return { ok: true, tests: 6 };
}

export function selfCheckFixtures() {
  const body = { id: "1", name: "widget" };
  const content = canonicalJson({
    request: { method: "GET", url: "https://example.invalid/v1/widgets/1" },
    response: { status: 200, body },
  });
  const sha = sha256Hex(content);
  const citations = [
    makeCitation({
      id: "cit-widget",
      path: "cells/c21/inline-synthetic-widget.json",
      sha256: sha,
      licenseNote: "synthetic fixture; not an official provider capture",
      evidenceClass: "synthetic",
      content,
    }),
  ];
  const example = {
    id: "widget-get",
    kind: "http-exchange",
    citationIds: ["cit-widget"],
    request: {
      method: "GET",
      url: "https://example.invalid/v1/widgets/1",
      headers: { accept: "application/json" },
    },
    response: {
      status: 200,
      headers: { "content-type": "application/json" },
      body,
    },
  };
  const positiveInput = {
    schema: INPUT_SCHEMA,
    clock: "2026-09-10T00:00:00.000Z",
    evidenceClass: "synthetic",
    citations,
    examples: [example],
    online: defaultOnline(),
  };
  const negativeInputs = {
    missingClock: { ...positiveInput, clock: undefined },
    inventedClock: { ...positiveInput, clock: "now" },
    emptyExamples: { ...positiveInput, examples: [] },
    uncitedFindingExample: {
      ...positiveInput,
      examples: [{ ...example, citationIds: [] }],
    },
    secretHeader: {
      ...positiveInput,
      examples: [{
        ...example,
        request: {
          ...example.request,
          headers: { authorization: "Bearer super-secret" },
        },
      }],
    },
    synthesized: {
      ...positiveInput,
      examples: [{ ...example, synthesizedResponse: true }],
    },
    paidSatisfied: {
      ...positiveInput,
      online: {
        requested: true,
        consent: true,
        allowlistedUrls: ["https://example.invalid/v1/widgets/1"],
        prereqs: [
          ...requiredOnlinePrereqs().map((row) => ({ ...row, satisfied: true })),
          makeOnlinePrereq({
            id: "paid",
            kind: "paid-endpoint",
            satisfied: true,
            note: "illegal: paid endpoints cannot be satisfied",
          }),
        ],
      },
    },
  };
  const partialInput = {
    ...positiveInput,
    examples: [{
      id: "widget-get",
      kind: "http-exchange",
      citationIds: ["cit-widget"],
      request: example.request,
    }],
  };
  const conflictInput = {
    ...positiveInput,
    examples: [
      example,
      {
        ...example,
        response: { status: 404, body: { error: "missing" } },
      },
    ],
  };
  return { positiveInput, negativeInputs, partialInput, conflictInput };
}

const isMain =
  Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain && process.argv.includes("--self-check")) {
  const result = selfCheck();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
