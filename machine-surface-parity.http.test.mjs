import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import Ajv from "ajv";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { x402Client } from "@x402/core/client";
import { encodePaymentRequiredHeader } from "@x402/core/http";
import { x402ResourceServer } from "@x402/core/server";
import { extractDiscoveryInfo } from "@x402/extensions/bazaar";
import { createOfferReceiptExtension } from "@x402/extensions/offer-receipt";
import { validateBazaarContract } from "agent-payment-integrity";

import { mcpToolNameForRoute, parseLlmsPaidRoutes, validateMachineSurfaceParity } from "./machine-surface-parity.mjs";
import { compareMcpCatalog } from "./mcp-catalog-projection.mjs";
import { listDeclaredAgentDiscoverySources } from "./commerce-events.mjs";
import { opportunityPreflight } from "./opportunity-preflight.mjs";
import { CDP_RESOURCE_DESCRIPTION_MAX_CODE_POINTS } from "./x402-resource-compat.mjs";
import { validatePaymentRequiredHeader } from "./bazaar-contract-audit.mjs";
import { SELLER_INTEGRITY_AUDIT_EXAMPLE, sellerIntegrityAuditOutputSchema } from "./seller-integrity-audit.mjs";
import { mirrorLegacyX402Body } from "./x402-legacy-body.mjs";
import { activeNoHumansClaimProof } from "./nohumans-claim-proof.mjs";

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
const COMPLETE_AUDIT = `${SELLER_INTEGRITY_ROUTE}?origin=https%3A%2F%2Fagents.samedaydesk.com&route=%2Fcommerce%2Fpayment-offer-preflight&requiredPaths=decision%2Coffers`;
const EXTRACT_CONTROL = "/extract?url=https%3A%2F%2Fexample.com";
const PAYMENT_REQUIRED_LINE_BUDGET = 7500; // Includes framing, 690 bytes below aiohttp's 8190-byte default.

function paymentRequiredLineBytes(encoded) {
  return Buffer.byteLength(`PAYMENT-REQUIRED: ${encoded}\r\n`);
}

async function receiptExtensionForBudget(quote) {
  // Exercise the installed extension's actual envelope and schema with a
  // prebuilt 65-byte signature placeholder. No private key or signer is used.
  const { enrichPaymentRequiredResponse } = createOfferReceiptExtension({
    issueOffer: async (resourceUrl, { acceptIndex, scheme, network, asset, payTo, amount }) => ({
      format: "eip712", acceptIndex,
      payload: { version: 1, resourceUrl, scheme, network, asset, payTo, amount, validUntil: 1_800_000_000 },
      signature: `0x${"00".repeat(65)}`,
    }),
  });
  return enrichPaymentRequiredResponse({ includeTxHash: true }, {
    paymentRequiredResponse: quote, requirements: quote.accepts,
  });
}

