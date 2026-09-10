/**
 * c14 S6 helpers: pin load, fixture hashes, packet-field snapshots.
 * Does not reimplement transform/schema.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, "../../../..");
export const PIN_PATH = join(HERE, "PIN.json");
export const S137 = join(REPO_ROOT, "experiments/s137-consumer-evidence-jobs");

export function loadPin() {
  return JSON.parse(readFileSync(PIN_PATH, "utf8"));
}

export function repoFile(rel) {
  return join(REPO_ROOT, rel);
}

export function sha256File(abs) {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

export function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function asBrief(result) {
  if (!result || typeof result !== "object") return result;
  if (result.brief && typeof result.brief === "object") return result.brief;
  if (result.packet && typeof result.packet === "object") return result.packet;
  return result;
}

export function loadCaseDoc(relPath) {
  return JSON.parse(readFileSync(repoFile(relPath), "utf8"));
}

/** Operator schema input already cited on the synthetic case document. */
export function schemaInputFromCase(caseDoc) {
  if (!caseDoc?.input || typeof caseDoc.input !== "object") {
    throw new Error(`case ${caseDoc?.id || "?"} missing .input`);
  }
  return jsonClone(caseDoc.input);
}

export function packetFieldSnapshot(brief) {
  const findings = Array.isArray(brief.findings) ? brief.findings : [];
  const citations = Array.isArray(brief.citations) ? brief.citations : [];
  return {
    schema: brief.schema ?? null,
    packetSchema: brief.packetSchema ?? null,
    inputSchema: brief.inputSchema ?? null,
    jobId: brief.jobId ?? null,
    artifactKind: brief.artifactKind ?? null,
    clock: brief.clock ?? null,
    evidenceClass: brief.evidenceClass ?? null,
    offline: brief.offline ?? null,
    decision: brief.decision ?? null,
    paymentAttempted: brief.payment?.attempted ?? null,
    assignmentSpendUsd: brief.cost?.assignmentSpendUsd ?? null,
    claims: brief.claims ?? null,
    findingIds: findings.map((row) => row.id).slice().sort(),
    findingCodes: findings.map((row) => row.code ?? null).slice().sort(),
    findingStatuses: findings.map((row) => row.status ?? null).slice().sort(),
    findingCitationIds: findings.map((row) => [...(row.citationIds || [])].sort()),
    citationIds: citations.map((row) => row.id).slice().sort(),
    citationPlanes: citations.map((row) => row.plane ?? null).slice().sort(),
    announcedCount: brief.announced?.items?.length ?? 0,
    shippedCount: brief.shipped?.items?.length ?? 0,
    testedCount: brief.tested?.items?.length ?? 0,
    alignmentStatus: brief.alignment?.status ?? null,
    announcedTags: (brief.announced?.items || []).map((item) => item.identity?.tag ?? null),
    shippedTags: (brief.shipped?.items || []).map((item) => item.identity?.tag ?? null),
    announcedVersions: (brief.announced?.items || []).map((item) => item.identity?.version ?? null),
    shippedVersions: (brief.shipped?.items || []).map((item) => item.identity?.version ?? null),
    testedShas: (brief.tested?.items || []).map((item) => item.identity?.commitSha ?? null),
  };
}

export function realExpressInput(pin) {
  const provenance = JSON.parse(readFileSync(repoFile(pin.realFixture.provenancePath), "utf8"));
  const abs = repoFile(pin.realFixture.path);
  const snapshot = JSON.parse(readFileSync(abs, "utf8"));
  const sha = sha256File(abs);
  function stripV(tag) {
    if (typeof tag !== "string") return undefined;
    return tag.startsWith("v") ? tag.slice(1) : tag;
  }
  return {
    schema: "s137.release-brief.input.v1",
    clock: provenance.clock,
    evidenceClass: "fixture",
    jobId: pin.jobId,
    subject: { name: "express", tag: snapshot.tag_name },
    sources: [{
      id: "github-release-express-v5.2.1",
      kind: "github-release",
      url: provenance.url,
      path: pin.realFixture.path,
      contentSha256: sha,
      retrievedAt: provenance.retrievedAt,
      licenseNote: provenance.license.note,
      split: {
        announced: {
          identity: { role: "claimed", tag: snapshot.tag_name, version: stripV(snapshot.tag_name) },
          payload: {
            title: snapshot.name,
            body: snapshot.body,
            publishedAt: snapshot.published_at,
            draft: snapshot.draft,
            prerelease: snapshot.prerelease,
            htmlUrl: snapshot.html_url,
          },
        },
        shipped: {
          identity: { role: "observed", tag: snapshot.tag_name, version: stripV(snapshot.tag_name) },
          payload: {
            targetCommitish: snapshot.target_commitish,
            tarballUrl: snapshot.tarball_url,
            zipballUrl: snapshot.zipball_url,
          },
        },
      },
    }],
  };
}
