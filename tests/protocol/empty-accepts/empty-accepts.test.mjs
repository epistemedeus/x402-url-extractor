import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ExactEvmScheme } from "@x402/evm";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { createX402ToolMeta } from "../../../mcp-server.mjs";
import { issuedOfferFromX402Accepts } from "../../../mcp-typed-telemetry-producer.mjs";
import {
  decodeChallengeFromResponse,
  decodeSettlementHeader,
  selectExactAccept,
} from "../../../examples/customer-x402/src/challenge.mjs";
import { DEFAULT_AUTHORIZATION, LIVE_EXTRACT_URL, OUTCOMES } from "../../../examples/customer-x402/src/constants.mjs";
import { runAuthorizedPurchase } from "../../../examples/customer-x402/src/purchase.mjs";
import {
  createEmptyAcceptsFetch,
  emptyAcceptsChallenge,
  hostileSettlementFrom,
  seededFailureChallenge,
  startEmptyAcceptsServer,
} from "./fixture.mjs";
import {
  EMPTY_ACCEPTS_CODE,
  EmptyAcceptsError,
  isEmptyAccepts,
  loadEmptyAcceptsChallenge,
  loadSeededFailureChallenge,
  neverSettledProof,
  throwIfEmptyAccepts,
  throwOnEmptyAcceptsResponse,
} from "./throw.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const RUN = join(ROOT, "run.mjs");

function throwingSigner() {
  return {
    address: "0x1111111111111111111111111111111111111111",
    async signTypedData() {
      throw new Error("signer must not be used for empty accepts");
    },
  };
}

function throwingAccount() {
  return new Proxy({}, {
    get() {
      throw new Error("signer accessed before empty-accepts throw");
    },
  });
}

test("canonical fixture JSON has empty accepts and no payable option", () => {
  const challenge = loadEmptyAcceptsChallenge();
  assert.equal(challenge.x402Version, 2);
  assert.deepEqual(challenge.accepts, []);
  assert.equal(isEmptyAccepts(challenge), true);
  assert.equal(isEmptyAccepts({ x402Version: 2 }), true);
  assert.equal(isEmptyAccepts({ x402Version: 2, accepts: null }), true);
  assert.equal(isEmptyAccepts({ x402Version: 2, accepts: [{ scheme: "exact" }] }), false);
});

test("buyer selectExactAccept throws on empty accepts", () => {
  assert.throws(
    () => selectExactAccept(loadEmptyAcceptsChallenge()),
    (error) => error.code === "no_compatible_accept",
  );
  assert.throws(
    () => throwIfEmptyAccepts(loadEmptyAcceptsChallenge()),
    (error) => error instanceof EmptyAcceptsError && error.code === EMPTY_ACCEPTS_CODE && error.settled === false,
  );
});

test("MCP tool metadata and issued-offer projection refuse empty accepts", () => {
  assert.throws(() => createX402ToolMeta([]), /at least one payment option/);
  assert.equal(issuedOfferFromX402Accepts([]), null);
});

test("official x402Client createPaymentPayload throws and does not sign", async () => {
  const signed = [];
  const client = new x402Client().register("eip155:8453", new ExactEvmScheme({
    address: throwingSigner().address,
    async signTypedData(value) {
      signed.push(value);
      throw new Error("must not sign empty accepts");
    },
  }));
  await assert.rejects(
    () => client.createPaymentPayload(emptyAcceptsChallenge()),
    /No network\/scheme registered/,
  );
  assert.equal(signed.length, 0);
});

test("loopback 402 fixture never upgrades a PAYMENT-SIGNATURE to settlement", async () => {
  const fixture = await startEmptyAcceptsServer();
  try {
    const unpaid = await fetch(fixture.url);
    assert.equal(unpaid.status, 402);
    const body = await unpaid.json();
    assert.deepEqual(body.accepts, []);
    const decoded = decodePaymentRequiredHeader(unpaid.headers.get("payment-required"));
    assert.deepEqual(decoded.accepts, []);
    assert.equal(unpaid.headers.get("payment-response"), null);

    const paid = await fetch(fixture.url, { headers: { "PAYMENT-SIGNATURE": "not-a-payload" } });
    assert.equal(paid.status, 402);
    assert.equal(paid.headers.get("payment-response"), null);
    assert.equal(fixture.stats.paidAttempts, 1);
    assert.equal(fixture.stats.settleCalls, 0);
    assert.deepEqual(neverSettledProof(fixture.stats).settled, false);
  } finally {
    await fixture.close();
  }
});

