import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const casesDir = join(root, "corpus/cases");

export const CASE_SCHEMA = "samedaydesk.interop-corpus.case.v1";
export const OUTCOME_CLASSES = Object.freeze([
  "successful",
  "known_failure",
  "unsupported",
  "not_applicable",
  "harness_failure",
]);
export const PUBLICATION = Object.freeze(["public-repo-merged", "public-repo-draft-pr", "repo-internal"]);
export const NEGATIVE_KINDS = Object.freeze(["test-failure", "protocol-refusal", "detection-gap"]);
export const REPLAY_KINDS = Object.freeze(["unknown-tool-mapper", "era-pin-refusal", "source-drift"]);

const SHA = /^[0-9a-f]{40}$/;
const CASE_ID = /^CK-N12-[0-9]{3}$/;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadPin() {
  return readJson(join(root, "PIN.json"));
}

export function loadProfile() {
  return readJson(join(root, "profile/page-change-free.profile.json"));
}

export function loadResiduals() {
  return readJson(join(root, "corpus/residuals.json"));
}

export function loadSkipped() {
  return readJson(join(root, "corpus/SKIPPED.json"));
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Returns a list of problems. An empty list means the case keeps every
 * preserved field: author, allowed publication, fixture provenance, source
 * versions, earlier negative, recovery, and outcome classes.
 */
export function caseProblems(value) {
  const problems = [];
  const need = (ok, message) => { if (!ok) problems.push(message); };
  if (!isRecord(value)) return ["case must be an object"];
  need(value.schema === CASE_SCHEMA, `schema must be ${CASE_SCHEMA}`);
  need(typeof value.id === "string" && CASE_ID.test(value.id), "id must match CK-N12-NNN");
  need(nonEmptyString(value.title), "title is required");
  need(nonEmptyString(value.faultSurface), "faultSurface is required");

  need(isRecord(value.author) && nonEmptyString(value.author.name) && nonEmptyString(value.author.role),
    "author.name and author.role are required");

  const pub = value.publication;
  need(isRecord(pub) && PUBLICATION.includes(pub.allowed), `publication.allowed must be one of ${PUBLICATION.join(", ")}`);
  need(isRecord(pub) && nonEmptyString(pub.basis), "publication.basis is required");
  need(isRecord(pub) && Array.isArray(pub.restrictions), "publication.restrictions must be an array");

  const prov = value.fixtureProvenance;
  need(Array.isArray(prov) && prov.length > 0, "fixtureProvenance must be a non-empty array");
  if (Array.isArray(prov)) {
    prov.forEach((entry, index) => {
      const at = `fixtureProvenance[${index}]`;
      if (!isRecord(entry)) { problems.push(`${at} must be an object`); return; }
      need(nonEmptyString(entry.role), `${at}.role is required`);
      need(nonEmptyString(entry.path), `${at}.path is required`);
      const gitRef = nonEmptyString(entry.repo) && SHA.test(entry.commit || "") && SHA.test(entry.gitBlobSha || "");
      const pkgRef = nonEmptyString(entry.package) && nonEmptyString(entry.version) && nonEmptyString(entry.quote);
      need(gitRef || pkgRef, `${at} needs repo+commit+gitBlobSha or package+version+quote`);
    });
  }

  const sv = value.sourceVersions;
  need(isRecord(sv) && Array.isArray(sv.clientSdk) && sv.clientSdk.length > 0, "sourceVersions.clientSdk is required");
  need(isRecord(sv) && nonEmptyString(sv.serverProtocol), "sourceVersions.serverProtocol is required");
  need(isRecord(sv) && (nonEmptyString(sv.serviceVersion) || isRecord(sv.serviceVersion)), "sourceVersions.serviceVersion is required");
  need(isRecord(sv) && SHA.test(sv.merchantCommit || ""), "sourceVersions.merchantCommit must be a 40-hex sha");

  const neg = value.earlierNegative;
  need(isRecord(neg) && NEGATIVE_KINDS.includes(neg.kind), `earlierNegative.kind must be one of ${NEGATIVE_KINDS.join(", ")}`);
  need(isRecord(neg) && SHA.test(neg.commit || ""), "earlierNegative.commit must be a 40-hex sha");
  need(isRecord(neg) && nonEmptyString(neg.result), "earlierNegative.result is required");
  need(isRecord(neg) && nonEmptyString(neg.cause), "earlierNegative.cause is required");
  need(isRecord(neg) && isRecord(neg.evidence), "earlierNegative.evidence is required");
  need(isRecord(neg) && isRecord(neg.signature), "earlierNegative.signature is required");

  need(value.fix === null || (isRecord(value.fix) && SHA.test(value.fix.commit || "")), "fix must be null or carry a 40-hex commit");

  const rec = value.recovery;
  need(isRecord(rec) && nonEmptyString(rec.action) && isRecord(rec.expected) && nonEmptyString(rec.implementation),
    "recovery.action, recovery.expected, recovery.implementation are required");

  const oc = value.outcomeClass;
  need(isRecord(oc) && OUTCOME_CLASSES.includes(oc.earlierNegative), "outcomeClass.earlierNegative must be an outcome class");
  need(isRecord(oc) && OUTCOME_CLASSES.includes(oc.changedImplementation), "outcomeClass.changedImplementation must be an outcome class");

  need(isRecord(value.replay) && REPLAY_KINDS.includes(value.replay.kind), `replay.kind must be one of ${REPLAY_KINDS.join(", ")}`);
  if (value.runnerMatch !== undefined) {
    const rm = value.runnerMatch;
    need(isRecord(rm) && nonEmptyString(rm.revision) && nonEmptyString(rm.scenario) && nonEmptyString(rm.checkId) && nonEmptyString(rm.errorPattern),
      "runnerMatch needs revision, scenario, checkId, errorPattern");
  }
  need(nonEmptyString(value.consumer), "consumer is required");
  return problems;
}

export function validateCase(value) {
  const problems = caseProblems(value);
  if (problems.length) {
    const error = new Error(`invalid corpus case ${value?.id ?? "(no id)"}: ${problems.join("; ")}`);
    error.code = "corpus_case_invalid";
    error.problems = problems;
    throw error;
  }
  return value;
}

export function loadCorpus({ dir = casesDir } = {}) {
  const files = readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
  const cases = files.map((name) => validateCase(readJson(join(dir, name))));
  const ids = new Set();
  for (const entry of cases) {
    if (ids.has(entry.id)) throw new Error(`duplicate corpus case id ${entry.id}`);
    ids.add(entry.id);
  }
  return cases;
}

export function getCase(id, cases = loadCorpus()) {
  const found = cases.find((entry) => entry.id === id);
  if (!found) throw new Error(`unknown corpus case ${id}`);
  return found;
}
