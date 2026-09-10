/**
 * Release evidence brief schema (S137 c06 / R2-CONSUMER-JOBS-02).
 *
 * Announced, shipped, and tested facts are separate planes. Changelog prose
 * cannot prove a ship or a test. Schema validates shapes and plane separation
 * only; it does not parse git, npm, or CI, and it does not fetch the network.
 */

import assert from "node:assert/strict";
import { resolve as resolvePath } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CLOCK_ISO } from "../common/clock.mjs";
import { sha256Hex as sha256Bytes } from "../common/hash.mjs";
import {
  DECISIONS,
  EVIDENCE_CLASSES,
  PACKET_SCHEMA,
  createEnvelope,
  requireCitedFinding,
} from "../packet.mjs";

export const JOB_ID = "R2-CONSUMER-JOBS-02";
export const ARTIFACT_KIND = "release-brief";
export const INPUT_SCHEMA = "s137.release-brief.input.v1";
export const BRIEF_SCHEMA = "s137.release-brief.brief.v1";
export const OUTPUT_SCHEMA = BRIEF_SCHEMA;

export { DECISIONS, EVIDENCE_CLASSES, PACKET_SCHEMA, createEnvelope, requireCitedFinding };

export const PLANES = Object.freeze(["announced", "shipped", "tested"]);
/** c08 fixture vocabulary. Same three lanes as PLANES. */
export const LANES = PLANES;

export const IDENTITY_ROLES = Object.freeze({
  announced: "claimed",
  shipped: "observed",
  tested: "observed",
});

/** Atomic source kinds. Each kind may feed exactly one plane. */
export const SOURCE_KINDS = Object.freeze({
  changelog: { plane: "announced", identityRole: "claimed" },
  "release-notes": { plane: "announced", identityRole: "claimed" },
  "github-release-notes": { plane: "announced", identityRole: "claimed" },
  blog: { plane: "announced", identityRole: "claimed" },
  "git-tag": { plane: "shipped", identityRole: "observed" },
  "git-commit": { plane: "shipped", identityRole: "observed" },
  "git-tree": { plane: "shipped", identityRole: "observed" },
  "npm-packument-version": { plane: "shipped", identityRole: "observed" },
  "npm-tarball-digest": { plane: "shipped", identityRole: "observed" },
  "artifact-digest": { plane: "shipped", identityRole: "observed" },
  "test-receipt": { plane: "tested", identityRole: "observed" },
  "ci-log": { plane: "tested", identityRole: "observed" },
  "coverage-report": { plane: "tested", identityRole: "observed" },
  junit: { plane: "tested", identityRole: "observed" },
  "tap-output": { plane: "tested", identityRole: "observed" },
});

/** Compound GitHub Releases REST object: notes vs tag/commit/artifact must be split. */
export const COMPOUND_KINDS = Object.freeze(["github-release"]);

export const ANNOUNCED_PAYLOAD_FIELDS = Object.freeze([
  "title",
  "name",
  "body",
  "publishedAt",
  "published_at",
  "createdAt",
  "created_at",
  "draft",
  "prerelease",
  "htmlUrl",
  "claimedFeatures",
  "targetCommitish",
  "target_commitish",
]);

export const SHIPPED_PAYLOAD_FIELDS = Object.freeze([
  "targetCommitish",
  "target_commitish",
  "tarballUrl",
  "zipballUrl",
  "gitHead",
  "distIntegrity",
  "artifactDigest",
  "assetDigests",
  "taggedAt",
  "tagged_at",
  "object",
  "ref",
]);

export const TESTED_PAYLOAD_FIELDS = Object.freeze([
  "command",
  "exitCode",
  "passCount",
  "failCount",
  "skipCount",
  "reportPath",
  "passed",
  "conclusion",
  "status",
  "headSha",
  "head_sha",
  "completedAt",
  "completed_at",
]);

const CROSS_PLANE_PAYLOAD = Object.freeze({
  announced: new Set(["exitCode", "passCount", "failCount", "skipCount", "command", "passed", "reportPath", "gitHead", "distIntegrity", "artifactDigest", "assetDigests", "tarballUrl", "conclusion", "headSha", "head_sha"]),
  shipped: new Set(["body", "title", "claimedFeatures", "htmlUrl", "draft", "prerelease", "publishedAt", "published_at", "changelogText", "releaseNotes", "exitCode", "passCount", "failCount", "skipCount", "command", "passed", "reportPath", "conclusion", "headSha", "head_sha"]),
  tested: new Set(["body", "title", "claimedFeatures", "htmlUrl", "draft", "prerelease", "publishedAt", "published_at", "changelogText", "releaseNotes", "tarballUrl", "distIntegrity", "artifactDigest", "gitHead"]),
});

export const ALIGNMENT_STATUSES = Object.freeze([
  "aligned",
  "announced-only",
  "shipped-unannounced",
  "untested",
  "tested-without-ship",
  "partial",
  "conflict",
]);

export const FAIL_FINDING_CODES = Object.freeze([
  "draft_not_shipped",
  "yanked_not_shipped",
  "plane_conflation",
  "invalid_identity_field",
  "invalid_identity",
  "unexpected_schema",
  "identity_role_mismatch",
  "missing_locator",
  "unknown_source_kind",
]);

export const SCHEMA_LIMITATIONS = Object.freeze([
  "Validates input/brief shapes and announced/shipped/tested plane separation only.",
  "Does not parse git, npm registry, CI systems, or changelog prose.",
  "Wording such as 'shipped' or 'tested' inside release notes is announced-only.",
  "Does not invent operator clock, spend, demand, or legal attestation.",
  "Does not fetch network sources; bytes are operator-supplied (fixtures in c08/c09).",
  "Real GitHub/npm captures and PROVENANCE.json belong to c09, not this cell.",
  "Announced target_commitish is a claim (may be a branch name, not a SHA); it is not shipped evidence.",
  "Announced body text such as 'All tests passed' is not a tested-plane conclusion.",
]);

const SHA256_HEX = /^[a-f0-9]{64}$/;
const HOSTILE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const MAX_SOURCES = 256;
const MAX_FINDINGS = 256;
const MAX_ID = 256;

export function sha256Hex(value) {
  if (typeof value === "string" || Buffer.isBuffer(value)) return sha256Bytes(value);
  return sha256Bytes(JSON.stringify(value));
}

export function makeIssue({ kind, code, instancePath, message, params = {} }) {
  return {
    kind,
    code,
    instancePath,
    schemaPath: `#${instancePath}`,
    message,
    params,
  };
}

export function kindPlane(kind) {
  return SOURCE_KINDS[kind]?.plane ?? null;
}

export function isCompoundKind(kind) {
  return COMPOUND_KINDS.includes(kind);
}

