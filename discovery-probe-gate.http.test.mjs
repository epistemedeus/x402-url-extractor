import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme as ExactEvmClientScheme } from "@x402/evm/exact/client";
import { evm as evmClient, Mppx as ClientMppx } from "mppx/client";
import { privateKeyToAccount } from "viem/accounts";
import { mppAssetForNetwork } from "./mpp-dual-stack.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const ADDRESS = `0x${"1".repeat(40)}`;
const HASH = `0x${"2".repeat(64)}`;
const SOLANA_SIGNATURE = "GKYyX4foVCLRN4b8b7qBTXXf9iEAtrdqzez4U1rwgEhUt99cmyXwPQ4JhsEu4PFbWFNj3ZKZbxTVNwHJKK17ahc";
const NETWORK = "eip155:8453";
const TEST_ACCOUNT = privateKeyToAccount(
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
);

const ROUTES = [
  { path: "/extract", invalid: "?url=not-a-url", valid: "?url=https%3A%2F%2Fexample.com" },
  { path: "/read", invalid: "?url=file%3A%2F%2F%2Ftmp%2Fsecret", valid: "?url=https%3A%2F%2Fexample.com" },
  { path: "/scan", invalid: "?repo=not-a-repository", valid: "?repo=octocat%2FHello-World" },
  { path: "/schemaforge", invalid: "?site=not-a-url", valid: "?site=https%3A%2F%2Fexample.com" },
  { path: "/enrich", invalid: "?domain=not%20a%20domain", valid: "?domain=example.com" },
  { path: "/wallet-enrich", invalid: "?address=not-an-address", valid: `?address=${ADDRESS}` },
  { path: "/deep-audit", invalid: "?domain=not%20a%20domain", valid: "?domain=example.com" },
  { path: "/defi/morpho-position", invalid: "?address=not-an-address", valid: `?address=${ADDRESS}` },
  { path: "/defi/morpho-protection", invalid: "?address=not-an-address", valid: `?address=${ADDRESS}` },
  { path: "/defi/morpho-market-underwrite", invalid: "?marketId=not-a-market", valid: `?marketId=${HASH}` },
  { path: "/defi/morpho-preliquidation-replay", invalid: "?transactionHash=not-a-transaction", valid: `?transactionHash=${HASH}` },
  {
    path: "/work/opportunity-preflight",
    invalid: "?rewardUsd=10",
    valid: "?rewardUsd=10&hours=0.25&hourlyCostUsd=4",
  },
  {
    path: "/distribution/agent-discoverability-audit",
    invalid: "?origin=https%3A%2F%2Fexample.com",
    valid: "?origin=https%3A%2F%2Fexample.com&intent=extract%20public%20website%20structured%20metadata%20for%20an%20autonomous%20buyer",
  },
  {
    path: "/commerce/payment-offer-preflight",
    invalid: "?url=not-a-url",
    valid: "?url=https%3A%2F%2Fexample.com%2Fpaid",
  },
  {
    path: "/commerce/settlement-proof",
    invalid: `?transactionHash=${HASH}`,
    valid: `?transactionHash=${HASH}&recipient=${ADDRESS}&amountAtomic=10000`,
  },
  { path: "/chain/transaction-receipt", invalid: "?transactionHash=not-a-transaction", valid: `?transactionHash=${HASH}` },
  { path: "/chain/solana-transaction-receipt", invalid: "?signature=not-a-signature", valid: `?signature=${SOLANA_SIGNATURE}` },
  {
    path: "/commerce/seller-integrity-audit",
    invalid: "?origin=https%3A%2F%2Fexample.com",
    valid: "?origin=https%3A%2F%2Fexample.com&route=%2Fpaid&method=GET",
  },
  {
    path: "/commerce/contract-qualified-search",
    invalid: "?query=short",
    valid: "?query=service%20domain%20ownership&requiredPaths=result.id",
  },
  {
    path: "/distribution/agent-surface-budget-audit",
    invalid: "?origin=not-a-url",
    valid: "?origin=https%3A%2F%2Fexample.com&surfaceMode=openapi",
  },
];

