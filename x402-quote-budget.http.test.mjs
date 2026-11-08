import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, get } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { x402Client } from "@x402/core/client";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { extractDiscoveryInfo } from "@x402/extensions/bazaar";
import { validateBazaarContract } from "agent-payment-integrity";

import { validatePaymentRequiredHeader } from "./bazaar-contract-audit.mjs";

const cwd = fileURLToPath(new URL(".", import.meta.url));
const publicHost = "agents.samedaydesk.com";
const publicOrigin = `https://${publicHost}`;
const shortHost = "quote.example";
const network = "eip155:8453";
const zeroSignature = `0x${"00".repeat(65)}`;
const retryBudget = 7900;
const quoteBudget = 7500;

const extract = "/extract";
const audit = "/commerce/seller-integrity-audit";
const search = "/commerce/contract-qualified-search";
const surface = "/distribution/agent-surface-budget-audit";
const preflight = "/commerce/payment-offer-preflight";
const searchQuery = "service domain ownership code provenance";
const target = `${publicOrigin}/extract?url=https%3A%2F%2Fexample.com`;
const resource = (route, query) => `${route}?${new URLSearchParams(query)}`;
const complete = [
  ["extract", resource(extract, { url: "https://example.com" })],
  ["audit bare", audit],
  ["audit", resource(audit, { origin: publicOrigin, route: preflight, requiredPaths: "decision,offers" })],
  ["search", resource(search, { query: searchQuery, requiredPaths: "data.sourceRepository", limit: 5 }), ["decision", "qualified"]],
  ["surface", resource(surface, { origin: publicOrigin, surfaceMode: "both", mcpPath: "/mcp", openApiPath: "/openapi.json" }), ["decision", "mcp", "openapi"]],
  ["preflight", resource(preflight, { url: target }), ["decision", "offers"]],
];
const longInputs = [
  ["audit long", resource(audit, { origin: publicOrigin, route: `/commerce/${"public-detail-".repeat(6)}result`, requiredPaths: "decision,offers" })],
  ["search long", resource(search, {
    query: `${searchQuery} with archived release tags`,
    requiredPaths: "data.sourceRepository,data.package.version", limit: 5,
  }), ["decision", "qualified"]],
  ["surface long", resource(surface, {
    origin: publicOrigin, surfaceMode: "both",
    mcpPath: "/services/mcp", openApiPath: "/public/api.json",
  }), ["decision", "mcp", "openapi"]],
  ["preflight long", resource(preflight, { url: `${publicOrigin}/catalog/${"public-".repeat(40)}index` }), ["decision", "offers"]],
];
const otherProjected = [
  ["/commerce/settlement-proof", ["decision", "settlement"]],
  ["/chain/transaction-receipt", ["decision", "transaction"]],
  ["/chain/solana-transaction-receipt", ["decision", "transaction"]],
  ["/data/careers-board", ["board", "outcome", "rows"]],
];
const oversized = ["preflight near URL limit", resource(preflight, { url: `${publicOrigin}/catalog/${"a".repeat(1850)}` }), ["decision", "offers"]];
const fixtureRetryHeaders = {
  "user-agent": "x402-quote-budget-fixture/1",
  accept: "application/json",
  "x-forwarded-for": "192.0.2.1",
  traceparent: "00-11111111111111111111111111111111-1111111111111111-01",
  cookie: `fixture=${"x".repeat(160)}`,
};

function request(base, route, headers = {}) {
  return new Promise((resolve, reject) => {
    get(base + route, { headers, maxHeaderSize: 65536 }, async (response) => {
      try {
        const chunks = await Array.fromAsync(response);
        resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() });
      } catch (error) {
        reject(error);
      }
    }).on("error", reject);
  });
}

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

function merchantHeaders(host) {
  return { host, "x-forwarded-proto": "https", connection: "close" };
}

function requestBytes(route, headers) {
  const lines = Object.entries(headers).map(([name, value]) => `${name}: ${value}`);
  return Buffer.byteLength([`GET ${route} HTTP/1.1`, ...lines, "", ""].join("\r\n"));
}