test("throw gate fires on a live fixture response before wrapFetchWithPayment can pay", async () => {
  const fixture = await startEmptyAcceptsServer();
  try {
    const unpaid = await fetch(fixture.url);
    await assert.rejects(
      () => throwOnEmptyAcceptsResponse(unpaid),
      EmptyAcceptsError,
    );

    const client = new x402Client().register("eip155:8453", new ExactEvmScheme(throwingSigner()));
    await assert.rejects(
      () => wrapFetchWithPayment(fetch, client)(fixture.url, { method: "GET" }),
      /Failed to create payment payload|No network\/scheme registered/,
    );
    assert.equal(fixture.stats.paidAttempts, 0);
    assert.equal(fixture.stats.settleCalls, 0);
  } finally {
    await fixture.close();
  }
});

test("authorized purchase path never accesses a wallet or sends payment", async () => {
  const challenge = emptyAcceptsChallenge({ url: LIVE_EXTRACT_URL });
  const { fetchImpl, calls } = createEmptyAcceptsFetch({ challenge });
  const result = await runAuthorizedPurchase({
    authorization: DEFAULT_AUTHORIZATION,
    account: throwingAccount(),
    fetchImpl,
    approve: true,
  });
  assert.notEqual(result.outcome, OUTCOMES.VALID_DELIVERED);
  assert.equal(result.walletAccessed, false);
  assert.equal(result.paymentSigned, false);
  assert.equal(result.paymentSent, false);
  assert.equal(result.evidence.settlementVerification, "absent");
  assert.equal(calls.every((call) => call.hasPaymentSignature === false), true);
});

test("seeded failure: empty accepts plus claimed PAYMENT-RESPONSE is rejected", async () => {
  const seeded = loadSeededFailureChallenge();
  assert.equal(seeded.seededFailure.mustReject, true);
  assert.equal(seeded.seededFailure.settlement.success, true);
  assert.deepEqual(seeded.accepts, []);

  const challenge = seededFailureChallenge({ url: LIVE_EXTRACT_URL });
  const { fetchImpl, calls } = createEmptyAcceptsFetch({
    challenge,
    settlement: hostileSettlementFrom(challenge),
  });
  const unpaid = await fetchImpl(LIVE_EXTRACT_URL);
  const settlement = decodeSettlementHeader(unpaid);
  assert.equal(settlement.present, true);
  assert.equal(settlement.decoded.success, true);
  decodeChallengeFromResponse(unpaid, await unpaid.clone().text());

  await assert.rejects(
    () => throwOnEmptyAcceptsResponse(unpaid),
    (error) => (
      error instanceof EmptyAcceptsError &&
      error.settled === false &&
      error.settlementClaim?.present === true &&
      error.settlementVerification === "absent"
    ),
  );

  const result = await runAuthorizedPurchase({
    authorization: DEFAULT_AUTHORIZATION,
    account: throwingAccount(),
    fetchImpl,
    approve: true,
  });
  assert.notEqual(result.outcome, OUTCOMES.VALID_DELIVERED);
  assert.notEqual(result.outcome, OUTCOMES.SETTLEMENT_FAILED);
  assert.equal(result.paymentSent, false);
  assert.equal(result.evidence.settlementVerification, "absent");
  assert.equal(calls.filter((call) => call.hasPaymentSignature).length, 0);
});

test("naive settler that trusts accepts[0] or PAYMENT-RESPONSE is rejected", () => {
  const challenge = loadEmptyAcceptsChallenge();
  const naiveAccept = challenge.accepts[0];
  assert.equal(naiveAccept, undefined);
  assert.throws(
    () => throwIfEmptyAccepts(challenge, { settlement: { present: true, success: true } }),
    EmptyAcceptsError,
  );
});

test("cold run CLI and seeded-failure CLI both prove never-settle", () => {
  const cold = spawnSync(process.execPath, [RUN, "--json"], { encoding: "utf8" });
  assert.equal(cold.status, 0, cold.stderr || cold.stdout);
  const coldResult = JSON.parse(cold.stdout);
  assert.equal(coldResult.mode, "cold");
  assert.equal(coldResult.ok, true);
  assert.equal(coldResult.gate.code, EMPTY_ACCEPTS_CODE);
  assert.equal(coldResult.neverSettle.settled, false);
  assert.equal(coldResult.stats.paidAttempts, 0);
  assert.equal(coldResult.stats.settleCalls, 0);

  const seeded = spawnSync(process.execPath, [RUN, "--seeded-failure", "--json"], { encoding: "utf8" });
  assert.equal(seeded.status, 0, seeded.stderr || seeded.stdout);
  const seededResult = JSON.parse(seeded.stdout);
  assert.equal(seededResult.mode, "seeded-failure");
  assert.equal(seededResult.rejected, true);
  assert.equal(seededResult.gate.settlementClaim.present, true);
  assert.equal(seededResult.neverSettle.settled, false);
  assert.equal(seededResult.stats.paidAttempts, 0);

  const settle = spawnSync(process.execPath, [RUN, "--settle"], { encoding: "utf8" });
  assert.equal(settle.status, 2);
  assert.match(settle.stderr, /never settles/);
});
