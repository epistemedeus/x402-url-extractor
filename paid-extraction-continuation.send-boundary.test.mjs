import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import { CALLER_RESULT_FEEDBACK_HEADER, MCP_CALLER_RESULT_META_KEY } from "./caller-result-feedback.mjs";
import { createCommerceTelemetry } from "./commerce-events.mjs";
import {
  PROSPECTIVE_FILENAME,
  appendProspectiveObservations,
  observationFromJoin,
  prospectiveEvidenceKey,
  readProspectiveDelivery,
} from "./commerce-prospective-delivery.mjs";
import { BASE_USDC, SCHEMA_VERSION } from "./commerce-settlement-reconciler.mjs";
import { mountMcp } from "./mcp-server.mjs";

const requireFromHere = createRequire(import.meta.url);
const express = requireFromHere("express");
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const NETWORK = "eip155:84532";
const PAY_TO = "0x2000000000000000000000000000000000000002";
const PAYER = "0x1000000000000000000000000000000000000001";
const MCP_HEADERS = Object.freeze({
  accept: "application/json, text/event-stream",
  "content-type": "application/json",
});
const SECRET_URL = "https://ok.example/send-boundary-secret";
const HISTORICAL_AT = "2026-10-17T12:00:00.000Z";

function tx(n) {
  return `0x${BigInt(n).toString(16).padStart(64, "0")}`;
}

function payment(accepted) {
  return {
    x402Version: 2,
    accepted,
    payload: {
      signature: `0x${"11".repeat(65)}`,
      authorization: {
        from: PAYER,
        to: accepted.payTo,
        value: accepted.amount,
        validAfter: "0",
        validBefore: "9999999999",
        nonce: `0x${"22".repeat(32)}`,
      },
    },
  };
}

function paidCall(id, accepted) {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: {
      name: "morpho_position",
      arguments: { address: PAYER },
      _meta: { "x402/payment": payment(accepted) },
    },
  };
}

