import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { evm as evmClient, Mppx as ClientMppx } from "mppx/client";
import { privateKeyToAccount } from "viem/accounts";

import { mppAssetForNetwork } from "./mpp-dual-stack.mjs";
import { CAREERS_BOARD_COLD_PATH, CAREERS_BOARD_PATH } from "./careers-board-config.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const PAYER = `0x${"2".repeat(40)}`;
const NETWORK = "eip155:8453";
const MPP_SECRET = "test-secret-key-test-secret-key-32";
const account = privateKeyToAccount("0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
const hook = pathToFileURL(path.join(cwd, "careers-board.fetch-hook.mjs")).href;

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
  const calls = { settle: 0, supported: 0, verify: 0 };
  const server = createHttpServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && req.url === "/supported") {
      calls.supported += 1;
      return send(200, { kinds: [{ network: NETWORK, scheme: "exact", x402Version: 2 }], extensions: [], signers: {} });
    }
    if (req.method === "POST" && req.url === "/verify") {
      calls.verify += 1;
      return send(200, { isValid: true, payer: PAYER });
    }
    if (req.method === "POST" && req.url === "/settle") {
      calls.settle += 1;
      return send(200, { success: true, payer: PAYER, transaction: `0x${"3".repeat(64)}`, network: NETWORK });
    }
    return send(404, { error: "unexpected_test_facilitator_request" });
  });
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  return { calls, close: () => new Promise((resolve) => server.close(resolve)), url: `http://127.0.0.1:${server.address().port}` };
}

async function startMerchant({ dataDir, facilitatorUrl, scenarioFile, fetchLog }) {
  const port = await unusedPort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd,
    env: {
      ...process.env,
      PORT: String(port),
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      FACILITATOR: "xpay",
      FACILITATOR_URL: facilitatorUrl,
      MPP_SECRET_KEY: MPP_SECRET,
      IDEMPOTENCY_INFLIGHT_WAIT_MS: "50",
      EXTRACT_BATCH_ENABLED: "0",
      LOCKFILE_PIN_DELTA_ENABLED: "0",
      PAGE_CHANGE_HTTP_ENABLED: "0",
      PUBLIC_URL: "https://agents.samedaydesk.com",
      CAREERS_BOARD_CACHE_MS: "800",
      CAREERS_BOARD_TIMEOUT_MS: "400",
      CAREERS_BOARD_PRICE: "$0.005",
      CAREERS_BOARD_SCENARIO_FILE: scenarioFile,
      CAREERS_BOARD_FETCH_LOG: fetchLog,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import ${hook}`].filter(Boolean).join(" "),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup timed out: ${output.slice(-2000)}`)), 20_000);
    const onData = (chunk) => {
      output = `${output}${chunk}`.slice(-40_000);
      if (!output.includes(`x402-merchant listening on :${port}`)) return;
      clearTimeout(timer);
      resolve();
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`startup exited before listening: code=${code} signal=${signal}\n${output.slice(-4000)}`));
    });
    child.once("error", reject);
  });
  return { base: `http://127.0.0.1:${port}`, child, output: () => output };
}

async function stopChild(child) {
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once("exit", resolve);
    setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 2_000).unref();
  });
}

function decodePaymentRequired(response) {
  const encoded = response.headers.get("payment-required");
  assert.ok(encoded, "challenge omitted payment-required");
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
}

function testPayment(challenge, id) {
  const accepted = challenge.accepts.find((entry) => entry.network === NETWORK && entry.scheme === "exact");
  assert.ok(accepted, "challenge omitted Base exact payment terms");
  assert.equal(accepted.amount, "5000");
  const nonce = `0x${Buffer.from(id).toString("hex").padEnd(64, "0").slice(0, 64)}`;
  return Buffer.from(JSON.stringify({
    x402Version: 2,
    resource: challenge.resource,
    accepted,
    payload: {
      signature: `0x${"4".repeat(130)}`,
      authorization: {
        from: PAYER,
        to: accepted.payTo,
        value: accepted.amount,
        validAfter: "0",
        validBefore: String(Math.floor(Date.now() / 1000) + 300),
        nonce,
      },
    },
    extensions: { "payment-identifier": { info: { required: challenge.extensions?.["payment-identifier"]?.info?.required === true, id } } },
  })).toString("base64");
}

