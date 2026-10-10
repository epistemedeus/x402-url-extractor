// Owned loopback for one native MCP caller statement.
// Synthetic facilitator receipts only. No chain transfer, signer, or public call.
import { spawn, spawnSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { x402MCPClient } from "@x402/mcp";
import { encodeAbiParameters, encodeEventTopics, getAddress, parseAbiItem } from "viem";

import {
  CALLER_RESULT_FEEDBACK_HEADER,
  CALLER_RESULT_FEEDBACK_PATH,
  issueCallerResultFeedbackToken,
} from "./caller-result-feedback.mjs";
import { isCanonicalMcpTypedCommerceEvent } from "./commerce-events.mjs";
import { readProspectiveDelivery, retainProspectiveDeliveries } from "./commerce-prospective-delivery.mjs";
import {
  BASE_USDC,
  readCommerceSettlementAdmission,
  reconcileCommerceSettlementEvents,
} from "./commerce-settlement-reconciler.mjs";
import { digestMcpPayload } from "./http-delivery-evidence/digest.mjs";
import { FIXTURE_ADDRESS } from "./experiments/morpho-useful-delivery-1005/fixture.mjs";
import { MCP_DELIVERY_FILENAME } from "./http-delivery-evidence/mcp-delivery.mjs";
import { FILE_CLASSES } from "./ordinary-delivery-join.mjs";
import { readMcpCallerResultCapability, reportMcpCallerResult } from "./mcp-caller-result.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const PAYER = `0x${"2".repeat(40)}`;
const TREASURY = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
const NETWORK = "eip155:8453";
const ACTOR_SECRET = randomBytes(24).toString("hex");
const FEEDBACK_KEY = randomBytes(32).toString("hex");
const SINCE = "2020-01-01T00:00:00.000Z";
const MCP_HEADERS = Object.freeze({
  accept: "application/json, text/event-stream",
  "content-type": "application/json",
});
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const REMAINING_CONTRACT = "Canonical MCP typed events omit route, paymentProtocol, and settlementReference and keep chainTruth false, so the unchanged reconciler admits none of them. The current prospective measurement binds a caller statement only when a parent ledger row exists with route /mcp, protocol x402, the typed event id, a matching timestamp, and the same settlement reference. This package does not add those fields.";

const secrets = [];

function remember(value) {
  if (typeof value === "string" && value.length > 0) secrets.push(value);
  return value;
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

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

function startFakeFacilitator() {
  const calls = { settle: 0, verify: 0 };
  let sequence = 0;
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
      sequence += 1;
      return send(200, {
        success: true,
        payer: PAYER,
        transaction: `0x${sequence.toString(16).padStart(64, "0")}`,
        network: NETWORK,
      });
    }
    return send(404, { error: "unexpected" });
  });
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        calls,
        close: () => new Promise((done) => server.close(done)),
        url: `http://127.0.0.1:${server.address().port}`,
      });
    });
    server.once("error", reject);
  });
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
    const page = graphqlPage(FREE_INDEX_ITEM, { count: 1, countTotal: 1, limit: 100, skip: 0 });
    return { ok: true, status: 200, json: async () => page };
  }
  throw new Error("upstream refused");
};
`, "utf8");
  const port = await unusedPort();
  const env = { ...process.env };
  delete env.COMMERCE_SETTLEMENT_EVIDENCE_SINCE;
  delete env.CALLER_RESULT_FEEDBACK_KEY;
  const child = spawn(process.execPath, ["server.js"], {
    cwd,
    env: {
      ...env,
      PORT: String(port),
      PAY_TO: TREASURY,
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_ACTOR_SECRET: ACTOR_SECRET,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      CALLER_RESULT_FEEDBACK_KEY: FEEDBACK_KEY,
      CALLER_RESULT_FEEDBACK_MAX_FILE_BYTES: "256",
      FACILITATOR: "xpay",
      FACILITATOR_URL: facilitatorUrl,
      MPP_SECRET_KEY: "",
      PUBLIC_URL: "https://agents.samedaydesk.com",
      HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS: "simulated",
      NODE_OPTIONS: [String(process.env.NODE_OPTIONS || "").trim(), `--import=${pathToFileURL(preloadPath).href}`].filter(Boolean).join(" "),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("startup_timeout")), 45_000);
    const onData = (chunk) => {
      output = `${output}${chunk}`.slice(-80_000);
      if (!output.includes(`x402-merchant listening on :${port}`)) return;
      if (!output.includes("MCP server:")) return;
      clearTimeout(timer);
      resolve();
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("startup_exited"));
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

function paymentObject(challenge) {
  const accepted = challenge.accepts.find((entry) => entry.network === NETWORK && entry.scheme === "exact")
    || challenge.accepts.find((entry) => entry.scheme === "exact");
  if (!accepted) fail("payment_challenge_missing");
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
    extensions: {},
  };
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

async function postMcp(base, body) {
  const response = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: MCP_HEADERS,
    body: JSON.stringify(body),
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    json: decodeMcpBody(bytes, response.headers.get("content-type")),
  };
}

function acceptsFrom(json) {
  const structured = json?.result?.structuredContent?.accepts?.[0]
    || json?.error?.data?.accepts?.[0];
  if (structured) return structured;
  const text = json?.result?.content?.[0]?.text;
  if (typeof text !== "string") return null;
  try { return JSON.parse(text).accepts?.[0] || null; } catch { return null; }
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
  fail(`timeout_${label}`);
  return last;
}

function resign(token, mutate) {
  const dot = token.indexOf(".");
  const claims = JSON.parse(Buffer.from(token.slice(0, dot), "base64url").toString("utf8"));
  const payload = Buffer.from(JSON.stringify(mutate(claims)));
  const mac = createHmac("sha256", FEEDBACK_KEY).update(payload).digest();
  return remember(`${payload.toString("base64url")}.${mac.toString("base64url")}`);
}

async function connectSdk(base) {
  const client = new Client({ name: "native-mcp-caller", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  return client;
}

async function payTool(client, base, name, args, { expectAmount = null } = {}) {
  const unpaid = await postMcp(base, {
    jsonrpc: "2.0",
    id: randomBytes(4).toString("hex"),
    method: "tools/call",
    params: { name, arguments: args },
  });
  const accepted = acceptsFrom(unpaid.json);
  if (!accepted) fail(`challenge_missing_${name}`);
  if (expectAmount) {
    if (accepted.amount !== expectAmount) fail(`amount_${name}`);
  }
  const result = await client.callTool({
    name,
    arguments: args,
    _meta: { "x402/payment": paymentObject({ accepts: [accepted] }) },
  });
  return result;
}

function toolText(result) {
  const text = result?.content?.[0]?.text;
  return typeof text === "string" ? text : "";
}

async function payMorpho(client, base, dataDir) {
  const before = (await readLines(path.join(dataDir, MCP_DELIVERY_FILENAME)))
    .filter((row) => row.tool === "morpho_position" && row.settlementState === "succeeded").length;
  const result = await payTool(client, base, "morpho_position", {
    address: FIXTURE_ADDRESS,
    shocks: [-10, -50],
  }, { expectAmount: "20000" });
  const text = toolText(result);
  const digest = digestMcpPayload(Buffer.from(text, "utf8"));
  const rows = await waitFor(
    () => readLines(path.join(dataDir, MCP_DELIVERY_FILENAME)),
    (found) => found.filter((row) => row.tool === "morpho_position" && row.settlementState === "succeeded").length >= before + 1,
    "delivery",
  );
  const delivery = rows.filter((row) => row.tool === "morpho_position" && row.settlementState === "succeeded").at(-1);
  if (delivery.responseDigest !== digest) fail("digest_mismatch");
  await waitFor(
    () => readLines(path.join(dataDir, FILE_CLASSES.commerceEvents)),
    (found) => found.some((row) => row.id === delivery.paidEvidenceId && isCanonicalMcpTypedCommerceEvent(row)),
    "typed_event",
  );
  return { result, text, digest, delivery, capability: readMcpCallerResultCapability(result) };
}

function receiptClient(reference) {
  return {
    async getTransactionReceipt({ hash }) {
      if (String(hash).toLowerCase() !== reference) fail("unexpected_receipt");
      return {
        status: "success",
        blockNumber: 1n,
        logs: [{
          address: getAddress(BASE_USDC),
          topics: encodeEventTopics({
            abi: [TRANSFER],
            eventName: "Transfer",
            args: { from: getAddress(PAYER), to: getAddress(TREASURY) },
          }),
          data: encodeAbiParameters([{ type: "uint256" }], [20000n]),
        }],
      };
    },
    async getBlock() {
      return { timestamp: 1_760_000_000n };
    },
  };
}

async function statementLines(dataDir) {
  const current = await readLines(path.join(dataDir, FILE_CLASSES.callerResultFeedback)).catch(() => []);
  const rotated = await readLines(path.join(dataDir, FILE_CLASSES.callerResultFeedbackRotated)).catch(() => []);
  return [...rotated, ...current];
}

function containsSecret(text) {
  return secrets.some((secret) => text.includes(secret));
}

async function main() {
  const dataDir = await mkdtemp(path.join(tmpdir(), "mcp-caller-"));
  const projectionDir = await mkdtemp(path.join(tmpdir(), "mcp-caller-projection-"));
  const scenarioPath = path.join(dataDir, "scenario.txt");
  await writeFile(scenarioPath, "snapshot\n", "utf8");
  const facilitator = await startFakeFacilitator();
  let merchant = null;
  let client = null;
  const logs = [];
  try {
    const emptyCut = readCommerceSettlementAdmission("").admissionCutId;
    merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, scenarioPath });
    logs.push(merchant.output());
    client = await connectSdk(merchant.base);
    const listed = await client.listTools();
    if (!listed.tools.some((tool) => tool.name === "report_caller_result")) fail("free_tool_absent");
    if (!listed.tools.some((tool) => tool.name === "morpho_position")) fail("morpho_tool_absent");

    const first = await payMorpho(client, merchant.base, dataDir);
    if (!first.capability.present) fail("capability_absent");
    remember(first.capability.token);
    if (first.text.includes(first.capability.token)) fail("token_in_content");
    if (JSON.stringify(first.result.structuredContent || {}).includes(first.capability.token)) fail("token_in_structured");
    if (JSON.stringify(first.result._meta).includes("https://")) fail("meta_link");
    if (first.delivery.usefulness !== "unknown") fail("delivery_usefulness");

    const useful = await reportMcpCallerResult(client, {
      token: first.capability.token,
      disposition: "useful",
      reasonCategory: "matched_task",
    });
    if (useful.accepted !== true || useful.disposition !== "useful" || useful.idempotentReplay !== false) {
      fail("useful_rejected");
    }
    const replay = await reportMcpCallerResult(client, {
      token: first.capability.token,
      disposition: "useful",
      reasonCategory: "matched_task",
    });
    if (replay.idempotentReplay !== true || replay.disposition !== "useful") fail("duplicate_rejected");
    const conflict = await reportMcpCallerResult(client, {
      token: first.capability.token,
      disposition: "not_useful",
      reasonCategory: "missing_field",
    });
    if (conflict.code !== "conflicting_statement" || conflict.retainedDisposition !== "useful") fail("conflict_lost");

    const second = await payMorpho(client, merchant.base, dataDir);
    if (!second.capability.present) fail("second_capability_absent");
    remember(second.capability.token);
    const notUseful = await reportMcpCallerResult(client, {
      token: second.capability.token,
      disposition: "not_useful",
      reasonCategory: "missing_field",
    });
    if (notUseful.accepted !== true || notUseful.disposition !== "not_useful") fail("not_useful_rejected");

    const third = await payMorpho(client, merchant.base, dataDir);
    if (!third.capability.present) fail("third_capability_absent");
    remember(third.capability.token);

    const fourth = await payMorpho(client, merchant.base, dataDir);
    if (!fourth.capability.present) fail("fourth_capability_absent");
    remember(fourth.capability.token);
    const tampered = resign(fourth.capability.token, (claims) => claims);
    const flipped = remember(`${tampered.slice(0, -1)}${tampered.endsWith("a") ? "b" : "a"}`);
    const expired = resign(fourth.capability.token, (claims) => ({ ...claims, x: 1 }));
    const foreign = resign(fourth.capability.token, (claims) => ({ ...claims, t: "extract" }));
    const mismatched = resign(fourth.capability.token, (claims) => ({ ...claims, q: "cd".repeat(32) }));
    const identified = resign(fourth.capability.token, (claims) => ({
      ...claims,
      e: "11111111-1111-4111-8111-111111111111",
    }));
    const httpToken = remember(issueCallerResultFeedbackToken({
      key: FEEDBACK_KEY,
      eventId: "11111111-1111-4111-8111-111111111111",
      method: "GET",
      route: "/extract",
      requestDigest: "ab".repeat(32),
      responseDigest: "cd".repeat(32),
    }));
    const rejections = {};
    for (const [name, token, disposition] of [
      ["tampered", flipped, "useful"],
      ["expired", expired, "useful"],
      ["foreign_tool", foreign, "useful"],
      ["request_mismatch", mismatched, "not_useful"],
      ["client_event_identity", identified, "useful"],
      ["http_channel", httpToken, "useful"],
    ]) {
      const reported = await reportMcpCallerResult(client, { token, disposition });
      rejections[name] = reported.code;
      if (reported.accepted === true) fail(`accepted_${name}`);
    }
    const unbounded = await postMcp(merchant.base, {
      jsonrpc: "2.0",
      id: "unbounded",
      method: "tools/call",
      params: {
        name: "report_caller_result",
        arguments: {
          token: fourth.capability.token,
          disposition: "useful",
          eventId: "11111111-1111-4111-8111-111111111111",
        },
      },
    });
    const headerBlob = JSON.stringify(unbounded.headers);
    if (headerBlob.includes(fourth.capability.token)) fail("token_in_headers");
    rejections.unbounded_field = JSON.parse(unbounded.json?.result?.content?.[0]?.text || "{}").code || null;
    const httpPost = await fetch(`${merchant.base}${CALLER_RESULT_FEEDBACK_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [CALLER_RESULT_FEEDBACK_HEADER]: fourth.capability.token,
      },
      body: JSON.stringify({ disposition: "useful" }),
    });
    const httpBody = await httpPost.json();
    rejections.http_received_mcp_token = httpBody.code || null;
    if (httpPost.headers.get("link")) fail("followed_link");

    const preflight = await payTool(client, merchant.base, "opportunity_preflight", {
      rewardUsd: 10,
      hours: 1,
      hourlyCostUsd: 50,
    });
    const preflightCapability = readMcpCallerResultCapability(preflight);

    const beforeStrip = (await readLines(path.join(dataDir, MCP_DELIVERY_FILENAME))).length;
    await client.close();
    const inner = new Client({ name: "x402-mcp-strip", version: "1" });
    await inner.connect(new StreamableHTTPClientTransport(new URL(`${merchant.base}/mcp`)));
    const wrapped = new x402MCPClient(inner, {
      async handlePaymentResponse() {
        return { recovered: false };
      },
    }, { autoPayment: false });
    const unpaidStrip = await postMcp(merchant.base, {
      jsonrpc: "2.0",
      id: "strip",
      method: "tools/call",
      params: {
        name: "morpho_position",
        arguments: { address: FIXTURE_ADDRESS, shocks: [-10, -50] },
      },
    });
    const stripPayment = paymentObject({ accepts: [acceptsFrom(unpaidStrip.json)] });
    wrapped.onPaymentRequired(async () => ({ payment: stripPayment }));
    const stripped = await wrapped.callTool("morpho_position", {
      address: FIXTURE_ADDRESS,
      shocks: [-10, -50],
    });
    await inner.close();
    if (stripped.paymentMade !== true) fail("x402_payment_not_made");
    if (Object.hasOwn(stripped, "_meta")) fail("x402_client_returned_meta");
    if (JSON.stringify(stripped).includes("samedaydesk/mcp-caller-result")) fail("x402_client_saw_capability");
    const afterStrip = await waitFor(
      () => readLines(path.join(dataDir, MCP_DELIVERY_FILENAME)),
      (rows) => rows.length === beforeStrip + 1,
      "strip_delivery",
    );

    const statementsBeforeRestart = await statementLines(dataDir);
    const rotated = await readFile(path.join(dataDir, FILE_CLASSES.callerResultFeedbackRotated), "utf8")
      .then((text) => text.length > 0)
      .catch(() => false);
    const currentFeedback = await readFile(path.join(dataDir, FILE_CLASSES.callerResultFeedback), "utf8")
      .then((text) => text.length > 0)
      .catch(() => false);
    if (!rotated || !currentFeedback) fail("rotation_absent");

    const settleBeforeTransport = facilitator.calls.settle;
    const deadPort = await unusedPort();
    const dead = new Client({ name: "transport-failure", version: "1" });
    const transportFailed = await reportMcpCallerResult({
      async callTool() {
        await dead.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${deadPort}/mcp`)));
        return dead.callTool({
          name: "report_caller_result",
          arguments: { token: third.capability.token, disposition: "useful" },
        });
      },
    }, { token: third.capability.token, disposition: "useful" });
    if (transportFailed.code !== "transport_failed") fail("transport_not_truthful");
    if (facilitator.calls.settle !== settleBeforeTransport) fail("transport_retried_payment");

    logs.push(merchant.output());
    await stopChild(merchant.child);
    merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, scenarioPath });
    logs.push(merchant.output());
    client = await connectSdk(merchant.base);
    const restarted = await reportMcpCallerResult(client, {
      token: first.capability.token,
      disposition: "useful",
      reasonCategory: "matched_task",
    });
    if (restarted.idempotentReplay !== true) fail("restart_replay_failed");
    const statementsAfterRestart = await statementLines(dataDir);
    if (statementsAfterRestart.length !== statementsBeforeRestart.length) fail("restart_appended");

    const eventText = await readFile(path.join(dataDir, FILE_CLASSES.commerceEvents), "utf8");
    const mountedLedger = await readFile(path.join(dataDir, FILE_CLASSES.settlementLedger), "utf8")
      .catch((error) => (error?.code === "ENOENT" ? "" : Promise.reject(error)));
    const mountedCut = readCommerceSettlementAdmission(mountedLedger).admissionCutId;
    const mountedReconcile = await reconcileCommerceSettlementEvents(eventText, mountedLedger, {
      actorSecret: ACTOR_SECRET,
      client: receiptClient("0x" + "0".repeat(64)),
      settlementEvidenceSince: SINCE,
      treasury: TREASURY,
    });
    const mountedProspective = await readProspectiveDelivery({ dataDir, ledger: mountedLedger || "" });

    const usefulEventLine = eventText.split("\n").filter(Boolean).find((line) => {
      const row = JSON.parse(line);
      return row.id === first.delivery.paidEvidenceId;
    });
    const usefulEvent = JSON.parse(usefulEventLine);
    if (!isCanonicalMcpTypedCommerceEvent(usefulEvent)) fail("useful_event_not_canonical");
    const projectedEvent = {
      ...usefulEvent,
      route: "/mcp",
      paymentProtocol: "x402",
      settlementReference: first.delivery.settlementReference,
    };
    if (isCanonicalMcpTypedCommerceEvent(projectedEvent)) fail("projection_became_canonical");
    const projected = await reconcileCommerceSettlementEvents(`${JSON.stringify(projectedEvent)}\n`, "", {
      actorSecret: ACTOR_SECRET,
      client: receiptClient(first.delivery.settlementReference),
      settlementEvidenceSince: SINCE,
      treasury: TREASURY,
    });
    if (projected.newRecords.length !== 1) fail("projection_not_admitted");
    const deliveryLine = (await readFile(path.join(dataDir, MCP_DELIVERY_FILENAME), "utf8"))
      .split("\n")
      .filter(Boolean)
      .find((line) => JSON.parse(line).paidEvidenceId === first.delivery.paidEvidenceId);
    const feedbackLine = JSON.stringify(statementsAfterRestart.find((row) => (
      row.paidEvidenceId === first.delivery.paidEvidenceId && row.disposition === "useful" && row.channel === "mcp"
    )));
    await writeFile(path.join(projectionDir, FILE_CLASSES.commerceEvents), `${usefulEventLine}\n`);
    await writeFile(path.join(projectionDir, MCP_DELIVERY_FILENAME), `${deliveryLine}\n`);
    await writeFile(path.join(projectionDir, FILE_CLASSES.callerResultFeedback), `${feedbackLine}\n`);
    const ledgerText = `${projected.newRecords.map((row) => JSON.stringify(row)).join("\n")}\n`;
    await writeFile(path.join(projectionDir, FILE_CLASSES.settlementLedger), ledgerText);
    const retained = await retainProspectiveDeliveries({
      dataDir: projectionDir,
      settlementReferences: [first.delivery.settlementReference],
    });
    const cold = spawnSync(process.execPath, ["commerce-prospective-delivery-cold.mjs", projectionDir], {
      cwd,
      encoding: "utf8",
    });
    if (cold.status !== 0) fail("cold_reader_failed");
    const coldPacket = JSON.parse(cold.stdout);
    const secondReconcile = await reconcileCommerceSettlementEvents(`${JSON.stringify(projectedEvent)}\n`, ledgerText, {
      actorSecret: ACTOR_SECRET,
      client: receiptClient(first.delivery.settlementReference),
      settlementEvidenceSince: SINCE,
      treasury: TREASURY,
    });
    const secondCut = readCommerceSettlementAdmission(ledgerText).admissionCutId;

    const names = await readdir(dataDir);
    let journalText = "";
    for (const name of names) {
      if (!name.endsWith(".ndjson")) continue;
      journalText += await readFile(path.join(dataDir, name), "utf8");
    }
    journalText += await readFile(path.join(projectionDir, FILE_CLASSES.callerResultFeedback), "utf8");
    logs.push(merchant.output());
    if (containsSecret(journalText)) fail("token_in_journal");
    if (containsSecret(logs.join("\n"))) fail("token_in_logs");
    if (containsSecret(cold.stdout)) fail("token_in_cold");
    if (journalText.toLowerCase().includes(FIXTURE_ADDRESS.toLowerCase())) fail("address_in_journal");
    if (journalText.toLowerCase().includes(PAYER.toLowerCase())) fail("payer_in_journal");

    const summary = {
      outcome: "ready_for_receiving",
      schema: "samedaydesk.native-mcp-caller.loopback.v1",
      initialFailure: null,
      remainingContract: REMAINING_CONTRACT,
      requestedModel: "Cursor Grok 4.7 / xhigh / 256k / Fast false",
      executedModel: "grok-4.7",
      executedEffort: "absent",
      fast: false,
      runtime: process.version,
      x402McpPackage: "2.16.0",
      mcpSdkPackage: "1.30.0",
      transports: ["mcp-sdk-streamable-http", "x402-mcp-client", "post-mcp"],
      counts: {
        morphoPaid: 5,
        preflightPaid: 1,
        facilitatorSettles: facilitator.calls.settle,
        statements: statementsAfterRestart.length,
        declaredUseful: statementsAfterRestart.filter((row) => row.disposition === "useful").length,
        declaredNotUseful: statementsAfterRestart.filter((row) => row.disposition === "not_useful").length,
        absentPurchases: 4,
        deliveries: afterStrip.length,
      },
      controls: {
        useful: useful.accepted === true,
        notUseful: notUseful.accepted === true,
        absentRetained: !(await statementLines(dataDir)).some((row) => (
          row.paidEvidenceId === third.delivery.paidEvidenceId || row.paidEvidenceId === fourth.delivery.paidEvidenceId
        )),
        duplicateReplay: replay.idempotentReplay === true,
        conflictRetainsUseful: conflict.retainedDisposition === "useful",
        rejections,
        rotation: rotated === true,
        transportFailed: transportFailed.code,
        transportSettleUnchanged: facilitator.calls.settle === settleBeforeTransport,
        restartReplay: restarted.idempotentReplay === true,
        x402ClientOmitsMeta: Object.hasOwn(stripped, "_meta") === false,
        preflightCapability: preflightCapability.present,
        headerRedacted: headerBlob.includes(fourth.capability.token) === false,
        mountedEligible: mountedReconcile.eligibleSettlementReferences,
        mountedNewRecords: mountedReconcile.newRecords.length,
        mountedCutStable: emptyCut === mountedCut,
        mountedDeclaredUseful: mountedProspective.declaredFeedback?.declared_useful || 0,
        projectionAdmitted: projected.newRecords.length,
        projectionDeclaredUseful: coldPacket.declaredFeedback?.declared_useful || 0,
        projectionChannel: retained.records?.[0]?.channel || null,
        secondNewRecords: secondReconcile.newRecords.length,
        secondAlreadyReconciled: secondReconcile.alreadyReconciled,
        secondCutStable: secondCut === readCommerceSettlementAdmission(ledgerText).admissionCutId,
        persistedEventCanonical: isCanonicalMcpTypedCommerceEvent(usefulEvent),
        projectedEventCanonical: isCanonicalMcpTypedCommerceEvent(projectedEvent),
      },
    };
    const encoded = JSON.stringify(summary);
    if (containsSecret(encoded) || encoded.includes("eyJ") || encoded.includes("http://") || encoded.includes("https://")) {
      fail("summary_leaked");
    }
    if (summary.controls.rejections.tampered !== "tampered_capability") fail("tampered_code");
    if (summary.controls.rejections.expired !== "expired_capability") fail("expired_code");
    if (summary.controls.rejections.foreign_tool !== "foreign_tool") fail("foreign_code");
    if (summary.controls.rejections.request_mismatch !== "request_mismatch") fail("request_code");
    if (summary.controls.rejections.client_event_identity !== "tampered_capability") fail("identity_code");
    if (summary.controls.rejections.http_channel !== "channel_rejected") fail("channel_code");
    if (summary.controls.rejections.unbounded_field !== "unbounded_field") fail("unbounded_code");
    if (summary.controls.rejections.http_received_mcp_token !== "tampered_capability") fail("http_code");
    if (summary.controls.preflightCapability !== false) fail("preflight_capability");
    if (summary.controls.mountedEligible !== 0 || summary.controls.mountedNewRecords !== 0) fail("mounted_parent_moved");
    if (summary.controls.mountedCutStable !== true) fail("mounted_cut_moved");
    if (summary.controls.mountedDeclaredUseful !== 0) fail("mounted_feedback_inferred");
    if (summary.controls.projectionDeclaredUseful !== 1) fail("projection_not_bound");
    if (summary.controls.secondNewRecords !== 0 || summary.controls.secondAlreadyReconciled !== 1) fail("second_cut_moved");
    if (summary.counts.declaredUseful !== 1 || summary.counts.declaredNotUseful !== 1) fail("statement_counts");
    if (summary.counts.statements !== 2) fail("statement_total");
    if (summary.controls.absentRetained !== true) fail("absence_recorded");
    process.stdout.write(`${encoded}\n`);
  } finally {
    try { await client?.close(); } catch { /* closed with the server */ }
    await stopChild(merchant?.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
    await rm(projectionDir, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  const raw = String(error?.code || error?.message || "loopback_failed");
  const safe = secrets.reduce((text, secret) => text.split(secret).join("[redacted]"), raw).slice(0, 180);
  process.stdout.write(`${JSON.stringify({
    outcome: "no-fit",
    initialFailure: safe,
    remainingContract: REMAINING_CONTRACT,
  })}\n`);
  process.exit(1);
}