export function provenanceFields(source = {}) {
  return {
    retrievedAt: source.retrievedAt ?? null,
    url: source.url ?? null,
    path: source.path ?? null,
    sha256: source.contentSha256 ?? source.sha256 ?? null,
    licenseNote: source.licenseNote ?? null,
  };
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasHostileKey(value, issues, instancePath) {
  if (!value || typeof value !== "object") return false;
  for (const key of Object.keys(value)) {
    if (HOSTILE_KEYS.has(key)) {
      issues.push(makeIssue({
        kind: "invalid",
        code: "hostile_key",
        instancePath,
        message: `hostile key ${key} is not allowed`,
        params: { key },
      }));
      return true;
    }
  }
  return false;
}

function requireClock(clock, issues, instancePath = "/clock") {
  if (clock == null || clock === "") {
    issues.push(makeIssue({
      kind: "invalid",
      code: "missing_clock",
      instancePath,
      message: "operator clock is required; do not invent it",
    }));
    return;
  }
  if (typeof clock !== "string" || clock === "now" || !CLOCK_ISO.test(clock)) {
    issues.push(makeIssue({
      kind: "invalid",
      code: "invalid_clock",
      instancePath,
      message: "clock must be ISO-8601 with timezone; 'now' is refused",
      params: { clock },
    }));
  }
}

function requireEvidenceClass(evidenceClass, issues, instancePath = "/evidenceClass") {
  if (!EVIDENCE_CLASSES.includes(evidenceClass)) {
    issues.push(makeIssue({
      kind: "invalid",
      code: "invalid_evidence_class",
      instancePath,
      message: `evidenceClass must be one of ${EVIDENCE_CLASSES.join("|")}`,
      params: { evidenceClass },
    }));
  }
}

function requireLocator(record, issues, instancePath, extraParams = {}) {
  const path = typeof record.path === "string" ? record.path.trim() : "";
  const url = typeof record.url === "string" ? record.url.trim() : "";
  if (!path && !url) {
    issues.push(makeIssue({
      kind: "invalid",
      code: "missing_locator",
      instancePath,
      message: "citation/source needs path or url",
      params: extraParams,
    }));
  }
}

function requireSha256(value, issues, instancePath, { required }) {
  if (value == null || value === "") {
    if (required) {
      issues.push(makeIssue({
        kind: "invalid",
        code: "missing_content_sha256",
        instancePath,
        message: "fixture and live-capture sources require contentSha256",
      }));
    }
    return;
  }
  if (typeof value !== "string" || !SHA256_HEX.test(value)) {
    issues.push(makeIssue({
      kind: "invalid",
      code: "invalid_content_sha256",
      instancePath,
      message: "contentSha256 must be 64 lowercase or mixed hex chars",
    }));
  }
}

function validateIdentity(identity, plane, issues, instancePath) {
  if (identity == null) return;
  if (!isPlainObject(identity) || hasHostileKey(identity, issues, instancePath)) {
    if (identity != null && !isPlainObject(identity)) {
      issues.push(makeIssue({
        kind: "invalid",
        code: "invalid_identity",
        instancePath,
        message: "identity must be a plain object",
      }));
    }
    return;
  }
  const expectedRole = IDENTITY_ROLES[plane];
  if (owns(identity,"role") && (expectedRole ? identity.role !== expectedRole : !Object.values(IDENTITY_ROLES).includes(identity.role))) {
    issues.push(makeIssue({
      kind: "invalid",
      code: "identity_role_mismatch",
      instancePath: `${instancePath}/role`,
      message: `${plane} identity.role must be ${expectedRole}, not ${identity.role}`,
      params: { plane, expectedRole, role: identity.role },
    }));
  }
  for (const key of ["version", "tag", "commitSha"]) {
    if (owns(identity,key) && typeof identity[key] !== "string") {
      issues.push(makeIssue({
        kind: "invalid",
        code: "invalid_identity_field",
        instancePath: `${instancePath}/${key}`,
        message: `identity.${key} must be a string`,
      }));
    }
  }
}

function validatePayload(payload, plane, issues, instancePath) {
  if (payload == null) return;
  if (!isPlainObject(payload) || hasHostileKey(payload, issues, instancePath)) {
    if (payload != null && !isPlainObject(payload)) {
      issues.push(makeIssue({
        kind: "invalid",
        code: "invalid_payload",
        instancePath,
        message: "payload must be a plain object",
      }));
    }
    return;
  }
  const forbidden = CROSS_PLANE_PAYLOAD[plane] || new Set();
  for (const key of Object.keys(payload)) {
    if (forbidden.has(key)) {
      issues.push(makeIssue({
        kind: "invalid",
        code: "plane_conflation",
        instancePath: `${instancePath}/${key}`,
        message: `payload.${key} is not allowed on the ${plane} plane`,
        params: { plane, key },
      }));
    }
  }
  if (plane === "shipped" && payload.draft === true) {
    issues.push(makeIssue({
      kind: "invalid",
      code: "draft_not_shipped",
      instancePath: `${instancePath}/draft`,
      message: "a draft GitHub release is announced, not shipped",
    }));
  }
}

function sourcePlane(source) {
  if (PLANES.includes(source.plane)) return source.plane;
  if (PLANES.includes(source.lane)) return source.lane;
  return source.plane ?? source.lane;
}

function validateAtomicSource(source, issues, instancePath) {
  const spec = SOURCE_KINDS[source.kind];
  const plane = sourcePlane(source) ?? spec?.plane;
  if (!spec) {
    issues.push(makeIssue({
      kind: "invalid",
      code: "unknown_source_kind",
      instancePath: `${instancePath}/kind`,
      message: `unknown source kind ${source.kind}`,
      params: { kind: source.kind },
    }));
    return;
  }
  if (plane != null && plane !== spec.plane) {
    issues.push(makeIssue({
      kind: "invalid",
      code: "kind_plane_mismatch",
      instancePath: `${instancePath}/plane`,
      message: `kind ${source.kind} belongs on plane ${spec.plane}, not ${plane}`,
      params: { kind: source.kind, expectedPlane: spec.plane, plane },
    }));
  }
  validateIdentity(source.identity ?? source.fields?.identity, plane, issues, `${instancePath}/identity`);
  validatePayload(source.payload ?? source.fields?.payload, plane, issues, `${instancePath}/payload`);
}

function validateCompoundSource(source, issues, instancePath) {
  const split = source.split;
  if (!isPlainObject(split)) {
    issues.push(makeIssue({
      kind: "invalid",
      code: "compound_split_required",
      instancePath: `${instancePath}/split`,
      message: "github-release must split announced notes from shipped tag/commit/artifact fields",
    }));
    return;
  }
  hasHostileKey(split, issues, `${instancePath}/split`);
  if (split.tested != null) {
    issues.push(makeIssue({
      kind: "invalid",
      code: "plane_conflation",
      instancePath: `${instancePath}/split/tested`,
      message: "GitHub Releases JSON is not tested evidence",
    }));
  }
  const announced = split.announced;
  if (!isPlainObject(announced)) {
    issues.push(makeIssue({
      kind: "invalid",
      code: "compound_announced_required",
      instancePath: `${instancePath}/split/announced`,
      message: "github-release.split.announced is required",
    }));
  } else {
    validateDeclarations(announced, "announced", issues, `${instancePath}/split/announced`);
    validatePayload(announced.payload, "announced", issues, `${instancePath}/split/announced/payload`);
  }
  const shipped = split.shipped;
  if (shipped != null) {
    if (!isPlainObject(shipped)) {
      issues.push(makeIssue({
        kind: "invalid",
        code: "invalid_compound_shipped",
        instancePath: `${instancePath}/split/shipped`,
        message: "github-release.split.shipped must be a plain object when present",
      }));
    } else {
      validateDeclarations(shipped, "shipped", issues, `${instancePath}/split/shipped`);
      validatePayload(shipped.payload, "shipped", issues, `${instancePath}/split/shipped/payload`);
    }
  }
  const draft = announced?.payload?.draft === true;
  if (draft && shipped && hasIdentity(shipped.identity)) {
    issues.push(makeIssue({
      kind: "invalid",
      code: "draft_not_shipped",
      instancePath: `${instancePath}/split/shipped`,
      message: "draft github-release cannot carry shipped identity",
    }));
  }
}

export const IDENTITY_LINK_FIELDS = Object.freeze(["version", "tag", "commitSha"]);

/** Only non-empty strings count as linking evidence. Numbers/objects are not identities. */
export function linkingIdentity(identity) {
  const out = {};
  if (!identity || typeof identity !== "object") return out;
  for (const key of IDENTITY_LINK_FIELDS) {
    const value = identity[key];
    if (typeof value === "string" && value.trim()) out[key] = value.trim();
  }
  return out;
}

export function hasLinkingIdentity(identity) {
  const fields = linkingIdentity(identity);
  return IDENTITY_LINK_FIELDS.some((key) => Boolean(fields[key]));
}

export function isExplicitSourceKind(kind) {
  return typeof kind === "string" && kind.trim().length > 0;
}

export function isKnownSourceKind(kind) {
  if (!isExplicitSourceKind(kind)) return false;
  const trimmed = kind.trim();
  return Object.hasOwn(SOURCE_KINDS, trimmed) || isCompoundKind(trimmed) || trimmed === "notice";
}

/** Only explicitly documented omissions are normalization notices.
 * Every validation error rejects; new error codes cannot silently become repairs.
 */
export function isStrictInputReject(issue) {
  return Boolean(issue && issue.kind === "invalid");
}

function normalization(issues, code, instancePath, message) {
  issues.push(makeIssue({kind:"normalization",code,instancePath,message}));
}

const owns = (record,key) => Object.prototype.hasOwnProperty.call(record,key);

function validateDeclarations(record, plane, issues, at) {
  for(const key of ['identity','payload','fields','doc']) {
    if(!owns(record,key)) continue;
    const value=record[key];
    if(!isPlainObject(value)) {
      issues.push(makeIssue({kind:'invalid',code:`invalid_${key}`,instancePath:`${at}/${key}`,message:`${key} must be a plain object when supplied`}));
    } else {
      hasHostileKey(value,issues,`${at}/${key}`);
      if(key==='fields'||key==='doc') validateDeclarations(value,plane,issues,`${at}/${key}`);
    }
  }
  for(const key of ['plane','lane']) {
    if(owns(record,key) && !PLANES.includes(record[key])) issues.push(makeIssue({kind:'invalid',code:'invalid_plane',instancePath:`${at}/${key}`,message:`${key} must be one of ${PLANES.join('|')}`,params:{plane:record[key],explicit:true}}));
  }
  if(owns(record,'plane') && owns(record,'lane') && record.plane!==record.lane) issues.push(makeIssue({kind:'invalid',code:'kind_plane_mismatch',instancePath:`${at}/lane`,message:'plane and lane declarations disagree'}));
  if(owns(record,'kind') && !isKnownSourceKind(record.kind)) issues.push(makeIssue({kind:'invalid',code:'unknown_source_kind',instancePath:`${at}/kind`,message:'unknown source kind',params:{kind:record.kind}}));
  for(const key of ['path','url']) if(owns(record,key) && record[key]!==null && (typeof record[key]!=='string'||!record[key].trim())) issues.push(makeIssue({kind:'invalid',code:'invalid_locator',instancePath:`${at}/${key}`,message:`${key} must be a nonempty string or null`}));
  if (kindPlane(record.kind) && plane && kindPlane(record.kind) !== plane) issues.push(makeIssue({kind:'invalid',code:'kind_plane_mismatch',instancePath:`${at}/kind`,message:'kind and containing plane disagree'}));
  if(owns(record,'identity')) validateIdentity(record.identity,plane,issues,`${at}/identity`);
  if(owns(record,'payload') && isPlainObject(record.payload) && PLANES.includes(plane)) validatePayload(record.payload,plane,issues,`${at}/payload`);
}

function hasIdentity(identity) {
  return hasLinkingIdentity(identity);
}

function planeLinkUnion(items) {
  const union = {};
  const internalConflicts = [];
  for (const item of items || []) {
    const fields = linkingIdentity(item?.identity);
    for (const [key, value] of Object.entries(fields)) {
      if (union[key] && union[key] !== value) {
        internalConflicts.push({ field: key, values: [union[key], value] });
      } else {
        union[key] = value;
      }
    }
  }
  return { union, internalConflicts, hasLink: Object.keys(union).length > 0 };
}

/**
 * Identity linkage across announced/shipped/tested.
 * Graph nodes are items (not plane unions): a tag on announced A and a SHA on
 * unrelated announced B must not bridge shipped(tag) to tested(SHA).
 * Pass requires a connected item component covering announced+shipped+tested.
 * Empty identities → missing (partial). Disjoint/noncomparable → unknown.
 */
export function assessIdentityAlignment(briefOrPlanes) {
  const blocks = {};
  for (const plane of PLANES) {
    blocks[plane] = briefOrPlanes?.[plane]?.items || [];
  }
  const present = PLANES.filter((plane) => blocks[plane].length > 0);
  const unions = {};
  const disagreements = [];
  let missing = false;
  const nodes = [];
  for (const plane of present) {
    const { union, internalConflicts, hasLink } = planeLinkUnion(blocks[plane]);
    unions[plane] = union;
    if (!hasLink) missing = true;
    for (const row of internalConflicts) {
      disagreements.push({
        code: "identity_disagreement",
        field: row.field,
        planes: [plane, plane],
        values: row.values,
      });
    }
    (blocks[plane] || []).forEach((item, index) => {
      const fields = linkingIdentity(item?.identity);
      if (!Object.keys(fields).length) return;
      nodes.push({ id: `${plane}:${index}`, plane, fields });
    });
  }
  for (let i = 0; i < present.length; i += 1) {
    for (let j = i + 1; j < present.length; j += 1) {
      const a = present[i];
      const b = present[j];
      for (const key of IDENTITY_LINK_FIELDS) {
        if (unions[a][key] && unions[b][key] && unions[a][key] !== unions[b][key]) {
          disagreements.push({
            code: "identity_disagreement",
            field: key,
            planes: [a, b],
            values: [unions[a][key], unions[b][key]],
          });
        }
      }
    }
  }
  const adj = new Map(nodes.map((node) => [node.id, new Set()]));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      const share = IDENTITY_LINK_FIELDS.some(
        (key) => a.fields[key] && b.fields[key] && a.fields[key] === b.fields[key],
      );
      if (share) {
        adj.get(a.id).add(b.id);
        adj.get(b.id).add(a.id);
      }
    }
  }
  let coversThree = false;
  const seenGlobal = new Set();
  for (const node of nodes) {
    if (seenGlobal.has(node.id)) continue;
    const seen = new Set();
    const stack = [node.id];
    const planesIn = new Set();
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      seenGlobal.add(id);
      const current = byId.get(id);
      if (current) planesIn.add(current.plane);
      for (const next of adj.get(id) || []) stack.push(next);
    }
    if (planesIn.has("announced") && planesIn.has("shipped") && planesIn.has("tested")) {
      coversThree = true;
    }
  }
  const conflict = disagreements.length > 0;
  const allThree = present.length === 3;
  const linked = allThree && !missing && !conflict && coversThree;
  const disjoint = allThree && !missing && !conflict && !coversThree;
  return {
    present,
    missing,
    conflict,
    linked,
    disjoint,
    disagreements,
    unions,
  };
}

