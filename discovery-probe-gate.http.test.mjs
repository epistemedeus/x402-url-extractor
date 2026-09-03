import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const ADDRESS = `0x${"1".repeat(40)}`;
const HASH = `0x${"2".repeat(64)}`;
const SOLANA_SIGNATURE = "GKYyX4foVCLRN4b8b7qBTXXf9iEAtrdqzez4U1rwgEhUt99cmyXwPQ4JhsEu4PFbWFNj3ZKZbxTVNwHJKK17ahc";

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
    path: "/x402/monitor",
    invalid: "?origin=https%3A%2F%2Fexample.com",
    valid: "?route=%2Fcommerce%2Fpayment-offer-preflight",
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
  const server = createHttpServer((req, res) => {
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
    res.end(JSON.stringify({ error: "facilitator must not receive a rejected request" }));
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

async function startMerchant({ dataDir, facilitatorUrl }) {
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
      X402_TEST_AUDIT_REPORT: JSON.stringify({
        schemaVersion: "agent-payment-integrity.audit.v4",
        checkedAt: "2026-08-12T07:50:00.000Z",
        versions: { x402: "1.0.0", mpp: "1.0.0" },
        ok: true,
        machineBuyable: true,
        routes: [{
          status: 402,
          method: "GET",
          runtimeChallengeVerified: true,
          probe: { attempted: true, reason: null },
          protocols: ["mpp", "x402"],
          valid: true,
          findings: [],
          economics: { x402: { amountAtomic: "5000" }, mpp: { amountAtomic: "5000" } },
          discovery: { bazaar: { present: true, valid: true } },
          responseContract: { decision: "admissible", requiredPaths: [] },
          repairPlan: {
            mode: "advisory_openapi_repair",
            requiredPaths: [],
            guaranteedPaths: [],
            actions: [],
            complete: true,
            boundary: { schemaMutationApplied: false, propertyTypesInferred: false, sellerRuntimeVerified: false, statement: "stub" },
          },
        }],
      }),
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

async function expectStatus(base, route, status, init) {
  const response = await fetch(`${base}${route}`, init);
  const body = await response.text();
  assert.equal(response.status, status, `${route} returned ${response.status}: ${body}`);
  return { body, response };
}

function duplicateFirstScalar(valid, parameters) {
  const query = new URLSearchParams(valid.slice(1));
  const scalar = parameters.find((parameter) => (
    parameter.in === "query" && parameter.schema?.type !== "array" && query.has(parameter.name)
  ));
  assert.ok(scalar, "paid GET route has no supplied scalar query parameter");
  const value = query.get(scalar.name);
  query.append(scalar.name, value);
  return `?${query.toString()}`;
}

test("all paid GET routes expose bare terms without letting malformed paid requests reach a rail", { timeout: 120_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "samedaydesk-discovery-probe-"));
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => {
    if (merchant) await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url });

  assert.equal(ROUTES.length, 21);
  const openapi = await fetch(`${merchant.base}/openapi.json`).then((response) => response.json());
  for (const route of ROUTES) {
    const bare = await expectStatus(merchant.base, route.path, 402);
    assert.ok(bare.response.headers.get("payment-required"), `${route.path} omitted x402 terms`);
    assert.match(bare.response.headers.get("www-authenticate") || "", /^Payment /, `${route.path} omitted MPP terms`);

    const invalid = await expectStatus(merchant.base, `${route.path}${route.invalid}`, 400);
    assert.equal(JSON.parse(invalid.body).charged, false, `${route.path} invalid input lacked uncharged evidence`);
    await expectStatus(merchant.base, `${route.path}${route.valid}`, 402);

    for (const headers of [
      { "payment-signature": "opaque-x402-credential" },
      { authorization: "Payment opaque-mpp-credential" },
    ]) {
      for (const suffix of ["", route.invalid]) {
        const rejected = await expectStatus(merchant.base, `${route.path}${suffix}`, 400, { headers });
        assert.equal(JSON.parse(rejected.body).charged, false, `${route.path}${suffix} lacked uncharged evidence`);
      }
    }

    const duplicate = duplicateFirstScalar(route.valid, openapi.paths[route.path].get.parameters || []);
    const duplicateResponse = await expectStatus(merchant.base, `${route.path}${duplicate}`, 400);
    assert.equal(JSON.parse(duplicateResponse.body).charged, false, `${route.path} duplicate scalar lacked uncharged evidence`);
  }

  assert.deepEqual(facilitator.calls, [], `rejected requests reached facilitator: ${JSON.stringify(facilitator.calls)}`);
});