async function checkAuditQuote(base, route, t) {
  const response = await fetch(base + route);
  assert.equal(response.status, 402);
  const encoded = response.headers.get("payment-required");
  assert.ok(encoded);
  const quote = JSON.parse(Buffer.from(encoded, "base64"));
  const legacy = await response.json();
  const bytes = paymentRequiredLineBytes(encoded);
  t.diagnostic(`Node ${route}: ${response.status}; PAYMENT-REQUIRED value=${encoded.length}, line=${bytes}`);
  assert.ok(bytes <= PAYMENT_REQUIRED_LINE_BUDGET, `audit quote line is ${bytes} bytes`);
  assert.equal(quote.resource.url, base + route);
  assert.deepEqual(legacy.resource, quote.resource);
  assert.deepEqual(quote.accepts.map(exactPaymentTerm), [{
    scheme: "exact", network: "eip155:8453", asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    amount: "10000", payTo: "0x8904df3de6dfee6a7c8cc38619d2f17806213cee", maxTimeoutSeconds: 300,
    extra: { name: "USD Coin", version: "2" },
  }]);
  assert.equal(legacy.accepts[0].maxAmountRequired, quote.accepts[0].amount);
  assert.deepEqual(validatePaymentRequiredHeader(encoded), { valid: true, errors: [] });

  const bazaar = quote.extensions.bazaar;
  const fullBazaar = legacy.extensions.bazaar;
  const fullQuote = { ...quote, extensions: { ...quote.extensions, bazaar: fullBazaar } };
  assert.deepEqual(fullBazaar.schema.properties.output.properties.example, sellerIntegrityAuditOutputSchema());
  assert.deepEqual(bazaar.info.output, { type: "json" });
  assert.deepEqual(validateBazaarContract(bazaar), { valid: true, findings: [] });
  const [accepted] = quote.accepts;
  const client = x402Client.fromConfig({
    schemes: [{ network: accepted.network, client: {
      scheme: "exact",
      createPaymentPayload: async (x402Version) => ({ x402Version, payload: { fixture: true } }),
    } }],
    spendControls: { allowedAssets: [{ network: accepted.network, asset: accepted.asset, maxAmountPerPayment: "10000" }] },
  });
  const echo = await client.createPaymentPayload(quote);
  assert.deepEqual(echo.extensions, quote.extensions);
  const indexed = extractDiscoveryInfo(echo, accepted);
  const fullIndexed = extractDiscoveryInfo({ ...echo, extensions: fullQuote.extensions }, accepted);
  assert.equal(indexed.resourceUrl, base + SELLER_INTEGRITY_ROUTE);
  assert.equal(indexed.method, "GET");
  assert.deepEqual(indexed.discoveryInfo, fullIndexed.discoveryInfo);
  assert.deepEqual(indexed.extensions.bazaar.schema.properties.input, fullIndexed.extensions.bazaar.schema.properties.input);
  assert.deepEqual(new x402ResourceServer().validateExtensions(fullQuote, echo), { valid: true });

  const offerReceipt = await receiptExtensionForBudget(quote);
  const withReceipt = { ...fullQuote, extensions: { ...fullQuote.extensions, "offer-receipt": offerReceipt } };
  const mirrored = mirrorLegacyX402Body({
    status: 402, body: {}, headers: {
      "Content-Type": "application/json", "PAYMENT-REQUIRED": encodePaymentRequiredHeader(withReceipt),
    },
  });
  const encodedWithReceipt = mirrored.headers["PAYMENT-REQUIRED"];
  const receiptBytes = paymentRequiredLineBytes(encodedWithReceipt);
  t.diagnostic(`Audit line with synthetic receipt envelope: ${receiptBytes} bytes`);
  assert.ok(receiptBytes <= PAYMENT_REQUIRED_LINE_BUDGET, `audit quote with receipt is ${receiptBytes} bytes`);
  assert.deepEqual(JSON.parse(Buffer.from(encodedWithReceipt, "base64")), {
    ...quote, extensions: { ...quote.extensions, "offer-receipt": offerReceipt },
  });
  assert.deepEqual(mirrored.body, { ...legacy, extensions: withReceipt.extensions });
  return { quote, legacy, bytes };
}

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

