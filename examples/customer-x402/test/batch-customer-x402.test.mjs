import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import {
  DEFAULT_BATCH_AUTHORIZATION,
  LIVE_EXTRACT_BATCH_URL,
  OUTCOMES,
  OWNED_HOMEPAGE_BATCH_URLS,
} from "../src/constants.mjs";
import {
  AuthorizationRefusal,
  assertRequestMatchesAuthorization,
  normalizeAuthorization,
} from "../src/authorization.mjs";
import {
  admitExtractBatchBody,
  BatchAdmissionError,
  BATCH_MAX_REQUEST_JSON_BYTES,
} from "../src/batch-admission.mjs";
import { validateBatchBuyerOutput } from "../src/batch-output.mjs";
import { runPreflight } from "../src/preflight.mjs";
import { runAuthorizedPurchase } from "../src/purchase.mjs";
import { assertNoSecretMaterial, safeJson } from "../src/redact.mjs";
import {
  buildBatchChallenge,
  buildBatchPartialBody,
  buildBatchUsefulBody,
  createBatchFixtureFetch,
  createFixtureFetch,
} from "../fixtures/transport.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PKG = join(ROOT, "..");
const CLI = join(PKG, "bin/cli.mjs");
const FIXTURE_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

function throwingAccount() {
  return new Proxy({}, {
    get() {
      throw new Error("signer accessed before authorization");
    },
  });
}

test("batch unpaid preflight never looks up wallet credentials", async () => {
  const auth = normalizeAuthorization(DEFAULT_BATCH_AUTHORIZATION);
  const { fetchImpl, calls } = createBatchFixtureFetch({ authorization: auth });
  const previous = { ...process.env };
  delete process.env.CUSTOMER_X402_PRIVATE_KEY;
  delete process.env.PRIVATE_KEY;
  delete process.env.EVM_PRIVATE_KEY;

  const result = await runPreflight({
    url: LIVE_EXTRACT_BATCH_URL,
    authorization: auth,
    fetchImpl,
  });

  assert.equal(result.outcome, OUTCOMES.PREFLIGHT_OK);
  assert.equal(result.walletAccessed, false);
  assert.equal(result.paymentSigned, false);
  assert.equal(result.paymentSent, false);
  assert.equal(result.bodyDigest, auth.bodyDigest);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].bodyText, auth.bodyRaw);
  assert.equal(calls[0].hasPaymentSignature, false);
  assert.equal(process.env.CUSTOMER_X402_PRIVATE_KEY, undefined);
  Object.assign(process.env, previous);
});

test("malformed oversized and disallowed batch inputs fail before fetch or key", async () => {
  let fetched = false;
  const fetchImpl = async () => { fetched = true; throw new Error("should not fetch"); };
  await assert.rejects(
    () => runPreflight({
      url: LIVE_EXTRACT_BATCH_URL,
      method: "POST",
      body: { urls: ["http://example.com/"] },
      fetchImpl,
    }),
    BatchAdmissionError,
  );
  await assert.rejects(
    () => runPreflight({
      url: LIVE_EXTRACT_BATCH_URL,
      method: "POST",
      body: { urls: ["https://127.0.0.1/"] },
      fetchImpl,
    }),
    /private|loopback/i,
  );
  await assert.rejects(
    () => runPreflight({
      url: LIVE_EXTRACT_BATCH_URL,
      method: "POST",
      body: { urls: ["https://example.com/"], fields: ["title", "nope"] },
      fetchImpl,
    }),
    /unsupported/,
  );
  await assert.rejects(
    () => runPreflight({
      url: LIVE_EXTRACT_BATCH_URL,
      method: "POST",
      body: { urls: Array.from({ length: 6 }, () => "https://example.com/") },
      fetchImpl,
    }),
    /1 to 5/,
  );
  const oversized = {
    urls: ["https://example.com/"],
    fields: ["title"],
    pad: "x".repeat(BATCH_MAX_REQUEST_JSON_BYTES),
  };
  assert.throws(() => admitExtractBatchBody(oversized), /unexpected field|byte ceiling/);
  assert.equal(fetched, false);
});

