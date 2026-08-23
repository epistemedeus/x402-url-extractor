import { createHash } from "node:crypto";
import { createServer as createNetServer, connect as netConnect } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { types as nodeTypes } from "node:util";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";

import {
  decodePaymentRequiredHeader,
  encodePaymentSignatureHeader,
} from "@x402/core/http";

import { SERVICE_VERSION } from "./service-version.mjs";
import { readServiceDeploymentCanonicalOrigin } from "./service-deployment-publication.mjs";
import {
  MerchantCompositionError,
  MERCHANT_JSON_PARSER_OPTIONS,
  MERCHANT_ROUTE_STACK_SEQUENCE,
  assertMerchantRouteStack,
  captureMerchantCompositionOptions,
  createMerchantApp,
} from "./server.js";


export const HARNESS_SCHEMA = "samedaydesk.route-hosting-harness.v3";
export const PRECURSOR_SCHEMA = "samedaydesk.route-hosting-harness-precursor.v3";
export const EVIDENCE_SCHEMA = "samedaydesk.route-hosting-harness-evidence.v1";
export const CANDIDATE_MANIFEST_SCHEMA = "samedaydesk.route-hosting-harness.candidate-manifest.v1";
export const PINNED_SOURCE_GENERATION = "3b14d8b3afb6866764cfc7171ee3e083f4553304";
export const PINNED_BASE_GENERATION = PINNED_SOURCE_GENERATION;
export const PINNED_NODE = "22.23.2";
export const OPERATION_PATH = "/commerce/seller-integrity-audit";
export const OPERATION_METHOD = "GET";
export const OPERATION_ID = "auditSellerIntegrity";
export const OPERATION_KEY = `${OPERATION_METHOD} ${OPERATION_PATH}`;
export const MISSING_BINDING = "unbound";
export const PRODUCER_ID = "samedaydesk.route-hosting-harness.r3";
export const WARMUP_COUNT = 3;
export const SAMPLE_COUNT = 7;
export const MAX_RECEIPT_BYTES = 65_536;
export const MAX_RESPONSE_BYTES = 1_048_576;
export const PINNED_STACK_DIGEST = "08a289967b044ef3a3597f3b83bdf06e727474ebb102182934d97843b5795bb6";
export const CANDIDATE_MANIFEST_RELATIVE = "test-fixtures/route-hosting-harness/candidate-manifest.json";
export const CANDIDATE_TREE_PATHS = Object.freeze([
  ".npmignore",
  ".railwayignore",
  "discovery-contract.mjs",
  "discovery-contract.test.mjs",
  "package.json",
  "reviewer-generate-route-hosting-fixture.mjs",
  "route-hosting-harness.mjs",
  "route-hosting-harness.test.mjs",
  "seller-integrity-audit.mjs",
  "server.js",
  "service-deployment-publication.mjs",
  "service-deployment-publication.test.mjs",
  "service-deployment-statement.json",
]);
export const HARNESS_RUN_OPTION_KEYS = Object.freeze(["includeEvidence"]);
export const PACKAGING_EXCLUSIONS = Object.freeze([
  "route-hosting-harness.mjs",
  "route-hosting-harness.test.mjs",
  "reviewer-generate-route-hosting-fixture.mjs",
  "test-fixtures/route-hosting-harness/",
  "PROMPT-HOSTING-HARNESS-R2.md",
  "PROMPT-HOSTING-HARNESS-R3.md",
  "worker-output/",
]);

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_RELATIVE = "test-fixtures/route-hosting-harness/v1.json";
const QUERY_PATH = `${OPERATION_PATH}?origin=https%3A%2F%2Fseller.example&route=%2Fpaid%2Fread`;
const SOURCE_DEFAULT_RES = Object.freeze({
  NETWORK: /const NETWORK = process\.env\.NETWORK \|\| "(eip155:\d+)";/,
  PAY_TO: /const PAY_TO = process\.env\.PAY_TO \|\| "(0x[a-fA-F0-9]{40})";/,
  PRICE: /const SELLER_INTEGRITY_AUDIT_PRICE = process\.env\.SELLER_INTEGRITY_AUDIT_PRICE \|\| "(\$[0-9]+(?:\.[0-9]+)?)";/,
});
const FORBIDDEN_ENV = Object.freeze([
  "NETWORK",
  "PAY_TO",
  "FACILITATOR",
  "FACILITATOR_URL",
  "PUBLIC_URL",
  "SELLER_INTEGRITY_AUDIT_PRICE",
  "CDP_API_KEY_ID",
  "CDP_API_KEY_SECRET",
  "MPP_SECRET_KEY",
  "RECEIPT_SIGNING_PRIVATE_KEY",
  "COMMERCE_INTERNAL_TOKEN",
  "GENERATE_ROUTE_HOSTING_FIXTURE",
]);
const CLI_FORBIDDEN_ENV = Object.freeze([
  ...FORBIDDEN_ENV,
  "REVIEWER_ROUTE_HOSTING_MAINTENANCE",
]);
const SECRET_LIKE_KEY = /(secret|token|password|api[_-]?key|authorization|bearer|private[_-]?key|credential|seed|mnemonic)/i;
const WALLET_RE = /0x[a-fA-F0-9]{40}/;
const TX_RE = /0x[a-fA-F0-9]{64}/;
const PAYMENT_HEADER_RE = /PAYMENT-SIGNATURE|X-PAYMENT(?:-SIGNATURE)?/i;
const MIDDLEWARE_SOURCE_MARKERS = Object.freeze([
  "app.use(jsonParser);",
  "app.use(legacyCompatibleX402Body);",
  "app.use(paidActionEffectHeaders);",
  "app.use(commerceTelemetry.middleware);",
  "app.use(purchaseEvidenceMiddleware);",
  "app.use(idempotencyReplay.middleware);",
  `app.get("${OPERATION_PATH}", sellerIntegrityAuditValidator);`,
  "app.use(mppDualStack.middleware);",
  "app.use(x402PaywallGate);",
  `app.get("${OPERATION_PATH}", serveSellerIntegrityAudit);`,
]);
const SERVE_WRAPPER_SNIPPET = "return res.json(await sellerIntegrityAudit(\n    res.locals.sellerIntegrityAuditInput,\n    options.sellerIntegrityAuditImpl ? { auditImpl: options.sellerIntegrityAuditImpl } : undefined,\n  ));";
const JSON_PARSER_SNIPPETS = Object.freeze([
  "const jsonParser = express.json({",
  "limit: MERCHANT_JSON_PARSER_OPTIONS.limit,",
  "type: [...MERCHANT_JSON_PARSER_OPTIONS.type],",
  "req.rawBody = Buffer.from(buffer);",
]);

