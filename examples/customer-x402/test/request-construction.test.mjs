import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import {
  AuthorizationRefusal,
  normalizeAuthorization,
} from "../src/authorization.mjs";
import {
  DEFAULT_AUTHORIZATION,
  DEFAULT_LOCKFILE_AUTHORIZATION,
  LIVE_EXTRACT_URL,
  LIVE_LOCKFILE_URL,
  LIVE_ORIGIN,
} from "../src/constants.mjs";
import { runAuthorizedPurchase } from "../src/purchase.mjs";
import { runPreflight } from "../src/preflight.mjs";
import {
  assertPurchaseReady,
  bindGetExtractResourceUrl,
  classifyRequestConstruction,
  requiredQueryFromChallenge,
} from "../src/request-construction.mjs";
import { buildChallenge, createFixtureFetch } from "../fixtures/transport.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PKG = join(ROOT, "..");
const CLI = join(PKG, "bin/cli.mjs");

function throwingLoader() {
  const state = { loaded: false };
  return {
    state,
    loadAccount: async () => {
      state.loaded = true;
      throw new Error("wallet opened before request was purchase-ready");
    },
  };
}

function writeAuth(value) {
  const dir = mkdtempSync(join(tmpdir(), "cx402-construct-"));
  const path = join(dir, "authorization.json");
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

function cliApprove(authorization, extra = []) {
  const path = writeAuth(authorization);
  return spawnSync(process.execPath, [
    CLI,
    "--approve",
    "--authorization",
    path,
    "--private-key-env",
    "C21_DELIBERATELY_UNSET",
    ...extra,
  ], { cwd: PKG, encoding: "utf8", env: { ...process.env } });
}

test("bindGetExtractResourceUrl matches the live example encoding", () => {
  assert.equal(bindGetExtractResourceUrl("https://example.com"), LIVE_EXTRACT_URL);
  assert.equal(
    bindGetExtractResourceUrl("https://example.com", { origin: LIVE_ORIGIN }),
    `${LIVE_ORIGIN}/extract?url=https%3A%2F%2Fexample.com`,
  );
});

test("bare GET /extract is unsigned discovery and is not purchase-ready", () => {
  const bare = `${LIVE_ORIGIN}/extract`;
  const construction = classifyRequestConstruction(bare, { method: "GET" });
  assert.equal(construction.kind, "unsigned_discovery");
  assert.equal(construction.purchaseReady, false);
  assert.deepEqual(construction.missing, ["url"]);
  assert.throws(() => normalizeAuthorization({ ...DEFAULT_AUTHORIZATION, url: bare }), AuthorizationRefusal);
  assert.throws(() => assertPurchaseReady(bare, { method: "GET" }), /unpaid discovery/);
});

test("empty and malformed extract url are invalid input before any fetch", async () => {
  let fetched = 0;
  const fetchImpl = async () => {
    fetched += 1;
    throw new Error("must not fetch invalid extract construction");
  };
  const loader = throwingLoader();
  for (const url of [
    `${LIVE_ORIGIN}/extract?url=`,
    `${LIVE_ORIGIN}/extract?url=not-a-url`,
    `${LIVE_ORIGIN}/extract?url=file%3A%2F%2F%2Ftmp%2Fsecret`,
    `${LIVE_ORIGIN}/extract?url=https%3A%2F%2F127.0.0.1%2F`,
    `${LIVE_ORIGIN}/extract?url=https%3A%2F%2Fexample.com&url=https%3A%2F%2Fexample.org`,
  ]) {
    const construction = classifyRequestConstruction(url, { method: "GET" });
    assert.equal(construction.kind, "invalid_input", url);
    assert.equal(construction.purchaseReady, false);
    await assert.rejects(
      () => runPreflight({ url, method: "GET", fetchImpl }),
      AuthorizationRefusal,
    );
    const paid = await runAuthorizedPurchase({
      authorization: { ...DEFAULT_AUTHORIZATION, url },
      approve: true,
      fetchImpl,
      loadAccount: loader.loadAccount,
    });
    assert.equal(paid.outcome, "authorization_refused", url);
    assert.equal(paid.walletAccessed, false, url);
    assert.equal(paid.paymentSigned, false, url);
    assert.equal(paid.paymentSent, false, url);
  }
  assert.equal(fetched, 0);
  assert.equal(loader.state.loaded, false);
});

test("valid bound GET extract is purchase-ready and unpaid preflight never opens a wallet", async () => {
  const bound = bindGetExtractResourceUrl("https://example.com");
  const construction = classifyRequestConstruction(bound, { method: "GET" });
  assert.equal(construction.kind, "bound_request");
  assert.equal(construction.purchaseReady, true);
  const { fetchImpl, calls } = createFixtureFetch();
  const result = await runPreflight({
    url: bound,
    authorization: DEFAULT_AUTHORIZATION,
    fetchImpl,
  });
  assert.equal(result.outcome, "preflight_ok");
  assert.equal(result.construction.kind, "bound_request");
  assert.equal(result.walletAccessed, false);
  assert.equal(result.paymentSigned, false);
  assert.equal(result.paymentSent, false);
  assert.equal(calls.every((call) => call.hasPaymentSignature === false), true);
});

test("resource URL drift is refused before the wallet loader", async () => {
  const { fetchImpl, calls } = createFixtureFetch();
  const loader = throwingLoader();
  const result = await runAuthorizedPurchase({
    authorization: DEFAULT_AUTHORIZATION,
    url: `${LIVE_EXTRACT_URL}&other=1`,
    approve: true,
    fetchImpl,
    loadAccount: loader.loadAccount,
  });
  assert.equal(result.outcome, "authorization_refused");
  assert.equal(result.walletAccessed, false);
  assert.equal(result.paymentSigned, false);
  assert.equal(result.paymentSent, false);
  assert.equal(loader.state.loaded, false);
  assert.equal(calls.length, 0);
});

test("lockfile missing before/after is refused before fetch or wallet", async () => {
  let fetched = 0;
  const fetchImpl = async () => {
    fetched += 1;
    throw new Error("must not fetch incomplete lockfile");
  };
  const loader = throwingLoader();
  const incomplete = {
    ...DEFAULT_LOCKFILE_AUTHORIZATION,
    url: LIVE_LOCKFILE_URL,
    body: { before: { lockfileVersion: 3, packages: {} } },
  };
  assert.equal(
    classifyRequestConstruction(LIVE_LOCKFILE_URL, { method: "POST", body: JSON.stringify(incomplete.body) }).kind,
    "invalid_input",
  );
  assert.throws(() => normalizeAuthorization(incomplete), /after must be a JSON object/);
  const paid = await runAuthorizedPurchase({
    authorization: incomplete,
    approve: true,
    fetchImpl,
    loadAccount: loader.loadAccount,
  });
  assert.equal(paid.outcome, "authorization_refused");
  assert.equal(paid.walletAccessed, false);
  assert.equal(loader.state.loaded, false);
  const empty = classifyRequestConstruction(LIVE_LOCKFILE_URL, { method: "POST", body: "{}" });
  assert.equal(empty.kind, "unsigned_discovery");
  assert.equal(empty.purchaseReady, false);
  assert.deepEqual(empty.missing, ["before", "after"]);
  assert.equal(fetched, 0);
});

test("lockfile body drift after approval is refused before signer", () => {
  const auth = normalizeAuthorization({
    ...DEFAULT_LOCKFILE_AUTHORIZATION,
    body: {
      before: { name: "a", version: "1", lockfileVersion: 3, requires: true, packages: { "": { name: "a", version: "1" } } },
      after: { name: "a", version: "1", lockfileVersion: 3, requires: true, packages: { "": { name: "a", version: "1" } } },
    },
  });
  const drifted = `${auth.bodyRaw.slice(0, -1)},"extra":true}`;
  assert.throws(
    () => normalizeAuthorization({
      ...DEFAULT_LOCKFILE_AUTHORIZATION,
      bodyRaw: drifted,
    }),
    AuthorizationRefusal,
  );
});

test("unpaid 402 bazaar input still lists required extract url", () => {
  const challenge = buildChallenge();
  challenge.extensions = {
    bazaar: {
      info: { input: { type: "http", method: "GET", queryParams: { url: "https://example.com" } } },
      schema: {
        properties: {
          input: { properties: { queryParams: { required: ["url"] } } },
        },
      },
    },
  };
  const required = requiredQueryFromChallenge(challenge);
  assert.deepEqual(required.required, ["url"]);
  assert.equal(required.example.url, "https://example.com");
});

test("CLI --approve refuses missing and malformed extract url without reading the wallet env", () => {
  for (const url of [
    `${LIVE_ORIGIN}/extract`,
    `${LIVE_ORIGIN}/extract?url=not-a-url`,
  ]) {
    const result = cliApprove({ ...DEFAULT_AUTHORIZATION, url });
    const receipt = JSON.parse(result.stdout || result.stderr);
    assert.equal(receipt.outcome, "authorization_refused");
    assert.equal(receipt.walletAccessed, false);
    assert.equal(receipt.paymentSigned, false);
    assert.equal(receipt.paymentSent, false);
    assert.notEqual(result.status, 0);
  }
});

test("CLI --approve refuses lockfile missing after without opening a wallet", () => {
  const result = cliApprove({
    ...DEFAULT_LOCKFILE_AUTHORIZATION,
    url: LIVE_LOCKFILE_URL,
    body: { before: { lockfileVersion: 3, packages: {} } },
  });
  const receipt = JSON.parse(result.stdout || result.stderr);
  assert.equal(receipt.outcome, "authorization_refused");
  assert.equal(receipt.walletAccessed, false);
  assert.match(receipt.message, /after/);
});

test("fixture paid GET still signs only after a bound request", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const signed = [];
  const { fetchImpl, calls } = createFixtureFetch();
  const result = await runAuthorizedPurchase({
    authorization: DEFAULT_AUTHORIZATION,
    approve: true,
    fetchImpl,
    account: {
      address: account.address,
      async signTypedData(value) {
        signed.push(value);
        return account.signTypedData(value);
      },
    },
  });
  assert.equal(result.outcome, "valid_delivered");
  assert.equal(result.walletAccessed, true);
  assert.equal(result.paymentSigned, true);
  assert.equal(signed.length, 1);
  assert.equal(calls.filter((call) => call.hasPaymentSignature).length, 1);
});
