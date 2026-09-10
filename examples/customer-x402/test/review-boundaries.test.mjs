import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import { DEFAULT_AUTHORIZATION, LIVE_EXTRACT_URL } from "../src/constants.mjs";
import { normalizeAuthorization, assertRequestMatchesAuthorization } from "../src/authorization.mjs";
import { runAuthorizedPurchase } from "../src/purchase.mjs";
import { runPreflight } from "../src/preflight.mjs";
import { safeJson } from "../src/redact.mjs";
import { buildChallenge, createFixtureFetch, FIXTURE_VALID_BODY } from "../fixtures/transport.mjs";

function buyer() {
  const account = privateKeyToAccount(generatePrivateKey());
  const signed = [];
  return { signed, account: { address: account.address, async signTypedData(value) {
    signed.push(value); return account.signTypedData(value);
  } } };
}
function responseFixture(paid, challenge = buildChallenge()) {
  const calls = [];
  return { calls, fetchImpl: async (input, init) => {
    const request = new Request(input, init);
    const hasPayment = request.headers.has("payment-signature");
    calls.push(hasPayment);
    if (hasPayment) return paid(request);
    return new Response(JSON.stringify(challenge), { status: 402,
      headers: { "payment-required": encodePaymentRequiredHeader(challenge), "content-type": "application/json" } });
  } };
}

for (const [name, mutate] of [
  ["resource URL", c => c.resource.url += "&other=1"],
  ["Permit2 approval path", c => { c.accepts[0].extra.assetTransferMethod = "permit2"; c.extensions = { eip2612GasSponsoring: {} }; }],
  ["EIP712 domain", c => c.accepts[0].extra.name = "Other Token"],
  ["unbounded signature validity", c => c.accepts[0].maxTimeoutSeconds = 999999999],
  ["wrong protocol version", c => c.x402Version = 1],
]) test(`${name} refused before wallet loader`, async () => {
  const challenge = buildChallenge(); mutate(challenge);
  const { fetchImpl, calls } = createFixtureFetch({ challenge });
  let loaded = false;
  const result = await runAuthorizedPurchase({ authorization: DEFAULT_AUTHORIZATION,
    approve: true, fetchImpl, loadAccount: () => { loaded = true; throw new Error("not authorized"); } });
  assert.equal(result.outcome, "authorization_refused");
  assert.equal(loaded, false);
  assert.equal(result.paymentSent, false);
  assert.equal(calls.length, 1);
});

test("exact query order and encoding are not normalized away", () => {
  const auth = { ...DEFAULT_AUTHORIZATION, url: `${LIVE_EXTRACT_URL}&b=2&a=1` };
  assert.throws(() => assertRequestMatchesAuthorization(`${LIVE_EXTRACT_URL}&a=1&b=2`, auth));
  assert.throws(() => assertRequestMatchesAuthorization(LIVE_EXTRACT_URL.replaceAll("%3A", "%3a"), DEFAULT_AUTHORIZATION));
});

test("invalid output bounds/paths fail before any transport", async () => {
  for (const maxResponseBytes of [NaN, Infinity, -1, 0, 1_000_001, "500000"]) {
    assert.throws(() => normalizeAuthorization({ ...DEFAULT_AUTHORIZATION,
      requiredOutput: { ...DEFAULT_AUTHORIZATION.requiredOutput, maxResponseBytes } }));
  }
  assert.throws(() => normalizeAuthorization({ ...DEFAULT_AUTHORIZATION,
    requiredOutput: { requiredFields: [null], mediaType: "application/json" } }));
});

