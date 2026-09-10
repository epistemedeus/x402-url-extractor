import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { STATEFUL_WALLET_POLICY_CASE_NAMES } from "../../../stateful-wallet-policy-conformance.mjs";

import {
  BASEPAY_CHECK_COUNT,
  BASEPAY_CHECK_IDS,
  CHECK_COUNT_NOT_DERIVED_FROM,
  CHECK_COUNT_SOURCE,
} from "./canonical-checks.mjs";
import { assertDigest, digestFile } from "./digest.mjs";
import { fail } from "./errors.mjs";
import { LAYER2_NAME, LAYER2_TITLE } from "./layers.mjs";
import {
  MAPPING_FIXTURE,
  PUBLISHED_RESULT_FIXTURE,
  REPLAY_RESULT_FIXTURE,
} from "./paths.mjs";
import {
  BASEPAY_REPO,
  BASEPAY_TIP_COMMIT,
  COMMENT,
  COVERAGE_AUTHOR_CLAIM,
  EXPECTED_MAPPING_COVERAGE,
  MAPPING_GIT_BLOB,
  MAPPING_PATH,
  MERCHANT_CASE_NAMES,
  OFFICIAL_COMMAND,
  PUBLISHED_RESULT_FIXTURE_COMMIT,
  REPLAY,
  REPLAY_RESULT_GIT_BLOB,
  RESULT_GIT_BLOB,
  RESULT_PATH,
  RESULT_SCHEMA,
  RESULT_SCHEMA_VERSION,
  TARGET_HEAD_SHA,
  TARGET_REPOSITORY,
  TARGET_UPSTREAM_PR,
} from "./pins.mjs";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sameSet(left, right) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((item) => rightSet.has(item));
}

function attachAuthority(text, source, extra = {}) {
  return Object.freeze({
    text,
    authority: Object.freeze({
      source,
      repo: BASEPAY_REPO,
      ...extra,
    }),
  });
}

function verifyCheckIds(result, label) {
  if (!result?.checks || typeof result.checks !== "object") {
    fail(`${label} is missing checks`, { kind: "invalid_shape", layer: LAYER2_NAME });
  }
  const cases = Array.isArray(result.checks.cases) ? result.checks.cases : [];
  const ids = cases.map((row) => row?.id);
  if (ids.length !== BASEPAY_CHECK_COUNT || !sameSet(ids, [...BASEPAY_CHECK_IDS])) {
    fail(
      `${label} check IDs ${JSON.stringify(ids)} do not match the pinned BasePay harness identity`,
      { kind: "check_identity", layer: LAYER2_NAME },
    );
  }
  if (ids.join("\0") !== BASEPAY_CHECK_IDS.join("\0")) {
    fail(`${label} check IDs are out of harness order`, { kind: "check_identity", layer: LAYER2_NAME });
  }
  if (result.checks.total !== BASEPAY_CHECK_COUNT) {
    fail(
      `${label} checks.total ${result.checks.total} is not the harness identity count ${BASEPAY_CHECK_COUNT}`,
      { kind: "check_identity", layer: LAYER2_NAME },
    );
  }
  const passed = cases.filter((row) => row.pass === true).length;
  const failed = cases.filter((row) => row.pass !== true).length;
  if (result.checks.passed !== passed || result.checks.failed !== failed) {
    fail(`${label} pass/fail counts do not match case rows`, { kind: "check_identity", layer: LAYER2_NAME });
  }
  return Object.freeze({
    ids: Object.freeze([...ids]),
    total: result.checks.total,
    passed,
    failed,
    source: CHECK_COUNT_SOURCE,
    notDerivedFrom: CHECK_COUNT_NOT_DERIVED_FROM,
    independentCount: BASEPAY_CHECK_COUNT,
  });
}

function verifyResultShape(result, label) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    fail(`${label} must be an object`, { kind: "invalid_shape", layer: LAYER2_NAME });
  }
  if (result.schema !== RESULT_SCHEMA) {
    fail(`${label} schema ${result.schema} is not ${RESULT_SCHEMA}`, { kind: "version_change", layer: LAYER2_NAME });
  }
  if (result.schema_version !== RESULT_SCHEMA_VERSION) {
    fail(
      `${label} schema_version ${result.schema_version} is not ${RESULT_SCHEMA_VERSION}`,
      { kind: "version_change", layer: LAYER2_NAME },
    );
  }
  if (result.fixture?.repo !== BASEPAY_REPO) {
    fail(`${label} fixture.repo does not match the pinned BasePay repo`, { kind: "version_change", layer: LAYER2_NAME });
  }
  const commit = result.fixture?.commit;
  const knownCommits = new Set([BASEPAY_TIP_COMMIT, PUBLISHED_RESULT_FIXTURE_COMMIT]);
  if (!knownCommits.has(commit)) {
    fail(
      `${label} fixture.commit ${commit} is not the pinned tip or published result fixture commit`,
      { kind: "version_change", layer: LAYER2_NAME },
    );
  }
  if (result.target?.repository !== TARGET_REPOSITORY) {
    fail(`${label} target.repository does not match pin`, { kind: "version_change", layer: LAYER2_NAME });
  }
  if (result.target?.head_sha !== TARGET_HEAD_SHA) {
    fail(`${label} target.head_sha does not match pin ${TARGET_HEAD_SHA}`, { kind: "version_change", layer: LAYER2_NAME });
  }
  if (result.target?.upstream_pr !== TARGET_UPSTREAM_PR) {
    fail(`${label} target.upstream_pr does not match pin`, { kind: "version_change", layer: LAYER2_NAME });
  }
  if (!Array.isArray(result.findings) || result.findings.length < 1) {
    fail(`${label} findings are missing`, { kind: "invalid_shape", layer: LAYER2_NAME });
  }
  if (!Array.isArray(result.limits) || result.limits.length !== 6) {
    fail(`${label} must carry the six explicit limits`, { kind: "invalid_shape", layer: LAYER2_NAME });
  }
  return commit;
}