function validateProvenance(source, issues, instancePath, evidenceClass) {
  const shaRequired = evidenceClass === "fixture" || evidenceClass === "live-capture";
  for(const key of ['contentSha256','sha256']) if(owns(source,key)) requireSha256(source[key],issues,`${instancePath}/${key}`,{required:true});
  if(!owns(source,'contentSha256') && !owns(source,'sha256')) {
    if(shaRequired) requireSha256(undefined,issues,`${instancePath}/contentSha256`,{required:true});
  }
  if (source.retrievedAt != null) requireClock(source.retrievedAt, issues, `${instancePath}/retrievedAt`);
  if (source.licenseNote != null && typeof source.licenseNote !== "string") {
    issues.push(makeIssue({
      kind: "invalid",
      code: "invalid_license_note",
      instancePath: `${instancePath}/licenseNote`,
      message: "licenseNote must be a string",
    }));
  }
}

function validateSource(source, index, issues, evidenceClass) {
  const instancePath = typeof index === "string" ? index : `/sources/${index}`;
  if (!isPlainObject(source) || hasHostileKey(source, issues, instancePath)) {
    if (!isPlainObject(source)) {
      issues.push(makeIssue({
        kind: "invalid",
        code: "invalid_source",
        instancePath,
        message: "source must be a plain object",
      }));
    }
    return;
  }
  validateDeclarations(source, sourcePlane(source) ?? kindPlane(source.kind), issues, instancePath);
  if(!owns(source,'id')) normalization(issues,'invalid_source_id',`${instancePath}/id`,'absent id receives a deterministic local id');
  else if (typeof source.id !== "string" || !source.id.trim() || source.id.length > MAX_ID) {
    issues.push(makeIssue({
      kind: "invalid",
      code: "invalid_source_id",
      instancePath: `${instancePath}/id`,
      message: "source.id is required",
    }));
  }
  if (isCompoundKind(source.kind)) {
    const plane = sourcePlane(source);
    if (plane && plane !== "announced") {
      issues.push(makeIssue({
        kind: "invalid",
        code: "compound_plane",
        instancePath: `${instancePath}/plane`,
        message: "github-release is a compound source; use split, not a single non-announced plane",
      }));
    }
    validateCompoundSource(source, issues, instancePath);
  } else if(source.kind !== 'notice') {
    const plane = sourcePlane(source) ?? kindPlane(source.kind);
    if (!PLANES.includes(plane)) {
      if(!owns(source,'plane') && !owns(source,'lane')) normalization(issues,'invalid_plane',`${instancePath}/plane`,'absent plane may be inferred from document kind');
    } else {
      if(!owns(source,'kind')) normalization(issues,'unknown_source_kind',`${instancePath}/kind`,'absent kind may be inferred from the document');
      else validateAtomicSource(source, issues, instancePath);
    }
  }
  const explicitKind = typeof source.kind === "string" ? source.kind.trim() : "";
  if(!source.path && !source.url && !owns(source,'kind')) normalization(issues,'missing_locator',instancePath,'absent convenience locator receives a synthetic local citation');
  else requireLocator(source, issues, instancePath, explicitKind ? {kind:explicitKind}:{});
  validateProvenance(source, issues, instancePath, evidenceClass);
}

