import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { classifyCommerceRoute, createCommerceTelemetry } from "./commerce-events.mjs";
import { createCommerceTrust } from "./commerce-trust.mjs";
import {
  ReceiptReferralRecheckError,
  createReceiptReferralClaimStore,
  receiptReferralId,
  receiptReferralRecheck,
  receiptReferralRecheckOutputSchema,
} from "./receipt-referral-recheck.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_URL = "https://agents.samedaydesk.com";
const NETWORK = "eip155:8453";
const PRIVATE_KEY = `0x${"1".repeat(64)}`;
const FOREIGN_KEY = `0x${"2".repeat(64)}`;
const PAYER_ONE = `0x${"a".repeat(40)}`;
const PAYER_TWO = `0x${"b".repeat(40)}`;
const TX_ONE = `0x${"1".repeat(64)}`;
const TX_TWO = `0x${"2".repeat(64)}`;
const AUDIT_ROUTE_FOR_TEST = "/commerce/seller-integrity-audit";
const ORIGINAL_URL = `${PUBLIC_URL}/commerce/seller-integrity-audit?origin=https%3A%2F%2Fseller.example&route=%2Fpaid&method=GET&requiredPaths=data.id&requireBazaar=true`;
const trust = createCommerceTrust({ privateKey: PRIVATE_KEY, network: NETWORK });
const foreignTrust = createCommerceTrust({ privateKey: FOREIGN_KEY, network: NETWORK });

function downstreamUrl(referralId) {
  return `${PUBLIC_URL}/commerce/seller-integrity-audit?origin=https%3A%2F%2Fdownstream.example&route=%2Fchanged&method=POST&referral=${referralId}`;
}

async function signedReceipt({
  issuer = trust.issuer,
  resourceUrl,
  payer,
  network = NETWORK,
  transaction,
  issuedAt,
}) {
  const realNow = Date.now;
  Date.now = () => issuedAt * 1000;
  try {
    return await issuer.issueReceipt(resourceUrl, payer, network, transaction);
  } finally {
    Date.now = realNow;
  }
}

async function receiptPair({
  originalIssuer,
  downstreamIssuer,
  originalUrl = ORIGINAL_URL,
  downstreamUrlFor = downstreamUrl,
  originalPayer = PAYER_ONE,
  downstreamPayer = PAYER_TWO,
  originalNetwork = NETWORK,
  downstreamNetwork = NETWORK,
  originalTransaction = TX_ONE,
  downstreamTransaction = TX_TWO,
  originalIssuedAt = 1_800_000_000,
  downstreamIssuedAt = 1_800_000_001,
} = {}) {
  const original = await signedReceipt({
    issuer: originalIssuer || trust.issuer,
    resourceUrl: originalUrl,
    payer: originalPayer,
    network: originalNetwork,
    transaction: originalTransaction,
    issuedAt: originalIssuedAt,
  });
  const referralId = receiptReferralId(original);
  const downstream = await signedReceipt({
    issuer: downstreamIssuer || trust.issuer,
    resourceUrl: downstreamUrlFor(referralId),
    payer: downstreamPayer,
    network: downstreamNetwork,
    transaction: downstreamTransaction,
    issuedAt: downstreamIssuedAt,
  });
  const pair = { original, downstream };
  Object.defineProperty(pair, "referralId", { value: referralId, enumerable: false });
  return pair;
}

async function testStore(t, prefix = "receipt-referral-recheck-") {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  return { dataDir, claimStore: createReceiptReferralClaimStore({ dataDir }) };
}

function options(claimStore, audit) {
  return {
    merchantSigner: trust.signerAddress,
    network: NETWORK,
    publicUrl: PUBLIC_URL,
    claimStore,
    audit,
  };
}

async function expectCode(promise, code, statusCode = 400) {
  await assert.rejects(promise, (error) => {
    assert.equal(error instanceof ReceiptReferralRecheckError, true);
    assert.equal(error.code, code);
    assert.equal(error.statusCode, statusCode);
    return true;
  });
}

