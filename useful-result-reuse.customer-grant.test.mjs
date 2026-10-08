import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { TASK_REF_FILENAME } from "./commerce-outcome-binding.mjs";
import { digestOf } from "./task-linked-delivery/experiments/delivery-outcome-100173/src/canonical.mjs";
import { NETWORKS, transactionReceipt } from "./transaction-receipt.mjs";
import { encodeAbiParameters, encodeEventTopics, parseAbiItem } from "viem";
import {
  CAPTURED_RECEIPT,
  clientFromCapture,
  containsAccount,
  readCapture,
} from "./useful-result-reuse/base-receipt.mjs";
import { CLOSED_SPONSORED_REF, CUSTOMER_FILE, METRIC_FILE } from "./useful-result-reuse/constants.mjs";
import { installPaidReceiptRetention, noteReceiptRetention } from "./useful-result-reuse/delivery.mjs";
import { addressFreeEvidence, rejectSeededPaidDelivery } from "./useful-result-reuse/customer-grant.mjs";
import { createUsefulResultReuse, selectExistingPaidOperation } from "./useful-result-reuse/service.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = "customer-retention-internal-token-32bytes-min";
const TX = `0x${"1".repeat(64)}`;
const FROM = "0x1111111111111111111111111111111111111111";
const TO = "0x2222222222222222222222222222222222222222";
const OTHER = "0x3333333333333333333333333333333333333333";
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const SENTINEL = "sentinel-private-reuse-100245";

function receiptClient({ receiptError, errorName = "Error", hash = TX, fee = 2_000_000_000n } = {}) {
  return {
    async getTransactionReceipt() {
      if (receiptError) {
        const error = new Error(receiptError);
        error.name = errorName;
        throw error;
      }
      return {
        status: "success",
        blockNumber: 50n,
        blockHash: `0x${"2".repeat(64)}`,
        transactionIndex: 3,
        from: FROM,
        to: TO,
        contractAddress: null,
        type: "eip1559",
        gasUsed: 21_000n,
        effectiveGasPrice: fee,
        logs: [{
          address: NETWORKS.base.canonicalUsdc,
          topics: encodeEventTopics({ abi: [TRANSFER], eventName: "Transfer", args: { from: FROM, to: TO } }),
          data: encodeAbiParameters([{ type: "uint256" }], [5_000n]),
          logIndex: 7,
        }, { address: OTHER, topics: [], data: "0x" }],
      };
    },
    async getBlock() {
      return { timestamp: 1_786_350_903n };
    },
  };
}

function foundBody(hash = TX, options = {}) {
  return transactionReceipt({ transactionHash: hash, network: "base" }, {
    client: receiptClient({ hash, ...options }),
    now: () => new Date("2026-08-11T08:30:00.000Z"),
  });
}

async function openApi(clock = { value: Date.parse("2026-10-01T00:00:00.000Z") }, token = TOKEN) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "customer-grant-"));
  const api = createUsefulResultReuse({
    dataDir,
    internalToken: token,
    now: () => clock.value,
  });
  return { api, clock, dataDir };
}

async function retain(api, body, extra = {}) {
  return api.retainDeliveredReceipt({
    body,
    credentialDigest: extra.credentialDigest || "aa".repeat(32),
    method: extra.method || "GET",
    optIn: extra.optIn !== false,
    retainUntil: extra.retainUntil || null,
    route: extra.route || "/chain/transaction-receipt",
    settlementDigest: extra.settlementDigest === undefined ? "cc".repeat(32) : extra.settlementDigest,
    settlementStatus: extra.settlementStatus || "verified",
    taskLabel: extra.taskLabel === undefined ? "receipt-task-1" : extra.taskLabel,
  });
}

