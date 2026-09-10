import assert from "node:assert/strict";
import test from "node:test";

import { digestFile } from "../src/digest.mjs";
import {
  DIGESTS_FIXTURE,
  MAPPING_FIXTURE,
  PUBLISHED_RESULT_FIXTURE,
  REPLAY_RESULT_FIXTURE,
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
} from "../src/pins.mjs";
import { readJson } from "./helpers.mjs";

test("pinned published result and mapping blobs match PINS", () => {
  const published = digestFile(PUBLISHED_RESULT_FIXTURE);
  const mapping = digestFile(MAPPING_FIXTURE);
  assert.equal(published.gitBlobSha, RESULT_GIT_BLOB);
  assert.equal(published.sha256, RESULT_SHA256);
  assert.equal(published.bytes, 10230);
  assert.equal(mapping.gitBlobSha, MAPPING_GIT_BLOB);
  assert.equal(mapping.sha256, MAPPING_SHA256);
  assert.equal(mapping.bytes, 6033);
  assert.equal(readJson(PUBLISHED_RESULT_FIXTURE).fixture.commit, PUBLISHED_RESULT_FIXTURE_COMMIT);
});

test("in-tree independent replay result matches the tip replay digest", () => {
  const replay = digestFile(REPLAY_RESULT_FIXTURE);
  assert.equal(replay.gitBlobSha, REPLAY_RESULT_GIT_BLOB);
  assert.equal(replay.sha256, REPLAY_RESULT_SHA256);
  assert.equal(readJson(REPLAY_RESULT_FIXTURE).fixture.commit, BASEPAY_TIP_COMMIT);
  assert.equal(readJson(REPLAY_RESULT_FIXTURE).checks.passed, 19);
  assert.equal(readJson(REPLAY_RESULT_FIXTURE).checks.total, 19);
  assert.equal(readJson(REPLAY_RESULT_FIXTURE).limits.length, 6);
});

test("DIGESTS.json restates the same blob identities", () => {
  const digests = readJson(DIGESTS_FIXTURE);
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
