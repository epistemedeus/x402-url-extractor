import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";

import { createCommerceTelemetry } from "./commerce-events.mjs";
import { FIXTURE_ADDRESS } from "./experiments/morpho-useful-delivery-1005/fixture.mjs";
import {
  DELIVERY,
  MCP_DELIVERY_FILENAME,
  MCP_MORPHO_RESOURCE,
  MCP_TOOL_VALIDATOR_SOURCE,
  PAID_EVIDENCE_FILENAME,
  SETTLEMENT_CLASS,
  VALIDATION_FILENAME,
  digestMcpPayload,
  digestResponseBytes,
  mcpDeliveryAttaches,
  openStore,
  recordFromObservedResponse,
} from "./http-delivery-evidence/index.mjs";
import { declareCallerUsefulness } from "./http-delivery-evidence/caller-declaration.mjs";
import { mountMcp } from "./mcp-server.mjs";
import { proveMountedDeliveryJoin } from "./ordinary-delivery-join-observe.mjs";

const requireFromHere = createRequire(import.meta.url);
const express = requireFromHere("express");
const cwd = path.dirname(fileURLToPath(import.meta.url));
const PAYER = `0x${"2".repeat(40)}`;
const NETWORK = "eip155:8453";
const FAKE_TX = `0x${"3".repeat(64)}`;
const MCP_HEADERS = Object.freeze({
  accept: "application/json, text/event-stream",
  "content-type": "application/json",
});
const QUERY = `address=${FIXTURE_ADDRESS}&shocks=-10,-50`;

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
      return send(200, { success: true, payer: PAYER, transaction: FAKE_TX, network: NETWORK });
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

async function startMerchant({ dataDir, facilitatorUrl, scenarioPath }) {
  const preloadPath = path.join(dataDir, "morpho-fetch-hook.mjs");
  const fixtureHref = pathToFileURL(path.join(cwd, "experiments/morpho-useful-delivery-1005/fixture.mjs")).href;
  await writeFile(preloadPath, `
import { readFileSync } from "node:fs";
import { graphqlPage, FREE_INDEX_ITEM } from ${JSON.stringify(fixtureHref)};
const scenarioPath = ${JSON.stringify(scenarioPath)};
const original = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const raw = typeof input === "string" || input instanceof URL ? String(input) : String(input?.url || "");
  let host = "";
  try { host = new URL(raw).hostname; } catch { host = ""; }
  if (host === "127.0.0.1" || host === "localhost") return original(input, init);
  if (raw.includes("api.morpho.org/graphql")) {
    const mode = readFileSync(scenarioPath, "utf8").trim();
    if (mode === "upstream_502") return { ok: false, status: 502, json: async () => ({}) };
    const page = mode === "empty"
      ? graphqlPage(null, { count: 0, countTotal: 0, limit: 100, skip: 0 })
      : mode === "truncated"
        ? graphqlPage(FREE_INDEX_ITEM, { count: 1, countTotal: 101, limit: 100, skip: 0 })
        : graphqlPage(FREE_INDEX_ITEM, { count: 1, countTotal: 1, limit: 100, skip: 0 });
    return { ok: true, status: 200, json: async () => page };
  }
  throw new Error("upstream refused");
};
`, "utf8");
  const port = await unusedPort();
  const existingNodeOptions = String(process.env.NODE_OPTIONS || "").trim();
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
      NODE_OPTIONS: [existingNodeOptions, `--import=${pathToFileURL(preloadPath).href}`].filter(Boolean).join(" "),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup timed out: ${output.slice(-2000)}`)), 30_000);
    const onData = (chunk) => {
      output = `${output}${chunk}`.slice(-40_000);
      if (!output.includes(`x402-merchant listening on :${port}`)) return;
      if (!output.includes("MCP server:")) return;
      clearTimeout(timer);
      resolve();
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`startup exited: ${code}/${signal}\n${output.slice(-4000)}`));
    });
    child.once("error", reject);
  });
  return { base: `http://127.0.0.1:${port}`, child };
}