test("valid batch purchase delivers useful output with unverified settlement", async () => {
  const auth = normalizeAuthorization(DEFAULT_BATCH_AUTHORIZATION);
  const { fetchImpl, calls } = createBatchFixtureFetch({ authorization: auth });
  const account = privateKeyToAccount(FIXTURE_PRIVATE_KEY);
  const result = await runAuthorizedPurchase({
    authorization: auth,
    account,
    fetchImpl,
    approve: true,
  });
  assert.equal(result.outcome, OUTCOMES.USEFUL_DELIVERED);
  assert.equal(result.evidence.outputDelivery, "useful");
  assert.equal(result.evidence.settlementVerification, "unverified");
  assert.equal(result.evidence.bodyDigest, auth.bodyDigest);
  assert.equal(result.paymentSent, true);
  assert.equal(calls.filter((call) => call.hasPaymentSignature).length, 1);
  assert.equal(calls.every((call) => call.bodyText === auth.bodyRaw), true);
  assertNoSecretMaterial(safeJson(result));
});

test("exact body bytes are used for both unpaid and paid calls", async () => {
  const auth = normalizeAuthorization(DEFAULT_BATCH_AUTHORIZATION);
  const bodies = [];
  const base = createBatchFixtureFetch({ authorization: auth });
  const fetchImpl = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    bodies.push(await request.clone().text());
    return base.fetchImpl(input, init);
  };
  await runAuthorizedPurchase({
    authorization: auth,
    privateKey: FIXTURE_PRIVATE_KEY,
    fetchImpl,
    approve: true,
  });
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], auth.bodyRaw);
  assert.equal(bodies[1], auth.bodyRaw);
  assert.equal(
    createHash("sha256").update(bodies[0]).digest("hex"),
    auth.bodyDigest.slice("sha256:".length),
  );
});

test("modified authorization body URL or method is refused before signer", async () => {
  const auth = normalizeAuthorization(DEFAULT_BATCH_AUTHORIZATION);
  const mutatedBody = JSON.parse(auth.bodyRaw);
  mutatedBody.urls[0] = "https://evil.example/";
  assert.throws(
    () => assertRequestMatchesAuthorization(auth.url, auth, {
      method: "POST",
      body: JSON.stringify(mutatedBody),
    }),
    /body bytes/,
  );
  assert.throws(
    () => assertRequestMatchesAuthorization(auth.url, auth, { method: "GET", body: auth.bodyRaw }),
    AuthorizationRefusal,
  );
  assert.throws(
    () => assertRequestMatchesAuthorization(`${auth.url}?x=1`, auth, { method: "POST", body: auth.bodyRaw }),
    /URL/,
  );

  const challenge = buildBatchChallenge({ payTo: "0x0000000000000000000000000000000000000001" });
  const { fetchImpl } = createBatchFixtureFetch({ authorization: auth, challenge });
  const result = await runAuthorizedPurchase({
    authorization: auth,
    account: throwingAccount(),
    fetchImpl,
    approve: true,
  });
  assert.equal(result.outcome, OUTCOMES.AUTHORIZATION_REFUSED);
  assert.equal(result.walletAccessed, false);
  assert.equal(result.paymentSigned, false);
});

test("mutating authorization input object after normalize cannot change sent bytes", async () => {
  const input = structuredClone(DEFAULT_BATCH_AUTHORIZATION);
  const auth = normalizeAuthorization(input);
  input.body.urls[0] = "https://mutated.example/";
  input.body.fields.push("text");
  const { fetchImpl, calls } = createBatchFixtureFetch({ authorization: auth });
  const result = await runAuthorizedPurchase({
    authorization: auth,
    privateKey: FIXTURE_PRIVATE_KEY,
    fetchImpl,
    approve: true,
  });
  assert.equal(result.outcome, OUTCOMES.USEFUL_DELIVERED);
  assert.equal(calls.every((call) => call.bodyText === auth.bodyRaw), true);
  assert.equal(auth.bodyRaw.includes("mutated.example"), false);
});

