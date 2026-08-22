import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  applyDiscoveryRequestExamples,
  collectOpenApiRequestExampleFindings,
  hasUnresolvedTemplate,
  isCredentialLikeValue,
  isSensitiveExampleName,
  isScalarQueryValue,
  unsafeExampleFindings,
  validateExampleAgainstSchema,
} from "./openapi-request-example-parity.mjs";
import { SERVICE_VERSION } from "./service-version.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));

// Every required GET request input named in the accepted-construction gap.
const REQUIRED_QUERY_EXAMPLE_INPUTS = Object.freeze([
  Object.freeze(["GET", "/work/opportunity-preflight", "rewardUsd"]),
  Object.freeze(["GET", "/work/opportunity-preflight", "hours"]),
  Object.freeze(["GET", "/work/opportunity-preflight", "hourlyCostUsd"]),
  Object.freeze(["GET", "/chain/transaction-receipt", "transactionHash"]),
  Object.freeze(["GET", "/extract", "url"]),
  Object.freeze(["GET", "/read", "url"]),
  Object.freeze(["GET", "/scan", "repo"]),
  Object.freeze(["GET", "/schemaforge", "site"]),
  Object.freeze(["GET", "/enrich", "domain"]),
  Object.freeze(["GET", "/wallet-enrich", "address"]),
  Object.freeze(["GET", "/defi/morpho-position", "address"]),
  Object.freeze(["GET", "/defi/morpho-protection", "address"]),
  Object.freeze(["GET", "/defi/morpho-market-underwrite", "marketId"]),
  Object.freeze(["GET", "/defi/morpho-preliquidation-replay", "transactionHash"]),
]);

// The four canonical paid JSON-body POST operations.
const PAID_POST_ROUTES = Object.freeze([
  Object.freeze(["POST", "/work/opportunity-preflight"]),
  Object.freeze(["POST", "/commerce/payment-offer-preflight"]),
  Object.freeze(["POST", "/security/wallet-policy-conformance"]),
  Object.freeze(["POST", "/security/stateful-wallet-policy-conformance"]),
]);

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

test("classifies unsafe example names, values, and templates", () => {
  assert.equal(isSensitiveExampleName("api_token"), true);
  assert.equal(isSensitiveExampleName("accessToken"), true);
  assert.equal(isSensitiveExampleName("session-id"), true);
  assert.equal(isSensitiveExampleName("__proto__"), true);
  assert.equal(isSensitiveExampleName("rewardUsd"), false);
  assert.equal(isSensitiveExampleName("hourlyCostUsd"), false);
  assert.equal(isCredentialLikeValue("Bearer abc.def"), true);
  assert.equal(isCredentialLikeValue("sk-live-abc123"), true);
  assert.equal(isCredentialLikeValue("eyJhbGciOi.eyJzdWIi.sig"), true);
  assert.equal(isCredentialLikeValue("https://example.com/page"), false);
  assert.equal(hasUnresolvedTemplate("{url}"), true);
  assert.equal(hasUnresolvedTemplate("https://example.com"), false);
  assert.equal(isScalarQueryValue("https://example.com"), true);
  assert.equal(isScalarQueryValue(10), true);
  assert.equal(isScalarQueryValue(false), true);
  assert.equal(isScalarQueryValue(""), false);
  assert.equal(isScalarQueryValue({ url: "https://example.com" }), false);
  assert.equal(isScalarQueryValue(undefined), false);
});

test("walks example trees for credential-like keys, prototype names, and templates", () => {
  assert.deepEqual(unsafeExampleFindings({ ok: true, url: "https://example.com" }), []);
  assert.ok(unsafeExampleFindings({ api_token: "not-a-secret" }).includes("$.api_token: credential-like example key"));
  assert.ok(unsafeExampleFindings({ nested: { constructor: {} } }).some((entry) => entry.includes("prototype name")));
  assert.ok(unsafeExampleFindings({ note: "{missing}" }).includes("$.note: unresolved template in example value"));
  assert.ok(unsafeExampleFindings({ header: "Bearer zzz" }).includes("$.header: credential-like example value"));
});

