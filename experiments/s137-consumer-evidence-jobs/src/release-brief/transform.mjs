/**
 * c07 — commit/release inputs → auditable release evidence brief.
 * R2-CONSUMER-JOBS-02. Never conflate announced vs shipped vs tested.
 *
 * Schema (c06) validates plane separation. This transform:
 * - splits compound GitHub Releases JSON into announced notes (never tests)
 * - maps git-tag / npm / CI receipts onto shipped / tested
 * - refuses to copy changelog/body onto shipped or tested
 * - does not treat GitHub tarball_url or a branch target_commitish as a ship
 *
 * Offline. No network. No invented clock, spend, demand, or attestation.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { createEnvelope } from "../packet.mjs";
import {
  ANNOUNCED_PAYLOAD_FIELDS,
  ARTIFACT_KIND,
  BRIEF_SCHEMA,
  EVIDENCE_CLASSES,
  FAIL_FINDING_CODES,
  IDENTITY_ROLES,
  INPUT_SCHEMA,
  JOB_ID,
  PACKET_SCHEMA,
  PLANES,
  SCHEMA_LIMITATIONS,
  SHIPPED_PAYLOAD_FIELDS,
  SOURCE_KINDS,
  TESTED_PAYLOAD_FIELDS,
  codesOf,
  impliedDecision,
  isCompoundKind,
  kindPlane,
  makeIssue,
  provenanceFields,
  requireCitedFinding,
  schemaCases,
  sha256Hex,
  validateReleaseBrief,
  validateReleaseBriefInput,
} from "./schema.mjs";

export {
  ARTIFACT_KIND,
  BRIEF_SCHEMA,
  INPUT_SCHEMA,
  JOB_ID,
  PLANES,
  impliedDecision,
  kindPlane,
  validateReleaseBrief,
  validateReleaseBriefInput,
};

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK_ROOT = join(HERE, "..", "..");
const SHA1_HEX = /^[0-9a-f]{40}$/i;
const HOSTILE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

const PAYLOAD_FIELDS = Object.freeze({
  announced: ANNOUNCED_PAYLOAD_FIELDS,
  shipped: SHIPPED_PAYLOAD_FIELDS,
  tested: TESTED_PAYLOAD_FIELDS,
});

const PAYLOAD_ALIASES = Object.freeze({
  publishedAt: ["published_at"],
  published_at: ["publishedAt"],
  createdAt: ["created_at"],
  created_at: ["createdAt"],
  htmlUrl: ["html_url"],
  targetCommitish: ["target_commitish"],
  target_commitish: ["targetCommitish"],
  tarballUrl: ["tarball_url"],
  zipballUrl: ["zipball_url"],
  taggedAt: ["tagged_at"],
  tagged_at: ["taggedAt"],
  headSha: ["head_sha"],
  head_sha: ["headSha"],
  completedAt: ["completed_at"],
  completed_at: ["completedAt"],
  gitHead: ["git_head"],
  distIntegrity: ["dist_integrity"],
  artifactDigest: ["artifact_digest"],
});

export const TRANSFORM_LIMITATIONS = Object.freeze([
  "Does not fetch GitHub, npm, or CI. Bytes are operator-supplied.",
  "GitHub Releases JSON is announced notes; tarball_url / zipball_url / assets[] are not a ship.",
  "target_commitish that is a branch name is not a shipped commit SHA.",
  "Changelog or release-body wording such as 'shipped' or 'All tests passed' stays announced.",
  "Draft GitHub releases are announced-only (draft_not_shipped).",
  "Does not invent operator clock, spend, customer demand, or legal attestation.",
  ...SCHEMA_LIMITATIONS,
]);

export function isGitSha(value) {
  return typeof value === "string" && SHA1_HEX.test(value.trim());
}

export function versionFromTag(tag) {
  if (typeof tag !== "string" || !tag) return null;
  const trimmed = tag.trim();
  if (/^v\d/.test(trimmed)) return trimmed.slice(1);
  return trimmed;
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasHostileKey(value) {
  if (!value || typeof value !== "object") return false;
  return Object.keys(value).some((key) => HOSTILE_KEYS.has(key));
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function pickField(record, key) {
  if (!record || typeof record !== "object") return undefined;
  if (record[key] !== undefined) return record[key];
  const aliases = PAYLOAD_ALIASES[key];
  if (!aliases) return undefined;
  for (const alias of aliases) {
    if (record[alias] !== undefined) return record[alias];
  }
  return undefined;
}

function pickPayload(plane, record) {
  const fields = PAYLOAD_FIELDS[plane];
  const out = {};
  if (!record || !fields) return out;
  for (const key of fields) {
    const value = pickField(record, key);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function digestOf(value) {
  if (typeof value === "string" || Buffer.isBuffer(value)) return sha256Hex(value);
  return sha256Hex(JSON.stringify(value));
}

function locatorOf(record = {}) {
  return {
    path: firstString(record.path) || null,
    url: firstString(record.url) || null,
  };
}

/**
 * Classify a raw document or schema source into a SOURCE_KINDS key or
 * compound github-release. Lane-labelled fixture docs stay on their lane
 * even when they reuse GitHub field names.
 */