const FROZEN_AUDIT_REPORT = Object.freeze({
  schemaVersion: "agent-payment-integrity.audit.v4",
  checkedAt: "2026-08-12T07:50:00.000Z",
  versions: Object.freeze({ x402: "1.0.0", mpp: "1.0.0" }),
  ok: true,
  machineBuyable: true,
  routes: Object.freeze([
    Object.freeze({
      status: 402,
      method: "GET",
      runtimeChallengeVerified: true,
      probe: Object.freeze({ attempted: true, reason: null }),
      protocols: Object.freeze(["mpp", "x402"]),
      valid: true,
      findings: Object.freeze([]),
      economics: Object.freeze({
        x402: Object.freeze({ amountAtomic: "5000" }),
        mpp: Object.freeze({ amountAtomic: "5000" }),
      }),
      discovery: Object.freeze({ bazaar: Object.freeze({ present: true, valid: true }) }),
      responseContract: Object.freeze({
        decision: "admissible",
        requiredPaths: Object.freeze(["ok", "title"]),
      }),
      repairPlan: Object.freeze({
        mode: "advisory_openapi_repair",
        requiredPaths: Object.freeze([]),
        guaranteedPaths: Object.freeze([]),
        actions: Object.freeze([]),
        complete: true,
        boundary: Object.freeze({
          schemaMutationApplied: false,
          propertyTypesInferred: false,
          sellerRuntimeVerified: false,
          statement: "Seller must verify runtime semantics.",
        }),
      }),
    }),
  ]),
});

let runGate = Promise.resolve();

export class HarnessError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "HarnessError";
    this.code = code;
  }
}

export function canonicalize(value) {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeysDeep(value[key]);
    return out;
  }
  return value;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fail(code) {
  throw new HarnessError(code);
}

function asHarnessError(error) {
  if (error instanceof HarnessError) return error;
  if (error instanceof MerchantCompositionError) return new HarnessError(error.code);
  return error;
}

function assertNoSecretLikeKeys(value) {
  if (Array.isArray(value)) {
    value.forEach((entry) => assertNoSecretLikeKeys(entry));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (key !== "secretLikeKeysProhibited" && SECRET_LIKE_KEY.test(key)) fail("secret_like_key");
    assertNoSecretLikeKeys(child);
  }
}

function assertArtifactPrivacy(text, label = "artifact") {
  if (WALLET_RE.test(text) || TX_RE.test(text) || PAYMENT_HEADER_RE.test(text)) {
    fail(`${label}_privacy`);
  }
  if (text.includes("PAYMENT-SIGNATURE") || text.includes("x-payment")) fail(`${label}_privacy`);
}

export function captureHarnessRunOptions(raw = {}) {
  if (raw === undefined) raw = {};
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) fail("hostile_inputs");
  if (nodeTypes.isProxy(raw)) fail("hostile_inputs");
  const proto = Object.getPrototypeOf(raw);
  if (proto !== Object.prototype && proto !== null) fail("hostile_inputs");
  const out = {};
  for (const key of Reflect.ownKeys(raw)) {
    if (typeof key === "symbol") fail("hostile_inputs");
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (!descriptor || !descriptor.enumerable) fail("hostile_inputs");
    if (descriptor.get || descriptor.set) fail("hostile_inputs");
    if (!HARNESS_RUN_OPTION_KEYS.includes(key)) fail("unknown_flag");
    out[key] = descriptor.value;
  }
  if (Object.prototype.hasOwnProperty.call(out, "includeEvidence") && typeof out.includeEvidence !== "boolean") {
    fail("hostile_inputs");
  }
  return Object.freeze(out);
}