function summarizeMapping(mapping) {
  if (mapping?.schema !== "lumen.composition-contract.taxonomy-mapping.v1") {
    fail("mapping schema is not the pinned taxonomy mapping", { kind: "version_change", layer: LAYER2_NAME });
  }
  const rows = Array.isArray(mapping.mapping) ? mapping.mapping : [];
  const names = rows.map((row) => row.samedaydesk_case);
  if (names.join("\0") !== MERCHANT_CASE_NAMES.join("\0")) {
    fail("mapping case names do not match merchant stateful cases", { kind: "mapping_mismatch", layer: LAYER2_NAME });
  }
  if (names.join("\0") !== STATEFUL_WALLET_POLICY_CASE_NAMES.join("\0")) {
    fail("mapping case names do not match agent-payment-policy stateful cases", { kind: "mapping_mismatch", layer: LAYER2_NAME });
  }
  const covered = rows.filter((row) => row.coverage === "covered").map((row) => row.samedaydesk_case);
  const partial = rows.filter((row) => row.coverage === "partial").map((row) => row.samedaydesk_case);
  const gap = rows.filter((row) => row.coverage === "gap").map((row) => row.samedaydesk_case);
  const summary = Object.freeze({
    covered: covered.length,
    partial: partial.length,
    gap: gap.length,
  });
  const matchesAuthorClaim =
    summary.covered === COVERAGE_AUTHOR_CLAIM.covered
    && summary.partial === COVERAGE_AUTHOR_CLAIM.partial
    && summary.gap === COVERAGE_AUTHOR_CLAIM.gap
    && sameSet(covered, [...EXPECTED_MAPPING_COVERAGE.covered])
    && sameSet(partial, [...EXPECTED_MAPPING_COVERAGE.partial])
    && sameSet(gap, [...EXPECTED_MAPPING_COVERAGE.gap]);
  return Object.freeze({
    rows: Object.freeze(rows.map((row) => Object.freeze({
      case: row.samedaydesk_case,
      expected: row.expected,
      control: row.control,
      coverage: row.coverage,
      lumenCases: Object.freeze([...(row.lumen_cases || [])]),
      rationale: row.rationale,
    }))),
    covered: Object.freeze(covered),
    partial: Object.freeze(partial),
    gap: Object.freeze(gap),
    summary,
    matchesAuthorClaim,
    falsifiableClaim: mapping.summary?.falsifiable_claim || null,
    provenanceNote: mapping.provenance?.note || null,
  });
}

function resultView(result, digest, checks, commit) {
  return Object.freeze({
    digest,
    fixture: Object.freeze({ ...result.fixture }),
    target: Object.freeze({ ...result.target }),
    runner: Object.freeze({ ...result.runner }),
    provenance: Object.freeze({
      blobIdentities: Object.freeze((result.provenance?.blob_identities || []).map((row) => Object.freeze({ ...row }))),
      substitutions: Object.freeze((result.provenance?.substitutions || []).map((row) => Object.freeze({ ...row }))),
    }),
    checks,
    findings: Object.freeze((result.findings || []).map((finding) => Object.freeze({
      ...finding,
      authority: Object.freeze({
        source: RESULT_SCHEMA,
        repo: BASEPAY_REPO,
        fixtureCommit: commit,
      }),
    }))),
    limits: Object.freeze((result.limits || []).map((text) => attachAuthority(text, RESULT_SCHEMA, { fixtureCommit: commit }))),
    generatedAt: result.generated_at,
    fullStatefulCoverage: false,
    liveWalletAssurance: false,
  });
}

