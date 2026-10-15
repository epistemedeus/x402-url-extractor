import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { SCHEMA_VERSION } from "../../../commerce-settlement-reconciler.mjs";
import { PAID_EVIDENCE_FILENAME, parseNdjson } from "../../../http-delivery-evidence/historical.mjs";
import { VALIDATION_FILENAME } from "../../../http-delivery-evidence/store.mjs";
import {
  CALLER_RESULT_FEEDBACK_HEADER,
  CALLER_RESULT_FEEDBACK_PATH,
} from "../../../caller-result-feedback.mjs";
import {
  PRODUCER_BASE_SHA,
  receiveOrdinaryDeliveryJoin,
  reportViolations,
} from "../../../ordinary-delivery-join.mjs";
import { PURCHASE_EVIDENCE_MANIFEST_PATH } from "../../../purchase-evidence-manifest.mjs";
import {
  bindHttpResult,
  discoverHttpNextActions,
  matchesSupportedNextActions,
  reportHttpResult,
  retrieveEntitledHttp,
} from "../src/cold-client.mjs";

const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const ADVERTISED_ORIGIN = "https://agents.samedaydesk.com";
const NETWORK = "eip155:8453";
const PAYER = `0x${"2".repeat(40)}`;
const WINDOW_START = "2026-01-01T00:00:00.000Z";
const WINDOW_END = "2027-01-01T00:00:00.000Z";
const SOURCE_SHA = "82a51274e7dc7a7600b90f1317a6be6b28442592";

