import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { DEFAULT_AUTHORIZATION, LIVE_EXTRACT_URL, OUTCOMES } from "../src/constants.mjs";
import {
  AuthorizationRefusal,
  assertAcceptMatchesAuthorization,
  assertRequestMatchesAuthorization,
  normalizeAuthorization,
} from "../src/authorization.mjs";
import { runPreflight } from "../src/preflight.mjs";
import { runAuthorizedPurchase } from "../src/purchase.mjs";
import { assertNoSecretMaterial, safeJson } from "../src/redact.mjs";
import {
  FIXTURE_INVALID_BODY,
  FIXTURE_VALID_BODY,
  buildChallenge,
  createFixtureFetch,
} from "../fixtures/transport.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PKG = join(ROOT, "..");
const CLI = join(PKG, "bin/cli.mjs");

/** Deterministic ephemeral fixture key for local tests only. Never printed. */
const FIXTURE_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

function throwingAccount() {
  return new Proxy({}, {
    get() {
      throw new Error("signer accessed before authorization");
    },
  });
}

test("unpaid preflight never looks up wallet credentials", async () => {
  const { fetchImpl, calls } = createFixtureFetch();
  const previous = { ...process.env };
  delete process.env.CUSTOMER_X402_PRIVATE_KEY;
  delete process.env.PRIVATE_KEY;
  delete process.env.EVM_PRIVATE_KEY;

  const result = await runPreflight({
    url: LIVE_EXTRACT_URL,
    authorization: DEFAULT_AUTHORIZATION,
    fetchImpl,
  });

  assert.equal(result.outcome, OUTCOMES.PREFLIGHT_OK);
  assert.equal(result.walletAccessed, false);
  assert.equal(result.paymentSigned, false);
  assert.equal(result.paymentSent, false);
  assert.equal(calls.every((call) => call.hasPaymentSignature === false), true);
  assert.equal(process.env.CUSTOMER_X402_PRIVATE_KEY, undefined);
  Object.assign(process.env, previous);
});

test("explicit approved exact request delivers valid output with unverified settlement", async () => {
  const { fetchImpl } = createFixtureFetch({ paidBody: FIXTURE_VALID_BODY });
  const account = privateKeyToAccount(FIXTURE_PRIVATE_KEY);
  const result = await runAuthorizedPurchase({
    authorization: DEFAULT_AUTHORIZATION,
    account,
    fetchImpl,
    approve: true,
  });

  assert.equal(result.outcome, OUTCOMES.VALID_DELIVERED);
  assert.equal(result.evidence.outputValid, true);
  assert.equal(result.evidence.settlementVerification, "unverified");
  assert.equal(result.paymentSent, true);
  assertNoSecretMaterial(safeJson(result));
  assert.equal(safeJson(result).includes(FIXTURE_PRIVATE_KEY.slice(2)), false);
});

test("changed recipient is refused before signer", async () => {
  const challenge = buildChallenge({ payTo: "0x0000000000000000000000000000000000000001" });
  const { fetchImpl } = createFixtureFetch({ challenge });
  const result = await runAuthorizedPurchase({
    authorization: DEFAULT_AUTHORIZATION,
    account: throwingAccount(),
    fetchImpl,
    approve: true,
  });
  assert.equal(result.outcome, OUTCOMES.AUTHORIZATION_REFUSED);
  assert.equal(result.walletAccessed, false);
  assert.equal(result.paymentSigned, false);
  assert.equal(result.paymentSent, false);
  assert.match(result.message, /recipient/i);
});

test("changed asset is refused before signer", async () => {
  const challenge = buildChallenge({ asset: "0x0000000000000000000000000000000000000002" });
  const { fetchImpl } = createFixtureFetch({ challenge });
  const result = await runAuthorizedPurchase({
    authorization: DEFAULT_AUTHORIZATION,
    account: throwingAccount(),
    fetchImpl,
    approve: true,
  });
  assert.equal(result.outcome, OUTCOMES.AUTHORIZATION_REFUSED);
  assert.equal(result.walletAccessed, false);
});

test("changed network is refused before signer", async () => {
  const challenge = buildChallenge({ network: "eip155:84532" });
  const { fetchImpl } = createFixtureFetch({ challenge });
  const result = await runAuthorizedPurchase({
    authorization: DEFAULT_AUTHORIZATION,
    account: throwingAccount(),
    fetchImpl,
    approve: true,
  });
  assert.equal(result.outcome, OUTCOMES.AUTHORIZATION_REFUSED);
  assert.equal(result.walletAccessed, false);
});

test("amount over cap is refused before signer", async () => {
  const challenge = buildChallenge({ amount: "5001" });
  const { fetchImpl } = createFixtureFetch({ challenge });
  const result = await runAuthorizedPurchase({
    authorization: DEFAULT_AUTHORIZATION,
    account: throwingAccount(),
    fetchImpl,
    approve: true,
  });
  assert.equal(result.outcome, OUTCOMES.AUTHORIZATION_REFUSED);
  assert.match(result.message, /amount/i);
});

test("changed URL is refused before signer", () => {
  assert.throws(
    () => assertRequestMatchesAuthorization(
      "https://agents.samedaydesk.com/extract?url=https%3A%2F%2Fevil.example",
      DEFAULT_AUTHORIZATION,
    ),
    AuthorizationRefusal,
  );
});