test("official client signs one exact EIP3009 payload and sends one paid request", async () => {
  const { account, signed } = buyer();
  const { fetchImpl, calls } = createFixtureFetch();
  const result = await runAuthorizedPurchase({ authorization: DEFAULT_AUTHORIZATION, account, fetchImpl, approve: true });
  assert.equal(result.outcome, "valid_delivered");
  assert.equal(signed.length, 1);
  assert.equal(signed[0].primaryType, "TransferWithAuthorization");
  assert.equal(signed[0].domain.chainId, 8453);
  assert.equal(signed[0].domain.verifyingContract, DEFAULT_AUTHORIZATION.asset);
  assert.equal(signed[0].message.to, DEFAULT_AUTHORIZATION.recipient);
  assert.equal(signed[0].message.value, 5000n);
  assert.equal(calls.length, 2);
  assert.equal(calls.filter(call => call.hasPaymentSignature).length, 1);
});

for (const [name, makePaid, expected] of [
  ["network disconnect", () => { throw new Error("transport disconnected"); }, "unknown"],
  ["paid second challenge", () => new Response("{}", { status: 402 }), "unknown"],
  ["malformed non-2xx body", () => new Response("not-json", { status: 503 }), "unknown"],
  ["wrong media type", () => new Response(JSON.stringify(FIXTURE_VALID_BODY), { headers: { "content-type": "text/plain" } }), "paid_invalid_output"],
  ["null required value", () => Response.json({ ...FIXTURE_VALID_BODY, title: null }), "paid_invalid_output"],
  ["omitted required value", () => { const data = { ...FIXTURE_VALID_BODY }; delete data.title; return Response.json(data); }, "paid_invalid_output"],
  ["source HTTP 403 with block text", () => Response.json({ ...FIXTURE_VALID_BODY, status: 403, sourceOk: false, error: { code: "http_403", message: "source refused: HTTP 403" }, text: "Access denied" }), "partial_delivered"],
  ["source HTTP 404 with typed body", () => Response.json({
    ...FIXTURE_VALID_BODY,
    status: 404,
    sourceOk: false,
    error: { code: "http_404", message: "source refused: HTTP 404" },
    text: "helpful looking missing page",
  }), "partial_delivered"],
  ["non-JSON success", () => new Response("not-json", { headers: { "content-type": "application/json",
    "payment-response": encodePaymentResponseHeader({ success: true, transaction: `0x${"ab".repeat(32)}`, network: "eip155:8453" }) } }), "paid_invalid_output"],
]) test(`${name}: truthful evidence with no paid retry`, async () => {
  const { account, signed } = buyer();
  const { fetchImpl, calls } = responseFixture(makePaid);
  const result = await runAuthorizedPurchase({ authorization: DEFAULT_AUTHORIZATION, account, fetchImpl, approve: true });
  assert.equal(result.outcome, expected);
  assert.equal(result.paymentSigned, true);
  assert.equal(result.paymentSent, true);
  assert.equal(signed.length, 1);
  assert.equal(calls.filter(Boolean).length, 1);
  if (name === "non-JSON success") assert.equal(result.evidence.settlementPresent, true);
});

test("response bytes and stalled body reads are bounded after a possible paid send", async () => {
  for (const kind of ["oversized", "stalled"]) {
    let cancelled = false;
    const stream = new ReadableStream({
      start(controller) { if (kind === "oversized") controller.enqueue(new Uint8Array(500_001)); },
      cancel() { cancelled = true; },
    });
    const { account } = buyer();
    const { fetchImpl, calls } = responseFixture(() => new Response(stream));
    const result = await runAuthorizedPurchase({ authorization: DEFAULT_AUTHORIZATION,
      approve: true, account, fetchImpl, timeoutMs: 50 });
    assert.equal(result.outcome, kind === "oversized" ? "paid_invalid_output" : "unknown");
    assert.equal(result.paymentSent, true);
    assert.equal(calls.filter(Boolean).length, 1);
    assert.equal(cancelled, true);
  }
});

test("preflight refuses non-HTTPS and bounds challenge bodies", async () => {
  let called = false;
  await assert.rejects(() => runPreflight({ url: "http://example.com/extract?url=x",
    fetchImpl: () => { called = true; } }));
  assert.equal(called, false);
  await assert.rejects(() => runPreflight({ url: LIVE_EXTRACT_URL,
    fetchImpl: () => new Response("x".repeat(64_001), { status: 402 }) }));
});

