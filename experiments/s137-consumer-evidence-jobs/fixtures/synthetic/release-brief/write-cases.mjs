#!/usr/bin/env node
/**
 * One-shot authoring helper: hash lane sources and write cited case files + PROVENANCE.
 * Not a runtime transform. Does not invent announced/shipped/tested facts.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256File, stableJson } from "./hash.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const CLOCK = readFileSync(join(root, "CLOCK.txt"), "utf8").trim();
const JOB_ID = "R2-CONSUMER-JOBS-02";
const ARTIFACT_KIND = "release-brief";

const KIND_BY_LANE = {
  announced: "github-release-notes",
  shipped: "git-tag",
  tested: "ci-log",
};

const ROLE_BY_LANE = {
  announced: "claimed",
  shipped: "observed",
  tested: "observed",
};

function versionFromTag(tag) {
  if (typeof tag !== "string") return undefined;
  return tag.startsWith("v") ? tag.slice(1) : tag;
}

function citation(id, lane, relPath, extra = {}) {
  const digest = sha256File(join(root, relPath));
  return {
    id,
    lane,
    plane: lane,
    kind: extra.kind ?? (lane ? KIND_BY_LANE[lane] : undefined),
    path: relPath,
    sha256: digest,
    contentSha256: digest,
    evidenceClass: "synthetic",
  };
}

function finding(id, kind, summary, citationIds, extra = {}) {
  return { id, kind, summary, citationIds, ...extra };
}

function identityFor(lane, doc) {
  const role = ROLE_BY_LANE[lane];
  const tag = doc.tag_name ?? undefined;
  const commitSha =
    doc.target_commitish ??
    doc.object?.sha ??
    doc.head_sha ??
    undefined;
  const identity = { role };
  if (tag) {
    identity.tag = tag;
    identity.version = versionFromTag(tag);
  }
  if (commitSha) identity.commitSha = commitSha;
  return identity;
}

function payloadFor(lane, doc) {
  if (lane === "announced") {
    return {
      name: doc.name,
      body: doc.body,
      draft: doc.draft,
      prerelease: doc.prerelease,
      published_at: doc.published_at,
      created_at: doc.created_at,
      target_commitish: doc.target_commitish,
    };
  }
  if (lane === "shipped") {
    return {
      ref: doc.ref,
      object: doc.object,
      tagged_at: doc.tagged_at,
    };
  }
  return {
    name: doc.name,
    status: doc.status,
    conclusion: doc.conclusion,
    completed_at: doc.completed_at,
    head_sha: doc.head_sha,
  };
}

function sourceFromLane(cit, lane, relPath) {
  const doc = JSON.parse(readFileSync(join(root, relPath), "utf8"));
  return {
    id: cit.id,
    plane: lane,
    lane,
    kind: doc.kind ?? KIND_BY_LANE[lane],
    path: relPath,
    sha256: cit.sha256,
    contentSha256: cit.contentSha256,
    evidenceClass: "synthetic",
    identity: identityFor(lane, doc),
    payload: payloadFor(lane, doc),
  };
}

const CASE_SPECS = [
  {
    id: "positive-aligned",
    caseClass: "positive",
    title: "Announced, shipped, and tested agree on tag and SHA",
    notes: "Published v1.2.0; same commit SHA in all three lanes; CI success.",
    lanes: {
      announced: "sources/positive-aligned/announced.json",
      shipped: "sources/positive-aligned/shipped.json",
      tested: "sources/positive-aligned/tested.json",
    },
    expect: {
      decision: "pass",
      laneCoverage: { announced: true, shipped: true, tested: true },
      tagAgreement: true,
      shaAgreement: true,
      disagreementCodes: [],
    },
    findingBuilders: (cites) => [
      finding(
        "lanes-present",
        "coverage",
        "announced, shipped, and tested source documents are present",
        cites.map((c) => c.id),
      ),
      finding(
        "tag-sha-aligned",
        "alignment",
        "tag_name v1.2.0 and commit SHA match across announced.target_commitish, shipped.object.sha, and tested.head_sha",
        cites.map((c) => c.id),
      ),
      finding(
        "published-not-draft",
        "announced",
        "announced.draft is false and published_at is set",
        ["cit-announced"],
      ),
      finding(
        "ci-success",
        "tested",
        "tested.conclusion is success on the shipped SHA",
        ["cit-shipped", "cit-tested"],
      ),
    ],
  },
  {
    id: "negative-empty",
    caseClass: "negative",
    title: "No announced, shipped, or tested inputs",
    notes: "Empty input. NOTICE.json records that all three lanes are absent.",
    lanes: { announced: null, shipped: null, tested: null },
    extraCitations: [citation("cit-notice", null, "sources/negative-empty/NOTICE.json")],
    expect: {
      decision: "unknown",
      laneCoverage: { announced: false, shipped: false, tested: false },
      tagAgreement: null,
      shaAgreement: null,
      disagreementCodes: [],
    },
    findingBuilders: (cites) => [
      finding(
        "no-lanes",
        "coverage",
        "no announced, shipped, or tested documents were supplied",
        cites.map((c) => c.id),
      ),
    ],
  },
  {
    id: "negative-draft-only",
    caseClass: "negative",
    title: "Unpublished draft announcement only",
    notes: "draft: true and published_at: null. No shipped tag. No CI receipt.",
    lanes: {
      announced: "sources/negative-draft-only/announced.json",
      shipped: null,
      tested: null,
    },
    expect: {
      decision: "fail",
      laneCoverage: { announced: true, shipped: false, tested: false },
      tagAgreement: null,
      shaAgreement: null,
      disagreementCodes: ["unpublished_draft"],
    },
    findingBuilders: () => [
      finding(
        "unpublished-draft",
        "announced",
        "announced.draft is true and published_at is null; not a published release",
        ["cit-announced"],
        { code: "draft_not_shipped", plane: "announced" },
      ),
      finding(
        "no-shipped-tested",
        "coverage",
        "shipped and tested lanes are absent",
        ["cit-announced"],
      ),
    ],
  },
  {
    id: "partial-missing-tested",
    caseClass: "partial",
    title: "Announced and shipped agree; tested lane absent",
    notes: "Coverage hole on the tested lane. Do not invent a CI conclusion.",
    lanes: {
      announced: "sources/partial-missing-tested/announced.json",
      shipped: "sources/partial-missing-tested/shipped.json",
      tested: null,
    },
    expect: {
      decision: "partial",
      laneCoverage: { announced: true, shipped: true, tested: false },
      tagAgreement: true,
      shaAgreement: true,
      disagreementCodes: [],
    },
    findingBuilders: () => [
      finding(
        "announced-shipped-aligned",
        "alignment",
        "announced and shipped agree on tag v1.2.0 and SHA",
        ["cit-announced", "cit-shipped"],
      ),
      finding(
        "tested-absent",
        "coverage",
        "tested lane is absent; CI conclusion is unknown",
        ["cit-announced", "cit-shipped"],
      ),
    ],
  },
  {
    id: "partial-announced-only",
    caseClass: "partial",
    title: "Published announcement without shipped tag or CI",
    notes: "Informed by the fact that a version string can exist without a git tag. Do not invent a tag.",
    lanes: {
      announced: "sources/partial-announced-only/announced.json",
      shipped: null,
      tested: null,
    },
    expect: {
      decision: "partial",
      laneCoverage: { announced: true, shipped: false, tested: false },
      tagAgreement: null,
      shaAgreement: null,
      disagreementCodes: [],
    },
    findingBuilders: () => [
      finding(
        "announced-published",
        "announced",
        "announced.draft is false and published_at is set for tag v1.2.0",
        ["cit-announced"],
      ),
      finding(
        "shipped-tested-absent",
        "coverage",
        "shipped tag and tested receipt are absent",
        ["cit-announced"],
      ),
    ],
  },
  {
    id: "partial-shipped-no-announce",
    caseClass: "partial",
    title: "Git tag and CI without an announcement document",
    notes: "Shipped and tested agree. Announced lane absent.",
    lanes: {
      announced: null,
      shipped: "sources/partial-shipped-no-announce/shipped.json",
      tested: "sources/partial-shipped-no-announce/tested.json",
    },
    expect: {
      decision: "partial",
      laneCoverage: { announced: false, shipped: true, tested: true },
      tagAgreement: null,
      shaAgreement: true,
      disagreementCodes: [],
    },
    findingBuilders: () => [
      finding(
        "shipped-tested-aligned",
        "alignment",
        "shipped.object.sha equals tested.head_sha; tested.conclusion is success",
        ["cit-shipped", "cit-tested"],
      ),
      finding(
        "announced-absent",
        "coverage",
        "announced lane is absent",
        ["cit-shipped", "cit-tested"],
      ),
    ],
  },
  {
    id: "conflict-tag-mismatch",
    caseClass: "conflict",
    title: "Announced tag v1.2.0 vs shipped tag v1.1.9",
    notes: "Surface the tag disagreement. Do not pick a winner.",
    lanes: {
      announced: "sources/conflict-tag-mismatch/announced.json",
      shipped: "sources/conflict-tag-mismatch/shipped.json",
      tested: "sources/conflict-tag-mismatch/tested.json",
    },
    expect: {
      decision: "conflict",
      laneCoverage: { announced: true, shipped: true, tested: true },
      tagAgreement: false,
      shaAgreement: false,
      disagreementCodes: ["tag_mismatch", "sha_mismatch"],
    },
    findingBuilders: () => [
      finding(
        "tag-mismatch",
        "conflict",
        "announced.tag_name is v1.2.0; shipped.tag_name is v1.1.9",
        ["cit-announced", "cit-shipped"],
        { status: "conflict", code: "tag_mismatch" },
      ),
      finding(
        "sha-mismatch",
        "conflict",
        "announced.target_commitish differs from shipped.object.sha",
        ["cit-announced", "cit-shipped"],
        { status: "conflict", code: "sha_mismatch" },
      ),
      finding(
        "tested-follows-shipped",
        "tested",
        "tested.head_sha equals shipped.object.sha",
        ["cit-shipped", "cit-tested"],
      ),
    ],
  },
  {
    id: "conflict-sha-mismatch",
    caseClass: "conflict",
    title: "Same tag v1.2.0; announced SHA differs from shipped SHA",
    notes: "Tag strings match. Commit identity does not. Do not merge the SHAs.",
    lanes: {
      announced: "sources/conflict-sha-mismatch/announced.json",
      shipped: "sources/conflict-sha-mismatch/shipped.json",
      tested: "sources/conflict-sha-mismatch/tested.json",
    },
    expect: {
      decision: "conflict",
      laneCoverage: { announced: true, shipped: true, tested: true },
      tagAgreement: true,
      shaAgreement: false,
      disagreementCodes: ["sha_mismatch"],
    },
    findingBuilders: () => [
      finding(
        "tag-aligned",
        "alignment",
        "announced.tag_name and shipped.tag_name are both v1.2.0",
        ["cit-announced", "cit-shipped"],
      ),
      finding(
        "sha-mismatch",
        "conflict",
        "announced.target_commitish differs from shipped.object.sha",
        ["cit-announced", "cit-shipped"],
        { status: "conflict", code: "sha_mismatch" },
      ),
    ],
  },
  {
    id: "conflict-ci-vs-announce",
    caseClass: "conflict",
    title: "Announced 'All tests passed' vs tested conclusion failure",
    notes: "The announced body is a claim. tested.conclusion is the tested fact. Do not treat the body as CI evidence.",
    lanes: {
      announced: "sources/conflict-ci-vs-announce/announced.json",
      shipped: "sources/conflict-ci-vs-announce/shipped.json",
      tested: "sources/conflict-ci-vs-announce/tested.json",
    },
    expect: {
      decision: "conflict",
      laneCoverage: { announced: true, shipped: true, tested: true },
      tagAgreement: true,
      shaAgreement: true,
      disagreementCodes: ["ci_vs_announce"],
    },
    findingBuilders: () => [
      finding(
        "tag-sha-aligned",
        "alignment",
        "tag v1.2.0 and commit SHA agree across announced, shipped, and tested",
        ["cit-announced", "cit-shipped", "cit-tested"],
      ),
      finding(
        "ci-vs-announce",
        "conflict",
        "announced.body claims All tests passed; tested.conclusion is failure",
        ["cit-announced", "cit-tested"],
        { status: "conflict", code: "ci_vs_announce" },
      ),
    ],
  },
];

function citationsFor(spec) {
  const out = [];
  if (spec.lanes.announced) out.push(citation("cit-announced", "announced", spec.lanes.announced));
  if (spec.lanes.shipped) out.push(citation("cit-shipped", "shipped", spec.lanes.shipped));
  if (spec.lanes.tested) out.push(citation("cit-tested", "tested", spec.lanes.tested));
  if (spec.extraCitations) out.push(...spec.extraCitations);
  return out;
}

function writeCase(spec) {
  const citations = citationsFor(spec);
  const findings = spec.findingBuilders(citations);
  const sources = [];
  if (spec.lanes.announced) {
    sources.push(sourceFromLane(citations.find((c) => c.id === "cit-announced"), "announced", spec.lanes.announced));
  }
  if (spec.lanes.shipped) {
    sources.push(sourceFromLane(citations.find((c) => c.id === "cit-shipped"), "shipped", spec.lanes.shipped));
  }
  if (spec.lanes.tested) {
    sources.push(sourceFromLane(citations.find((c) => c.id === "cit-tested"), "tested", spec.lanes.tested));
  }
  const input = {
    schema: "s137.release-brief.input.v1",
    clock: CLOCK,
    evidenceClass: "synthetic",
    jobId: JOB_ID,
    artifactKind: ARTIFACT_KIND,
    subject: { name: "demo-release-kit", repository: "synthetic.lab/demo-release-kit" },
    sources,
  };
  const doc = {
    schema: "s137.release-brief.synthetic-case.v1",
    id: spec.id,
    jobId: JOB_ID,
    artifactKind: ARTIFACT_KIND,
    label: "synthetic",
    evidenceClass: "synthetic",
    caseClass: spec.caseClass,
    clock: CLOCK,
    title: spec.title,
    notes: spec.notes,
    subject: { name: "demo-release-kit", repository: "synthetic.lab/demo-release-kit" },
    lanes: spec.lanes,
    input,
    expect: spec.expect,
    findings,
    citations,
    limitations: [
      "Synthetic authored sources. Not a live GitHub or npm capture.",
      "Does not execute tests, publish, spend, or merge.",
      "expect.decision is a catalog contract for c07/c10, not a model judgment.",
    ],
    payment: { attempted: false },
    cost: { assignmentSpendUsd: 0, note: "offline fixtures; no purchase" },
    claims: {
      inventsFacts: false,
      paidEndpoint: false,
      legalAttestation: false,
      modelAsOracle: false,
      assertsCustomerDemand: false,
    },
  };
  const outPath = join(root, "cases", `${spec.id}.json`);
  writeFileSync(outPath, stableJson(doc));
  return outPath;
}

function walkFiles(dir, acc = []) {
  for (const name of readdirSync(dir).sort()) {
    if (name === "PROVENANCE.json") continue;
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) walkFiles(abs, acc);
    else acc.push(abs);
  }
  return acc;
}

function writeProvenance() {
  const files = {};
  for (const abs of walkFiles(root)) {
    const rel = relative(root, abs).split("\\").join("/");
    files[rel] = {
      sha256: sha256File(abs),
      bytes: statSync(abs).size,
      label: "synthetic",
      coverage: "full",
    };
  }
  const doc = {
    label: "synthetic",
    evidenceClassDefault: "synthetic",
    evidenceClass: "synthetic",
    liveCapture: false,
    paidDemand: false,
    capturedAtUtc: CLOCK,
    retrievedAt: CLOCK,
    url: null,
    originalUrls: {},
    licenseNote: "Authored synthetic fixtures in this pack. Not third-party content. Not a live GitHub or npm capture.",
    notes: "sha256 over authored bytes. Assignment spend $0. No paid endpoint.",
    payment: { attempted: false },
    files,
  };
  writeFileSync(join(root, "PROVENANCE.json"), stableJson(doc));
}

mkdirSync(join(root, "cases"), { recursive: true });
for (const spec of CASE_SPECS) writeCase(spec);
writeProvenance();
console.log(`wrote ${CASE_SPECS.length} cases and PROVENANCE.json`);