function decodeMcpMessages(buffer, contentType) {
  const text = Buffer.from(buffer || []).toString("utf8");
  if (!text) return [];
  if (String(contentType || "").includes("text/event-stream")) {
    return text.split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
  return [JSON.parse(text)];
}

async function journalText(dir) {
  return readFile(path.join(dir, PROSPECTIVE_FILENAME), "utf8").catch((error) => (
    error?.code === "ENOENT" ? "" : Promise.reject(error)
  ));
}

async function waitForJournal(dir, needle, timeoutMs = 4_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const text = await journalText(dir);
    if (text.includes(needle)) return text;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return journalText(dir);
}

function linesFor(text, evidenceKey) {
  return text.split("\n").filter((line) => line.includes(evidenceKey));
}

function assertNoSecrets(text, secrets) {
  for (const secret of secrets) {
    assert.equal(text.includes(secret), false);
  }
}

function ledgerFor(reference, route) {
  return `${JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    state: "reconciled",
    sourceEventId: "10061017-1017-4017-8017-000000000077",
    sourceEventTimestamp: HISTORICAL_AT,
    route,
    protocol: "x402",
    paymentClass: "unclassified",
    settlementReference: reference,
    network: "eip155:8453",
    asset: BASE_USDC,
    amountAtomic: "10000",
  })}\n`;
}

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function closeServer(server) {
  if (!server) return;
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

test("prepared MCP continuation is transmitted only after the real send accepts it", { timeout: 30_000 }, async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "root177-mcp-send-"));
  const feedbackKey = randomBytes(32).toString("hex");
  const calls = { settle: 0, transactions: [] };
  const events = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
    if (url.hostname !== "127.0.0.1" || url.protocol !== "http:") throw new Error("external network blocked");
    return originalFetch(input, init);
  };
  const app = express();
  const mount = await mountMcp(app, {
    facilitatorClient: {
      async getSupported() {
        return { kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK }], extensions: [] };
      },
      async verify() {
        return { isValid: true, payer: PAYER };
      },
      async settle() {
        calls.settle += 1;
        const transaction = tx(0xb0 + calls.settle);
        calls.transactions.push(transaction);
        return { success: true, transaction, network: NETWORK };
      },
    },
    network: NETWORK,
    payTo: PAY_TO,
    serverInfo: { name: "send-boundary", version: "1" },
    tools: [{
      name: "morpho_position",
      description: "synthetic settled position",
      price: "$0.02",
      inputSchema: { address: z.string() },
      run: async () => ({ ok: true, mode: "settled" }),
    }],
    typedTelemetry: {
      enabled: true,
      onAppend: (decision) => {
        events.push(decision);
      },
    },
    callerResultFeedbackKey: feedbackKey,
    commerceDataDir: dataDir,
  });
  const server = app.listen(0, "127.0.0.1");
  const origin = await new Promise((resolve, reject) => {
    server.once("listening", () => resolve(`http://127.0.0.1:${server.address().port}`));
    server.once("error", reject);
  });
  const realSend = StreamableHTTPServerTransport.prototype.send;
  const boundary = { attached: false, rejected: "" };
  try {
    const unpaid = await post(origin, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "morpho_position", arguments: { address: PAYER } },
    });
    const accepts = unpaid.messages.find((message) => message?.result)?.result?.structuredContent?.accepts?.[0]
      || JSON.parse(unpaid.messages.find((message) => message?.result)?.result?.content?.[0]?.text || "{}").accepts?.[0];
    assert.ok(accepts, "unpaid morpho_position did not issue accepts");
    await mount.typedTelemetryLifecycle.flush({ timeoutMs: 1_000 });

    const sent = await post(origin, paidCall(2, accepts));
    await mount.typedTelemetryLifecycle.flush({ timeoutMs: 1_000 });
    const successTx = calls.transactions[0];
    const successKey = prospectiveEvidenceKey(successTx);
    const successJournal = await waitForJournal(dataDir, `"continuationTransmission":"transmitted"`);
    assert.equal(successJournal.includes(successKey), true);
    assert.equal(linesFor(successJournal, successKey).some((line) => line.includes("\"continuationTransmission\":\"transmitted\"")), true);
    assert.equal(linesFor(successJournal, successKey).some((line) => line.includes("\"feedback\":\"rejected\"")), false);
    assert.equal(linesFor(successJournal, successKey).some((line) => line.includes("\"feedback\":\"absent\"")), true);
    const sentBody = JSON.stringify(sent.messages);
    const capability = sentBody.match(/"token":"([^"]+)"/)?.[1] || "";
    assert.equal(sentBody.includes(MCP_CALLER_RESULT_META_KEY), true);
    assert.equal(capability.length > 0, true);
    assertNoSecrets(successJournal, [capability, feedbackKey, successTx, PAYER, SECRET_URL]);
    assert.equal(events.some((event) => event.result === "paid_success"), true);

    StreamableHTTPServerTransport.prototype.send = async function rejectAfterPreparation(message, options) {
      const token = message?.result?._meta?.[MCP_CALLER_RESULT_META_KEY]?.token;
      if (typeof token === "string" && token.length > 0) boundary.attached = true;
      if (boundary.attached && message?.id === 3) {
        const inner = this._webStandardTransport;
        const streamId = inner?._requestToStreamMapping?.get(message.id);
        if (streamId) inner._streamMapping.delete(streamId);
        try {
          return await realSend.call(this, message, options);
        } catch (error) {
          boundary.rejected = String(error?.message || error);
          throw error;
        }
      }
      return realSend.call(this, message, options);
    };
    events.length = 0;
    await post(origin, paidCall(3, accepts)).catch(() => {});
    await mount.typedTelemetryLifecycle.flush({ timeoutMs: 1_000 });
    assert.equal(boundary.attached, true);
    assert.match(boundary.rejected, /No connection established/);
    const rejectedTx = calls.transactions[1];
    const rejectedKey = prospectiveEvidenceKey(rejectedTx);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const afterReject = await journalText(dataDir);
    assert.equal(afterReject.includes(rejectedKey), false, afterReject);
    assert.equal(afterReject.includes("\"feedback\":\"rejected\""), false);
    assert.equal(events.some((event) => event.result === "paid_success"), false);
    assert.equal(events.some((event) => event.reason === "invalid_typed_outcome"), true);

    const packet = await readProspectiveDelivery({
      dataDir,
      ledger: ledgerFor(successTx, "/mcp"),
      generatedAt: "2026-10-17T15:00:00.000Z",
    });
    assert.equal(packet.continuationTransmission.transmitted, 1);
    assert.equal(packet.continuationTransmission.not_transmitted, 0);
    assert.equal(packet.declaredFeedback.absent, 1);
    assert.equal(packet.declaredFeedback.declared_useful, 0);
    assert.equal(packet.declaredFeedback.rejected, 0);
    assert.equal(packet.usefulness, "unknown");
    assertNoSecrets(JSON.stringify(packet), [capability, feedbackKey, successTx, rejectedTx, PAYER]);
  } finally {
    StreamableHTTPServerTransport.prototype.send = realSend;
    globalThis.fetch = originalFetch;
    await mount.typedTelemetryLifecycle.shutdown({ timeoutMs: 250 }).catch(() => {});
    await closeServer(server);
    await rm(dataDir, { recursive: true, force: true });
  }
});

