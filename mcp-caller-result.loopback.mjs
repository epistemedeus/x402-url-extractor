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
import {
  PROSPECTIVE_FILENAME,
  bindStoredCallerResultFeedback,
  readProspectiveDelivery,
  retainProspectiveDeliveries,
} from "./commerce-prospective-delivery.mjs";
import {
  BASE_USDC,
  createCommerceSettlementReconciler,
  readCommerceSettlementAdmission,
  reconcileCommerceSettlementEvents,
} from "./commerce-settlement-reconciler.mjs";
import { digestMcpPayload } from "./http-delivery-evidence/digest.mjs";
import { FIXTURE_ADDRESS } from "./experiments/morpho-useful-delivery-1005/fixture.mjs";
import { MCP_DELIVERY_FILENAME } from "./http-delivery-evidence/mcp-delivery.mjs";
import { FILE_CLASSES } from "./ordinary-delivery-join.mjs";
import { bindPaidMcpCallerResult, reportMcpCallerResult } from "./mcp-caller-result.mjs";

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
const WRONG_ASSET = "0x1111111111111111111111111111111111111111";
const WRONG_PAYEE = "0x2222222222222222222222222222222222222222";

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
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        let amount = null;
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          const candidate = parsed?.paymentRequirements?.amount;
          if (typeof candidate === "string" && /^[1-9]\d{0,77}$/.test(candidate)) amount = candidate;
        } catch {
          amount = null;
        }
        send(200, {
          success: true,
          payer: PAYER,
          transaction: `0x${sequence.toString(16).padStart(64, "0")}`,
          network: NETWORK,
          ...(amount ? { amount } : {}),
        });
      });
      return;
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

async function openPaidClient(base) {
  const sdk = new Client({ name: "native-mcp-caller", version: "1" });
  await sdk.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  const wrapped = new x402MCPClient(sdk, {
    async handlePaymentResponse() {
      return { recovered: false };
    },
  }, { autoPayment: false });
  let pendingPayment = null;
  wrapped.onPaymentRequired(async () => (pendingPayment ? { payment: pendingPayment } : undefined));
  const paid = bindPaidMcpCallerResult(wrapped);
  return {
    sdk,
    paid,
    arm(payment) {
      pendingPayment = payment;
    },
    close: () => sdk.close(),
  };
}

function toolText(result) {
  const text = result?.content?.[0]?.text;
  return typeof text === "string" ? text : "";
}

async function payMorpho(session, base, dataDir) {
  const before = (await readLines(path.join(dataDir, MCP_DELIVERY_FILENAME)))
    .filter((row) => row.tool === "morpho_position" && row.settlementState === "succeeded").length;
  const unpaid = await postMcp(base, {
    jsonrpc: "2.0",
    id: randomBytes(4).toString("hex"),
    method: "tools/call",
    params: {
      name: "morpho_position",
      arguments: { address: FIXTURE_ADDRESS, shocks: [-10, -50] },
    },
  });
  const accepted = acceptsFrom(unpaid.json);
  if (!accepted) fail("challenge_missing_morpho_position");
  if (accepted.amount !== "20000") fail("amount_morpho_position");
  session.arm(paymentObject({ accepts: [accepted] }));
  const paid = await session.paid.pay("morpho_position", {
    address: FIXTURE_ADDRESS,
    shocks: [-10, -50],
  });
  if (paid.paymentMade !== true) fail("payment_not_made");
  if (paid.returnedCapability !== false) fail("wrapper_returned_capability");
  if (!paid.capability?.present) fail("hook_capability_absent");
  remember(paid.capability.token);
  const text = toolText(paid);
  if (text.includes(paid.capability.token)) fail("token_in_content");
  const digest = digestMcpPayload(Buffer.from(text, "utf8"));
  const rows = await waitFor(
    () => readLines(path.join(dataDir, MCP_DELIVERY_FILENAME)),
    (found) => found.filter((row) => row.tool === "morpho_position" && row.settlementState === "succeeded").length >= before + 1,
    "delivery",
  );
  const delivery = rows.filter((row) => row.tool === "morpho_position" && row.settlementState === "succeeded").at(-1);
  if (delivery.responseDigest !== digest) fail("digest_mismatch");
  if (delivery.usefulness !== "unknown") fail("delivery_usefulness");
  const events = await waitFor(
    () => readLines(path.join(dataDir, FILE_CLASSES.commerceEvents)),
    (found) => found.some((row) => row.id === delivery.paidEvidenceId),
    "typed_event",
  );
  const event = events.find((row) => row.id === delivery.paidEvidenceId);
  if (!event?.settlementReference) fail("event_reference_absent");
  if (!isCanonicalMcpTypedCommerceEvent(event)) fail("event_not_canonical");
  if (event.chainTruth !== false || event.accounting !== false || event.revenue !== false) fail("event_money_flags");
  if (event.route !== "/mcp" || event.paymentProtocol !== "x402") fail("event_route");
  if (event.settlementReference !== String(delivery.settlementReference).toLowerCase()) fail("event_reference");
  if (event.settlementAmountAtomic !== "20000") fail("event_amount");
  return { paid, text, digest, delivery, event, capability: paid.capability };
}