export function detectSourceKind(doc, hint = {}) {
  if (hint.kind && (SOURCE_KINDS[hint.kind] || isCompoundKind(hint.kind))) return hint.kind;
  if (!doc || typeof doc !== "object") return null;
  if (doc.kind && (SOURCE_KINDS[doc.kind] || isCompoundKind(doc.kind))) return doc.kind;

  const schemaId = typeof doc.schema === "string" ? doc.schema : "";
  const lane = hint.lane || doc.lane || doc.plane || null;
  if (lane === "announced" || schemaId.includes("source.announced")) return "github-release-notes";
  if (lane === "shipped" || schemaId.includes("source.shipped")) return "git-tag";
  if (lane === "tested" || schemaId.includes("source.tested")) return "ci-log";
  if (schemaId.includes("source.notice") || doc.lanesPresent) return "notice";

  if (doc.assets_url || doc.tarball_url || (doc.html_url && Object.prototype.hasOwnProperty.call(doc, "draft") && doc.tag_name)) {
    return "github-release";
  }
  if (doc.object?.sha || (typeof doc.ref === "string" && doc.ref.startsWith("refs/tags/"))) return "git-tag";
  if (doc.head_sha && (doc.conclusion != null || doc.status != null)) return "ci-log";
  if (doc.exitCode != null || doc.passCount != null || doc.failCount != null) return "test-receipt";
  if (doc["dist-tags"] || doc.distIntegrity || doc.dist?.integrity) return "npm-packument-version";
  if (doc.body && (doc.title || doc.tag_name || doc.name) && !doc.object) return "changelog";
  return null;
}

