import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  AuthorizationRefusal,
  normalizeAuthorization,
} from "../src/authorization.mjs";
import {
  DEFAULT_AUTHORIZATION,
  DEFAULT_BATCH_AUTHORIZATION,
  LIVE_EXTRACT_BATCH_URL,
  LIVE_LOCKFILE_URL,
} from "../src/constants.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const lockfileAuth = JSON.parse(readFileSync(join(ROOT, "../fixtures/authorization-lockfile.json"), "utf8"));
const noChangeAuth = JSON.parse(readFileSync(join(ROOT, "../fixtures/authorization-lockfile-no-change.json"), "utf8"));

test("POST /lockfile-pin-delta is admitted with exact body bytes", () => {
  const auth = normalizeAuthorization(lockfileAuth);
  assert.equal(auth.method, "POST");
  assert.equal(auth.url, LIVE_LOCKFILE_URL);
  assert.equal(auth.path, "/lockfile-pin-delta");
  assert.equal(auth.amountCapAtomic, "5000");
  assert.equal(auth.batch, null);
  assert.equal(auth.lockfile, true);
  assert.equal(auth.bodyRaw, JSON.stringify({ before: lockfileAuth.body.before, after: lockfileAuth.body.after }));
  assert.match(auth.bodyDigest, /^sha256:[0-9a-f]{64}$/);
});

test("lockfile admission does not open arbitrary POST destinations", () => {
  assert.throws(
    () => normalizeAuthorization({ ...lockfileAuth, url: "https://agents.samedaydesk.com/other" }),
    (error) => {
      assert.equal(error instanceof AuthorizationRefusal, true);
      assert.match(error.message, /authorization path must be \/extract\/batch/);
      return true;
    },
  );
  assert.throws(
    () => normalizeAuthorization({ ...lockfileAuth, url: `${LIVE_LOCKFILE_URL}?extra=1` }),
    /must not include a query string/,
  );
  const { body: _body, ...lockfileWithoutBody } = lockfileAuth;
  assert.throws(
    () => normalizeAuthorization({ ...lockfileWithoutBody, method: "GET" }),
    /authorization path must be \/extract/,
  );
});

test("GET /extract and POST /extract/batch stay admitted", () => {
  const getAuth = normalizeAuthorization(DEFAULT_AUTHORIZATION);
  assert.equal(getAuth.path, "/extract");
  assert.equal(getAuth.method, "GET");
  const batch = normalizeAuthorization(DEFAULT_BATCH_AUTHORIZATION);
  assert.equal(batch.path, "/extract/batch");
  assert.equal(batch.url, LIVE_EXTRACT_BATCH_URL);
  assert.ok(batch.batch);
  assert.equal(batch.lockfile, undefined);
});

test("mutated lockfile body bytes after approval are refused", () => {
  const auth = normalizeAuthorization(lockfileAuth);
  assert.throws(
    () => normalizeAuthorization({
      ...lockfileAuth,
      bodyRaw: auth.bodyRaw.replace("mocha", "MOCHA"),
    }),
    AuthorizationRefusal,
  );
  const unchanged = normalizeAuthorization(noChangeAuth);
  assert.notEqual(unchanged.bodyDigest, auth.bodyDigest);
});