/**
 * Validate operator-supplied commit/release inputs.
 * Missing tested sources are allowed (partial). Plane conflation is invalid.
 */
export function validateReleaseBriefInput(input) {
  const issues = [];
  if (!isPlainObject(input) || hasHostileKey(input, issues, "")) {
    if (!isPlainObject(input)) {
      issues.push(makeIssue({
        kind: "invalid",
        code: "invalid_input",
        instancePath: "",
        message: "input must be a plain object",
      }));
    }
    return finishValidation(issues);
  }
  if (owns(input,"schema") && input.schema !== INPUT_SCHEMA) {
    issues.push(makeIssue({
      kind: "invalid",
      code: "unexpected_schema",
      instancePath: "/schema",
      message: `schema must be ${INPUT_SCHEMA}`,
      params: { schema: input.schema },
    }));
  }
  requireClock(input.clock, issues);
  requireEvidenceClass(input.evidenceClass, issues);
  if (input.subject != null) {
    if (!isPlainObject(input.subject)) {
      issues.push(makeIssue({
        kind: "invalid",
        code: "invalid_subject",
        instancePath: "/subject",
        message: "subject must be a plain object",
      }));
    } else {
      hasHostileKey(input.subject, issues, "/subject");
    }
  }
  if (!owns(input,'sources')) {
    normalization(issues,'missing_sources','/sources','absent sources[] may use raw lane documents');
    if(owns(input,'lanes') && !isPlainObject(input.lanes)) issues.push(makeIssue({kind:'invalid',code:'invalid_sources',instancePath:'/lanes',message:'lanes must be an object'}));
    for(const plane of PLANES) for(const [record,at] of [[input,`/${plane}`],[input.lanes,`/lanes/${plane}`]]) {
      if(!isPlainObject(record)||!owns(record,plane))continue;
      const doc=record[plane];
      if(!isPlainObject(doc)){issues.push(makeIssue({kind:'invalid',code:'invalid_source',instancePath:at,message:'raw lane must be an object'}));continue;}
      validateDeclarations(doc,plane,issues,at);
      validateProvenance(doc,issues,at,input.evidenceClass);
      if(owns(doc,'id') && (typeof doc.id!=='string'||!doc.id.trim()))issues.push(makeIssue({kind:'invalid',code:'invalid_source_id',instancePath:`${at}/id`,message:'source.id must be a nonempty string'}));
    }
    for (const key of ['githubRelease','notice']) if (owns(input,key)) {
      if (!isPlainObject(input[key])) issues.push(makeIssue({kind:'invalid',code:'invalid_source',instancePath:`/${key}`,message:`${key} must be an object`}));
      else validateDeclarations(input[key], key === 'githubRelease' ? 'announced' : null, issues, `/${key}`);
    }
    if (owns(input,'githubRelease')) validateProvenance(input,issues,'',input.evidenceClass);
  } else if (!Array.isArray(input.sources)) {
    issues.push(makeIssue({kind:'invalid',code:'missing_sources',instancePath:'/sources',message:'supplied sources must be an array'}));
  } else if (input.sources.length > MAX_SOURCES) {
    issues.push(makeIssue({
      kind: "invalid",
      code: "too_many_sources",
      instancePath: "/sources",
      message: `sources exceeds ${MAX_SOURCES}`,
    }));
  } else {
    const ids = new Set();
    for (let i = 0; i < input.sources.length; i += 1) {
      const source = input.sources[i];
      validateSource(source, i, issues, input.evidenceClass);
      if (source && typeof source.id === "string") {
        if (ids.has(source.id)) {
          issues.push(makeIssue({
            kind: "invalid",
            code: "duplicate_source_id",
            instancePath: `/sources/${i}/id`,
            message: `duplicate source id ${source.id}`,
            params: { id: source.id },
          }));
        }
        ids.add(source.id);
      }
    }
  }
  const errors=issues.filter(isStrictInputReject);
  return {...finishValidation(errors), normalization:issues.filter(i=>i.kind==='normalization')};
}

function finishValidation(issues, extra = {}) {
  const ok = issues.length === 0;
  return { ok, status: ok ? "ok" : "invalid", issues, ...extra };
}

function citationIndex(citations) {
  const map = new Map();
  if (!Array.isArray(citations)) return map;
  for (const citation of citations) {
    if (citation && typeof citation.id === "string") map.set(citation.id, citation);
  }
  return map;
}