async function mount(t) {
  const verified = [];
  const unexpected = [];
  const facilitator = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.method === "GET" && req.url === "/supported") {
      return res.end(JSON.stringify({ kinds: [{ x402Version: 2, scheme: "exact", network }], extensions: [], signers: {} }));
    }
    if (req.method === "POST" && req.url === "/verify") {
      verified.push(JSON.parse(Buffer.concat(await Array.fromAsync(req)).toString()));
      return res.end(JSON.stringify({ isValid: false, invalidReason: "fixture_signature_refused" }));
    }
    unexpected.push(`${req.method} ${req.url}`);
    res.writeHead(500).end("{}");
  });
  const fixture = await listen(facilitator);
  t.after(async () => {
    await close(facilitator);
    assert.deepEqual(unexpected, []);
  });

  const parser = createServer({ maxHeaderSize: 16384 }, (_req, res) => res.writeHead(204).end());
  const relaxedParser = await listen(parser);
  t.after(() => close(parser));

  const dir = await mkdtemp(path.join(tmpdir(), "x402-quote-budget-"));
  const preload = path.join(dir, "receipt-preload.mjs");
  const careersScenario = path.join(dir, "careers.json");
  await writeFile(careersScenario, JSON.stringify({ mode: "acxiom-complete" }));
  // Use the SDK's actual offer envelope with prebuilt bytes. This fixture
  // never configures a signing account or a settlement-receipt issuer.
  await writeFile(preload, `
import { x402ResourceServer } from ${JSON.stringify(import.meta.resolve("@x402/core/server"))};
import { createOfferReceiptExtension } from ${JSON.stringify(import.meta.resolve("@x402/extensions/offer-receipt"))};
const extension = createOfferReceiptExtension({
  issueOffer: async (resourceUrl, { acceptIndex, scheme, network, asset, payTo, amount }) => ({
    format: "eip712", acceptIndex,
    payload: { version: 1, resourceUrl, scheme, network, asset, payTo, amount, validUntil: 1800000000 },
    signature: ${JSON.stringify(zeroSignature)},
  }),
});
const create = x402ResourceServer.prototype.createPaymentRequiredResponse;
x402ResourceServer.prototype.createPaymentRequiredResponse = async function (...args) {
  const quote = await create.apply(this, args);
  quote.extensions["offer-receipt"] = await extension.enrichPaymentRequiredResponse(
    { includeTxHash: true }, { paymentRequiredResponse: quote, requirements: quote.accepts },
  );
  return quote;
};
`);
  const reservation = createServer();
  const base = await listen(reservation);
  const port = reservation.address().port;
  await close(reservation);

  const child = spawn(process.execPath, [
    "--max-http-header-size=8192", "--import", "./test/independent-recovery-preload.mjs",
    "--import", "./careers-board.fetch-hook.mjs", "--import", preload, "server.js",
  ], { cwd, env: {
    PATH: process.env.PATH, NODE_ENV: "test", PORT: String(port), PUBLIC_URL: publicOrigin,
    X402_BUILDER_CODE: "bc_a", MPP_SECRET_KEY: "", CIRCLE_GATEWAY_ENABLED: "false",
    CAREERS_BOARD_SCENARIO_FILE: careersScenario,
    FACILITATOR: "xpay", FACILITATOR_URL: fixture, RECOVERY_FIXTURE_URL: fixture, COMMERCE_DATA_DIR: dir,
    COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000", RECOVERY_CLOCK_MS: "1794168000000",
  }, stdio: ["ignore", "pipe", "pipe"] });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
    await rm(dir, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    let logs = "";
    const timer = setTimeout(() => reject(new Error(logs)), 15_000);
    const onData = (data) => {
      logs = (logs + data).slice(-12000);
      if (!logs.includes(`x402-merchant listening on :${port}`)) return;
      clearTimeout(timer);
      resolve();
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", () => { clearTimeout(timer); reject(new Error(logs)); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
  });
  return { base, relaxedParser, verified };
}

