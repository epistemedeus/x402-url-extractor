import assert from "node:assert/strict";
import test from "node:test";
import { Challenge } from "mppx";
import { evm as evmClient, Mppx as ClientMppx } from "mppx/client";
import { privateKeyToAccount } from "viem/accounts";
import {
  createMppDualStack,
  mppAssetForNetwork,
} from "./mpp-dual-stack.mjs";
import { decodeReplayPayment } from "./idempotency-replay.mjs";

const NETWORK = "eip155:84532";
const PAY_TO = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
const PUBLIC_URL = "https://agents.example.com";
const SECRET = "test-secret-key-test-secret-key-32";
const TRANSACTION = `0x${"1".repeat(64)}`;
const account = privateKeyToAccount(
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
);

async function createTestMppCredential({ challenge, maxAmount }) {
  const client = ClientMppx.create({
    methods: [evmClient({
      account,
      currencies: [mppAssetForNetwork(NETWORK)],
      maxAmount,
    })],
    polyfill: false,
  });
  return client.createCredential(challenge);
}

function harness() {
  const calls = { settle: 0, verify: 0 };
  const dual = createMppDualStack({
    facilitatorClient: {
      async verify() {
        calls.verify += 1;
        return { isValid: true };
      },
      async settle(_payload, requirements) {
        calls.settle += 1;
        return {
          network: requirements.network,
          payer: account.address,
          success: true,
          transaction: TRANSACTION,
        };
      },
    },
    network: NETWORK,
    payTo: PAY_TO,
    publicUrl: PUBLIC_URL,
    realm: "agents.example.com",
    routes: [{
      amount: "$0.25",
      description: "Deterministic report",
      method: "GET",
      path: "/report",
    }],
    secretKey: SECRET,
  });
  return { calls, dual };
}

test("stays explicitly disabled until a production secret is configured", async () => {
  const dual = createMppDualStack({
    network: NETWORK,
    payTo: PAY_TO,
    publicUrl: PUBLIC_URL,
    routes: [],
  });
  assert.equal(dual.enabled, false);
  assert.match(dual.reason, /MPP_SECRET_KEY/);
  assert.deepEqual(await dual.authorize(new Request(`${PUBLIC_URL}/report`)), { kind: "disabled" });
});

test("issues a route-bound native MPP challenge with matching economics", async () => {
  const { calls, dual } = harness();
  const result = await dual.authorize(new Request(`${PUBLIC_URL}/report?b=2&a=1`));
  assert.equal(result.kind, "challenge");
  assert.equal(result.challenge.status, 402);
  assert.match(result.challenge.headers.get("www-authenticate"), /^Payment /);

  const challenge = Challenge.fromResponse(result.challenge);
  assert.equal(challenge.method, "evm");
  assert.equal(challenge.intent, "charge");
  assert.equal(challenge.realm, "agents.example.com");
  assert.equal(challenge.request.amount, "250000");
  assert.equal(challenge.request.currency, mppAssetForNetwork(NETWORK).address);
  assert.equal(challenge.request.recipient, PAY_TO);
  assert.equal(challenge.request.methodDetails.chainId, 84532);
  assert.equal(calls.verify, 0);
  assert.equal(calls.settle, 0);
});

test("leaves extension-rich x402 credentials to the existing x402 middleware", async () => {
  const { calls, dual } = harness();
  const result = await dual.authorize(new Request(`${PUBLIC_URL}/report`, {
    headers: { "PAYMENT-SIGNATURE": "opaque-x402-credential" },
  }));
  assert.deepEqual(result, { kind: "x402" });
  assert.equal(calls.verify, 0);
  assert.equal(calls.settle, 0);
});

test("settles a native MPP credential and emits a Payment-Receipt", async () => {
  const { calls, dual } = harness();
  const initial = await dual.authorize(new Request(`${PUBLIC_URL}/report?a=1&b=2`));
  assert.equal(initial.kind, "challenge");
  const authorization = await createTestMppCredential({
    challenge: initial.challenge,
    maxAmount: "0.25",
  });

  const paid = await dual.authorize(new Request(`${PUBLIC_URL}/report?b=2&a=1`, {
    headers: { Authorization: authorization },
  }));
  assert.equal(paid.kind, "paid");
  assert.ok(paid.receipt.headers.get("payment-receipt"));
  assert.equal(calls.verify, 1);
  assert.equal(calls.settle, 1);

  const replay = decodeReplayPayment({ authorization });
  assert.equal(replay.protocol, "mpp");
  assert.equal(replay.payer, account.address.toLowerCase());
  assert.equal(replay.terms.amount, "250000");
  assert.equal(replay.terms.payTo, PAY_TO.toLowerCase());
  assert.equal(replay.terms.network, NETWORK);
  assert.match(replay.id, /^[0-9a-f]{64}$/);
});

test("rejects a credential replayed across different query inputs before settlement", async () => {
  const { calls, dual } = harness();
  const initial = await dual.authorize(new Request(`${PUBLIC_URL}/report?a=1`));
  assert.equal(initial.kind, "challenge");
  const authorization = await createTestMppCredential({
    challenge: initial.challenge,
    maxAmount: "0.25",
  });

  const rejected = await dual.authorize(new Request(`${PUBLIC_URL}/report?a=2`, {
    headers: { Authorization: authorization },
  }));
  assert.equal(rejected.kind, "rejected");
  assert.equal(rejected.challenge.status, 402);
  assert.equal(calls.verify, 0);
  assert.equal(calls.settle, 0);
});

test("canonicalizes query ordering so a logically identical request remains payable", async () => {
  const { calls, dual } = harness();
  const initial = await dual.authorize(new Request(`${PUBLIC_URL}/report?z=3&a=1`));
  assert.equal(initial.kind, "challenge");
  const authorization = await createTestMppCredential({
    challenge: initial.challenge,
    maxAmount: "0.25",
  });

  const paid = await dual.authorize(new Request(`${PUBLIC_URL}/report?a=1&z=3`, {
    headers: { Authorization: authorization },
  }));
  assert.equal(paid.kind, "paid");
  assert.equal(calls.verify, 1);
  assert.equal(calls.settle, 1);
});

test("fails closed on short challenge-integrity keys", () => {
  assert.throws(() => createMppDualStack({
    facilitatorClient: { verify() {}, settle() {} },
    network: NETWORK,
    payTo: PAY_TO,
    publicUrl: PUBLIC_URL,
    routes: [{ amount: "0.01", path: "/report" }],
    secretKey: "short",
  }), /at least 32 bytes/);
});
