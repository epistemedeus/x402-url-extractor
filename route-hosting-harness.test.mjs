import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  CANDIDATE_MANIFEST_RELATIVE,
  CANDIDATE_TREE_PATHS,
  EVIDENCE_SCHEMA,
  HARNESS_SCHEMA,
  HarnessError,
  MISSING_BINDING,
  OPERATION_ID,
  OPERATION_KEY,
  PACKAGING_EXCLUSIONS,
  PINNED_BASE_GENERATION,
  PINNED_NODE,
  PINNED_SOURCE_GENERATION,
  PINNED_STACK_DIGEST,
  PRECURSOR_SCHEMA,
  SAMPLE_COUNT,
  WARMUP_COUNT,
  assertCandidateManifest,
  assertPinnedRuntime,
  assertPinnedSourceBlobs,
  assertProductionRouteSeam,
  captureHarnessRunOptions,
  canonicalize,
  frozenAuditImpl,
  parseHttp1Response,
  readPinnedBaseGeneration,
  readPinnedSourceGeneration,
  runRouteHostingHarness,
  sha256,
  sourceDefaultsFromTree,
} from "./route-hosting-harness.mjs";
import {
  MerchantCompositionError,
  captureMerchantCompositionOptions,
  createMerchantApp,
} from "./server.js";
import {
  declareDiscoveryContract,
  getDiscoveryRequestContract,
} from "./discovery-contract.mjs";
import * as discoveryContract from "./discovery-contract.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(cwd, "test-fixtures/route-hosting-harness/v1.json");

function loadFixture() {
  return JSON.parse(readFileSync(FIXTURE, "utf8"));
}

function httpResponse({
  status = "HTTP/1.1 200 OK",
  headers = ["Connection: close", "Content-Length: 2"],
  body = "{}",
} = {}) {
  return Buffer.from(`${status}\r\n${headers.join("\r\n")}\r\n\r\n${body}`, "utf8");
}