export function readPinnedBaseGeneration() {
  // Predecessor provenance only. This is the base the candidate tree was
  // derived from; it is deliberately NOT the committed candidate checkout and
  // must never be treated as the deployed or current source generation.
  return PINNED_BASE_GENERATION;
}

export function readPinnedSourceGeneration({ cwd = ROOT } = {}) {
  // The candidate source generation is bound through the exact candidate
  // manifest file digests and candidate-tree algorithm over the bytes on
  // disk — never through a self-referential current commit hash. The
  // deployed generation stays `unbound`.
  if (path.resolve(cwd) !== ROOT) fail("missing_source_generation");
  const bound = assertCandidateManifest();
  return bound.candidateTreeSha256;
}

export function assertPinnedRuntime() {
  if (process.versions.node !== PINNED_NODE) fail("node_version_drift");
}

function assertCleanEnv(names = FORBIDDEN_ENV) {
  for (const name of names) {
    if (process.env[name]) fail("hostile_env_binding");
  }
}

function readServerSource() {
  return readFileSync(path.join(ROOT, "server.js"), "utf8");
}

export function assertProductionMiddlewareSourceOrder(source = readServerSource()) {
  let last = -1;
  for (const marker of MIDDLEWARE_SOURCE_MARKERS) {
    const index = source.indexOf(marker);
    if (index < 0 || index <= last) fail("middleware_order_drift");
    last = index;
  }
}