test("valid two-receipt claim reruns only the original signed target and persists an empty private marker", async (t) => {
  const { dataDir, claimStore } = await testStore(t);
  const pair = await receiptPair();
  let auditedInput;
  const result = await receiptReferralRecheck(pair, options(claimStore, async (input) => {
    auditedInput = input;
    return { ok: true, decision: "machine_buyable", request: input };
  }));

  assert.deepEqual(auditedInput, {
    origin: "https://seller.example",
    route: "/paid",
    method: "GET",
    requiredPaths: ["data.id"],
    requireBazaar: true,
    referral: null,
  });
  assert.deepEqual(result.recheck.request, auditedInput);
  assert.equal(result.referralId, pair.referralId);
  assert.equal(result.evidence.proof, "two_distinct_seller_signed_settlement_receipts");
  assert.equal(result.evidence.downstreamIssuedAtNotEarlier, true);
  assert.equal(result.evidence.buyerOutputValidated, false);
  assert.equal(result.evidence.broadcastRequired, false);
  assert.deepEqual(result.boundary, {
    charged: false,
    paidDemandRecorded: false,
    settlementRecorded: false,
    revenueRecorded: false,
    rawReceiptsRetained: false,
    payersRetained: false,
    transactionsRetained: false,
    requestBodyRetained: false,
  });

  const claimsDir = path.join(dataDir, "referral-recheck-claims");
  assert.deepEqual(await readdir(claimsDir), [pair.referralId]);
  const marker = path.join(claimsDir, pair.referralId);
  assert.equal((await stat(marker)).mode & 0o777, 0o600);
  assert.equal(await readFile(marker, "utf8"), "");
  const persisted = `${(await readdir(claimsDir)).join("\n")}\n${await readFile(marker, "utf8")}`;
  assert.equal(persisted.includes(JSON.stringify(pair.original)), false);
  assert.equal(persisted.includes(PAYER_ONE), false);
  assert.equal(persisted.includes(PAYER_TWO), false);
  assert.equal(persisted.includes(TX_ONE), false);
  assert.equal(persisted.includes(TX_TWO), false);
  assert.equal(persisted.includes(ORIGINAL_URL), false);
});

test("a referred buyer can create the next generation while the free audit strips its ancestor referral", async (t) => {
  const ancestorReferral = `r1_${"c".repeat(64)}`;
  const originalUrl = `${ORIGINAL_URL}&referral=${ancestorReferral}`;
  const { claimStore } = await testStore(t, "receipt-referral-cascade-");
  const pair = await receiptPair({
    originalUrl,
    downstreamUrlFor: (referralId) => `${PUBLIC_URL}${AUDIT_ROUTE_FOR_TEST}?origin=https%3A%2F%2Fhostile-downstream.example&route=%2Fmust-not-run&method=POST&requiredPaths=attacker.path&requireBazaar=false&referral=${referralId}`,
  });
  let auditedInput;
  const result = await receiptReferralRecheck(pair, options(claimStore, async (input) => {
    auditedInput = input;
    return { ok: true, request: input };
  }));

  const signedDownstream = new URL(pair.downstream.payload.resourceUrl);
  assert.equal(signedDownstream.searchParams.getAll("referral").length, 1);
  assert.equal(signedDownstream.searchParams.get("referral"), pair.referralId);
  assert.notEqual(pair.referralId, ancestorReferral);
  assert.deepEqual(auditedInput, {
    origin: "https://seller.example",
    route: "/paid",
    method: "GET",
    requiredPaths: ["data.id"],
    requireBazaar: true,
    referral: null,
  });
  assert.deepEqual(result.recheck.request, auditedInput);
  assert.equal(JSON.stringify(auditedInput).includes(ancestorReferral), false);
  assert.equal(JSON.stringify(auditedInput).includes("hostile-downstream"), false);
});

