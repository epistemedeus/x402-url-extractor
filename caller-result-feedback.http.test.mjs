import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { SCHEMA_VERSION } from "./commerce-settlement-reconciler.mjs";
import { EXTRACT_BATCH_PATH } from "./extract-batch-config.mjs";
import { extractMcpOutputSchema } from "./extract.mjs";
import { PAID_EVIDENCE_FILENAME, parseNdjson } from "./http-delivery-evidence/historical.mjs";
import { VALIDATION_FILENAME } from "./http-delivery-evidence/store.mjs";
import {
  CALLER_RESULT_FEEDBACK_FILENAME,
  CALLER_RESULT_FEEDBACK_HEADER,
  CALLER_RESULT_FEEDBACK_PATH,
  createCallerResultFeedbackService,
  issueCallerResultFeedbackToken,
} from "./caller-result-feedback.mjs";
import { PRODUCER_BASE_SHA, receiveOrdinaryDeliveryJoin, reportViolations } from "./ordinary-delivery-join.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const PAYER = `0x${"2".repeat(40)}`;
const NETWORK = "eip155:8453";
const PRICE_ATOMIC = "5000";
const WINDOW_START = "2026-01-01T00:00:00.000Z";
const WINDOW_END = "2027-01-01T00:00:00.000Z";

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

async function startFakeFacilitator() {
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
    close: () => new Promise((resolve) => server.close(resolve)),
    url: `http://127.0.0.1:${server.address().port}`,
  };
}

async function startMerchant({ dataDir, facilitatorUrl, feedbackKey }) {
  const preloadPath = path.join(dataDir, "feedback-fetch-hook.mjs");
  await writeFile(preloadPath, `
const html = (title) => "<html><head><title>" + title + "</title></head><body><p>" + title + "</p></body></html>";
const page = (title) => {
  const bytes = new TextEncoder().encode(html(title));
  let delivered = false;
  return {
    status: 200,
    url: "https://fixture.example/" + title,
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
globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = async (input) => {
  const url = String(typeof input === "string" || input instanceof URL ? input : input.url);
  const titles = {
    "https://ok.example/": "OK",
    "https://other.example/": "Other",
    "https://third.example/": "Third",
  };
  if (!titles[url]) throw Object.assign(new Error("unmapped extract fixture"), { code: "fetch_error" });
  return page(titles[url]);
};
globalThis.__SAMEDAYDESK_EXTRACT_BATCH_FETCH__ = async (url) => {
  if (url !== "https://alpha.example/") {
    const error = new Error("unmapped batch fixture");
    error.code = "fetch_error";
    throw error;
  }
  const bytes = new TextEncoder().encode("<!doctype html><title>Alpha</title><h1>Alpha</h1>");
  let delivered = false;
  return {
    status: 200,
    headers: { get: (name) => String(name).toLowerCase() === "content-type" ? "text/html" : null },
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
      PUBLIC_URL: "https://agents.samedaydesk.com",
      HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS: "simulated",
      EXTRACT_BATCH_ENABLED: "1",
      CALLER_RESULT_FEEDBACK_KEY: feedbackKey,
      NODE_OPTIONS: [existingNodeOptions, `--import=${pathToFileURL(preloadPath).href}`].filter(Boolean).join(" "),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const onData = (chunk) => {
    output = `${output}${chunk}`.slice(-80_000);
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup timed out: ${output.slice(-2000)}`)), 20_000);
    const ready = () => output.includes(`x402-merchant listening on :${port}`) && output.includes("POST /mcp (");
    const finish = () => {
      if (!ready()) return;
      clearTimeout(timer);
      resolve();
    };
    finish();
    child.stdout.on("data", finish);
    child.stderr.on("data", finish);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`startup exited: ${code}/${signal}\n${output.slice(-4000)}`));
    });
    child.once("error", reject);
  });
  return {
    base: `http://127.0.0.1:${port}`,
    child,
    output: () => output,
  };
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