export function assertProductionRouteSeam(source = readServerSource()) {
  if (!source.includes("export function createMerchantApp(rawOptions = {})")) fail("composition_seam_drift");
  if (!source.includes("function isDirectMerchantExecution()")) fail("direct_execution_guard_drift");
  if (!source.includes("if (isDirectMerchantExecution())")) fail("direct_execution_guard_drift");
  if (source.includes("resetDiscoveryContracts")) fail("discovery_registry_eraser");
  if (!source.includes("return withReplacementDiscoveryRegistry(() => {")) fail("discovery_registry_transaction_drift");
  if (!source.includes("out.facilitatorClient = captureInjectedFacilitatorClient(out.facilitatorClient)")) {
    fail("facilitator_capture_drift");
  }
  const listenIndex = source.indexOf("app.listen(PORT, () => {");
  const guardIndex = source.lastIndexOf("if (isDirectMerchantExecution())", listenIndex);
  if (listenIndex < 0 || guardIndex < 0 || guardIndex > listenIndex) fail("direct_execution_guard_drift");
  if (!source.includes(SERVE_WRAPPER_SNIPPET)) fail("handler_seam_drift");
  if (!source.includes(`app.get("${OPERATION_PATH}", sellerIntegrityAuditValidator)`)) fail("validator_seam_drift");
  if (!source.includes(`app.get("${OPERATION_PATH}", serveSellerIntegrityAudit)`)) fail("route_drift");
  if (!source.includes(`"${OPERATION_KEY}": {`)) fail("paywall_route_drift");
  if (!source.includes(`operationId: "${OPERATION_ID}"`)) fail("operation_id_drift");
  for (const snippet of JSON_PARSER_SNIPPETS) {
    if (!source.includes(snippet)) fail("json_parser_drift");
  }
  if (!MERCHANT_JSON_PARSER_OPTIONS.type.includes("application/*+json")) fail("json_parser_drift");
  if (!source.includes("options.sellerIntegrityAuditImpl ? { auditImpl: options.sellerIntegrityAuditImpl } : undefined")) {
    fail("handler_seam_drift");
  }
  const unconditional = /sellerIntegrityAudit\(\s*res\.locals\.sellerIntegrityAuditInput\s*,\s*\{\s*auditImpl:/;
  if (unconditional.test(source)) fail("production_bypass");
  assertProductionMiddlewareSourceOrder(source);
}

export function sourceDefaultsFromTree(source = readServerSource()) {
  const network = source.match(SOURCE_DEFAULT_RES.NETWORK)?.[1];
  const payTo = source.match(SOURCE_DEFAULT_RES.PAY_TO)?.[1];
  const price = source.match(SOURCE_DEFAULT_RES.PRICE)?.[1];
  if (!network || !payTo || !price) fail("source_default_drift");
  if (network !== "eip155:8453" || price !== "$0.01") fail("price_drift");
  return Object.freeze({ network, payTo, price });
}

export function sourceFileDigest(relativePath) {
  return sha256(readFileSync(path.join(ROOT, relativePath)));
}

export function computeCandidateFileDigests(relativePaths = CANDIDATE_TREE_PATHS) {
  const files = {};
  for (const relativePath of [...relativePaths].sort()) {
    files[relativePath] = sourceFileDigest(relativePath);
  }
  return Object.freeze(files);
}

export function computeCandidateTreeSha256(files = computeCandidateFileDigests()) {
  return sha256(canonicalize(files));
}

export function readCandidateManifest() {
  const text = readFileSync(path.join(ROOT, CANDIDATE_MANIFEST_RELATIVE), "utf8");
  const manifest = JSON.parse(text);
  if (manifest.schemaVersion !== CANDIDATE_MANIFEST_SCHEMA) fail("candidate_manifest_drift");
  if (manifest.baseGeneration !== PINNED_BASE_GENERATION) fail("source_generation_drift");
  if (manifest.deployedGeneration !== MISSING_BINDING) fail("deployed_generation_binding");
  if (manifest.fixtureRelative !== FIXTURE_RELATIVE) fail("candidate_manifest_drift");
  if (!manifest.files || typeof manifest.files !== "object") fail("candidate_manifest_drift");
  return manifest;
}

export function assertCandidateManifest() {
  const manifest = readCandidateManifest();
  const expectedPaths = Object.keys(manifest.files).sort();
  const required = [...CANDIDATE_TREE_PATHS].sort();
  if (canonicalize(expectedPaths) !== canonicalize(required)) fail("candidate_manifest_drift");
  const files = computeCandidateFileDigests(expectedPaths);
  for (const relativePath of expectedPaths) {
    if (files[relativePath] !== manifest.files[relativePath]) fail("source_blob_drift");
  }
  const candidateTreeSha256 = computeCandidateTreeSha256(files);
  if (candidateTreeSha256 !== manifest.candidateTreeSha256) fail("candidate_tree_drift");
  if (sourceFileDigest(FIXTURE_RELATIVE) !== manifest.fixtureSha256) fail("receipt_fixture_drift");
  return Object.freeze({
    manifest,
    files,
    candidateTreeSha256,
    fixtureSha256: manifest.fixtureSha256,
  });
}

export function assertPinnedSourceBlobs() {
  assertCandidateManifest();
}

export function buildCandidateManifestRecord({
  files = computeCandidateFileDigests(),
  fixtureSha256 = sourceFileDigest(FIXTURE_RELATIVE),
} = {}) {
  const candidateTreeSha256 = computeCandidateTreeSha256(files);
  return {
    schemaVersion: CANDIDATE_MANIFEST_SCHEMA,
    baseGeneration: PINNED_BASE_GENERATION,
    deployedGeneration: MISSING_BINDING,
    fixtureRelative: FIXTURE_RELATIVE,
    fixtureSha256,
    candidateTreeSha256,
    files,
  };
}

function withRunLock(work) {
  const run = runGate.then(work, work);
  runGate = run.then(() => undefined, () => undefined);
  return run;
}

export function frozenAuditImpl() {
  return async () => structuredClone(FROZEN_AUDIT_REPORT);
}

function createFacilitator(calls, network) {
  return {
    async getSupported() {
      calls.getSupported += 1;
      return {
        kinds: [{ x402Version: 2, scheme: "exact", network }],
        extensions: [],
      };
    },
    async verify() {
      calls.verify += 1;
      return { isValid: true, payer: "local-unbound" };
    },
    async settle(_payload, requirements) {
      calls.settle += 1;
      return {
        success: true,
        transaction: "local-unbound",
        network: requirements.network,
        payer: "local-unbound",
      };
    },
  };
}

function installIoGuard(state) {
  const originalFetch = globalThis.fetch;
  const originalLookup = dns.lookup;
  const originalLookupPromise = dns.promises.lookup;
  const originalHttpRequest = http.request;
  const originalHttpsRequest = https.request;
  const originalHttpGet = http.get;
  const originalHttpsGet = https.get;

  const allowLoopback = (hostname) => hostname === "127.0.0.1";

  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
    if (!allowLoopback(url.hostname) || url.protocol !== "http:") {
      state.external += 1;
      fail("unexpected_outbound_io");
    }
    state.loopback += 1;
    return originalFetch(input);
  };

  const guardedLookup = (hostname, ...rest) => {
    const host = String(hostname || "");
    if (!allowLoopback(host)) {
      state.external += 1;
      fail("unexpected_outbound_io");
    }
    return originalLookup(hostname, ...rest);
  };
  dns.lookup = guardedLookup;
  dns.promises.lookup = async (hostname, ...rest) => {
    const host = String(hostname || "");
    if (!allowLoopback(host)) {
      state.external += 1;
      fail("unexpected_outbound_io");
    }
    return originalLookupPromise(hostname, ...rest);
  };

  const guardRequest = (original, kind) => function guarded(input, ...rest) {
    const hostname = typeof input === "string" || input instanceof URL
      ? new URL(String(input), "http://127.0.0.1").hostname
      : String(input?.hostname || input?.host || "").split(":")[0];
    if (!hostname) return original.call(this, input, ...rest);
    if (kind === "https" || !allowLoopback(hostname)) {
      state.external += 1;
      fail("unexpected_outbound_io");
    }
    return original.call(this, input, ...rest);
  };
  http.request = guardRequest(originalHttpRequest, "http");
  https.request = guardRequest(originalHttpsRequest, "https");
  http.get = guardRequest(originalHttpGet, "http");
  https.get = guardRequest(originalHttpsGet, "https");

  return () => {
    globalThis.fetch = originalFetch;
    dns.lookup = originalLookup;
    dns.promises.lookup = originalLookupPromise;
    http.request = originalHttpRequest;
    https.request = originalHttpsRequest;
    http.get = originalHttpGet;
    https.get = originalHttpsGet;
  };
}

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

export function parseHttp1Response(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) fail("empty_response");
  if (buffer.length > MAX_RESPONSE_BYTES) fail("oversize_output");
  const separator = Buffer.from("\r\n\r\n");
  const index = buffer.indexOf(separator);
  if (index < 0) fail("http_response_unframed");
  const head = buffer.subarray(0, index);
  const body = buffer.subarray(index + separator.length);
  const headText = head.toString("latin1");
  const lines = headText.split("\r\n");
  const statusLine = lines[0] || "";
  const statusMatch = /^HTTP\/1\.[01] (\d{3})(?: .*)?$/.exec(statusLine);
  if (!statusMatch) fail("status_line_drift");
  const headerLines = lines.slice(1);
  const headers = [];
  const seen = new Map();
  for (const line of headerLines) {
    const colon = line.indexOf(":");
    if (colon < 1) fail("header_framing");
    const name = line.slice(0, colon);
    const value = line.slice(colon + 1).replace(/^\s+/, "");
    const key = name.toLowerCase();
    if (seen.has(key)) fail("duplicate_headers");
    seen.set(key, value);
    headers.push([name, value]);
  }
  const statusLineBytes = Buffer.byteLength(`${statusLine}\r\n`, "latin1");
  const headerBytes = index + separator.length - statusLineBytes;
  const bodyBytes = body.length;
  const totalBytes = buffer.length;
  if (statusLineBytes + headerBytes + bodyBytes !== totalBytes) fail("body_double_counting");
  const contentEncoding = seen.get("content-encoding");
  if (contentEncoding && contentEncoding.toLowerCase() !== "identity") fail("compressed_vs_uncompressed");
  if (seen.has("transfer-encoding")) fail("chunked_framing");
  const contentLength = seen.get("content-length");
  if (contentLength === undefined) fail("missing_content_length");
  if (!/^[0-9]+$/.test(contentLength) || Number(contentLength) !== bodyBytes) fail("content_length_mismatch");
  const connection = seen.get("connection");
  if (!connection || connection.toLowerCase() !== "close") fail("connection_policy");
  return {
    status: Number(statusMatch[1]),
    statusLine,
    headers,
    headerMap: seen,
    body,
    bytes: Object.freeze({
      statusLine: statusLineBytes,
      headers: headerBytes,
      body: bodyBytes,
      total: totalBytes,
    }),
  };
}

