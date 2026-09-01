import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  attachProbePayload,
  checkEndpointSchema,
  checkL2ForOpenAPI,
  getOpenAPI,
  getWarningsFor402Body,
  getWarningsForL3,
  isOpenApiParseFailure,
  VALIDATION_CODES,
} from "@agentcash/discovery";
import { declareDiscoveryContract } from "./discovery-contract.mjs";
import { paymentOfferPreflightOutputSchema } from "./payment-offer-preflight.mjs";
import {
  CIRCLE_GATEWAY_PATH,
  buildCircleGatewayRoute,
} from "./circle-gateway-route.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const SELLER = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";

function paymentOfferPreflightDiscoveryExtensions(routeKey) {
  return declareDiscoveryContract({
    routeKey,
    input: {
      url: "https://agents.samedaydesk.com/defi/morpho-position?address=0x8ee9c15c3e5332cbc6ef39a2bb036c63c6549b6e",
    },
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          format: "uri",
          maxLength: 2048,
          description: "Exact public HTTPS GET URL to inspect.",
        },
      },
      required: ["url"],
      additionalProperties: false,
    },
    output: {
      example: {
        ok: true,
        product: "samedaydesk-payment-offer-preflight",
        version: "1.2.0",
        checkedAt: "2026-08-10T20:00:00.000Z",
        target: { method: "GET", url: "https://agents.samedaydesk.com/defi/morpho-position?address=0x8ee9c15c3e5332cbc6ef39a2bb036c63c6549b6e", httpStatus: 402 },
        decision: "parseable_offer",
        protocols: ["mpp", "x402"],
        offerCount: 2,
        offers: [{ protocol: "x402", scheme: "exact", intent: "exact", network: "eip155:8453", amountAtomic: "20000", valid: true }],
        parity: { compared: true, consistent: true, driftFields: [] },
        catalogCoherence: [],
        responseContract: { decision: "admissible", requiredFields: ["ok", "title", "url"], requiredPaths: ["ok", "title", "url"], exampleStatus: "structurally_consistent", runtimeResponseVerified: false },
        responseContractAcquisition: { attempted: true, sameOrigin: true, path: "/openapi.json", maxBytes: 1000000, documentRead: true, targetResponseBodyRead: false, credentialsUsed: false, redirectsFollowed: false },
        findings: [],
        boundary: { credentialsUsed: false, paymentSigned: false, paymentSent: false, targetResponseBodyRead: false, openApiDocumentRead: true, redirectsFollowed: false },
      },
    },
    outputSchema: paymentOfferPreflightOutputSchema(),
  });
}

function schemaWarningsForPaymentRequiredBody(body) {
  return getWarningsFor402Body(body).filter((warning) => (
    warning.code === VALIDATION_CODES.SCHEMA_INPUT_MISSING
    || warning.code === VALIDATION_CODES.SCHEMA_OUTPUT_MISSING
  ));
}

function decodePaymentRequiredHeader(header) {
  return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
}

function isSchemaDiscoveryWarning(warning) {
  return warning.code === VALIDATION_CODES.SCHEMA_INPUT_MISSING
    || warning.code === VALIDATION_CODES.SCHEMA_OUTPUT_MISSING;
}

async function getL3WarningsForUrl(url) {
  const result = await checkEndpointSchema({ url });
  if (!result.found) return getWarningsForL3(null);
  const paidOpenApiAdvisories = result.advisories.filter(
    (advisory) => advisory.source === "openapi"
      && (advisory.authMode === "paid" || advisory.authMode === "apiKey+paid"),
  );
  if (paidOpenApiAdvisories.length > 0) {
    await attachProbePayload(url, paidOpenApiAdvisories);
  }
  return result.advisories.flatMap((advisory) => getWarningsForL3(advisory));
}