function identityFor(plane, record = {}) {
  const tag = firstString(record.tag, record.tag_name, record.tagName, record.ref?.replace?.(/^refs\/tags\//, ""));
  const version = firstString(record.version, versionFromTag(tag));
  const commitSha = firstString(
    record.commitSha,
    isGitSha(record.target_commitish) ? record.target_commitish : null,
    isGitSha(record.targetCommitish) ? record.targetCommitish : null,
    record.object?.sha,
    record.gitHead,
    record.head_sha,
    record.headSha,
  );
  const identity = { role: IDENTITY_ROLES[plane] };
  if (version) identity.version = version;
  if (tag) identity.tag = tag;
  if (commitSha) identity.commitSha = commitSha;
  return identity;
}

function hasIdentity(identity) {
  if (!identity || typeof identity !== "object") return false;
  return Boolean(identity.version || identity.tag || identity.commitSha);
}

/**
 * Split a GitHub Releases REST object. Notes/draft/body are announced.
 * Shipped is omitted unless the operator already supplied an independent
 * git/npm identity — GitHub tarball_url is not a ship.
 */
export function splitGithubRelease(raw = {}) {
  const announcedPayload = pickPayload("announced", raw);
  if (raw.html_url && announcedPayload.htmlUrl == null) announcedPayload.htmlUrl = raw.html_url;
  if (raw.name && announcedPayload.title == null && announcedPayload.name == null) {
    announcedPayload.title = raw.name;
  }
  const announced = {
    identity: identityFor("announced", raw),
    payload: announcedPayload,
  };
  return { announced, shipped: null, tested: null };
}

function loadDoc(source) {
  if (source && source.payload && isPlainObject(source.payload) && !source.doc) {
    if (source.kind || source.plane || source.split) return source.payload;
  }
  if (source?.doc && isPlainObject(source.doc)) return source.doc;
  if (source?.payload && isPlainObject(source.payload)) return source.payload;
  if (typeof source?.path === "string" && source.path && existsSync(source.path)) {
    try {
      return JSON.parse(readFileSync(source.path, "utf8"));
    } catch {
      return null;
    }
  }
  return isPlainObject(source) ? source : null;
}

function sourceLocator(source, fallbackId) {
  const loc = locatorOf(source);
  if (loc.path || loc.url) return loc;
  const doc = loadDoc(source);
  const nested = locatorOf(doc || {});
  if (nested.path || nested.url) return nested;
  return { path: `synthetic://${fallbackId}`, url: null };
}

function sourceDigest(source, doc) {
  const given = firstString(source?.contentSha256, source?.sha256);
  if (given) return given.toLowerCase();
  if (typeof source?.path === "string" && source.path && existsSync(source.path)) {
    return sha256Hex(readFileSync(source.path));
  }
  if (doc) return digestOf(doc);
  return digestOf(source ?? "");
}

function citationFrom(id, plane, kind, source, doc) {
  const loc = sourceLocator(source, id);
  const citation = {
    id,
    plane,
    kind,
    path: loc.path,
    url: loc.url,
    contentSha256: sourceDigest(source, doc),
    licenseNote: source.licenseNote ?? doc?.licenseNote ?? doc?.notice ?? null,
  };
  const retrievedAt = source.retrievedAt ?? doc?.retrievedAt ?? null;
  if (retrievedAt) citation.retrievedAt = retrievedAt;
  return citation;
}

function emptyPlanes() {
  return {
    announced: { items: [] },
    shipped: { items: [] },
    tested: { items: [] },
  };
}

function pushItem(planes, plane, item) {
  planes[plane].items.push(item);
}

function alignmentStatus({ conflict, announced, shipped, tested }) {
  if (conflict) return "conflict";
  const a = announced > 0;
  const s = shipped > 0;
  const t = tested > 0;
  if (a && s && t) return "aligned";
  if (a && !s && !t) return "announced-only";
  if (s && !a) return "shipped-unannounced";
  if (a && s && !t) return "untested";
  if (t && !s) return "tested-without-ship";
  if (a || s || t) return "partial";
  return "partial";
}

function identityTokens(planes) {
  const tokens = [];
  for (const plane of PLANES) {
    for (const item of planes[plane].items) {
      const identity = item.identity || {};
      tokens.push({
        plane,
        version: identity.version || "",
        tag: identity.tag || "",
        commitSha: identity.commitSha || "",
      });
    }
  }
  return tokens;
}

function identityDisagreements(tokens) {
  const disagreements = [];
  for (let i = 0; i < tokens.length; i += 1) {
    for (let j = i + 1; j < tokens.length; j += 1) {
      const a = tokens[i];
      const b = tokens[j];
      if (a.version && b.version && a.version !== b.version) {
        disagreements.push({
          code: "identity_disagreement",
          field: "version",
          planes: [a.plane, b.plane],
          values: [a.version, b.version],
        });
      }
      if (a.tag && b.tag && a.tag !== b.tag) {
        disagreements.push({
          code: "identity_disagreement",
          field: "tag",
          planes: [a.plane, b.plane],
          values: [a.tag, b.tag],
        });
      }
      if (a.commitSha && b.commitSha && a.commitSha !== b.commitSha) {
        disagreements.push({
          code: "identity_disagreement",
          field: "commitSha",
          planes: [a.plane, b.plane],
          values: [a.commitSha, b.commitSha],
        });
      }
    }
  }
  return disagreements;
}

function testsPassedClaim(text) {
  return typeof text === "string" && /all tests passed/i.test(text);
}

function wrapRawSources(input) {
  if (Array.isArray(input.sources)) return input.sources;
  const sources = [];
  if (input.githubRelease) {
    sources.push({
      id: input.githubRelease.id ? `gh-${input.githubRelease.id}` : "github-release",
      kind: "github-release",
      path: input.path,
      url: input.url,
      contentSha256: input.contentSha256,
      retrievedAt: input.retrievedAt,
      licenseNote: input.licenseNote,
      payload: input.githubRelease,
    });
  }
  for (const plane of PLANES) {
    const doc = input[plane] ?? input.lanes?.[plane];
    // Fixture case wrappers store lane *paths* as strings. Those are not inlined
    // documents — treating them as empty agreeing identities yields a false pass.
    if (!isPlainObject(doc)) continue;
    sources.push({
      id: doc.id || plane,
      plane,
      lane: plane,
      kind: detectSourceKind(doc, { lane: plane }),
      path: doc.path,
      url: doc.url,
      contentSha256: doc.contentSha256 || doc.sha256,
      payload: doc.doc || doc.payload || doc,
    });
  }
  if (input.notice) {
    sources.push({
      id: "notice",
      kind: "notice",
      path: input.notice.path,
      payload: input.notice,
    });
  }
  return sources;
}

function dropForbiddenKeys(plane, payload) {
  if (!payload || typeof payload !== "object") return { payload: {}, dropped: [] };
  const forbidden = new Set();
  if (plane === "announced") {
    ["exitCode", "passCount", "failCount", "skipCount", "command", "passed", "reportPath", "gitHead", "distIntegrity", "artifactDigest", "assetDigests", "tarballUrl", "conclusion", "headSha", "head_sha"].forEach((k) => forbidden.add(k));
  } else if (plane === "shipped") {
    ["body", "title", "claimedFeatures", "htmlUrl", "draft", "prerelease", "publishedAt", "published_at", "changelogText", "releaseNotes", "exitCode", "passCount", "failCount", "skipCount", "command", "passed", "reportPath", "conclusion", "headSha", "head_sha"].forEach((k) => forbidden.add(k));
  } else if (plane === "tested") {
    ["body", "title", "claimedFeatures", "htmlUrl", "draft", "prerelease", "publishedAt", "published_at", "changelogText", "releaseNotes", "tarballUrl", "distIntegrity", "artifactDigest", "gitHead"].forEach((k) => forbidden.add(k));
  }
  const clean = {};
  const dropped = [];
  for (const [key, value] of Object.entries(payload)) {
    if (forbidden.has(key)) dropped.push(key);
    else clean[key] = value;
  }
  return { payload: clean, dropped };
}

function addFinding(findings, finding) {
  requireCitedFinding(finding);
  findings.push(finding);
}

/**
 * Normalize operator input (schema sources, fixture lane docs, or a raw
 * GitHub release object) into plane items + citations + repair codes.
 */
export function normalizeReleaseBriefInput(input = {}) {
  const issues = [];
  const repairs = [];
  const sources = wrapRawSources(input);
  const planes = emptyPlanes();
  const citations = [];
  const citationIds = [];
  const announcedBodies = [];
  const testedConclusions = [];
  let yanked = false;

  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    if (!isPlainObject(source) || hasHostileKey(source)) {
      issues.push(makeIssue({
        kind: "invalid",
        code: hasHostileKey(source) ? "hostile_key" : "invalid_source",
        instancePath: `/sources/${index}`,
        message: "source must be a plain object without hostile keys",
      }));
      continue;
    }
    const doc = loadDoc(source) || {};
    const kind = detectSourceKind(doc, source) || detectSourceKind(source, source);
    const id = firstString(source.id, doc.id, `src-${index}`) || `src-${index}`;

    if (kind === "notice" || kind == null && doc.lanesPresent) {
      const citation = citationFrom(id, undefined, "notice", source, doc);
      delete citation.plane;
      citations.push(citation);
      citationIds.push(id);
      continue;
    }

    if (kind === "github-release" || (isCompoundKind(kind))) {
      const split = source.split && isPlainObject(source.split)
        ? source.split
        : splitGithubRelease(doc);
      const announcedCitationId = `${id}:announced`;
      const announcedCitation = citationFrom(announcedCitationId, "announced", "github-release-notes", source, doc);
      citations.push(announcedCitation);
      citationIds.push(announcedCitationId);
      const announcedIdentity = split.announced?.identity || identityFor("announced", doc);
      const announcedPicked = pickPayload("announced", { ...doc, ...(split.announced?.payload || {}) });
      const announcedClean = dropForbiddenKeys("announced", announcedPicked);
      pushItem(planes, "announced", {
        identity: announcedIdentity,
        payload: announcedClean.payload,
        citationIds: [announcedCitationId],
      });
      announcedBodies.push({
        body: announcedClean.payload.body,
        citationId: announcedCitationId,
        draft: announcedClean.payload.draft === true,
      });
      const draft = announcedClean.payload.draft === true;
      const shippedSplit = split.shipped;
      if (draft && shippedSplit && hasIdentity(shippedSplit.identity)) {
        repairs.push({ code: "draft_not_shipped", citationIds: [announcedCitationId] });
      } else if (!draft && shippedSplit && (hasIdentity(shippedSplit.identity) || (shippedSplit.payload && Object.keys(shippedSplit.payload).length))) {
        // Operator-supplied split.shipped only. Never inferred from tarball_url.
        const shippedCitationId = `${id}:shipped`;
        citations.push(citationFrom(shippedCitationId, "shipped", "git-tag", source, doc));
        const shippedClean = dropForbiddenKeys("shipped", shippedSplit.payload || {});
        if (shippedClean.dropped.length) {
          repairs.push({ code: "plane_conflation", citationIds: [shippedCitationId], dropped: shippedClean.dropped });
        }
        pushItem(planes, "shipped", {
          identity: shippedSplit.identity || identityFor("shipped", shippedSplit.payload || {}),
          payload: shippedClean.payload,
          citationIds: [shippedCitationId],
        });
      }
      continue;
    }

    if (!kind || kind === "notice") {
      issues.push(makeIssue({
        kind: "invalid",
        code: "unknown_source_kind",
        instancePath: `/sources/${index}/kind`,
        message: `cannot classify source ${id}`,
      }));
      continue;
    }

    const naturalPlane = kindPlane(kind);
    const declaredPlane = source.plane || source.lane || doc.lane || null;
    let plane = naturalPlane;
    if (declaredPlane && PLANES.includes(declaredPlane) && declaredPlane !== naturalPlane) {
      repairs.push({
        code: "plane_conflation",
        citationIds: [id],
        declaredPlane,
        naturalPlane,
      });
      plane = naturalPlane;
    }
    if (!plane) {
      issues.push(makeIssue({
        kind: "invalid",
        code: "unknown_source_kind",
        instancePath: `/sources/${index}/kind`,
        message: `kind ${kind} has no plane`,
      }));
      continue;
    }

    const rawPayload = source.payload && !source.payload.tag_name && SOURCE_KINDS[source.kind]
      ? source.payload
      : pickPayload(plane, { ...doc, ...(source.payload || {}) });
    const cleaned = dropForbiddenKeys(plane, rawPayload);
    if (cleaned.dropped.length) {
      repairs.push({ code: "plane_conflation", citationIds: [id], dropped: cleaned.dropped });
    }
    if (plane === "shipped" && (cleaned.payload.draft === true || doc.draft === true)) {
      repairs.push({ code: "draft_not_shipped", citationIds: [id] });
      plane = "announced";
    }
    if (plane === "shipped" && (doc.yanked === true || source.yanked === true || cleaned.payload.yanked === true)) {
      yanked = true;
      repairs.push({ code: "yanked_not_shipped", citationIds: [id] });
      continue;
    }

    const identity = source.identity && isPlainObject(source.identity)
      ? { role: IDENTITY_ROLES[plane], ...source.identity, role: IDENTITY_ROLES[plane] }
      : identityFor(plane, { ...doc, ...(source.identity || {}) });

    const citation = citationFrom(id, plane, kind, source, doc);
    citations.push(citation);
    citationIds.push(id);
    pushItem(planes, plane, {
      identity,
      payload: cleaned.payload,
      citationIds: [id],
    });
    if (plane === "announced") {
      announcedBodies.push({
        body: cleaned.payload.body ?? doc.body,
        citationId: id,
        draft: cleaned.payload.draft === true || doc.draft === true,
      });
    }
    if (plane === "tested") {
      testedConclusions.push({
        conclusion: cleaned.payload.conclusion ?? doc.conclusion,
        passed: cleaned.payload.passed,
        exitCode: cleaned.payload.exitCode,
        citationId: id,
      });
    }
  }

  return {
    issues,
    repairs,
    planes,
    citations,
    citationIds,
    announcedBodies,
    testedConclusions,
    yanked,
    sourceCount: sources.length,
  };
}

function decide({ planes, repairs, disagreements, announcedBodies, testedConclusions, sourceCount, citations }) {
  const announced = planes.announced.items.length;
  const shipped = planes.shipped.items.length;
  const tested = planes.tested.items.length;
  const findings = [];
  const failRepair = repairs.find((row) => FAIL_FINDING_CODES.includes(row.code));
  const cite = (ids) => (ids && ids.length ? ids : citations.slice(0, 1).map((c) => c.id)).filter(Boolean);

  const ciConflicts = [];
  for (const body of announcedBodies) {
    if (!testsPassedClaim(body.body)) continue;
    for (const row of testedConclusions) {
      const failed = row.conclusion && row.conclusion !== "success" || row.passed === false || (typeof row.exitCode === "number" && row.exitCode !== 0);
      if (failed) {
        ciConflicts.push({
          announcedCitationId: body.citationId,
          testedCitationId: row.citationId,
          conclusion: row.conclusion,
        });
      }
    }
  }

  const conflict = disagreements.length > 0 || ciConflicts.length > 0;
  const draftOnly = announcedBodies.some((row) => row.draft) && shipped === 0;

  if (failRepair) {
    addFinding(findings, {
      id: `f-${failRepair.code}`,
      plane: "alignment",
      status: "fail",
      code: failRepair.code,
      message: failRepair.code === "draft_not_shipped"
        ? "draft GitHub release is announced, not shipped"
        : failRepair.code === "yanked_not_shipped"
          ? "yanked registry version is not shipped"
          : "source fields crossed announced/shipped/tested planes",
      citationIds: cite(failRepair.citationIds),
    });
    return { decision: "fail", findings, conflict: false };
  }

  if (draftOnly) {
    const citationIds = announcedBodies.filter((row) => row.draft).map((row) => row.citationId);
    addFinding(findings, {
      id: "f-draft-not-shipped",
      plane: "alignment",
      status: "fail",
      code: "draft_not_shipped",
      message: "draft announcement has published_at null and no shipped-plane source",
      citationIds: cite(citationIds),
    });
    return { decision: "fail", findings, conflict: false };
  }

  if (conflict) {
    for (const row of disagreements) {
      addFinding(findings, {
        id: `f-${row.field}-conflict`,
        plane: "alignment",
        status: "conflict",
        code: "identity_disagreement",
        message: `${row.planes[0]} ${row.field} ${row.values[0]} disagrees with ${row.planes[1]} ${row.values[1]}`,
        citationIds: cite(citations.filter((c) => row.planes.includes(c.plane)).map((c) => c.id)),
      });
    }
    for (const row of ciConflicts) {
      addFinding(findings, {
        id: "f-ci-vs-announce",
        plane: "alignment",
        status: "conflict",
        code: "ci_vs_announce",
        message: `announced body claims All tests passed; tested conclusion is ${row.conclusion}`,
        citationIds: cite([row.announcedCitationId, row.testedCitationId]),
      });
    }
    return { decision: "conflict", findings, conflict: true };
  }

  if (announced === 0 && shipped === 0 && tested === 0) {
    if (citations.length) {
      addFinding(findings, {
        id: "f-empty-sources",
        plane: "alignment",
        status: "fail",
        code: "empty_sources",
        message: "no announced, shipped, or tested documents were supplied",
        citationIds: cite(citations.map((c) => c.id)),
      });
    }
    return { decision: "unknown", findings, conflict: false };
  }

  if (announced && shipped && tested) {
    addFinding(findings, {
      id: "f-aligned",
      plane: "alignment",
      status: "positive",
      code: "three_planes_aligned",
      message: "announced, shipped, and tested identities agree",
      citationIds: cite(citations.map((c) => c.id)),
    });
    return { decision: "pass", findings, conflict: false };
  }

  const status = alignmentStatus({ conflict: false, announced, shipped, tested });
  addFinding(findings, {
    id: `f-${status}`,
    plane: "alignment",
    status: "partial",
    code: status,
    message: `coverage ${status}; planes present announced=${announced} shipped=${shipped} tested=${tested}`,
    citationIds: cite(citations.map((c) => c.id)),
    params: { announced, shipped, tested, sourceCount },
  });
  return { decision: "partial", findings, conflict: false };
}

/**
 * Build an auditable brief. Returns { ok, decision, issues, brief }.
 * Does not invent clock. Does not copy announced facts onto shipped.
 */
export function buildReleaseBrief(input = {}) {
  if (input == null || typeof input !== "object" || Array.isArray(input) || hasHostileKey(input)) {
    return {
      ok: false,
      decision: "fail",
      issues: [makeIssue({
        kind: "invalid",
        code: hasHostileKey(input) ? "hostile_key" : "invalid_input",
        instancePath: "",
        message: "input must be a plain object",
      })],
      brief: null,
    };
  }

  const clock = input.clock;
  const evidenceClass = input.evidenceClass;
  if (clock == null || clock === "" || clock === "now") {
    return {
      ok: false,
      decision: "fail",
      issues: [makeIssue({
        kind: "invalid",
        code: clock === "now" ? "invalid_clock" : "missing_clock",
        instancePath: "/clock",
        message: "operator clock is required; do not invent it",
      })],
      brief: null,
    };
  }
  if (!EVIDENCE_CLASSES.includes(evidenceClass)) {
    return {
      ok: false,
      decision: "fail",
      issues: [makeIssue({
        kind: "invalid",
        code: "invalid_evidence_class",
        instancePath: "/evidenceClass",
        message: `evidenceClass must be one of ${EVIDENCE_CLASSES.join("|")}`,
      })],
      brief: null,
    };
  }

  const normalized = normalizeReleaseBriefInput(input);
  const disagreements = identityDisagreements(identityTokens(normalized.planes));
  const decided = decide({
    planes: normalized.planes,
    repairs: normalized.repairs,
    disagreements,
    announcedBodies: normalized.announcedBodies,
    testedConclusions: normalized.testedConclusions,
    sourceCount: normalized.sourceCount,
    citations: normalized.citations,
  });

  let envelope;
  try {
    envelope = createEnvelope({
      jobId: input.jobId || JOB_ID,
      artifactKind: input.artifactKind || ARTIFACT_KIND,
      clock,
      evidenceClass,
      sources: wrapRawSources(input).map((source) => ({
        id: source.id ?? null,
        kind: source.kind ?? null,
        plane: source.plane ?? source.lane ?? null,
        ...provenanceFields(source),
      })),
      findings: decided.findings,
      decision: decided.decision,
      limitations: [...TRANSFORM_LIMITATIONS],
      citations: normalized.citations,
    });
  } catch (error) {
    return {
      ok: false,
      decision: "fail",
      issues: [makeIssue({
        kind: "invalid",
        code: "envelope_error",
        instancePath: "",
        message: error instanceof Error ? error.message : String(error),
      })],
      brief: null,
    };
  }

  const alignment = {
    status: alignmentStatus({
      conflict: decided.conflict,
      announced: normalized.planes.announced.items.length,
      shipped: normalized.planes.shipped.items.length,
      tested: normalized.planes.tested.items.length,
    }),
    announcedCount: normalized.planes.announced.items.length,
    shippedCount: normalized.planes.shipped.items.length,
    testedCount: normalized.planes.tested.items.length,
  };

  const brief = {
    ...envelope,
    schema: BRIEF_SCHEMA,
    packetSchema: PACKET_SCHEMA,
    inputSchema: INPUT_SCHEMA,
    subject: input.subject ?? null,
    announced: normalized.planes.announced,
    shipped: normalized.planes.shipped,
    tested: normalized.planes.tested,
    alignment,
  };

  const checked = validateReleaseBrief(brief);
  return {
    ok: checked.ok,
    decision: brief.decision,
    impliedDecision: checked.impliedDecision,
    issues: [...normalized.issues, ...checked.issues],
    brief,
    repairs: normalized.repairs,
  };
}

export const transform = buildReleaseBrief;
export const run = buildReleaseBrief;
export const analyze = buildReleaseBrief;
export const transformReleaseBrief = buildReleaseBrief;

function isDirectEntry() {
  const entry = process.argv[1];
  if (!entry) return false;
  return resolvePath(entry) === fileURLToPath(import.meta.url);
}

function fixtureSource(id, plane, relPath) {
  const abs = join(PACK_ROOT, "fixtures/synthetic/release-brief", relPath);
  const bytes = readFileSync(abs);
  return {
    id,
    plane,
    lane: plane,
    path: relPath,
    contentSha256: sha256Hex(bytes),
    licenseNote: "synthetic fixture; not a live capture",
    payload: JSON.parse(bytes.toString("utf8")),
  };
}

function syntheticClock() {
  return "2026-09-10T12:00:00.000Z";
}

function runFixtureCase(id, files) {
  const sources = [];
  for (const [plane, rel] of Object.entries(files)) {
    sources.push(fixtureSource(`${id}-${plane}`, plane === "notice" ? undefined : plane, rel));
  }
  return buildReleaseBrief({
    schema: INPUT_SCHEMA,
    clock: syntheticClock(),
    evidenceClass: "synthetic",
    subject: { name: "demo-release-kit" },
    sources,
  });
}

const CASE_EXPECT = Object.freeze({
  "positive-aligned": "pass",
  "negative-empty": "unknown",
  "negative-draft-only": "fail",
  "partial-missing-tested": "partial",
  "partial-announced-only": "partial",
  "partial-shipped-no-announce": "partial",
  "conflict-tag-mismatch": "conflict",
  "conflict-sha-mismatch": "conflict",
  "conflict-ci-vs-announce": "conflict",
});

function expressFixturePath() {
  return join(PACK_ROOT, "fixtures/real/release-brief/github-express-v5.2.1.json");
}

function runCatalogSelfCheck() {
  const failures = [];
  const synthRoot = join(PACK_ROOT, "fixtures/synthetic/release-brief/sources");
  const cases = {
    "positive-aligned": { announced: "sources/positive-aligned/announced.json", shipped: "sources/positive-aligned/shipped.json", tested: "sources/positive-aligned/tested.json" },
    "negative-empty": { notice: "sources/negative-empty/NOTICE.json" },
    "negative-draft-only": { announced: "sources/negative-draft-only/announced.json" },
    "partial-missing-tested": { announced: "sources/partial-missing-tested/announced.json", shipped: "sources/partial-missing-tested/shipped.json" },
    "partial-announced-only": { announced: "sources/partial-announced-only/announced.json" },
    "partial-shipped-no-announce": { shipped: "sources/partial-shipped-no-announce/shipped.json", tested: "sources/partial-shipped-no-announce/tested.json" },
    "conflict-tag-mismatch": { announced: "sources/conflict-tag-mismatch/announced.json", shipped: "sources/conflict-tag-mismatch/shipped.json", tested: "sources/conflict-tag-mismatch/tested.json" },
    "conflict-sha-mismatch": { announced: "sources/conflict-sha-mismatch/announced.json", shipped: "sources/conflict-sha-mismatch/shipped.json", tested: "sources/conflict-sha-mismatch/tested.json" },
    "conflict-ci-vs-announce": { announced: "sources/conflict-ci-vs-announce/announced.json", shipped: "sources/conflict-ci-vs-announce/shipped.json", tested: "sources/conflict-ci-vs-announce/tested.json" },
  };

  if (existsSync(synthRoot)) {
    for (const [id, files] of Object.entries(cases)) {
      const got = runFixtureCase(id, files);
      const expected = CASE_EXPECT[id];
      if (got.decision !== expected) {
        failures.push({ id, expected, actual: got.decision, issues: codesOf(got.issues) });
      }
      if (got.brief) {
        const checked = validateReleaseBrief(got.brief);
        if (!checked.ok && expected !== "fail") {
          failures.push({ id, where: "brief", codes: codesOf(checked.issues) });
        }
        if (got.brief.shipped.items.some((item) => item.payload && ("body" in item.payload || "draft" in item.payload))) {
          failures.push({ id, where: "shipped-has-announced-fields" });
        }
      }
    }
  }

  for (const testCase of schemaCases()) {
    if (!testCase.input || testCase.expectInputOk !== true) continue;
    const got = buildReleaseBrief(testCase.input);
    if (testCase.expectImplied && got.decision !== testCase.expectImplied && !(testCase.expectImplied === "pass" && got.decision === "pass")) {
      if (got.decision !== testCase.brief?.decision) {
        failures.push({
          id: testCase.id,
          expected: testCase.brief?.decision || testCase.expectImplied,
          actual: got.decision,
        });
      }
    }
    if (got.brief) {
      const checked = validateReleaseBrief(got.brief);
      if (!checked.ok) failures.push({ id: testCase.id, where: "schema-brief", codes: codesOf(checked.issues) });
    }
  }

  const expressPath = expressFixturePath();
  if (existsSync(expressPath)) {
    const bytes = readFileSync(expressPath);
    const payload = JSON.parse(bytes.toString("utf8"));
    const got = buildReleaseBrief({
      schema: INPUT_SCHEMA,
      clock: "2026-09-10T11:23:59Z",
      evidenceClass: "fixture",
      subject: { name: "express", version: "5.2.1" },
      sources: [{
        id: "github-release-express-v5.2.1",
        kind: "github-release",
        path: "fixtures/real/release-brief/github-express-v5.2.1.json",
        url: "https://api.github.com/repos/expressjs/express/releases/tags/v5.2.1",
        contentSha256: sha256Hex(bytes),
        retrievedAt: "2026-09-10T11:23:59Z",
        licenseNote: "express MIT; GitHub REST JSON snapshot; not a legal attestation",
        payload,
      }],
    });
    if (got.decision !== "partial") failures.push({ id: "real-express", expected: "partial", actual: got.decision });
    if (got.brief?.shipped.items.length) failures.push({ id: "real-express", where: "github-release-must-not-ship" });
    if (got.brief?.tested.items.length) failures.push({ id: "real-express", where: "github-release-must-not-test" });
    if (got.brief?.announced.items[0]?.identity?.tag !== "v5.2.1") {
      failures.push({ id: "real-express", where: "tag", actual: got.brief?.announced.items[0]?.identity });
    }
  }

  return failures;
}

if (isDirectEntry() && process.argv.includes("--self-check")) {
  const failures = runCatalogSelfCheck();
  if (failures.length) {
    console.error(JSON.stringify({ ok: false, failures }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({
    ok: true,
    jobId: JOB_ID,
    inputSchema: INPUT_SCHEMA,
    briefSchema: BRIEF_SCHEMA,
    evidenceClass: "synthetic",
  }));
} else if (isDirectEntry()) {
  test("positive: three aligned lanes pass and stay on their planes", () => {
    const root = join(PACK_ROOT, "fixtures/synthetic/release-brief");
    if (!existsSync(join(root, "sources/positive-aligned/announced.json"))) return;
    const got = runFixtureCase("positive-aligned", {
      announced: "sources/positive-aligned/announced.json",
      shipped: "sources/positive-aligned/shipped.json",
      tested: "sources/positive-aligned/tested.json",
    });
    assert.equal(got.decision, "pass");
    assert.equal(got.brief.announced.items.length, 1);
    assert.equal(got.brief.shipped.items.length, 1);
    assert.equal(got.brief.tested.items.length, 1);
    assert.equal(got.brief.shipped.items[0].payload.body, undefined);
    assert.equal(got.brief.announced.items[0].identity.tag, "v1.2.0");
    assert.equal(got.brief.shipped.items[0].identity.commitSha, "ccdead08cda773fe7ca3abc54e8b1a5bc94151f7");
    assert.equal(validateReleaseBrief(got.brief).ok, true);
  });

  test("negative: missing clock is not invented", () => {
    const got = buildReleaseBrief({
      evidenceClass: "synthetic",
      sources: [],
    });
    assert.equal(got.ok, false);
    assert.equal(got.brief, null);
    assert.equal(codesOf(got.issues).includes("missing_clock"), true);
  });

  test("negative: draft announcement is fail, not shipped", () => {
    const root = join(PACK_ROOT, "fixtures/synthetic/release-brief");
    if (!existsSync(join(root, "sources/negative-draft-only/announced.json"))) return;
    const got = runFixtureCase("negative-draft-only", {
      announced: "sources/negative-draft-only/announced.json",
    });
    assert.equal(got.decision, "fail");
    assert.equal(got.brief.shipped.items.length, 0);
    assert.equal(got.brief.findings.some((f) => f.code === "draft_not_shipped"), true);
    assert.equal(validateReleaseBrief(got.brief).ok, true);
  });

  test("negative: empty sources are unknown, not a pass", () => {
    const root = join(PACK_ROOT, "fixtures/synthetic/release-brief");
    if (!existsSync(join(root, "sources/negative-empty/NOTICE.json"))) return;
    const got = runFixtureCase("negative-empty", {
      notice: "sources/negative-empty/NOTICE.json",
    });
    assert.equal(got.decision, "unknown");
    assert.equal(got.brief.announced.items.length, 0);
    assert.equal(got.brief.shipped.items.length, 0);
    assert.equal(got.brief.tested.items.length, 0);
  });

  test("partial: announced+shipped without tests is not pass", () => {
    const root = join(PACK_ROOT, "fixtures/synthetic/release-brief");
    if (!existsSync(join(root, "sources/partial-missing-tested/announced.json"))) return;
    const got = runFixtureCase("partial-missing-tested", {
      announced: "sources/partial-missing-tested/announced.json",
      shipped: "sources/partial-missing-tested/shipped.json",
    });
    assert.equal(got.decision, "partial");
    assert.equal(got.brief.tested.items.length, 0);
    assert.equal(validateReleaseBrief({ ...got.brief, decision: "pass" }).ok, false);
  });

  test("conflict: announced tag vs shipped tag", () => {
    const root = join(PACK_ROOT, "fixtures/synthetic/release-brief");
    if (!existsSync(join(root, "sources/conflict-tag-mismatch/announced.json"))) return;
    const got = runFixtureCase("conflict-tag-mismatch", {
      announced: "sources/conflict-tag-mismatch/announced.json",
      shipped: "sources/conflict-tag-mismatch/shipped.json",
      tested: "sources/conflict-tag-mismatch/tested.json",
    });
    assert.equal(got.decision, "conflict");
    assert.equal(got.brief.findings.some((f) => f.code === "identity_disagreement"), true);
  });

  test("conflict: announced All tests passed vs tested failure", () => {
    const root = join(PACK_ROOT, "fixtures/synthetic/release-brief");
    if (!existsSync(join(root, "sources/conflict-ci-vs-announce/announced.json"))) return;
    const got = runFixtureCase("conflict-ci-vs-announce", {
      announced: "sources/conflict-ci-vs-announce/announced.json",
      shipped: "sources/conflict-ci-vs-announce/shipped.json",
      tested: "sources/conflict-ci-vs-announce/tested.json",
    });
    assert.equal(got.decision, "conflict");
    assert.equal(got.brief.findings.some((f) => f.code === "ci_vs_announce"), true);
    assert.equal(got.brief.tested.items[0].payload.conclusion, "failure");
  });

  test("changelog kind cannot occupy the shipped plane", () => {
    const got = buildReleaseBrief({
      schema: INPUT_SCHEMA,
      clock: "2026-09-10T00:00:00Z",
      evidenceClass: "synthetic",
      sources: [{
        id: "bad-ship",
        plane: "shipped",
        kind: "changelog",
        path: "synthetic://bad-ship",
        contentSha256: sha256Hex("must-not-count-as-shipped"),
        licenseNote: "synthetic",
        identity: { role: "observed", version: "1.2.0" },
        payload: { title: "1.2.0", body: "notes" },
      }],
    });
    assert.equal(got.brief.shipped.items.length, 0);
    assert.equal(got.brief.announced.items.length, 1);
    assert.equal(got.decision, "fail");
    assert.equal(got.brief.findings.some((f) => f.code === "plane_conflation"), true);
  });

  test("real GitHub express v5.2.1 snapshot is announced-only partial", () => {
    const path = expressFixturePath();
    if (!existsSync(path)) return;
    const bytes = readFileSync(path);
    const got = buildReleaseBrief({
      schema: INPUT_SCHEMA,
      clock: "2026-09-10T11:23:59Z",
      evidenceClass: "fixture",
      sources: [{
        id: "github-release-express-v5.2.1",
        kind: "github-release",
        path: "fixtures/real/release-brief/github-express-v5.2.1.json",
        url: "https://api.github.com/repos/expressjs/express/releases/tags/v5.2.1",
        contentSha256: sha256Hex(bytes),
        retrievedAt: "2026-09-10T11:23:59Z",
        licenseNote: "MIT snapshot; not a legal attestation",
        payload: JSON.parse(bytes.toString("utf8")),
      }],
    });
    assert.equal(got.decision, "partial");
    assert.equal(got.brief.announced.items[0].identity.tag, "v5.2.1");
    assert.equal(got.brief.announced.items[0].payload.draft, false);
    assert.equal(got.brief.shipped.items.length, 0, "tarball_url must not become shipped");
    assert.equal(got.brief.tested.items.length, 0);
    assert.equal(got.brief.alignment.status, "announced-only");
    for (const finding of got.brief.findings) {
      assert.ok(finding.citationIds.length >= 1);
    }
  });

  test("self-check catalog matches expected decisions", () => {
    const failures = runCatalogSelfCheck();
    assert.deepEqual(failures, []);
  });
}