test("validates examples against the OpenAPI schema vocabulary this document emits", () => {
  assert.deepEqual(validateExampleAgainstSchema(10, { type: "number", exclusiveMinimum: 0 }), []);
  assert.ok(validateExampleAgainstSchema(0, { type: "number", exclusiveMinimum: 0 }).length > 0);
  assert.ok(validateExampleAgainstSchema(-1, { type: "number", minimum: 0 }).length > 0);
  assert.deepEqual(validateExampleAgainstSchema(`0x${"a".repeat(40)}`, { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" }), []);
  assert.ok(validateExampleAgainstSchema("nope", { type: "string", enum: ["base", "ethereum"] }).length > 0);
  assert.ok(validateExampleAgainstSchema("not-a-timestamp", { type: "string", format: "date-time" }).length > 0);
  assert.deepEqual(validateExampleAgainstSchema("https://example.com", { type: "string", format: "uri" }), []);
  assert.ok(validateExampleAgainstSchema("https://u:p@example.com", { type: "string", format: "uri" }).length > 0);
  assert.ok(validateExampleAgainstSchema(1.5, { type: "integer" }).length > 0);
  assert.deepEqual(
    validateExampleAgainstSchema(
      { url: "https://example.com" },
      { type: "object", properties: { url: { type: "string", format: "uri" } }, required: ["url"], additionalProperties: false },
    ),
    [],
  );
  assert.ok(
    validateExampleAgainstSchema(
      { catalog: { source: "x" } },
      { type: "object", properties: { url: { type: "string" }, catalog: { type: "object" } }, required: ["url"], additionalProperties: false },
    ).length > 0,
  );
});

function paidGetOperation(parameters) {
  return { get: { "x-payment-info": {}, parameters, responses: {} } };
}

test("projects discovery-contract examples without overriding authored ones", () => {
  const extractContract = {
    example: { type: "http", method: "GET", queryParams: { url: "https://example.com" } },
    schema: { type: "object", properties: { queryParams: { required: ["url"] } } },
  };
  const authoredContract = {
    example: { type: "http", method: "GET", queryParams: { marketId: `0x${"1".repeat(64)}` } },
    schema: { type: "object", properties: { queryParams: { required: ["marketId"] } } },
  };
  const document = { paths: {
    "/extract": paidGetOperation([
      { name: "url", in: "query", required: true, schema: { type: "string" } },
    ]),
    "/authored": paidGetOperation([
      { name: "marketId", in: "query", required: true, schema: { type: "string", example: "keep-me" } },
    ]),
    "/free": paidGetOperation([{ name: "url", in: "query", required: true, schema: { type: "string" } }]),
  } };
  const receipt = applyDiscoveryRequestExamples(document, (routeKey) => (
    routeKey === "GET /extract" ? extractContract : routeKey === "GET /authored" ? authoredContract : null
  ));
  assert.deepEqual(receipt, { ok: true, queryExamples: 1, bodyExamples: 0 });
  assert.equal(document.paths["/extract"].get.parameters[0].example, "https://example.com");
  assert.equal(document.paths["/extract"].get.parameters[0].schema.example, undefined);
  assert.equal(document.paths["/authored"].get.parameters[0].schema.example, "keep-me");
  assert.equal(document.paths["/authored"].get.parameters[0].example, undefined);
  assert.equal(document.paths["/free"].get.parameters[0].example, undefined);
});

test("projects POST JSON-body examples and fails loudly on drift", () => {
  const contract = {
    example: { type: "http", method: "POST", bodyType: "json", body: { url: "https://example.com" } },
    schema: { type: "object" },
  };
  const document = { paths: {
    "/preflight": { post: { "x-payment-info": {}, requestBody: { content: { "application/json": { schema: { type: "object" } } } } } },
  } };
  const receipt = applyDiscoveryRequestExamples(document, () => contract);
  assert.deepEqual(receipt, { ok: true, queryExamples: 0, bodyExamples: 1 });
  assert.deepEqual(document.paths["/preflight"].post.requestBody.content["application/json"].example, { url: "https://example.com" });
  assert.throws(() => applyDiscoveryRequestExamples({
    paths: { "/preflight": { post: { "x-payment-info": {}, requestBody: { content: { "application/json": { schema: {} } } } } } },
  }, () => ({ example: { method: "POST" }, schema: {} })), /lacks a JSON body example/);
  assert.throws(() => applyDiscoveryRequestExamples({
    paths: { "/extract": paidGetOperation([{ name: "rewardUsd", in: "query", required: true, schema: { type: "number" } }]) },
  }, () => ({
    example: { type: "http", method: "GET", queryParams: { url: "https://example.com" } },
    schema: { type: "object", properties: { queryParams: { required: ["url"] } } },
  })), /declares no query parameter for required discovery input url/);
});

test("parity gate reports lost request examples and unsafe or mismatched projections", () => {
  const actions = [
    { method: "GET", route: "/extract" },
    { method: "POST", route: "/work/opportunity-preflight" },
  ];
  const healthy = { paths: {
    "/extract": paidGetOperation([{ name: "url", in: "query", required: true, schema: { type: "string" }, example: "https://example.com" }]),
    "/work/opportunity-preflight": { post: {
      "x-payment-info": {},
      requestBody: {
        content: {
          "application/json": {
            schema: { type: "object", properties: { rewardUsd: { type: "number", exclusiveMinimum: 0 } }, required: ["rewardUsd"] },
            example: { rewardUsd: 10 },
          },
        },
      },
    } },
  } };
  assert.deepEqual(collectOpenApiRequestExampleFindings({ document: healthy, actions }), []);

  const lostQuery = structuredClone(healthy);
  delete lostQuery.paths["/extract"].get.parameters[0].example;
  assert.ok(collectOpenApiRequestExampleFindings({ document: lostQuery, actions })
    .includes("GET /extract: required query input url lost its accepted request example"));

  const nonScalar = structuredClone(healthy);
  nonScalar.paths["/extract"].get.parameters[0].example = { url: "https://example.com" };
  assert.ok(collectOpenApiRequestExampleFindings({ document: nonScalar, actions })
    .includes("GET /extract: required query input url example is not a non-empty scalar"));

  const templated = structuredClone(healthy);
  templated.paths["/extract"].get.parameters[0].example = "{your-url-here}";
  assert.ok(collectOpenApiRequestExampleFindings({ document: templated, actions })
    .includes("GET /extract: required query input url example contains an unresolved template"));

  const credential = structuredClone(healthy);
  credential.paths["/extract"].get.parameters[0] = { name: "api_token", in: "query", required: true, schema: { type: "string" }, example: "Bearer zz" };
  assert.ok(collectOpenApiRequestExampleFindings({ document: credential, actions })
    .some((finding) => finding.includes("credential-like") && finding.startsWith("GET /extract")));

  const bodyMismatch = structuredClone(healthy);
  delete bodyMismatch.paths["/work/opportunity-preflight"].post.requestBody.content["application/json"].example.rewardUsd;
  assert.ok(collectOpenApiRequestExampleFindings({ document: bodyMismatch, actions })
    .includes("POST /work/opportunity-preflight: $.rewardUsd: required by schema but absent from example"));

  const bodyLost = structuredClone(healthy);
  delete bodyLost.paths["/work/opportunity-preflight"].post.requestBody.content["application/json"].example;
  assert.ok(collectOpenApiRequestExampleFindings({ document: bodyLost, actions })
    .includes("POST /work/opportunity-preflight: JSON request body lost its accepted construction example"));
});

test("live generated OpenAPI keeps version, 22 paid success schemas, and zero missing request examples", { timeout: 60_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "samedaydesk-openapi-parity-"));
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
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const listening = new Promise((resolve, reject) => {
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
      reject(new Error(`startup exited before listening: code=${code} signal=${signal}\n${output.slice(-4000)}`));
    });
    child.once("error", reject);
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
  assert.equal(SERVICE_VERSION, "1.23.20");
  const base = `http://127.0.0.1:${port}`;
  const catalog = await readJson(base, "/api/actions");
  assert.equal(catalog.actions.length, 22);

  for (const [profile, route] of [["agentcash", "/openapi.json"], ["mpp", "/mpp-openapi.json"]]) {
    const document = await readJson(base, route);
    assert.equal(document.openapi, "3.1.0");
    assert.equal(document.info.version, "1.23.20");

    let formalSuccessSchemas = 0;
    for (const action of catalog.actions) {
      const operation = document.paths[action.route]?.[String(action.method || "GET").toLowerCase()];
      assert.ok(operation, `${action.method} ${action.route} missing from ${profile} OpenAPI`);
      assert.ok(operation["x-payment-info"], `${action.method} ${action.route} lost x-payment-info in ${profile}`);
      const successSchema = operation.responses?.["200"]?.content?.["application/json"]?.schema;
      assert.ok(successSchema && typeof successSchema === "object", `${action.method} ${action.route} lost its formal 2xx JSON response schema in ${profile}`);
      formalSuccessSchemas += 1;
    }
    assert.equal(formalSuccessSchemas, 22);

    const findings = collectOpenApiRequestExampleFindings({ document, actions: catalog.actions });
    assert.deepEqual(findings, []);

    for (const [method, path, name] of REQUIRED_QUERY_EXAMPLE_INPUTS) {
      const parameter = document.paths[path].get.parameters.find((entry) => entry.in === "query" && entry.name === name && entry.required === true);
      assert.ok(parameter, `${method} ${path} missing required query input ${name} in ${profile}`);
      assert.ok(isScalarQueryValue(parameter.example ?? parameter.schema?.example), `${method} ${path} query input ${name} lacks a scalar example in ${profile}`);
    }
    for (const [method, path] of PAID_POST_ROUTES) {
      const bodyExample = document.paths[path].post.requestBody.content["application/json"].example;
      assert.ok(bodyExample && typeof bodyExample === "object", `${method} ${path} lacks a JSON-body request example in ${profile}`);
    }
  }
});