export function loadLayer2({
  publishedResultPath = PUBLISHED_RESULT_FIXTURE,
  mappingPath = MAPPING_FIXTURE,
  replayResultPath = REPLAY_RESULT_FIXTURE,
  requireReplay = true,
} = {}) {
  const publishedDigest = digestFile(publishedResultPath);
  assertDigest(publishedDigest, RESULT_GIT_BLOB, "published BasePay result");
  const published = readJson(publishedResultPath);
  const publishedCommit = verifyResultShape(published, "published BasePay result");
  if (publishedCommit !== PUBLISHED_RESULT_FIXTURE_COMMIT) {
    fail(
      `published result fixture.commit ${publishedCommit} is not ${PUBLISHED_RESULT_FIXTURE_COMMIT}`,
      { kind: "version_change", layer: LAYER2_NAME },
    );
  }
  const publishedChecks = verifyCheckIds(published, "published BasePay result");

  const mappingDigest = digestFile(mappingPath);
  assertDigest(mappingDigest, MAPPING_GIT_BLOB, "taxonomy mapping");
  const mapping = summarizeMapping(readJson(mappingPath));

  let replay = null;
  if (replayResultPath) {
    const replayDigest = digestFile(replayResultPath);
    const replayJson = readJson(replayResultPath);
    const replayCommit = verifyResultShape(replayJson, "replay BasePay result");
    const replayChecks = verifyCheckIds(replayJson, "replay BasePay result");
    const inTreeReplay = resolve(replayResultPath) === resolve(REPLAY_RESULT_FIXTURE);
    if (inTreeReplay) {
      assertDigest(replayDigest, REPLAY_RESULT_GIT_BLOB, "in-tree replay BasePay result");
    }
    if (replayCommit !== BASEPAY_TIP_COMMIT && replayCommit !== PUBLISHED_RESULT_FIXTURE_COMMIT) {
      fail(`replay fixture.commit ${replayCommit} is not a pinned revision`, { kind: "version_change", layer: LAYER2_NAME });
    }
    const replayPass = replayChecks.passed === BASEPAY_CHECK_COUNT && replayChecks.failed === 0;
    const pinnedReplayBytes = replayDigest.gitBlobSha === REPLAY_RESULT_GIT_BLOB;
    const independentTipReplay = pinnedReplayBytes && replayCommit === BASEPAY_TIP_COMMIT && replayPass;
    replay = Object.freeze({
      loaded: true,
      path: replayResultPath,
      digest: replayDigest,
      ...resultView(replayJson, replayDigest, replayChecks, replayCommit),
      replayPass,
      independentTipReplay,
      evidenceOrigin: pinnedReplayBytes ? "pinned_worker_replay_artifact" : "caller_supplied_unverified_report",
      executedByThisHelper: false,
      officialCommand: OFFICIAL_COMMAND,
      log: null,
    });
  } else if (requireReplay) {
    fail("layer2 requires a replay report", { kind: "missing_replay", layer: LAYER2_NAME });
  }

  const replayConfirms =
    replay?.independentTipReplay === true
    && mapping.matchesAuthorClaim
    && publishedChecks.passed === BASEPAY_CHECK_COUNT
    && publishedChecks.failed === 0;

  const confirmation = replayConfirms
    ? "author+replay-confirmed"
    : mapping.matchesAuthorClaim
      ? "author_claim_only"
      : "rejected_mismatch";

  return Object.freeze({
    name: LAYER2_NAME,
    title: LAYER2_TITLE,
    authority: Object.freeze({
      comment: COMMENT,
      repo: BASEPAY_REPO,
      tipCommit: BASEPAY_TIP_COMMIT,
      publishedResultFixtureCommit: PUBLISHED_RESULT_FIXTURE_COMMIT,
      resultPath: RESULT_PATH,
      mappingPath: MAPPING_PATH,
      resultGitBlob: RESULT_GIT_BLOB,
      mappingGitBlob: MAPPING_GIT_BLOB,
      officialCommand: OFFICIAL_COMMAND,
      runner: "basepay-conformance harness",
      fixture: "basepay-conformance",
    }),
    published: Object.freeze({
      path: publishedResultPath,
      ...resultView(published, publishedDigest, publishedChecks, publishedCommit),
    }),
    replay,
    mapping: Object.freeze({
      path: mappingPath,
      digest: mappingDigest,
      ...mapping,
      confirmation,
      confirmationScope: confirmation === "author+replay-confirmed" ? "pinned revision only" : "not replay-confirmed",
      fullStatefulCoverage: false,
    }),
    checks: Object.freeze({
      source: CHECK_COUNT_SOURCE,
      notDerivedFrom: CHECK_COUNT_NOT_DERIVED_FROM,
      ids: BASEPAY_CHECK_IDS,
      independentCount: BASEPAY_CHECK_COUNT,
      published: publishedChecks,
      replay: replay?.checks || null,
    }),
    claimsRefused: Object.freeze({
      providerNativeVerified: true,
      liveWalletAssurance: true,
      fullStatefulCoverage: true,
      paidProviderApi: true,
    }),
  });
}