async function payPreflight(session, base, dataDir) {
  const args = { rewardUsd: 10, hours: 1, hourlyCostUsd: 50 };
  let probeCode = null;
  try {
    await session.paid.pay("opportunity_preflight", args);
    probeCode = "probe_succeeded";
  } catch (error) {
    probeCode = error?.code === -32602 ? "output_schema_rejected_challenge" : "probe_failed";
  }
  if (probeCode !== "output_schema_rejected_challenge") fail("schema_probe");
  const unpaid = await postMcp(base, {
    jsonrpc: "2.0",
    id: randomBytes(4).toString("hex"),
    method: "tools/call",
    params: { name: "opportunity_preflight", arguments: args },
  });
  const accepted = acceptsFrom(unpaid.json);
  if (!accepted) fail("challenge_missing_preflight");
  const paid = await session.paid.payWithPayment("opportunity_preflight", args, paymentObject({ accepts: [accepted] }));
  if (paid.paymentMade !== true) fail("preflight_payment_not_made");
  if (paid.returnedCapability !== false || paid.capability.present !== false) fail("preflight_capability");
  const events = await waitFor(
    () => readLines(path.join(dataDir, FILE_CLASSES.commerceEvents)),
    (found) => found.some((row) => (
      row.binding?.tool === "opportunity_preflight"
      && row.result === "paid_success"
      && row.settlementReference
    )),
    "preflight_event",
  );
  const event = events.find((row) => row.binding?.tool === "opportunity_preflight" && row.result === "paid_success");
  if (!isCanonicalMcpTypedCommerceEvent(event)) fail("preflight_event_shape");
  if (event.chainTruth !== false || event.settlementAmountAtomic !== "50000") fail("preflight_amount");
  return { ...paid, probeCode, event };
}

function receiptFor(specs) {
  const byHash = new Map(specs.map((spec) => [String(spec.hash).toLowerCase(), spec]));
  return {
    async getTransactionReceipt({ hash }) {
      const spec = byHash.get(String(hash).toLowerCase());
      if (!spec || spec.refuse === true) throw new Error("unavailable");
      return {
        status: "success",
        blockNumber: 1n,
        logs: [{
          address: getAddress(spec.asset || BASE_USDC),
          topics: encodeEventTopics({
            abi: [TRANSFER],
            eventName: "Transfer",
            args: { from: getAddress(PAYER), to: getAddress(spec.to || TREASURY) },
          }),
          data: encodeAbiParameters([{ type: "uint256" }], [spec.amount || 20000n]),
        }],
      };
    },
    async getBlock() {
      return { timestamp: 1_760_000_000n };
    },
  };
}

function reconcileWith(events, ledger, specs) {
  return reconcileCommerceSettlementEvents(events, ledger, {
    actorSecret: ACTOR_SECRET,
    asset: BASE_USDC,
    client: receiptFor(specs),
    network: NETWORK,
    settlementEvidenceSince: SINCE,
    treasury: TREASURY,
  });
}

