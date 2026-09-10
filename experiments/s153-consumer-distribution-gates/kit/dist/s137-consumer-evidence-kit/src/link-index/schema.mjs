#!/usr/bin/env node
/**
 * c16 schema for R2-CONSUMER-JOBS-04 (link/artifact citation index).
 *
 * Shapes only. Does not parse HTML/Markdown (c17), does not write fixtures
 * (c18/c19), and does not own the family test file (c20). Offline: reachability
 * is against a caller-supplied inventory, never a network fetch.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isIsoClock } from "../common/clock.mjs";
import { isSha256Hex, sha256Hex } from "../common/hash.mjs";
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

export const JOB_ID = "R2-CONSUMER-JOBS-04";
export const ARTIFACT_KIND = "link-index";
export const INPUT_SCHEMA = "s137.link-index.input.v1";
export const OUTPUT_SCHEMA = "s137.link-index.output.v1";
export const CELL_ID = "c16";

export const DOCUMENT_KINDS = Object.freeze(["html", "markdown"]);
export const LINK_KINDS = Object.freeze([
  "html_a",
  "html_img",
  "html_link",
  "markdown_inline",
  "markdown_reference",
  "markdown_autolink",
  "markdown_shortcut",
  "fragment",
]);
export const TARGET_STATUSES = Object.freeze([
  "reachable",
  "unreachable",
  "unknown",
  "conflict",
]);
export const HREF_SCHEMES = Object.freeze([
  "relative",
  "fragment",
  "http",
  "https",
  "file",
  "mailto",
  "data",
  "javascript",
  "protocol-relative",
  "empty",
  "unknown",
]);
export const FINDING_KINDS = Object.freeze([
  "reachable",
  "unreachable_target",
  "duplicate_href",
  "missing_fragment",
  "conflicting_target",
  "unknown_external",
  "truncated_bound",
  "empty_href",
  "hostile_scheme",
  "hash_mismatch",
  "missing_body",
]);
export const DUPLICATE_MATCH_KINDS = Object.freeze(["exact_href", "normalized_href"]);
export const CASE_KINDS = Object.freeze(["positive", "negative", "partial", "conflict"]);
export const UNREACHABLE_REASONS = Object.freeze([
  "missing_artifact",
  "missing_fragment",
  "empty_href",
]);
export const MEDIA_TYPES = Object.freeze({
  html: Object.freeze(["text/html"]),
  markdown: Object.freeze(["text/markdown", "text/x-markdown"]),
});

export const BOUNDS = Object.freeze({
  maxDocuments: 32,
  maxLinks: 512,
  maxBodyBytes: 262144,
  maxArtifacts: 256,
  maxCitations: 512,
  maxFindings: 512,
  maxPathChars: 4096,
  maxHrefChars: 2048,
  maxIdChars: 128,
  maxMessageChars: 1024,
});

const ID_RE = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const HOSTILE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export const LIMITATIONS = Object.freeze([
  "Does not parse HTML or Markdown; c17 owns the transform.",
  "Does not fetch URLs, follow redirects, or resolve DNS.",
  "Reachability is only against caller-supplied artifacts[] / documents[].",
  "Does not invent operator clock, retrievedAt, license, or content hashes.",
  "Does not read the filesystem; missing body is unknown, not a probe.",
  "javascript: hrefs are hostile and invalid; data: hrefs stay unknown.",
  "Href identity is the exact written string unless a duplicate record names a match kind.",
  "Pass is forbidden when unreachable, conflict, unknown, or truncated coverage is present.",
]);

const PACK_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export { sha256Hex, isSha256Hex, isIsoClock };

function citePackFile(relPath, note) {
  const abs = join(PACK_ROOT, relPath);
  try {
    const buf = readFileSync(abs);
    return {
      path: relPath,
      sha256: sha256Hex(buf),
      present: true,
      note,
    };
  } catch {
    return { path: relPath, sha256: null, present: false, note };
  }
}

export const SCHEMA_SOURCE_CITES = Object.freeze({
  jobOutcome: citePackFile(
    "docs/OWNED-JOBS-01-06.json",
    "R2-CONSUMER-JOBS-04 outcome: bounded citation index from supplied HTML/Markdown with exact source anchors, unreachable targets and duplicates.",
  ),
  packet: citePackFile(
    "src/packet.mjs",
    "Shared envelope: evidenceClass, citations[], findings.citationIds, offline/no-spend claims.",
  ),
  concurrency: citePackFile(
    "CONCURRENCY-GRAPH.md",
    "c16 owns src/link-index/schema.mjs; c17 transform; c18/c19 fixtures; c20 tests.",
  ),
});

export const FIELD_CITES = Object.freeze({
  documents: {
    field: "documents",
    cites: "supplied HTML/Markdown",
    citationId: "jobOutcome",
  },
  anchors: {
    field: "anchors",
    cites: "exact source anchors",
    citationId: "jobOutcome",
  },
  unreachable: {
    field: "unreachable",
    cites: "unreachable targets",
    citationId: "jobOutcome",
  },
  duplicates: {
    field: "duplicates",
    cites: "duplicates",
    citationId: "jobOutcome",
  },
  bounds: {
    field: "bounds",
    cites: "bounded citation index",
    citationId: "jobOutcome",
  },
  citations: {
    field: "citations",
    cites: "every finding needs citationIds into citations[] with source path/url + content hash",
    citationId: "packet",
  },
  evidenceClass: {
    field: "evidenceClass",
    cites: "synthetic | fixture | live-capture",
    citationId: "packet",
  },
});

export function makeIssue({
  kind,
  code,
  keyword,
  instancePath,
  schemaPath,
  message,
  params = {},
}) {
  return {
    kind,
    code,
    keyword: keyword || code,
    instancePath,
    schemaPath: schemaPath || `#${instancePath}`,
    message,
    params,
  };
}



export function isSchemaId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= BOUNDS.maxIdChars && ID_RE.test(value);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasHostileKey(value) {
  if (!isPlainObject(value) && !Array.isArray(value)) return false;
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      if (HOSTILE_KEYS.has(key)) return true;
    }
  }
  return false;
}

function pushType(issues, instancePath, expected, value) {
  issues.push(
    makeIssue({
      kind: "invalid",
      code: "type",
      keyword: "type",
      instancePath,
      message: `expected ${expected}`,
      params: { expected, actual: value === null ? "null" : Array.isArray(value) ? "array" : typeof value },
    }),
  );
}

function requireString(issues, instancePath, value, { min = 1, max = BOUNDS.maxIdChars, pattern } = {}) {
  if (typeof value !== "string") {
    pushType(issues, instancePath, "string", value);
    return false;
  }
  if (value.length < min) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "minLength",
        keyword: "minLength",
        instancePath,
        message: `length ${value.length} < ${min}`,
        params: { min },
      }),
    );
    return false;
  }
  if (value.length > max) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "maxLength",
        keyword: "maxLength",
        instancePath,
        message: `length ${value.length} > ${max}`,
        params: { max },
      }),
    );
    return false;
  }
  if (value.includes("\0")) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "nul",
        keyword: "pattern",
        instancePath,
        message: "NUL is not allowed",
      }),
    );
    return false;
  }
  if (pattern && !pattern.test(value)) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "pattern",
        keyword: "pattern",
        instancePath,
        message: "value does not match required pattern",
      }),
    );
    return false;
  }
  return true;
}

function requireEnum(issues, instancePath, value, allowed) {
  if (typeof value !== "string" || !allowed.includes(value)) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "enum",
        keyword: "enum",
        instancePath,
        message: `expected one of ${allowed.join("|")}`,
        params: { allowed, actual: value },
      }),
    );
    return false;
  }
  return true;
}

function requireInt(issues, instancePath, value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    pushType(issues, instancePath, "integer", value);
    return false;
  }
  if (value < min || value > max) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "minimum",
        keyword: "minimum",
        instancePath,
        message: `expected integer in [${min}, ${max}]`,
        params: { min, max, actual: value },
      }),
    );
    return false;
  }
  return true;
}

function statusOf(issues) {
  if (issues.some((row) => row.kind === "invalid")) return "invalid";
  if (issues.some((row) => row.kind === "unknown")) return "unknown";
  return "ok";
}

export function classifyHrefScheme(href) {
  if (typeof href !== "string") {
    return { scheme: "unknown", statusHint: "invalid", code: "type" };
  }
  if (href.length === 0) {
    return { scheme: "empty", statusHint: "unreachable", code: "empty_href" };
  }
  if (href.length > BOUNDS.maxHrefChars) {
    return { scheme: "unknown", statusHint: "invalid", code: "maxLength" };
  }
  if (href.includes("\0")) {
    return { scheme: "unknown", statusHint: "invalid", code: "nul" };
  }
  if (href.startsWith("#")) return { scheme: "fragment", statusHint: "unknown" };
  if (href.startsWith("//")) {
    return { scheme: "protocol-relative", statusHint: "unknown", code: "no_fetch" };
  }
  const matched = href.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (!matched) return { scheme: "relative", statusHint: "unknown" };
  const scheme = matched[1].toLowerCase();
  if (scheme === "javascript") {
    return { scheme, statusHint: "invalid", code: "hostile_scheme" };
  }
  if (scheme === "data") return { scheme, statusHint: "unknown", code: "no_fetch" };
  if (scheme === "http" || scheme === "https") {
    return { scheme, statusHint: "unknown", code: "no_fetch" };
  }
  if (scheme === "file" || scheme === "mailto") {
    return { scheme, statusHint: "unknown" };
  }
  return { scheme: "unknown", statusHint: "unknown", rawScheme: scheme };
}

export function exactHrefKey(href) {
  return typeof href === "string" ? href : null;
}

function locatorOk(pathValue, urlValue) {
  return (
    (typeof pathValue === "string" && pathValue.length > 0) ||
    (typeof urlValue === "string" && urlValue.length > 0)
  );
}

function validateLocator(issues, basePath, record) {
  if (record.path !== undefined) {
    requireString(issues, `${basePath}/path`, record.path, { max: BOUNDS.maxPathChars });
  }
  if (record.url !== undefined) {
    requireString(issues, `${basePath}/url`, record.url, { max: BOUNDS.maxHrefChars });
  }
  if (!locatorOk(record.path, record.url)) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "locator",
        keyword: "anyOf",
        instancePath: basePath,
        message: "path or url is required",
      }),
    );
    return false;
  }
  return true;
}

export function validateCitation(citation, { instancePath = "/citations/0", ids } = {}) {
  const issues = [];
  if (!isPlainObject(citation) || hasHostileKey(citation)) {
    pushType(issues, instancePath, "object", citation);
    return { ok: false, status: "invalid", issues };
  }
  if (requireString(issues, `${instancePath}/id`, citation.id, { pattern: ID_RE })) {
    if (ids) {
      if (ids.has(citation.id)) {
        issues.push(
          makeIssue({
            kind: "invalid",
            code: "unique",
            keyword: "uniqueItems",
            instancePath: `${instancePath}/id`,
            message: `duplicate citation id ${citation.id}`,
            params: { id: citation.id },
          }),
        );
      } else ids.add(citation.id);
    }
  }
  validateLocator(issues, instancePath, citation);
  if (citation.contentSha256 !== undefined && !isSha256Hex(citation.contentSha256)) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "contentSha256",
        keyword: "pattern",
        instancePath: `${instancePath}/contentSha256`,
        message: "contentSha256 must be 64 lowercase hex chars when present",
      }),
    );
  }
  if (citation.retrievedAt !== undefined && !isIsoClock(citation.retrievedAt)) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "retrievedAt",
        keyword: "format",
        instancePath: `${instancePath}/retrievedAt`,
        message: "retrievedAt must be operator-supplied ISO-8601; do not invent",
      }),
    );
  }
  if (citation.evidenceClass !== undefined) {
    requireEnum(issues, `${instancePath}/evidenceClass`, citation.evidenceClass, EVIDENCE_CLASSES);
  }
  if (citation.licenseNote !== undefined) {
    requireString(issues, `${instancePath}/licenseNote`, citation.licenseNote, {
      min: 1,
      max: BOUNDS.maxMessageChars,
    });
  }
  const status = statusOf(issues);
  return { ok: status === "ok", status, issues };
}

export function validateFinding(finding, { instancePath = "/findings/0", citationIds } = {}) {
  const issues = [];
  if (!isPlainObject(finding) || hasHostileKey(finding)) {
    pushType(issues, instancePath, "object", finding);
    return { ok: false, status: "invalid", issues };
  }
  requireString(issues, `${instancePath}/id`, finding.id, { pattern: ID_RE });
  requireEnum(issues, `${instancePath}/kind`, finding.kind, FINDING_KINDS);
  requireString(issues, `${instancePath}/message`, finding.message, {
    max: BOUNDS.maxMessageChars,
  });
  if (!Array.isArray(finding.citationIds) || finding.citationIds.length === 0) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "citationIds",
        keyword: "minItems",
        instancePath: `${instancePath}/citationIds`,
        message: "every finding must cite at least one citationId",
      }),
    );
  } else {
    for (let i = 0; i < finding.citationIds.length; i += 1) {
      const cid = finding.citationIds[i];
      if (!requireString(issues, `${instancePath}/citationIds/${i}`, cid, { pattern: ID_RE })) continue;
      if (citationIds && !citationIds.has(cid)) {
        issues.push(
          makeIssue({
            kind: "invalid",
            code: "dangling_citation",
            keyword: "enum",
            instancePath: `${instancePath}/citationIds/${i}`,
            message: `citationId ${cid} is not in citations[]`,
            params: { citationId: cid },
          }),
        );
      }
    }
  }
  if (finding.linkIds !== undefined) {
    if (!Array.isArray(finding.linkIds)) pushType(issues, `${instancePath}/linkIds`, "array", finding.linkIds);
    else {
      for (let i = 0; i < finding.linkIds.length; i += 1) {
        requireString(issues, `${instancePath}/linkIds/${i}`, finding.linkIds[i], { pattern: ID_RE });
      }
    }
  }
  const status = statusOf(issues);
  return { ok: status === "ok", status, issues };
}

function validateDocument(doc, { instancePath, ids, maxBodyBytes }) {
  const issues = [];
  if (!isPlainObject(doc) || hasHostileKey(doc)) {
    pushType(issues, instancePath, "object", doc);
    return issues;
  }
  if (requireString(issues, `${instancePath}/id`, doc.id, { pattern: ID_RE }) && ids) {
    if (ids.has(doc.id)) {
      issues.push(
        makeIssue({
          kind: "invalid",
          code: "unique",
          keyword: "uniqueItems",
          instancePath: `${instancePath}/id`,
          message: `duplicate document id ${doc.id}`,
        }),
      );
    } else ids.add(doc.id);
  }
  requireEnum(issues, `${instancePath}/kind`, doc.kind, DOCUMENT_KINDS);
  if (!locatorOk(doc.path, doc.url)) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "locator",
        keyword: "anyOf",
        instancePath,
        message: "document needs path or url",
      }),
    );
  } else {
    if (doc.path !== undefined) requireString(issues, `${instancePath}/path`, doc.path, { max: BOUNDS.maxPathChars });
    if (doc.url !== undefined) requireString(issues, `${instancePath}/url`, doc.url, { max: BOUNDS.maxHrefChars });
  }
  if (doc.mediaType !== undefined) {
    const allowed = MEDIA_TYPES[doc.kind] || [];
    if (typeof doc.mediaType !== "string" || !allowed.includes(doc.mediaType)) {
      issues.push(
        makeIssue({
          kind: "invalid",
          code: "mediaType",
          keyword: "enum",
          instancePath: `${instancePath}/mediaType`,
          message: "mediaType must match document kind when present",
          params: { kind: doc.kind, mediaType: doc.mediaType },
        }),
      );
    }
  }
  if (doc.body === undefined || doc.body === null) {
    issues.push(
      makeIssue({
        kind: "unknown",
        code: "missing_body",
        keyword: "required",
        instancePath: `${instancePath}/body`,
        message: "body not supplied; schema does not read disk; document is unknown until body is provided",
      }),
    );
  } else if (typeof doc.body !== "string") {
    pushType(issues, `${instancePath}/body`, "string", doc.body);
  } else {
    const bytes = Buffer.byteLength(doc.body, "utf8");
    if (bytes > maxBodyBytes) {
      issues.push(
        makeIssue({
          kind: "invalid",
          code: "maxBodyBytes",
          keyword: "maxLength",
          instancePath: `${instancePath}/body`,
          message: `body ${bytes} bytes exceeds bound ${maxBodyBytes}`,
          params: { bytes, maxBodyBytes },
        }),
      );
    }
    if (doc.contentSha256 !== undefined) {
      if (!isSha256Hex(doc.contentSha256)) {
        issues.push(
          makeIssue({
            kind: "invalid",
            code: "contentSha256",
            keyword: "pattern",
            instancePath: `${instancePath}/contentSha256`,
            message: "contentSha256 must be 64 lowercase hex chars when present",
          }),
        );
      } else if (sha256Hex(doc.body) !== doc.contentSha256) {
        issues.push(
          makeIssue({
            kind: "invalid",
            code: "hash_mismatch",
            keyword: "const",
            instancePath: `${instancePath}/contentSha256`,
            message: "contentSha256 does not match utf8 sha256 of supplied body",
          }),
        );
      }
    }
  }
  if (doc.headingIds !== undefined) {
    if (!Array.isArray(doc.headingIds)) pushType(issues, `${instancePath}/headingIds`, "array", doc.headingIds);
    else {
      for (let i = 0; i < doc.headingIds.length; i += 1) {
        requireString(issues, `${instancePath}/headingIds/${i}`, doc.headingIds[i], { max: BOUNDS.maxIdChars });
      }
    }
  }
  return issues;
}

function validateArtifact(art, { instancePath, ids, pathHashes }) {
  const issues = [];
  if (!isPlainObject(art) || hasHostileKey(art)) {
    pushType(issues, instancePath, "object", art);
    return issues;
  }
  if (requireString(issues, `${instancePath}/id`, art.id, { pattern: ID_RE }) && ids) {
    if (ids.has(art.id)) {
      issues.push(
        makeIssue({
          kind: "invalid",
          code: "unique",
          keyword: "uniqueItems",
          instancePath: `${instancePath}/id`,
          message: `duplicate artifact id ${art.id}`,
        }),
      );
    } else ids.add(art.id);
  }
  validateLocator(issues, instancePath, art);
  if (art.contentSha256 !== undefined && !isSha256Hex(art.contentSha256)) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "contentSha256",
        keyword: "pattern",
        instancePath: `${instancePath}/contentSha256`,
        message: "contentSha256 must be 64 lowercase hex chars when present",
      }),
    );
  }
  if (art.exists !== undefined && typeof art.exists !== "boolean") {
    pushType(issues, `${instancePath}/exists`, "boolean", art.exists);
  }
  if (art.fragment !== undefined) {
    requireString(issues, `${instancePath}/fragment`, art.fragment, { max: BOUNDS.maxIdChars });
  }
  const key = `${art.path ?? ""}|${art.url ?? ""}|${art.fragment ?? ""}`;
  if (art.contentSha256 && pathHashes) {
    const prior = pathHashes.get(key);
    if (prior && prior !== art.contentSha256) {
      issues.push(
        makeIssue({
          kind: "unknown",
          code: "artifact_hash_conflict",
          keyword: "const",
          instancePath,
          message: "same locator supplied with different contentSha256; do not pick a winner",
          params: { locator: key, hashes: [prior, art.contentSha256] },
        }),
      );
    } else pathHashes.set(key, art.contentSha256);
  }
  return issues;
}

export function validateInput(input) {
  const issues = [];
  if (!isPlainObject(input) || hasHostileKey(input)) {
    pushType(issues, "", input);
    return { ok: false, status: "invalid", issues };
  }
  if (input.schema !== undefined && input.schema !== INPUT_SCHEMA) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "schema",
        keyword: "const",
        instancePath: "/schema",
        message: `schema must be ${INPUT_SCHEMA} when present`,
        params: { expected: INPUT_SCHEMA, actual: input.schema },
      }),
    );
  }
  if (input.clock === undefined) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "clock",
        keyword: "required",
        instancePath: "/clock",
        message: "clock required (operator-supplied; do not invent)",
      }),
    );
  } else if (input.clock === "now" || input.clock === "NOW") {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "clock_now",
        keyword: "format",
        instancePath: "/clock",
        message: '"now" is refused; supply an ISO-8601 clock',
      }),
    );
  } else if (!isIsoClock(input.clock)) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "clock",
        keyword: "format",
        instancePath: "/clock",
        message: "clock must be ISO-8601 with Z or numeric offset",
      }),
    );
  }
  if (input.evidenceClass === undefined) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "evidenceClass",
        keyword: "required",
        instancePath: "/evidenceClass",
        message: `evidenceClass must be one of ${EVIDENCE_CLASSES.join("|")}`,
      }),
    );
  } else {
    requireEnum(issues, "/evidenceClass", input.evidenceClass, EVIDENCE_CLASSES);
  }
  if (input.caseKind !== undefined) {
    requireEnum(issues, "/caseKind", input.caseKind, CASE_KINDS);
  }

  let maxDocuments = BOUNDS.maxDocuments;
  let maxBodyBytes = BOUNDS.maxBodyBytes;
  if (input.bounds !== undefined) {
    if (!isPlainObject(input.bounds) || hasHostileKey(input.bounds)) {
      pushType(issues, "/bounds", "object", input.bounds);
    } else {
      if (input.bounds.maxDocuments !== undefined) {
        if (requireInt(issues, "/bounds/maxDocuments", input.bounds.maxDocuments, { min: 1, max: BOUNDS.maxDocuments })) {
          maxDocuments = input.bounds.maxDocuments;
        }
      }
      if (input.bounds.maxLinks !== undefined) {
        requireInt(issues, "/bounds/maxLinks", input.bounds.maxLinks, { min: 1, max: BOUNDS.maxLinks });
      }
      if (input.bounds.maxBodyBytes !== undefined) {
        if (requireInt(issues, "/bounds/maxBodyBytes", input.bounds.maxBodyBytes, { min: 1, max: BOUNDS.maxBodyBytes })) {
          maxBodyBytes = input.bounds.maxBodyBytes;
        }
      }
    }
  }

  if (!Array.isArray(input.documents)) {
    pushType(issues, "/documents", "array", input.documents);
  } else if (input.documents.length === 0) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "minItems",
        keyword: "minItems",
        instancePath: "/documents",
        message: "at least one supplied HTML/Markdown document is required",
      }),
    );
  } else if (input.documents.length > maxDocuments) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "maxDocuments",
        keyword: "maxItems",
        instancePath: "/documents",
        message: `documents ${input.documents.length} exceed bound ${maxDocuments}`,
        params: { count: input.documents.length, maxDocuments },
      }),
    );
  } else {
    const ids = new Set();
    for (let i = 0; i < input.documents.length; i += 1) {
      issues.push(...validateDocument(input.documents[i], { instancePath: `/documents/${i}`, ids, maxBodyBytes }));
    }
  }

  if (input.artifacts !== undefined) {
    if (!Array.isArray(input.artifacts)) {
      pushType(issues, "/artifacts", "array", input.artifacts);
    } else if (input.artifacts.length > BOUNDS.maxArtifacts) {
      issues.push(
        makeIssue({
          kind: "invalid",
          code: "maxArtifacts",
          keyword: "maxItems",
          instancePath: "/artifacts",
          message: `artifacts ${input.artifacts.length} exceed bound ${BOUNDS.maxArtifacts}`,
        }),
      );
    } else {
      const ids = new Set();
      const pathHashes = new Map();
      for (let i = 0; i < input.artifacts.length; i += 1) {
        issues.push(...validateArtifact(input.artifacts[i], { instancePath: `/artifacts/${i}`, ids, pathHashes }));
      }
    }
  }

  const status = statusOf(issues);
  return { ok: status === "ok", status, issues };
}

function collectIds(items, field = "id") {
  const ids = new Set();
  if (!Array.isArray(items)) return ids;
  for (const item of items) {
    if (isPlainObject(item) && typeof item[field] === "string") ids.add(item[field]);
  }
  return ids;
}

function validateAnchor(anchor, { instancePath, documentIds, ids }) {
  const issues = [];
  if (!isPlainObject(anchor) || hasHostileKey(anchor)) {
    pushType(issues, instancePath, "object", anchor);
    return issues;
  }
  if (requireString(issues, `${instancePath}/id`, anchor.id, { pattern: ID_RE }) && ids) {
    if (ids.has(anchor.id)) {
      issues.push(
        makeIssue({
          kind: "invalid",
          code: "unique",
          keyword: "uniqueItems",
          instancePath: `${instancePath}/id`,
          message: `duplicate anchor id ${anchor.id}`,
        }),
      );
    } else ids.add(anchor.id);
  }
  if (requireString(issues, `${instancePath}/documentId`, anchor.documentId, { pattern: ID_RE })) {
    if (documentIds && !documentIds.has(anchor.documentId)) {
      issues.push(
        makeIssue({
          kind: "invalid",
          code: "dangling_document",
          keyword: "enum",
          instancePath: `${instancePath}/documentId`,
          message: `documentId ${anchor.documentId} is not in documents[]`,
        }),
      );
    }
  }
  requireInt(issues, `${instancePath}/startOffset`, anchor.startOffset, { min: 0 });
  requireInt(issues, `${instancePath}/endOffset`, anchor.endOffset, { min: 0 });
  if (
    Number.isInteger(anchor.startOffset) &&
    Number.isInteger(anchor.endOffset) &&
    anchor.endOffset < anchor.startOffset
  ) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "offset_order",
        keyword: "minimum",
        instancePath: `${instancePath}/endOffset`,
        message: "endOffset must be >= startOffset",
      }),
    );
  }
  requireString(issues, `${instancePath}/hrefExact`, anchor.hrefExact, { min: 0, max: BOUNDS.maxHrefChars });
  if (anchor.line !== undefined) requireInt(issues, `${instancePath}/line`, anchor.line, { min: 1 });
  if (anchor.column !== undefined) requireInt(issues, `${instancePath}/column`, anchor.column, { min: 1 });
  return issues;
}

function validateLink(link, { instancePath, documentIds, anchorIds, targetIds, ids }) {
  const issues = [];
  if (!isPlainObject(link) || hasHostileKey(link)) {
    pushType(issues, instancePath, "object", link);
    return issues;
  }
  if (requireString(issues, `${instancePath}/id`, link.id, { pattern: ID_RE }) && ids) {
    if (ids.has(link.id)) {
      issues.push(
        makeIssue({
          kind: "invalid",
          code: "unique",
          keyword: "uniqueItems",
          instancePath: `${instancePath}/id`,
          message: `duplicate link id ${link.id}`,
        }),
      );
    } else ids.add(link.id);
  }
  if (requireString(issues, `${instancePath}/documentId`, link.documentId, { pattern: ID_RE })) {
    if (documentIds && !documentIds.has(link.documentId)) {
      issues.push(
        makeIssue({
          kind: "invalid",
          code: "dangling_document",
          keyword: "enum",
          instancePath: `${instancePath}/documentId`,
          message: `documentId ${link.documentId} is not in documents[]`,
        }),
      );
    }
  }
  requireEnum(issues, `${instancePath}/kind`, link.kind, LINK_KINDS);
  requireString(issues, `${instancePath}/href`, link.href, { min: 0, max: BOUNDS.maxHrefChars });
  const classified = classifyHrefScheme(link.href);
  if (link.scheme !== undefined) {
    requireEnum(issues, `${instancePath}/scheme`, link.scheme, HREF_SCHEMES);
    if (typeof link.href === "string" && link.scheme !== classified.scheme) {
      issues.push(
        makeIssue({
          kind: "invalid",
          code: "scheme_mismatch",
          keyword: "const",
          instancePath: `${instancePath}/scheme`,
          message: `scheme ${link.scheme} does not match classifyHrefScheme`,
          params: { expected: classified.scheme },
        }),
      );
    }
  }
  requireEnum(issues, `${instancePath}/targetStatus`, link.targetStatus, TARGET_STATUSES);
  if (classified.statusHint === "invalid" && link.targetStatus === "reachable") {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "hostile_reachable",
        keyword: "const",
        instancePath: `${instancePath}/targetStatus`,
        message: "hostile or invalid href cannot be reachable",
        params: { scheme: classified.scheme, code: classified.code },
      }),
    );
  }
  if (requireString(issues, `${instancePath}/anchorId`, link.anchorId, { pattern: ID_RE })) {
    if (anchorIds && !anchorIds.has(link.anchorId)) {
      issues.push(
        makeIssue({
          kind: "invalid",
          code: "dangling_anchor",
          keyword: "enum",
          instancePath: `${instancePath}/anchorId`,
          message: `anchorId ${link.anchorId} is not in anchors[]`,
        }),
      );
    }
  }
  if (link.targetId !== undefined) {
    if (requireString(issues, `${instancePath}/targetId`, link.targetId, { pattern: ID_RE })) {
      if (targetIds && !targetIds.has(link.targetId)) {
        issues.push(
          makeIssue({
            kind: "invalid",
            code: "dangling_target",
            keyword: "enum",
            instancePath: `${instancePath}/targetId`,
            message: `targetId ${link.targetId} is not in targets[]`,
          }),
        );
      }
    }
  }
  if (link.text !== undefined) {
    requireString(issues, `${instancePath}/text`, link.text, { min: 0, max: BOUNDS.maxMessageChars });
  }
  return issues;
}

function validateTarget(target, { instancePath, ids }) {
  const issues = [];
  if (!isPlainObject(target) || hasHostileKey(target)) {
    pushType(issues, instancePath, "object", target);
    return issues;
  }
  if (requireString(issues, `${instancePath}/id`, target.id, { pattern: ID_RE }) && ids) {
    if (ids.has(target.id)) {
      issues.push(
        makeIssue({
          kind: "invalid",
          code: "unique",
          keyword: "uniqueItems",
          instancePath: `${instancePath}/id`,
          message: `duplicate target id ${target.id}`,
        }),
      );
    } else ids.add(target.id);
  }
  requireString(issues, `${instancePath}/hrefExact`, target.hrefExact, { min: 0, max: BOUNDS.maxHrefChars });
  requireEnum(issues, `${instancePath}/scheme`, target.scheme, HREF_SCHEMES);
  requireEnum(issues, `${instancePath}/status`, target.status, TARGET_STATUSES);
  if (target.artifactId !== undefined) {
    requireString(issues, `${instancePath}/artifactId`, target.artifactId, { pattern: ID_RE });
  }
  if (target.status === "reachable" && !target.artifactId) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "reachable_without_artifact",
        keyword: "required",
        instancePath: `${instancePath}/artifactId`,
        message: "reachable targets must name a supplied artifactId",
      }),
    );
  }
  if (target.reason !== undefined) {
    requireString(issues, `${instancePath}/reason`, target.reason, { max: BOUNDS.maxIdChars });
  }
  return issues;
}

function validateDuplicate(row, { instancePath, linkIds }) {
  const issues = [];
  if (!isPlainObject(row) || hasHostileKey(row)) {
    pushType(issues, instancePath, "object", row);
    return issues;
  }
  requireString(issues, `${instancePath}/id`, row.id, { pattern: ID_RE });
  requireEnum(issues, `${instancePath}/match`, row.match, DUPLICATE_MATCH_KINDS);
  requireString(issues, `${instancePath}/hrefExact`, row.hrefExact, { min: 0, max: BOUNDS.maxHrefChars });
  if (!Array.isArray(row.linkIds) || row.linkIds.length < 2) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "minItems",
        keyword: "minItems",
        instancePath: `${instancePath}/linkIds`,
        message: "duplicates require at least two linkIds",
      }),
    );
  } else {
    for (let i = 0; i < row.linkIds.length; i += 1) {
      const lid = row.linkIds[i];
      if (!requireString(issues, `${instancePath}/linkIds/${i}`, lid, { pattern: ID_RE })) continue;
      if (linkIds && !linkIds.has(lid)) {
        issues.push(
          makeIssue({
            kind: "invalid",
            code: "dangling_link",
            keyword: "enum",
            instancePath: `${instancePath}/linkIds/${i}`,
            message: `linkId ${lid} is not in links[]`,
          }),
        );
      }
    }
  }
  return issues;
}

function validateUnreachable(row, { instancePath, citationIds, linkIds }) {
  const issues = [];
  if (!isPlainObject(row) || hasHostileKey(row)) {
    pushType(issues, instancePath, "object", row);
    return issues;
  }
  requireString(issues, `${instancePath}/id`, row.id, { pattern: ID_RE });
  requireString(issues, `${instancePath}/hrefExact`, row.hrefExact, { min: 0, max: BOUNDS.maxHrefChars });
  requireEnum(issues, `${instancePath}/reason`, row.reason, UNREACHABLE_REASONS);
  if (!Array.isArray(row.linkIds) || row.linkIds.length === 0) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "minItems",
        keyword: "minItems",
        instancePath: `${instancePath}/linkIds`,
        message: "unreachable rows need at least one linkId",
      }),
    );
  } else {
    for (let i = 0; i < row.linkIds.length; i += 1) {
      const lid = row.linkIds[i];
      if (requireString(issues, `${instancePath}/linkIds/${i}`, lid, { pattern: ID_RE }) && linkIds && !linkIds.has(lid)) {
        issues.push(
          makeIssue({
            kind: "invalid",
            code: "dangling_link",
            keyword: "enum",
            instancePath: `${instancePath}/linkIds/${i}`,
            message: `linkId ${lid} is not in links[]`,
          }),
        );
      }
    }
  }
  if (!Array.isArray(row.citationIds) || row.citationIds.length === 0) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "citationIds",
        keyword: "minItems",
        instancePath: `${instancePath}/citationIds`,
        message: "unreachable rows are findings and must cite citationIds",
      }),
    );
  } else {
    for (let i = 0; i < row.citationIds.length; i += 1) {
      const cid = row.citationIds[i];
      if (requireString(issues, `${instancePath}/citationIds/${i}`, cid, { pattern: ID_RE }) && citationIds && !citationIds.has(cid)) {
        issues.push(
          makeIssue({
            kind: "invalid",
            code: "dangling_citation",
            keyword: "enum",
            instancePath: `${instancePath}/citationIds/${i}`,
            message: `citationId ${cid} is not in citations[]`,
          }),
        );
      }
    }
  }
  return issues;
}

function validateConflictRow(row, { instancePath, citationIds }) {
  const issues = [];
  if (!isPlainObject(row) || hasHostileKey(row)) {
    pushType(issues, instancePath, "object", row);
    return issues;
  }
  requireString(issues, `${instancePath}/id`, row.id, { pattern: ID_RE });
  requireString(issues, `${instancePath}/hrefExact`, row.hrefExact, { min: 0, max: BOUNDS.maxHrefChars });
  if (!Array.isArray(row.artifactIds) || row.artifactIds.length < 2) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "minItems",
        keyword: "minItems",
        instancePath: `${instancePath}/artifactIds`,
        message: "conflicts require at least two artifactIds",
      }),
    );
  }
  if (!Array.isArray(row.contentSha256s) || row.contentSha256s.length < 2) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "minItems",
        keyword: "minItems",
        instancePath: `${instancePath}/contentSha256s`,
        message: "conflicts require at least two contentSha256s",
      }),
    );
  } else {
    const unique = new Set(row.contentSha256s);
    if (unique.size < 2) {
      issues.push(
        makeIssue({
          kind: "invalid",
          code: "not_conflict",
          keyword: "uniqueItems",
          instancePath: `${instancePath}/contentSha256s`,
          message: "conflict hashes must disagree",
        }),
      );
    }
    for (let i = 0; i < row.contentSha256s.length; i += 1) {
      if (!isSha256Hex(row.contentSha256s[i])) {
        issues.push(
          makeIssue({
            kind: "invalid",
            code: "contentSha256",
            keyword: "pattern",
            instancePath: `${instancePath}/contentSha256s/${i}`,
            message: "contentSha256 must be 64 lowercase hex chars",
          }),
        );
      }
    }
  }
  if (!Array.isArray(row.citationIds) || row.citationIds.length === 0) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "citationIds",
        keyword: "minItems",
        instancePath: `${instancePath}/citationIds`,
        message: "conflicts must cite citationIds",
      }),
    );
  } else {
    for (let i = 0; i < row.citationIds.length; i += 1) {
      const cid = row.citationIds[i];
      if (requireString(issues, `${instancePath}/citationIds/${i}`, cid, { pattern: ID_RE }) && citationIds && !citationIds.has(cid)) {
        issues.push(
          makeIssue({
            kind: "invalid",
            code: "dangling_citation",
            keyword: "enum",
            instancePath: `${instancePath}/citationIds/${i}`,
            message: `citationId ${cid} is not in citations[]`,
          }),
        );
      }
    }
  }
  return issues;
}

export function validateOutput(output) {
  const issues = [];
  if (!isPlainObject(output) || hasHostileKey(output)) {
    pushType(issues, "", output);
    return { ok: false, status: "invalid", issues };
  }
  if (output.schema !== OUTPUT_SCHEMA) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "schema",
        keyword: "const",
        instancePath: "/schema",
        message: `schema must be ${OUTPUT_SCHEMA}`,
        params: { expected: OUTPUT_SCHEMA, actual: output.schema },
      }),
    );
  }
  if (output.packetSchema !== undefined && output.packetSchema !== PACKET_SCHEMA) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "packetSchema",
        keyword: "const",
        instancePath: "/packetSchema",
        message: `packetSchema must be ${PACKET_SCHEMA} when present`,
      }),
    );
  }
  if (output.jobId !== JOB_ID) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "jobId",
        keyword: "const",
        instancePath: "/jobId",
        message: `jobId must be ${JOB_ID}`,
      }),
    );
  }
  if (output.artifactKind !== ARTIFACT_KIND) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "artifactKind",
        keyword: "const",
        instancePath: "/artifactKind",
        message: `artifactKind must be ${ARTIFACT_KIND}`,
      }),
    );
  }
  if (!isIsoClock(output.clock)) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "clock",
        keyword: "format",
        instancePath: "/clock",
        message: "clock must be operator-supplied ISO-8601",
      }),
    );
  }
  requireEnum(issues, "/evidenceClass", output.evidenceClass, EVIDENCE_CLASSES);
  requireEnum(issues, "/decision", output.decision, DECISIONS);
  if (output.offline !== true) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "offline",
        keyword: "const",
        instancePath: "/offline",
        message: "index is offline; network fetch is out of bounds",
      }),
    );
  }
  if (!isPlainObject(output.payment) || output.payment.attempted !== false) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "payment",
        keyword: "const",
        instancePath: "/payment/attempted",
        message: "payment.attempted must be false",
      }),
    );
  }
  if (!isPlainObject(output.claims)) {
    pushType(issues, "/claims", "object", output.claims);
  } else {
    for (const key of [
      "inventsFacts",
      "paidEndpoint",
      "legalAttestation",
      "modelAsOracle",
      "assertsCustomerDemand",
    ]) {
      if (output.claims[key] !== false) {
        issues.push(
          makeIssue({
            kind: "invalid",
            code: "claims",
            keyword: "const",
            instancePath: `/claims/${key}`,
            message: `claims.${key} must be false`,
          }),
        );
      }
    }
  }

  if (!Array.isArray(output.citations)) pushType(issues, "/citations", "array", output.citations);
  else if (output.citations.length > BOUNDS.maxCitations) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "maxCitations",
        keyword: "maxItems",
        instancePath: "/citations",
        message: `citations ${output.citations.length} exceed bound`,
      }),
    );
  } else {
    const citationIds = new Set();
    for (let i = 0; i < output.citations.length; i += 1) {
      const result = validateCitation(output.citations[i], {
        instancePath: `/citations/${i}`,
        ids: citationIds,
      });
      issues.push(...result.issues);
    }
  }
  const citationIds = collectIds(output.citations);

  if (!Array.isArray(output.findings)) pushType(issues, "/findings", "array", output.findings);
  else if (output.findings.length > BOUNDS.maxFindings) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "maxFindings",
        keyword: "maxItems",
        instancePath: "/findings",
        message: `findings ${output.findings.length} exceed bound`,
      }),
    );
  } else {
    for (let i = 0; i < output.findings.length; i += 1) {
      const result = validateFinding(output.findings[i], {
        instancePath: `/findings/${i}`,
        citationIds,
      });
      issues.push(...result.issues);
    }
  }

  if (!Array.isArray(output.limitations) || output.limitations.length === 0) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "limitations",
        keyword: "minItems",
        instancePath: "/limitations",
        message: "limitations must list concrete coverage holes",
      }),
    );
  }

  if (!Array.isArray(output.documents) || output.documents.length === 0) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "minItems",
        keyword: "minItems",
        instancePath: "/documents",
        message: "output documents[] required",
      }),
    );
  } else {
    const ids = new Set();
    for (let i = 0; i < output.documents.length; i += 1) {
      const doc = output.documents[i];
      if (!isPlainObject(doc)) {
        pushType(issues, `/documents/${i}`, "object", doc);
        continue;
      }
      if (requireString(issues, `/documents/${i}/id`, doc.id, { pattern: ID_RE })) {
        if (ids.has(doc.id)) {
          issues.push(
            makeIssue({
              kind: "invalid",
              code: "unique",
              keyword: "uniqueItems",
              instancePath: `/documents/${i}/id`,
              message: `duplicate document id ${doc.id}`,
            }),
          );
        } else ids.add(doc.id);
      }
      requireEnum(issues, `/documents/${i}/kind`, doc.kind, DOCUMENT_KINDS);
      if (!locatorOk(doc.path, doc.url)) {
        issues.push(
          makeIssue({
            kind: "invalid",
            code: "locator",
            keyword: "anyOf",
            instancePath: `/documents/${i}`,
            message: "document needs path or url",
          }),
        );
      }
      if (doc.contentSha256 !== undefined && !isSha256Hex(doc.contentSha256)) {
        issues.push(
          makeIssue({
            kind: "invalid",
            code: "contentSha256",
            keyword: "pattern",
            instancePath: `/documents/${i}/contentSha256`,
            message: "contentSha256 must be 64 lowercase hex chars when present",
          }),
        );
      }
      if (doc.linkCount !== undefined) {
        requireInt(issues, `/documents/${i}/linkCount`, doc.linkCount, { min: 0, max: BOUNDS.maxLinks });
      }
    }
  }
  const documentIds = collectIds(output.documents);

  const anchorIds = new Set();
  if (!Array.isArray(output.anchors)) pushType(issues, "/anchors", "array", output.anchors);
  else {
    for (let i = 0; i < output.anchors.length; i += 1) {
      issues.push(...validateAnchor(output.anchors[i], { instancePath: `/anchors/${i}`, documentIds, ids: anchorIds }));
    }
  }

  const targetIds = new Set();
  if (!Array.isArray(output.targets)) pushType(issues, "/targets", "array", output.targets);
  else {
    for (let i = 0; i < output.targets.length; i += 1) {
      issues.push(...validateTarget(output.targets[i], { instancePath: `/targets/${i}`, ids: targetIds }));
    }
  }

  const linkIds = new Set();
  if (!Array.isArray(output.links)) pushType(issues, "/links", "array", output.links);
  else if (output.links.length > BOUNDS.maxLinks) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "maxLinks",
        keyword: "maxItems",
        instancePath: "/links",
        message: `links ${output.links.length} exceed bound`,
      }),
    );
  } else {
    for (let i = 0; i < output.links.length; i += 1) {
      issues.push(
        ...validateLink(output.links[i], {
          instancePath: `/links/${i}`,
          documentIds,
          anchorIds,
          targetIds,
          ids: linkIds,
        }),
      );
    }
  }

  if (!Array.isArray(output.duplicates)) pushType(issues, "/duplicates", "array", output.duplicates);
  else {
    for (let i = 0; i < output.duplicates.length; i += 1) {
      issues.push(...validateDuplicate(output.duplicates[i], { instancePath: `/duplicates/${i}`, linkIds }));
    }
  }

  if (!Array.isArray(output.unreachable)) pushType(issues, "/unreachable", "array", output.unreachable);
  else {
    for (let i = 0; i < output.unreachable.length; i += 1) {
      issues.push(
        ...validateUnreachable(output.unreachable[i], {
          instancePath: `/unreachable/${i}`,
          citationIds,
          linkIds,
        }),
      );
    }
  }

  if (!Array.isArray(output.conflicts)) pushType(issues, "/conflicts", "array", output.conflicts);
  else {
    for (let i = 0; i < output.conflicts.length; i += 1) {
      issues.push(
        ...validateConflictRow(output.conflicts[i], {
          instancePath: `/conflicts/${i}`,
          citationIds,
        }),
      );
    }
  }

  if (!isPlainObject(output.bounds)) pushType(issues, "/bounds", "object", output.bounds);
  else {
    if (typeof output.bounds.truncated !== "boolean") {
      pushType(issues, "/bounds/truncated", "boolean", output.bounds.truncated);
    }
    if (output.bounds.maxDocuments !== undefined) {
      requireInt(issues, "/bounds/maxDocuments", output.bounds.maxDocuments, { min: 1, max: BOUNDS.maxDocuments });
    }
    if (output.bounds.maxLinks !== undefined) {
      requireInt(issues, "/bounds/maxLinks", output.bounds.maxLinks, { min: 1, max: BOUNDS.maxLinks });
    }
  }

  if (!isPlainObject(output.coverage)) pushType(issues, "/coverage", "object", output.coverage);
  else {
    if (output.coverage.networkFetched !== false) {
      issues.push(
        makeIssue({
          kind: "invalid",
          code: "networkFetched",
          keyword: "const",
          instancePath: "/coverage/networkFetched",
          message: "networkFetched must be false",
        }),
      );
    }
    if (output.coverage.inventoryConsulted !== true) {
      issues.push(
        makeIssue({
          kind: "invalid",
          code: "inventoryConsulted",
          keyword: "const",
          instancePath: "/coverage/inventoryConsulted",
          message: "inventoryConsulted must be true (supplied artifacts only)",
        }),
      );
    }
    for (const key of ["documentsIndexed", "documentsUnknown", "linksObserved", "linksUnknown"]) {
      if (output.coverage[key] !== undefined) {
        requireInt(issues, `/coverage/${key}`, output.coverage[key], { min: 0 });
      }
    }
  }

  const hasUnreachable = Array.isArray(output.unreachable) && output.unreachable.length > 0;
  const hasConflicts = Array.isArray(output.conflicts) && output.conflicts.length > 0;
  const linksUnknown = isPlainObject(output.coverage) ? output.coverage.linksUnknown || 0 : 0;
  const truncated = isPlainObject(output.bounds) ? output.bounds.truncated === true : false;
  if (output.decision === "pass") {
    if (hasUnreachable || hasConflicts || linksUnknown > 0 || truncated) {
      issues.push(
        makeIssue({
          kind: "invalid",
          code: "pass_with_holes",
          keyword: "const",
          instancePath: "/decision",
          message: "decision pass is forbidden when unreachable, conflict, unknown, or truncated coverage is present",
        }),
      );
    }
  }
  if (hasConflicts && output.decision !== "conflict" && output.decision !== "unknown") {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "conflict_hidden",
        keyword: "const",
        instancePath: "/decision",
        message: "conflicts[] requires decision conflict or unknown",
      }),
    );
  }
  if (output.decision === "conflict" && !hasConflicts) {
    issues.push(
      makeIssue({
        kind: "invalid",
        code: "conflict_empty",
        keyword: "minItems",
        instancePath: "/conflicts",
        message: "decision conflict requires conflicts[]",
      }),
    );
  }

  const status = statusOf(issues);
  return { ok: status === "ok", status, issues };
}

export function createLinkIndexPacket({
  clock,
  evidenceClass = "synthetic",
  sources = [],
  findings = [],
  citations = [],
  decision = "unknown",
  limitations = [...LIMITATIONS],
  documents = [],
  links = [],
  anchors = [],
  targets = [],
  duplicates = [],
  unreachable = [],
  conflicts = [],
  bounds = {
    maxDocuments: BOUNDS.maxDocuments,
    maxLinks: BOUNDS.maxLinks,
    maxBodyBytes: BOUNDS.maxBodyBytes,
    truncated: false,
  },
  coverage = {
    documentsIndexed: 0,
    documentsUnknown: 0,
    linksObserved: 0,
    linksUnknown: 0,
    inventoryConsulted: true,
    networkFetched: false,
  },
} = {}) {
  const envelope = createEnvelope({
    jobId: JOB_ID,
    artifactKind: ARTIFACT_KIND,
    clock,
    evidenceClass,
    sources,
    findings,
    citations,
    decision,
    limitations,
  });
  return {
    ...envelope,
    schema: OUTPUT_SCHEMA,
    packetSchema: PACKET_SCHEMA,
    documents,
    links,
    anchors,
    targets,
    duplicates,
    unreachable,
    conflicts,
    bounds,
    coverage,
  };
}

const CLOCK = "2026-09-10T00:00:00.000Z";

function syntheticMd() {
  return "# Intro\n\nSee [spec](./spec.md).\n";
}

function syntheticSpec() {
  return "# Spec\n\nPlaceholder artifact body.\n";
}

export function exampleCases() {
  const md = syntheticMd();
  const spec = syntheticSpec();
  const mdHash = sha256Hex(md);
  const specHash = sha256Hex(spec);
  const otherHash = sha256Hex(`${spec}#other`);

  const positiveInput = {
    schema: INPUT_SCHEMA,
    clock: CLOCK,
    evidenceClass: "synthetic",
    caseKind: "positive",
    documents: [
      {
        id: "doc-md",
        kind: "markdown",
        path: "synthetic/page.md",
        body: md,
        contentSha256: mdHash,
        mediaType: "text/markdown",
      },
    ],
    artifacts: [
      {
        id: "art-spec",
        path: "synthetic/spec.md",
        exists: true,
        contentSha256: specHash,
      },
    ],
  };

  const citationPage = {
    id: "cite-page",
    path: "synthetic/page.md",
    contentSha256: mdHash,
    evidenceClass: "synthetic",
  };
  const citationSpec = {
    id: "cite-spec",
    path: "synthetic/spec.md",
    contentSha256: specHash,
    evidenceClass: "synthetic",
  };

  const positiveOutput = createLinkIndexPacket({
    clock: CLOCK,
    evidenceClass: "synthetic",
    decision: "pass",
    sources: [citationPage, citationSpec],
    citations: [citationPage, citationSpec],
    findings: [
      {
        id: "find-reachable",
        kind: "reachable",
        message: "href ./spec.md resolved to supplied artifact art-spec",
        citationIds: ["cite-page", "cite-spec"],
        linkIds: ["link-1"],
        documentId: "doc-md",
      },
    ],
    documents: [
      {
        id: "doc-md",
        kind: "markdown",
        path: "synthetic/page.md",
        contentSha256: mdHash,
        linkCount: 1,
      },
    ],
    anchors: [
      {
        id: "anc-1",
        documentId: "doc-md",
        startOffset: md.indexOf("[spec]"),
        endOffset: md.indexOf("[spec]") + "[spec](./spec.md)".length,
        line: 3,
        column: 5,
        hrefExact: "./spec.md",
      },
    ],
    targets: [
      {
        id: "tgt-1",
        hrefExact: "./spec.md",
        scheme: "relative",
        status: "reachable",
        artifactId: "art-spec",
      },
    ],
    links: [
      {
        id: "link-1",
        documentId: "doc-md",
        kind: "markdown_inline",
        href: "./spec.md",
        text: "spec",
        scheme: "relative",
        targetStatus: "reachable",
        targetId: "tgt-1",
        anchorId: "anc-1",
      },
    ],
    duplicates: [],
    unreachable: [],
    conflicts: [],
    coverage: {
      documentsIndexed: 1,
      documentsUnknown: 0,
      linksObserved: 1,
      linksUnknown: 0,
      inventoryConsulted: true,
      networkFetched: false,
    },
  });

  const negativeInput = {
    schema: INPUT_SCHEMA,
    clock: "now",
    evidenceClass: "oracle",
    caseKind: "negative",
    documents: [],
  };

  const uncitedFinding = createLinkIndexPacket({
    clock: CLOCK,
    evidenceClass: "synthetic",
    decision: "pass",
    citations: [citationPage],
    findings: [
      {
        id: "find-uncited",
        kind: "reachable",
        message: "missing citationIds",
        citationIds: [],
      },
    ],
    documents: [{ id: "doc-md", kind: "markdown", path: "synthetic/page.md" }],
    anchors: [],
    targets: [],
    links: [],
    coverage: {
      documentsIndexed: 1,
      documentsUnknown: 0,
      linksObserved: 0,
      linksUnknown: 0,
      inventoryConsulted: true,
      networkFetched: false,
    },
  });

  const partialInput = {
    schema: INPUT_SCHEMA,
    clock: CLOCK,
    evidenceClass: "synthetic",
    caseKind: "partial",
    documents: [
      {
        id: "doc-md",
        kind: "markdown",
        path: "synthetic/page.md",
        body: "See [remote](https://example.invalid/no-fetch) and [local](./spec.md).\n",
        contentSha256: sha256Hex(
          "See [remote](https://example.invalid/no-fetch) and [local](./spec.md).\n",
        ),
      },
      {
        id: "doc-html",
        kind: "html",
        path: "synthetic/missing-body.html",
      },
    ],
    artifacts: [{ id: "art-spec", path: "synthetic/spec.md", exists: true, contentSha256: specHash }],
  };

  const partialBody = partialInput.documents[0].body;
  const remoteHref = "https://example.invalid/no-fetch";
  const localHref = "./spec.md";
  const partialOutput = createLinkIndexPacket({
    clock: CLOCK,
    evidenceClass: "synthetic",
    decision: "partial",
    citations: [citationPage, citationSpec],
    findings: [
      {
        id: "find-unknown-ext",
        kind: "unknown_external",
        message: "https href not in inventory; not fetched",
        citationIds: ["cite-page"],
        linkIds: ["link-remote"],
      },
      {
        id: "find-missing-body",
        kind: "missing_body",
        message: "document doc-html has path but no body",
        citationIds: ["cite-page"],
        documentId: "doc-html",
      },
      {
        id: "find-local",
        kind: "reachable",
        message: "local href resolved to supplied artifact",
        citationIds: ["cite-page", "cite-spec"],
        linkIds: ["link-local"],
      },
    ],
    documents: [
      { id: "doc-md", kind: "markdown", path: "synthetic/page.md", contentSha256: partialInput.documents[0].contentSha256, linkCount: 2 },
      { id: "doc-html", kind: "html", path: "synthetic/missing-body.html", linkCount: 0 },
    ],
    anchors: [
      {
        id: "anc-remote",
        documentId: "doc-md",
        startOffset: partialBody.indexOf("[remote]"),
        endOffset: partialBody.indexOf("[remote]") + `[remote](${remoteHref})`.length,
        line: 1,
        column: 5,
        hrefExact: remoteHref,
      },
      {
        id: "anc-local",
        documentId: "doc-md",
        startOffset: partialBody.indexOf("[local]"),
        endOffset: partialBody.indexOf("[local]") + `[local](${localHref})`.length,
        line: 1,
        column: 1,
        hrefExact: localHref,
      },
    ],
    targets: [
      { id: "tgt-remote", hrefExact: remoteHref, scheme: "https", status: "unknown", reason: "no_fetch" },
      { id: "tgt-local", hrefExact: localHref, scheme: "relative", status: "reachable", artifactId: "art-spec" },
    ],
    links: [
      {
        id: "link-remote",
        documentId: "doc-md",
        kind: "markdown_inline",
        href: remoteHref,
        text: "remote",
        scheme: "https",
        targetStatus: "unknown",
        targetId: "tgt-remote",
        anchorId: "anc-remote",
      },
      {
        id: "link-local",
        documentId: "doc-md",
        kind: "markdown_inline",
        href: localHref,
        text: "local",
        scheme: "relative",
        targetStatus: "reachable",
        targetId: "tgt-local",
        anchorId: "anc-local",
      },
    ],
    duplicates: [],
    unreachable: [],
    conflicts: [],
    coverage: {
      documentsIndexed: 1,
      documentsUnknown: 1,
      linksObserved: 2,
      linksUnknown: 1,
      inventoryConsulted: true,
      networkFetched: false,
    },
  });

  const conflictInput = {
    schema: INPUT_SCHEMA,
    clock: CLOCK,
    evidenceClass: "synthetic",
    caseKind: "conflict",
    documents: [
      {
        id: "doc-md",
        kind: "markdown",
        path: "synthetic/page.md",
        body: md,
        contentSha256: mdHash,
      },
    ],
    artifacts: [
      { id: "art-a", path: "synthetic/spec.md", exists: true, contentSha256: specHash },
      { id: "art-b", path: "synthetic/spec.md", exists: true, contentSha256: otherHash },
    ],
  };

  const conflictOutput = createLinkIndexPacket({
    clock: CLOCK,
    evidenceClass: "synthetic",
    decision: "conflict",
    citations: [citationPage, citationSpec],
    findings: [
      {
        id: "find-conflict",
        kind: "conflicting_target",
        message: "synthetic/spec.md supplied with two disagreeing contentSha256 values",
        citationIds: ["cite-page", "cite-spec"],
        linkIds: ["link-1"],
      },
    ],
    documents: [{ id: "doc-md", kind: "markdown", path: "synthetic/page.md", contentSha256: mdHash, linkCount: 1 }],
    anchors: [
      {
        id: "anc-1",
        documentId: "doc-md",
        startOffset: md.indexOf("[spec]"),
        endOffset: md.indexOf("[spec]") + "[spec](./spec.md)".length,
        hrefExact: "./spec.md",
      },
    ],
    targets: [
      { id: "tgt-1", hrefExact: "./spec.md", scheme: "relative", status: "conflict", reason: "artifact_hash_conflict" },
    ],
    links: [
      {
        id: "link-1",
        documentId: "doc-md",
        kind: "markdown_inline",
        href: "./spec.md",
        text: "spec",
        scheme: "relative",
        targetStatus: "conflict",
        targetId: "tgt-1",
        anchorId: "anc-1",
      },
    ],
    duplicates: [],
    unreachable: [],
    conflicts: [
      {
        id: "conf-1",
        hrefExact: "./spec.md",
        artifactIds: ["art-a", "art-b"],
        contentSha256s: [specHash, otherHash],
        citationIds: ["cite-page", "cite-spec"],
      },
    ],
    coverage: {
      documentsIndexed: 1,
      documentsUnknown: 0,
      linksObserved: 1,
      linksUnknown: 0,
      inventoryConsulted: true,
      networkFetched: false,
    },
  });

  return {
    positive: { input: positiveInput, output: positiveOutput },
    negative: { input: negativeInput, output: uncitedFinding },
    partial: { input: partialInput, output: partialOutput },
    conflict: { input: conflictInput, output: conflictOutput },
  };
}

export async function registerSchemaTests({ test, assert }) {
  const cases = exampleCases();

  test("positive input and output validate", () => {
    const inn = validateInput(cases.positive.input);
    assert.equal(inn.ok, true, inn.issues.map((row) => row.message).join("; "));
    const out = validateOutput(cases.positive.output);
    assert.equal(out.ok, true, out.issues.map((row) => row.message).join("; "));
    assert.equal(cases.positive.output.decision, "pass");
    assert.equal(cases.positive.output.evidenceClass, "synthetic");
    assert.equal(cases.positive.output.coverage.networkFetched, false);
  });

  test("negative: refused clock, bad evidenceClass, empty documents, uncited finding", () => {
    const inn = validateInput(cases.negative.input);
    assert.equal(inn.ok, false);
    assert.equal(inn.status, "invalid");
    assert.ok(inn.issues.some((row) => row.code === "clock_now"));
    assert.ok(inn.issues.some((row) => row.code === "enum" && row.instancePath === "/evidenceClass"));
    assert.ok(inn.issues.some((row) => row.instancePath === "/documents"));
    const out = validateOutput(cases.negative.output);
    assert.equal(out.ok, false);
    assert.ok(out.issues.some((row) => row.code === "citationIds"));
  });

  test("partial: missing body is unknown; https is no-fetch unknown", () => {
    const inn = validateInput(cases.partial.input);
    assert.equal(inn.ok, false);
    assert.equal(inn.status, "unknown");
    assert.ok(inn.issues.some((row) => row.code === "missing_body"));
    assert.ok(!inn.issues.some((row) => row.kind === "invalid"));
    const classified = classifyHrefScheme("https://example.invalid/no-fetch");
    assert.equal(classified.scheme, "https");
    assert.equal(classified.statusHint, "unknown");
    assert.equal(classified.code, "no_fetch");
    const out = validateOutput(cases.partial.output);
    assert.equal(out.ok, true, out.issues.map((row) => row.message).join("; "));
    assert.equal(cases.partial.output.decision, "partial");
    assert.equal(cases.partial.output.coverage.linksUnknown, 1);
    assert.equal(cases.partial.output.coverage.documentsUnknown, 1);
  });

  test("conflict: disagreeing artifact hashes stay unknown; output decision conflict", () => {
    const inn = validateInput(cases.conflict.input);
    assert.equal(inn.status, "unknown");
    assert.ok(inn.issues.some((row) => row.code === "artifact_hash_conflict"));
    const out = validateOutput(cases.conflict.output);
    assert.equal(out.ok, true, out.issues.map((row) => row.message).join("; "));
    assert.equal(cases.conflict.output.decision, "conflict");
    assert.equal(cases.conflict.output.conflicts.length, 1);
  });

  test("pass is invalid when unreachable rows exist", () => {
    const packet = structuredClone(cases.positive.output);
    packet.unreachable = [
      {
        id: "un-1",
        hrefExact: "./missing.md",
        reason: "missing_artifact",
        linkIds: ["link-1"],
        citationIds: ["cite-page"],
      },
    ];
    const out = validateOutput(packet);
    assert.equal(out.ok, false);
    assert.ok(out.issues.some((row) => row.code === "pass_with_holes"));
  });

  test("javascript href cannot be reachable", () => {
    assert.equal(classifyHrefScheme("javascript:alert(1)").code, "hostile_scheme");
    const packet = structuredClone(cases.positive.output);
    packet.links[0].href = "javascript:alert(1)";
    packet.links[0].scheme = "javascript";
    packet.anchors[0].hrefExact = "javascript:alert(1)";
    const out = validateOutput(packet);
    assert.equal(out.ok, false);
    assert.ok(out.issues.some((row) => row.code === "hostile_reachable"));
  });

  test("body/contentSha256 mismatch is invalid", () => {
    const inn = validateInput({
      clock: CLOCK,
      evidenceClass: "fixture",
      documents: [
        {
          id: "doc-md",
          kind: "markdown",
          path: "synthetic/page.md",
          body: "# x\n",
          contentSha256: sha256Hex("# y\n"),
        },
      ],
    });
    assert.equal(inn.status, "invalid");
    assert.ok(inn.issues.some((row) => row.code === "hash_mismatch"));
  });

  test("citation requires path or url; findings must resolve citationIds", () => {
    const bad = validateCitation({ id: "cite-x" });
    assert.equal(bad.ok, false);
    assert.ok(bad.issues.some((row) => row.code === "locator"));
    const packet = structuredClone(cases.positive.output);
    packet.findings[0].citationIds = ["cite-missing"];
    const out = validateOutput(packet);
    assert.equal(out.ok, false);
    assert.ok(out.issues.some((row) => row.code === "dangling_citation"));
  });

  test("networkFetched true and paid claims are invalid", () => {
    const packet = structuredClone(cases.positive.output);
    packet.coverage.networkFetched = true;
    packet.claims.paidEndpoint = true;
    const out = validateOutput(packet);
    assert.equal(out.ok, false);
    assert.ok(out.issues.some((row) => row.code === "networkFetched"));
    assert.ok(out.issues.some((row) => row.instancePath === "/claims/paidEndpoint"));
  });

  test("field cites point at sourced job outcome with content hash", () => {
    assert.equal(SCHEMA_SOURCE_CITES.jobOutcome.present, true);
    assert.equal(isSha256Hex(SCHEMA_SOURCE_CITES.jobOutcome.sha256), true);
    assert.equal(FIELD_CITES.anchors.cites, "exact source anchors");
    assert.equal(FIELD_CITES.unreachable.cites, "unreachable targets");
    assert.equal(FIELD_CITES.duplicates.cites, "duplicates");
    assert.ok(SCHEMA_SOURCE_CITES.jobOutcome.note.includes("R2-CONSUMER-JOBS-04"));
  });

  test("duplicate rows need two linkIds; conflict hashes must disagree", () => {
    const packet = structuredClone(cases.positive.output);
    packet.duplicates = [{ id: "dup-1", match: "exact_href", hrefExact: "./spec.md", linkIds: ["link-1"] }];
    const out = validateOutput(packet);
    assert.equal(out.ok, false);
    assert.ok(out.issues.some((row) => row.instancePath === "/duplicates/0/linkIds"));
    const conflict = structuredClone(cases.conflict.output);
    conflict.conflicts[0].contentSha256s = [conflict.conflicts[0].contentSha256s[0], conflict.conflicts[0].contentSha256s[0]];
    const out2 = validateOutput(conflict);
    assert.equal(out2.ok, false);
    assert.ok(out2.issues.some((row) => row.code === "not_conflict"));
  });

  test("requireCitedFinding throws without citationIds", () => {
    assert.throws(() => requireCitedFinding({ id: "x", kind: "reachable" }), /citationId/);
    const kept = requireCitedFinding({ id: "x", kind: "reachable", citationIds: ["cite-page"] });
    assert.equal(kept.id, "x");
  });
}

function isDirectRun() {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return fileURLToPath(import.meta.url) === resolve(argv1);
  } catch {
    return false;
  }
}

function selfCheck() {
  const cases = exampleCases();
  const report = {
    ok: true,
    cell: CELL_ID,
    inputSchema: INPUT_SCHEMA,
    outputSchema: OUTPUT_SCHEMA,
    evidenceClass: "synthetic",
    jobId: JOB_ID,
    sourceCites: SCHEMA_SOURCE_CITES,
    cases: {},
  };
  const innPos = validateInput(cases.positive.input);
  const outPos = validateOutput(cases.positive.output);
  report.cases.positive = { input: innPos.status, output: outPos.status };
  const innNeg = validateInput(cases.negative.input);
  const outNeg = validateOutput(cases.negative.output);
  report.cases.negative = { input: innNeg.status, output: outNeg.status };
  const innPart = validateInput(cases.partial.input);
  const outPart = validateOutput(cases.partial.output);
  report.cases.partial = { input: innPart.status, output: outPart.status };
  const innConf = validateInput(cases.conflict.input);
  const outConf = validateOutput(cases.conflict.output);
  report.cases.conflict = { input: innConf.status, output: outConf.status };
  report.ok =
    innPos.ok &&
    outPos.ok &&
    innNeg.status === "invalid" &&
    outNeg.status === "invalid" &&
    innPart.status === "unknown" &&
    outPart.ok &&
    innConf.status === "unknown" &&
    outConf.ok;
  return report;
}

if (isDirectRun()) {
  if (process.argv.includes("--self-check")) {
    const report = selfCheck();
    process.stdout.write(`${JSON.stringify(report)}\n`);
    process.exit(report.ok ? 0 : 1);
  }
  const { test } = await import("node:test");
  const assert = await import("node:assert/strict");
  await registerSchemaTests({ test, assert: assert.default ?? assert });
}

export { selfCheck };
export default {
  JOB_ID,
  INPUT_SCHEMA,
  OUTPUT_SCHEMA,
  validateInput,
  validateOutput,
  createLinkIndexPacket,
  classifyHrefScheme,
  exampleCases,
};