function validateFinding(finding, index, issues, citations) {
  const instancePath = `/findings/${index}`;
  if (!isPlainObject(finding) || hasHostileKey(finding, issues, instancePath)) {
    if (!isPlainObject(finding)) {
      issues.push(makeIssue({
        kind: "invalid",
        code: "invalid_finding",
        instancePath,
        message: "finding must be a plain object",
      }));
    }
    return;
  }
  try {
    requireCitedFinding(finding);
  } catch (error) {
    issues.push(makeIssue({
      kind: "invalid",
      code: "uncited_finding",
      instancePath: `${instancePath}/citationIds`,
      message: error instanceof Error ? error.message : String(error),
    }));
    return;
  }
  for (const citationId of finding.citationIds) {
    if (!citations.has(citationId)) {
      issues.push(makeIssue({
        kind: "invalid",
        code: "dangling_citation",
        instancePath: `${instancePath}/citationIds`,
        message: `citationId ${citationId} is not in citations[]`,
        params: { citationId },
      }));
    }
  }
  if (finding.plane && finding.plane !== "alignment" && PLANES.includes(finding.plane)) {
    for (const citationId of finding.citationIds) {
      const citation = citations.get(citationId);
      if (citation && citation.plane && citation.plane !== finding.plane && finding.plane !== "alignment") {
        issues.push(makeIssue({
          kind: "invalid",
          code: "plane_conflation",
          instancePath: `${instancePath}/citationIds`,
          message: `finding plane ${finding.plane} cites ${citation.plane} citation ${citationId}`,
          params: { findingPlane: finding.plane, citationPlane: citation.plane, citationId },
        }));
      }
    }
  }
}

function validateCitation(citation, index, issues, evidenceClass) {
  const instancePath = `/citations/${index}`;
  if (!isPlainObject(citation) || hasHostileKey(citation, issues, instancePath)) {
    if (!isPlainObject(citation)) {
      issues.push(makeIssue({
        kind: "invalid",
        code: "invalid_citation",
        instancePath,
        message: "citation must be a plain object",
      }));
    }
    return;
  }
  if (typeof citation.id !== "string" || !citation.id) {
    issues.push(makeIssue({
      kind: "invalid",
      code: "invalid_citation_id",
      instancePath: `${instancePath}/id`,
      message: "citation.id is required",
    }));
  }
  if (citation.plane && !PLANES.includes(citation.plane)) {
    issues.push(makeIssue({
      kind: "invalid",
      code: "invalid_plane",
      instancePath: `${instancePath}/plane`,
      message: `citation.plane must be one of ${PLANES.join("|")}`,
    }));
  }
  requireLocator(citation, issues, instancePath);
  const shaRequired = evidenceClass === "fixture" || evidenceClass === "live-capture";
  requireSha256(citation.contentSha256 ?? citation.sha256, issues, `${instancePath}/contentSha256`, { required: shaRequired });
}

function planeItems(brief, plane) {
  const block = brief?.[plane];
  if (!block || !Array.isArray(block.items)) return [];
  return block.items;
}

function itemIdentity(item) {
  return item?.identity && typeof item.identity === "object" ? item.identity : {};
}

function identityToken(identity) {
  const version = identity.version || "";
  const tag = identity.tag || "";
  const commitSha = identity.commitSha || "";
  return { version, tag, commitSha };
}

export function impliedDecision(brief) {
  if (brief?.findings?.some(f=>f?.status === "fail")) return "fail";
  if (!brief || typeof brief !== "object") return "unknown";
  const assessment = assessIdentityAlignment(brief);
  if (assessment.conflict) return "conflict";
  if (assessment.linked) return "pass";
  if (assessment.present.length === 0) return "unknown";
  if (assessment.disjoint) return "unknown";
  return "partial";
}

function validatePlaneBlock(brief, plane, issues, citations) {
  const block = brief[plane];
  const instancePath = `/${plane}`;
  if (block == null) return;
  if (!isPlainObject(block) || hasHostileKey(block, issues, instancePath)) {
    if (!isPlainObject(block)) {
      issues.push(makeIssue({
        kind: "invalid",
        code: "invalid_plane_block",
        instancePath,
        message: `${plane} must be a plain object with items[]`,
      }));
    }
    return;
  }
  if (!Array.isArray(block.items)) {
    issues.push(makeIssue({
      kind: "invalid",
      code: "missing_plane_items",
      instancePath: `${instancePath}/items`,
      message: `${plane}.items must be an array`,
    }));
    return;
  }
  for (let i = 0; i < block.items.length; i += 1) {
    const item = block.items[i];
    const itemPath = `${instancePath}/items/${i}`;
    if (!isPlainObject(item)) {
      issues.push(makeIssue({
        kind: "invalid",
        code: "invalid_plane_item",
        instancePath: itemPath,
        message: `${plane} item must be a plain object`,
      }));
      continue;
    }
    validateIdentity(item.identity, plane, issues, `${itemPath}/identity`);
    validatePayload(item.payload, plane, issues, `${itemPath}/payload`);
    try {
      requireCitedFinding({ citationIds: item.citationIds });
    } catch {
      issues.push(makeIssue({
        kind: "invalid",
        code: "uncited_finding",
        instancePath: `${itemPath}/citationIds`,
        message: `every ${plane} item must cite at least one citationId`,
      }));
      continue;
    }
    for (const citationId of item.citationIds) {
      const citation = citations.get(citationId);
      if (!citation) {
        issues.push(makeIssue({
          kind: "invalid",
          code: "dangling_citation",
          instancePath: `${itemPath}/citationIds`,
          message: `citationId ${citationId} is not in citations[]`,
          params: { citationId },
        }));
        continue;
      }
      if (citation.plane && citation.plane !== plane) {
        issues.push(makeIssue({
          kind: "invalid",
          code: "plane_conflation",
          instancePath: `${itemPath}/citationIds`,
          message: `${plane} item cannot cite a ${citation.plane} source`,
          params: { plane, citationPlane: citation.plane, citationId },
        }));
      }
    }
  }
}

function claimsForbidden(claims, issues) {
  if (claims == null) return;
  if (!isPlainObject(claims)) {
    issues.push(makeIssue({
      kind: "invalid",
      code: "invalid_claims",
      instancePath: "/claims",
      message: "claims must be a plain object",
    }));
    return;
  }
  const requiredFalse = [
    "inventsFacts",
    "paidEndpoint",
    "legalAttestation",
    "modelAsOracle",
    "assertsCustomerDemand",
  ];
  for (const key of requiredFalse) {
    if (claims[key] === true) {
      issues.push(makeIssue({
        kind: "invalid",
        code: "forbidden_claim",
        instancePath: `/claims/${key}`,
        message: `claims.${key} must be false`,
        params: { key },
      }));
    }
  }
}

/**
 * Validate an auditable brief. Pass requires all three planes, aligned identities,
 * and citations that stay on their plane.
 */