function post(origin, body) {
  return fetch(`${origin}/mcp`, {
    method: "POST",
    headers: MCP_HEADERS,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  }).then(async (response) => ({
    status: response.status,
    messages: decodeMcpMessages(Buffer.from(await response.arrayBuffer()), response.headers.get("content-type")),
  }));
}

function proofHeader(reference) {
  return Buffer.from(JSON.stringify({
    success: true,
    transaction: reference,
    network: "eip155:8453",
    amount: "10000",
  })).toString("base64url");
}

function paymentHeader() {
  return Buffer.from(JSON.stringify({
    x402Version: 2,
    accepted: { scheme: "exact", network: "eip155:8453" },
    payload: { signature: `0x${"33".repeat(65)}` },
  })).toString("base64");
}

async function httpGet(origin, query, { abort = false } = {}) {
  const target = new URL("/extract", origin);
  for (const [key, value] of Object.entries(query)) target.searchParams.set(key, value);
  const headers = { "payment-signature": paymentHeader() };
  if (!abort) {
    return fetch(target, { headers, signal: AbortSignal.timeout(4_000) });
  }
  const controller = new AbortController();
  const pending = fetch(target, { headers, signal: controller.signal });
  const timer = setTimeout(() => controller.abort(), 80);
  try {
    await pending;
  } catch {
    // The held response has no end. Abort is the client boundary.
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

test("HTTP continuation follows the finished body, not preparation, replay, or an old omitted field", { timeout: 30_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "root177-http-send-"));
  const feedbackKey = randomBytes(32).toString("hex");
  const previousKey = process.env.CALLER_RESULT_FEEDBACK_KEY;
  const historicalRef = tx(0xc1);
  const historicalKey = prospectiveEvidenceKey(historicalRef);
  t.after(async () => {
    if (previousKey === undefined) delete process.env.CALLER_RESULT_FEEDBACK_KEY;
    else process.env.CALLER_RESULT_FEEDBACK_KEY = previousKey;
    await rm(dataDir, { recursive: true, force: true });
  });
  await appendProspectiveObservations(dataDir, [observationFromJoin({
    disposition: "missing_capture",
    reasons: ["paid_evidence_absent"],
  }, {
    evidenceKey: historicalKey,
    technical: "unknown",
    responsePending: true,
  }, HISTORICAL_AT)]);
  const beforeHistorical = await journalText(dataDir);
  assert.equal(linesFor(beforeHistorical, historicalKey).some((line) => line.includes("continuationTransmission")), false);

  process.env.CALLER_RESULT_FEEDBACK_KEY = feedbackKey;
  const commerce = createCommerceTelemetry({ dataDir, secret: "send-boundary-http-secret" });
  const app = express();
  app.use(commerce.middleware);
  app.get("/extract", (req, res) => {
    const mode = String(req.query.mode || "success");
    const reference = String(req.query.tx || "");
    res.setHeader("payment-response", proofHeader(reference));
    if (mode === "replay") res.setHeader("x-payment-replay", "hit");
    if (mode === "partial") {
      res.status(200);
      res.write("{\"ok\":");
      res.socket.destroy();
      return;
    }
    if (mode === "abort") {
      res.status(200);
      res.write("{\"ok\":");
      return;
    }
    if (mode === "throw") {
      res.status(200);
      res.socket.destroy();
    }
    res.status(200).json({ ok: true, title: "OK" });
  });
  const server = app.listen(0, "127.0.0.1");
  const origin = await new Promise((resolve, reject) => {
    server.once("listening", () => resolve(`http://127.0.0.1:${server.address().port}`));
    server.once("error", reject);
  });
  try {
    const successRef = tx(0xd1);
    const success = await httpGet(origin, { url: SECRET_URL, tx: successRef, mode: "success" });
    assert.equal(success.status, 200);
    const capability = success.headers.get(CALLER_RESULT_FEEDBACK_HEADER) || "";
    assert.equal(capability.length > 0, true);
    await success.text();
    await commerce.flush();
    const successKey = prospectiveEvidenceKey(successRef);
    const offered = await waitForJournal(dataDir, `"continuationTransmission":"transmitted"`);
    assert.equal(linesFor(offered, successKey).some((line) => line.includes("\"continuationTransmission\":\"transmitted\"")), true);
    assert.equal(linesFor(offered, successKey).some((line) => line.includes("\"feedback\":\"absent\"")), true);
    assertNoSecrets(offered, [capability, feedbackKey, successRef, SECRET_URL, historicalRef]);

    const beforeReplay = await journalText(dataDir);
    const replayRef = tx(0xd2);
    const replay = await httpGet(origin, { url: SECRET_URL, tx: replayRef, mode: "replay" });
    assert.equal(replay.status, 200);
    assert.equal(replay.headers.get(CALLER_RESULT_FEEDBACK_HEADER), null);
    await replay.text();
    await commerce.flush();
    await new Promise((resolve) => setTimeout(resolve, 150));
    const afterReplay = await journalText(dataDir);
    assert.equal(afterReplay, beforeReplay);
    assert.equal(afterReplay.includes(prospectiveEvidenceKey(replayRef)), false);

    delete process.env.CALLER_RESULT_FEEDBACK_KEY;
    const withheldRef = tx(0xd3);
    const withheld = await httpGet(origin, { url: SECRET_URL, tx: withheldRef, mode: "success" });
    assert.equal(withheld.status, 200);
    assert.equal(withheld.headers.get(CALLER_RESULT_FEEDBACK_HEADER), null);
    await withheld.text();
    await commerce.flush();
    const withheldKey = prospectiveEvidenceKey(withheldRef);
    const withheldJournal = await waitForJournal(dataDir, `"continuationTransmission":"not_transmitted"`);
    assert.equal(linesFor(withheldJournal, withheldKey).some((line) => line.includes("\"continuationTransmission\":\"not_transmitted\"")), true);
    assert.equal(linesFor(withheldJournal, withheldKey).some((line) => line.includes("\"feedback\":\"rejected\"")), false);
    process.env.CALLER_RESULT_FEEDBACK_KEY = feedbackKey;

    const failedModes = [["throw", 0xe1], ["partial", 0xe2], ["abort", 0xe3]];
    for (const [mode, id] of failedModes) {
      const reference = tx(id);
      const pending = httpGet(origin, { url: SECRET_URL, tx: reference, mode }, { abort: mode === "abort" });
      await pending.catch(() => {});
      await commerce.flush().catch(() => {});
      const key = prospectiveEvidenceKey(reference);
      const text = await journalText(dataDir);
      assert.equal(linesFor(text, key).some((line) => line.includes("continuationTransmission")), false, `${mode} claimed transmission`);
      assert.equal(text.includes("\"feedback\":\"rejected\""), false);
    }

    const survived = await journalText(dataDir);
    assert.equal(linesFor(survived, historicalKey).some((line) => line.includes("continuationTransmission")), false);
    const child = spawnSync(process.execPath, [
      "--input-type=module",
      "-e",
      `import { readFile } from "node:fs/promises";
       const text = await readFile(process.argv[1], "utf8");
       const line = text.split("\\n").find((item) => item.includes(process.argv[2])) || "";
       process.stdout.write(JSON.stringify({
         present: line.length > 0,
         field: line.includes("continuationTransmission"),
         leaked: [process.argv[3], process.argv[4], process.argv[5]].some((secret) => secret && text.includes(secret)),
       }));`,
      path.join(dataDir, PROSPECTIVE_FILENAME),
      historicalKey,
      feedbackKey,
      SECRET_URL,
      historicalRef,
    ], { cwd: ROOT, encoding: "utf8" });
    assert.equal(child.status, 0, child.stderr);
    const restarted = JSON.parse(child.stdout);
    assert.equal(restarted.present, true);
    assert.equal(restarted.field, false);
    assert.equal(restarted.leaked, false);

    const packet = await readProspectiveDelivery({
      dataDir,
      ledger: [
        ledgerFor(successRef, "/extract").trim(),
        ledgerFor(historicalRef, "/extract").trim(),
        ledgerFor(withheldRef, "/extract").trim(),
      ].join("\n") + "\n",
      generatedAt: "2026-10-17T15:00:00.000Z",
    });
    assert.equal(packet.continuationTransmission.transmitted, 1);
    assert.equal(packet.continuationTransmission.not_transmitted, 1);
    assert.equal(packet.continuationTransmission.unknown, 1);
    assert.equal(packet.declaredFeedback.rejected, 0);
    assert.equal(packet.usefulness, "unknown");
    assertNoSecrets(JSON.stringify(packet), [feedbackKey, SECRET_URL, successRef, historicalRef, withheldRef]);
  } finally {
    await closeServer(server);
  }
});
