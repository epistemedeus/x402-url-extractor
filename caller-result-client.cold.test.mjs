import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { encodeAbiParameters, encodeEventTopics, getAddress, parseAbiItem } from "viem";

import { issueCallerResultFeedbackToken, issueMcpCallerResultFeedbackToken } from "./caller-result-feedback.mjs";
import {
  BASE_USDC,
  createCommerceSettlementReconciler,
} from "./commerce-settlement-reconciler.mjs";
import { FIXTURE_ADDRESS } from "./experiments/morpho-useful-delivery-1005/fixture.mjs";
import { digestMcpCallId, digestMcpPayload } from "./http-delivery-evidence/digest.mjs";
import { MCP_MORPHO_RESOURCE, MCP_MORPHO_TOOL } from "./http-delivery-evidence/mcp-delivery.mjs";
import { createDeliveryObservation } from "./http-delivery-evidence/observation.mjs";
import { FILE_CLASSES } from "./ordinary-delivery-join.mjs";
import { loadPublicAcquisition } from "./public-acquisition/engine.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const PAYER = `0x${"2".repeat(40)}`;
const TREASURY = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
const NETWORK = "eip155:8453";
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const committedManifest = path.join(cwd, "caller-result-client/export/public/manifest.json");

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
  const calls = { settle: 0 };
  let sequence = 0;
  const server = createHttpServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && req.url === "/supported") {
      return send(200, { kinds: [{ network: NETWORK, scheme: "exact", x402Version: 2 }], extensions: [], signers: {} });
    }
    if (req.method === "POST" && req.url === "/verify") return send(200, { isValid: true, payer: PAYER });
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
        } catch { amount = null; }
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

async function startMerchant({ dataDir, facilitatorUrl, feedbackKey, actorSecret }) {
  const preloadPath = path.join(dataDir, "morpho-fetch-hook.mjs");
  const fixtureHref = pathToFileURL(path.join(cwd, "experiments/morpho-useful-delivery-1005/fixture.mjs")).href;
  await writeFile(preloadPath, `
import { graphqlPage, FREE_INDEX_ITEM } from ${JSON.stringify(fixtureHref)};
const original = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const raw = typeof input === "string" || input instanceof URL ? String(input) : String(input?.url || "");
  let host = "";
  try { host = new URL(raw).hostname; } catch { host = ""; }
  if (host === "127.0.0.1" || host === "localhost") return original(input, init);
  if (raw.includes("api.morpho.org/graphql")) {
    return { ok: true, status: 200, json: async () => graphqlPage(FREE_INDEX_ITEM, { count: 1, countTotal: 1, limit: 100, skip: 0 }) };
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
      COMMERCE_ACTOR_SECRET: actorSecret,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      CALLER_RESULT_FEEDBACK_KEY: feedbackKey,
      FACILITATOR: "xpay",
      FACILITATOR_URL: facilitatorUrl,
      MPP_SECRET_KEY: "",
      PUBLIC_URL: "https://agents.samedaydesk.com",
      HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS: "simulated",
      NODE_OPTIONS: `--import=${pathToFileURL(preloadPath).href}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup_timeout\n${output.slice(-1000)}`)), 45_000);
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
      reject(new Error(`startup_exited\n${output.slice(-1000)}`));
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return { base: `http://127.0.0.1:${port}`, child, output: () => output };
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

function receiptFor(specs) {
  const byHash = new Map(specs.map((spec) => [String(spec.hash).toLowerCase(), spec]));
  return {
    async getTransactionReceipt({ hash }) {
      const spec = byHash.get(String(hash).toLowerCase());
      if (!spec) throw new Error("unavailable");
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
          data: encodeAbiParameters([{ type: "uint256" }], [spec.amount]),
        }],
      };
    },
    async getBlock() {
      return { timestamp: 1760000000n };
    },
  };
}

function observation() {
  const payload = Buffer.from('{"ok":true}', "utf8");
  return createDeliveryObservation({
    source: "mcp_tool_result",
    responseDigest: digestMcpPayload(payload),
    responseByteLength: payload.length,
    tool: MCP_MORPHO_TOOL,
    productSku: "samedaydesk-morpho-position",
    resource: MCP_MORPHO_RESOURCE,
    issuedOfferDigest: "ab".repeat(32),
    callId: "7",
    callDigest: digestMcpCallId("7"),
    settlementReference: `0x${"a".repeat(64)}`,
    applicationIsError: false,
    payload,
  });
}