export function validateReleaseBrief(brief) {
  const issues = [];
  if (!isPlainObject(brief) || hasHostileKey(brief, issues, "")) {
    if (!isPlainObject(brief)) {
      issues.push(makeIssue({
        kind: "invalid",
        code: "invalid_brief",
        instancePath: "",
        message: "brief must be a plain object",
      }));
    }
    return finishValidation(issues, { impliedDecision: "unknown" });
  }
  if (brief.schema != null && brief.schema !== BRIEF_SCHEMA && brief.schema !== PACKET_SCHEMA) {
    issues.push(makeIssue({
      kind: "invalid",
      code: "unexpected_schema",
      instancePath: "/schema",
      message: `schema must be ${BRIEF_SCHEMA} (packet envelope ${PACKET_SCHEMA} also accepted)`,
      params: { schema: brief.schema },
    }));
  }
  requireClock(brief.clock, issues);
  requireEvidenceClass(brief.evidenceClass, issues);
  if (brief.decision != null && !DECISIONS.includes(brief.decision)) {
    issues.push(makeIssue({
      kind: "invalid",
      code: "invalid_decision",
      instancePath: "/decision",
      message: `decision must be one of ${DECISIONS.join("|")}`,
    }));
  }
  if (brief.payment && brief.payment.attempted === true) {
    issues.push(makeIssue({
      kind: "invalid",
      code: "payment_attempted",
      instancePath: "/payment/attempted",
      message: "this job is offline; payment.attempted must be false",
    }));
  }
  claimsForbidden(brief.claims, issues);

  if (!Array.isArray(brief.citations)) {
    issues.push(makeIssue({
      kind: "invalid",
      code: "missing_citations",
      instancePath: "/citations",
      message: "citations[] is required",
    }));
  } else {
    for (let i = 0; i < brief.citations.length; i += 1) {
      validateCitation(brief.citations[i], i, issues, brief.evidenceClass);
    }
  }
  const citations = citationIndex(brief.citations);

  for (const plane of PLANES) validatePlaneBlock(brief, plane, issues, citations);

  if (!Array.isArray(brief.findings)) {
    issues.push(makeIssue({
      kind: "invalid",
      code: "missing_findings",
      instancePath: "/findings",
      message: "findings[] is required",
    }));
  } else if (brief.findings.length > MAX_FINDINGS) {
    issues.push(makeIssue({
      kind: "invalid",
      code: "too_many_findings",
      instancePath: "/findings",
      message: `findings exceeds ${MAX_FINDINGS}`,
    }));
  } else {
    for (let i = 0; i < brief.findings.length; i += 1) {
      validateFinding(brief.findings[i], i, issues, citations);
    }
  }

  const implied = impliedDecision(brief);
  if (brief.decision === "pass" && implied !== "pass") {
    issues.push(makeIssue({
      kind: "invalid",
      code: "decision_mismatch",
      instancePath: "/decision",
      message: `decision pass requires aligned announced+shipped+tested; implied ${implied}`,
      params: { decision: brief.decision, implied },
    }));
  }
  if (brief.decision === "partial" && implied === "conflict") {
    issues.push(makeIssue({
      kind: "invalid",
      code: "decision_mismatch",
      instancePath: "/decision",
      message: "identity disagreement across planes is conflict, not partial",
      params: { decision: brief.decision, implied },
    }));
  }
  if (brief.decision === "conflict" && implied !== "conflict") {
    const hasConflictFinding = Array.isArray(brief.findings)
      && brief.findings.some((finding) => finding && finding.status === "conflict");
    if (!hasConflictFinding) {
      issues.push(makeIssue({
        kind: "invalid",
        code: "decision_mismatch",
        instancePath: "/decision",
        message: "decision conflict requires identity disagreement or a conflict finding",
      }));
    }
  }
  if (brief.decision === "fail") {
    const hasFail = Array.isArray(brief.findings)
      && brief.findings.some((finding) => finding && finding.status === "fail");
    if (!hasFail) {
      issues.push(makeIssue({
        kind: "invalid",
        code: "decision_mismatch",
        instancePath: "/decision",
        message: "decision fail requires a fail finding",
      }));
    }
  }

  return finishValidation(issues, { impliedDecision: implied });
}

export function validateInput(input) {
  return validateReleaseBriefInput(input);
}

export function validateOutput(brief) {
  return validateReleaseBrief(brief);
}

function sourceStub({ id, plane, kind, body, identity, payload, evidenceClass = "synthetic" }) {
  const text = body ?? `${id}:${kind}`;
  const digest = sha256Hex(text);
  return {
    id,
    plane,
    kind,
    path: `synthetic://${id}`,
    contentSha256: digest,
    licenseNote: "synthetic fixture; not a live capture",
    identity: identity ?? { role: IDENTITY_ROLES[plane] },
    payload: payload ?? {},
    evidenceClass,
  };
}

function citationFromSource(source) {
  return {
    id: source.id,
    plane: source.plane,
    kind: source.kind,
    path: source.path,
    url: source.url,
    contentSha256: source.contentSha256,
    licenseNote: source.licenseNote,
  };
}

const CLOCK = "2026-09-10T00:00:00Z";