async function discoverOriginSchemaWarnings(origin) {
  const openApiResult = await getOpenAPI(origin);
  if (openApiResult.isErr()) {
    const { cause, message } = openApiResult.error;
    throw new Error(`AgentCash OpenAPI fetch failed for ${origin}: ${cause}${message ? ` (${message})` : ""}`);
  }
  const openApiRaw = openApiResult.value;
  if (openApiRaw === null) {
    throw new Error(`AgentCash OpenAPI fetch returned no document for ${origin}`);
  }
  if (isOpenApiParseFailure(openApiRaw)) {
    throw new Error(`AgentCash OpenAPI parse failed for ${origin}`);
  }
  const { routes } = checkL2ForOpenAPI(openApiRaw);
  if (routes.length === 0) {
    throw new Error(`AgentCash OpenAPI discovery found no routes for ${origin}`);
  }
  const warningGroups = await Promise.all(
    routes.map((route) => getL3WarningsForUrl(`${origin}${route.path}`)),
  );
  return warningGroups.flat();
}

test("Circle Gateway payment-required payload exposes AgentCash-readable bazaar schemas", () => {
  let challengeHeader;
  const integration = buildCircleGatewayRoute({
    sellerAddress: SELLER,
    extensions: paymentOfferPreflightDiscoveryExtensions(`GET ${CIRCLE_GATEWAY_PATH}`),
    middlewareFactory() {
      return {
        require() {
          return (_req, res) => res.setHeader("PAYMENT-REQUIRED", Buffer.from(JSON.stringify({
            x402Version: 2,
            resource: { url: CIRCLE_GATEWAY_PATH, description: "fixture", mimeType: "application/json" },
            accepts: [{
              scheme: "exact",
              network: "eip155:8453",
              asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
              amount: "5000",
              payTo: SELLER,
            }],
          })).toString("base64"));
        },
      };
    },
  });
  integration.middleware({}, {
    setHeader(name, value) {
      if (String(name).toLowerCase() === "payment-required") challengeHeader = value;
    },
  }, () => {});

  const challenge = decodePaymentRequiredHeader(challengeHeader);
  assert.equal(schemaWarningsForPaymentRequiredBody(challenge).length, 0);
  assert.ok(challenge.extensions?.bazaar?.schema?.properties?.input?.properties?.queryParams);
  assert.ok(challenge.extensions?.bazaar?.schema?.properties?.output?.properties?.example);
});

test("local origin passes official AgentCash discover without bazaar schema errors", { timeout: 120_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "agentcash-discovery-"));
  const port = await new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port: chosenPort } = server.address();
      server.close((error) => (error ? reject(error) : resolve(chosenPort)));
    });
    server.once("error", reject);
  });
  const origin = `http://127.0.0.1:${port}`;

  const child = spawn(process.execPath, ["server.js"], {
    cwd,
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_URL: "https://agents.samedaydesk.com",
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      MPP_SECRET_KEY: "",
      CIRCLE_GATEWAY_ENABLED: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
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

  let output = "";
  const listening = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup timed out: ${output.slice(-2000)}`)), 20_000);
    const onData = (chunk) => {
      output = `${output}${chunk}`.slice(-20_000);
      if (!output.includes(`x402-merchant listening on :${port}`)) return;
      clearTimeout(timer);
      resolve(true);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`server exited before listening: code=${code} signal=${signal}\n${output.slice(-4000)}`));
    });
  });
  assert.equal(listening, true);

  const gatewayUrl = `${origin}${CIRCLE_GATEWAY_PATH}?url=https%3A%2F%2Fexample.com`;
  const challengeResponse = await fetch(gatewayUrl);
  assert.equal(challengeResponse.status, 402);
  const encodedChallenge = challengeResponse.headers.get("payment-required");
  assert.ok(encodedChallenge);
  const challenge = decodePaymentRequiredHeader(encodedChallenge);
  assert.equal(schemaWarningsForPaymentRequiredBody(challenge).length, 0);

  const schemaWarnings = (await discoverOriginSchemaWarnings(origin)).filter(isSchemaDiscoveryWarning);
  assert.deepEqual(schemaWarnings, []);
});