function comparableHeaderNames(headers) {
  return headers
    .map(([name]) => String(name).toLowerCase())
    .filter((name) => name !== "date")
    .sort();
}

function exchange({ port, host, extraHeaders = "" }) {
  const request = [
    `GET ${QUERY_PATH} HTTP/1.1`,
    `Host: ${host}`,
    "X-Forwarded-Proto: https",
    `X-Forwarded-Host: ${host}`,
    "Accept: application/json",
    "Connection: close",
    "User-Agent: samedaydesk-route-hosting-harness/r3",
    extraHeaders,
  ].filter(Boolean).join("\r\n") + "\r\n\r\n";
  return new Promise((resolve, reject) => {
    const chunks = [];
    const socket = netConnect({ host: "127.0.0.1", port });
    socket.setTimeout(8_000);
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("end", () => resolve(Buffer.concat(chunks)));
    socket.on("timeout", () => {
      socket.destroy();
      reject(new HarnessError("socket_timeout"));
    });
    socket.on("error", reject);
    socket.write(request);
  });
}

function measureOnce(fn) {
  const cpu0 = process.cpuUsage();
  const mem0 = process.memoryUsage();
  const t0 = process.hrtime.bigint();
  return Promise.resolve(fn()).then((value) => {
    const elapsedNs = Number(process.hrtime.bigint() - t0);
    const cpu = process.cpuUsage(cpu0);
    const mem1 = process.memoryUsage();
    return {
      value,
      sample: Object.freeze({
        elapsedNs,
        cpuUserUs: cpu.user,
        cpuSystemUs: cpu.system,
        rssBytes: mem1.rss,
        heapUsedBytes: mem1.heapUsed,
        rssDeltaBytes: mem1.rss - mem0.rss,
        heapUsedDeltaBytes: mem1.heapUsed - mem0.heapUsed,
      }),
    };
  });
}