test("request body is refused before signer", () => {
  assert.throws(
    () => assertRequestMatchesAuthorization(LIVE_EXTRACT_URL, DEFAULT_AUTHORIZATION, {
      method: "GET",
      body: "{\"no\":true}",
    }),
    /body/i,
  );
});

test("paid invalid output retains evidence and stays a distinct outcome", async () => {
  const { fetchImpl } = createFixtureFetch({ paidBody: FIXTURE_INVALID_BODY });
  const result = await runAuthorizedPurchase({
    authorization: DEFAULT_AUTHORIZATION,
    privateKey: FIXTURE_PRIVATE_KEY,
    fetchImpl,
    approve: true,
  });
  assert.equal(result.outcome, OUTCOMES.PAID_INVALID_OUTPUT);
  assert.equal(result.evidence.outputValid, false);
  assert.ok(result.evidence.retainedBody);
  assert.equal(result.evidence.settlementVerification, "unverified");
});

test("settlement success=false is distinct from invalid output", async () => {
  const { fetchImpl } = createFixtureFetch({
    paidBody: FIXTURE_VALID_BODY,
    settlement: { success: false, errorReason: "fixture settle failure", network: "eip155:8453" },
  });
  const result = await runAuthorizedPurchase({
    authorization: DEFAULT_AUTHORIZATION,
    privateKey: FIXTURE_PRIVATE_KEY,
    fetchImpl,
    approve: true,
  });
  assert.equal(result.outcome, OUTCOMES.SETTLEMENT_FAILED);
  assert.notEqual(result.outcome, OUTCOMES.PAID_INVALID_OUTPUT);
});

test("unknown HTTP status does not retry", async () => {
  let calls = 0;
  const { encodePaymentRequiredHeader } = await import("@x402/core/http");
  const challenge = buildChallenge();
  const fetchImpl = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    calls += 1;
    const paid =
      request.headers.has("PAYMENT-SIGNATURE") ||
      request.headers.has("payment-signature") ||
      request.headers.has("X-PAYMENT") ||
      request.headers.has("x-payment");
    if (!paid) {
      return new Response(JSON.stringify(challenge), {
        status: 402,
        headers: {
          "content-type": "application/json",
          "PAYMENT-REQUIRED": encodePaymentRequiredHeader(challenge),
        },
      });
    }
    return new Response(JSON.stringify({ error: "upstream" }), { status: 503 });
  };
  const result = await runAuthorizedPurchase({
    authorization: DEFAULT_AUTHORIZATION,
    privateKey: FIXTURE_PRIVATE_KEY,
    fetchImpl,
    approve: true,
  });
  assert.equal(result.outcome, OUTCOMES.UNKNOWN);
  assert.equal(calls, 2); // inspected challenge is reused by official wrapper + one paid attempt
});

test("logs never include fixture private keys", async () => {
  const key = generatePrivateKey();
  const { fetchImpl } = createFixtureFetch();
  const result = await runAuthorizedPurchase({
    authorization: DEFAULT_AUTHORIZATION,
    privateKey: key,
    fetchImpl,
    approve: true,
  });
  const printed = safeJson(result);
  assertNoSecretMaterial(printed);
  assert.equal(printed.includes(key.slice(2)), false);
  assert.equal(printed.includes(key), false);
});

test("mcp:// targets are refused", async () => {
  await assert.rejects(
    () => runPreflight({ url: "mcp://agents.samedaydesk.com/extract" }),
    /mcp:\/\//,
  );
});

test("copyable README default command runs unpaid preflight against fixture via --help and package scripts", () => {
  const help = spawnSync(process.execPath, [CLI, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Credential-free unpaid preflight/);
  assert.match(help.stdout, /never touches a wallet/);

  const pkg = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8"));
  assert.equal(pkg.dependencies["@x402/fetch"], "2.16.0");
  assert.equal(pkg.dependencies["@x402/evm"], "2.16.0");
  assert.equal(pkg.dependencies["@x402/core"], "2.16.0");
  assert.equal(pkg.dependencies.viem, "2.55.11");
  assert.equal(pkg.dependencies["agent-payment-policy"], "0.12.0");
  assert.equal(pkg.scripts.start, "node bin/cli.mjs");
});

test("accept matcher binds exact terms", () => {
  const auth = normalizeAuthorization(DEFAULT_AUTHORIZATION);
  const accept = buildChallenge().accepts[0];
  const matched = assertAcceptMatchesAuthorization(accept, auth);
  assert.equal(matched.selectedAmountAtomic, "5000");
  assert.throws(
    () => assertAcceptMatchesAuthorization({ ...accept, amount: "999999" }, auth),
    /amount/,
  );
});

test("bounded credential-free production preflight", { skip: process.env.CUSTOMER_X402_LIVE_PREFLIGHT !== "1" }, async () => {
  const result = await runPreflight({
    url: LIVE_EXTRACT_URL,
    authorization: DEFAULT_AUTHORIZATION,
  });
  assert.equal(result.outcome, OUTCOMES.PREFLIGHT_OK);
  assert.equal(result.httpStatus, 402);
  assert.equal(result.offer.network, "eip155:8453");
  assert.equal(result.offer.amountAtomic, "5000");
  assert.equal(result.walletAccessed, false);
  assert.equal(result.paymentSigned, false);
  assert.equal(result.paymentSent, false);
});