async function createMppCredential(response) {
  const client = ClientMppx.create({
    methods: [evmClient({
      account,
      currencies: [mppAssetForNetwork(NETWORK)],
      maxAmount: "0.01",
    })],
    polyfill: false,
  });
  return client.createCredential(response);
}

async function readLog(file) {
  try {
    return (await readFile(file, "utf8")).split("\n").filter(Boolean);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function setMode(file, mode, extra = {}) {
  return writeFile(file, JSON.stringify({ mode, ...extra }));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("named-board read charges only a prepared observation on both rails", { timeout: 120_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "careers-board-http-"));
  const scenarioFile = path.join(dataDir, "scenario.json");
  const fetchLog = path.join(dataDir, "fetches.log");
  await setMode(scenarioFile, "fail-closed");
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => {
    if (merchant) await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, scenarioFile, fetchLog });
  const deadline = Date.now() + 20_000;
  while (!merchant.output().includes("MCP server:  POST /mcp (23 paid tools)")) {
    if (Date.now() > deadline) throw new Error(`MCP mount timed out:\n${merchant.output().slice(-2000)}`);
    await sleep(50);
  }
  const base = merchant.base;

  const bare = await fetch(`${base}${CAREERS_BOARD_PATH}`);
  assert.equal(bare.status, 402);
  assert.ok(bare.headers.get("payment-required"));
  assert.match(bare.headers.get("www-authenticate") || "", /^Payment /);
  const bareChallenge = decodePaymentRequired(bare);
  assert.equal(bareChallenge.accepts.find((entry) => entry.scheme === "exact").amount, "5000");

  const rejected = [
    ["?board=not-a-board", undefined],
    ["", { "payment-signature": "opaque-x402-credential" }],
    ["?board=not-a-board", { authorization: "Payment opaque-mpp-credential" }],
    ["?board=acxiom&board=acxiom", undefined],
    ["?board=acxiom&company=liveramp", undefined],
    ["?board=acxiom&url=https%3A%2F%2Fevil.example%2Fjobs", undefined],
  ];
  for (const [query, headers] of rejected) {
    const response = await fetch(`${base}${CAREERS_BOARD_PATH}${query}`, { headers });
    const body = await response.json();
    assert.equal(response.status, 400, `${query} -> ${response.status} ${JSON.stringify(body)}`);
    assert.equal(body.charged, false, query);
    if (query.includes("board=acxiom&board=acxiom")) {
      assert.match(body.error, /exactly once/);
    } else {
      assert.equal(body.emptyBoard, false, query);
    }
  }
  const alias = await fetch(`${base}${CAREERS_BOARD_PATH}?company=acxiomllc`);
  assert.equal(alias.status, 402);
  assert.deepEqual(await readLog(fetchLog), []);
  assert.equal(facilitator.calls.verify, 0);
  assert.equal(facilitator.calls.settle, 0);

  const [openapi, mppOpenapi, catalog, manifest, healthz, cold, homepage, mcpDescriptor, llms] = await Promise.all([
    fetch(`${base}/openapi.json`).then((response) => response.json()),
    fetch(`${base}/mpp-openapi.json`).then((response) => response.json()),
    fetch(`${base}/api/actions`).then((response) => response.json()),
    fetch(`${base}/.well-known/x402`).then((response) => response.json()),
    fetch(`${base}/healthz`).then((response) => response.json()),
    fetch(`${base}${CAREERS_BOARD_COLD_PATH}`).then((response) => response.json()),
    fetch(`${base}/`, { headers: { accept: "application/json" } }).then((response) => response.json()),
    fetch(`${base}/mcp`).then((response) => response.json()),
    fetch(`${base}/llms.txt`).then((response) => response.text()),
  ]);
  assert.equal(openapi.paths[CAREERS_BOARD_PATH].get.operationId, "readNamedCareersBoard");
  assert.ok(openapi.paths[CAREERS_BOARD_PATH].get["x-payment-info"]);
  assert.equal(openapi.paths[CAREERS_BOARD_COLD_PATH].get["x-payment-info"], undefined);
  assert.equal(openapi.paths[CAREERS_BOARD_COLD_PATH].get.responses["402"], undefined);
  assert.equal(openapi.paths[CAREERS_BOARD_COLD_PATH].get.responses["200"].content["application/json"].schema.properties.charged.const, false);
  assert.ok(mppOpenapi.paths[CAREERS_BOARD_PATH].get["x-payment-info"]);
  assert.equal(catalog.actions.some((action) => action.route === CAREERS_BOARD_PATH && action.priceAtomicUsdc === "5000"), true);
  assert.equal(catalog.actions.some((action) => action.route === CAREERS_BOARD_COLD_PATH), false);
  assert.equal(catalog.freeRecipes.at(-1).route, CAREERS_BOARD_COLD_PATH);
  assert.equal(catalog.freeRecipes.at(-1).charged, false);
  assert.equal(manifest.items.some((item) => item.resource?.routeTemplate === CAREERS_BOARD_PATH), true);
  assert.equal(healthz.prices["careers-board"], "$0.005");
  assert.equal(cold.charged, false);
  assert.equal(cold.gistId, "a8f74ed84b4ece624209be1dab745a30");
  assert.equal(cold.revision, "7d01bfb09c530430933dec1f07c5c0b8517cffa8");
  assert.equal(cold.directFreeExecution, true);
  assert.equal(cold.callerResultFeedback.invoked, false);
  assert.match(cold.files["PUBLIC-RECIPE.md"], /careers/);
  assert.equal(Object.hasOwn(homepage.paidRoutes, `GET ${CAREERS_BOARD_PATH}`), false);
  assert.equal(mcpDescriptor.toolCount, 23);
  assert.equal(mcpDescriptor.freeTools.some((tool) => tool.name === "careers_board_cold" && tool.charged === false), true);
  assert.match(llms, /\/data\/careers-board/);
  assert.match(llms, /\$0\.005 USDC/);
  assert.match(llms, /\/recipes\/careers-board-cold/);
  const html = await fetch(`${base}/`, { headers: { accept: "text/html" } }).then((response) => response.text());
  assert.equal(html.includes("/data/careers-board"), false);

  const client = new Client({ name: "careers-board", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  try {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.ok(names.includes("careers_board"));
    assert.ok(names.includes("careers_board_cold"));
  } finally {
    await client.close();
  }

  async function payX402(query, id) {
    const unpaid = await fetch(`${base}${CAREERS_BOARD_PATH}${query}`);
    assert.equal(unpaid.status, 402, query);
    const payment = testPayment(decodePaymentRequired(unpaid), id);
    const response = await fetch(`${base}${CAREERS_BOARD_PATH}${query}`, { headers: { "payment-signature": payment } });
    const body = await response.json();
    return { response, body, payment };
  }

  await setMode(scenarioFile, "hang");
  const hung = await payX402("?board=acxiom", "careers_hang_1234567890");
  assert.equal(hung.response.status, 503, JSON.stringify(hung.body));
  assert.equal(hung.body.outcome, "unavailable");
  assert.equal(hung.body.charged, false);
  assert.equal(hung.body.emptyBoard, false);
  assert.equal(facilitator.calls.verify, 0);
  assert.equal(facilitator.calls.settle, 0);

  await setMode(scenarioFile, "acxiom-403");
  const denied = await payX402("?board=acxiom", "careers_denied_1234567890");
  assert.equal(denied.response.status, 503);
  assert.equal(denied.body.coverage.status, "source_failure");
  assert.equal(denied.body.outcome, "unavailable");
  assert.notEqual(denied.body.outcome, "useful_empty");
  assert.equal(facilitator.calls.settle, 0);

  await setMode(scenarioFile, "huge");
  const huge = await payX402("?board=acxiom", "careers_huge_12345678901");
  assert.equal(huge.response.status, 503);
  assert.equal(huge.body.charged, false);
  assert.equal(huge.body.emptyBoard, false);
  assert.equal(facilitator.calls.settle, 0);

  await setMode(scenarioFile, "acxiom-partial");
  const partial = await payX402("?board=acxiom", "careers_partial_123456789");
  assert.equal(partial.response.status, 200, JSON.stringify(partial.body));
  assert.equal(partial.body.charged, true);
  assert.equal(partial.body.outcome, "partial");
  assert.equal(partial.body.coverage.status, "partial");
  assert.equal(partial.body.missing.length, 1);
  assert.equal(partial.body.rows.length, 1);
  assert.equal(partial.body.rows[0].location, "Remote");
  assert.match(partial.body.rows[0].url, /^https:\/\/acxiomllc\.wd5\.myworkdayjobs\.com\/en-US\/AcxiomUSA\/job\//);
  assert.equal(partial.body.roleFilter, null);
  assert.equal(partial.body.quote.atomic, "5000");
  assert.equal(partial.body.nextSteps.callerResultFeedback.invoked, false);
  assert.equal(partial.body.nextSteps.callerResultFeedback.path, "/commerce/caller-result-feedback");
  assert.equal(partial.body.nextSteps.taskHelp.invoked, false);
  assert.match(partial.body.nextSteps.taskHelp.url, /visitor-entry/);
  assert.equal(partial.response.headers.get("x-samedaydesk-caller-result-feedback"), null);
  assert.equal(JSON.stringify(partial.body).includes("marketVerdict"), false);
  assert.equal(facilitator.calls.verify, 1);
  assert.equal(facilitator.calls.settle, 1);
  const fetchesAfterPartial = (await readLog(fetchLog)).length;

  const replay = await fetch(`${base}${CAREERS_BOARD_PATH}?board=acxiom`, {
    headers: { "payment-signature": partial.payment },
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.headers.get("x-payment-idempotency"), "replay");
  assert.equal((await readLog(fetchLog)).length, fetchesAfterPartial);
  assert.equal(facilitator.calls.settle, 1);

  await sleep(1000);
  await setMode(scenarioFile, "acxiom-complete", { path: "/job/B/Other_2", title: "Other" });
  const complete = await payX402("?board=acxiom", "careers_complete_12345678");
  assert.equal(complete.response.status, 200, JSON.stringify(complete.body));
  assert.equal(complete.body.outcome, "listed");
  assert.equal(complete.body.coverage.status, "complete_for_declared_total");
  assert.equal(complete.body.changed, true);
  assert.equal(complete.body.rows.length, 1);
  assert.equal(complete.body.rows[0].title, "Other");
  assert.equal(facilitator.calls.settle, 2);
  const fetchesAfterComplete = (await readLog(fetchLog)).length;

  const cached = await payX402("?board=acxiom", "careers_cached_1234567890");
  assert.equal(cached.response.status, 200, JSON.stringify(cached.body));
  assert.equal(cached.body.charged, true);
  assert.equal(cached.body.cache.hit, true);
  assert.equal(cached.body.fetchedAt, complete.body.fetchedAt);
  assert.equal((await readLog(fetchLog)).length, fetchesAfterComplete);
  assert.equal(facilitator.calls.settle, 3);

  await sleep(1000);
  await setMode(scenarioFile, "acxiom-complete", { delayMs: 80, path: "/job/B/Other_2", title: "Other" });
  const beforeConcurrent = (await readLog(fetchLog)).length;
  const [left, right] = await Promise.all([
    payX402("?board=acxiom", "careers_left_12345678901"),
    payX402("?board=acxiom", "careers_right_1234567890"),
  ]);
  assert.equal(left.response.status, 200, JSON.stringify(left.body));
  assert.equal(right.response.status, 200, JSON.stringify(right.body));
  assert.equal(left.body.fetchedAt, right.body.fetchedAt);
  assert.equal((await readLog(fetchLog)).length - beforeConcurrent, 2);
  assert.equal(facilitator.calls.settle, 5);

  await sleep(1000);
  await setMode(scenarioFile, "acxiom-403");
  const settledBeforeStale = facilitator.calls.settle;
  const verifiedBeforeStale = facilitator.calls.verify;
  const stale = await payX402("?board=acxiom", "careers_stale_12345678901");
  assert.equal(stale.response.status, 503, JSON.stringify(stale.body));
  assert.equal(stale.body.outcome, "stale");
  assert.equal(stale.body.charged, false);
  assert.equal(stale.body.emptyBoard, false);
  assert.equal(stale.body.rows[0].stale, true);
  assert.equal(stale.body.rows[0].title, "Other");
  assert.equal(facilitator.calls.verify, verifiedBeforeStale);
  assert.equal(facilitator.calls.settle, settledBeforeStale);

  await setMode(scenarioFile, "liveramp-500");
  const unpaidMpp = await fetch(`${base}${CAREERS_BOARD_PATH}?board=liveramp`);
  assert.equal(unpaidMpp.status, 402);
  assert.match(unpaidMpp.headers.get("www-authenticate") || "", /^Payment /);
  const authorization = await createMppCredential(unpaidMpp);
  const mppFailure = await fetch(`${base}${CAREERS_BOARD_PATH}?board=liveramp`, { headers: { authorization } });
  const mppFailureBody = await mppFailure.json();
  assert.equal(mppFailure.status, 503, JSON.stringify(mppFailureBody));
  assert.equal(mppFailureBody.charged, false);
  assert.equal(mppFailureBody.emptyBoard, false);
  assert.equal(mppFailureBody.outcome, "unavailable");
  assert.equal(mppFailure.headers.get("payment-receipt"), null);
  assert.equal(facilitator.calls.settle, settledBeforeStale);

  await setMode(scenarioFile, "liveramp-listed");
  const listedChallenge = await fetch(`${base}${CAREERS_BOARD_PATH}?board=liverampashby`);
  const listedAuthorization = await createMppCredential(listedChallenge);
  const beforeListed = (await readLog(fetchLog)).length;
  const listedResponse = await fetch(`${base}${CAREERS_BOARD_PATH}?board=liverampashby`, {
    headers: { authorization: listedAuthorization },
  });
  const listed = await listedResponse.json();
  assert.equal(listedResponse.status, 200, JSON.stringify(listed));
  assert.equal(listed.charged, true);
  assert.equal(listed.outcome, "listed");
  assert.equal(listed.rows[0].title, "Listed");
  assert.equal(listed.rows[0].location, "New York");
  assert.equal(listed.source.primary, "ashby");
  assert.equal(listed.source.sourceChange.read, false);
  const listedFetches = (await readLog(fetchLog)).slice(beforeListed);
  assert.deepEqual(listedFetches, ["https://api.ashbyhq.com/posting-api/job-board/liveramp-inc"]);
  // MPP charge settles once through the shared facilitator, then the x402 gate is skipped.
  assert.ok(listedResponse.headers.get("payment-receipt"));
  assert.equal(facilitator.calls.verify, verifiedBeforeStale + 1);
  assert.equal(facilitator.calls.settle, settledBeforeStale + 1);

  await sleep(1000);
  await setMode(scenarioFile, "liveramp-empty");
  const empty = await payX402("?board=liveramp", "careers_empty_12345678901");
  assert.equal(empty.response.status, 200, JSON.stringify(empty.body));
  assert.equal(empty.body.outcome, "useful_empty");
  assert.equal(empty.body.coverage.emptyBoard, true);
  assert.equal(empty.body.rows.length, 0);
  assert.equal(empty.body.charged, true);
  assert.equal(facilitator.calls.settle, settledBeforeStale + 2);

  await sleep(1000);
  await setMode(scenarioFile, "liveramp-unlisted-only");
  const unlisted = await payX402("?company=liveramp-inc", "careers_unlisted_1234567");
  assert.equal(unlisted.response.status, 200, JSON.stringify(unlisted.body));
  assert.equal(unlisted.body.outcome, "listed");
  assert.equal(unlisted.body.coverage.listedSetEmpty, true);
  assert.equal(unlisted.body.coverage.emptyBoard, false);
  assert.notEqual(unlisted.body.outcome, "useful_empty");
  assert.equal(facilitator.calls.verify, verifiedBeforeStale + 3);
  assert.equal(facilitator.calls.settle, settledBeforeStale + 3);
});