test("CLI refuses exact URL mismatch before reading an absent wallet", () => {
  const result = spawnSync(process.execPath, ["bin/cli.mjs", "--approve", "--authorization",
    "fixtures/authorization.json", "--url", `${LIVE_EXTRACT_URL}&wrong=1`,
    "--private-key-env", "C21_DELIBERATELY_UNSET"], { cwd: new URL("../", import.meta.url), encoding: "utf8" });
  const receipt = JSON.parse(result.stdout || result.stderr);
  assert.equal(receipt.outcome, "authorization_refused");
  assert.equal(receipt.walletAccessed, false);
});

test("receipt output hides reflected signatures and opaque payment headers", async () => {
  let paymentHeader;
  const { fetchImpl } = responseFixture(request => {
    paymentHeader = request.headers.get("payment-signature");
    return Response.json({ ...FIXTURE_VALID_BODY, echo: paymentHeader, signature: `0x${"ab".repeat(65)}` });
  });
  const { account } = buyer();
  const result = await runAuthorizedPurchase({ authorization: DEFAULT_AUTHORIZATION, account, fetchImpl, approve: true });
  const text = safeJson(result);
  assert.equal(text.includes(paymentHeader), false);
  assert.equal(text.includes("ab".repeat(65)), false);
});

test("copyable npm commands run the real CLI with only fixture transport and wallet", () => {
  const cwd = new URL("../", import.meta.url);
  const env = { PATH: process.env.PATH,
    NODE_OPTIONS: `--import=${fileURLToPath(new URL("cli-fixture.mjs", import.meta.url))}` };
  const preflight = spawnSync("npm", ["start"], { cwd, env, encoding: "utf8", timeout: 10000 });
  assert.equal(preflight.status, 0, preflight.stderr);
  assert.match(preflight.stdout, /"outcome": "preflight_ok"/);
  assert.match(preflight.stdout, /"walletAccessed": false/);
  const key = generatePrivateKey();
  const purchase = spawnSync("npm", ["run", "purchase", "--", "--approve", "--authorization",
    "./fixtures/authorization-batch.json", "--private-key-env", "CUSTOMER_X402_PRIVATE_KEY"], {
    cwd, env: { ...env, CUSTOMER_X402_PRIVATE_KEY: key }, encoding: "utf8", timeout: 10000,
  });
  assert.equal(purchase.status, 0, purchase.stderr);
  assert.match(purchase.stdout, /"outcome": "useful_delivered"/);
  assert.equal(purchase.stdout.includes(key), false);

  const getEnv = { ...env, CUSTOMER_X402_FIXTURE_MODE: "get" };
  const getPreflight = spawnSync("npm", ["run", "preflight:get"], {
    cwd, env: getEnv, encoding: "utf8", timeout: 10000,
  });
  assert.equal(getPreflight.status, 0, getPreflight.stderr);
  assert.match(getPreflight.stdout, /"outcome": "preflight_ok"/);
});

test("redirects are not followed before or after signing", async () => {
  const { account } = buyer();
  const { fetchImpl, calls } = responseFixture(request => {
    assert.equal(request.redirect, "error");
    return new Response(null, { status: 302, headers: { location: "https://other.example/" } });
  });
  const paid = await runAuthorizedPurchase({ authorization: DEFAULT_AUTHORIZATION, account, fetchImpl, approve: true });
  assert.equal(paid.outcome, "unknown");
  assert.equal(calls.filter(Boolean).length, 1);
  let loaded = false;
  const unpaid = await runAuthorizedPurchase({ authorization: DEFAULT_AUTHORIZATION, approve: true,
    loadAccount: () => { loaded = true; }, fetchImpl: (_input, init) => {
      assert.equal(init.redirect, "error"); return new Response(null, { status: 302 });
    } });
  assert.equal(unpaid.paymentSent, false);
  assert.equal(loaded, false);
});