async function collectCase(run, expectedStatus) {
  for (let index = 0; index < WARMUP_COUNT; index += 1) {
    const warmed = parseHttp1Response(await run());
    if (warmed.status !== expectedStatus) fail("status_body_header_drift");
  }
  const samples = [];
  const parsed = [];
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    const measured = await measureOnce(run);
    const response = parseHttp1Response(measured.value);
    if (response.status !== expectedStatus) fail("status_body_header_drift");
    parsed.push(response);
    samples.push(measured.sample);
  }
  const first = parsed[0];
  const firstHash = sha256(Buffer.concat([
    Buffer.from(first.statusLine, "latin1"),
    Buffer.from(comparableHeaderNames(first.headers).join("\n")),
    first.body,
  ]));
  for (const response of parsed.slice(1)) {
    if (response.bytes.total !== first.bytes.total) fail("nondeterminism");
    if (response.bytes.statusLine !== first.bytes.statusLine) fail("nondeterminism");
    if (response.bytes.headers !== first.bytes.headers) fail("nondeterminism");
    if (response.bytes.body !== first.bytes.body) fail("nondeterminism");
    if (sha256(response.body) !== sha256(first.body)) fail("status_body_header_drift");
    const hash = sha256(Buffer.concat([
      Buffer.from(response.statusLine, "latin1"),
      Buffer.from(comparableHeaderNames(response.headers).join("\n")),
      response.body,
    ]));
    if (hash !== firstHash) fail("nondeterminism");
  }
  return { response: first, samples, identityHash: firstHash };
}

function stableCaseView(result, extras = {}) {
  const { response } = result;
  return Object.freeze({
    status: response.status,
    bytes: response.bytes,
    encoding: "identity",
    contentType: String(response.headerMap.get("content-type") || ""),
    headerNames: comparableHeaderNames(response.headers),
    bodySha256: sha256(response.body),
    identityHash: result.identityHash,
    ...extras,
  });
}

function buildPrecursor({ baseGeneration, candidateTreeSha256, challenge, paid, sourceDigests, stackDigest }) {
  const sourceReferenceDigest = sha256(canonicalize({
    schemaVersion: PRECURSOR_SCHEMA,
    baseGeneration,
    candidateTreeSha256,
    challengeBytes: challenge.bytes,
    paidBytes: paid.bytes,
    sourceDigests,
    stackDigest,
  }));
  return Object.freeze({
    schemaVersion: PRECURSOR_SCHEMA,
    amountUnknown: true,
    evaluatorAdmissible: false,
    authority: Object.freeze({
      sourceKind: "owner_measured_harness",
      sourceAuthority: "seller_observed",
    }),
    rawResource: Object.freeze({
      unit: "http11_serialized_bytes",
      challenge: challenge.bytes,
      paid_success: paid.bytes,
      note: "Physical loopback bytes from the production-registered route. Not a billing unit and not an evaluator-admissible hosting_marginal envelope.",
    }),
    sourceReferenceDigest,
    missingBindings: Object.freeze([
      "rail",
      "facilitatorId",
      "productionHost",
      "providerEndpoint",
      "deployment",
      "deployedGeneration",
      "B1",
      "demand",
      "payment",
      "settlement",
      "revenue",
    ]),
    nonClaims: Object.freeze([
      "production_invoice",
      "facilitator_cost",
      "chain_gas",
      "settlement_deduction",
      "accounting_deduction",
      "complete_current_window_coverage",
      "numeric_micro_usd",
      "rate_conversion",
      "evaluator_admissible_hosting_marginal",
      "production_route_billing_bytes",
    ]),
  });
}