async function stopChild(child) {
  if (!child) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once("exit", resolve);
    setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 2_000).unref();
  });
}

function decodePaymentRequired(response) {
  const encoded = response.headers.get("payment-required");
  assert.ok(encoded, "missing payment-required");
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
}

function paymentObject(challenge, { expectAmount } = {}) {
  const accepted = challenge.accepts.find((entry) => entry.network === NETWORK && entry.scheme === "exact")
    || challenge.accepts.find((entry) => entry.scheme === "exact");
  assert.ok(accepted);
  if (expectAmount) assert.equal(accepted.amount, expectAmount);
  return {
    x402Version: 2,
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
          id: `mph_${randomBytes(8).toString("hex")}`,
        },
      },
    },
  };
}

function encodePayment(payment) {
  return Buffer.from(JSON.stringify(payment)).toString("base64");
}

async function paidMorpho(base, query, paymentHeader) {
  const unpaid = await fetch(`${base}/defi/morpho-position?${query}`);
  const unpaidText = await unpaid.text();
  assert.equal(unpaid.status, 402, unpaidText.slice(0, 500));
  const challenge = decodePaymentRequired(unpaid);
  const payment = paymentHeader || encodePayment(paymentObject(challenge, { expectAmount: "20000" }));
  const paid = await fetch(`${base}/defi/morpho-position?${query}`, {
    headers: { "payment-signature": payment },
  });
  const bytes = Buffer.from(await paid.arrayBuffer());
  let body = null;
  try { body = JSON.parse(bytes.toString("utf8")); } catch { body = null; }
  return { paid, bytes, body, payment, status: paid.status, replay: paid.headers.get("x-payment-replay") };
}

async function readLines(file) {
  const text = await readFile(file, "utf8").catch((error) => (error?.code === "ENOENT" ? "" : Promise.reject(error)));
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

async function waitFor(read, ready, label) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < 8_000) {
    last = await read();
    if (ready(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`timed out waiting for ${label}: ${JSON.stringify(last)?.slice(0, 500)}`);
}

function acceptsFrom(json) {
  const structured = json?.result?.structuredContent?.accepts?.[0]
    || json?.error?.data?.accepts?.[0]
    || json?.error?.data?.resource?.accepts?.[0];
  if (structured) return structured;
  const text = json?.result?.content?.[0]?.text;
  if (typeof text === "string") {
    try {
      const parsed = JSON.parse(text);
      return parsed.accepts?.[0] || parsed.resource?.accepts?.[0] || null;
    } catch {
      return null;
    }
  }
  return null;
}

function decodeMcpBody(buffer, contentType) {
  const text = Buffer.from(buffer || []).toString("utf8");
  if (!text) return null;
  const payload = String(contentType || "").includes("text/event-stream")
    ? text.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("")
    : text;
  if (!payload) return null;
  try { return JSON.parse(payload); } catch { return null; }
}

async function postMcp(base, body, headers = {}) {
  const response = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { ...MCP_HEADERS, ...headers },
    body: JSON.stringify(body),
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    status: response.status,
    bytes,
    json: decodeMcpBody(bytes, response.headers.get("content-type")),
    replay: response.headers.get("x-payment-replay"),
  };
}

function toolText(json) {
  const text = json?.result?.content?.[0]?.text;
  return typeof text === "string" ? text : "";
}