test("accepts equal-second receipt issuance and exposes the precise ordering evidence field", async (t) => {
  const { claimStore } = await testStore(t, "receipt-referral-equal-second-");
  const pair = await receiptPair({ downstreamIssuedAt: 1_800_000_000 });
  const result = await receiptReferralRecheck(pair, options(claimStore, async () => ({ ok: true })));
  const schema = receiptReferralRecheckOutputSchema();

  assert.equal(result.evidence.downstreamIssuedAtNotEarlier, true);
  assert.equal(schema.properties.evidence.properties.downstreamIssuedAtNotEarlier.const, true);
  assert.equal(schema.properties.evidence.required.includes("downstreamIssuedAtNotEarlier"), true);
});

test("rejects foreign signers, same payer, same transaction, wrong referral, and missing transaction binding", async (t) => {
  const cases = [
    ["foreign receipt signer", await receiptPair({ originalIssuer: foreignTrust.issuer, downstreamIssuer: foreignTrust.issuer }), "foreign_receipt_signer", 403],
    ["same payer with EVM case normalization", await receiptPair({ downstreamPayer: PAYER_ONE.toUpperCase().replace("0X", "0x") }), "payer_not_distinct", 400],
    ["same transaction with hex case normalization", await receiptPair({ downstreamTransaction: TX_ONE.toUpperCase().replace("0X", "0x") }), "transaction_not_distinct", 400],
    ["wrong downstream referral", await receiptPair({ downstreamUrlFor: () => downstreamUrl(`r1_${"0".repeat(64)}`) }), "referral_mismatch", 400],
    ["missing downstream referral", await receiptPair({ downstreamUrlFor: () => `${PUBLIC_URL}/commerce/seller-integrity-audit?origin=https%3A%2F%2Fdownstream.example&route=%2Fchanged` }), "referral_mismatch", 400],
    ["missing signed transaction", await receiptPair({ downstreamTransaction: null }), "invalid_referral_claim", 400],
  ];
  for (const [name, pair, code, statusCode] of cases) {
    await t.test(name, async (t) => {
      const { claimStore } = await testStore(t, "receipt-referral-hostile-");
      await expectCode(
        receiptReferralRecheck(pair, options(claimStore, async () => ({ ok: true }))),
        code,
        statusCode,
      );
    });
  }
});

test("rejects wrong origin, route, network, receipt order, and malformed or ambiguous signed URLs", async (t) => {
  const cases = [
    ["wrong original origin", await receiptPair({ originalUrl: ORIGINAL_URL.replace(PUBLIC_URL, "https://evil.example") }), "invalid_signed_resource_url"],
    ["wrong original route", await receiptPair({ originalUrl: ORIGINAL_URL.replace("/commerce/seller-integrity-audit", "/commerce/settlement-proof") }), "invalid_signed_resource_url"],
    ["wrong downstream origin", await receiptPair({ downstreamUrlFor: (id) => downstreamUrl(id).replace(PUBLIC_URL, "https://evil.example") }), "invalid_signed_resource_url"],
    ["wrong downstream route", await receiptPair({ downstreamUrlFor: (id) => downstreamUrl(id).replace("/commerce/seller-integrity-audit", "/commerce/payment-offer-preflight") }), "invalid_signed_resource_url"],
    ["wrong network", await receiptPair({ originalNetwork: "eip155:84532", downstreamNetwork: "eip155:84532" }), "receipt_network_mismatch"],
    ["network mismatch", await receiptPair({ downstreamNetwork: "eip155:84532" }), "receipt_network_mismatch"],
    ["earlier downstream timestamp", await receiptPair({ downstreamIssuedAt: 1_799_999_999 }), "receipt_order_invalid"],
    ["malformed percent escape", await receiptPair({ originalUrl: `${ORIGINAL_URL}&requiredPaths=%ZZ` }), "invalid_signed_resource_url"],
    ["ambiguous original query", await receiptPair({ originalUrl: `${ORIGINAL_URL}&origin=https%3A%2F%2Fother.example` }), "invalid_signed_resource_url"],
    ["empty original referral", await receiptPair({ originalUrl: `${ORIGINAL_URL}&referral=` }), "invalid_signed_resource_url"],
    ["fragment", await receiptPair({ originalUrl: `${ORIGINAL_URL}#claim` }), "invalid_signed_resource_url"],
    ["ambiguous downstream referral", await receiptPair({ downstreamUrlFor: (id) => `${downstreamUrl(id)}&referral=${id}` }), "invalid_signed_resource_url"],
  ];
  for (const [name, pair, code] of cases) {
    await t.test(name, async (t) => {
      const { claimStore } = await testStore(t, "receipt-referral-url-hostile-");
      await expectCode(receiptReferralRecheck(pair, options(claimStore, async () => ({ ok: true }))), code);
    });
  }
});

