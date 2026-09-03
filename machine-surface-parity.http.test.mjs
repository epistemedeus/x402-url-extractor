import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import Ajv from "ajv";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { parseLlmsPaidRoutes, validateMachineSurfaceParity } from "./machine-surface-parity.mjs";
import { listDeclaredAgentDiscoverySources } from "./commerce-events.mjs";
import { opportunityPreflight } from "./opportunity-preflight.mjs";
import { CDP_RESOURCE_DESCRIPTION_MAX_CODE_POINTS } from "./x402-resource-compat.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_MISSING_FROM_LLMS = [
  "/defi/morpho-protection",
  "/work/opportunity-preflight",
  "/commerce/settlement-proof",
  "/chain/transaction-receipt",
  "/chain/solana-transaction-receipt",
];
const CIRCLE_ROUTE = "/gateway/commerce/payment-offer-preflight";
const SELLER_INTEGRITY_ROUTE = "/commerce/seller-integrity-audit";

function unusedPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
    server.once("error", reject);
  });
}

async function readJson(base, route) {
  const response = await fetch(`${base}${route}`);
  assert.equal(response.ok, true, `${route} ${response.status}`);
  return response.json();
}

async function readText(base, route) {
  const response = await fetch(`${base}${route}`);
  assert.equal(response.ok, true, `${route} ${response.status}`);
  return response.text();
}

function canonicalAddress(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)
    ? value.toLowerCase()
    : value;
}