test("identical customer results do not transfer contribution revocation or correction authority", async () => {
  const { api, dataDir } = await openApi();
  try {
    const body = await foundBody();
    const a = await retain(api, body, { credentialDigest: "aa".repeat(32) });
    const b = await retain(api, body, { credentialDigest: "bb".repeat(32) });
    assert.equal(a.accepted, true);
    assert.equal(b.accepted, true);
    assert.equal(a.resultId, b.resultId);
    assert.notEqual(a.grant, b.grant);
    const sharedB = await api.shareDeliveredKnowledge({ token: b.grant });
    assert.equal(sharedB.accepted, true);
    assert.equal((await api.correctDeliveredKnowledge({ token: a.grant })).reason, "not_found");
    const sharedA = await api.shareDeliveredKnowledge({ token: a.grant });
    assert.equal(sharedA.accepted, true);
    assert.notEqual(sharedA.share.shareId, sharedB.share.shareId);
    await api.revokeDeliveredReceipt({ token: a.grant });
    const current = await api.current();
    assert.equal(current.compatibility.some(row => row.shareId === sharedA.share.shareId), false);
    assert.equal(current.compatibility.some(row => row.shareId === sharedB.share.shareId), true);
    assert.equal((await api.readDeliveredReceipt({ token: b.grant })).reason, null);
    assert.equal(JSON.stringify(current).includes(b.grant), false);
    assert.equal(JSON.stringify(current).includes("contributionBinding"), false);
    assert.equal((await api.correctDeliveredKnowledge({ token: b.grant })).accepted, true);
    const c = await retain(api, body, { credentialDigest: "cc".repeat(32) });
    await Promise.all([
      api.shareDeliveredKnowledge({ token: c.grant }),
      api.revokeDeliveredReceipt({ token: c.grant }),
    ]);
    assert.equal((await api.current()).compatibility.length, 0);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("stashes an explicit retain header and ignores query, user agent, and wallet labels", async () => {
  const body = await foundBody();
  const res = { locals: {} };
  noteReceiptRetention({
    headers: {
      "user-agent": SENTINEL,
      "x-samedaydesk-outcome-task": "receipt-task-1",
      "x-samedaydesk-retain-result": "1",
      "x-wallet-address": FROM,
    },
  }, res, body);
  assert.equal(res.locals.usefulResultOptIn.taskLabel, "receipt-task-1");
  assert.equal(JSON.stringify(res.locals.usefulResultOptIn).includes(SENTINEL), false);
  assert.equal(JSON.stringify(res.locals.usefulResultOptIn).includes(FROM), false);
  const ignored = { locals: {} };
  noteReceiptRetention({ headers: {}, query: { "x-samedaydesk-retain-result": "1" } }, ignored, body);
  assert.equal(ignored.locals.usefulResultOptIn, undefined);
});

test("the delivery wrapper retains only a settled HTTP 200", async () => {
  const calls = [];
  const app = { use(fn) { this.fn = fn; } };
  installPaidReceiptRetention(app, () => async (input) => {
    calls.push(input.settlementStatus);
    return {
      accepted: true,
      expiresAt: "2026-10-08T00:00:00.000Z",
      grant: "ab".repeat(32),
      resultId: "cd".repeat(32),
    };
  });
  const headers = new Map();
  const res = {
    locals: {
      usefulResultBody: { ok: true },
      usefulResultOptIn: { credentialDigest: "aa".repeat(32), retainUntil: null, taskLabel: null },
    },
    statusCode: 200,
    set(name, value) { headers.set(String(name).toLowerCase(), value); },
    getHeader(name) { return headers.get(String(name).toLowerCase()); },
    end(...args) { this.ended = args; },
  };
  app.fn({ method: "GET", path: "/chain/transaction-receipt" }, res, () => {});
  res.set("payment-response", Buffer.from(JSON.stringify({
    transaction: `0x${"3".repeat(64)}`,
  })).toString("base64"));
  const pending = res.end("receipt-bytes");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(pending, res);
  assert.deepEqual(calls, ["verified"]);
  assert.equal(res.getHeader("x-samedaydesk-result-grant"), "ab".repeat(32));
  assert.deepEqual(res.ended, ["receipt-bytes"]);

  const skipped = { ...res, locals: { ...res.locals }, statusCode: 402, ended: null, set: res.set, getHeader: res.getHeader, end: res.end };
  // A fresh response whose end is wrapped by a second request.
  const failed = {
    locals: {
      usefulResultBody: { ok: false },
      usefulResultOptIn: { credentialDigest: "aa".repeat(32), retainUntil: null, taskLabel: null },
    },
    statusCode: 402,
    set(name, value) { headers.set(String(name).toLowerCase(), value); },
    getHeader(name) { return headers.get(String(name).toLowerCase()); },
    end(...args) { this.ended = args; },
  };
  app.fn({ method: "GET", path: "/chain/transaction-receipt" }, failed, () => {});
  failed.set("payment-response", headers.get("payment-response"));
  failed.end("nope");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(calls, ["verified"]);
  assert.deepEqual(failed.ended, ["nope"]);
  assert.equal(skipped.statusCode, 402);

  const mppHeaders = new Map();
  const mpp = {
    locals: {
      usefulResultBody: { ok: true },
      usefulResultOptIn: { credentialDigest: "bb".repeat(32), retainUntil: null, taskLabel: null },
    },
    statusCode: 200,
    set(name, value) { mppHeaders.set(String(name).toLowerCase(), value); },
    getHeader(name) { return mppHeaders.get(String(name).toLowerCase()); },
    end(...args) { this.ended = args; },
  };
  app.fn({ method: "GET", path: "/chain/transaction-receipt" }, mpp, () => {});
  mpp.set("payment-receipt", "mpp-paid");
  mpp.end("mpp-bytes");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(calls, ["verified", "verified"]);
  assert.equal(mpp.getHeader("x-samedaydesk-result-grant"), "ab".repeat(32));
  assert.deepEqual(mpp.ended, ["mpp-bytes"]);

  const bareHeaders = new Map();
  const bare = {
    locals: {
      usefulResultBody: { ok: true },
      usefulResultOptIn: { credentialDigest: "cc".repeat(32), retainUntil: null, taskLabel: null },
    },
    statusCode: 200,
    set(name, value) { bareHeaders.set(String(name).toLowerCase(), value); },
    getHeader(name) { return bareHeaders.get(String(name).toLowerCase()); },
    end(...args) { this.ended = args; },
  };
  app.fn({ method: "GET", path: "/chain/transaction-receipt" }, bare, () => {});
  bare.end("unsettled");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(calls, ["verified", "verified"]);
  assert.equal(bare.getHeader("x-samedaydesk-result-grant"), undefined);
  assert.deepEqual(bare.ended, ["unsettled"]);
});

test("retains a real handler receipt and refuses settlement, execution, and seeded delivery", async () => {
  const clock = { value: Date.parse("2026-10-01T00:00:00.000Z") };
  const { api, dataDir } = await openApi(clock);
  try {
    const body = await foundBody();
    body.findings = [...body.findings, { severity: "info", code: "note", message: SENTINEL }];
    assert.equal(body.product, "samedaydesk-transaction-receipt");
    assert.equal(body.decision, "found");
    assert.equal(containsAccount(addressFreeEvidence(body)), false);
    const credential = `customer-credential-digest-${"ab".repeat(32)}`;
    const kept = await retain(api, body, { credentialDigest: credential, taskLabel: "receipt-task-1" });
    assert.equal(kept.accepted, true, kept.reason);
    assert.equal(kept.paidValidDelivery, true);
    assert.equal(kept.paymentPermitted, false);
    assert.equal(kept.recognizedRevenueAtomic, "0");
    assert.equal(kept.historicalRevenue, "unknown");
    assert.equal(kept.taskJoin, "bound");
    assert.match(kept.grant, /^[0-9a-f]{64}$/);

    const customerText = await readFile(path.join(dataDir, CUSTOMER_FILE), "utf8");
    const taskText = await readFile(path.join(dataDir, TASK_REF_FILENAME), "utf8");
    const metricText = await readFile(path.join(dataDir, METRIC_FILE), "utf8");
    assert.equal(customerText.includes(kept.grant), false);
    assert.equal(customerText.includes(credential), false);
    assert.equal(customerText.includes("receipt-task-1"), false);
    assert.equal(customerText.includes(SENTINEL), true);
    assert.equal(taskText.includes("receipt-task-1"), false);
    assert.equal(taskText.includes(kept.grant), false);
    assert.equal(taskText.includes(FROM.slice(2)), false);
    assert.equal(metricText.includes(kept.grant), false);
    assert.equal(metricText.includes(SENTINEL), false);
    assert.equal(metricText.includes(FROM.slice(2)), false);
    const mode = (await stat(path.join(dataDir, CUSTOMER_FILE))).mode & 0o777;
    assert.equal(mode, 0o600);

    const read = await api.readDeliveredReceipt({ token: kept.grant });
    assert.equal(read.reason, null);
    assert.equal(read.result.decision, "found");
    assert.equal(read.result.transaction.transactionFeeWei, "42000000000000");
    assert.equal(read.paidValidDelivery, true);
    assert.equal(read.paymentPermitted, false);
    assert.equal(JSON.stringify(read.result).includes(SENTINEL), true);

    const later = await foundBody();
    later.checkedAt = "2026-10-01T00:00:01.000Z";
    later.findings = body.findings;
    const duplicate = await retain(api, later, { credentialDigest: credential });
    assert.equal(duplicate.accepted, false);
    assert.equal(duplicate.reason, "duplicate");
    assert.equal(duplicate.grant, null);

    const conflictBody = await foundBody();
    conflictBody.transaction = { ...conflictBody.transaction, status: "reverted" };
    const conflict = await retain(api, conflictBody, { credentialDigest: credential });
    assert.equal(conflict.reason, "result_conflict");
    assert.equal(conflict.grant, null);

    const still = await api.readDeliveredReceipt({ token: kept.grant });
    assert.equal(still.result.transaction.status, "success");
    assert.equal(await api.readDeliveredReceipt({ token: kept.grant, resultId: "deadbeef" }).then((item) => item.reason), "wrong_result");
    assert.equal((await api.readDeliveredReceipt({ token: kept.grant, method: "POST" })).reason, "wrong_method");
    assert.equal((await api.readDeliveredReceipt({ token: kept.grant, resource: "/extract" })).reason, "wrong_resource");
    assert.equal((await api.readDeliveredReceipt({ token: "nope" })).reason, "grant_rejected");

    const publicPage = await api.current();
    assert.equal(publicPage.hostedReuseVerified, false);
    assert.equal(publicPage.customerRetentionHostedVerified, false);
    assert.equal(publicPage.historicalRevenue, "unknown");
    assert.equal(publicPage.recognizedRevenueAtomic, "0");
    assert.equal(publicPage.customerRetention.internalTokenRequired, false);
    assert.equal(publicPage.customerRetention.credentialInUrl, false);
    assert.equal(publicPage.customerRetention.price, "free");
    assert.equal(publicPage.compatibility.length, 0);
    assert.equal(JSON.stringify(publicPage).includes(SENTINEL), false);
    assert.equal(JSON.stringify(publicPage).includes(kept.grant), false);
    assert.equal(containsAccount(publicPage), false);

    const metrics = await api.metrics();
    assert.equal(metrics.retention_opt_in >= 1, true);
    assert.equal(metrics.retained_result, 1);
    assert.equal(metrics.paid_valid_delivery, 1);
    assert.equal(metrics.useful_later_read >= 1, true);
    assert.equal(metrics.valid_delivery, 0);
    assert.equal(metrics.verified_settlement, 0);
    assert.equal(metrics.paid_settlement, 0);
    assert.equal(metrics.recognizedRevenueAtomic, "0");
    assert.equal(metrics.historicalRevenue, "unknown");
    assert.equal(metrics.coverage, "unknown_for_full_window");
    assert.equal(metrics.complete, false);
    assert.equal(metrics.evidenceClass.valid_delivery, "supplied_observation");

    const failed = await retain(api, body, { settlementStatus: "failed", credentialDigest: "bb".repeat(32) });
    assert.equal(failed.reason, "settlement_failed");
    assert.equal(failed.grant, null);
    const unknown = await retain(api, body, { settlementStatus: "unknown", credentialDigest: "bc".repeat(32) });
    assert.equal(unknown.reason, "settlement_unverified");
    const unavailable = await transactionReceipt({ transactionHash: TX }, {
      client: receiptClient({ receiptError: "network down" }),
    });
    assert.equal((await retain(api, unavailable, { credentialDigest: "bd".repeat(32) })).reason, "execution_failed");
    const flagged = { ...body, paidValidDelivery: true };
    assert.equal((await retain(api, flagged, { credentialDigest: "be".repeat(32) })).reason, "supplied_flag_ignored");
    assert.equal((await retain(api, body, { route: "/extract", credentialDigest: "bf".repeat(32) })).reason, "wrong_resource");
    assert.equal((await retain(api, body, { taskLabel: `0x${"a".repeat(40)}`, credentialDigest: "c1".repeat(32) })).reason, "task_label_rejected");
    assert.equal((await retain(api, body, { optIn: false })).reason, "not_requested");
    assert.equal((await retain(api, body, {
      credentialDigest: "c2".repeat(32),
      retainUntil: "2026-12-01T00:00:00.000Z",
    })).reason, "expiry_rejected");

    const closed = selectExistingPaidOperation({
      name: "normalized_transaction_receipt",
      freeBaseline: { txReference: CLOSED_SPONSORED_REF },
    });
    assert.equal(closed.reason, "closed_sponsored_reference");
    assert.equal(closed.paymentSent, false);
    assert.equal(closed.offeredOperation, null);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("a later process replays useful and negative output without payment authority", async () => {
  const clock = { value: Date.parse("2026-10-01T00:00:00.000Z") };
  const { api, dataDir } = await openApi(clock);
  try {
    const capture = await readCapture(CAPTURED_RECEIPT);
    const executed = await transactionReceipt(
      { transactionHash: CLOSED_SPONSORED_REF, network: "base" },
      { client: clientFromCapture(capture), now: () => new Date(clock.value) },
    );
    const kept = await retain(api, executed, { credentialDigest: "d1".repeat(32), taskLabel: null });
    assert.equal(kept.accepted, true, kept.reason);
    assert.equal(kept.paidValidDelivery, true);
    const shared = await api.shareDeliveredKnowledge({ token: kept.grant });
    assert.equal(shared.accepted, true, shared.reason);
    assert.equal(shared.share.paymentPermitted, false);
    assert.equal(containsAccount(shared.share), false);
    assert.equal(JSON.stringify(shared.share).includes("8904df3d"), false);
    assert.equal(JSON.stringify(shared.share).includes("aef308a4"), false);
    const again = await api.shareDeliveredKnowledge({ token: kept.grant });
    assert.equal(again.duplicate, true);
    const page = await api.current();
    assert.equal(page.knowledge.length, 0);
    assert.equal(page.compatibility.length, 1);
    assert.equal(page.compatibility[0].shareId, shared.share.shareId);

    const consumed = await api.consumeDeliveredKnowledge({
      client: clientFromCapture(capture),
      corrections: page.compatibilityCorrections,
      derivative: shared.share,
      directClient: clientFromCapture(capture),
      publicShares: page.compatibility,
      revocations: page.compatibilityRevocations,
    });
    assert.equal(consumed.reason, "independently_replayed");
    assert.equal(consumed.sameUsefulOutput, true);
    assert.equal(consumed.executionSaved, false);
    assert.equal(consumed.observedSaving, false);
    assert.equal(consumed.usefulTransferred, false);
    assert.equal(consumed.paymentPermitted, false);
    assert.equal(consumed.recognizedRevenueAtomic, "0");
    assert.equal(consumed.historicalRevenue, "unknown");
    assert.equal(consumed.later.decision, "found");
    assert.equal(consumed.later.blockNumber, "52009071");
    assert.equal(consumed.direct.transactionFeeWei, consumed.later.transactionFeeWei);
    assert.equal(containsAccount(consumed.later), false);

    const derivativeFile = path.join(dataDir, "derivative.json");
    await writeFile(derivativeFile, JSON.stringify(shared.share));
    const consumerEnv = {
      USEFUL_RESULT_DERIVATIVE: derivativeFile,
      USEFUL_RESULT_RECEIPT: fileURLToPath(CAPTURED_RECEIPT),
    };
    const spawnConsumer = (extra = {}) => spawnSync(process.execPath, ["useful-result-reuse/compatibility-consumer.mjs"], {
      cwd: root,
      env: { ...consumerEnv, ...extra },
      encoding: "utf8",
    });
    const sameClock = new Date(clock.value).toISOString();
    const consumer = spawnConsumer({ USEFUL_RESULT_NOW: sameClock });
    assert.equal(consumer.status, 0, `${consumer.stdout}\n${consumer.stderr}`);
    const consumerBody = JSON.parse(consumer.stdout);
    assert.equal(consumerBody.sameUsefulOutput, true);
    assert.equal(consumerBody.executionSaved, false);
    assert.equal(consumerBody.paymentPermitted, false);
    assert.equal(consumerBody.recognizedRevenueAtomic, "0");
    assert.equal(consumerBody.laterDecision, "found");
    assert.equal(consumerBody.laterReceiptCalls, 1);
    assert.equal(consumerBody.directReceiptCalls, 1);
    assert.equal(consumer.stdout.includes("8904df3d"), false);
    assert.equal(consumer.stdout.includes(kept.grant), false);

    const expired = spawnConsumer({ USEFUL_RESULT_NOW: shared.share.expiresAt });
    assert.equal(expired.status, 0, `${expired.stdout}\n${expired.stderr}`);
    const expiredBody = JSON.parse(expired.stdout);
    assert.equal(expiredBody.sameUsefulOutput, false);
    assert.equal(expiredBody.reason, "expired_scope");
    assert.equal(expiredBody.paymentPermitted, false);
    assert.equal(expiredBody.executionSaved, false);
    assert.equal(expiredBody.recognizedRevenueAtomic, "0");
    assert.equal(expiredBody.laterDecision, null);
    assert.equal(expired.stdout.includes(kept.grant), false);

    const wall = spawnConsumer();
    assert.equal(wall.status, 0, `${wall.stdout}\n${wall.stderr}`);
    const wallBody = JSON.parse(wall.stdout);
    if (Date.now() >= Date.parse(shared.share.expiresAt)) {
      assert.equal(wallBody.sameUsefulOutput, false);
      assert.equal(wallBody.reason, "expired_scope");
    } else {
      assert.equal(wallBody.sameUsefulOutput, true);
      assert.equal(wallBody.laterDecision, "found");
    }
    assert.equal(wallBody.paymentPermitted, false);
    assert.equal(wallBody.recognizedRevenueAtomic, "0");

    const tampered = structuredClone(shared.share);
    tampered.evidence.evidenceDigest = "0".repeat(64);
    const corruptFile = path.join(dataDir, "corrupt-derivative.json");
    await writeFile(corruptFile, JSON.stringify(tampered));
    const corrupt = spawnConsumer({
      USEFUL_RESULT_DERIVATIVE: corruptFile,
      USEFUL_RESULT_NOW: sameClock,
    });
    assert.equal(corrupt.status, 0, `${corrupt.stdout}\n${corrupt.stderr}`);
    const corruptBody = JSON.parse(corrupt.stdout);
    assert.equal(corruptBody.sameUsefulOutput, false);
    assert.equal(corruptBody.reason, "source_changed");
    assert.equal(corruptBody.paymentPermitted, false);
    assert.equal(corruptBody.executionSaved, false);
    assert.equal(corruptBody.recognizedRevenueAtomic, "0");
    assert.equal(corrupt.stdout.includes(kept.grant), false);

    const forged = structuredClone(shared.share);
    forged.schema = "forged.compatibility";
    const forgedFile = path.join(dataDir, "forged-derivative.json");
    await writeFile(forgedFile, JSON.stringify(forged));
    const forgedConsumer = spawnConsumer({
      USEFUL_RESULT_DERIVATIVE: forgedFile,
      USEFUL_RESULT_NOW: sameClock,
    });
    assert.equal(forgedConsumer.status, 0, `${forgedConsumer.stdout}\n${forgedConsumer.stderr}`);
    const forgedBody = JSON.parse(forgedConsumer.stdout);
    assert.equal(forgedBody.sameUsefulOutput, false);
    assert.equal(forgedBody.reason, "not_compatibility");
    assert.equal(forgedBody.paymentPermitted, false);
    assert.equal(forgedBody.recognizedRevenueAtomic, "0");

    const badClock = spawnConsumer({ USEFUL_RESULT_NOW: "not-a-clock" });
    assert.notEqual(badClock.status, 0);
    assert.match(badClock.stderr, /clock_rejected/);
    assert.equal(badClock.stdout.includes("sameUsefulOutput"), false);
    assert.equal(badClock.stdout.includes(kept.grant), false);

    const drifted = receiptClient({ fee: 9n });
    const sourceChanged = await api.consumeDeliveredKnowledge({
      client: drifted,
      derivative: shared.share,
      directClient: clientFromCapture(capture),
      publicShares: page.compatibility,
    });
    assert.equal(sourceChanged.reason, "source_changed");
    assert.equal(sourceChanged.executionSaved, false);
    assert.equal(sourceChanged.continuedExecution, true);

    const baseline = await api.consumeDeliveredKnowledge({
      client: clientFromCapture(capture),
      derivative: shared.share,
      directClient: drifted,
      publicShares: page.compatibility,
    });
    assert.equal(baseline.reason, "baseline_disagreement");
    assert.equal(baseline.sameUsefulOutput, false);
    assert.equal(baseline.observedSaving, false);
    assert.equal(baseline.paymentPermitted, false);

    const corrected = await api.correctDeliveredKnowledge({ token: kept.grant });
    assert.equal(corrected.accepted, true, corrected.reason);
    assert.equal(corrected.applyPrior, false);
    const after = await api.current();
    assert.equal(after.compatibility.length, 0);
    assert.equal(after.compatibilityCorrections.some((item) => item.corrects === shared.share.shareId), true);
    const refused = await api.consumeDeliveredKnowledge({
      client: clientFromCapture(capture),
      corrections: after.compatibilityCorrections,
      derivative: shared.share,
      directClient: clientFromCapture(capture),
      publicShares: after.compatibility,
      revocations: after.compatibilityRevocations,
    });
    assert.equal(refused.reason, "corrected");
    assert.equal(refused.applyPrior, false);
    assert.equal(refused.paymentPermitted, false);
    const metrics = await api.metrics();
    assert.equal(metrics.correction, 1);
    assert.equal(metrics.recognizedRevenueAtomic, "0");
    assert.equal(metrics.verified_settlement, 0);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("restart, expiry, revocation, corruption, and concurrent grants stay precise", async () => {
  const clock = { value: Date.parse("2026-10-01T00:00:00.000Z") };
  const { api, dataDir } = await openApi(clock);
  try {
    const body = await foundBody();
    const until = new Date(clock.value + 60_000).toISOString();
    const kept = await retain(api, body, { credentialDigest: "e1".repeat(32), retainUntil: until, taskLabel: null });
    assert.equal(kept.accepted, true, kept.reason);
    const missing = await transactionReceipt({ transactionHash: `0x${"4".repeat(64)}` }, {
      client: receiptClient({ receiptError: "not found", errorName: "TransactionReceiptNotFoundError" }),
    });
    const negative = await retain(api, missing, { credentialDigest: "e2".repeat(32), taskLabel: null });
    assert.equal(negative.accepted, true, negative.reason);
    assert.equal(negative.paidValidDelivery, false);
    const negativeRead = await api.readDeliveredReceipt({ token: negative.grant });
    assert.equal(negativeRead.result.decision, "not_found");
    assert.equal(negativeRead.useful, "false");
    const negativeShare = await api.shareDeliveredKnowledge({ token: negative.grant });
    assert.equal(negativeShare.accepted, true, negativeShare.reason);
    const negativeClient = receiptClient({ receiptError: "not found", errorName: "TransactionReceiptNotFoundError" });
    const negativeUse = await api.consumeDeliveredKnowledge({
      client: negativeClient,
      derivative: negativeShare.share,
      directClient: receiptClient({ receiptError: "not found", errorName: "TransactionReceiptNotFoundError" }),
      publicShares: (await api.current()).compatibility,
    });
    assert.equal(negativeUse.sameUsefulOutput, true);
    assert.equal(negativeUse.later.decision, "not_found");
    assert.equal(negativeUse.executionSaved, false);
    assert.equal(negativeUse.paymentPermitted, false);

    const restarted = createUsefulResultReuse({
      dataDir,
      internalToken: TOKEN,
      now: () => clock.value,
    });
    const reread = await restarted.readDeliveredReceipt({ token: kept.grant });
    assert.equal(reread.reason, null);
    assert.equal(digestOf(reread.result), digestOf(body));

    clock.value += 61_000;
    assert.equal((await restarted.readDeliveredReceipt({ token: kept.grant })).reason, "expired");
    const revoked = await restarted.revokeDeliveredReceipt({ token: kept.grant });
    assert.equal(revoked.accepted, true);
    assert.equal(revoked.reason, "revoked");
    assert.equal((await restarted.readDeliveredReceipt({ token: kept.grant })).reason, "revoked");

    const freshClock = { value: Date.parse("2026-10-01T00:00:00.000Z") };
    const fresh = createUsefulResultReuse({ dataDir, internalToken: TOKEN, now: () => freshClock.value });
    const other = await retain(fresh, body, { credentialDigest: "e3".repeat(32), taskLabel: null });
    assert.equal(other.accepted, true, other.reason);
    const file = path.join(dataDir, CUSTOMER_FILE);
    const lines = (await readFile(file, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    const target = lines.find((row) => row.grantId === other.grantId && row.action === "retain");
    target.body = { ...target.body, decision: "tampered" };
    await writeFile(file, `${lines.map((row) => JSON.stringify(row)).join("\n")}\n`);
    assert.equal((await fresh.readDeliveredReceipt({ token: other.grant })).reason, "record_integrity");

    const parallelClock = { value: Date.parse("2026-10-02T00:00:00.000Z") };
    const parallel = createUsefulResultReuse({ dataDir, internalToken: "", now: () => parallelClock.value });
    const same = await foundBody(`0x${"5".repeat(64)}`);
    const raced = await Promise.all([0, 1, 2, 3].map(() => retain(parallel, same, {
      credentialDigest: "e4".repeat(32),
      taskLabel: null,
    })));
    assert.equal(raced.filter((item) => item.accepted).length, 1);
    assert.equal(raced.filter((item) => item.reason === "duplicate").length, 3);
    assert.equal(raced.find((item) => item.accepted).taskJoin, "unbound_artifact");
    const distinct = await Promise.all([0, 1, 2, 3].map((index) => retain(parallel, same, {
      credentialDigest: `${index}${"f".repeat(63)}`,
      taskLabel: null,
    })));
    assert.equal(distinct.filter((item) => item.accepted).length, 4);

    const seeded = JSON.parse(await readFile(path.join(root, "useful-result-reuse/fixtures/seeded-unverified-paid-delivery.json"), "utf8"));
    const refusal = await rejectSeededPaidDelivery(seeded);
    assert.equal(refusal.refused, true);
    assert.equal(refusal.reasons.includes("settlement_unverified"), true);
    assert.equal(refusal.reasons.includes("execution_failed"), true);
    assert.equal(refusal.reasons.includes("credential_in_claim"), true);
    assert.equal(refusal.reasons.includes("restricted_field"), true);
    const command = spawnSync(process.execPath, [
      "useful-result-reuse/cli.mjs",
      "reject-seeded-paid",
      "useful-result-reuse/fixtures/seeded-unverified-paid-delivery.json",
    ], { cwd: root, encoding: "utf8" });
    assert.equal(command.status, 0, command.stderr);
    assert.equal(JSON.parse(command.stdout).refused, true);

    const huge = await foundBody(`0x${"6".repeat(64)}`);
    huge.findings = [{ severity: "info", code: "bulk", message: "x".repeat(20_000) }];
    assert.equal((await retain(parallel, huge, { credentialDigest: "e5".repeat(32), taskLabel: null })).reason, "record_bounds");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