test("invalid publicUrl configurations fail as server errors before signed URL parsing", async (t) => {
  const pair = await receiptPair({ originalUrl: "not a valid signed receipt URL" });
  const configurations = [
    ["missing", undefined],
    ["malformed", "not a URL"],
    ["non-HTTPS", "http://agents.samedaydesk.com"],
    ["credential-bearing", "https://user:pass@agents.samedaydesk.com"],
    ["query-bearing", "https://agents.samedaydesk.com?mode=claim"],
    ["fragment-bearing", "https://agents.samedaydesk.com#claim"],
    ["non-origin path", "https://agents.samedaydesk.com/base"],
  ];
  for (const [name, publicUrl] of configurations) {
    await t.test(name, async (t) => {
      const { claimStore } = await testStore(t, "receipt-referral-public-url-");
      let auditCalled = false;
      await expectCode(receiptReferralRecheck(pair, {
        ...options(claimStore, async () => { auditCalled = true; return { ok: true }; }),
        publicUrl,
      }), "receipt_verification_unavailable", 503);
      assert.equal(auditCalled, false);
    });
  }
});

test("rejects unknown body fields and unsupported receipt modes", async (t) => {
  const { claimStore } = await testStore(t);
  const pair = await receiptPair();
  await expectCode(
    receiptReferralRecheck({ ...pair, substituteTarget: "https://evil.example" }, options(claimStore, async () => ({ ok: true }))),
    "invalid_referral_claim",
  );
  await expectCode(
    receiptReferralRecheck({ ...pair, original: { format: "jws", signature: "a.b.c" } }, options(claimStore, async () => ({ ok: true }))),
    "unsupported_receipt_signature_format",
  );
});

test("sequential and concurrent duplicate claims have exactly one successful winner", async (t) => {
  await t.test("sequential", async (t) => {
    const { claimStore } = await testStore(t, "receipt-referral-sequential-");
    const pair = await receiptPair();
    let audits = 0;
    const audit = async () => { audits += 1; return { ok: true }; };
    await receiptReferralRecheck(pair, options(claimStore, audit));
    await expectCode(receiptReferralRecheck(pair, options(claimStore, audit)), "referral_already_claimed", 409);
    assert.equal(audits, 1);
  });

  await t.test("concurrent", async (t) => {
    const { claimStore } = await testStore(t, "receipt-referral-concurrent-");
    const pair = await receiptPair();
    let started = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const audit = async () => {
      started += 1;
      if (started === 2) release();
      await gate;
      return { ok: true };
    };
    const settled = await Promise.allSettled([
      receiptReferralRecheck(pair, options(claimStore, audit)),
      receiptReferralRecheck(pair, options(claimStore, audit)),
    ]);
    assert.equal(settled.filter((entry) => entry.status === "fulfilled").length, 1);
    const rejected = settled.find((entry) => entry.status === "rejected");
    assert.equal(rejected.reason.code, "referral_already_claimed");
    assert.equal(rejected.reason.statusCode, 409);
  });
});

test("execution failure occurs before the documented claim consumption point", async (t) => {
  const { claimStore } = await testStore(t);
  const pair = await receiptPair();
  await expectCode(
    receiptReferralRecheck(pair, options(claimStore, async () => { throw new Error("audit failed"); })),
    "recheck_failed",
    502,
  );
  assert.equal(await claimStore.isClaimed(pair.referralId), false);
});