test("duplicate omitted wrong-order and wrong-URL results are invalid", () => {
  const auth = normalizeAuthorization(DEFAULT_BATCH_AUTHORIZATION);
  const useful = buildBatchUsefulBody({ urls: [...auth.batch.urls], fields: [...auth.batch.fields] });

  const omitted = structuredClone(useful);
  omitted.sources = [omitted.sources[0]];
  assert.equal(validateBatchBuyerOutput(omitted, auth).delivery, "invalid");

  const wrongOrder = structuredClone(useful);
  wrongOrder.sources = [useful.sources[1], useful.sources[0]];
  assert.equal(validateBatchBuyerOutput(wrongOrder, auth).delivery, "invalid");

  const wrongUrl = structuredClone(useful);
  wrongUrl.sources[1].source = "https://evil.example/";
  assert.equal(validateBatchBuyerOutput(wrongUrl, auth).delivery, "invalid");

  const duplicate = structuredClone(useful);
  duplicate.sources[1].id = duplicate.sources[0].id;
  assert.equal(validateBatchBuyerOutput(duplicate, auth).delivery, "invalid");
});

test("nullable chosen output is accepted where seller permits it", () => {
  const auth = normalizeAuthorization(DEFAULT_BATCH_AUTHORIZATION);
  const useful = buildBatchUsefulBody({ urls: [...auth.batch.urls], fields: [...auth.batch.fields] });
  assert.equal(useful.sources[0].data.description, null);
  const result = validateBatchBuyerOutput(useful, auth);
  assert.equal(result.valid, true);
  assert.equal(result.delivery, "useful");
});

test("bounded per-row failures classify as partial_delivered", async () => {
  const auth = normalizeAuthorization(DEFAULT_BATCH_AUTHORIZATION);
  const paidBody = buildBatchPartialBody({ urls: [...auth.batch.urls], fields: [...auth.batch.fields] });
  const { fetchImpl } = createBatchFixtureFetch({ authorization: auth, paidBody });
  const result = await runAuthorizedPurchase({
    authorization: auth,
    privateKey: FIXTURE_PRIVATE_KEY,
    fetchImpl,
    approve: true,
  });
  assert.equal(result.outcome, OUTCOMES.PARTIAL_DELIVERED);
  assert.equal(result.evidence.outputDelivery, "partial");
  assert.equal(result.evidence.outputValid, true);
  assert.match(result.message, /not a refund/i);
});

test("oversized invalid content timeout and unknown do not retry", async () => {
  const auth = normalizeAuthorization({
    ...DEFAULT_BATCH_AUTHORIZATION,
    requiredOutput: { ...DEFAULT_BATCH_AUTHORIZATION.requiredOutput, maxResponseBytes: 200 },
  });
  const useful = buildBatchUsefulBody({ urls: [...auth.batch.urls], fields: [...auth.batch.fields] });
  let calls = 0;
  const { encodePaymentRequiredHeader } = await import("@x402/core/http");
  const challenge = buildBatchChallenge();
  const fetchImpl = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    calls += 1;
    const paid = request.headers.has("payment-signature");
    if (!paid) {
      return new Response(JSON.stringify(challenge), {
        status: 402,
        headers: {
          "content-type": "application/json",
          "PAYMENT-REQUIRED": encodePaymentRequiredHeader(challenge),
        },
      });
    }
    return new Response(JSON.stringify(useful), {
      status: 200,
      headers: { "content-type": "application/json", "content-length": "5000" },
    });
  };
  const oversized = await runAuthorizedPurchase({
    authorization: auth,
    privateKey: FIXTURE_PRIVATE_KEY,
    fetchImpl,
    approve: true,
  });
  assert.ok(oversized.outcome === OUTCOMES.PAID_INVALID_OUTPUT || oversized.outcome === OUTCOMES.UNKNOWN);
  assert.equal(calls, 2);

  let unknownCalls = 0;
  const unknownFetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    unknownCalls += 1;
    if (!request.headers.has("payment-signature")) {
      return new Response(JSON.stringify(challenge), {
        status: 402,
        headers: {
          "content-type": "application/json",
          "PAYMENT-REQUIRED": encodePaymentRequiredHeader(challenge),
        },
      });
    }
    return new Response("{}", { status: 503 });
  };
  const unknown = await runAuthorizedPurchase({
    authorization: auth,
    privateKey: FIXTURE_PRIVATE_KEY,
    fetchImpl: unknownFetch,
    approve: true,
  });
  assert.equal(unknown.outcome, OUTCOMES.UNKNOWN);
  assert.equal(unknownCalls, 2);
});