function decodePaymentRequired(response) {
  const encoded = response.headers.get("payment-required");
  assert.ok(encoded, "missing payment-required");
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
        info: {
          required: challenge.extensions?.["payment-identifier"]?.info?.required === true,
          id: `crf_${randomBytes(8).toString("hex")}`,
        },
      },
    },
  })).toString("base64");
}

async function paidGet(base, target) {
  const unpaid = await fetch(`${base}/extract?url=${encodeURIComponent(target)}`);
  const unpaidBytes = Buffer.from(await unpaid.arrayBuffer());
  assert.equal(unpaid.status, 402);
  const challenge = decodePaymentRequired(unpaid);
  const accepted = challenge.accepts.find((entry) => entry.network === NETWORK && entry.scheme === "exact");
  assert.equal(accepted.amount, PRICE_ATOMIC);
  const payment = testPayment(challenge);
  const paid = await fetch(`${base}/extract?url=${encodeURIComponent(target)}`, {
    headers: { "payment-signature": payment },
  });
  const bytes = Buffer.from(await paid.arrayBuffer());
  let body = null;
  try { body = JSON.parse(bytes.toString("utf8")); } catch { body = null; }
  return { unpaid, unpaidBytes, paid, bytes, body, payment };
}

async function postFeedback(base, token, body, query = "") {
  const response = await fetch(`${base}${CALLER_RESULT_FEEDBACK_PATH}${query}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { [CALLER_RESULT_FEEDBACK_HEADER]: token } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  return { status: response.status, body: parsed, text };
}

async function waitForRows(file, minCount) {
  const started = Date.now();
  while (Date.now() - started < 8_000) {
    const text = await readFile(file, "utf8").catch((error) => (error?.code === "ENOENT" ? "" : Promise.reject(error)));
    const rows = parseNdjson(text).filter((row) => !row?._unparseable);
    if (rows.length >= minCount) return rows;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${minCount} rows in ${path.basename(file)}`);
}

async function mcpCall(base, body, payment) {
  const response = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 77,
      method: "tools/call",
      params: {
        name: "extract_batch",
        arguments: body,
        ...(payment ? { _meta: { "x402/payment": payment } } : {}),
      },
    }),
  });
  const text = await response.text();
  const parsed = response.headers.get("content-type")?.includes("text/event-stream")
    ? JSON.parse(text.split("\n").find((line) => line.startsWith("data: ")).slice(6))
    : JSON.parse(text);
  return parsed;
}

function containsToken(value, token) {
  return typeof token === "string" && token.length > 0 && String(value).includes(token);
}