async function pythonQuotes(base, host, cases) {
  const python = process.env.AIOHTTP_QUOTE_PYTHON;
  if (!python) return [];
  const { stdout } = await promisify(execFile)(python, [
    "python/aiohttp-quote-budget.py", base, ...cases.map(([, route]) => route),
  ], { cwd, env: { PATH: process.env.PATH, AIOHTTP_QUOTE_HOST: host }, timeout: 15000 });
  return JSON.parse(stdout).responses;
}

function assertDiscovery(quote, legacy, indexed, keys, action) {
  const bazaar = quote.extensions.bazaar;
  const fullBazaar = legacy.extensions.bazaar;
  assert.deepEqual(indexed.discoveryInfo, bazaar.info);
  assert.deepEqual(bazaar.info.input, fullBazaar.info.input);
  assert.deepEqual(bazaar.schema.properties.input, fullBazaar.schema.properties.input);
  assert.deepEqual({ ...quote.extensions, bazaar: fullBazaar }, legacy.extensions);
  if (!keys) return;

  assert.deepEqual(Object.keys(indexed.discoveryInfo.output.example), keys);
  assert.equal(indexed.discoveryInfo.output.format, "partial-example");
  assert.deepEqual(fullBazaar.info.output.example, action.response.example);
  assert.deepEqual(fullBazaar.schema.properties.output.properties.example, action.response.schema);
  assert.equal(legacy.accepts[0].outputSchema.output.format, undefined);
  assert.deepEqual(legacy.accepts[0].outputSchema.output.example, action.response.example);
  assert.equal(JSON.stringify(bazaar).includes('"$ref"'), false);
}