test("NoHumans proof refuses missing, malformed, multiline and expired configuration", () => {
  const now = 1_800_000_000_000;
  const cfg = (token, expiresAt) => JSON.stringify({ token, expiresAt });
  assert.equal(activeNoHumansClaimProof(undefined, now), null);
  assert.equal(activeNoHumansClaimProof("{", now), null);
  assert.equal(activeNoHumansClaimProof(cfg("fake-proof", now), now), null);
  assert.equal(activeNoHumansClaimProof(cfg("fake-proof", now + 86_400_001), now), null);
  assert.equal(activeNoHumansClaimProof(cfg("fake\nproof", now + 1), now), null);
  assert.equal(activeNoHumansClaimProof(cfg("fake-proof", now + 1), now), "fake-proof");
});

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
      NOHUMANS_PUBLIC_CLAIM_PROOF: JSON.stringify({ token: "fake-proof", expiresAt: Date.now() + 120_000 }),
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
  const proofResponse = await fetch(base + "/.well-known/nohumans-claim");
  assert.equal(proofResponse.status, 200);
  assert.match(proofResponse.headers.get("content-type"), /^text\/plain\b/i);
  assert.equal(proofResponse.headers.get("cache-control"), "no-store");
  assert.equal(proofResponse.headers.get("payment-required"), null);
  assert.equal(await proofResponse.text(), "fake-proof");
  const wrongProofPath = await fetch(base + "/.well-known/nohumans-claim?token=other");
  assert.equal(wrongProofPath.status, 404);
  assert.equal(await wrongProofPath.text(), "");
  const challengeResponse = await fetch(base + EXTRACT_CONTROL);
  assert.equal(challengeResponse.status, 402);
  const encodedChallenge = challengeResponse.headers.get("payment-required");
  assert.ok(encodedChallenge);
  const extractBytes = paymentRequiredLineBytes(encodedChallenge);
  t.diagnostic(`Node extract control: ${challengeResponse.status}; PAYMENT-REQUIRED value=${encodedChallenge.length}, line=${extractBytes}`);
  const challenge = JSON.parse(Buffer.from(encodedChallenge, "base64").toString("utf8"));
  assert.equal(challenge.extensions?.["builder-code"]?.info?.a, "bc_samedaydesk_test");
  assert.equal(challenge.extensions?.["builder-code"]?.schema?.additionalProperties, false);
  const bareAudit = await checkAuditQuote(base, SELLER_INTEGRITY_ROUTE, t);
  const completeAudit = await checkAuditQuote(base, COMPLETE_AUDIT, t);
  const { quote: sellerIntegrityTerms, legacy: legacyChallenge } = bareAudit;
  assert.deepEqual(completeAudit.quote.extensions, sellerIntegrityTerms.extensions);
  assert.deepEqual(sellerIntegrityTerms.extensions["builder-code"], challenge.extensions["builder-code"]);
  assert.deepEqual(sellerIntegrityTerms.extensions["payment-identifier"], challenge.extensions["payment-identifier"]);
  const bazaar = sellerIntegrityTerms.extensions.bazaar;
  const queryExample = bazaar.info.input.queryParams;
  assert.equal(Object.hasOwn(queryExample, "referral"), false, "Bazaar must not supply a referral ID");
  const legacyReferral = legacyChallenge.accepts[0].outputSchema.input.queryParams.referral;
  assert.equal(legacyReferral.required, false);
  assert.equal(Object.hasOwn(legacyReferral, "default"), false);

  const referral = `r1_${"a".repeat(64)}`;
  const validateQuery = new Ajv({ strict: false, validateFormats: false })
    .compile(bazaar.schema.properties.input.properties.queryParams);
  assert.equal(validateQuery(queryExample), true);
  assert.equal(validateQuery({ ...queryExample, referral }), true);
  assert.equal(validateQuery({ ...queryExample, referral: "invalid" }), false);
  const callerUrl = new URL(`${base}${SELLER_INTEGRITY_ROUTE}`);
  callerUrl.search = new URLSearchParams({ ...queryExample, referral });
  const callerResponse = await fetch(callerUrl);
  assert.equal(callerResponse.status, 402);
  const callerTerms = JSON.parse(Buffer.from(callerResponse.headers.get("payment-required"), "base64").toString("utf8"));
  assert.equal(callerTerms.resource.url, callerUrl.href);
  assert.deepEqual(callerTerms.accepts, sellerIntegrityTerms.accepts);
  assert.deepEqual(callerTerms.extensions.bazaar.info.input.queryParams, queryExample);

  // Run explicitly with a Python environment containing aiohttp 3.14.5.
  if (process.env.AIOHTTP_QUOTE_PYTHON) {
    const { stdout } = await promisify(execFile)(process.env.AIOHTTP_QUOTE_PYTHON, [
      "python/aiohttp-quote-budget.py", base, EXTRACT_CONTROL, SELLER_INTEGRITY_ROUTE, COMPLETE_AUDIT,
    ], { cwd, timeout: 15_000 });
    const measured = JSON.parse(stdout);
    t.diagnostic(`Python ${measured.python}, aiohttp ${measured.aiohttp}: ${JSON.stringify(measured.responses)}`);
    assert.deepEqual(measured.responses, [extractBytes, bareAudit.bytes, completeAudit.bytes].map((lineBytes) => ({ status: 402, lineBytes })));
  }

  const humanBefore = await (await fetch(base + "/", { headers: { Accept: "text/html" } })).text();
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

  const preflightSource = "https://github.com/epistemedeus/agent-payment-integrity/tree/f6acc1c56c6fd977608fb6c97c088d36ea27f955";
  const previewHeading = "## Free seller preview";
  const preview = (doc) => doc.split(previewHeading)[1]?.split("\n## ")[0];
  const llmsPreview = preview(llms);
  assert.ok(llmsPreview, "llms.txt must offer a free seller preview before payment");
  assert.equal(preview(skill)?.trim(), llmsPreview.trim(), "machine entry points must agree");
  assert.ok(llms.indexOf(previewHeading) < llms.indexOf("## How to pay"));
  assert.ok(skill.indexOf(previewHeading) < skill.indexOf("## AgentCash"));
  assert.ok(llmsPreview.includes(preflightSource));
  assert.match(llmsPreview, /node cli\.mjs audit --origin \S+ --method GET --route \/commerce\/seller-integrity-audit --required-paths report\.findings,report\.repairPlan\.actions --max-routes 1 --format json --public-dns/);
  assert.match(llmsPreview, /No wallet, credentials, signing, or payment/);
  assert.match(llmsPreview, /does not validate required query values or the paid response/);
  assert.match(llmsPreview, /does not authorize spending/);
  assert.equal(humanBefore.includes(preflightSource), false);
  assert.equal(catalog.actions.filter((action) => action.route === SELLER_INTEGRITY_ROUTE).length, 1);

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
  const extractOperation = openapi.paths["/extract"].get;
  const extractOption = extractOperation.parameters.find((parameter) => parameter.name === "textExcerptLimitChars");
  const extractTool = mcpTools.find((tool) => tool.name === "extract");
  const extractResource = manifest.items.find((item) => item.resource.routeTemplate === "/extract").resource;
  const extractTerms = await fetch(`${base}/extract?url=https%3A%2F%2Fexample.com%2F`);
  const extractQuote = JSON.parse(Buffer.from(extractTerms.headers.get("payment-required"), "base64"));
  await extractTerms.body.cancel();
  const extractQuoteOption = extractQuote.extensions.bazaar.schema.properties.input.properties.queryParams.properties.textExcerptLimitChars;
  assert.equal(extractOption.required, false);
  assert.deepEqual(extractOption.schema, { type: "integer", minimum: 1, maximum: 40000 });
  assert.equal(extractTool.inputSchema.required.includes("textExcerptLimitChars"), false);
  assert.equal(extractQuoteOption.minimum, 1);
  assert.equal(extractQuoteOption.maximum, 40000);
  assert.match(extractOption.description, /default 1200.*Invalid values are rejected before payment/);
  assert.equal(extractTool.inputSchema.properties.textExcerptLimitChars.description, extractOption.description);
  assert.equal(extractQuoteOption.description, extractOption.description);
  assert.ok(extractTool.description.includes(extractOption.description));
  assert.match(extractTool.description, /Payment challenge and credentials are bound to GET/);
  assert.equal(extractOperation.summary, extractQuote.resource.description);
  assert.equal(extractOperation.summary, extractResource.description);
  assert.ok(llms.includes(extractOperation.summary));
  assert.ok(gateway.paidRoutes["GET /extract?url="].includes(extractOperation.summary));
  assert.equal(humanBefore.includes(extractOperation.summary), false, "machine copy must not publish on the human landing page");

  const recoveryTool = mcpTools.find((tool) => tool.name === "recover_paid_result");
  assert.ok(recoveryTool, "mounted server lists the free recovery read");
  assert.equal(recoveryTool._meta?.samedaydesk?.charged, false);
  assert.equal(recoveryTool._meta?.samedaydesk?.paymentRequired, false);
  assert.equal(recoveryTool._meta?.x402?.paymentRequired, undefined);
  assert.equal(mcpToolNames.filter((name) => name === "recover_paid_result").length, 1);
  for (const action of catalog.actions) {
    const tool = mcpTools.find((entry) => entry.name === mcpToolNameForRoute(action.route));
    assert.ok(tool, `missing MCP tool for ${action.method} ${action.route}`);
    assert.equal(tool.description.includes(`bound to ${action.method} ${action.url}, not mcp://`), true, tool.description);
    assert.equal(String(action.description).includes("not mcp://"), false);
    const skill = agentCard.skills.find((entry) => entry.description.includes(`direct ${action.method} ${action.route} `));
    assert.ok(skill, `A2A skill omitted ${action.method} ${action.route}`);
  }
  for (const name of ["careers_board_cold", "report_caller_result", "recover_paid_result"]) {
    const tool = mcpTools.find((entry) => entry.name === name);
    assert.ok(tool, `missing free tool ${name}`);
    assert.equal(String(tool.description).includes("not mcp://"), false);
    assert.equal(tool._meta?.samedaydesk?.charged, false);
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
    rootPaidRoutes: gateway.paidRoutes,
    callerResultClient: catalog.callerResultClient,
  });
  const humanAfter = await (await fetch(base + "/", { headers: { Accept: "text/html" } })).text();
  assert.equal(humanAfter, humanBefore, "machine root construction mutated the human map");
  assert.equal(Object.keys(gateway.paidRoutes).length, catalog.actions.length + (catalog.alternateAccess ? 1 : 0));
  assert.match(gateway.paidRoutes["GET /data/careers-board?board="], /^\$0\.005 - /);
  assert.equal(receipt.ok, true);
  // These documents are acquired directly by agents that may not see the
  // website or skill. Keep the support handoff consistent across profiles.
  const contact = { email: "contact@neomorphic.io", url: "https://samedaydesk.com" };
  assert.deepEqual(openapi.info.contact, contact);
  assert.deepEqual(mppOpenapi.info.contact, contact);
  for (const alias of ["/openapi.yaml", "/swagger.json", "/openapi.mpp.json"]) {
    assert.deepEqual((await readJson(base, alias)).info.contact, contact, alias);
  }

  const sellerIntegritySummary = openapi.paths[SELLER_INTEGRITY_ROUTE].get.summary;
  assert.equal(sellerIntegritySummary.length, 469);
  const sellerIntegrityAction = catalog.actions.find((action) => action.route === SELLER_INTEGRITY_ROUTE);
  const sellerIntegrityOutput = openapi.paths[SELLER_INTEGRITY_ROUTE].get.responses["200"].content["application/json"].schema;
  assert.deepEqual(sellerIntegrityOutput, sellerIntegrityAuditOutputSchema());
  assert.deepEqual(sellerIntegrityAction.response, {
    mimeType: "application/json", schema: sellerIntegrityOutput, example: SELLER_INTEGRITY_AUDIT_EXAMPLE,
  });
  assert.deepEqual(sellerIntegrityAction.request.schema.properties.queryParams, bazaar.schema.properties.input.properties.queryParams);
  assert.deepEqual(sellerIntegrityAction.request.example.queryParams, queryExample);
  assert.equal(new URL(sellerIntegrityAction.request.exampleUrl).searchParams.has("referral"), false);
  const sellerIntegrityManifest = manifest.items.find((item) => item.resource.routeTemplate === SELLER_INTEGRITY_ROUTE);
  assert.equal(sellerIntegrityManifest.resource.description, sellerIntegritySummary);
  assert.equal(sellerIntegrityTerms.resource.description, sellerIntegritySummary);
  assert.equal(receipt.actionCount, 23);
  assert.equal(receipt.llmsCanonicalCount, 23);
  assert.equal(receipt.llmsAlternateCount, 1);
  assert.equal(receipt.mcpToolCount, 23);
  assert.equal(mcpDescriptor.paidToolCount, 23);
  assert.equal(mcpDescriptor.registered, true);
  const catalogAgreement = compareMcpCatalog(mcpDescriptor, mcpTools);
  assert.equal(catalogAgreement.ok, true, JSON.stringify(catalogAgreement.differences));
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
    "extract",
    "read",
  ];
  const typed = mcpTools.filter((tool) => tool.outputSchema);
  // trial_read is the one free typed tool. The thirteen paid names stay typed.
  assert.equal(typed.length, 14);
  for (const name of PRIOR_TYPED_MCP.concat(NEW_TYPED_MCP, ["trial_read"])) {
    const tool = mcpTools.find((entry) => entry.name === name);
    assert.ok(tool, `missing MCP tool ${name}`);
    assert.equal(tool.outputSchema?.type, "object");
    assert.equal(tool.outputSchema.additionalProperties, false);
  }
  const trialRead = mcpTools.find((entry) => entry.name === "trial_read");
  assert.equal(trialRead.outputSchema.properties.charged.const, false);
  assert.equal(trialRead.annotations?.idempotentHint, false);

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
    assert.equal(mppSchema, undefined, "disabled MPP must not declare paid POSTs");
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
  assert.equal(mppGetSchema, undefined, "disabled MPP must not declare paid GETs");
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
