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
  LIVE_VENDOR_BUDGET_URL,
} from "../src/constants.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const vendorAuth = JSON.parse(readFileSync(join(ROOT, "../fixtures/authorization-vendor-budget.json"), "utf8"));
const noChangeAuth = JSON.parse(readFileSync(join(ROOT, "../fixtures/authorization-vendor-budget-no-change.json"), "utf8"));

test("POST /vendor-budget-impact is admitted with exact body bytes", () => {
  const auth = normalizeAuthorization(vendorAuth);
  assert.equal(auth.method, "POST");
  assert.equal(auth.url, LIVE_VENDOR_BUDGET_URL);
  assert.equal(auth.path, "/vendor-budget-impact");
  assert.equal(auth.amountCapAtomic, "5000");
  assert.equal(auth.batch, null);
  assert.equal(auth.vendorBudget, true);
  assert.equal(auth.bodyRaw, JSON.stringify({ before: vendorAuth.body.before, after: vendorAuth.body.after }));
  assert.match(auth.bodyDigest, /^sha256:[0-9a-f]{64}$/);
});

test("vendor-budget admission does not open arbitrary POST destinations", () => {
  assert.throws(
    () => normalizeAuthorization({ ...vendorAuth, url: "https://agents.samedaydesk.com/other" }),
    (error) => {
      assert.equal(error instanceof AuthorizationRefusal, true);
      assert.match(error.message, /authorization path must be \/extract\/batch/);
      return true;
    },
  );
  assert.throws(
    () => normalizeAuthorization({ ...vendorAuth, url: `${LIVE_VENDOR_BUDGET_URL}?extra=1` }),
    /must not include a query string/,
  );
});

test("GET /extract and POST /extract/batch stay admitted", () => {
  const getAuth = normalizeAuthorization(DEFAULT_AUTHORIZATION);
  assert.equal(getAuth.path, "/extract");
  const batch = normalizeAuthorization(DEFAULT_BATCH_AUTHORIZATION);
  assert.equal(batch.path, "/extract/batch");
  assert.equal(batch.url, LIVE_EXTRACT_BATCH_URL);
  assert.equal(batch.vendorBudget, undefined);
});

test("mutated vendor-budget body bytes after approval are refused", () => {
  const auth = normalizeAuthorization(vendorAuth);
  assert.throws(
    () => normalizeAuthorization({
      ...vendorAuth,
      bodyRaw: auth.bodyRaw.replace("desk-chat-input", "desk-chat-INPUT"),
    }),
    AuthorizationRefusal,
  );
  const unchanged = normalizeAuthorization(noChangeAuth);
  assert.notEqual(unchanged.bodyDigest, auth.bodyDigest);
});

test("missing rows and path-shaped snapshots are refused before purchase", () => {
  assert.throws(
    () => normalizeAuthorization({
      ...vendorAuth,
      body: { before: vendorAuth.body.before },
    }),
    /after must include a non-empty rows array|after must be a JSON object/,
  );
  assert.throws(
    () => normalizeAuthorization({
      ...vendorAuth,
      body: { before: "./prices.json", after: vendorAuth.body.after },
    }),
    /not a path or string/,
  );
  assert.throws(
    () => normalizeAuthorization({
      ...vendorAuth,
      body: { before: { rows: [] }, after: vendorAuth.body.after },
    }),
    /non-empty rows array/,
  );
});