function assertPortableSchemaPatterns(value, path = "$") {
  if (!value || typeof value !== "object") return;
  if (typeof value.pattern === "string") {
    assert.doesNotMatch(value.pattern, /\(\?(?:[=!]|<[=!])/, `${path}.pattern uses non-portable lookaround`);
  }
  for (const [key, child] of Object.entries(value)) {
    assertPortableSchemaPatterns(child, `${path}.${key}`);
  }
}

function exactPaymentTerm(requirement) {
  return {
    scheme: requirement.scheme,
    network: requirement.network,
    asset: canonicalAddress(requirement.asset),
    amount: requirement.amount,
    payTo: canonicalAddress(requirement.payTo),
    maxTimeoutSeconds: requirement.maxTimeoutSeconds,
    extra: {
      name: requirement.extra?.name,
      version: requirement.extra?.version,
      ...(requirement.extra?.verifyingContract !== undefined
        ? { verifyingContract: canonicalAddress(requirement.extra.verifyingContract) }
        : {}),
    },
  };
}

async function readUnpaidChallenge(base, item) {
  const declared = new URL(item.resource.url);
  const target = new URL(`${declared.pathname}${declared.search}`, base);
  const method = item.request?.method || "GET";
  const init = { method, headers: {} };
  if (method === "POST") {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(item.request?.example?.body || {});
  }
  const response = await fetch(target, init);
  assert.equal(response.status, 402, `${method} ${declared.pathname} ${response.status}`);
  const encoded = response.headers.get("payment-required");
  if (encoded) return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  return response.json();
}

test("live free surfaces keep canonical paid routes and kill Circle as a 23rd action", { timeout: 60_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "samedaydesk-surface-parity-"));
  const port = await unusedPort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd,
    env: {
      ...process.env,
      PORT: String(port),
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      MPP_SECRET_KEY: "",
      PUBLIC_URL: "https://agents.samedaydesk.com",
      X402_BUILDER_CODE: "bc_samedaydesk_test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const listening = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup timed out: ${output.slice(-2000)}`)), 20_000);
    const onData = (chunk) => {
      output = `${output}${chunk}`.slice(-20_000);
      if (!output.includes(`x402-merchant listening on :${port}`) || !output.includes("MCP server:  POST /mcp (23 paid tools)")) return;
      clearTimeout(timer);
      resolve(true);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`startup exited before listening: code=${code} signal=${signal}\n${output.slice(-4000)}`));
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  t.after(async () => {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once("exit", resolve);
      setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 2_000).unref();
    });
    await rm(dataDir, { recursive: true, force: true });
  });

  assert.equal(await listening, true);
  const base = `http://127.0.0.1:${port}`;
  const challengeResponse = await fetch(`${base}/extract?url=https%3A%2F%2Fexample.com`);
  assert.equal(challengeResponse.status, 402);
  const encodedChallenge = challengeResponse.headers.get("payment-required");
  assert.ok(encodedChallenge);
  const challenge = JSON.parse(Buffer.from(encodedChallenge, "base64").toString("utf8"));
  assert.equal(challenge.extensions?.["builder-code"]?.info?.a, "bc_samedaydesk_test");
  assert.equal(challenge.extensions?.["builder-code"]?.schema?.additionalProperties, false);
  const sellerIntegrityChallenge = await fetch(`${base}${SELLER_INTEGRITY_ROUTE}`);
  assert.equal(sellerIntegrityChallenge.status, 402);
  const encodedSellerIntegrityChallenge = sellerIntegrityChallenge.headers.get("payment-required");
  assert.ok(encodedSellerIntegrityChallenge);
  assert.ok(
    Buffer.byteLength(encodedSellerIntegrityChallenge) < 14_000,
    `seller-integrity payment-required header exceeds the Node-compatible budget: ${Buffer.byteLength(encodedSellerIntegrityChallenge)} bytes`,
  );
  const [llms, skill, catalog, gateway, agentCard, openapi, mppOpenapi, manifest, mcpDescriptor, commerceDemand] = await Promise.all([
    readText(base, "/llms.txt"),
    readText(base, "/skill.md"),
    readJson(base, "/api/actions"),
    readJson(base, "/"),
    readJson(base, "/.well-known/agent-card.json"),
    readJson(base, "/openapi.json"),
    readJson(base, "/mpp-openapi.json"),
    readJson(base, "/.well-known/x402"),
    readJson(base, "/mcp"),
    readJson(base, "/v0/commerce-demand.json?days=90"),
  ]);

  const client = new Client({ name: "surface-parity", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  let mcpToolNames;
  let mcpTools;
  try {
    mcpTools = (await client.listTools()).tools;
    mcpToolNames = mcpTools.map((tool) => tool.name);
  } finally {
    await client.close();
  }

  const receipt = validateMachineSurfaceParity({
    actions: catalog.actions,
    alternate: catalog.alternateAccess,
    openapi,
    mppOpenapi,
    manifestItems: manifest.items,
    mcpToolNames,
    agentCard,
    catalog,
    llms,
  });
  assert.equal(receipt.ok, true);
  const sellerIntegritySummary = openapi.paths[SELLER_INTEGRITY_ROUTE].get.summary;
  assert.equal(sellerIntegritySummary.length, 469);
  const sellerIntegrityManifest = manifest.items.find((item) => item.resource.routeTemplate === SELLER_INTEGRITY_ROUTE);
  assert.equal(sellerIntegrityManifest.resource.description, sellerIntegritySummary);
  assert.equal(
    JSON.parse(Buffer.from(encodedSellerIntegrityChallenge, "base64").toString("utf8")).resource.description,
    sellerIntegritySummary,
  );
  assert.equal(receipt.actionCount, 23);
  assert.equal(receipt.llmsCanonicalCount, 23);
  assert.equal(receipt.llmsAlternateCount, 1);
  assert.equal(receipt.mcpToolCount, 23);
  assert.equal(mcpDescriptor.toolCount, 23);
  assert.equal(manifest.items.length, 24);
  const declaredAgentSources = listDeclaredAgentDiscoverySources();
  assert.deepEqual(
    catalog.acquisition.declaredSourceHeader.allowedValues,
    declaredAgentSources.map(({ value }) => value),
  );
  assert.deepEqual(gateway.machineCommerce.declaredAgentSources, declaredAgentSources);
  assert.match(skill, /X-SameDayDesk-Agent-Source: agentcash-v1/);
  assert.match(skill, /Optional|optional/);
  for (const item of manifest.items) {
    assert.equal(item.resource.serviceName, "SameDayDesk");
    assert.equal(item.resource.iconUrl, "https://samedaydesk.com/favicon.svg");
    assert.ok(Array.isArray(item.resource.tags) && item.resource.tags.length > 0);
    const challenge = await readUnpaidChallenge(base, item);
    assert.equal(challenge.x402Version, 2);
    assert.ok(
      Array.from(challenge.resource.description).length <= CDP_RESOURCE_DESCRIPTION_MAX_CODE_POINTS,
      `${item.resource.routeTemplate} exceeds the live CDP resource-description boundary`,
    );
    const challengeUrl = new URL(challenge.resource.url, base);
    const manifestUrl = new URL(item.resource.url);
    assert.equal(`${challengeUrl.pathname}${challengeUrl.search}`, `${manifestUrl.pathname}${manifestUrl.search}`);
    assert.equal(challenge.resource.mimeType, item.resource.mimeType);
    assert.equal(challenge.resource.serviceName, item.resource.serviceName);
    assert.deepEqual(challenge.resource.tags, item.resource.tags);
    assert.equal(challenge.resource.iconUrl, item.resource.iconUrl);
    assertPortableSchemaPatterns(challenge.extensions?.bazaar?.schema, `${item.resource.routeTemplate}.bazaar.schema`);
    assert.deepEqual(
      challenge.accepts.map(exactPaymentTerm).sort((left, right) => left.network.localeCompare(right.network)),
      item.accepts.map(exactPaymentTerm).sort((left, right) => left.network.localeCompare(right.network)),
    );
  }

  const llmsRoutes = parseLlmsPaidRoutes(llms).map((entry) => entry.route);
  for (const route of SNAPSHOT_MISSING_FROM_LLMS) {
    assert.ok(llmsRoutes.includes(route), `llms.txt still missing ${route}`);
    assert.ok(catalog.actions.some((action) => action.route === route), `catalog missing ${route}`);
  }
  assert.ok(llmsRoutes.includes(CIRCLE_ROUTE));
  assert.equal(catalog.alternateAccess.route, CIRCLE_ROUTE);
  assert.equal(catalog.actions.some((action) => action.route === CIRCLE_ROUTE), false);
  assert.equal(JSON.stringify(agentCard).includes(CIRCLE_ROUTE), false);
  assert.equal(mcpToolNames.includes("circle_gateway"), false);
  assert.equal(openapi.paths[CIRCLE_ROUTE]?.get?.["x-payment-info"] != null, true);
  assert.equal(mppOpenapi.paths[CIRCLE_ROUTE], undefined);

  const commerceDemandSchema = openapi.paths["/v0/commerce-demand.json"]
    ?.get?.responses?.["200"]?.content?.["application/json"]?.schema;
  assert.ok(commerceDemandSchema, "commerce-demand 200 lacks application/json schema");
  assert.equal(commerceDemandSchema.required.includes("paymentEvidence"), true);
  const validateCommerceDemand = new Ajv({ allErrors: true, strict: false })
    .compile(commerceDemandSchema);
  assert.equal(validateCommerceDemand(commerceDemand), true, JSON.stringify(validateCommerceDemand.errors));

  const PRIOR_TYPED_MCP = [
    "scan",
    "morpho_protection",
    "morpho_preliquidation_replay",
    "payment_offer_preflight",
    "contract_qualified_search",
    "agent_surface_budget_audit",
    "settlement_proof",
  ];
  const NEW_TYPED_MCP = [
    "opportunity_preflight",
    "wallet_policy_conformance",
    "stateful_wallet_policy_conformance",
  ];
  const typed = mcpTools.filter((tool) => tool.outputSchema);
  assert.equal(typed.length, 10);
  for (const name of PRIOR_TYPED_MCP.concat(NEW_TYPED_MCP)) {
    const tool = mcpTools.find((entry) => entry.name === name);
    assert.ok(tool, `missing MCP tool ${name}`);
    assert.equal(tool.outputSchema?.type, "object");
    assert.equal(tool.outputSchema.additionalProperties, false);
  }

  const paidPost200 = [
    ["/work/opportunity-preflight", "ok", "economics"],
    ["/security/wallet-policy-conformance", "schemaVersion", "exactShapePassed"],
    ["/security/stateful-wallet-policy-conformance", "schemaVersion", "strictBudgetPassed"],
  ];
  for (const [path, ...required] of paidPost200) {
    const schema = openapi.paths[path]?.post?.responses?.["200"]?.content?.["application/json"]?.schema;
    assert.ok(schema, `OpenAPI POST ${path} 200 lacks application/json schema`);
    assert.equal(schema.additionalProperties, false);
    for (const field of required) {
      assert.equal(schema.required.includes(field), true, `POST ${path} 200 omitted required ${field}`);
    }
    const mppSchema = mppOpenapi.paths[path]?.post?.responses?.["200"]?.content?.["application/json"]?.schema;
    assert.deepEqual(mppSchema?.required, schema.required);
  }

  const bazaarRoutes = [
    { route: "/work/opportunity-preflight", field: "economics" },
    { route: "/security/wallet-policy-conformance", field: "exactShapePassed" },
    { route: "/security/stateful-wallet-policy-conformance", field: "strictBudgetPassed" },
  ];
  for (const { route, field } of bazaarRoutes) {
    const action = catalog.actions.find((entry) => entry.route === route);
    assert.ok(action?.response?.schema, `catalog missing response schema for ${route}`);
    assert.equal(action.response.schema.additionalProperties, false);
    assert.equal(action.response.schema.required.includes(field), true, `catalog ${route} omitted ${field}`);
  }

  const opportunityGet = openapi.paths["/work/opportunity-preflight"]?.get;
  const opportunityPost = openapi.paths["/work/opportunity-preflight"]?.post;
  const getSchema = opportunityGet?.responses?.["200"]?.content?.["application/json"]?.schema;
  const postSchema = opportunityPost?.responses?.["200"]?.content?.["application/json"]?.schema;
  const catalogAction = catalog.actions.find((entry) => entry.route === "/work/opportunity-preflight");
  const catalogSchema = catalogAction?.response?.schema;
  const mppGetSchema = mppOpenapi.paths["/work/opportunity-preflight"]?.get?.responses?.["200"]?.content?.["application/json"]?.schema;
  assert.equal(catalogAction?.method, "GET");
  assert.equal(getSchema?.additionalProperties, false);
  assert.equal(mppGetSchema?.additionalProperties, false);
  assert.equal(catalogSchema?.additionalProperties, false);
  assert.deepEqual(catalogSchema.required, postSchema.required);
  assert.deepEqual(getSchema.required, postSchema.required);
  assert.equal(postSchema.additionalProperties, false);
  assert.equal(Object.hasOwn(postSchema.properties, "sample"), false);
  assert.equal(Object.hasOwn(postSchema.properties, "charged"), false);
  assert.equal(Object.hasOwn(postSchema.properties, "trial"), false);
  assert.equal(Object.hasOwn(getSchema.properties, "sample"), true);
  assert.equal(Object.hasOwn(getSchema.properties, "charged"), true);
  assert.equal(Object.hasOwn(getSchema.properties, "trial"), true);
  assert.equal(getSchema.required.includes("trial"), false);
  assert.equal(catalogSchema.required.includes("trial"), false);
  assert.equal(opportunityGet.parameters.some((parameter) => parameter.name === "trial"), false);
  assert.deepEqual(
    opportunityGet.parameters.map((parameter) => parameter.name),
    [
      "platform",
      "rewardUsd",
      "hours",
      "hourlyCostUsd",
      "computeUsd",
      "mandatorySpendUsd",
      "reusableValueUsd",
      "selectionProbabilityPct",
      "competition",
      "slots",
      "agentAccess",
      "acceptance",
      "settlement",
    ],
  );

  const trialResponse = await fetch(`${base}/work/opportunity-preflight?trial=1`);
  assert.equal(trialResponse.status, 200, `trial GET ${trialResponse.status}`);
  const trialBody = await trialResponse.json();
  const paidBody = opportunityPreflight({
    rewardUsd: 10,
    hours: 0.25,
    hourlyCostUsd: 4,
    computeUsd: 0.5,
    mandatorySpendUsd: 0,
    reusableValueUsd: 1,
    selectionProbabilityPct: 80,
    competition: 1,
    slots: 1,
    agentAccess: "agent_allowed",
    acceptance: "deterministic",
    settlement: "escrow",
  });
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validateGet = ajv.compile(structuredClone(getSchema));
  const validateCatalog = ajv.compile(structuredClone(catalogSchema));
  const validatePost = ajv.compile(structuredClone(postSchema));
  assert.equal(validateGet(trialBody), true, JSON.stringify(validateGet.errors, null, 2));
  assert.equal(validateCatalog(trialBody), true, JSON.stringify(validateCatalog.errors, null, 2));
  assert.equal(validatePost(JSON.parse(JSON.stringify(paidBody))), true, JSON.stringify(validatePost.errors, null, 2));
  assert.equal(validatePost(trialBody), false);
  assert.ok((validatePost.errors || []).some((error) => (
    error.keyword === "additionalProperties"
    && ["sample", "charged", "trial"].includes(error.params?.additionalProperty)
  )));
  const opportunityMcp = mcpTools.find((tool) => tool.name === "opportunity_preflight");
  assert.equal(opportunityMcp.outputSchema.additionalProperties, false);
  assert.equal(opportunityMcp.outputSchema.required.includes("trial"), false);
});