test("mounted morpho HTTP and MCP producers capture delivery from the live paths", { timeout: 120_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "morpho-producer-"));
  const scenarioPath = path.join(dataDir, "scenario.txt");
  await writeFile(scenarioPath, "snapshot\n", "utf8");
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => {
    await stopChild(merchant?.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, scenarioPath });
  const store = openStore(dataDir);

  const httpCases = [
    ["snapshot", DELIVERY.COMPLETE_USEFUL, (body) => body?.ok === true && body.positionCount === 1 && body.truncated === false],
    ["empty", DELIVERY.USEFUL_NEGATIVE, (body) => body?.ok === true && body.positionCount === 0],
    ["truncated", DELIVERY.TRUNCATED_PARTIAL, (body) => body?.ok === true && body.truncated === true],
    ["upstream_502", DELIVERY.UPSTREAM_FAILED, (body) => body?.ok === false],
  ];
  const httpPayments = [];
  for (const [mode, deliveryClass, predicate] of httpCases) {
    await writeFile(scenarioPath, `${mode}\n`, "utf8");
    const beforeSettle = facilitator.calls.settle;
    const result = await paidMorpho(merchant.base, QUERY);
    assert.equal(result.status, 200, mode);
    assert.equal(predicate(result.body), true, mode);
    assert.equal(facilitator.calls.settle, beforeSettle + 1, mode);
    const digest = digestResponseBytes(result.bytes);
    const rows = await waitFor(
      () => store.readValidations(),
      (validations) => validations.some((row) => row.responseDigest === digest),
      `http ${mode}`,
    );
    const row = rows.find((item) => item.responseDigest === digest);
    assert.equal(row.deliveryClass, deliveryClass, mode);
    assert.equal(row.usefulness, "unknown", mode);
    assert.equal(row.method, "GET", mode);
    assert.equal(row.resource, "/defi/morpho-position", mode);
    assert.equal(row.settlementClass, SETTLEMENT_CLASS.SIMULATED, mode);
    assert.equal(row.settlementReference, FAKE_TX, mode);
    assert.equal(row.validatorSource, "caller_observed_http_bytes", mode);
    httpPayments.push(result.payment);
  }

  const validationBeforeReplay = (await store.readValidations()).length;
  const evidenceBeforeReplay = (await readLines(path.join(dataDir, PAID_EVIDENCE_FILENAME))).length;
  const settleBeforeReplay = facilitator.calls.settle;
  const replay = await fetch(`${merchant.base}/defi/morpho-position?${QUERY}`, {
    headers: { "payment-signature": httpPayments[0] },
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.headers.get("x-payment-replay"), "hit");
  assert.equal(facilitator.calls.settle, settleBeforeReplay);
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal((await store.readValidations()).length, validationBeforeReplay);
  assert.equal((await readLines(path.join(dataDir, PAID_EVIDENCE_FILENAME))).length, evidenceBeforeReplay);

  const validationBeforeInvalid = (await store.readValidations()).length;
  const evidenceBeforeInvalid = (await readLines(path.join(dataDir, PAID_EVIDENCE_FILENAME))).length;
  const invalid = await fetch(`${merchant.base}/defi/morpho-position?address=not-an-address`);
  const invalidBody = await invalid.json();
  assert.equal(invalid.status, 400);
  assert.equal(invalidBody.charged, false);
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal((await store.readValidations()).length, validationBeforeInvalid);
  assert.equal((await readLines(path.join(dataDir, PAID_EVIDENCE_FILENAME))).length, evidenceBeforeInvalid);

  const evidenceBeforeMcp = (await readLines(path.join(dataDir, PAID_EVIDENCE_FILENAME))).length;
  const client = new Client({ name: "morpho-producer", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${merchant.base}/mcp`)));
  const listed = await client.listTools();
  assert.equal(listed.tools.some((tool) => tool.name === "morpho_position"), true);

  await writeFile(scenarioPath, "snapshot\n", "utf8");
  const unpaidMcp = await postMcp(merchant.base, {
    jsonrpc: "2.0",
    id: 7,
    method: "tools/call",
    params: { name: "morpho_position", arguments: { address: FIXTURE_ADDRESS, shocks: [-10, -50] } },
  });
  const challenge = { accepts: [acceptsFrom(unpaidMcp.json)].filter(Boolean) };
  assert.ok(challenge.accepts[0], `mcp challenge missing: ${unpaidMcp.bytes.toString("utf8").slice(0, 400)}`);
  const sdkPayment = paymentObject({ ...challenge, extensions: {} }, { expectAmount: "20000" });
  const sdkResult = await client.callTool({
    name: "morpho_position",
    arguments: { address: FIXTURE_ADDRESS, shocks: [-10, -50] },
    _meta: { "x402/payment": sdkPayment },
  });
  await client.close();
  assert.equal(sdkResult.isError, undefined);
  const sdkText = sdkResult.content?.[0]?.text || "";
  const sdkBody = JSON.parse(sdkText);
  assert.equal(sdkBody.ok, true);
  assert.equal(sdkBody.positionCount, 1);
  const sdkDigest = digestMcpPayload(Buffer.from(sdkText, "utf8"));
  const sdkRows = await waitFor(
    () => store.readMcpDeliveries(),
    (rows) => rows.some((row) => row.responseDigest === sdkDigest),
    "sdk morpho snapshot",
  );
  const sdkRow = sdkRows.find((row) => row.responseDigest === sdkDigest);
  assert.equal(sdkRow.transport, "mcp");
  assert.equal(sdkRow.tool, "morpho_position");
  assert.equal(sdkRow.resource, MCP_MORPHO_RESOURCE);
  assert.equal(sdkRow.deliveryClass, DELIVERY.COMPLETE_USEFUL);
  assert.equal(sdkRow.validatorSource, MCP_TOOL_VALIDATOR_SOURCE);
  assert.equal(sdkRow.usefulness, "unknown");
  assert.equal(sdkRow.settlementClass, SETTLEMENT_CLASS.SIMULATED);
  assert.equal(sdkRow.settlementReference, FAKE_TX);
  assert.equal(sdkRow.applicationIsError, false);
  assert.equal(Object.hasOwn(sdkRow, "method"), false);

  const mcpCases = [
    ["empty", 81, DELIVERY.USEFUL_NEGATIVE, false],
    ["truncated", 82, DELIVERY.TRUNCATED_PARTIAL, false],
    ["upstream_502", 83, DELIVERY.UPSTREAM_FAILED, true],
  ];
  const mcpRows = [sdkRow];
  for (const [mode, id, deliveryClass, isError] of mcpCases) {
    await writeFile(scenarioPath, `${mode}\n`, "utf8");
    const beforeSettle = facilitator.calls.settle;
    const freshUnpaid = await postMcp(merchant.base, {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: "morpho_position", arguments: { address: FIXTURE_ADDRESS, shocks: [-10, -50] } },
    });
    const accepted = acceptsFrom(freshUnpaid.json);
    assert.ok(accepted, mode);
    const paid = await postMcp(merchant.base, {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: {
        name: "morpho_position",
        arguments: { address: FIXTURE_ADDRESS, shocks: [-10, -50] },
        _meta: { "x402/payment": paymentObject({ accepts: [accepted], extensions: {} }, { expectAmount: "20000" }) },
      },
    });
    assert.equal(paid.status, 200, mode);
    assert.equal(paid.json?.result?.isError === true, isError, mode);
    const text = toolText(paid.json);
    const digest = digestMcpPayload(Buffer.from(text, "utf8"));
    const rows = await waitFor(
      () => store.readMcpDeliveries(),
      (found) => found.some((row) => row.responseDigest === digest),
      `mcp ${mode}`,
    );
    const row = rows.find((item) => item.responseDigest === digest);
    assert.equal(row.deliveryClass, deliveryClass, mode);
    assert.equal(row.applicationIsError, isError, mode);
    assert.equal(row.transport, "mcp", mode);
    assert.equal(row.callId, String(id), mode);
    if (isError) {
      assert.equal(facilitator.calls.settle, beforeSettle, mode);
      assert.equal(row.settlementReference, null, mode);
      assert.equal(row.settlementState, "not_attempted", mode);
    } else {
      assert.equal(facilitator.calls.settle, beforeSettle + 1, mode);
      assert.equal(row.settlementReference, FAKE_TX, mode);
      assert.equal(row.settlementState, "succeeded", mode);
    }
    mcpRows.push(row);
  }

  const beforeWrong = (await store.readMcpDeliveries()).length;
  const settleBeforeWrong = facilitator.calls.settle;
  const wrongUnpaid = await postMcp(merchant.base, {
    jsonrpc: "2.0",
    id: 90,
    method: "tools/call",
    params: {
      name: "opportunity_preflight",
      arguments: { rewardUsd: 10, hours: 1, hourlyCostUsd: 50 },
    },
  });
  const wrongAccepted = acceptsFrom(wrongUnpaid.json);
  assert.ok(wrongAccepted, "wrong tool challenge");
  const wrongPaid = await postMcp(merchant.base, {
    jsonrpc: "2.0",
    id: 90,
    method: "tools/call",
    params: {
      name: "opportunity_preflight",
      arguments: { rewardUsd: 10, hours: 1, hourlyCostUsd: 50 },
      _meta: { "x402/payment": paymentObject({ accepts: [wrongAccepted], extensions: {} }) },
    },
  });
  assert.equal(wrongPaid.status, 200);
  assert.equal(wrongPaid.json?.result?.isError, undefined);
  assert.equal(facilitator.calls.settle, settleBeforeWrong + 1);
  await new Promise((resolve) => setTimeout(resolve, 400));
  const afterWrong = await store.readMcpDeliveries();
  assert.equal(afterWrong.length, beforeWrong);
  assert.equal(afterWrong.every((row) => row.tool === "morpho_position"), true);

  await writeFile(scenarioPath, "snapshot\n", "utf8");
  const duplicateUnpaid = await postMcp(merchant.base, {
    jsonrpc: "2.0",
    id: 91,
    method: "tools/call",
    params: { name: "morpho_position", arguments: { address: FIXTURE_ADDRESS, shocks: [-10, -50] } },
  });
  const duplicatePayment = paymentObject({ accepts: [acceptsFrom(duplicateUnpaid.json)], extensions: {} });
  const settleBeforeDuplicate = facilitator.calls.settle;
  const duplicatePaid = await postMcp(merchant.base, {
    jsonrpc: "2.0",
    id: 91,
    method: "tools/call",
    params: {
      name: "morpho_position",
      arguments: { address: FIXTURE_ADDRESS, shocks: [-10, -50] },
      _meta: { "x402/payment": duplicatePayment },
    },
  });
  assert.equal(facilitator.calls.settle, settleBeforeDuplicate + 1);
  const duplicateDigest = digestMcpPayload(Buffer.from(toolText(duplicatePaid.json), "utf8"));
  const duplicateRows = await waitFor(
    () => store.readMcpDeliveries(),
    (rows) => rows.some((row) => row.responseDigest === duplicateDigest && row.callId === "91"),
    "duplicate morpho call",
  );
  const duplicate = duplicateRows.find((row) => row.callId === "91");
  assert.notEqual(duplicate.callDigest, sdkRow.callDigest);
  assert.notEqual(duplicate.paidEvidenceId, sdkRow.paidEvidenceId);
  assert.equal(mcpDeliveryAttaches(sdkRow, {
    tool: duplicate.tool,
    paidEvidenceId: duplicate.paidEvidenceId,
    callDigest: duplicate.callDigest,
    responseDigest: duplicate.responseDigest,
    resource: duplicate.resource,
    settlementReference: duplicate.settlementReference,
    issuedOfferDigest: duplicate.issuedOfferDigest,
  }), false);

  const evidenceAfterMcp = await readLines(path.join(dataDir, PAID_EVIDENCE_FILENAME));
  assert.equal(evidenceAfterMcp.length, evidenceBeforeMcp);
  const typedEvents = (await readLines(path.join(dataDir, "commerce-events.ndjson")))
    .filter((row) => row.sourceContract === "mcp_typed_outcome");
  const morphoEvents = typedEvents.filter((row) => row.binding?.tool === "morpho_position");
  const morphoPaid = morphoEvents.filter((row) => row.result === "paid_success");
  const morphoFailed = morphoEvents.filter((row) => row.result === "application_failure");
  const upstreamRow = mcpRows.find((row) => row.deliveryClass === DELIVERY.UPSTREAM_FAILED);
  const successRows = mcpRows.filter((row) => row !== upstreamRow).concat([duplicate]);
  assert.equal(morphoPaid.length, successRows.length);
  assert.equal(new Set(morphoPaid.map((row) => row.id)).size, morphoPaid.length);
  for (const row of successRows) {
    const event = morphoPaid.find((item) => item.id === row.paidEvidenceId);
    assert.ok(event, row.callId || row.recordId);
    assert.equal(event.settlementState, "succeeded");
    assert.equal(event.handlerInvoked, true);
  }
  assert.equal(morphoFailed.length, 1);
  assert.equal(morphoFailed[0].id, upstreamRow.paidEvidenceId);
  assert.equal(morphoFailed[0].settlementState, "not_attempted");
  assert.equal(morphoFailed[0].handlerInvoked, true);
  assert.equal(morphoFailed[0].reason, "typed_application_failure");
  assert.equal(typedEvents.filter((row) => row.result === "replay_success").length, 0);

  const settleBeforeResend = facilitator.calls.settle;
  const resend = await postMcp(merchant.base, {
    jsonrpc: "2.0",
    id: 92,
    method: "tools/call",
    params: {
      name: "morpho_position",
      arguments: { address: FIXTURE_ADDRESS, shocks: [-10, -50] },
      _meta: { "x402/payment": duplicatePayment },
    },
  });
  assert.equal(resend.status, 200);
  assert.equal(resend.json?.result?.isError, undefined);
  assert.equal(facilitator.calls.settle, settleBeforeResend + 1);
  const resendDigest = digestMcpPayload(Buffer.from(toolText(resend.json), "utf8"));
  const resendRows = await waitFor(
    () => store.readMcpDeliveries(),
    (rows) => rows.some((row) => row.responseDigest === resendDigest && row.callId === "92"),
    "same payment resent on the live mcp wrapper",
  );
  const resent = resendRows.find((row) => row.callId === "92");
  assert.equal(resent.settlementState, "succeeded");
  assert.equal(resent.settlementReference, FAKE_TX);
  assert.notEqual(resent.paidEvidenceId, duplicate.paidEvidenceId);
  assert.equal(mcpDeliveryAttaches(duplicate, {
    tool: resent.tool,
    paidEvidenceId: resent.paidEvidenceId,
    callDigest: resent.callDigest,
    responseDigest: resent.responseDigest,
    resource: resent.resource,
    settlementReference: resent.settlementReference,
    issuedOfferDigest: resent.issuedOfferDigest,
  }), false);
  const eventsAfterResend = (await readLines(path.join(dataDir, "commerce-events.ndjson")))
    .filter((row) => row.sourceContract === "mcp_typed_outcome" && row.binding?.tool === "morpho_position");
  assert.equal(eventsAfterResend.filter((row) => row.result === "paid_success").length, morphoPaid.length + 1);
  assert.equal(eventsAfterResend.filter((row) => row.result === "replay_success").length, 0);
  assert.equal(eventsAfterResend.some((row) => row.id === resent.paidEvidenceId && row.result === "paid_success"), true);
  assert.equal((await readLines(path.join(dataDir, PAID_EVIDENCE_FILENAME))).length, evidenceBeforeMcp);

  const names = await readdir(dataDir);
  for (const name of names) {
    if (!name.endsWith(".ndjson")) continue;
    const text = await readFile(path.join(dataDir, name), "utf8");
    assert.equal(text.toLowerCase().includes(FIXTURE_ADDRESS.toLowerCase()), false, name);
    assert.equal(text.includes(PAYER.toLowerCase()), false, name);
    assert.equal(text.includes("payment-signature"), false, name);
    assert.equal(text.includes("PAYMENT-SIGNATURE"), false, name);
  }

  const bytes = Buffer.from(JSON.stringify({ ok: true }));
  for (const paidEvidenceId of ["77777777-7777-4777-8777-777777777777", "88888888-8888-4888-8888-888888888888"]) {
    assert.throws(
      () => recordFromObservedResponse({
        method: "GET",
        resource: "/defi/morpho-position",
        responseBytes: bytes,
        responseDigest: "f".repeat(64),
        merchantHttpStatus: 200,
        settlementClass: SETTLEMENT_CLASS.SIMULATED,
        paidEvidenceId,
      }),
      /retained output is absent/,
    );
    const declared = declareCallerUsefulness({
      validation: {
        paidEvidenceId,
        settlementReference: FAKE_TX,
        requestDigest: "a".repeat(64),
        usefulness: "unknown",
      },
      declaration: {
        source: "caller",
        disposition: "useful",
        paidEvidenceId,
        settlementReference: FAKE_TX,
        requestDigest: "a".repeat(64),
      },
    });
    assert.equal(declared.reason, "historical_intent_not_retained");
  }
  assert.equal(names.includes(VALIDATION_FILENAME), true);
  assert.equal(names.includes(MCP_DELIVERY_FILENAME), true);
  assert.equal(names.includes(PAID_EVIDENCE_FILENAME), true);

  const proved = await proveMountedDeliveryJoin(dataDir);
  assert.equal(proved.producerUnchanged, true);
  assert.equal(proved.identicalBodyDistinct, true);
  assert.equal(proved.foreignRefused, true);
  assert.equal(proved.mcpJoinedWithoutHttpV1, true);
  for (const name of ["complete_useful", "useful_negative", "truncated_partial", "upstream_failed"]) {
    assert.ok(proved.classes.includes(name), name);
  }
  const sdkJoined = proved.isolated.find((item) => item.id === sdkRow.paidEvidenceId);
  assert.equal(sdkJoined.disposition, "exact_join");
  assert.equal(sdkJoined.responseDigest, sdkDigest);
  assert.equal(sdkJoined.kind, "mcp");
  const paidText = await readFile(path.join(dataDir, PAID_EVIDENCE_FILENAME), "utf8");
  assert.equal(paidText.includes(sdkRow.paidEvidenceId), false);
});

test("mounted mcp producer records malformed, missing, and replay without an HTTP payment row", { timeout: 60_000 }, async () => {
  const previous = process.env.HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS;
  process.env.HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS = "simulated";
  const dataDir = await mkdtemp(path.join(tmpdir(), "morpho-mcp-fixture-"));
  const calls = { verify: 0, settle: 0, handler: 0 };
  const tx = `0x${"33".repeat(32)}`;
  const network = "eip155:84532";
  const payTo = "0x2000000000000000000000000000000000000002";
  const payer = "0x1000000000000000000000000000000000000001";
  let verifySeen = 0;
  const app = express();
  const telemetry = createCommerceTelemetry({ dataDir, secret: "morpho-producer-fixture" });
  app.use(telemetry.middleware);
  const mount = await mountMcp(app, {
    facilitatorClient: {
      async getSupported() {
        return { kinds: [{ x402Version: 2, scheme: "exact", network }], extensions: [] };
      },
      async verify() {
        calls.verify += 1;
        return { isValid: true, payer };
      },
      async settle() {
        calls.settle += 1;
        return { success: true, transaction: tx, network };
      },
    },
    network,
    payTo,
    serverInfo: { name: "morpho-producer-fixture", version: "1" },
    configureResourceServer(resourceServer) {
      resourceServer.onAfterVerify(() => {
        verifySeen += 1;
        if (verifySeen < 3) return undefined;
        return {
          skipHandler: true,
          response: { body: { ok: false, error: "replayed", charged: false } },
        };
      });
    },
    typedTelemetry: {
      enabled: true,
      onAppend: (decision, requestAttribution, declaredSource, toolDelivery) =>
        telemetry.appendMcpTypedDecision(decision, requestAttribution, declaredSource, toolDelivery),
    },
    tools: [{
      name: "morpho_position",
      description: "fixture morpho producer",
      price: "$0.02",
      inputSchema: { address: z.string() },
      returnMcpResult: true,
      run: async () => {
        calls.handler += 1;
        if (calls.handler === 1) return { content: [{ type: "text", text: "{" }] };
        return { content: [] };
      },
    }],
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    async function paid(id) {
      const unpaid = await postMcp(base, {
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name: "morpho_position", arguments: { address: "example" } },
      });
      const accepted = acceptsFrom(unpaid.json);
      assert.ok(accepted, `fixture challenge ${id} status ${unpaid.status} ${unpaid.bytes.toString("utf8").slice(0, 500)}`);
      return postMcp(base, {
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: {
          name: "morpho_position",
          arguments: { address: "example" },
          _meta: {
            "x402/payment": {
              x402Version: 2,
              accepted,
              payload: {
                signature: `0x${"11".repeat(65)}`,
                authorization: {
                  from: payer,
                  to: accepted.payTo,
                  value: accepted.amount,
                  validAfter: "0",
                  validBefore: "9999999999",
                  nonce: `0x${randomBytes(32).toString("hex")}`,
                },
              },
            },
          },
        },
      });
    }
    const malformed = await paid(41);
    const missing = await paid(42);
    const replayed = await paid(43);
    assert.equal(malformed.json?.result?.isError, undefined);
    assert.equal(toolText(malformed.json), "{");
    assert.equal(missing.json?.result?.content?.length, 0);
    assert.equal(calls.handler, 2);
    assert.equal(calls.settle, 3);
    await mount.typedTelemetryLifecycle.flush({ timeoutMs: 1_000 });
    await telemetry.flush();
    const store = openStore(dataDir);
    const rows = await store.readMcpDeliveries();
    const malformedRow = rows.find((row) => row.callId === "41");
    const missingRow = rows.find((row) => row.callId === "42");
    assert.ok(malformedRow);
    assert.ok(missingRow);
    assert.equal(malformedRow.deliveryClass, DELIVERY.MALFORMED_BODY);
    assert.equal(missingRow.deliveryClass, DELIVERY.MISSING_BODY);
    assert.equal(malformedRow.settlementReference, tx);
    assert.equal(missingRow.settlementReference, tx);
    assert.equal(mcpDeliveryAttaches(malformedRow, {
      tool: "morpho_position",
      paidEvidenceId: missingRow.paidEvidenceId,
      callDigest: missingRow.callDigest,
      responseDigest: missingRow.responseDigest,
      resource: missingRow.resource,
      settlementReference: missingRow.settlementReference,
      issuedOfferDigest: missingRow.issuedOfferDigest,
    }), false);
    const events = (await readLines(path.join(dataDir, "commerce-events.ndjson")))
      .filter((row) => row.sourceContract === "mcp_typed_outcome");
    assert.equal(events.filter((row) => row.result === "paid_success").length, 2);
    assert.equal(events.filter((row) => row.result === "replay_success").length, 1);
    assert.equal(events.find((row) => row.result === "replay_success").handlerInvoked, false);
    assert.equal(replayed.status, 200);
    const evidence = await readLines(path.join(dataDir, PAID_EVIDENCE_FILENAME));
    assert.equal(evidence.length, 0);
    const journal = `${JSON.stringify(rows)}${JSON.stringify(events)}`;
    assert.equal(journal.includes(payer.toLowerCase()), false);
    assert.equal(journal.includes("payment-signature"), false);
    assert.equal(journal.includes("example"), false);
    const proved = await proveMountedDeliveryJoin(dataDir);
    assert.equal(proved.producerUnchanged, true);
    assert.equal(proved.foreignRefused, true);
    assert.equal(proved.replayRefused, true);
    assert.ok(proved.classes.includes("malformed_body"));
    assert.ok(proved.classes.includes("missing_body"));
    const paidText = await readFile(path.join(dataDir, PAID_EVIDENCE_FILENAME), "utf8").catch((error) => (
      error?.code === "ENOENT" ? "" : Promise.reject(error)
    ));
    for (const event of events) assert.equal(paidText.includes(event.id), false, event.id);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    if (previous === undefined) delete process.env.HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS;
    else process.env.HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS = previous;
    await rm(dataDir, { recursive: true, force: true });
  }
});