test("mounted caller can report one retained result without changing the paid body", { timeout: 180_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "caller-feedback-http-"));
  const feedbackKey = randomBytes(32).toString("hex");
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => {
    await stopChild(merchant?.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, feedbackKey });

  const catalog = await fetch(`${merchant.base}/openapi.json`);
  const catalogBody = await catalog.json();
  assert.equal(Object.hasOwn(catalogBody.paths || {}, CALLER_RESULT_FEEDBACK_PATH), false);

  // A normal HTTP caller follows the advertised Link without private journals
  // or a source-code read to discover how to supply its optional statement.
  const contractResponse = await fetch(`${merchant.base}${CALLER_RESULT_FEEDBACK_PATH}`);
  assert.equal(contractResponse.status, 200);
  const contract = await contractResponse.json();
  assert.equal(contract.method, "POST");
  assert.equal(contract.path, CALLER_RESULT_FEEDBACK_PATH);
  assert.equal(contract.header, CALLER_RESULT_FEEDBACK_HEADER);
  assert.equal(contract.optional, true);
  assert.equal(contract.charged, false);
  assert.equal(contract.payerIdentity, false);
  assert.equal(contract.usefulness, "unknown");
  assert.deepEqual(contract.dispositions, ["useful", "not_useful"]);
  assert.equal(contract.reasonCategories.includes("matched_task"), true);
  assert.equal(Object.hasOwn(contract, "token"), false);
  assert.equal(containsToken(JSON.stringify(contract), feedbackKey), false);

  const first = await paidGet(merchant.base, "https://ok.example/");
  assert.equal(first.paid.status, 200);
  assert.equal(extractMcpOutputSchema.safeParse(first.body).success, true);
  assert.equal(Object.hasOwn(first.body, "paidEvidenceId"), false);
  assert.equal(Object.hasOwn(first.body, "requestDigest"), false);
  assert.equal(Object.hasOwn(first.body, "settlementReference"), false);
  const token = first.paid.headers.get(CALLER_RESULT_FEEDBACK_HEADER);
  assert.equal(typeof token, "string");
  assert.match(first.paid.headers.get("link") || "", /rel="caller-result-feedback"/);
  assert.equal(containsToken(first.bytes, token), false);
  assert.equal(first.unpaid.headers.get(CALLER_RESULT_FEEDBACK_HEADER), null);
  assert.equal(containsToken(merchant.output(), token), false);
  assert.equal(containsToken(merchant.output(), feedbackKey), false);

  await waitForRows(path.join(dataDir, PAID_EVIDENCE_FILENAME), 1);
  await waitForRows(path.join(dataDir, VALIDATION_FILENAME), 1);
  const paidBefore = await readFile(path.join(dataDir, PAID_EVIDENCE_FILENAME), "utf8");
  const validationBefore = await readFile(path.join(dataDir, VALIDATION_FILENAME), "utf8");
  const commerceBefore = await readFile(path.join(dataDir, "commerce-events.ndjson"), "utf8").catch((error) => (
    error?.code === "ENOENT" ? "" : Promise.reject(error)
  ));

  const useful = await postFeedback(merchant.base, token, { disposition: "useful", reasonCategory: "matched_task" });
  assert.equal(useful.status, 200);
  assert.equal(useful.body.accepted, true);
  assert.equal(useful.body.idempotentReplay, false);
  assert.equal(useful.body.charged, false);
  assert.equal(useful.body.payerIdentity, false);
  assert.equal(useful.body.usefulness, "unknown");
  assert.equal(useful.body.disposition, "useful");
  assert.equal(containsToken(useful.text, token), false);
  const again = await postFeedback(merchant.base, token, { disposition: "useful", reasonCategory: "matched_task" });
  assert.equal(again.status, 200);
  assert.equal(again.body.idempotentReplay, true);
  const conflict = await postFeedback(merchant.base, token, { disposition: "not_useful", reasonCategory: "wrong_output" });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, "conflicting_statement");
  assert.equal(conflict.body.accepted, false);
  assert.equal(conflict.body.retainedDisposition, "useful");
  const journal = await readFile(path.join(dataDir, CALLER_RESULT_FEEDBACK_FILENAME), "utf8");
  assert.equal(containsToken(journal, token), false);
  assert.equal(containsToken(journal, feedbackKey), false);
  assert.equal(await readFile(path.join(dataDir, PAID_EVIDENCE_FILENAME), "utf8"), paidBefore);
  assert.equal(await readFile(path.join(dataDir, VALIDATION_FILENAME), "utf8"), validationBefore);
  assert.equal(await readFile(path.join(dataDir, "commerce-events.ndjson"), "utf8").catch(() => ""), commerceBefore);

  const second = await paidGet(merchant.base, "https://other.example/");
  assert.equal(second.paid.status, 200);
  const secondToken = second.paid.headers.get(CALLER_RESULT_FEEDBACK_HEADER);
  assert.notEqual(secondToken, token);
  assert.equal(containsToken(second.bytes, secondToken), false);
  const crossed = await postFeedback(merchant.base, token, { disposition: "not_useful" });
  assert.equal(crossed.body.code, "conflicting_statement");
  const silentJournal = await readFile(path.join(dataDir, CALLER_RESULT_FEEDBACK_FILENAME), "utf8");
  assert.equal(silentJournal.trim().split("\n").length, 1);

  const replay = await fetch(`${merchant.base}/extract?url=${encodeURIComponent("https://ok.example/")}`, {
    headers: { "payment-signature": first.payment },
  });
  const replayBytes = Buffer.from(await replay.arrayBuffer());
  assert.equal(replay.status, 200);
  assert.equal(replay.headers.get("x-payment-replay"), "hit");
  assert.equal(replay.headers.get(CALLER_RESULT_FEEDBACK_HEADER), null);
  assert.equal(replayBytes.equals(first.bytes), true);
  assert.equal(facilitator.calls.settle, 2);
  const replayStore = await readFile(path.join(dataDir, "idempotency-replay.json"), "utf8");
  assert.equal(containsToken(replayStore, token), false);
  assert.equal(containsToken(replayStore, secondToken), false);

  const batchBody = { urls: ["https://alpha.example/"], fields: ["title"] };
  const unpaidMcp = await mcpCall(merchant.base, batchBody, null);
  const payment = JSON.parse(Buffer.from(testPayment(unpaidMcp.result.structuredContent), "base64").toString("utf8"));
  const mcpPaid = await mcpCall(merchant.base, batchBody, payment);
  assert.equal(mcpPaid.result?.structuredContent?.sources?.[0]?.data?.title, "Alpha");
  const feedbackMeta = mcpPaid.result?._meta?.["samedaydesk/caller-result-feedback"];
  assert.equal(feedbackMeta?.optional, true);
  assert.equal(feedbackMeta?.charged, false);
  assert.equal(feedbackMeta?.payerIdentity, false);
  assert.equal(feedbackMeta?.usefulness, "unknown");
  assert.equal(feedbackMeta?.path, CALLER_RESULT_FEEDBACK_PATH);
  const mcpToken = feedbackMeta?.token;
  assert.equal(typeof mcpToken, "string");
  assert.equal(containsToken(JSON.stringify(mcpPaid.result.structuredContent), mcpToken), false);
  assert.equal(mcpPaid.result._meta["samedaydesk/http"].headers[CALLER_RESULT_FEEDBACK_HEADER], undefined);
  const mcpFeedback = await postFeedback(merchant.base, mcpToken, { disposition: "not_useful", reasonCategory: "not_actionable" });
  assert.equal(mcpFeedback.status, 200);
  assert.equal(mcpFeedback.body.disposition, "not_useful");
  assert.equal(mcpFeedback.body.usefulness, "unknown");
  assert.equal(containsToken(merchant.output(), mcpToken), false);

  const tamperedParts = token.split(".");
  const tamperedMac = Buffer.from(tamperedParts.at(-1), "base64url");
  tamperedMac[0] ^= 1;
  tamperedParts[tamperedParts.length - 1] = tamperedMac.toString("base64url");
  const tampered = await postFeedback(
    merchant.base,
    tamperedParts.join("."),
    { disposition: "useful" },
  );
  assert.equal(tampered.status, 401);
  assert.equal(tampered.body.code, "tampered_capability");
  assert.equal(tampered.body.accepted, false);
  const foreign = issueCallerResultFeedbackToken({
    key: feedbackKey,
    eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    method: "GET",
    route: "/extract",
    requestDigest: "1".repeat(64),
    responseDigest: "2".repeat(64),
  });
  const foreignResult = await postFeedback(merchant.base, foreign, { disposition: "useful" });
  assert.equal(foreignResult.status, 409);
  assert.equal(foreignResult.body.code, "missing_capture");
  const queried = await postFeedback(merchant.base, token, { disposition: "useful" }, "?token=1");
  assert.equal(queried.status, 400);
  assert.equal(queried.body.code, "query_rejected");
  const unbounded = await postFeedback(merchant.base, secondToken, { disposition: "useful", note: "raw prompt" });
  assert.equal(unbounded.status, 400);
  assert.equal(unbounded.body.code, "unbounded_field");

  const paidPath = path.join(dataDir, PAID_EVIDENCE_FILENAME);
  const originalPaid = await readFile(paidPath, "utf8");
  const lines = originalPaid.trim().split("\n").map((line) => JSON.parse(line));
  const firstRow = lines.find((row) => row.responseDigest && journal.includes(row.id));
  assert.ok(firstRow);
  const savedRoute = firstRow.route;
  firstRow.route = "/read";
  await writeFile(paidPath, `${lines.map((row) => JSON.stringify(row)).join("\n")}\n`);
  const wrongRoute = await postFeedback(merchant.base, token, { disposition: "useful", reasonCategory: "matched_task" });
  assert.equal(wrongRoute.status, 409);
  assert.equal(wrongRoute.body.code, "route_mismatch");
  firstRow.route = savedRoute;
  const savedRequest = firstRow.requestDigest;
  firstRow.requestDigest = "9".repeat(64);
  await writeFile(paidPath, `${lines.map((row) => JSON.stringify(row)).join("\n")}\n`);
  const wrongRequest = await postFeedback(merchant.base, token, { disposition: "useful", reasonCategory: "matched_task" });
  assert.equal(wrongRequest.body.code, "request_mismatch");
  firstRow.requestDigest = savedRequest;
  const savedResponse = firstRow.responseDigest;
  firstRow.responseDigest = "8".repeat(64);
  await writeFile(paidPath, `${lines.map((row) => JSON.stringify(row)).join("\n")}\n`);
  const wrongResponse = await postFeedback(merchant.base, token, { disposition: "useful", reasonCategory: "matched_task" });
  assert.equal(wrongResponse.body.code, "response_mismatch");
  firstRow.responseDigest = savedResponse;
  await writeFile(paidPath, originalPaid);

  await stopChild(merchant.child);
  const persistedJournal = await readFile(path.join(dataDir, CALLER_RESULT_FEEDBACK_FILENAME), "utf8");
  await writeFile(path.join(dataDir, CALLER_RESULT_FEEDBACK_FILENAME), `${persistedJournal.trim()}\n{\n`, "utf8");
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, feedbackKey });
  const afterTorn = await postFeedback(merchant.base, token, { disposition: "useful", reasonCategory: "matched_task" });
  assert.equal(afterTorn.status, 200);
  assert.equal(afterTorn.body.idempotentReplay, true);
  const tornRead = await createCallerResultFeedbackService({ dataDir, key: feedbackKey }).readDeclarations();
  assert.ok(tornRead.rejected >= 1);
  assert.equal(tornRead.declarations.some((item) => item.disposition === "useful"), true);

  const journalFile = path.join(dataDir, CALLER_RESULT_FEEDBACK_FILENAME);
  const validationBeforeFailure = await readFile(path.join(dataDir, VALIDATION_FILENAME), "utf8");
  const statementsBeforeFailure = (await readFile(journalFile, "utf8")).trim().split("\n").filter((line) => line.startsWith("{")).length;
  await chmod(journalFile, 0o444);
  const third = await paidGet(merchant.base, "https://third.example/");
  assert.equal(third.paid.status, 200);
  assert.equal(extractMcpOutputSchema.safeParse(third.body).success, true);
  const thirdToken = third.paid.headers.get(CALLER_RESULT_FEEDBACK_HEADER);
  assert.equal(typeof thirdToken, "string");
  await waitForRows(paidPath, lines.length + 1);
  await waitForRows(path.join(dataDir, VALIDATION_FILENAME), parseNdjson(validationBeforeFailure).filter((row) => !row?._unparseable).length + 1);
  const failedWrite = await postFeedback(merchant.base, thirdToken, { disposition: "useful" });
  assert.equal(failedWrite.status, 503);
  assert.equal(failedWrite.body.code, "journal_write_failed");
  assert.equal(failedWrite.body.accepted, false);
  const paidAfterFailure = await readFile(paidPath, "utf8");
  assert.equal(paidAfterFailure.includes(third.body.title || "Third"), false);
  assert.ok(parseNdjson(paidAfterFailure).filter((row) => !row._unparseable).length >= lines.length + 1);
  await chmod(journalFile, 0o600);
  const statementsAfterFailure = (await readFile(journalFile, "utf8")).trim().split("\n").filter((line) => line.startsWith("{")).length;
  assert.equal(statementsAfterFailure, statementsBeforeFailure);

  await stopChild(merchant.child);
  const paidRows = parseNdjson(await readFile(paidPath, "utf8")).filter((row) => row?.settlementReference && row?.id);
  await writeFile(path.join(dataDir, "commerce-settlements.ndjson"), `${paidRows.map((row) => JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    state: "reconciled",
    sourceEventId: row.id,
    sourceEventTimestamp: row.responseFinishedAt,
    route: row.route,
    protocol: row.paymentProtocol,
    paymentClass: "unclassified",
    settlementReference: row.settlementReference,
    amountAtomic: row.route === EXTRACT_BATCH_PATH ? "10000" : PRICE_ATOMIC,
  })).join("\n")}\n`);
  const report = await receiveOrdinaryDeliveryJoin({
    dataDir,
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    coverage: "unknown_for_full_window",
    sourceSha: PRODUCER_BASE_SHA,
  });
  assert.deepEqual(reportViolations(report), []);
  assert.equal(report.customerPlane.attributableCustomerCount, null);
  assert.equal(report.schemaValidityIsBuyerUsefulness, false);
  const supplied = report.rows.filter((row) => row.callerSuppliedDisposition);
  assert.equal(supplied.filter((row) => row.callerSuppliedDisposition === "useful").length, 1);
  assert.equal(supplied.filter((row) => row.callerSuppliedDisposition === "not_useful").length, 1);
  assert.ok(report.rows.some((row) => row.callerAcceptance === "absent" && row.callerSuppliedDisposition === null));
  assert.equal(report.rows.every((row) => row.usefulness === "unknown"), true);
  assert.equal(report.callerResultFeedback.globalFunnel, false);
  assert.equal(report.callerResultFeedback.customerCount, null);
  assert.equal(report.callerResultFeedback.measuredUsefulness, "unknown");
  assert.equal(report.callerResultFeedback.suppliedNotUseful, 1);
  assert.equal(
    report.callerResultFeedback.suppliedUseful
      + report.callerResultFeedback.suppliedNotUseful
      + report.callerResultFeedback.absent
      + report.callerResultFeedback.unboundOrForeign,
    report.rows.length,
  );
  const published = JSON.stringify(report);
  assert.equal(containsToken(published, token), false);
  assert.equal(containsToken(published, secondToken), false);
  assert.equal(containsToken(published, mcpToken), false);
  assert.equal(containsToken(published, feedbackKey), false);
  assert.equal(published.includes("0x"), false);
  const cli = spawnSync(process.execPath, [
    path.join(cwd, "ordinary-delivery-join-cli.mjs"),
    "--data-dir", dataDir,
    "--window-start", WINDOW_START,
    "--window-end", WINDOW_END,
    "--coverage", "unknown_for_full_window",
    "--source-sha", PRODUCER_BASE_SHA,
  ], { cwd, encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stderr);
  const cliReport = JSON.parse(cli.stdout);
  assert.equal(cliReport.callerResultFeedback.suppliedUseful, report.callerResultFeedback.suppliedUseful);
  assert.equal(cliReport.callerResultFeedback.suppliedNotUseful, report.callerResultFeedback.suppliedNotUseful);
  assert.equal(containsToken(cli.stdout, token), false);
  assert.equal(cli.stdout.includes("0x"), false);
});

test("a merchant without the feedback key still delivers and refuses the report", { timeout: 120_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "caller-feedback-nokey-"));
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => {
    await stopChild(merchant?.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, feedbackKey: "" });
  const paid = await paidGet(merchant.base, "https://ok.example/");
  assert.equal(paid.paid.status, 200);
  assert.equal(extractMcpOutputSchema.safeParse(paid.body).success, true);
  assert.equal(paid.paid.headers.get(CALLER_RESULT_FEEDBACK_HEADER), null);
  const refused = await postFeedback(merchant.base, "not-a-capability", { disposition: "useful" });
  assert.equal(refused.status, 503);
  assert.equal(refused.body.code, "key_absent");
  assert.equal(refused.body.accepted, false);
  assert.equal(facilitator.calls.settle, 1);
});