function unusedPort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
    server.once("error", reject);
  });
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function startFacilitator() {
  const calls = { settle: 0, verify: 0 };
  const server = createHttpServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && req.url === "/supported") {
      return send(200, { kinds: [{ network: NETWORK, scheme: "exact", x402Version: 2 }], extensions: [], signers: {} });
    }
    if (req.method === "POST" && req.url === "/verify") {
      calls.verify += 1;
      return send(200, { isValid: true, payer: PAYER });
    }
    if (req.method === "POST" && req.url === "/settle") {
      calls.settle += 1;
      return send(200, {
        success: true,
        payer: PAYER,
        transaction: `0x${calls.settle.toString(16).padStart(64, "0")}`,
        network: NETWORK,
      });
    }
    return send(404, { error: "unexpected" });
  });
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  return {
    calls,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function startMerchant({ dataDir, facilitatorUrl, feedbackKey }) {
  const preloadPath = path.join(dataDir, "extract-fetch-hook.mjs");
  await writeFile(preloadPath, `
const html = (title) => "<html><head><title>" + title + "</title></head><body><p>" + title + "</p></body></html>";
globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = async (input) => {
  const url = String(typeof input === "string" || input instanceof URL ? input : input.url);
  const titles = {
    "https://ok.example/": "OK",
    "https://other.example/": "Other",
    "https://third.example/": "Third",
  };
  if (!titles[url]) throw Object.assign(new Error("unmapped extract fixture"), { code: "fetch_error" });
  const bytes = new TextEncoder().encode(html(titles[url]));
  let delivered = false;
  return {
    status: 200,
    url: "https://fixture.example/" + titles[url],
    headers: { get(name) {
      const key = String(name).toLowerCase();
      if (key === "content-type") return "text/html; charset=utf-8";
      if (key === "content-encoding") return "identity";
      return null;
    } },
    body: { getReader() { return { async read() {
      if (delivered) return { done: true };
      delivered = true;
      return { done: false, value: bytes };
    }, async cancel() {} }; } },
  };
};
`, "utf8");
  const port = await unusedPort();
  const existingNodeOptions = String(process.env.NODE_OPTIONS || "").trim();
  let output = "";
  const child = spawn(process.execPath, ["server.js"], {
    cwd,
    env: {
      ...process.env,
      PORT: String(port),
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      FACILITATOR: "xpay",
      FACILITATOR_URL: facilitatorUrl,
      MPP_SECRET_KEY: "",
      PUBLIC_URL: ADVERTISED_ORIGIN,
      HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS: "simulated",
      CALLER_RESULT_FEEDBACK_KEY: feedbackKey,
      NODE_OPTIONS: [existingNodeOptions, `--import=${pathToFileURL(preloadPath).href}`].filter(Boolean).join(" "),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { output = `${output}${chunk}`.slice(-40_000); });
  child.stderr.on("data", (chunk) => { output = `${output}${chunk}`.slice(-40_000); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup timed out: ${output.slice(-1500)}`)), 30_000);
    const finish = () => {
      if (!output.includes(`x402-merchant listening on :${port}`)) return;
      clearTimeout(timer);
      resolve();
    };
    finish();
    child.stdout.on("data", finish);
    child.stderr.on("data", finish);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`startup exited ${code}/${signal}: ${output.slice(-2000)}`));
    });
  });
  return { base: `http://127.0.0.1:${port}`, child, output: () => output };
}

function createDropProxy(upstream) {
  const state = { dropNextPaid: false, dropped: 0, saved: null };
  const server = createHttpServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const part of req) chunks.push(part);
      const raw = Buffer.concat(chunks);
      const headers = { ...req.headers };
      delete headers.host;
      delete headers.connection;
      delete headers["content-length"];
      const response = await fetch(`${upstream}${req.url}`, {
        method: req.method,
        headers,
        body: raw.length && req.method !== "GET" && req.method !== "HEAD" ? raw : undefined,
        redirect: "error",
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      const replay = response.headers.get("x-payment-replay");
      const paid = Boolean(req.headers["payment-signature"]) && response.status === 200 && replay !== "hit";
      if (state.dropNextPaid && paid) {
        state.dropNextPaid = false;
        state.dropped += 1;
        state.saved = { bytes, feedback: response.headers.get(CALLER_RESULT_FEEDBACK_HEADER) };
        res.destroy();
        return;
      }
      const out = {};
      response.headers.forEach((value, key) => {
        if (key === "content-encoding" || key === "transfer-encoding" || key === "content-length") return;
        out[key] = value;
      });
      res.writeHead(response.status, out);
      res.end(bytes);
    } catch {
      if (!res.headersSent && !res.destroyed) res.destroy();
    }
  });
  return {
    state,
    listen: () => new Promise((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
      server.once("error", reject);
    }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function decodeChallenge(response) {
  const encoded = response.headers.get("payment-required");
  assert.ok(encoded);
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
}

function testPayment(challenge) {
  const accepted = challenge.accepts.find((entry) => entry.network === NETWORK && entry.scheme === "exact");
  assert.ok(accepted);
  return Buffer.from(JSON.stringify({
    x402Version: 2,
    ...(challenge.resource ? { resource: challenge.resource } : {}),
    accepted,
    payload: {
      signature: `0x${"4".repeat(130)}`,
      authorization: {
        from: PAYER,
        to: accepted.payTo,
        value: accepted.amount,
        validAfter: "0",
        validBefore: String(Math.floor(Date.now() / 1000) + 300),
        nonce: `0x${randomBytes(32).toString("hex")}`,
      },
    },
    extensions: {
      "payment-identifier": {
        info: { required: false, id: `ae36_${randomBytes(8).toString("hex")}` },
      },
    },
  })).toString("base64");
}

function localFeedbackFetch(base) {
  return async (url, init) => {
    const target = new URL(url);
    if (target.origin !== ADVERTISED_ORIGIN) throw new Error("production_post_refused");
    if (target.pathname !== CALLER_RESULT_FEEDBACK_PATH || target.search) throw new Error("feedback_target_rejected");
    return fetch(`${base}${target.pathname}`, init);
  };
}

async function waitForRows(file, minCount) {
  const started = Date.now();
  while (Date.now() - started < 8_000) {
    const text = await readFile(file, "utf8").catch((error) => (error?.code === "ENOENT" ? "" : Promise.reject(error)));
    const rows = parseNdjson(text).filter((row) => !row?._unparseable);
    if (rows.length >= minCount) return rows;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`timed out waiting for ${path.basename(file)}`);
}

test("a cold HTTP client discovers, reports, and retrieves one result without a second purchase", { timeout: 180_000 }, async (t) => {
  const expected = JSON.parse(await readFile(new URL("../fixtures/supported-next-actions.json", import.meta.url), "utf8"));
  const forged = JSON.parse(await readFile(new URL("../fixtures/forged-capability.json", import.meta.url), "utf8"));
  const dataDir = await mkdtemp(path.join(tmpdir(), "ae36-http-"));
  const feedbackKey = randomBytes(32).toString("hex");
  const facilitator = await startFacilitator();
  let merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, feedbackKey });
  const proxy = createDropProxy(merchant.base);
  const proxyBase = await proxy.listen();
  t.after(async () => {
    await proxy.close();
    await stopChild(merchant?.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  const contractResponse = await fetch(`${merchant.base}${CALLER_RESULT_FEEDBACK_PATH}`);
  assert.equal(contractResponse.status, 200);
  const feedbackContract = await contractResponse.json();
  const manifest = await (await fetch(`${merchant.base}${PURCHASE_EVIDENCE_MANIFEST_PATH}`)).json();
  const routeReplay = manifest.operations.find((entry) => entry.method === "GET" && entry.path === "/extract")?.replay;
  assert.equal(routeReplay.responseReplay, "conditional");

  const target = "https://ok.example/";
  const extractUrl = `${proxyBase}/extract?url=${encodeURIComponent(target)}`;
  const unpaid = await fetch(extractUrl);
  assert.equal(unpaid.status, 402);
  const absent = bindHttpResult({}, { response: unpaid, resourceUrl: `${ADVERTISED_ORIGIN}/extract?url=${encodeURIComponent(target)}` });
  assert.equal(absent.capability.available, false);
  const challenge = decodeChallenge(unpaid);
  const payment = testPayment(challenge);
  proxy.state.dropNextPaid = true;
  await assert.rejects(fetch(extractUrl, { headers: { "payment-signature": payment } }));
  assert.equal(proxy.state.dropped, 1);
  assert.equal(facilitator.calls.settle, 1);
  assert.equal(typeof proxy.state.saved.feedback, "string");
  await waitForRows(path.join(dataDir, PAID_EVIDENCE_FILENAME), 1);

  const retrieved = await retrieveEntitledHttp({
    fetchImpl: (url, init) => fetch(url, init),
    url: extractUrl,
    payment,
    entitledBytes: proxy.state.saved.bytes,
  });
  assert.equal(retrieved.kind, "entitled_retrieval");
  assert.equal(retrieved.repurchase, false);
  assert.equal(facilitator.calls.settle, 1);
  assert.equal(JSON.parse(retrieved.bytes.toString("utf8")).title, "OK");

  await stopChild(merchant.child);
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, feedbackKey });
  const restartedProxy = createDropProxy(merchant.base);
  const restartedBase = await restartedProxy.listen();
  t.after(() => restartedProxy.close());
  const afterRestart = await retrieveEntitledHttp({
    fetchImpl: (url, init) => fetch(url, init),
    url: `${restartedBase}/extract?url=${encodeURIComponent(target)}`,
    payment,
    entitledBytes: proxy.state.saved.bytes,
  });
  assert.equal(afterRestart.kind, "entitled_retrieval");
  assert.equal(afterRestart.repurchase, false);
  assert.equal(facilitator.calls.settle, 1);

  const receivedTarget = "https://other.example/";
  const receivedUrl = `${merchant.base}/extract?url=${encodeURIComponent(receivedTarget)}`;
  const receivedUnpaid = await fetch(receivedUrl);
  const receivedPayment = testPayment(decodeChallenge(receivedUnpaid));
  const received = await fetch(receivedUrl, { headers: { "payment-signature": receivedPayment } });
  const receivedBytes = Buffer.from(await received.arrayBuffer());
  assert.equal(received.status, 200);
  assert.equal(received.headers.get("x-payment-replay"), null);
  assert.equal(facilitator.calls.settle, 2);
  const purchase = {};
  const resourceUrl = `${ADVERTISED_ORIGIN}/extract?url=${encodeURIComponent(receivedTarget)}`;
  const bound = bindHttpResult(purchase, { response: received, resourceUrl });
  assert.equal(bound.feedbackAdvertised, true);
  const discovered = discoverHttpNextActions({
    feedbackContract,
    routeReplay,
    capability: bound.capability,
  });
  assert.equal(matchesSupportedNextActions(discovered, expected), true);
  assert.equal(discovered.paidTask.charged, true);
  await waitForRows(path.join(dataDir, PAID_EVIDENCE_FILENAME), 2);
  await waitForRows(path.join(dataDir, VALIDATION_FILENAME), 1);

  let lostReply = true;
  const seenTokens = [];
  const fetchImpl = async (url, init) => {
    const headers = init?.headers;
    const presented = typeof headers?.get === "function"
      ? headers.get(CALLER_RESULT_FEEDBACK_HEADER)
      : headers?.[CALLER_RESULT_FEEDBACK_HEADER];
    seenTokens.push(presented);
    const response = await localFeedbackFetch(merchant.base)(url, init);
    if (lostReply) {
      lostReply = false;
      await response.arrayBuffer();
      throw new Error("lost_reply");
    }
    return response;
  };
  const lost = await reportHttpResult(purchase, { disposition: "useful", reasonCategory: "matched_task" }, { fetchImpl });
  assert.equal(lost.code, "transport_failed");
  assert.equal(lost.paymentAttempted, false);
  const reported = await reportHttpResult(purchase, { disposition: "useful", reasonCategory: "matched_task" }, { fetchImpl });
  assert.equal(reported.accepted, true);
  assert.equal(reported.bound, true);
  assert.equal(reported.idempotentReplay, true);
  assert.equal(reported.charged, false);
  assert.equal(reported.disposition, "useful");
  assert.equal(facilitator.calls.settle, 2);
  const replayed = await reportHttpResult(purchase, { disposition: "useful", reasonCategory: "matched_task" }, { fetchImpl });
  assert.equal(replayed.idempotentReplay, true);
  assert.equal(facilitator.calls.settle, 2);

  await stopChild(merchant.child);
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, feedbackKey });
  const fetchAfterRestart = async (url, init) => localFeedbackFetch(merchant.base)(url, init);
  const survived = await reportHttpResult(purchase, { disposition: "useful", reasonCategory: "matched_task" }, { fetchImpl: fetchAfterRestart });
  assert.equal(survived.accepted, true);
  assert.equal(survived.bound, true);
  assert.equal(survived.idempotentReplay, true);
  assert.equal(facilitator.calls.settle, 2);

  const thirdTarget = "https://third.example/";
  const thirdUrl = `${merchant.base}/extract?url=${encodeURIComponent(thirdTarget)}`;
  const thirdPayment = testPayment(decodeChallenge(await fetch(thirdUrl)));
  const third = await fetch(thirdUrl, { headers: { "payment-signature": thirdPayment } });
  assert.equal(third.status, 200);
  assert.equal(third.headers.get("x-payment-replay"), null);
  assert.equal(facilitator.calls.settle, 3);
  const thirdPurchase = {};
  const thirdBound = bindHttpResult(thirdPurchase, {
    response: third,
    resourceUrl: `${ADVERTISED_ORIGIN}/extract?url=${encodeURIComponent(thirdTarget)}`,
  });
  assert.notEqual(thirdBound.capability.available, false);
  const thirdReport = await reportHttpResult(thirdPurchase, { disposition: "not_useful", reasonCategory: "missing_field" }, { fetchImpl: fetchAfterRestart });
  assert.equal(thirdReport.accepted, true);
  assert.equal(thirdReport.bound, true);
  assert.equal(thirdReport.disposition, "not_useful");
  assert.equal(thirdReport.idempotentReplay, false);
  const conflict = await reportHttpResult(purchase, { disposition: "not_useful", reasonCategory: "wrong_output" }, { fetchImpl: fetchAfterRestart });
  assert.equal(conflict.accepted, false);
  assert.equal(conflict.code, "conflicting_statement");
  assert.equal(conflict.charged, false);

  const crossed = await fetch(`${merchant.base}/extract?url=${encodeURIComponent(receivedTarget)}`, {
    headers: { "payment-signature": payment },
  });
  const crossedBody = await crossed.json();
  assert.equal(crossed.status, 409);
  assert.equal(crossedBody.charged, false);
  assert.equal(crossedBody.error, "payment_identifier_request_conflict");
  assert.equal(facilitator.calls.settle, 3);
  const forgedPayment = await fetch(`${merchant.base}/extract?url=${encodeURIComponent(receivedTarget)}`, {
    headers: { "payment-signature": forged.token },
  });
  const forgedBytes = Buffer.from(await forgedPayment.arrayBuffer());
  assert.notEqual(forgedPayment.status, 200);
  assert.equal(forgedBytes.equals(receivedBytes), false);
  assert.equal(facilitator.calls.settle, 3);
  const forgedReport = await fetch(`${merchant.base}${CALLER_RESULT_FEEDBACK_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", [CALLER_RESULT_FEEDBACK_HEADER]: forged.token },
    body: JSON.stringify({ disposition: "useful", reasonCategory: "matched_task" }),
  });
  const forgedReportBody = await forgedReport.json();
  assert.equal(forgedReport.status, 401);
  assert.equal(forgedReportBody.code, "tampered_capability");
  assert.equal(forgedReportBody.accepted, false);
  assert.equal(seenTokens.includes(forged.token), false);

  await waitForRows(path.join(dataDir, PAID_EVIDENCE_FILENAME), 3);
  const paidRows = parseNdjson(await readFile(path.join(dataDir, PAID_EVIDENCE_FILENAME), "utf8"))
    .filter((row) => row?.settlementReference && row?.id);
  await writeFile(path.join(dataDir, "commerce-settlements.ndjson"), `${paidRows.map((row) => JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    state: "reconciled",
    sourceEventId: row.id,
    sourceEventTimestamp: row.responseFinishedAt,
    route: row.route,
    protocol: row.paymentProtocol,
    paymentClass: "unclassified",
    settlementReference: row.settlementReference,
    amountAtomic: challenge.accepts.find((entry) => entry.scheme === "exact").amount,
  })).join("\n")}\n`);
  const report = await receiveOrdinaryDeliveryJoin({
    dataDir,
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    coverage: "unknown_for_full_window",
    sourceSha: SOURCE_SHA,
  });
  assert.equal(report.producerBaseSha, PRODUCER_BASE_SHA);
  assert.equal(report.sourceSha, SOURCE_SHA);
  assert.deepEqual(reportViolations(report), []);
  assert.equal(report.callerResultFeedback.suppliedUseful, 1);
  assert.equal(report.callerResultFeedback.suppliedNotUseful, 1);
  assert.equal(report.callerResultFeedback.measuredUsefulness, "unknown");
  assert.equal(report.rows.every((row) => row.usefulness === "unknown"), true);
  const published = JSON.stringify(report);
  assert.equal(published.includes(feedbackKey), false);
  assert.equal(published.includes(forged.token), false);
});
