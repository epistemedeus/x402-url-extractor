import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { verifyPinnedBytes, AcquireError } from "../src/acquire.mjs";
import { digestFile, gitBlobSha, sha256 } from "../src/digest.mjs";
import {
  BASEPAY_FIXTURES,
  DIGESTS_FIXTURE,
  MAPPING_FIXTURE,
  POINTER_FIXTURE,
  PUBLISHED_RESULT_FIXTURE,
  REPLAY_RESULT_FIXTURE,
  VENDORED_UPSTREAM_FILENAMES,
} from "../src/paths.mjs";
import {
  COMMENT,
  MAPPING_GIT_BLOB,
  MAPPING_SHA256,
  MERCHANT_PIN,
  PUBLISHED_RESULT_FIXTURE_COMMIT,
  REPLAY_RESULT_GIT_BLOB,
  REPLAY_RESULT_SHA256,
  RESULT_GIT_BLOB,
  RESULT_SHA256,
  BASEPAY_TIP_COMMIT,
  SYNTHETIC_MAPPING_GIT_BLOB,
  SYNTHETIC_MAPPING_SHA256,
  SYNTHETIC_PUBLISHED_GIT_BLOB,
  SYNTHETIC_PUBLISHED_SHA256,
  SYNTHETIC_REPLAY_GIT_BLOB,
  SYNTHETIC_REPLAY_SHA256,
} from "../src/pins.mjs";
import { readJson } from "./helpers.mjs";

test("pin metadata declares upstream blobs without shipping those files", () => {
  for (const name of VENDORED_UPSTREAM_FILENAMES) {
    assert.equal(existsSync(join(BASEPAY_FIXTURES, name)), false, name);
  }
  const digests = readJson(DIGESTS_FIXTURE);
  const pointer = readJson(POINTER_FIXTURE);
  assert.equal(digests.published_conformance_result.gitBlobSha, RESULT_GIT_BLOB);
  assert.equal(digests.published_conformance_result.sha256, RESULT_SHA256);
  assert.equal(digests.published_conformance_result.shipped, false);
  assert.equal(digests.mapping.gitBlobSha, MAPPING_GIT_BLOB);
  assert.equal(digests.mapping.sha256, MAPPING_SHA256);
  assert.equal(digests.replay_conformance_result.gitBlobSha, REPLAY_RESULT_GIT_BLOB);
  assert.equal(digests.replay_conformance_result.sha256, REPLAY_RESULT_SHA256);
  assert.equal(digests.replay_conformance_result.checks_passed, 19);
  assert.equal(pointer.published_result.gitBlobSha, RESULT_GIT_BLOB);
  assert.equal(pointer.mapping.gitBlobSha, MAPPING_GIT_BLOB);
  assert.equal(pointer.independent_replay.in_tree_copy, null);
  assert.equal(pointer.independent_replay.gitBlobSha, REPLAY_RESULT_GIT_BLOB);
});

test("synthetic fixtures match synthetic pins and differ from upstream bytes", () => {
  const published = digestFile(PUBLISHED_RESULT_FIXTURE);
  const mapping = digestFile(MAPPING_FIXTURE);
  const replay = digestFile(REPLAY_RESULT_FIXTURE);
  assert.equal(published.gitBlobSha, SYNTHETIC_PUBLISHED_GIT_BLOB);
  assert.equal(published.sha256, SYNTHETIC_PUBLISHED_SHA256);
  assert.equal(mapping.gitBlobSha, SYNTHETIC_MAPPING_GIT_BLOB);
  assert.equal(mapping.sha256, SYNTHETIC_MAPPING_SHA256);
  assert.equal(replay.gitBlobSha, SYNTHETIC_REPLAY_GIT_BLOB);
  assert.equal(replay.sha256, SYNTHETIC_REPLAY_SHA256);
  assert.notEqual(published.gitBlobSha, RESULT_GIT_BLOB);
  assert.notEqual(published.sha256, RESULT_SHA256);
  assert.notEqual(mapping.gitBlobSha, MAPPING_GIT_BLOB);
  assert.notEqual(mapping.sha256, MAPPING_SHA256);
  assert.notEqual(replay.gitBlobSha, REPLAY_RESULT_GIT_BLOB);
  assert.notEqual(replay.sha256, REPLAY_RESULT_SHA256);
  assert.equal(readJson(PUBLISHED_RESULT_FIXTURE).fixture.commit, PUBLISHED_RESULT_FIXTURE_COMMIT);
  assert.equal(readJson(REPLAY_RESULT_FIXTURE).fixture.commit, BASEPAY_TIP_COMMIT);
  assert.equal(readJson(PUBLISHED_RESULT_FIXTURE).checks.total, 19);
  assert.equal(readJson(PUBLISHED_RESULT_FIXTURE).limits.length, 6);
  assert.equal(readJson(MAPPING_FIXTURE).summary.covered, 4);
  assert.equal(readJson(MAPPING_FIXTURE).summary.partial, 1);
  assert.equal(readJson(MAPPING_FIXTURE).summary.gap, 2);
  const bytes = Buffer.from("s98-acquire-self-test\n");
  const ok = verifyPinnedBytes(bytes, {
    gitBlobSha: gitBlobSha(bytes),
    sha256: sha256(bytes),
    bytes: bytes.length,
  }, "self-test");
  assert.equal(ok.gitBlobSha, gitBlobSha(bytes));
  assert.throws(
    () => verifyPinnedBytes(bytes, { gitBlobSha: RESULT_GIT_BLOB, sha256: RESULT_SHA256, bytes: 10230 }, "upstream published"),
    (error) => error instanceof AcquireError,
  );
});

test("DIGESTS.json restates synthetic and upstream blob identities", () => {
  const digests = readJson(DIGESTS_FIXTURE);
  assert.equal(digests.synthetic_published_conformance_result.gitBlobSha, SYNTHETIC_PUBLISHED_GIT_BLOB);
  assert.equal(digests.synthetic_mapping.gitBlobSha, SYNTHETIC_MAPPING_GIT_BLOB);
  assert.equal(digests.synthetic_replay_conformance_result.gitBlobSha, SYNTHETIC_REPLAY_GIT_BLOB);
  assert.equal(digests.published_conformance_result.gitBlobSha, RESULT_GIT_BLOB);
  assert.equal(digests.mapping.gitBlobSha, MAPPING_GIT_BLOB);
  assert.equal(digests.replay_conformance_result.gitBlobSha, REPLAY_RESULT_GIT_BLOB);
  assert.equal(digests.replay_conformance_result.checks_passed, 19);
});

test("comment, merchant, and BasePay pins are the S89 immutable values", () => {
  assert.equal(COMMENT.id, 5611527986);
  assert.equal(COMMENT.author, "LumenFromTheFuture");
  assert.equal(COMMENT.created_at, "2026-09-10T01:59:54Z");
  assert.equal(MERCHANT_PIN, "4910f83bd2be1e38667f1a3cfa23c70fcff6b0c1");
  assert.equal(BASEPAY_TIP_COMMIT, "94fa65d65c204c02f4af5a9bc9fd27225c688994");
  assert.equal(PUBLISHED_RESULT_FIXTURE_COMMIT, "8a46910ede4830de8481a3ae7f095e120a312d62");
});