function resign(token, key, mutate) {
  const dot = token.indexOf(".");
  const claims = JSON.parse(Buffer.from(token.slice(0, dot), "base64url").toString("utf8"));
  const payload = Buffer.from(JSON.stringify(mutate(claims)));
  const mac = createHmac("sha256", key).update(payload).digest();
  return `${payload.toString("base64url")}.${mac.toString("base64url")}`;
}

test("installed caller consumer reaches the mounted parent without merchant source", { timeout: 300_000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "caller-result-cold-"));
  const work = path.join(root, "consumer");
  const signalDir = path.join(root, "signals");
  const dataDir = path.join(root, "data");
  await mkdir(work);
  await mkdir(signalDir);
  await mkdir(dataDir);
  const packed = spawnSync(process.execPath, ["caller-result-client/export/pack.mjs", path.join(root, "packet")], {
    cwd,
    encoding: "utf8",
  });
  assert.equal(packed.status, 0, packed.stderr);
  const fresh = JSON.parse(packed.stdout);
  const loaded = loadPublicAcquisition({
    manifestPath: path.join(root, "packet/manifest.json"),
    bytesRoot: path.join(root, "packet/bytes"),
  });
  assert.equal(loaded.document.draft, true);
  assert.equal(loaded.document.hostedAcquisitionVerified, false);
  const committed = JSON.parse(await readFile(committedManifest, "utf8"));
  const committedArchive = committed.assets.find((asset) => asset.role === "archive");
  assert.equal(committedArchive.sha256, fresh.archiveSha256);
  const archive = loaded.files.get("samedaydesk-caller-result/0.1.0/samedaydesk-caller-result-0.1.0.tar.gz");
  await writeFile(path.join(root, "archive.tar.gz"), archive.bytes);
  const unpacked = spawnSync("tar", ["-xzf", path.join(root, "archive.tar.gz"), "-C", work], { encoding: "utf8" });
  assert.equal(unpacked.status, 0, unpacked.stderr);
  const packageTests = spawnSync(process.execPath, ["--test", "test/client.test.mjs"], {
    cwd: work,
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
  assert.equal(packageTests.status, 0, `${packageTests.stdout}\n${packageTests.stderr}`);
  const installed = spawnSync("npm", ["ci", "--ignore-scripts"], {
    cwd: work,
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: process.env.HOME, npm_config_fund: "false", npm_config_audit: "false" },
  });
  assert.equal(installed.status, 0, installed.stderr.slice(-1500));
  const merchantImport = spawnSync(process.execPath, ["-e", "import('./caller-result-feedback.mjs').catch((error) => { console.error(error.code || error.message); process.exit(1); })"], {
    cwd: work,
    encoding: "utf8",
  });
  assert.equal(merchantImport.status, 1);

  const feedbackKey = randomBytes(32).toString("hex");
  const actorSecret = randomBytes(24).toString("hex");
  const issued = issueMcpCallerResultFeedbackToken({ key: feedbackKey, observation: observation(), now: Date.now() });
  const foreignTool = resign(issued, feedbackKey, (claims) => ({ ...claims, t: "extract" }));
  const expired = issueMcpCallerResultFeedbackToken({
    key: feedbackKey,
    observation: observation(),
    now: Date.now() - (8 * 24 * 60 * 60 * 1000),
  });
  const httpChannel = issueCallerResultFeedbackToken({
    key: feedbackKey,
    eventId: "11111111-1111-4111-8111-111111111111",
    method: "GET",
    route: "/extract",
    requestDigest: "cd".repeat(32),
    responseDigest: "ef".repeat(32),
    now: Date.now(),
  });
  assert.equal(typeof expired, "string");
  assert.equal(typeof foreignTool, "string");
  assert.equal(typeof httpChannel, "string");
  const facilitator = await startFakeFacilitator();
  let merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, feedbackKey, actorSecret });
  const deadPort = await unusedPort();
  const inputPath = path.join(work, "input.json");
  await writeFile(inputPath, JSON.stringify({
    mcpUrl: `${merchant.base}/mcp`,
    signalDir,
    morpho: { address: FIXTURE_ADDRESS, shocks: [-10, -50] },
    preflight: { rewardUsd: 10, hours: 1, hourlyCostUsd: 50 },
    deadPort,
    refusals: { expired, foreignTool, httpChannel },
  }));
  const consumer = spawn(process.execPath, ["bin/cold-consumer.mjs", "input.json"], {
    cwd: work,
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  consumer.stdout.on("data", (chunk) => { stdout += chunk; });
  consumer.stderr.on("data", (chunk) => { stderr += chunk; });
  const captured = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`captured_timeout\n${stderr}\n${merchant.output().slice(-800)}`)), 60_000);
    const poll = setInterval(async () => {
      try {
        await readFile(path.join(signalDir, "captured"));
        clearInterval(poll);
        clearTimeout(timer);
        resolve();
      } catch (error) {
        if (error?.code !== "ENOENT") {
          clearInterval(poll);
          clearTimeout(timer);
          reject(error);
        }
      }
    }, 50);
    consumer.once("exit", () => {
      clearInterval(poll);
      clearTimeout(timer);
      reject(new Error(`consumer_exited_early ${stderr}`));
    });
  });
  void captured;
  const settlesAfterPurchase = facilitator.calls.settle;
  const eventText = await readFile(path.join(dataDir, FILE_CLASSES.commerceEvents), "utf8");
  const paidEvents = eventText.split("\n").filter(Boolean).map((line) => JSON.parse(line))
    .filter((row) => row.result === "paid_success" && typeof row.settlementReference === "string");
  const specs = paidEvents.map((row) => ({ hash: row.settlementReference, amount: BigInt(row.settlementAmountAtomic) }));
  const reconciler = createCommerceSettlementReconciler({
    actorSecret,
    client: receiptFor(specs),
    dataDir,
    network: NETWORK,
    settlementEvidenceSince: "2020-01-01T00:00:00.000Z",
    treasury: TREASURY,
  });
  const admitted = await reconciler.reconcile();
  assert.equal(admitted.ledger.reconciledSettlements, paidEvents.length);
  assert.equal(admitted.ledger.amountAtomic, String(paidEvents.reduce((sum, row) => sum + BigInt(row.settlementAmountAtomic), 0n)));
  await writeFile(path.join(signalDir, "parent-ready"), "ok");
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`bound_timeout\n${stderr}`)), 30_000);
    const poll = setInterval(async () => {
      try {
        await readFile(path.join(signalDir, "bound"));
        clearInterval(poll);
        clearTimeout(timer);
        resolve();
      } catch (error) {
        if (error?.code !== "ENOENT") {
          clearInterval(poll);
          clearTimeout(timer);
          reject(error);
        }
      }
    }, 50);
  });
  await stopChild(merchant.child);
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, feedbackKey, actorSecret });
  await writeFile(path.join(signalDir, "restart-ready"), JSON.stringify({ mcpUrl: `${merchant.base}/mcp` }));
  const code = await new Promise((resolve) => consumer.once("exit", resolve));
  assert.equal(code, 0, `${stdout}\n${stderr}\n${merchant.output().slice(-800)}`);
  const summary = JSON.parse(stdout.trim());
  assert.equal(summary.outcome, "ready_for_receiving");
  assert.equal(summary.walletInitialized, false);
  assert.equal(summary.purchases, 4);
  assert.equal(summary.reported, 2);
  assert.equal(summary.skipped, true);
  assert.equal(summary.paymentPathCalls, 0);
  assert.equal(summary.usefulPending, true);
  assert.equal(summary.usefulBound, true);
  assert.equal(summary.notUsefulBound, true);
  assert.equal(summary.restartReplay, true);
  assert.equal(summary.contentPreserved, true);
  assert.equal(summary.outputSchemaProbe, "output_schema_rejected_challenge");
  assert.equal(summary.refusals.tampered, "tampered_capability");
  assert.equal(summary.refusals.expired, "expired_capability");
  assert.equal(summary.refusals.foreignToolServer, "foreign_tool");
  assert.equal(summary.refusals.httpChannel, "channel_rejected");
  assert.equal(summary.refusals.transport, "transport_failed");
  assert.equal(summary.http.bound, false);
  assert.equal(summary.http.accepted, true);
  assert.equal(facilitator.calls.settle, settlesAfterPurchase);
  assert.equal(facilitator.calls.settle, 4);
  const cold = spawnSync(process.execPath, ["commerce-prospective-delivery-cold.mjs", dataDir], { cwd, encoding: "utf8" });
  assert.equal(cold.status, 0, cold.stderr);
  const coldPacket = JSON.parse(cold.stdout);
  assert.equal(coldPacket.declaredFeedback.declared_useful, 1);
  assert.equal(coldPacket.declaredFeedback.declared_not_useful, 1);
  assert.equal(stdout.includes(expired), false);
  assert.equal(stdout.includes("http://"), false);
  await stopChild(merchant.child);
  await facilitator.close();
  await rm(root, { recursive: true, force: true });
});