export async function startHarnessLoopback() {
  assertCleanEnv();
  const serverSource = readServerSource();
  assertProductionRouteSeam(serverSource);
  const defaults = sourceDefaultsFromTree(serverSource);
  const baseGeneration = readPinnedBaseGeneration();
  const candidateFiles = computeCandidateFileDigests();
  const candidateTreeSha256 = computeCandidateTreeSha256(candidateFiles);
  const publicUrl = readServiceDeploymentCanonicalOrigin();
  const dataDir = await mkdtemp(path.join(tmpdir(), "route-hosting-harness-"));
  const io = { external: 0, loopback: 0 };
  const restoreIo = installIoGuard(io);
  const calls = { getSupported: 0, verify: 0, settle: 0, handler: 0 };
  let closed = false;
  try {
    const facilitatorClient = createFacilitator(calls, defaults.network);
    captureMerchantCompositionOptions({
      facilitatorClient,
      sellerIntegrityAuditImpl: frozenAuditImpl(),
      dataDir,
      publicUrl,
    });
    const merchant = createMerchantApp({
      facilitatorClient,
      sellerIntegrityAuditImpl: async (input) => {
        calls.handler += 1;
        return frozenAuditImpl()(input);
      },
      dataDir,
      publicUrl,
    });
    if (merchant.network !== defaults.network) fail("source_default_drift");
    if (merchant.payTo !== defaults.payTo) fail("source_default_drift");
    if (merchant.sellerIntegrityAuditPrice !== defaults.price) fail("price_drift");
    if (merchant.publicUrl !== publicUrl) fail("deployment_origin_drift");
    if (merchant.serveSellerIntegrityAudit !== merchant.registered.serveSellerIntegrityAudit) {
      fail("registered_wrapper_drift");
    }
    const observed = assertMerchantRouteStack(merchant.app, merchant.registered);
    for (let index = 0; index < MERCHANT_ROUTE_STACK_SEQUENCE.length; index += 1) {
      if (observed[index] !== MERCHANT_ROUTE_STACK_SEQUENCE[index]) fail("middleware_order_drift");
    }
    const stackDigest = sha256(canonicalize(merchant.stackTrace));
    if (stackDigest !== PINNED_STACK_DIGEST) fail("middleware_order_drift");
    if (!merchant.jsonParserOptions.type.includes("application/*+json")) fail("json_parser_drift");
    const host = new URL(publicUrl).hostname;
    const port = await unusedPort();
    const server = merchant.app.listen(port, "127.0.0.1");
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    return {
      port,
      host,
      baseGeneration,
      candidateTreeSha256,
      candidateFiles,
      calls,
      io,
      defaults,
      publicUrl,
      stackDigest,
      serveSellerIntegrityAudit: merchant.serveSellerIntegrityAudit,
      async close() {
        if (closed) return;
        closed = true;
        restoreIo();
        await new Promise((resolve) => server.close(resolve));
        server.closeAllConnections?.();
        await merchant.commerceTelemetry.flush?.().catch(() => {});
        await rm(dataDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    restoreIo();
    if (!closed) await rm(dataDir, { recursive: true, force: true }).catch(() => {});
    throw asHarnessError(error);
  }
}

function paymentHeaderFromChallenge(response) {
  const encoded = response.headerMap.get("payment-required");
  if (!encoded) fail("missing_payment_required");
  const required = decodePaymentRequiredHeader(encoded);
  const accepted = required?.accepts?.[0];
  if (!accepted || accepted.scheme !== "exact") fail("challenge_accepts_drift");
  return encodePaymentSignatureHeader({
    x402Version: 2,
    accepted,
    payload: {
      signature: `0x${"11".repeat(65)}`,
      authorization: {
        from: "0x1000000000000000000000000000000000000001",
        to: accepted.payTo,
        value: accepted.amount,
        validAfter: "0",
        validBefore: "9999999999",
        nonce: `0x${"22".repeat(32)}`,
      },
    },
  });
}

export async function buildRouteHostingHarnessReceipt(rawOptions = {}) {
  const options = captureHarnessRunOptions(rawOptions);
  assertPinnedRuntime();
  const loopback = await startHarnessLoopback();
  try {
    const challenge = await collectCase(
      () => exchange({ port: loopback.port, host: loopback.host }),
      402,
    );
    if (!challenge.response.headerMap.get("payment-required")) fail("header_drift");
    if (!challenge.response.headerMap.get("link")) fail("header_drift");
    const paymentHeader = paymentHeaderFromChallenge(challenge.response);
    const paid = await collectCase(
      () => exchange({
        port: loopback.port,
        host: loopback.host,
        extraHeaders: `PAYMENT-SIGNATURE: ${paymentHeader}`,
      }),
      200,
    );
    if (loopback.calls.handler < SAMPLE_COUNT) fail("handler_not_exercised");
    if (loopback.calls.verify < 1 || loopback.calls.settle < 1) fail("middleware_not_exercised");
    if (loopback.io.external !== 0) fail("unexpected_outbound_io");
    const paidBody = JSON.parse(paid.response.body.toString("utf8"));
    if (paidBody.product !== "samedaydesk-seller-integrity-audit") fail("wrong_operation");
    if (paidBody.decision !== "machine_buyable") fail("paid_body_drift");
    if (paidBody.checkedAt !== "2026-08-12T07:50:00.000Z") fail("nondeterminism");
    if (paid.response.headerMap.get("cache-control") !== "no-store") fail("header_drift");
    if (!paid.response.headerMap.get("payment-response")) fail("header_drift");
    if (!paid.response.headerMap.get("link")) fail("header_drift");
    const sourceDigests = Object.freeze({
      "discovery-contract.mjs": sourceFileDigest("discovery-contract.mjs"),
      "seller-integrity-audit.mjs": sourceFileDigest("seller-integrity-audit.mjs"),
      "service-deployment-publication.mjs": sourceFileDigest("service-deployment-publication.mjs"),
      "service-deployment-statement.json": sourceFileDigest("service-deployment-statement.json"),
      "route-hosting-harness.mjs": sourceFileDigest("route-hosting-harness.mjs"),
      "server.js": sourceFileDigest("server.js"),
    });
    const challengeView = stableCaseView(challenge, { fixtureBackedOutboundAudit: false, syntheticPayment: false });
    const paidView = stableCaseView(paid, { fixtureBackedOutboundAudit: true, syntheticPayment: true });
    const precursor = buildPrecursor({
      baseGeneration: loopback.baseGeneration,
      candidateTreeSha256: loopback.candidateTreeSha256,
      challenge: challengeView,
      paid: paidView,
      sourceDigests,
      stackDigest: loopback.stackDigest,
    });
    const receipt = {
      schemaVersion: HARNESS_SCHEMA,
      baseGeneration: loopback.baseGeneration,
      candidateTreeSha256: loopback.candidateTreeSha256,
      candidateManifest: CANDIDATE_MANIFEST_RELATIVE,
      serviceVersion: SERVICE_VERSION,
      node: PINNED_NODE,
      operation: OPERATION_KEY,
      operationId: OPERATION_ID,
      routeEvidenceClass: "production_registered_loopback_http11",
      authority: {
        sourceKind: "owner_measured_harness",
        sourceAuthority: "seller_observed",
        producerId: PRODUCER_ID,
        environment: "test",
        topology: "local-loopback-http11",
      },
      binding: {
        routeId: OPERATION_PATH,
        operation: OPERATION_ID,
        rail: MISSING_BINDING,
        deployedGeneration: MISSING_BINDING,
        environment: "test",
        facilitatorId: MISSING_BINDING,
      },
      measurementPolicy: {
        warmup: WARMUP_COUNT,
        samples: SAMPLE_COUNT,
        encoding: "identity",
        transport: "http/1.1",
        connection: "close",
        byteCountIncludes: ["status_line", "headers", "body"],
        timingNormalizedOutOfStableReceipt: true,
      },
      claims: {
        productionInvoice: false,
        facilitatorCost: false,
        chainGas: false,
        settlementDeduction: false,
        accountingDeduction: false,
        completeCurrentWindowCoverage: false,
        numericMicroUsd: false,
        rateConversion: false,
        evaluatorAdmissible: false,
        copiedWrapper: false,
        reconstructedMiddleware: false,
      },
      cases: {
        challenge: challengeView,
        paid_success: paidView,
      },
      precursor,
      sourceDigests,
      stackDigest: loopback.stackDigest,
      extractionBoundary: {
        compositionSeam: "createMerchantApp",
        registeredWrapper: "serveSellerIntegrityAudit",
        productionHandlerPassThrough: "sellerIntegrityAudit(res.locals.sellerIntegrityAuditInput, auditDeps)",
        injectedOutboundAuditFixture: true,
        reconstructedMiddleware: false,
        copiedWrapper: false,
        productionDefaultUsesInjectedAudit: false,
      },
    };
    assertNoSecretLikeKeys(receipt);
    const encoded = `${canonicalize(receipt)}\n`;
    if (Buffer.byteLength(encoded, "utf8") > MAX_RECEIPT_BYTES) fail("oversize_output");
    assertArtifactPrivacy(encoded, "receipt");
    const evidence = options.includeEvidence
      ? {
        schemaVersion: EVIDENCE_SCHEMA,
        measurementPolicy: receipt.measurementPolicy,
        samples: {
          challenge: challenge.samples,
          paid_success: paid.samples,
        },
      }
      : null;
    if (evidence) {
      const evidenceEncoded = canonicalize(evidence);
      assertNoSecretLikeKeys(evidence);
      assertArtifactPrivacy(evidenceEncoded, "evidence");
      if (Buffer.byteLength(evidenceEncoded, "utf8") > MAX_RECEIPT_BYTES) fail("oversize_output");
    }
    return {
      receipt,
      encoded,
      evidence,
      calls: loopback.calls,
      candidateTreeSha256: loopback.candidateTreeSha256,
      candidateFiles: loopback.candidateFiles,
    };
  } finally {
    await loopback.close();
  }
}

export async function runRouteHostingHarness(rawOptions = {}) {
  return withRunLock(async () => {
    assertCleanEnv(CLI_FORBIDDEN_ENV);
    const result = await buildRouteHostingHarnessReceipt(rawOptions);
    const bound = assertCandidateManifest();
    if (result.candidateTreeSha256 !== bound.candidateTreeSha256) fail("candidate_tree_drift");
    if (result.receipt.baseGeneration !== PINNED_BASE_GENERATION) fail("source_generation_drift");
    if (result.receipt.binding.deployedGeneration !== MISSING_BINDING) fail("deployed_generation_binding");
    const fixtureText = readFileSync(path.join(ROOT, FIXTURE_RELATIVE), "utf8");
    if (result.encoded !== fixtureText) fail("receipt_fixture_drift");
    return result;
  });
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help")) {
    process.stdout.write("Usage: node route-hosting-harness.mjs [--evidence path]\n");
    return 0;
  }
  const evidenceFlag = argv.indexOf("--evidence");
  const unknown = argv.filter((arg, index) => arg !== "--evidence" && (evidenceFlag < 0 || index !== evidenceFlag + 1));
  if (unknown.length) {
    process.stderr.write("unknown_flag\n");
    return 2;
  }
  try {
    const result = await runRouteHostingHarness({ includeEvidence: evidenceFlag >= 0 });
    process.stdout.write(result.encoded);
    if (evidenceFlag >= 0) {
      const target = argv[evidenceFlag + 1];
      if (!target || target.startsWith("-")) fail("hostile_inputs");
      const { writeFile } = await import("node:fs/promises");
      await writeFile(target, `${canonicalize(result.evidence)}\n`, { encoding: "utf8", mode: 0o600 });
    }
    return 0;
  } catch (error) {
    const wrapped = asHarnessError(error);
    const code = wrapped instanceof HarnessError ? wrapped.code : "harness_failed";
    process.stderr.write(`${code}\n`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code));
}