test("mounted x402 GET quotes and exact-EVM retries fit the two header budgets", { timeout: 60_000 }, async (t) => {
  const { base, relaxedParser, verified } = await mount(t);
  const { actions } = JSON.parse((await request(base, "/api/actions")).body);
  const client = new x402Client().register(network, new ExactEvmScheme({
    address: `0x${"1".repeat(40)}`,
    signTypedData: async () => zeroSignature,
  }));
  const buildRetry = (quote) => client.createPaymentPayload(quote);
  const toRoute = (action) => new URL(action.request.exampleUrl).pathname + new URL(action.request.exampleUrl).search;
  const cases = [...complete, ...longInputs, ...otherProjected.map(([name, keys]) => [
    name, toRoute(actions.find((action) => action.route === name)), keys,
  ])];
  const python = await pythonQuotes(base, publicHost, [...cases, oversized]);
  const shortCase = ["preflight shorter origin", complete.at(-1)[1], complete.at(-1)[2]];
  const shortPython = await pythonQuotes(base, shortHost, [shortCase]);
  let preflightQuote;

  async function checkCase(subtest, [name, route, keys], host, pythonResult, fits) {
    const headers = merchantHeaders(host);
    const response = await request(base, route, headers);
    assert.equal(response.status, 402);
    const encoded = response.headers["payment-required"];
    const quoteLine = Buffer.byteLength(`PAYMENT-REQUIRED: ${encoded}\r\n`);
    const quote = JSON.parse(Buffer.from(encoded, "base64"));
    const legacy = JSON.parse(response.body);
    const payment = await buildRetry(quote);
    const signature = encodePaymentSignatureHeader(payment);
    const retryHeaders = { ...headers, ...fixtureRetryHeaders, "PAYMENT-SIGNATURE": signature };
    const aggregate = requestBytes(route, retryHeaders);
    const before = verified.length;
    const response8192 = await request(base, route, retryHeaders);
    const response16384 = await request(relaxedParser, route, retryHeaders);
    subtest.diagnostic(JSON.stringify({
      name, nodeQuote: response.status, quoteValue: encoded.length, quoteLine, aiohttp: pythonResult,
      retryValue: signature.length, retryLine: Buffer.byteLength(`PAYMENT-SIGNATURE: ${signature}\r\n`),
      aggregate, parser8192: response8192.status, parser16384: response16384.status, verified: verified.length - before,
    }));

    assert.equal(response16384.status, 204);
    assert.equal(quote.resource.url, `https://${host}${route}`);
    assert.deepEqual(quote.resource, legacy.resource);
    assert.deepEqual(payment.extensions, quote.extensions);
    assert.deepEqual(payment.accepted, quote.accepts[0]);
    const pathOnly = route.split("?")[0];
    const action = actions.find((action) => action.route === pathOnly);
    const { scheme, network: chain, asset, amount, payTo } = payment.accepted;
    assert.equal(scheme, "exact");
    assert.equal(chain, network);
    assert.equal(asset.toLowerCase(), "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
    assert.equal(amount, action.priceAtomicUsdc);
    assert.equal(payTo.toLowerCase(), "0x8904df3de6dfee6a7c8cc38619d2f17806213cee");
    assert.equal(payment.payload.signature, zeroSignature);
    assert.equal(payment.payload.authorization.to, payTo);
    assert.equal(payment.payload.authorization.value, amount);
    assert.deepEqual(quote.extensions["offer-receipt"].info.offers[0].payload, {
      version: 1, resourceUrl: quote.resource.url, scheme, network: chain, asset, payTo, amount, validUntil: 1800000000,
    });
    assert.equal(quote.extensions["builder-code"].info.a, "bc_a");
    assert.ok(quote.extensions["payment-identifier"]);
    assert.deepEqual(validatePaymentRequiredHeader(encoded), { valid: true, errors: [] });
    assert.deepEqual(validateBazaarContract(quote.extensions.bazaar), { valid: true, findings: [] });
    const indexed = extractDiscoveryInfo(payment, payment.accepted);
    assert.equal(indexed.resourceUrl, `https://${host}${pathOnly}`);
    assert.equal(indexed.method, "GET");
    assertDiscovery(quote, legacy, indexed, keys, action);

    if (name === "preflight") preflightQuote = { quote, legacy, route };
    if (!fits) {
      assert.equal(response8192.status, 431);
      assert.equal(verified.length, before);
      assert.ok(aggregate > 8192);
      return;
    }
    if (pythonResult) assert.deepEqual(pythonResult, { status: 402, lineBytes: quoteLine });
    assert.ok(quoteLine <= quoteBudget, `quote line is ${quoteLine} bytes`);
    assert.ok(aggregate <= retryBudget, `retry head is ${aggregate} bytes`);
    if (route === audit) {
      assert.equal(response8192.status, 400);
      assert.equal(verified.length, before);
      return;
    }
    assert.equal(response8192.status, 402);
    assert.equal(verified.length, before + 1);
    assert.deepEqual(verified.at(-1).paymentPayload, payment);
    assert.deepEqual(verified.at(-1).paymentRequirements, payment.accepted);
  }

  for (const [index, scenario] of cases.entries()) {
    await t.test(scenario[0], (subtest) => checkCase(subtest, scenario, publicHost, python[index], true));
  }
  await t.test(shortCase[0], (subtest) => checkCase(subtest, shortCase, shortHost, shortPython[0], true));
  await t.test(oversized[0], (subtest) => checkCase(subtest, oversized, publicHost, python[cases.length], false));

  await t.test("full legacy echoes still validate and edited compact echoes do not reach verification", async () => {
    assert.ok(preflightQuote);
    const { quote, legacy, route } = preflightQuote;
    const full = await buildRetry({ ...quote, extensions: legacy.extensions });
    const before = verified.length;
    // This check exercises the owning SDK's validation directly because the old
    // full echo overflows the 8192-byte mounted request parser.
    const { QuoteX402ResourceServer } = await import("./x402-legacy-body.mjs");
    const validation = new QuoteX402ResourceServer();
    assert.deepEqual(validation.validateExtensions({ ...quote, extensions: legacy.extensions }, full), { valid: true });
    for (const edit of [
      (value) => { value.extensions.bazaar.info.output.example.decision = "review_required"; },
      (value) => { value.extensions.bazaar.info.input.queryParams.url = "https://example.com/altered"; },
      (value) => { value.extensions["builder-code"].info.a = "bc_b"; },
      (value) => { value.accepted.amount = "1"; },
    ]) {
      const changed = await buildRetry(quote);
      edit(changed);
      const denied = await request(base, route, { ...merchantHeaders(publicHost), "PAYMENT-SIGNATURE": encodePaymentSignatureHeader(changed) });
      assert.equal(denied.status, 402);
      assert.equal(verified.length, before);
    }
  });
});