function hasIssue(result, code) {
  return (result.issues || []).some((issue) => issue.code === code);
}

async function statementLines(dataDir) {
  const current = await readLines(path.join(dataDir, FILE_CLASSES.callerResultFeedback)).catch(() => []);
  const rotated = await readLines(path.join(dataDir, FILE_CLASSES.callerResultFeedbackRotated)).catch(() => []);
  return [...rotated, ...current];
}

function containsSecret(text) {
  return secrets.some((secret) => text.includes(secret));
}

async function feedbackText(dataDir) {
  const names = await readdir(dataDir);
  let journalText = "";
  for (const name of names) {
    if (!name.endsWith(".ndjson")) continue;
    journalText += await readFile(path.join(dataDir, name), "utf8");
  }
  return journalText;
}

async function main() {
  const dataDir = await mkdtemp(path.join(tmpdir(), "mcp-caller-"));
  const scenarioPath = path.join(dataDir, "scenario.txt");
  const ledgerPath = path.join(dataDir, FILE_CLASSES.settlementLedger);
  await writeFile(scenarioPath, "snapshot\n", "utf8");
  const facilitator = await startFakeFacilitator();
  let merchant = null;
  let session = null;
  const logs = [];
  try {
    merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, scenarioPath });
    logs.push(merchant.output());
    session = await openPaidClient(merchant.base);
    const listed = await session.sdk.listTools();
    if (!listed.tools.some((tool) => tool.name === "report_caller_result")) fail("free_tool_absent");
    if (!listed.tools.some((tool) => tool.name === "morpho_position")) fail("morpho_tool_absent");

    const first = await payMorpho(session, merchant.base, dataDir);
    const useful = await session.paid.report({
      token: first.capability.token,
      disposition: "useful",
      reasonCategory: "matched_task",
    });
    if (useful.accepted !== true || useful.bound !== false || useful.parent !== "pending" || useful.disposition !== "useful") {
      fail("useful_not_pending");
    }
    const replay = await session.paid.report({
      token: first.capability.token,
      disposition: "useful",
      reasonCategory: "matched_task",
    });
    if (replay.idempotentReplay !== true || replay.bound !== false || replay.parent !== "pending") fail("duplicate_rejected");
    const conflict = await session.paid.report({
      token: first.capability.token,
      disposition: "not_useful",
      reasonCategory: "missing_field",
    });
    if (conflict.code !== "conflicting_statement" || conflict.retainedDisposition !== "useful" || conflict.bound !== false) {
      fail("conflict_lost");
    }

    const second = await payMorpho(session, merchant.base, dataDir);
    const notUseful = await session.paid.report({
      token: second.capability.token,
      disposition: "not_useful",
      reasonCategory: "missing_field",
    });
    if (notUseful.accepted !== true || notUseful.bound !== false || notUseful.parent !== "pending" || notUseful.disposition !== "not_useful") {
      fail("not_useful_rejected");
    }

    const third = await payMorpho(session, merchant.base, dataDir);
    const fourth = await payMorpho(session, merchant.base, dataDir);
    const tampered = resign(fourth.capability.token, (claims) => claims);
    const dot = tampered.indexOf(".");
    const signature = tampered.slice(dot + 1);
    const flipped = remember(`${tampered.slice(0, dot + 1)}${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`);
    const expired = resign(fourth.capability.token, (claims) => ({ ...claims, x: 1 }));
    const foreign = resign(fourth.capability.token, (claims) => ({ ...claims, t: "extract" }));
    const foreignOffer = resign(fourth.capability.token, (claims) => ({ ...claims, o: "ef".repeat(32) }));
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
      ["foreign_offer", foreignOffer, "useful"],
      ["request_mismatch", mismatched, "not_useful"],
      ["client_event_identity", identified, "useful"],
      ["http_channel", httpToken, "useful"],
    ]) {
      const reported = await session.paid.report({ token, disposition });
      rejections[name] = reported.code;
      if (reported.accepted === true || reported.bound === true) fail(`accepted_${name}`);
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
    if (Object.hasOwn(httpBody, "parent")) fail("http_parent_field");
    if (httpBody.bound !== false) fail("http_bound");
    if (httpPost.headers.get("link")) fail("followed_link");

    const preflight = await payPreflight(session, merchant.base, dataDir);
    const settleAfterPurchase = facilitator.calls.settle;
    const ledgerBefore = await readFile(ledgerPath, "utf8").catch((error) => (
      error?.code === "ENOENT" ? "" : Promise.reject(error)
    ));
    if (ledgerBefore.length > 0) fail("ledger_before_reconcile");
    const beforeParent = await readProspectiveDelivery({ dataDir, ledger: ledgerBefore });
    if ((beforeParent.declaredFeedback?.declared_useful || 0) !== 0) fail("useful_before_parent");

    const eventText = await readFile(path.join(dataDir, FILE_CLASSES.commerceEvents), "utf8");
    const reference = first.event.settlementReference;
    const amountMismatch = await reconcileWith(`${JSON.stringify(first.event)}\n`, "", [{ hash: reference, amount: 1n }]);
    const networkEvent = { ...first.event, settlementNetwork: "eip155:1" };
    const networkMismatch = await reconcileWith(`${JSON.stringify(networkEvent)}\n`, "", [{ hash: reference }]);
    const assetMismatch = await reconcileWith(`${JSON.stringify(first.event)}\n`, "", [{ hash: reference, asset: WRONG_ASSET }]);
    const payeeMismatch = await reconcileWith(`${JSON.stringify(first.event)}\n`, "", [{ hash: reference, to: WRONG_PAYEE }]);
    const txOnly = await reconcileWith(`${JSON.stringify({
      result: "paid_success",
      ts: first.event.ts,
      settlementReference: `0x${"c".repeat(64)}`,
    })}\n`, "", [{ hash: `0x${"c".repeat(64)}`, refuse: true }]);
    if (amountMismatch.newRecords.length !== 0 || !hasIssue(amountMismatch, "response_amount_mismatch")) fail("amount_mismatch_admitted");
    if (networkMismatch.newRecords.length !== 0 || !hasIssue(networkMismatch, "response_network_mismatch")) fail("network_mismatch_admitted");
    if (assetMismatch.newRecords.length !== 0 || !hasIssue(assetMismatch, "treasury_transfer_count_mismatch")) fail("asset_mismatch_admitted");
    if (payeeMismatch.newRecords.length !== 0 || !hasIssue(payeeMismatch, "treasury_transfer_count_mismatch")) fail("payee_mismatch_admitted");
    if (txOnly.newRecords.length !== 0 || !hasIssue(txOnly, "receipt_unavailable")) fail("tx_only_admitted");
    if ((await readFile(ledgerPath, "utf8").catch((error) => (error?.code === "ENOENT" ? "" : Promise.reject(error)))).length > 0) {
      fail("refusal_wrote_ledger");
    }

    const paidEvents = eventText.split("\n").filter(Boolean).map((line) => JSON.parse(line))
      .filter((row) => row.result === "paid_success" && typeof row.settlementReference === "string");
    const refusedReference = fourth.event.settlementReference;
    const specs = paidEvents.map((row) => ({
      hash: row.settlementReference,
      amount: BigInt(row.settlementAmountAtomic),
      refuse: row.settlementReference === refusedReference,
    }));
    const admittedEvents = paidEvents.filter((row) => row.settlementReference !== refusedReference);
    const expectedAmount = admittedEvents.reduce((sum, row) => sum + BigInt(row.settlementAmountAtomic), 0n);
    const reconciler = createCommerceSettlementReconciler({
      actorSecret: ACTOR_SECRET,
      client: receiptFor(specs),
      dataDir,
      network: NETWORK,
      settlementEvidenceSince: SINCE,
      treasury: TREASURY,
    });
    const admitted = await reconciler.reconcile();
    const expectedAdmitted = admittedEvents.length;
    if (admitted.ledger.reconciledSettlements !== expectedAdmitted) fail("parent_admitted_count");
    if (admitted.ledger.amountAtomic !== String(expectedAmount)) fail("parent_amount");
    if ((admitted.issues?.receipt_unavailable || 0) < 1) fail("receipt_not_refused");
    if (admitted.lastScan.reconciledThisRun !== expectedAdmitted) fail("reconciled_count");
    const originalLedger = await readFile(ledgerPath, "utf8");
    const admissionCut = readCommerceSettlementAdmission(originalLedger).admissionCutId;
    const afterParent = await readProspectiveDelivery({ dataDir, ledger: originalLedger });
    if ((afterParent.declaredFeedback?.declared_useful || 0) > 1) fail("useful_after_parent");

    const prospectivePath = path.join(dataDir, PROSPECTIVE_FILENAME);
    const originalProspective = await readFile(prospectivePath, "utf8").catch((error) => (
      error?.code === "ENOENT" ? "" : Promise.reject(error)
    ));
    const changedRows = originalLedger.trim().split("\n").map((line) => JSON.parse(line));
    const changedTarget = changedRows.find((row) => row.sourceEventId === first.event.id);
    if (!changedTarget) fail("parent_row_missing");
    changedTarget.amountAtomic = "1";
    await rm(prospectivePath, { force: true });
    await writeFile(ledgerPath, `${changedRows.map((row) => JSON.stringify(row)).join("\n")}\n`);
    const changed = await session.paid.report({
      token: first.capability.token,
      disposition: "useful",
      reasonCategory: "matched_task",
    });
    if (changed.accepted !== true || changed.bound !== false || changed.parent !== "unbound" || changed.idempotentReplay !== true) {
      fail("changed_parent_bound");
    }
    await retainProspectiveDeliveries({
      dataDir,
      settlementReferences: [first.event.settlementReference],
    });
    const changedView = await readProspectiveDelivery({
      dataDir,
      ledger: await readFile(ledgerPath, "utf8"),
    });
    if ((changedView.declaredFeedback?.declared_useful || 0) !== 0 || (changedView.declaredFeedback?.declared_not_useful || 0) !== 0) {
      fail("changed_parent_advanced");
    }
    await writeFile(ledgerPath, originalLedger);
    if (originalProspective) await writeFile(prospectivePath, originalProspective, { mode: 0o600 });
    else await rm(prospectivePath, { force: true });

    const boundReplay = await session.paid.report({
      token: first.capability.token,
      disposition: "useful",
      reasonCategory: "matched_task",
    });
    if (boundReplay.accepted !== true || boundReplay.bound !== true || boundReplay.parent !== "bound" || boundReplay.idempotentReplay !== true) {
      fail("parent_not_bound");
    }
    const notUsefulBound = await session.paid.report({
      token: second.capability.token,
      disposition: "not_useful",
      reasonCategory: "missing_field",
    });
    if (notUsefulBound.bound !== true || notUsefulBound.parent !== "bound" || notUsefulBound.idempotentReplay !== true) {
      fail("not_useful_not_bound");
    }
    const [concurrentLeft, concurrentRight] = await Promise.all([
      session.paid.report({
        token: first.capability.token,
        disposition: "useful",
        reasonCategory: "matched_task",
      }),
      session.paid.report({
        token: first.capability.token,
        disposition: "useful",
        reasonCategory: "matched_task",
      }),
    ]);
    if (concurrentLeft.idempotentReplay !== true || concurrentRight.idempotentReplay !== true) fail("concurrent_replay");
    if (concurrentLeft.bound !== true || concurrentRight.bound !== true) fail("concurrent_unbound");
    if (facilitator.calls.settle !== settleAfterPurchase) fail("report_retried_payment");

    await bindStoredCallerResultFeedback(dataDir);
    const prospectiveRows = await readLines(path.join(dataDir, PROSPECTIVE_FILENAME));
    const usefulObservation = prospectiveRows.find((row) => row.feedback === "declared_useful");
    const notUsefulObservation = prospectiveRows.find((row) => row.feedback === "declared_not_useful");
    if (usefulObservation?.channel !== "mcp" || usefulObservation.feedbackSeal !== "binds_declaration") fail("useful_channel");
    if (notUsefulObservation?.channel !== "mcp") fail("not_useful_channel");
    const cold = spawnSync(process.execPath, ["commerce-prospective-delivery-cold.mjs", dataDir], {
      cwd,
      encoding: "utf8",
    });
    if (cold.status !== 0) fail("cold_reader_failed");
    const coldPacket = JSON.parse(cold.stdout);
    if (coldPacket.declaredFeedback?.declared_useful !== 1) fail("cold_useful");
    if (coldPacket.declaredFeedback?.declared_not_useful !== 1) fail("cold_not_useful");
    const secondReconcile = await reconciler.reconcile();
    const secondLedger = await readFile(ledgerPath, "utf8");
    const secondCut = readCommerceSettlementAdmission(secondLedger).admissionCutId;
    if (secondReconcile.lastScan.reconciledThisRun !== 0 || secondCut !== admissionCut) fail("second_cut_moved");

    await rm(ledgerPath);
    const missing = await session.paid.report({
      token: first.capability.token,
      disposition: "useful",
      reasonCategory: "matched_task",
    });
    if (missing.accepted !== true || missing.bound !== false || missing.parent !== "pending" || missing.idempotentReplay !== true) {
      fail("missing_parent_bound");
    }
    await writeFile(ledgerPath, originalLedger);

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
    const transportFailed = await reportMcpCallerResult({
      async callTool() {
        const dead = new Client({ name: "transport-failure", version: "1" });
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
    await session.close().catch(() => {});
    session = null;
    await stopChild(merchant.child);
    merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, scenarioPath });
    logs.push(merchant.output());
    session = await openPaidClient(merchant.base);
    const restarted = await session.paid.report({
      token: first.capability.token,
      disposition: "useful",
      reasonCategory: "matched_task",
    });
    if (restarted.idempotentReplay !== true || restarted.bound !== true || restarted.parent !== "bound") fail("restart_replay_failed");
    const statementsAfterRestart = await statementLines(dataDir);
    if (statementsAfterRestart.length !== statementsBeforeRestart.length) fail("restart_appended");

    const journalText = await feedbackText(dataDir);
    logs.push(merchant.output());
    if (containsSecret(journalText)) fail("token_in_journal");
    if (containsSecret(logs.join("\n"))) fail("token_in_logs");
    if (containsSecret(cold.stdout)) fail("token_in_cold");
    if (journalText.toLowerCase().includes(FIXTURE_ADDRESS.toLowerCase())) fail("address_in_journal");
    if (journalText.toLowerCase().includes(PAYER.toLowerCase())) fail("payer_in_journal");

    const summary = {
      outcome: "ready_for_receiving",
      schema: "samedaydesk.native-mcp-completion.loopback.v1",
      initialFailure: null,
      remainingContract: null,
      requestedModel: "Cursor Grok 4.7 / xhigh / 256k / Fast false",
      executedModel: "grok-4.7",
      executedEffort: "absent",
      fast: false,
      runtime: process.version,
      x402McpPackage: "2.16.0",
      mcpSdkPackage: "1.30.0",
      transports: ["x402-mcp-client-callTool", "x402-mcp-callToolWithPayment", "x402-mcp-onAfterPayment", "mcp-sdk-streamable-http", "post-mcp"],
      counts: {
        morphoPaid: 4,
        preflightPaid: preflight.paymentMade === true ? 1 : 0,
        facilitatorSettles: facilitator.calls.settle,
        parentAdmitted: admitted.ledger.reconciledSettlements,
        parentAmountAtomic: admitted.ledger.amountAtomic,
        statements: statementsAfterRestart.length,
        declaredUseful: statementsAfterRestart.filter((row) => row.disposition === "useful").length,
        declaredNotUseful: statementsAfterRestart.filter((row) => row.disposition === "not_useful").length,
        absentPurchases: 3,
        deliveries: 4,
      },
      controls: {
        usefulPending: useful.parent === "pending" && useful.bound === false,
        usefulBound: boundReplay.parent === "bound" && boundReplay.bound === true,
        notUsefulBound: notUsefulBound.parent === "bound",
        absentRetained: !statementsAfterRestart.some((row) => (
          row.paidEvidenceId === third.delivery.paidEvidenceId || row.paidEvidenceId === fourth.delivery.paidEvidenceId
        )),
        duplicateReplay: replay.idempotentReplay === true,
        conflictRetainsUseful: conflict.retainedDisposition === "useful",
        rejections,
        parentChangedUnbound: changed.parent === "unbound",
        parentMissingPending: missing.parent === "pending",
        receiptRefused: (admitted.issues?.receipt_unavailable || 0) > 0,
        amountMismatchNewRecords: amountMismatch.newRecords.length,
        networkMismatchNewRecords: networkMismatch.newRecords.length,
        assetMismatchNewRecords: assetMismatch.newRecords.length,
        payeeMismatchNewRecords: payeeMismatch.newRecords.length,
        txOnlyNewRecords: txOnly.newRecords.length,
        ledgerAbsentBeforeReconcile: true,
        chainTruth: false,
        rotation: rotated === true,
        transportFailed: transportFailed.code,
        transportSettleUnchanged: true,
        reportSettleUnchanged: facilitator.calls.settle === settleAfterPurchase,
        restartReplay: restarted.parent === "bound",
        concurrentReplay: concurrentLeft.idempotentReplay === true && concurrentRight.idempotentReplay === true,
        wrapperReturnedCapability: false,
        hookRetainsCapability: true,
        preflightCapability: false,
        outputSchemaProbe: preflight.probeCode,
        headerRedacted: true,
        httpParentField: false,
        coldDeclaredUseful: coldPacket.declaredFeedback?.declared_useful || 0,
        coldDeclaredNotUseful: coldPacket.declaredFeedback?.declared_not_useful || 0,
        coldChannelMcp: usefulObservation.channel === "mcp",
        secondNewRecords: secondReconcile.lastScan.reconciledThisRun,
        secondCutStable: secondCut === admissionCut,
      },
    };
    const encoded = JSON.stringify(summary);
    if (containsSecret(encoded) || encoded.includes("eyJ") || encoded.includes("http://") || encoded.includes("https://")) {
      fail("summary_leaked");
    }
    if (summary.controls.rejections.tampered !== "tampered_capability") fail("tampered_code");
    if (summary.controls.rejections.expired !== "expired_capability") fail("expired_code");
    if (summary.controls.rejections.foreign_tool !== "foreign_tool") fail("foreign_code");
    if (summary.controls.rejections.foreign_offer !== "foreign_offer") fail("offer_code");
    if (summary.controls.rejections.request_mismatch !== "request_mismatch") fail("request_code");
    if (summary.controls.rejections.client_event_identity !== "tampered_capability") fail("identity_code");
    if (summary.controls.rejections.http_channel !== "channel_rejected") fail("channel_code");
    if (summary.controls.rejections.unbounded_field !== "unbounded_field") fail("unbounded_code");
    if (summary.controls.rejections.http_received_mcp_token !== "tampered_capability") fail("http_code");
    if (summary.controls.coldDeclaredUseful !== 1 || summary.controls.coldDeclaredNotUseful !== 1) fail("cold_counts");
    if (summary.counts.declaredUseful !== 1 || summary.counts.declaredNotUseful !== 1 || summary.counts.statements !== 2) {
      fail("statement_counts");
    }
    if (summary.controls.absentRetained !== true) fail("absence_recorded");
    if (summary.counts.facilitatorSettles !== 5) fail("settle_count");
    process.stdout.write(`${encoded}\n`);
  } finally {
    try { await session?.close(); } catch { /* closed with the server */ }
    await stopChild(merchant?.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
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
    remainingContract: null,
  })}\n`);
  process.exit(1);
}