test("telemetry excludes the free claim route from paid demand, settlement, and revenue evidence", async (t) => {
  const { dataDir } = await testStore(t, "receipt-referral-telemetry-");
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "receipt-referral-telemetry-secret",
    externalSince: "2020-01-01T00:00:00.000Z",
    settlementEvidenceSince: "2020-01-01T00:00:00.000Z",
  });
  assert.deepEqual(classifyCommerceRoute("/commerce/referral-recheck"), {
    route: "/commerce/referral-recheck",
    kind: "excluded",
    matched: true,
  });
  let nextCalled = false;
  telemetry.middleware({
    path: "/commerce/referral-recheck",
    url: "/commerce/referral-recheck",
    originalUrl: "/commerce/referral-recheck",
    method: "POST",
    headers: { "payment-signature": "hostile-irrelevant-payment" },
    query: {},
    rawBody: Buffer.from("sensitive receipt request"),
  }, {
    statusCode: 200,
    once() { throw new Error("excluded route must not register a telemetry finish hook"); },
    getHeader() { return `0x${"3".repeat(64)}`; },
  }, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  await telemetry.flush();
  const snapshot = await telemetry.snapshot({ days: 1 });
  assert.equal(snapshot.externalEvents, 0);
  assert.equal(snapshot.paidSuccessActors, 0);
  assert.equal(snapshot.settlementReferencePaidSuccesses, 0);
  assert.equal(await readFile(telemetry.paths.currentPath, "utf8").catch((error) => error?.code === "ENOENT" ? "" : Promise.reject(error)), "");
  assert.equal(await readFile(telemetry.paths.paidEvidencePath, "utf8").catch((error) => error?.code === "ENOENT" ? "" : Promise.reject(error)), "");
});

function unusedPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
    server.once("error", reject);
  });
}

test("HTTP and machine surfaces expose the POST as free and non-paywalled", { timeout: 30_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "receipt-referral-http-"));
  const port = await unusedPort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd,
    env: {
      ...process.env,
      PORT: String(port),
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      MPP_SECRET_KEY: "",
      PUBLIC_URL,
      RECEIPT_SIGNING_PRIVATE_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const listening = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup timed out: ${output.slice(-2000)}`)), 15_000);
    const onData = (chunk) => {
      output = `${output}${chunk}`.slice(-20_000);
      if (!output.includes(`x402-merchant listening on :${port}`)) return;
      clearTimeout(timer);
      resolve();
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`startup exited: code=${code} signal=${signal}\n${output}`));
    });
    child.once("error", reject);
  });
  t.after(async () => {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once("exit", resolve);
      setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 2_000).unref();
    });
    await rm(dataDir, { recursive: true, force: true });
  });
  await listening;
  const base = `http://127.0.0.1:${port}`;
  const [openapi, mppOpenapi, gateway] = await Promise.all([
    fetch(`${base}/openapi.json`).then((response) => response.json()),
    fetch(`${base}/mpp-openapi.json`).then((response) => response.json()),
    fetch(base, { headers: { accept: "application/json" } }).then((response) => response.json()),
  ]);
  for (const document of [openapi, mppOpenapi]) {
    const operation = document.paths["/commerce/referral-recheck"].post;
    assert.equal(operation.operationId, "claimReceiptReferralRecheck");
    assert.deepEqual(operation.security, []);
    assert.equal(Object.hasOwn(operation, "x-payment-info"), false);
    assert.equal(operation.requestBody.content["application/json"].schema.additionalProperties, false);
  }
  assert.equal(gateway.machineCommerce.referralRecheck.price, "free");
  assert.equal(gateway.machineCommerce.referralRecheck.broadcastRequired, false);

  const response = await fetch(`${base}/commerce/referral-recheck`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("payment-required"), null);
  const body = await response.json();
  assert.equal(body.charged, false);
  assert.equal(body.boundary.paidDemandRecorded, false);
  assert.equal(body.boundary.settlementRecorded, false);
  assert.equal(body.boundary.revenueRecorded, false);
});