const CREDENTIALS = [
  ["payment-signature", ""],
  ["payment-signature", "opaque-x402-credential"],
  ["x-payment", ""],
  ["x-payment", "opaque-legacy-x402-credential"],
  ["x-payment-signature", ""],
  ["x-payment-signature", "opaque-x402-signature"],
  ["authorization", ""],
  ["authorization", "Payment"],
  ["authorization", "Payment opaque-mpp-credential"],
  ["authorization", "Bearer opaque-bearer, Payment"],
  ["authorization", "Bearer opaque-bearer, Payment opaque-mpp"],
  ["authorization", "Basic abc, pAyMeNt opaque-mpp"],
];

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
  const calls = [];
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/supported") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        kinds: [{ network: "eip155:8453", scheme: "exact", x402Version: 2 }],
        extensions: [],
        signers: {},
      }));
      return;
    }
    calls.push({ method: req.method, url: req.url });
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "facilitator must not be called by this test" }));
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

async function startMerchant({ facilitatorUrl, dataDir }) {
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
      MPP_SECRET_KEY: "test-secret-key-test-secret-key-32",
      PUBLIC_URL: "https://agents.samedaydesk.com",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup timed out: ${output.slice(-2000)}`)), 20_000);
    const onData = (chunk) => {
      output = `${output}${chunk}`.slice(-20_000);
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
  return { base: `http://127.0.0.1:${port}`, child };
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

async function expectStatus(base, path, status, init) {
  const response = await fetch(`${base}${path}`, init);
  const body = await response.text();
  assert.equal(response.status, status, `${path} returned ${response.status}: ${body}`);
  return { body, response };
}

function duplicateQueryParameter(suffix, name) {
  const params = new URLSearchParams(suffix.slice(1));
  const value = params.get(name) || "duplicate-probe";
  params.delete(name);
  params.append(name, value);
  params.append(name, value);
  return `?${params.toString()}`;
}

async function shapeValidX402Credential(response) {
  const required = decodePaymentRequiredHeader(response.headers.get("payment-required"));
  assert.ok(required.accepts.some(({ network, scheme }) => network === NETWORK && scheme === "exact"), "canonical challenge omitted the Base exact requirement");
  const client = new x402Client().register(NETWORK, new ExactEvmClientScheme(TEST_ACCOUNT));
  return encodePaymentSignatureHeader(await client.createPaymentPayload(required));
}

async function shapeValidMppCredential(response) {
  const client = ClientMppx.create({
    methods: [evmClient({
      account: TEST_ACCOUNT,
      currencies: [mppAssetForNetwork(NETWORK)],
      maxAmount: "1",
    })],
    polyfill: false,
  });
  return client.createCredential(response);
}

function rawGet(base, rawPath, headers = {}) {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      headers,
      hostname: url.hostname,
      method: "GET",
      path: rawPath,
      port: url.port,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({
        body: Buffer.concat(chunks).toString("utf8"),
        status: res.statusCode,
      }));
    });
    req.once("error", reject);
    req.end();
  });
}

function replaceFirstLetter(pathname, replacement) {
  const index = pathname.search(/[A-Za-z]/);
  assert.notEqual(index, -1);
  const hex = pathname.charCodeAt(index).toString(16).padStart(2, "0");
  return `${pathname.slice(0, index)}${replacement(hex)}${pathname.slice(index + 1)}`;
}

function replaceSeparator(pathname, replacement) {
  const index = pathname.indexOf("/", 1);
  if (index === -1) return `/${replacement}${pathname.slice(1)}`;
  return `${pathname.slice(0, index)}${replacement}${pathname.slice(index + 1)}`;
}