describe("route hosting harness", { concurrency: 1 }, () => {
test("pins Node, base generation, candidate tree, and the registered wrapper seam", () => {
  assertPinnedRuntime();
  assert.equal(process.versions.node, PINNED_NODE);
  assert.equal(readPinnedSourceGeneration(), PINNED_SOURCE_GENERATION);
  assert.equal(readPinnedBaseGeneration(), PINNED_BASE_GENERATION);
  assertPinnedSourceBlobs();
  assertProductionRouteSeam();
  const defaults = sourceDefaultsFromTree();
  assert.equal(defaults.network, "eip155:8453");
  assert.equal(defaults.price, "$0.01");
  const bound = assertCandidateManifest();
  assert.equal(bound.manifest.deployedGeneration, MISSING_BINDING);
  assert.equal(bound.manifest.baseGeneration, PINNED_BASE_GENERATION);
  for (const relativePath of CANDIDATE_TREE_PATHS) {
    assert.equal(bound.files[relativePath], sha256(readFileSync(path.join(cwd, relativePath))), relativePath);
  }
});

test("source middleware order swaps fail closed", () => {
  const source = readFileSync(path.join(cwd, "server.js"), "utf8");
  const swapped = source
    .replace("app.use(paidActionEffectHeaders);", "__SWAP_A__")
    .replace("app.use(commerceTelemetry.middleware);", "app.use(paidActionEffectHeaders);")
    .replace("__SWAP_A__", "app.use(commerceTelemetry.middleware);");
  assert.throws(
    () => assertProductionRouteSeam(swapped),
    (error) => error instanceof HarnessError && error.code === "middleware_order_drift",
  );
});

test("parseHttp1Response measures status-line, headers, and body exactly once", () => {
  const parsed = parseHttp1Response(httpResponse());
  assert.equal(parsed.status, 200);
  assert.equal(parsed.bytes.statusLine + parsed.bytes.headers + parsed.bytes.body, parsed.bytes.total);
  assert.equal(parsed.bytes.body, 2);
  assert.equal(parsed.headerMap.get("connection"), "close");
});

test("fails closed on duplicate headers, content-length mismatch, compression, and keep-alive", () => {
  assert.throws(
    () => parseHttp1Response(httpResponse({ headers: ["Connection: close", "Content-Length: 2", "Content-Length: 2"] })),
    (error) => error instanceof HarnessError && error.code === "duplicate_headers",
  );
  assert.throws(
    () => parseHttp1Response(httpResponse({ headers: ["Connection: close", "Content-Length: 9"] })),
    (error) => error instanceof HarnessError && error.code === "content_length_mismatch",
  );
  assert.throws(
    () => parseHttp1Response(httpResponse({ headers: ["Connection: close", "Content-Length: 2", "Content-Encoding: gzip"] })),
    (error) => error instanceof HarnessError && error.code === "compressed_vs_uncompressed",
  );
  assert.throws(
    () => parseHttp1Response(httpResponse({ headers: ["Connection: close", "Content-Length: 2", "Transfer-Encoding: chunked"] })),
    (error) => error instanceof HarnessError && error.code === "chunked_framing",
  );
  assert.throws(
    () => parseHttp1Response(httpResponse({ headers: ["Connection: keep-alive", "Content-Length: 2"] })),
    (error) => error instanceof HarnessError && error.code === "connection_policy",
  );
});

test("frozen audit impl is clone-isolated from later mutation", async () => {
  const first = await frozenAuditImpl()();
  first.decision = "tampered";
  first.routes[0].status = 500;
  const second = await frozenAuditImpl()();
  assert.equal(second.routes[0].status, 402);
  assert.equal(second.ok, true);
  assert.equal(first.ok, true);
});

test("hostile harness run options fail closed", async () => {
  const accessor = {};
  Object.defineProperty(accessor, "includeEvidence", {
    enumerable: true,
    get() { return false; },
  });
  assert.throws(
    () => captureHarnessRunOptions(accessor),
    (error) => error instanceof HarnessError && error.code === "hostile_inputs",
  );
  assert.throws(
    () => captureHarnessRunOptions(Object.create({ includeEvidence: false })),
    (error) => error instanceof HarnessError && error.code === "hostile_inputs",
  );
  assert.throws(
    () => captureHarnessRunOptions(new Proxy({ includeEvidence: false }, {})),
    (error) => error instanceof HarnessError && error.code === "hostile_inputs",
  );
  await assert.rejects(runRouteHostingHarness(accessor), (error) => (
    error instanceof HarnessError && error.code === "hostile_inputs"
  ));
});

test("hostile merchant composition options fail closed", () => {
  const accessor = {};
  Object.defineProperty(accessor, "dataDir", {
    enumerable: true,
    get() { return "/tmp"; },
  });
  assert.throws(
    () => captureMerchantCompositionOptions(accessor),
    (error) => error instanceof MerchantCompositionError && error.code === "hostile_composition_options",
  );
  assert.throws(
    () => captureMerchantCompositionOptions(new Proxy({ dataDir: "/tmp" }, {})),
    (error) => error instanceof MerchantCompositionError && error.code === "hostile_composition_options",
  );
  assert.throws(
    () => captureMerchantCompositionOptions({ unexpected: true }),
    (error) => error instanceof MerchantCompositionError && error.code === "unknown_composition_option",
  );
});

function validFacilitatorMethods(calls = { getSupported: 0, verify: 0, settle: 0, marker: "original" }) {
  return {
    async getSupported() {
      calls.getSupported += 1;
      return { kinds: [], extensions: [] };
    },
    async verify() {
      calls.verify += 1;
      return { isValid: true, marker: calls.marker };
    },
    async settle() {
      calls.settle += 1;
      return { success: true, marker: calls.marker };
    },
  };
}

test("nested hostile facilitator accessors, extras, symbols, prototypes, and proxies fail closed", () => {
  let gettersInvoked = 0;
  const accessorClient = Object.create(null);
  for (const name of ["getSupported", "verify", "settle"]) {
    Object.defineProperty(accessorClient, name, {
      enumerable: true,
      get() {
        gettersInvoked += 1;
        return async () => ({ hostile: true });
      },
    });
  }
  assert.throws(
    () => captureMerchantCompositionOptions({ facilitatorClient: accessorClient }),
    (error) => error instanceof MerchantCompositionError && error.code === "hostile_composition_options",
  );
  assert.equal(gettersInvoked, 0);

  assert.throws(
    () => captureMerchantCompositionOptions({
      facilitatorClient: { ...validFacilitatorMethods(), url: "https://hostile.example" },
    }),
    (error) => error instanceof MerchantCompositionError && error.code === "hostile_composition_options",
  );
  assert.throws(
    () => captureMerchantCompositionOptions({
      facilitatorClient: { ...validFacilitatorMethods(), [Symbol("extra")]: async () => {} },
    }),
    (error) => error instanceof MerchantCompositionError && error.code === "hostile_composition_options",
  );
  assert.throws(
    () => captureMerchantCompositionOptions({ facilitatorClient: Object.create(validFacilitatorMethods()) }),
    (error) => error instanceof MerchantCompositionError && error.code === "hostile_composition_options",
  );
  assert.throws(
    () => captureMerchantCompositionOptions({ facilitatorClient: new Proxy(validFacilitatorMethods(), {}) }),
    (error) => error instanceof MerchantCompositionError && error.code === "hostile_composition_options",
  );
});

test("captured facilitator methods stay bound after later caller mutation", async () => {
  const calls = { getSupported: 0, verify: 0, settle: 0, marker: "original" };
  const client = validFacilitatorMethods(calls);
  const captured = captureMerchantCompositionOptions({ facilitatorClient: client });
  assert.equal(Object.isFrozen(captured.facilitatorClient), true);
  client.verify = async () => ({ isValid: true, marker: "replaced" });
  const verified = await captured.facilitatorClient.verify();
  assert.equal(verified.marker, "original");
  assert.equal(verified.isValid, true);
});

test("failed merchant factory preserves the active complete discovery registry", () => {
  assert.equal(Object.hasOwn(discoveryContract, "resetDiscoveryContracts"), false);
  declareDiscoveryContract({
    routeKey: "GET /factory-preserve-probe",
    input: { url: "https://preserve.example" },
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
    output: { example: { ok: true } },
    outputSchema: {
      type: "object",
      properties: { ok: { type: "boolean" } },
      required: ["ok"],
    },
  });
  const before = getDiscoveryRequestContract("GET /factory-preserve-probe");
  assert.equal(before.example.queryParams.url, "https://preserve.example");
  assert.throws(() => createMerchantApp({ publicUrl: "https://hostile.example" }), /origin does not match/);
  assert.deepEqual(getDiscoveryRequestContract("GET /factory-preserve-probe"), before);
});

test("test-only harness files are excluded from npm and railway packaging", () => {
  const npmignore = readFileSync(path.join(cwd, ".npmignore"), "utf8");
  const railwayignore = readFileSync(path.join(cwd, ".railwayignore"), "utf8");
  for (const entry of PACKAGING_EXCLUSIONS) {
    assert.equal(npmignore.includes(entry), true, `.npmignore missing ${entry}`);
    assert.equal(railwayignore.includes(entry), true, `.railwayignore missing ${entry}`);
  }
});

test("offline production-app loopback matches the pinned fixture and authority ceiling", { timeout: 60_000 }, async () => {
  const fixture = loadFixture();
  const result = await runRouteHostingHarness({ includeEvidence: true });
  assert.equal(result.encoded, `${canonicalize(fixture)}\n`);
  assert.equal(result.receipt.schemaVersion, HARNESS_SCHEMA);
  assert.equal(result.receipt.operation, OPERATION_KEY);
  assert.equal(result.receipt.operationId, OPERATION_ID);
  assert.equal(result.receipt.routeEvidenceClass, "production_registered_loopback_http11");
  assert.equal(result.receipt.authority.sourceKind, "owner_measured_harness");
  assert.equal(result.receipt.authority.sourceAuthority, "seller_observed");
  assert.equal(result.receipt.binding.rail, MISSING_BINDING);
  assert.equal(result.receipt.binding.facilitatorId, MISSING_BINDING);
  assert.equal(result.receipt.binding.deployedGeneration, MISSING_BINDING);
  assert.equal(result.receipt.baseGeneration, PINNED_BASE_GENERATION);
  assert.equal("sourceGeneration" in result.receipt, false);
  assert.equal(result.receipt.candidateManifest, CANDIDATE_MANIFEST_RELATIVE);
  assert.equal(result.receipt.candidateTreeSha256, assertCandidateManifest().candidateTreeSha256);
  assert.notEqual(result.receipt.binding.deployedGeneration, result.receipt.baseGeneration);
  assert.equal(result.receipt.binding.environment, "test");
  assert.equal(result.receipt.precursor.missingBindings.includes("deployment"), true);
  assert.equal(result.receipt.precursor.missingBindings.includes("B1"), true);
  assert.equal(result.receipt.precursor.missingBindings.includes("demand"), true);
  assert.equal(result.receipt.precursor.missingBindings.includes("payment"), true);
  assert.equal(result.receipt.precursor.missingBindings.includes("settlement"), true);
  assert.equal(result.receipt.precursor.missingBindings.includes("revenue"), true);
  assert.equal(result.receipt.claims.numericMicroUsd, false);
  assert.equal(result.receipt.claims.productionInvoice, false);
  assert.equal(result.receipt.claims.evaluatorAdmissible, false);
  assert.equal(result.receipt.claims.copiedWrapper, false);
  assert.equal(result.receipt.claims.reconstructedMiddleware, false);
  assert.equal(result.receipt.precursor.schemaVersion, PRECURSOR_SCHEMA);
  assert.equal(result.receipt.precursor.amountUnknown, true);
  assert.equal(result.receipt.precursor.evaluatorAdmissible, false);
  assert.equal(result.receipt.precursor.rawResource.unit, "http11_serialized_bytes");
  assert.equal("evaluatorObservation" in result.receipt, false);
  assert.equal(result.receipt.stackDigest, PINNED_STACK_DIGEST);
  assert.equal(result.receipt.extractionBoundary.compositionSeam, "createMerchantApp");
  assert.equal(result.receipt.extractionBoundary.registeredWrapper, "serveSellerIntegrityAudit");
  assert.equal(result.receipt.extractionBoundary.copiedWrapper, false);
  assert.equal(result.receipt.extractionBoundary.reconstructedMiddleware, false);
  assert.equal(result.receipt.extractionBoundary.injectedOutboundAuditFixture, true);
  assert.equal(result.receipt.extractionBoundary.productionDefaultUsesInjectedAudit, false);
  assert.equal("productionBypassAdded" in result.receipt.extractionBoundary, false);
  assert.equal(result.receipt.cases.challenge.status, 402);
  assert.equal(result.receipt.cases.paid_success.status, 200);
  assert.equal(result.receipt.cases.paid_success.fixtureBackedOutboundAudit, true);
  assert.equal(result.receipt.cases.paid_success.syntheticPayment, true);
  assert.equal(
    result.receipt.cases.challenge.bytes.statusLine
      + result.receipt.cases.challenge.bytes.headers
      + result.receipt.cases.challenge.bytes.body,
    result.receipt.cases.challenge.bytes.total,
  );
  assert.equal(
    result.receipt.cases.paid_success.bytes.statusLine
      + result.receipt.cases.paid_success.bytes.headers
      + result.receipt.cases.paid_success.bytes.body,
    result.receipt.cases.paid_success.bytes.total,
  );
  assert.equal(JSON.stringify(result.receipt).includes("elapsedNs"), false);
  assert.equal(JSON.stringify(result.receipt).includes("cpuUserUs"), false);
  assert.equal(JSON.stringify(result.receipt).includes("\"unit\":\"micro_usd\""), false);
  assert.equal(result.receipt.precursor.nonClaims.includes("numeric_micro_usd"), true);
  assert.equal(result.evidence.schemaVersion, EVIDENCE_SCHEMA);
  assert.equal(result.evidence.samples.challenge.length, SAMPLE_COUNT);
  assert.equal(result.evidence.samples.paid_success.length, SAMPLE_COUNT);
  assert.equal(result.receipt.measurementPolicy.warmup, WARMUP_COUNT);
  assert.equal(result.receipt.measurementPolicy.connection, "close");
  assert.match(result.encoded, /^\{/);
  assert.equal(result.encoded.includes("0x"), false);
  assert.equal(result.encoded.toUpperCase().includes(["PAYMENT", "SIGNATURE"].join("-")), false);
  assert.equal(result.calls.handler, WARMUP_COUNT + SAMPLE_COUNT);
  assert.equal(result.calls.verify, WARMUP_COUNT + SAMPLE_COUNT);
  assert.equal(result.calls.settle, WARMUP_COUNT + SAMPLE_COUNT);
});

test("a second harness run reproduces the fixture byte-for-byte", { timeout: 60_000 }, async () => {
  const fixture = loadFixture();
  const again = await runRouteHostingHarness();
  assert.equal(again.encoded, `${canonicalize(fixture)}\n`);
  assert.equal(sha256(again.encoded), sha256(`${canonicalize(fixture)}\n`));
});

test("CLI emits the stable receipt and optional evidence without secrets", { timeout: 60_000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "route-hosting-cli-"));
  const evidencePath = path.join(dir, "evidence.json");
  try {
    const child = spawn(process.execPath, ["route-hosting-harness.mjs", "--evidence", evidencePath], {
      cwd,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    assert.equal(code, 0, stderr.slice(-2000));
    const fixture = loadFixture();
    assert.equal(stdout, `${canonicalize(fixture)}\n`);
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    assert.equal(evidence.schemaVersion, EVIDENCE_SCHEMA);
    assert.equal(stdout.includes("0x"), false);
    assert.equal(JSON.stringify(evidence).includes("0x"), false);
    const paymentHeaderName = ["PAYMENT", "SIGNATURE"].join("-");
    assert.equal((stdout + JSON.stringify(evidence)).toUpperCase().includes(paymentHeaderName), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI fails closed on unknown flags", async () => {
  const child = spawn(process.execPath, ["route-hosting-harness.mjs", "--price"], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stderr = await new Promise((resolve, reject) => {
    let out = "";
    child.stderr.on("data", (chunk) => {
      out += chunk;
    });
    child.once("error", reject);
    child.once("exit", () => resolve(out));
  });
  assert.match(stderr, /unknown_flag/);
});

test("hostile environment bindings fail closed", async () => {
  const previous = process.env.FACILITATOR_URL;
  process.env.FACILITATOR_URL = "https://example.invalid/facilitator";
  try {
    await assert.rejects(runRouteHostingHarness(), (error) => (
      error instanceof HarnessError && error.code === "hostile_env_binding"
    ));
  } finally {
    if (previous === undefined) delete process.env.FACILITATOR_URL;
    else process.env.FACILITATOR_URL = previous;
  }
});

test("ordinary CLI forbids fixture self-rebaseline", async () => {
  const harnessSource = readFileSync(path.join(cwd, "route-hosting-harness.mjs"), "utf8");
  assert.match(harnessSource, /GENERATE_ROUTE_HOSTING_FIXTURE/);
  assert.equal(harnessSource.includes("writeFileSync"), false);
  const previous = process.env.GENERATE_ROUTE_HOSTING_FIXTURE;
  process.env.GENERATE_ROUTE_HOSTING_FIXTURE = "1";
  try {
    await assert.rejects(runRouteHostingHarness(), (error) => (
      error instanceof HarnessError && error.code === "hostile_env_binding"
    ));
  } finally {
    if (previous === undefined) delete process.env.GENERATE_ROUTE_HOSTING_FIXTURE;
    else process.env.GENERATE_ROUTE_HOSTING_FIXTURE = previous;
  }
  const child = spawn(process.execPath, ["route-hosting-harness.mjs"], {
    cwd,
    env: { ...process.env, GENERATE_ROUTE_HOSTING_FIXTURE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stderr = await new Promise((resolve, reject) => {
    let out = "";
    child.stderr.on("data", (chunk) => {
      out += chunk;
    });
    child.once("error", reject);
    child.once("exit", () => resolve(out));
  });
  assert.match(stderr, /hostile_env_binding/);
});

test("reviewer-only fixture generator cannot run through the emitting CLI", async () => {
  const previous = process.env.REVIEWER_ROUTE_HOSTING_MAINTENANCE;
  process.env.REVIEWER_ROUTE_HOSTING_MAINTENANCE = "1";
  try {
    await assert.rejects(runRouteHostingHarness(), (error) => (
      error instanceof HarnessError && error.code === "hostile_env_binding"
    ));
  } finally {
    if (previous === undefined) delete process.env.REVIEWER_ROUTE_HOSTING_MAINTENANCE;
    else process.env.REVIEWER_ROUTE_HOSTING_MAINTENANCE = previous;
  }
  const generator = spawn(process.execPath, ["reviewer-generate-route-hosting-fixture.mjs"], {
    cwd,
    env: { ...process.env, GENERATE_ROUTE_HOSTING_FIXTURE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const generated = await new Promise((resolve, reject) => {
    let out = "";
    generator.stderr.on("data", (chunk) => {
      out += chunk;
    });
    generator.once("error", reject);
    generator.once("exit", (code) => resolve({ code, out }));
  });
  assert.notEqual(generated.code, 0);
  assert.match(generated.out, /reviewer_maintenance_required|hostile_env_binding/);
});
});