function alignedSources() {
  const announced = sourceStub({
    id: "ann-changelog",
    plane: "announced",
    kind: "changelog",
    body: "synthetic-changelog-v1.2.0",
    identity: { role: "claimed", version: "1.2.0", tag: "v1.2.0" },
    payload: { title: "1.2.0", body: "synthetic changelog for 1.2.0" },
  });
  const shipped = sourceStub({
    id: "ship-tag",
    plane: "shipped",
    kind: "git-tag",
    body: "synthetic-git-tag-v1.2.0",
    identity: { role: "observed", version: "1.2.0", tag: "v1.2.0", commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    payload: { targetCommitish: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
  });
  const tested = sourceStub({
    id: "test-receipt",
    plane: "tested",
    kind: "test-receipt",
    body: "synthetic-test-receipt-v1.2.0",
    identity: { role: "observed", version: "1.2.0", commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    payload: { command: "node --test", exitCode: 0, passCount: 3, failCount: 0 },
  });
  return [announced, shipped, tested];
}

function briefFromSources(sources, { decision, findings, extraPlanes } = {}) {
  const citations = sources.filter((source) => !isCompoundKind(source.kind)).map(citationFromSource);
  if (sources.some((source) => isCompoundKind(source.kind))) {
    for (const source of sources) {
      if (!isCompoundKind(source.kind)) continue;
      citations.push({
        id: `${source.id}:announced`,
        plane: "announced",
        kind: "github-release-notes",
        path: source.path,
        contentSha256: source.contentSha256,
        licenseNote: source.licenseNote,
      });
    }
  }
  const planes = { announced: { items: [] }, shipped: { items: [] }, tested: { items: [] } };
  for (const source of sources) {
    if (isCompoundKind(source.kind)) continue;
    planes[source.plane].items.push({
      identity: source.identity,
      payload: source.payload,
      citationIds: [source.id],
    });
  }
  if (extraPlanes) {
    for (const plane of PLANES) {
      if (extraPlanes[plane]) planes[plane] = extraPlanes[plane];
    }
  }
  return {
    schema: BRIEF_SCHEMA,
    jobId: JOB_ID,
    artifactKind: ARTIFACT_KIND,
    clock: CLOCK,
    evidenceClass: "synthetic",
    offline: true,
    payment: { attempted: false },
    cost: { assignmentSpendUsd: 0, note: "offline transform; no purchase; do not invent demand" },
    announced: planes.announced,
    shipped: planes.shipped,
    tested: planes.tested,
    findings: findings ?? [
      {
        id: "f-aligned",
        plane: "alignment",
        status: "positive",
        code: "three_planes_aligned",
        message: "announced, shipped, and tested identities match on synthetic 1.2.0",
        citationIds: sources.map((source) => source.id),
      },
    ],
    citations,
    decision: decision ?? "pass",
    limitations: [...SCHEMA_LIMITATIONS],
    claims: {
      inventsFacts: false,
      paidEndpoint: false,
      legalAttestation: false,
      modelAsOracle: false,
      assertsCustomerDemand: false,
    },
  };
}

/**
 * Schema-level positive / negative / partial / conflict examples.
 * Synthetic only. Not live captures. Fixture files belong to c08/c09.
 */
export function schemaCases() {
  const aligned = alignedSources();
  const announcedShipped = aligned.slice(0, 2);
  const conflictShipped = sourceStub({
    id: "ship-tag-other",
    plane: "shipped",
    kind: "git-tag",
    body: "synthetic-git-tag-v1.1.9",
    identity: { role: "observed", version: "1.1.9", tag: "v1.1.9" },
    payload: { targetCommitish: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
  });
  const testedOtherCommit = sourceStub({
    id: "test-other-sha",
    plane: "tested",
    kind: "test-receipt",
    body: "synthetic-test-other-sha",
    identity: { role: "observed", version: "1.2.0", commitSha: "cccccccccccccccccccccccccccccccccccccccc" },
    payload: { command: "node --test", exitCode: 0, passCount: 1, failCount: 0 },
  });

  return Object.freeze([
    {
      id: "positive.three-plane-aligned",
      kind: "positive",
      evidenceClass: "synthetic",
      input: {
        schema: INPUT_SCHEMA,
        clock: CLOCK,
        evidenceClass: "synthetic",
        subject: { name: "example-lib", version: "1.2.0" },
        sources: aligned,
      },
      brief: briefFromSources(aligned),
      expectInputOk: true,
      expectBriefOk: true,
    },
    {
      id: "negative.changelog-as-shipped",
      kind: "negative",
      evidenceClass: "synthetic",
      input: {
        schema: INPUT_SCHEMA,
        clock: CLOCK,
        evidenceClass: "synthetic",
        sources: [
          sourceStub({
            id: "bad-ship",
            plane: "shipped",
            kind: "changelog",
            body: "must-not-count-as-shipped",
            identity: { role: "observed", version: "1.2.0" },
          }),
        ],
      },
      expectInputOk: false,
      expectIssueCodes: ["kind_plane_mismatch"],
    },
    {
      id: "negative.missing-clock",
      kind: "negative",
      evidenceClass: "synthetic",
      input: {
        schema: INPUT_SCHEMA,
        evidenceClass: "synthetic",
        sources: aligned,
      },
      expectInputOk: false,
      expectIssueCodes: ["missing_clock"],
    },
    {
      id: "negative.uncited-finding",
      kind: "negative",
      evidenceClass: "synthetic",
      brief: {
        ...briefFromSources(aligned),
        findings: [{ id: "bare", status: "positive", code: "bare", message: "no citations" }],
      },
      expectBriefOk: false,
      expectIssueCodes: ["uncited_finding"],
    },
    {
      id: "negative.notes-body-on-shipped",
      kind: "negative",
      evidenceClass: "synthetic",
      input: {
        schema: INPUT_SCHEMA,
        clock: CLOCK,
        evidenceClass: "synthetic",
        sources: [
          sourceStub({
            id: "tag-with-notes",
            plane: "shipped",
            kind: "git-tag",
            body: "tag-plus-notes",
            identity: { role: "observed", tag: "v1.2.0" },
            payload: { body: "this changelog text must not live on shipped" },
          }),
        ],
      },
      expectInputOk: false,
      expectIssueCodes: ["plane_conflation"],
    },
    {
      id: "negative.github-release-unsplit",
      kind: "negative",
      evidenceClass: "synthetic",
      input: {
        schema: INPUT_SCHEMA,
        clock: CLOCK,
        evidenceClass: "synthetic",
        sources: [{
          id: "gh-unsplit",
          kind: "github-release",
          path: "synthetic://github-release.json",
          contentSha256: sha256Hex("unsplit"),
          licenseNote: "synthetic",
          payload: { body: "notes", tag_name: "v1.2.0", target_commitish: "main" },
        }],
      },
      expectInputOk: false,
      expectIssueCodes: ["compound_split_required"],
    },
    {
      id: "negative.draft-as-shipped",
      kind: "negative",
      evidenceClass: "synthetic",
      input: {
        schema: INPUT_SCHEMA,
        clock: CLOCK,
        evidenceClass: "synthetic",
        sources: [{
          id: "gh-draft",
          kind: "github-release",
          path: "synthetic://github-release-draft.json",
          contentSha256: sha256Hex("draft"),
          licenseNote: "synthetic",
          split: {
            announced: {
              identity: { role: "claimed", tag: "v1.2.0" },
              payload: { draft: true, body: "draft notes" },
            },
            shipped: {
              identity: { role: "observed", tag: "v1.2.0", commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
              payload: { targetCommitish: "main" },
            },
          },
        }],
      },
      expectInputOk: false,
      expectIssueCodes: ["draft_not_shipped"],
    },
    {
      id: "negative.test-receipt-as-announced",
      kind: "negative",
      evidenceClass: "synthetic",
      input: {
        schema: INPUT_SCHEMA,
        clock: CLOCK,
        evidenceClass: "synthetic",
        sources: [
          sourceStub({
            id: "bad-ann",
            plane: "announced",
            kind: "test-receipt",
            identity: { role: "claimed", version: "1.2.0" },
            payload: { command: "node --test", exitCode: 0 },
          }),
        ],
      },
      expectInputOk: false,
      expectIssueCodes: ["kind_plane_mismatch"],
    },
    {
      id: "partial.announced-and-shipped-untested",
      kind: "partial",
      evidenceClass: "synthetic",
      input: {
        schema: INPUT_SCHEMA,
        clock: CLOCK,
        evidenceClass: "synthetic",
        subject: { name: "example-lib", version: "1.2.0" },
        sources: announcedShipped,
      },
      brief: briefFromSources(announcedShipped, {
        decision: "partial",
        findings: [{
          id: "f-untested",
          plane: "alignment",
          status: "partial",
          code: "untested",
          message: "announced and shipped 1.2.0 have no tested-plane source",
          citationIds: announcedShipped.map((source) => source.id),
        }],
      }),
      expectInputOk: true,
      expectBriefOk: true,
      expectImplied: "partial",
    },
    {
      id: "partial.pass-without-tested-rejected",
      kind: "negative",
      evidenceClass: "synthetic",
      brief: briefFromSources(announcedShipped, { decision: "pass" }),
      expectBriefOk: false,
      expectIssueCodes: ["decision_mismatch"],
    },
    {
      id: "conflict.announced-version-vs-shipped-tag",
      kind: "conflict",
      evidenceClass: "synthetic",
      input: {
        schema: INPUT_SCHEMA,
        clock: CLOCK,
        evidenceClass: "synthetic",
        sources: [aligned[0], conflictShipped],
      },
      brief: briefFromSources([aligned[0], conflictShipped], {
        decision: "conflict",
        findings: [{
          id: "f-version-conflict",
          plane: "alignment",
          status: "conflict",
          code: "identity_disagreement",
          message: "announced 1.2.0 disagrees with shipped 1.1.9",
          citationIds: ["ann-changelog", "ship-tag-other"],
        }],
      }),
      expectInputOk: true,
      expectBriefOk: true,
      expectImplied: "conflict",
    },
    {
      id: "conflict.tested-commit-vs-shipped-commit",
      kind: "conflict",
      evidenceClass: "synthetic",
      input: {
        schema: INPUT_SCHEMA,
        clock: CLOCK,
        evidenceClass: "synthetic",
        sources: [aligned[0], aligned[1], testedOtherCommit],
      },
      brief: briefFromSources([aligned[0], aligned[1], testedOtherCommit], {
        decision: "conflict",
        findings: [{
          id: "f-sha-conflict",
          plane: "alignment",
          status: "conflict",
          code: "identity_disagreement",
          message: "tested commitSha disagrees with shipped commitSha",
          citationIds: ["ship-tag", "test-other-sha"],
        }],
      }),
      expectInputOk: true,
      expectBriefOk: true,
      expectImplied: "conflict",
    },
    {
      id: "negative.legal-attestation",
      kind: "negative",
      evidenceClass: "synthetic",
      brief: {
        ...briefFromSources(aligned),
        claims: {
          inventsFacts: false,
          paidEndpoint: false,
          legalAttestation: true,
          modelAsOracle: false,
          assertsCustomerDemand: false,
        },
      },
      expectBriefOk: false,
      expectIssueCodes: ["forbidden_claim"],
    },
    {
      id: "negative.now-clock",
      kind: "negative",
      evidenceClass: "synthetic",
      input: {
        schema: INPUT_SCHEMA,
        clock: "now",
        evidenceClass: "synthetic",
        sources: aligned,
      },
      expectInputOk: false,
      expectIssueCodes: ["invalid_clock"],
    },
    {
      id: "negative.citation-without-locator",
      kind: "negative",
      evidenceClass: "synthetic",
      brief: {
        ...briefFromSources(aligned),
        citations: [{ id: "ann-changelog", plane: "announced", kind: "changelog", contentSha256: sha256Hex("x") }],
      },
      expectBriefOk: false,
      expectIssueCodes: ["missing_locator"],
    },
    {
      id: "negative.tested-item-cites-announced",
      kind: "negative",
      evidenceClass: "synthetic",
      brief: briefFromSources(aligned, {
        extraPlanes: {
          tested: {
            items: [{
              identity: { role: "observed", version: "1.2.0" },
              payload: { command: "node --test", exitCode: 0 },
              citationIds: ["ann-changelog"],
            }],
          },
        },
      }),
      expectBriefOk: false,
      expectIssueCodes: ["plane_conflation"],
    },
  ]);
}

export function codesOf(issues) {
  return [...new Set((issues || []).map((issue) => issue.code))];
}

export function runCaseCatalog() {
  const results = [];
  for (const testCase of schemaCases()) {
    const row = { id: testCase.id, kind: testCase.kind, ok: true, failures: [] };
    if (testCase.input) {
      const got = validateReleaseBriefInput(testCase.input);
      if (got.ok !== testCase.expectInputOk) {
        row.ok = false;
        row.failures.push({ where: "input.ok", expected: testCase.expectInputOk, actual: got.ok, codes: codesOf(got.issues) });
      }
      if (testCase.expectIssueCodes && testCase.expectInputOk === false) {
        const codes = codesOf(got.issues);
        for (const code of testCase.expectIssueCodes) {
          if (!codes.includes(code)) {
            row.ok = false;
            row.failures.push({ where: "input.codes", missing: code, codes });
          }
        }
      }
    }
    if (testCase.brief) {
      const got = validateReleaseBrief(testCase.brief);
      if (testCase.expectBriefOk != null && got.ok !== testCase.expectBriefOk) {
        row.ok = false;
        row.failures.push({ where: "brief.ok", expected: testCase.expectBriefOk, actual: got.ok, codes: codesOf(got.issues) });
      }
      if (testCase.expectImplied && got.impliedDecision !== testCase.expectImplied) {
        row.ok = false;
        row.failures.push({ where: "implied", expected: testCase.expectImplied, actual: got.impliedDecision });
      }
      if (testCase.expectIssueCodes && testCase.expectBriefOk === false) {
        const codes = codesOf(got.issues);
        for (const code of testCase.expectIssueCodes) {
          if (!codes.includes(code)) {
            row.ok = false;
            row.failures.push({ where: "brief.codes", missing: code, codes });
          }
        }
      }
    }
    results.push(row);
  }
  return results;
}

function isDirectEntry() {
  const entry = process.argv[1];
  if (!entry) return false;
  return resolvePath(entry) === fileURLToPath(import.meta.url);
}

if (isDirectEntry() && process.argv.includes("--self-check")) {
  const results = runCaseCatalog();
  const failed = results.filter((row) => !row.ok);
  if (failed.length) {
    console.error(JSON.stringify({ ok: false, failed }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({
    ok: true,
    cases: results.length,
    kinds: [...new Set(results.map((row) => row.kind))],
    inputSchema: INPUT_SCHEMA,
    briefSchema: BRIEF_SCHEMA,
  }));
} else if (isDirectEntry()) {
  test("schema case catalog covers positive, negative, partial, conflict", () => {
    const kinds = new Set(schemaCases().map((testCase) => testCase.kind));
    for (const kind of ["positive", "negative", "partial", "conflict"]) {
      assert.equal(kinds.has(kind), true, `missing ${kind} case`);
    }
  });

  test("every catalog case matches expected validation", () => {
    const results = runCaseCatalog();
    const failed = results.filter((row) => !row.ok);
    assert.deepEqual(failed, []);
  });

  test("kind catalog binds changelog to announced only", () => {
    assert.equal(kindPlane("changelog"), "announced");
    assert.equal(kindPlane("git-tag"), "shipped");
    assert.equal(kindPlane("test-receipt"), "tested");
  });

  test("github-release body on shipped split is plane conflation", () => {
    const got = validateReleaseBriefInput({
      schema: INPUT_SCHEMA,
      clock: CLOCK,
      evidenceClass: "synthetic",
      sources: [{
        id: "gh",
        kind: "github-release",
        path: "synthetic://gh.json",
        contentSha256: sha256Hex("gh"),
        split: {
          announced: { identity: { role: "claimed", tag: "v1.0.0" }, payload: { body: "notes" } },
          shipped: { identity: { role: "observed", tag: "v1.0.0" }, payload: { body: "notes again" } },
        },
      }],
    });
    assert.equal(got.ok, false);
    assert.equal(codesOf(got.issues).includes("plane_conflation"), true);
  });

  test("fixture sources require sha256; synthetic may omit it", () => {
    const source = {
      id: "ann",
      plane: "announced",
      kind: "changelog",
      path: "synthetic://ann",
      identity: { role: "claimed", version: "1.0.0" },
      payload: { body: "notes" },
    };
    const synthetic = validateReleaseBriefInput({
      schema: INPUT_SCHEMA,
      clock: CLOCK,
      evidenceClass: "synthetic",
      sources: [source],
    });
    assert.equal(synthetic.ok, true);
    const fixture = validateReleaseBriefInput({
      schema: INPUT_SCHEMA,
      clock: CLOCK,
      evidenceClass: "fixture",
      sources: [source],
    });
    assert.equal(fixture.ok, false);
    assert.equal(codesOf(fixture.issues).includes("missing_content_sha256"), true);
  });

  test("hostile constructor key is invalid", () => {
    const input = {
      schema: INPUT_SCHEMA,
      clock: CLOCK,
      evidenceClass: "synthetic",
      sources: [],
      constructor: { plane: "shipped" },
    };
    const got = validateReleaseBriefInput(input);
    assert.equal(got.ok, false);
    assert.equal(codesOf(got.issues).includes("hostile_key"), true);
  });

  test("impliedDecision does not treat changelog-only as pass", () => {
    const brief = briefFromSources([alignedSources()[0]], {
      decision: "partial",
      findings: [{
        id: "f",
        plane: "alignment",
        status: "partial",
        code: "announced-only",
        message: "only announced",
        citationIds: ["ann-changelog"],
      }],
    });
    assert.equal(impliedDecision(brief), "partial");
    assert.equal(validateReleaseBrief({ ...brief, decision: "pass" }).ok, false);
  });

  test("lane alias and announced target_commitish are claimed, not shipped", () => {
    const claimedBranch = validateInput({
      schema: INPUT_SCHEMA,
      clock: CLOCK,
      evidenceClass: "synthetic",
      sources: [
        sourceStub({
          id: "ann-gh",
          plane: "announced",
          kind: "github-release-notes",
          identity: { role: "claimed", tag: "v1.2.0" },
          payload: { body: "notes", draft: false, target_commitish: "master" },
        }),
      ],
    });
    assert.equal(claimedBranch.ok, true, JSON.stringify(claimedBranch.issues));
    const withLane = validateInput({
      schema: INPUT_SCHEMA,
      clock: CLOCK,
      evidenceClass: "synthetic",
      sources: [{
        id: "ann-lane",
        lane: "announced",
        kind: "changelog",
        path: "synthetic://ann-lane",
        contentSha256: sha256Hex("ann-lane"),
        identity: { role: "claimed", tag: "v1.2.0" },
        payload: { body: "announced only" },
      }],
    });
    assert.equal(withLane.ok, true);
    assert.equal(withLane.status, "ok");
  });
}