function hostilePathVariants(pathname) {
  return [
    { kind: "case", path: pathname.toUpperCase() },
    { kind: "trailing-slash", path: `${pathname}/` },
    { kind: "encoded-unreserved", path: replaceFirstLetter(pathname, (hex) => `%${hex}`) },
    { kind: "repeated-separator", path: replaceSeparator(pathname, "//") },
    { kind: "encoded-slash", path: replaceSeparator(pathname, "%2F") },
    { kind: "encoded-backslash", path: replaceSeparator(pathname, "%5C") },
    { kind: "raw-dot-segment", path: `/.${pathname}` },
    { kind: "encoded-dot-segment", path: `/%2e${pathname}` },
    { kind: "encoded-dotdot-segment", path: `/%2e%2e${pathname}` },
    { kind: "double-encoded-unreserved", path: replaceFirstLetter(pathname, (hex) => `%25${hex}`) },
  ];
}

test("all paid GET products expose unsigned bare offers without weakening pre-payment validation", { timeout: 180_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "samedaydesk-discovery-probe-"));
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => {
    if (merchant) await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ facilitatorUrl: facilitator.url, dataDir });

  assert.equal(ROUTES.length, 20);
  for (const route of ROUTES) {
    const { response } = await expectStatus(merchant.base, route.path, 402);
    assert.ok(response.headers.get("payment-required"), `${route.path} omitted x402 terms`);
    assert.match(response.headers.get("www-authenticate") || "", /^Payment /, `${route.path} omitted MPP terms`);
    await expectStatus(merchant.base, `${route.path}?discovery=1`, 400);
    await expectStatus(merchant.base, `${route.path}${route.invalid}`, 400);
    await expectStatus(merchant.base, `${route.path}${route.valid}`, 402);
  }

  const mppChallengeParseFailures = [];
  for (const route of ROUTES) {
    const response = await fetch(`${merchant.base}${route.path}${route.valid}`);
    assert.equal(response.status, 402);
    const challenge = response.headers.get("www-authenticate") || "";
    try {
      const credential = await shapeValidMppCredential(response);
      assert.match(credential, /^Payment /);
    } catch (error) {
      mppChallengeParseFailures.push({
        error: error instanceof Error ? error.message : String(error),
        headerLength: challenge.length,
        path: route.path,
      });
    }
  }
  assert.deepEqual(
    mppChallengeParseFailures,
    [],
    `official MPP client could not parse canonical challenges: ${JSON.stringify(mppChallengeParseFailures)}`,
  );

  const openapi = await fetch(`${merchant.base}/openapi.json`).then((response) => response.json());
  const portableRoutePattern = "^/[^/?#{}][^?#{}]*$";
  const openapiRoutePattern = openapi.paths["/commerce/seller-integrity-audit"].get.parameters
    .find(({ name }) => name === "route").schema.pattern;
  const sellerIntegrityChallenge = decodePaymentRequiredHeader((await fetch(
    `${merchant.base}/commerce/seller-integrity-audit`,
  )).headers.get("payment-required"));
  const bazaarRoutePattern = sellerIntegrityChallenge.extensions.bazaar.schema.properties.input
    .properties.queryParams.properties.route.pattern;
  assert.equal(openapiRoutePattern, portableRoutePattern);
  assert.equal(bazaarRoutePattern, portableRoutePattern);
  assert.equal(portableRoutePattern.includes("(?"), false, "Bazaar patterns must avoid lookaround unsupported by CDP");
  const routePattern = new RegExp(portableRoutePattern);
  for (const route of ["/paid", "/commerce/payment-offer-preflight", "/a/b-c_1.2"]) {
    assert.equal(routePattern.test(route), true, `${route} must remain schema-valid`);
  }
  for (const route of ["/", "//paid", "/paid?x=1", "/paid#fragment", "/paid/{id}"]) {
    assert.equal(routePattern.test(route), false, `${route} must remain schema-invalid`);
  }
  const duplicateScalarRequests = ROUTES.flatMap((route) => (
    (openapi.paths[route.path]?.get?.parameters || [])
      .filter((parameter) => parameter.in === "query" && parameter.schema?.type !== "array")
      .map((parameter) => ({
        name: parameter.name,
        path: route.path,
        suffix: duplicateQueryParameter(route.valid, parameter.name),
      }))
  ));
  const duplicateScalarStatuses = [];
  for (const request of duplicateScalarRequests) {
    for (const [name, value] of [
      [null, null],
      ["payment-signature", "opaque-x402-credential"],
      ["authorization", "Payment opaque-mpp-credential"],
    ]) {
      const response = await fetch(`${merchant.base}${request.path}${request.suffix}`, {
        ...(name ? { headers: { [name]: value } } : {}),
      });
      const body = await response.text();
      let charged = null;
      try {
        charged = JSON.parse(body).charged;
      } catch {
        charged = null;
      }
      duplicateScalarStatuses.push({
        bodyExcerpt: body.slice(0, 160),
        charged,
        header: name,
        name: request.name,
        path: request.path,
        status: response.status,
      });
    }
  }

  const declaredArrayParameters = ROUTES.flatMap((route) => (
    (openapi.paths[route.path]?.get?.parameters || [])
      .filter((parameter) => parameter.in === "query" && parameter.schema?.type === "array")
      .map((parameter) => `${route.path}:${parameter.name}`)
  ));
  assert.deepEqual(declaredArrayParameters, [], "array-declared query parameters require an explicit repetition test");

  const canonicalChallenge = await fetch(`${merchant.base}${ROUTES[0].path}${ROUTES[0].valid}`);
  assert.equal(canonicalChallenge.status, 402);
  const x402Credential = await shapeValidX402Credential(canonicalChallenge.clone());
  const mppCredential = await shapeValidMppCredential(canonicalChallenge.clone());

  const canonicalX402 = await fetch(`${merchant.base}${ROUTES[0].path}${ROUTES[0].valid}`, {
    headers: { "payment-signature": x402Credential },
  });
  const canonicalX402Body = await canonicalX402.text();
  assert.equal(canonicalX402.status, 402, `shape-valid canonical x402 did not reach the fake facilitator: ${canonicalX402Body}; calls=${JSON.stringify(facilitator.calls)}`);
  assert.match(canonicalX402Body, /Facilitator verify failed/);
  assert.deepEqual(facilitator.calls.map(({ url }) => url), ["/verify"]);
  facilitator.calls.length = 0;

  const canonicalMpp = await fetch(`${merchant.base}${ROUTES[0].path}${ROUTES[0].valid}`, {
    headers: { authorization: mppCredential },
  });
  const canonicalMppBody = await canonicalMpp.text();
  assert.equal(canonicalMpp.status, 402, `shape-valid canonical MPP did not reach the fake facilitator: ${canonicalMppBody}; calls=${JSON.stringify(facilitator.calls)}`);
  assert.match(canonicalMppBody, /Verification Failed|verification-failed/);
  assert.deepEqual(facilitator.calls.map(({ url }) => url), ["/verify"]);
  facilitator.calls.length = 0;

  const duplicateByRoute = new Map();
  for (const request of duplicateScalarRequests) {
    if (!duplicateByRoute.has(request.path)) duplicateByRoute.set(request.path, request.suffix);
  }
  assert.equal(duplicateByRoute.size, ROUTES.length, "every paid GET needs a scalar duplicate probe");

  const pathVariantStatuses = [];
  for (const route of ROUTES) {
    const duplicate = duplicateByRoute.get(route.path);
    for (const variant of hostilePathVariants(route.path)) {
      for (const requestShape of [
        { name: "bare", suffix: "" },
        { name: "valid-input", suffix: route.valid },
        { name: "duplicate-scalar", suffix: duplicate },
      ]) {
        for (const credential of [
          { headers: {}, rail: "credential-free" },
          { headers: { "payment-signature": x402Credential }, rail: "x402" },
          { headers: { authorization: mppCredential }, rail: "mpp" },
        ]) {
          const observation = await rawGet(merchant.base, `${variant.path}${requestShape.suffix}`, credential.headers);
          pathVariantStatuses.push({
            ...observation,
            kind: variant.kind,
            path: route.path,
            rail: credential.rail,
            requestShape: requestShape.name,
          });
        }
      }
    }
  }
  const unsafePathVariants = pathVariantStatuses.filter(({ body, status }) => {
    if (![400, 404].includes(status)) return true;
    if (status === 404) return false;
    try {
      return JSON.parse(body).charged !== false;
    } catch {
      return true;
    }
  });
  assert.deepEqual(unsafePathVariants, [], `noncanonical paid paths escaped pre-payment rejection: ${JSON.stringify(unsafePathVariants)}`);
  assert.deepEqual(facilitator.calls, [], `noncanonical paid paths reached facilitator: ${JSON.stringify(facilitator.calls)}`);

  await expectStatus(
    merchant.base,
    `/defi/morpho-position?address=${ADDRESS}&shocks=not-a-number`,
    400,
  );
  await expectStatus(
    merchant.base,
    `/defi/morpho-position?address=${ADDRESS}&shocks=-10&shocks=-20`,
    400,
  );
  await expectStatus(
    merchant.base,
    "/schemaforge?site=https%3A%2F%2Fexample.com&city=a&city=b",
    400,
  );

  const rejectedBoundaryHeaders = CREDENTIALS.filter(([name, value]) => (
    value === "" || (name === "authorization" && /(?:^|,)\s*payment(?:\s|$)/i.test(value))
  ));
  const blockerStatuses = [];
  for (const [name, value] of rejectedBoundaryHeaders) {
    const response = await fetch(`${merchant.base}/extract`, { headers: { [name]: value } });
    blockerStatuses.push({ header: name, status: response.status, value });
  }
  assert.deepEqual(
    [
      ...duplicateScalarStatuses.filter(({ status }) => status !== 400),
      ...blockerStatuses.filter(({ status }) => status !== 400),
    ],
    [],
    `pre-payment blockers reproduced: ${JSON.stringify({ blockerStatuses, duplicateScalarStatuses })}`,
  );
  for (const observation of duplicateScalarStatuses) {
    assert.equal(observation.charged, false, `${observation.path} duplicate scalar lacked uncharged evidence`);
  }

  for (const route of ROUTES) {
    for (const [name, value] of CREDENTIALS) {
      for (const suffix of ["", route.invalid]) {
        const { body } = await expectStatus(
          merchant.base,
          `${route.path}${suffix}`,
          400,
          { headers: { [name]: value } },
        );
        assert.equal(JSON.parse(body).charged, false, `${route.path}${suffix} ${name} lacked uncharged evidence`);
      }
    }
  }

  assert.deepEqual(facilitator.calls, [], `pre-payment gate leaked to facilitator: ${JSON.stringify(facilitator.calls)}`);
  console.log(JSON.stringify({
    bareCredentialFree: { count: ROUTES.length, status: 402, x402Offers: ROUTES.length, mppOffers: ROUTES.length },
    credentialBearingInvalid: { count: ROUTES.length * CREDENTIALS.length * 2, status: 400 },
    credentialPresenceBoundary: { count: rejectedBoundaryHeaders.length, status: 400 },
    declaredArrayParameters: declaredArrayParameters.length,
    duplicateScalar: { count: duplicateScalarRequests.length, credentialBearingCount: duplicateScalarRequests.length * 2, status: 400 },
    facilitatorVerifyOrSettleCalls: facilitator.calls.length,
    mppCanonicalClientParsing: { count: ROUTES.length, failures: mppChallengeParseFailures.length },
    noncanonicalPaidPath: {
      count: pathVariantStatuses.length,
      requestShapeCount: 3,
      statusCounts: Object.fromEntries([...new Set(pathVariantStatuses.map(({ status }) => status))].sort().map((status) => [
        status,
        pathVariantStatuses.filter((entry) => entry.status === status).length,
      ])),
      variantCount: hostilePathVariants(ROUTES[0].path).length,
    },
    partialOrMalformed: { count: ROUTES.length * 2 + 3, status: 400 },
    validInput: { count: ROUTES.length, status: 402 },
  }));
});
