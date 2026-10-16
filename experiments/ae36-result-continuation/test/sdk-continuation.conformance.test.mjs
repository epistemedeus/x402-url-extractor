import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { encodeAbiParameters, encodeEventTopics, getAddress, parseAbiItem } from "viem";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { FIXTURE_ADDRESS } from "../../../experiments/morpho-useful-delivery-1005/fixture.mjs";
import {
  mcpRecoveryBudget,
  mcpRecoveryFileStore,
  resumePaidMcpResult,
  startPaidMcpResult,
} from "../../../caller-result-client/src/mcp-recovery.mjs";
import { reportMcpCallerResult } from "../../../caller-result-client/src/mcp-caller-result.mjs";
import { createCommerceSettlementReconciler } from "../../../commerce-settlement-reconciler.mjs";
import {
  classifySdkResult,
  discoverSdkNextActions,
  feedbackBearerOnResult,
  matchesSupportedNextActions,
  readSdkCapability,
  reportSdkResult,
} from "../src/cold-client.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const payer = `0x${"2".repeat(40)}`;
// The loopback receiver's payTo and the canonical Base USDC asset.
const treasury = `0x${"b".repeat(40)}`;
const baseUsdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

// Chain reader double: answers only for the listed settlement references.
function receiptFor(specs, { to = treasury } = {}) {
  const byHash = new Map(specs.map((spec) => [String(spec.hash).toLowerCase(), spec]));
  return {
    async getTransactionReceipt({ hash: reference }) {
      const spec = byHash.get(String(reference).toLowerCase());
      if (!spec) throw new Error("unavailable");
      return {
        status: "success",
        blockNumber: 1n,
        logs: [{
          address: getAddress(baseUsdc),
          topics: encodeEventTopics({ abi: [transferEvent], eventName: "Transfer", args: { from: getAddress(payer), to: getAddress(to) } }),
          data: encodeAbiParameters([{ type: "uint256" }], [spec.amount]),
        }],
      };
    },
    async getBlock() {
      return { timestamp: 1760000000n };
    },
  };
}
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const listen = (server) => new Promise((resolve, reject) => {
  server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  server.once("error", reject);
});

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 3_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function toolBody(result) {
  const text = result?.content?.[0]?.text;
  if (typeof text !== "string") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

test("a cold SDK client discovers, reports, and retrieves one result without a second purchase", { timeout: 180_000 }, async (t) => {
  const expected = JSON.parse(await readFile(new URL("../fixtures/supported-next-actions.json", import.meta.url), "utf8"));
  const forged = JSON.parse(await readFile(new URL("../fixtures/forged-capability.json", import.meta.url), "utf8"));
  const directory = await mkdtemp(path.join(tmpdir(), "ae36-sdk-"));
  const dataDir = path.join(directory, "merchant");
  await mkdir(dataDir, { recursive: true });
  const feedbackKey = randomBytes(32).toString("hex");
  const counts = { verify: 0, settle: 0 };
  const facilitator = createServer(async (req, res) => {
    let output;
    if (req.url === "/supported") {
      output = { kinds: [{ network: "eip155:8453", scheme: "exact", x402Version: 2 }], extensions: [], signers: {} };
    } else if (req.url === "/verify") {
      counts.verify += 1;
      output = { isValid: true, payer };
    } else if (req.url === "/settle") {
      counts.settle += 1;
      output = {
        success: true,
        network: "eip155:8453",
        payer,
        transaction: `0x${counts.settle.toString(16).padStart(64, "0")}`,
      };
    } else {
      res.writeHead(404);
      res.end();
      return;
    }
    req.resume();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(output));
  });
  const facilitatorPort = await listen(facilitator);
  let target;
  let child;
  const proxyState = { loseNextPaidResponse: false, loseNextReportReply: false, lostPaid: 0, lostReport: 0, calls: [] };
  const proxy = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const part of req) chunks.push(part);
      const raw = Buffer.concat(chunks);
      const message = raw.length ? JSON.parse(raw.toString("utf8")) : null;
      if (message?.method === "tools/call") proxyState.calls.push(message.params?.name);
      const response = await fetch(`${target}${req.url}`, {
        method: req.method,
        headers: { accept: "application/json, text/event-stream", "content-type": "application/json" },
        ...(raw.length ? { body: raw } : {}),
        redirect: "error",
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      const paidCall = message?.method === "tools/call"
        && message.params?.name !== "recover_paid_result"
        && message.params?.name !== "report_caller_result"
        && message.params?._meta?.["x402/payment"];
      if (proxyState.loseNextPaidResponse && paidCall) {
        proxyState.loseNextPaidResponse = false;
        proxyState.lostPaid += 1;
        res.destroy();
        return;
      }
      if (proxyState.loseNextReportReply && message?.method === "tools/call" && message.params?.name === "report_caller_result") {
        proxyState.loseNextReportReply = false;
        proxyState.lostReport += 1;
        res.destroy();
        return;
      }
      res.writeHead(response.status, { "content-type": response.headers.get("content-type") || "application/json" });
      res.end(bytes);
    } catch {
      if (!res.headersSent && !res.destroyed) res.destroy();
    }
  });
  const proxyPort = await listen(proxy);
  const endpointUrl = `http://127.0.0.1:${proxyPort}/mcp`;

  async function start() {
    if (target) await fetch(`${target}/fixture-flush`, { method: "POST" }).catch(() => {});
    await stop(child);
    const probe = createServer();
    const port = await listen(probe);
    await new Promise((resolve) => probe.close(resolve));
    target = `http://127.0.0.1:${port}`;
    const configFile = path.join(directory, "receiver.json");
    await writeFile(configFile, JSON.stringify({
      dataDir,
      port,
      endpointUrl,
      tenantId: "tenant-a",
      facilitatorUrl: `http://127.0.0.1:${facilitatorPort}`,
      callerResultFeedback: { key: feedbackKey },
    }));
    child = spawn(process.execPath, ["fixtures/mcp-task-recovery-loopback.mjs", configFile], {
      cwd: root,
      env: { PATH: process.env.PATH },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`receiver_timeout ${output.slice(-800)}`)), 20_000);
      const onData = (part) => {
        output += part;
        const line = output.split("\n").find((item) => item.includes('"ready":true'));
        if (!line) return;
        clearTimeout(timer);
        try {
          resolve(JSON.parse(line));
        } catch (error) {
          reject(error);
        }
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error(`receiver_exited ${output.slice(-800)}`));
      });
    });
    return ready;
  }

  function openClient() {
    const sdk = new Client({ name: "ae36-cold-sdk", version: "1" });
    let connected;
    const connect = async () => {
      connected ??= sdk.connect(new StreamableHTTPClientTransport(new URL(endpointUrl)));
      await connected;
    };
    return {
      async listTools(...args) {
        await connect();
        return sdk.listTools(...args);
      },
      async callTool(...args) {
        await connect();
        return sdk.callTool(...args);
      },
      getToolOutputValidator: (...args) => sdk.getToolOutputValidator(...args),
      close: () => sdk.close().catch(() => {}),
    };
  }

  async function operation(inputArgs) {
    const client = openClient();
    const catalog = await client.listTools();
    const accepted = catalog.tools.find((tool) => tool.name === "morpho_position")._meta.x402.accepts[0];
    await client.close();
    const suffix = randomBytes(8).toString("hex");
    const validBefore = String(Math.floor(Date.now() / 1000) + 600);
    const payment = {
      x402Version: 2,
      resource: { url: "mcp://tool/morpho_position" },
      accepted,
      payload: {
        signature: `0x${"4".repeat(130)}`,
        authorization: {
          from: payer,
          to: accepted.payTo,
          value: accepted.amount,
          validAfter: "0",
          validBefore,
          nonce: `0x${randomBytes(32).toString("hex")}`,
        },
      },
      extensions: { "payment-identifier": { info: { required: false, id: `ae36_${suffix}` } } },
    };
    const input = {
      endpointUrl,
      tenantId: "tenant-a",
      principalId: "principal-a",
      name: "morpho_position",
      arguments: inputArgs,
      payment,
      maxAtomic: accepted.amount,
      operationId: `operation-${suffix}`,
      reservationId: `reservation-${suffix}`,
      grantId: `grant-${suffix}`,
    };
    const grant = {
      endpointUrl: input.endpointUrl,
      tenantId: input.tenantId,
      principalId: input.principalId,
      name: input.name,
      maxAtomic: input.maxAtomic,
      operationId: input.operationId,
      reservationId: input.reservationId,
      grantId: input.grantId,
      inputDigest: hash(inputArgs),
      termsDigest: hash(accepted),
      paymentDigest: hash(payment),
      expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
      execute: true,
      readResult: true,
      revoked: false,
    };
    return {
      input,
      grant,
      accepted,
      catalog,
      checkpoint: path.join(directory, `checkpoint-${suffix}.json`),
    };
  }

  async function pay(op) {
    const client = openClient();
    const handle = await startPaidMcpResult({
      client,
      store: mcpRecoveryFileStore(op.checkpoint),
      input: op.input,
      loadGrant: async () => structuredClone(op.grant),
    });
    return handle.handoff();
  }

  async function recover(op, client = openClient()) {
    const handle = await resumePaidMcpResult({
      client,
      store: mcpRecoveryFileStore(op.checkpoint),
      loadGrant: async () => structuredClone(op.grant),
    });
    return handle.handoff();
  }

  t.after(async () => {
    await fetch(`${target}/fixture-flush`, { method: "POST" }).catch(() => {});
    await stop(child);
    proxy.closeAllConnections?.();
    facilitator.closeAllConnections?.();
    await Promise.all([
      new Promise((resolve) => proxy.close(resolve)),
      new Promise((resolve) => facilitator.close(resolve)),
    ]);
    await rm(directory, { recursive: true, force: true });
  });

  const ready = await start();
  assert.equal(ready.feedback, true);
  const discoveredOp = await operation({ address: FIXTURE_ADDRESS });
  assert.equal(discoveredOp.accepted.amount, discoveredOp.input.payment.accepted.amount);
  assert.deepEqual(discoveredOp.catalog.tools.map((tool) => tool.name).sort(), [
    "morpho_position",
    "opportunity_preflight",
    "recover_paid_result",
    "report_caller_result",
    "transaction_receipt",
  ]);

  const callsBeforeGrant = proxyState.calls.length;
  const mismatched = { ...discoveredOp, checkpoint: path.join(directory, "checkpoint-mismatch.json") };
  await assert.rejects(
    startPaidMcpResult({
      client: openClient(),
      store: mcpRecoveryFileStore(mismatched.checkpoint),
      input: mismatched.input,
      loadGrant: async () => ({ ...mismatched.grant, paymentDigest: "0".repeat(64) }),
    }),
    (error) => error?.code === "grant_paymentDigest_changed",
  );
  assert.equal(proxyState.calls.length, callsBeforeGrant);
  assert.equal(counts.verify, 0);
  assert.equal(counts.settle, 0);

  proxyState.loseNextPaidResponse = true;
  const lost = await pay(discoveredOp);
  assert.equal(lost.state, "unresolved");
  assert.equal(lost.failure, "transport_or_authority_failed");
  assert.equal(proxyState.lostPaid, 1);
  assert.equal(counts.settle, 1);
  assert.equal(counts.verify, 1);
  assert.equal((await fetch(`${target}/fixture-counts`).then((response) => response.json())).morpho, 1);
  await fetch(`${target}/fixture-flush`, { method: "POST" });
  const restarted = await start();
  assert.equal(restarted.feedback, true);
  const entitled = await recover(discoveredOp);
  assert.equal(entitled.state, "completed");
  assert.equal(classifySdkResult(entitled.result).kind, "entitled_retrieval");
  assert.equal(classifySdkResult(entitled.result).repurchase, false);
  assert.equal(feedbackBearerOnResult(entitled.result), false);
  assert.equal(mcpRecoveryBudget(entitled).newPaymentPermitted, false);
  assert.equal(toolBody(entitled.result).ok, true);
  assert.equal(toolBody(entitled.result).positionCount, 1);
  assert.equal(counts.settle, 1);
  assert.equal(counts.verify, 1);
  assert.equal((await fetch(`${target}/fixture-counts`).then((response) => response.json())).morpho, 0);
  const localClient = {
    listTools() {
      throw new Error("repurchase");
    },
    callTool() {
      throw new Error("repurchase");
    },
    async close() {},
  };
  const replayedRetrieval = await recover(discoveredOp, localClient);
  assert.equal(replayedRetrieval.state, "completed");
  assert.equal(replayedRetrieval.resultDigest, entitled.resultDigest);
  assert.equal(counts.settle, 1);

  const paidOp = await operation({ address: FIXTURE_ADDRESS, shocks: [-10] });
  const paid = await pay(paidOp);
  assert.equal(paid.state, "completed");
  assert.equal(classifySdkResult(paid.result).kind, "new_paid_task");
  assert.equal(classifySdkResult(paid.result).repurchase, true);
  assert.equal(paid.resultDigest === entitled.resultDigest, false);
  const capability = readSdkCapability(paid.result);
  assert.equal(capability.present, true);
  assert.equal(capability.tool, "report_caller_result");
  const discovered = discoverSdkNextActions({ tools: paidOp.catalog.tools, capability });
  assert.equal(matchesSupportedNextActions(discovered, expected), true);
  assert.equal(discovered.actions.some((action) => action.id === "new_paid_task"), false);
  assert.equal(counts.settle, 2);
  assert.equal((await fetch(`${target}/fixture-counts`).then((response) => response.json())).morpho, 1);

  const reportClient = openClient();
  proxyState.loseNextReportReply = true;
  const lostReport = await reportSdkResult(reportClient, capability, {
    disposition: "useful",
    reasonCategory: "matched_task",
  });
  assert.equal(lostReport.code, "transport_failed");
  assert.equal(lostReport.charged, false);
  assert.equal(proxyState.lostReport, 1);
  await reportClient.close();
  const useful = await reportSdkResult(openClient(), capability, {
    disposition: "useful",
    reasonCategory: "matched_task",
  });
  assert.equal(useful.accepted, true);
  assert.equal(useful.charged, false);
  assert.equal(useful.disposition, "useful");
  assert.equal(useful.idempotentReplay, true);
  assert.equal(useful.usefulness, "unknown");
  const duplicate = await reportSdkResult(openClient(), capability, {
    disposition: "useful",
    reasonCategory: "matched_task",
  });
  assert.equal(duplicate.accepted, true);
  assert.equal(duplicate.idempotentReplay, true);
  assert.equal(counts.settle, 2);
  const conflict = await reportSdkResult(openClient(), capability, {
    disposition: "not_useful",
    reasonCategory: "wrong_output",
  });
  assert.equal(conflict.accepted, false);
  assert.equal(conflict.code, "conflicting_statement");
  assert.equal(conflict.charged, false);
  assert.equal(conflict.retainedDisposition, "useful");

  const negativeOp = await operation({ address: FIXTURE_ADDRESS, shocks: [5] });
  const negative = await pay(negativeOp);
  assert.equal(negative.state, "completed");
  assert.equal(classifySdkResult(negative.result).kind, "new_paid_task");
  assert.equal(classifySdkResult(negative.result).repurchase, true);
  const negativeCapability = readSdkCapability(negative.result);
  assert.equal(negativeCapability.present, true);
  assert.equal(negativeCapability.token === capability.token, false);
  const notUseful = await reportSdkResult(openClient(), negativeCapability, {
    disposition: "not_useful",
    reasonCategory: "missing_field",
  });
  assert.equal(notUseful.accepted, true);
  assert.equal(notUseful.disposition, "not_useful");
  assert.equal(notUseful.idempotentReplay, false);
  assert.equal(notUseful.charged, false);
  assert.equal(counts.settle, 3);

  const callsBeforeWrong = proxyState.calls.length;
  const refused = await reportSdkResult(openClient(), capability, {
    token: negativeCapability.token,
    disposition: "useful",
    reasonCategory: "matched_task",
  });
  assert.equal(refused.code, "wrong_receipt");
  assert.equal(refused.accepted, false);
  assert.equal(refused.charged, false);
  assert.equal(proxyState.calls.length, callsBeforeWrong);

  const forgedReport = await reportMcpCallerResult(openClient(), {
    token: forged.token,
    disposition: "useful",
    reasonCategory: "matched_task",
  });
  assert.equal(forgedReport.accepted, false);
  assert.equal(forgedReport.charged, false);
  assert.equal(forgedReport.code, "tampered_capability");
  assert.equal(counts.settle, 3);

  const foreign = await openClient();
  const foreignResult = await foreign.callTool({
    name: "recover_paid_result",
    arguments: { name: discoveredOp.input.name, arguments: { address: FIXTURE_ADDRESS, shocks: [-10] } },
    _meta: {
      "x402/payment": discoveredOp.input.payment,
      "samedaydesk/recovery-call": {
        operationId: discoveredOp.input.operationId,
        reservationId: discoveredOp.input.reservationId,
        principalId: discoveredOp.input.principalId,
        grantId: discoveredOp.input.grantId,
      },
    },
  });
  await foreign.close();
  assert.equal(foreignResult.isError, true);
  assert.equal(toolBody(foreignResult).charged, false);
  assert.equal(toolBody(foreignResult).error, "payment_identifier_request_conflict");
  assert.equal(classifySdkResult(foreignResult).kind, "rejected");
  assert.equal(counts.settle, 3);
  assert.equal((await fetch(`${target}/fixture-counts`).then((response) => response.json())).morpho, 2);

  await fetch(`${target}/fixture-flush`, { method: "POST" });
  await start();
  const survived = await (await fetch(`${target}/fixture-declarations`)).json();
  assert.deepEqual(survived.declarations.map((row) => row.disposition).sort(), ["not_useful", "useful"]);
  assert.equal(survived.declarations.every((row) => row.source === "caller" && row.inferred === false), true);
  assert.equal(new Set(survived.declarations.map((row) => row.paidEvidenceId)).size, 2);
  const coldReport = await reportSdkResult(openClient(), capability, {
    disposition: "useful",
    reasonCategory: "matched_task",
  });
  assert.equal(coldReport.accepted, true);
  assert.equal(coldReport.idempotentReplay, true);
  assert.equal(coldReport.charged, false);
  assert.equal(counts.settle, 3);
  assert.equal(counts.verify, 3);

  // Before the parent settlement is reconciled the statement stays honestly pending.
  assert.equal(coldReport.bound, false);
  assert.equal(coldReport.parent, "pending");
  assert.equal(coldReport.parentSettlement, null);

  // Reconcile the canonical parent ledger from the merchant's own paid events.
  const eventText = await readFile(path.join(dataDir, "commerce-events.ndjson"), "utf8");
  const paidEvents = eventText.split("\n").filter(Boolean).map((line) => JSON.parse(line))
    .filter((row) => row.result === "paid_success" && typeof row.settlementReference === "string");
  assert.equal(paidEvents.length >= 2, true);
  const usefulEvent = paidEvents.find((row) => row.settlementReference === `0x${(2).toString(16).padStart(64, "0")}`);
  assert.ok(usefulEvent, "useful result paid event");
  const reconcile = (specs, options) => createCommerceSettlementReconciler({
    actorSecret: randomBytes(24).toString("hex"),
    client: receiptFor(specs, options),
    dataDir,
    network: "eip155:8453",
    settlementEvidenceSince: "2020-01-01T00:00:00.000Z",
    treasury,
  }).reconcile();

  // Foreign parent: a transfer to another treasury does not reconcile, so the
  // statement stays pending rather than binding to a foreign settlement.
  await reconcile([{ hash: usefulEvent.settlementReference, amount: BigInt(usefulEvent.settlementAmountAtomic) }], { to: `0x${"c".repeat(40)}` });
  const foreignParent = await reportSdkResult(openClient(), capability, { disposition: "useful", reasonCategory: "matched_task" });
  assert.equal(foreignParent.bound, false);
  assert.equal(foreignParent.parent, "pending");

  const admitted = await reconcile(paidEvents.map((row) => ({ hash: row.settlementReference, amount: BigInt(row.settlementAmountAtomic) })));
  assert.equal(admitted.ledger.reconciledSettlements, paidEvents.length);
  const ledgerRows = (await readFile(path.join(dataDir, "commerce-settlements.ndjson"), "utf8"))
    .split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const parentRow = ledgerRows.find((row) => row.sourceEventId === usefulEvent.id);
  assert.ok(parentRow, "reconciled parent row");
  const boundReport = await reportSdkResult(openClient(), capability, { disposition: "useful", reasonCategory: "matched_task" });
  assert.equal(boundReport.accepted, true);
  assert.equal(boundReport.idempotentReplay, true);
  assert.equal(boundReport.charged, false);
  assert.equal(boundReport.bound, true);
  assert.equal(boundReport.parent, "bound");
  assert.deepEqual(boundReport.parentSettlement, {
    settlementReference: usefulEvent.settlementReference,
    reconciliationId: parentRow.reconciliationId,
  });
  const boundNegative = await reportSdkResult(openClient(), negativeCapability, { disposition: "not_useful", reasonCategory: "missing_field" });
  assert.equal(boundNegative.bound, true);
  assert.equal(boundNegative.parentSettlement.settlementReference === usefulEvent.settlementReference, false);

  // Ambiguous parent: two reconciled rows for one reference bind to neither.
  await writeFile(path.join(dataDir, "commerce-settlements.ndjson"), `${ledgerRows.map((row) => JSON.stringify(row)).join("\n")}\n${JSON.stringify({ ...parentRow, reconciliationId: `sddsr_${"0".repeat(40)}` })}\n`);
  const ambiguous = await reportSdkResult(openClient(), capability, { disposition: "useful", reasonCategory: "matched_task" });
  assert.equal(ambiguous.accepted, true);
  assert.equal(ambiguous.bound, false);
  assert.equal(ambiguous.parent, "unbound");
  assert.equal(ambiguous.parentSettlement, null);
  await writeFile(path.join(dataDir, "commerce-settlements.ndjson"), `${ledgerRows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  assert.equal(counts.settle, 3);

  const stored = JSON.parse(await readFile(discoveredOp.checkpoint, "utf8"));
  stored.result.content = [{ type: "text", text: JSON.stringify({ ok: true, tampered: true }) }];
  await writeFile(discoveredOp.checkpoint, `${JSON.stringify(stored)}\n`, { mode: 0o600 });
  await chmod(discoveredOp.checkpoint, 0o600);
  const callsBeforeIntegrity = proxyState.calls.length;
  await assert.rejects(
    resumePaidMcpResult({
      client: localClient,
      store: mcpRecoveryFileStore(discoveredOp.checkpoint),
      loadGrant: async () => structuredClone(discoveredOp.grant),
    }),
    (error) => error?.code === "checkpoint_result_integrity",
  );
  assert.equal(proxyState.calls.length, callsBeforeIntegrity);
  assert.equal(counts.settle, 3);
  const published = JSON.stringify(survived);
  assert.equal(published.includes(feedbackKey), false);
  assert.equal(published.includes(forged.token), false);
});