test("batch secret redaction hides payment material", async () => {
  const auth = normalizeAuthorization(DEFAULT_BATCH_AUTHORIZATION);
  const key = generatePrivateKey();
  let paymentHeader;
  const base = createBatchFixtureFetch({ authorization: auth });
  const fetchImpl = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (request.headers.has("payment-signature")) {
      paymentHeader = request.headers.get("payment-signature");
      const body = buildBatchUsefulBody({ urls: [...auth.batch.urls], fields: [...auth.batch.fields] });
      body.echo = paymentHeader;
      body.signature = `0x${"cd".repeat(65)}`;
      return base.fetchImpl(new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: auth.bodyRaw,
      }), undefined).then(async (response) => {
        // Replace paid body with echoed secrets while preserving settlement.
        const settlement = response.headers.get("payment-response");
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: {
            "content-type": "application/json",
            ...(settlement ? { "payment-response": settlement } : {}),
          },
        });
      });
    }
    return base.fetchImpl(input, init);
  };
  const result = await runAuthorizedPurchase({
    authorization: auth,
    privateKey: key,
    fetchImpl,
    approve: true,
  });
  const text = safeJson(result);
  assertNoSecretMaterial(text);
  assert.equal(text.includes(key), false);
  assert.equal(text.includes(paymentHeader), false);
});

test("copyable batch CLI paths use fixture transport without auto-loading wallet on preflight", () => {
  const cwd = new URL("../", import.meta.url);
  const env = {
    PATH: process.env.PATH,
    NODE_OPTIONS: `--import=${fileURLToPath(new URL("cli-fixture.mjs", import.meta.url))}`,
  };
  const preflight = spawnSync("npm", ["start"], { cwd, env, encoding: "utf8", timeout: 10000 });
  assert.equal(preflight.status, 0, preflight.stderr);
  assert.match(preflight.stdout, /"outcome": "preflight_ok"/);
  assert.match(preflight.stdout, /"walletAccessed": false/);
  assert.match(preflight.stdout, /extract\/batch/);

  const key = generatePrivateKey();
  const purchase = spawnSync("npm", ["run", "purchase", "--", "--approve",
    "--authorization", "./fixtures/authorization-batch.json",
    "--private-key-env", "CUSTOMER_X402_PRIVATE_KEY"], {
    cwd, env: { ...env, CUSTOMER_X402_PRIVATE_KEY: key }, encoding: "utf8", timeout: 10000,
  });
  assert.equal(purchase.status, 0, purchase.stderr);
  assert.match(purchase.stdout, /"outcome": "useful_delivered"/);
  assert.equal(purchase.stdout.includes(key), false);

  const help = spawnSync(process.execPath, [CLI, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /authorization-batch-homepages/);
  assert.match(help.stdout, /never touches a wallet/);
});

test("owned homepage fixture exists for future live trial and is not auto-executed", () => {
  const fixture = JSON.parse(readFileSync(join(PKG, "fixtures/authorization-batch-homepages.json"), "utf8"));
  const auth = normalizeAuthorization(fixture);
  assert.deepEqual([...auth.batch.urls], [...OWNED_HOMEPAGE_BATCH_URLS]);
  assert.match(fixture.note || "", /future/i);
  const pkg = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8"));
  assert.equal(pkg.scripts.start.includes("homepages"), false);
});

test("GET suite path remains available through fixture helper", async () => {
  const { fetchImpl } = createFixtureFetch();
  const { DEFAULT_AUTHORIZATION, LIVE_EXTRACT_URL } = await import("../src/constants.mjs");
  const result = await runPreflight({
    url: LIVE_EXTRACT_URL,
    authorization: DEFAULT_AUTHORIZATION,
    fetchImpl,
  });
  assert.equal(result.outcome, OUTCOMES.PREFLIGHT_OK);
});
