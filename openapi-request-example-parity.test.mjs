import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

import {
  BOOT_MODES,
  CACHE_BUDGET,
  DIALECT_IDENTITIES,
  DIGEST_VECTORS,
  EXPECTED_ENABLED_SURFACE_COUNTS,
  EXPECTED_PAID_METHOD_ROUTE_COUNTS,
  FAILURE_CODES,
  HOSTILE_PRIMARY_MAP_DIGEST,
  HOSTILE_PROBE_CLASSES,
  HOSTILE_PROBE_MANIFEST_DIGEST,
  MAX_FINDINGS,
  PARITY_RUNTIME_VERSION,
  PUBLIC_SOLANA_SIGNATURE_QUERY,
  REQUEST_CONTRACT_ALIASES,
  STARTUP_STAGES,
  V_C_VECTOR,
  allRegisteredSchemaUris,
  applyDiscoveryRequestExamples,
  assertGeneratedOpenApiSurfaceGate,
  canonicalBytes,
  collectOpenApiRequestExampleFindings,
  computeCacheManifestDigest,
  cacheManifestSnapshot,
  credentialBearingUrlFindings,
  decodePlainStages,
  decodeUriStages,
  exampleFindingsReport,
  expectedPaidMethodRoutes,
  expectedPrimaryCode,
  hasUnresolvedTemplate,
  hostilePrimaryMapDigest,
  hostileProbeIds,
  hostileProbeManifestDigest,
  hostileProbeReceiptSnapshot,
  isCredentialLikeValue,
  isSensitiveExampleName,
  isScalarQueryValue,
  materializeSafe,
  operationIdManifest,
  paidRouteManifest,
  parameterExampleValue,
  parityRegistrySnapshot,
  percentEncode1,
  percentEncode2,
  percentEncode3,
  prepareOpenApiParityStartup,
  prepareSchemaAuthority,
  processCacheEntry,
  processCacheKeys,
  publishedStartupReceipt,
  recordHostileProbe,
  resetParityAuthorityForTests,
  taggedDigest,
  unsafeExampleFindings,
  validateExampleAgainstSchema,
  valuesCanonicallyEqual,
} from "./openapi-request-example-parity.mjs";
import { SERVICE_VERSION } from "./service-version.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const NODE = "/workspace/pilot/toolchain/node-v22.23.2-linux-x64/bin/node";
const NPM_CLI = "/workspace/pilot/toolchain/node-v22.23.2-linux-x64/lib/node_modules/npm/bin/npm-cli.js";

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

// The four canonical paid JSON-body POST operations (including the two POST
// aliases that share canonical GET routes).
const PAID_POST_ROUTES = Object.freeze([
  Object.freeze(["POST", "/work/opportunity-preflight"]),
  Object.freeze(["POST", "/commerce/payment-offer-preflight"]),
  Object.freeze(["POST", "/security/wallet-policy-conformance"]),
  Object.freeze(["POST", "/security/stateful-wallet-policy-conformance"]),
]);

const SOLANA_SIGNATURE_EXAMPLE = "3CjY38avdggKZbKfu2BmFYN4MUTiiNX27c8dHzPW79PrAx3huB9Pa6AfwW6sT4biax3y22z8toyLzmjtCc2QGNZn";

// ---------------------------------------------------------------------------
// Shared hostile-probe receipt (amendment 6 section 11): every stable ID is
// recorded exactly once with its expected and actual primary code.
// ---------------------------------------------------------------------------

function firstCode(findings) {
  return Array.isArray(findings) && findings.length > 0 ? findings[0].code : null;
}

function probe(id, actualCode) {
  const expected = expectedPrimaryCode(id);
  assert.equal(
    actualCode,
    expected,
    `${id}: expected primary ${expected}, observed ${actualCode}`,
  );
  recordHostileProbe(id, { expected, actual: actualCode });
}

const SECRET_MATERIAL_RE = /plain-secret-material|user:pass|sk-live-abc123|Bearer zzz|eyJwdWJsaWMiOiJmaXh0dXJlIn0/i;
const noEcho = (serializable) => {
  assert.equal(SECRET_MATERIAL_RE.test(JSON.stringify(serializable)), false, `secret material leaked: ${JSON.stringify(serializable).slice(0, 400)}`);
};

// ---------------------------------------------------------------------------
// Amendment 9 section 11.1 / amendment 10 section 8 combined labeled-probe
// receipt: 24 A9 rows plus 4 A10 rows, each recorded exactly once, separate
// from the 255-row R5 receipt. Digests are computed with the frozen
// equations; expected values are the contract constants below.
// ---------------------------------------------------------------------------

const A9_EXPECTED = Object.freeze({
  "A9.E.no-raw-percent-bytes": null,
  "A9.E.query-key-redacted": "MALFORMED_PERCENT",
  "A9.F.ref-document-root": "POLICY_KEYWORD_REJECTED",
  "A9.F.ref-mutual-cycle": null,
  "A9.F.ref-recursive-defs": null,
  "A9.P.additionalItems-only": "POLICY_KEYWORD_REJECTED",
  "A9.P.dynamicRef-only": "POLICY_KEYWORD_REJECTED",
  "A9.R.after-cache-bind": "CACHE_TRANSACTION_ABORTED",
  "A9.R.after-cache-bind-seeded": "CACHE_TRANSACTION_ABORTED",
  "A9.R.boot-entry-nonempty": "REGISTRY_NOT_EMPTY",
  "A9.R.cache-identity": null,
  "A9.R.late-registry-projection": "REGISTRY_NOT_EMPTY",
  "A9.R.unregister-fault-honest": "REGISTRY_NOT_EMPTY",
  "A9.R.unrelated-prefix-preserved": null,
  "A9.S.hostile-object": "INSTANCE_VALIDATION_FAILED",
  "A9.S.hostile-proxy": "PROXY_REJECTED",
  "A9.S.prepared-lone-percent": null,
  "A9.S.prepared-mixed-envelope": null,
  "A9.S.prepared-ordinary": null,
  "A9.S.prepared-percent-80": "MALFORMED_PERCENT",
  "A9.S.prepared-percent-c0af": "MALFORMED_PERCENT",
  "A9.S.prepared-percent-ff": "MALFORMED_PERCENT",
  "A9.S.prepared-truncated": null,
  "A9.S.url-component-percent-80": "MALFORMED_PERCENT",
});
const A10_EXPECTED = Object.freeze({
  "A10.R.cache-restore-fault-honest": "CACHE_TRANSACTION_ABORTED",
  "A10.R.overlapping-transaction": "CACHE_TRANSACTION_ABORTED",
  "A10.R.published-semantic-receipt": null,
  "A10.S.prepared-third-envelope": "PERCENT_DECODE_LIMIT",
});
const A10_MANIFEST_DIGEST = "8d7a8205619ac38dd2d4d4b917884c1f32ccceb6bcdd980bc236bbbea727d163";
const A10_PRIMARY_MAP_DIGEST = "a6bf8357051528dc48d61f350ed7473c39b85c1f6a07a05c1322a7a09d066209";
const A9_MANIFEST_DIGEST = "cffdd416c580dced86bedf09b2eb467bce8f0ce99791684b9684bcdfd03c93c4";
const A9_PRIMARY_MAP_DIGEST = "89c8afa9b90c66135348d5c609847a3c1929937c15c92bcf1b3105b4623fd9cd";
const COMBINED_MANIFEST_TAG = "x402-parity/amendment-10-probe-manifest/v1";
const COMBINED_PRIMARY_MAP_TAG = "x402-parity/amendment-10-primary-code-map/v1";
const A9_MANIFEST_TAG = "x402-parity/amendment-9-probe-manifest/v1";
const A9_PRIMARY_MAP_TAG = "x402-parity/amendment-9-primary-code-map/v1";

const combinedExpected = () => ({ ...A9_EXPECTED, ...A10_EXPECTED });

function labeledManifestDigest(tag, ids) {
  return createHash("sha256")
    .update(Buffer.concat([Buffer.from(tag, "utf8"), Buffer.from([0]), Buffer.from([...ids].sort().join("\n"), "utf8")]))
    .digest("hex");
}
function labeledPrimaryMapDigest(tag, records) {
  const lines = Object.entries(records).map(([id, code]) => `${id}\0${code ?? "null"}`).sort();
  return createHash("sha256")
    .update(Buffer.concat([Buffer.from(tag, "utf8"), Buffer.from([0]), Buffer.from(lines.join("\n"), "utf8")]))
    .digest("hex");
}

const labeledReceipt = { records: new Map() };

function recordLabeled(id, actual) {
  const expected = combinedExpected()[id];
  assert.notEqual(expected, undefined, `${id}: not in the frozen combined manifest`);
  assert.equal(labeledReceipt.records.has(id), false, `${id}: recorded more than once (TEST_MANIFEST_DRIFT)`);
  assert.equal(actual, expected, `${id}: expected primary ${expected}, observed ${actual}`);
  labeledReceipt.records.set(id, actual);
}

/** The P3 third-envelope fixture: the literal output of three successive
 * percentEncode1 applications to "%". Asserted against the fixed public
 * transform before the literal is passed to the implementation under test. */
const P3_LITERAL = "%25%32%35%25%33%32%25%33%35";
function assertP3Fixture() {
  const p1 = percentEncode1("%");
  const p2 = percentEncode1(p1);
  const p3 = percentEncode1(p2);
  assert.equal(p1, "%25");
  assert.equal(p2, "%25%32%35");
  assert.equal(p3, P3_LITERAL);
  assert.equal(percentEncode3("%"), P3_LITERAL);
  return P3_LITERAL;
}

// Fixed public sentinels (matrix-D fixtures; public test material, not credentials).
const KEY_SENTINEL = "api_key";
const VALUE_SENTINEL = "eyJwdWJsaWMiOiJmaXh0dXJlIn0.cHVibGlj.sig";

// ---------------------------------------------------------------------------
// Synthetic transaction fixtures: bounded two-document boots used by the
// hostile matrix, the rollback injections, and the Phase-C child target.
// ---------------------------------------------------------------------------

const SYNTHETIC_RESPONSE = () => ({ "200": { content: { "application/json": { schema: { type: "object" } } } } });

function syntheticGetDocument({ schema = { type: "string" }, example = "https://example.com", openapi = "3.1.0" } = {}) {
  return {
    openapi,
    info: { title: "synthetic", version: "1.23.20" },
    paths: {
      "/probe": {
        get: {
          "x-payment-info": {},
          operationId: "getProbe",
          parameters: [{ name: "q", in: "query", required: true, schema, example }],
          responses: SYNTHETIC_RESPONSE(),
        },
      },
    },
  };
}

function syntheticPostDocument({ schema = { type: "object" }, example = { url: "https://example.com" }, openapi = "3.1.0" } = {}) {
  return {
    openapi,
    info: { title: "synthetic", version: "1.23.20" },
    paths: {
      "/probe": {
        post: {
          "x-payment-info": {},
          operationId: "postProbe",
          requestBody: { content: { "application/json": { schema, example } } },
          responses: SYNTHETIC_RESPONSE(),
        },
      },
    },
  };
}

function syntheticQueryContract(example = "https://example.com") {
  return {
    example: { type: "http", method: "GET", queryParams: { q: example } },
    schema: { type: "object", properties: { queryParams: { required: ["q"] } } },
  };
}

function syntheticBodyContract(example = { url: "https://example.com" }) {
  return {
    example: { type: "http", method: "POST", bodyType: "json", body: example },
    schema: { type: "object" },
  };
}

function buildWithFixture({ method = "get", schema, example, openapi, injectFailureAt, runNonce, expectedCounts = { agentcash: 1, mpp: 1 } } = {}) {
  const makeDocument = method === "get"
    ? () => syntheticGetDocument({ schema: structuredClone(schema), example, openapi })
    : () => syntheticPostDocument({ schema: structuredClone(schema), example, openapi });
  const contract = method === "get" ? syntheticQueryContract(example) : syntheticBodyContract(example);
  const buildDocument = () => {
    const document = makeDocument();
    applyDiscoveryRequestExamples(document, (label) => (label === `${method.toUpperCase()} /probe` ? structuredClone(contract) : null));
    return document;
  };
  return prepareOpenApiParityStartup({
    buildDocument,
    resolveRequestContract: () => null,
    expectedPaidRouteCounts: expectedCounts,
    injectFailureAt,
    runNonce,
  });
}

/** Warm the compiled authority for fixture (schema, example) pairs. Scalar
 * examples ride GET query inputs; object/array examples ride POST bodies. */
async function warmAuthority(entries, { openapi = "3.1.0", expectOk = true } = {}) {
  const scalarEntries = entries.filter(([, example]) => isScalarQueryValue(example));
  const bodyEntries = entries.filter(([, example]) => !isScalarQueryValue(example));
  const parameters = scalarEntries.map(([schema, example], index) => ({
    name: `q${index}`, in: "query", required: true, schema: structuredClone(schema), example,
  }));
  const queryParams = Object.fromEntries(scalarEntries.map(([, example], index) => [`q${index}`, example]));
  const queryContract = {
    example: { type: "http", method: "GET", queryParams },
    schema: { type: "object", properties: { queryParams: { required: Object.keys(queryParams) } } },
  };
  const buildDocument = () => {
    const document = {
      openapi,
      info: { title: "warm", version: "1.23.20" },
      paths: {
        ...(scalarEntries.length > 0 ? { "/warm": { get: { "x-payment-info": {}, operationId: "warmProbe", parameters: structuredClone(parameters), responses: SYNTHETIC_RESPONSE() } } } : {}),
        ...Object.fromEntries(bodyEntries.map(([schema, example], index) => [
          `/warm-post-${index}`,
          { post: { "x-payment-info": {}, operationId: `warmPostProbe${index}`, requestBody: { content: { "application/json": { schema: structuredClone(schema), example: structuredClone(example) } } }, responses: SYNTHETIC_RESPONSE() } },
        ])),
      },
    };
    applyDiscoveryRequestExamples(document, (label) => {
      if (label === "GET /warm") return structuredClone(queryContract);
      const postIndex = /^POST \/warm-post-(\d+)$/.exec(label);
      if (postIndex) return { example: { type: "http", method: "POST", bodyType: "json", body: structuredClone(bodyEntries[Number(postIndex[1])][1]) }, schema: { type: "object" } };
      return null;
    });
    return document;
  };
  const operationCount = (scalarEntries.length > 0 ? 1 : 0) + bodyEntries.length;
  const receipt = await prepareOpenApiParityStartup({
    buildDocument,
    resolveRequestContract: () => null,
    expectedPaidRouteCounts: { agentcash: operationCount, mpp: operationCount },
  });
  if (expectOk) assert.equal(receipt.ok, true, `warmAuthority failed at ${receipt.stage} (${receipt.primaryCode})`);
  return receipt;
}

// ---------------------------------------------------------------------------
// Packed-artifact consumer + isolated Phase A/B/C child harness.
// ---------------------------------------------------------------------------

let packedConsumerPromise = null;
function ensurePackedConsumer() {
  if (packedConsumerPromise === null) {
    packedConsumerPromise = (async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "amend8-packed-"));
      const packRaw = execFileSync(NODE, [NPM_CLI, "pack", "--json", "--pack-destination", dir], { cwd, encoding: "utf8" });
      const pack = JSON.parse(packRaw);
      const tarball = path.join(dir, pack[0].filename);
      const consumer = path.join(dir, "consumer");
      await mkdir(consumer);
      await writeFile(path.join(consumer, "package.json"), JSON.stringify({ name: "empty-consumer", private: true, version: "1.0.0" }));
      // --legacy-peer-deps=false overrides an inherited npm_config_legacy_peer_deps
      // environment (npm test sets it from this repo's .npmrc), so the empty
      // consumer still installs the @hyperjump/browser peer of the frozen
      // direct dependency.
      execFileSync(NODE, [NPM_CLI, "install", tarball, "--no-audit", "--no-fund", "--loglevel=error", "--legacy-peer-deps=false"], { cwd: consumer, encoding: "utf8" });
      return {
        dir,
        tarball,
        tarballSha256: createHash("sha256").update(readFileSync(tarball)).digest("hex"),
        packFiles: pack[0].files.map((f) => f.path),
        consumer,
        parityPath: path.join(consumer, "node_modules", "x402-merchant", "openapi-request-example-parity.mjs"),
        consumerNodeModules: path.join(consumer, "node_modules"),
      };
    })();
  }
  return packedConsumerPromise;
}

const CLASSIFIER_SOURCE = `
export const ESM_TUPLE = "at #createModuleJob (node:internal/modules/esm/loader:648:21)";
export const CJS_TUPLE = "at node:internal/modules/cjs/loader:185:63";
const ADMITTED = new Set([ESM_TUPLE, CJS_TUPLE]);
export function installClassifier() {
  if (process.version !== "v22.23.2") throw new Error("VERSION_MISMATCH");
  const underlying = {};
  const loaderEnvReads = [];
  let sensitiveEnvCount = 0;
  let mode = "BOOTSTRAP";
  const firstNonHarnessFrame = (stack) => {
    if (typeof stack !== "string") return null;
    for (const line of stack.split("\\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("at ")) continue;
      if (trimmed.includes("harness-child.mjs") || trimmed.includes("classifier.mjs")) continue;
      return trimmed;
    }
    return null;
  };
  const fail = (op) => {
    sensitiveEnvCount += 1;
    throw new Error("ZERO_IO_TRIPWIRE:" + op + ":" + (firstNonHarnessFrame(new Error().stack) ?? "NO_FRAME"));
  };
  process.env = new Proxy(underlying, {
    get(target, property) {
      if (mode === "BOOTSTRAP"
        && property === "WATCH_REPORT_DEPENDENCIES"
        && !Object.prototype.hasOwnProperty.call(target, "WATCH_REPORT_DEPENDENCIES")
        && loaderEnvReads.length < 4096) {
        const caller = firstNonHarnessFrame(new Error().stack);
        if (caller !== null && ADMITTED.has(caller)) {
          loaderEnvReads.push({ property: "WATCH_REPORT_DEPENDENCIES", firstNonHarnessFrame: caller });
          return undefined;
        }
      }
      fail("get:" + String(property));
    },
    has: (t, p) => fail("has:" + String(p)),
    ownKeys: () => fail("ownKeys"),
    getOwnPropertyDescriptor: (t, p) => fail("gopd:" + String(p)),
    getPrototypeOf: () => fail("getPrototypeOf"),
    isExtensible: () => fail("isExtensible"),
    set: (t, p) => fail("set:" + String(p)),
    defineProperty: (t, p) => fail("defineProperty:" + String(p)),
    deleteProperty: (t, p) => fail("deleteProperty:" + String(p)),
    setPrototypeOf: () => fail("setPrototypeOf"),
    preventExtensions: () => fail("preventExtensions"),
  });
  return {
    loaderEnvReads,
    sensitiveEnvCount: () => sensitiveEnvCount,
    switchToValidation: () => { mode = "VALIDATION"; },
  };
}
`;

const TRACKER_SOURCE = `
export async function initialize(data) { globalThis.__port = data.port; }
export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context);
  try { globalThis.__port?.postMessage(result.url); } catch {}
  return result;
}
`;

function harnessChildSource() {
  return `
import { register } from "node:module";
import { MessageChannel } from "node:worker_threads";
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";
import fs from "node:fs";
import { installClassifier } from "./classifier.mjs";

// Console output reads process.env (FORCE_COLOR); replace every console
// method with a raw stream write BEFORE any instrumentation is installed.
const rawWrite = (stream) => (...args) => {
  try { stream.write(args.map((a) => (typeof a === "string" ? a : String(a))).join(" ") + "\\n"); } catch {}
};
console.log = rawWrite(process.stdout);
console.info = console.log;
console.warn = rawWrite(process.stderr);
console.error = rawWrite(process.stderr);
console.debug = console.log;

const mode = process.argv[2];
const packedParity = process.argv[3];
const counters = { fetch: 0, httpRequest: 0, httpsRequest: 0, dnsLookup: 0, fsRead: 0, netConnect: 0, credentialSentinel: 0 };
const trip = (name) => { counters[name] += 1; throw new Error("ZERO_IO_TRIPWIRE:" + name); };
globalThis.fetch = () => trip("fetch");
globalThis.__resolveCredentialSentinel = () => trip("credentialSentinel");
http.request = () => trip("httpRequest");
https.request = () => trip("httpsRequest");
dns.lookup = () => trip("dnsLookup");
net.connect = () => trip("netConnect");
// fs-read seam: during Phase B only, Node-loader-origin reads (the exact
// packed artifact and installed dependency tree) are admitted as bounded
// loader bookkeeping; every non-loader origin trips. In Phase C there is no
// admission at all.
let fsMode = "BOOTSTRAP";
const loaderFsReads = [];
const firstNonHarnessFrame = (stack) => {
  if (typeof stack !== "string") return null;
  for (const line of stack.split("\\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("at ")) continue;
    if (trimmed.includes("harness-child.mjs")) continue;
    return trimmed;
  }
  return null;
};
const fsGuard = (name) => {
  if (fsMode === "BOOTSTRAP") {
    const frame = firstNonHarnessFrame(new Error().stack);
    if (frame !== null && frame.includes("node:internal/modules/") && loaderFsReads.length < 4096) {
      loaderFsReads.push({ op: name, frame });
      return;
    }
  }
  counters.fsRead += 1;
  throw new Error("ZERO_IO_TRIPWIRE:fs:" + name);
};
const origReadFileSync = fs.readFileSync;
const origReadFile = fs.readFile;
const origOpenSync = fs.openSync;
const origOpen = fs.open;
fs.readFileSync = (...args) => { fsGuard("readFileSync"); return origReadFileSync(...args); };
fs.readFile = (...args) => { fsGuard("readFile"); return origReadFile(...args); };
fs.openSync = (...args) => { fsGuard("openSync"); return origOpenSync(...args); };
fs.open = (...args) => { fsGuard("open"); return origOpen(...args); };
const fsPromises = fs.promises;
const origPReadFile = fsPromises.readFile;
const origPOpen = fsPromises.open;
fsPromises.readFile = (...args) => { fsGuard("promises.readFile"); return origPReadFile(...args); };
fsPromises.open = (...args) => { fsGuard("promises.open"); return origPOpen(...args); };
import { syncBuiltinESMExports } from "node:module";
syncBuiltinESMExports();

const ctl = installClassifier();

async function main() {
  const receipt = { mode, node: process.version };
  if (mode.startsWith("sensitivity:")) {
    const seam = mode.slice("sensitivity:".length);
    let blocked = false;
    try {
      if (seam === "fetch") await globalThis.fetch("https://x.example/");
      else if (seam === "http-request") http.request("http://x.example/");
      else if (seam === "https-request") https.request("https://x.example/");
      else if (seam === "dns-lookup") dns.lookup("x.example", () => {});
      else if (seam === "net-connect") net.connect({ host: "127.0.0.1", port: 1 });
      else if (seam === "fs-read") fs.readFileSync("/etc/hostname");
      else if (seam === "credential-sentinel") globalThis.__resolveCredentialSentinel("wallet");
      else if (seam === "process-env") process.env.PILOT_ENV_SENSITIVITY_SENTINEL;
      else throw new Error("unknown seam: " + seam);
    } catch (error) {
      blocked = String(error.message).startsWith("ZERO_IO_TRIPWIRE");
      receipt.failure = String(error.message).slice(0, 200);
    }
    receipt.seam = seam;
    const keyMap = { "http-request": "httpRequest", "https-request": "httpsRequest", "dns-lookup": "dnsLookup", "net-connect": "netConnect", "credential-sentinel": "credentialSentinel", "fs-read": "fsRead" };
    receipt.count = seam === "process-env" ? ctl.sensitiveEnvCount() : counters[keyMap[seam] ?? seam];
    receipt.blocked = blocked;
    receipt.observed = "NOT_EXPOSED";
    process.stdout.write(JSON.stringify(receipt) + "\\n");
    return;
  }
  const { port1, port2 } = new MessageChannel();
  const urls = new Set();
  port1.on("message", (url) => urls.add(url));
  register(new URL("./tracker.mjs", import.meta.url), { data: { port: port2 }, transferList: [port2] });
  const consumerRoot = new URL("../", new URL(packedParity, "file://")).href;
  const formats = await import(new URL("@hyperjump/json-schema/formats/index.js", consumerRoot).href);
  const oas30 = await import(new URL("@hyperjump/json-schema/openapi-3-0/index.js", consumerRoot).href);
  const oas31 = await import(new URL("@hyperjump/json-schema/openapi-3-1/index.js", consumerRoot).href);
  const parity = await import(packedParity);
  await new Promise((resolve) => setTimeout(resolve, 200));
  port1.close();
  const esm = ctl.loaderEnvReads.filter((r) => r.firstNonHarnessFrame.includes("#createModuleJob")).length;
  const cjs = ctl.loaderEnvReads.filter((r) => r.firstNonHarnessFrame.includes("cjs/loader")).length;
  receipt.loaderEnv = {
    total: ctl.loaderEnvReads.length, esm, cjs, sensitiveEnvCount: ctl.sensitiveEnvCount(),
    onlyAdmittedTuples: ctl.loaderEnvReads.every((r) => r.property === "WATCH_REPORT_DEPENDENCIES" && (r.firstNonHarnessFrame.includes("#createModuleJob") || r.firstNonHarnessFrame.includes("cjs/loader"))),
  };
  receipt.seams = { ...counters };
  receipt.loaderFsReads = loaderFsReads.length;
  receipt.exports = {
    formats: Object.keys(formats).sort(),
    "openapi-3-0": Object.keys(oas30).sort(),
    "openapi-3-1": Object.keys(oas31).sort(),
    parity: Object.keys(parity).sort(),
  };
  receipt.moduleUrls = [...urls].sort();
  receipt.parityOk = typeof parity.prepareOpenApiParityStartup === "function";
  if (mode === "target-transaction") {
    ctl.switchToValidation();
    fsMode = "VALIDATION";
    const snapshotReads = ctl.loaderEnvReads.length;
    const snapshotUrls = [...urls].sort().join("|");
    for (const key of Object.keys(counters)) counters[key] = 0;
    const builder = () => {
      const doc = {
        openapi: "3.1.0",
        info: { title: "t", version: "1.23.20" },
        paths: { "/probe": { get: { "x-payment-info": {}, operationId: "getProbe", parameters: [{ name: "q", in: "query", required: true, schema: { type: "string" }, example: "https://example.com" }], responses: { "200": { content: { "application/json": { schema: { type: "object" } } } } } } } },
      };
      parity.applyDiscoveryRequestExamples(doc, () => ({ example: { type: "http", method: "GET", queryParams: { q: "https://example.com" } }, schema: { type: "object", properties: { queryParams: { required: ["q"] } } } }));
      return doc;
    };
    const okRun = await parity.prepareOpenApiParityStartup({ buildDocument: builder, resolveRequestContract: () => null, expectedPaidRouteCounts: { agentcash: 1, mpp: 1 } });
    const okCounters = { ...counters };
    const abortRun = await parity.prepareOpenApiParityStartup({ buildDocument: builder, resolveRequestContract: () => null, expectedPaidRouteCounts: { agentcash: 1, mpp: 1 }, injectFailureAt: "cache-bind" });
    const hostileRefFindings = parity.validateExampleAgainstSchema("x", { $ref: "https://evil.example/schema.json" }, "$", { documentOpenApiVersion: "3.1.0" });
    receipt.transaction = {
      ok: okRun.ok === true,
      okStages: okRun.stages,
      okCountersZero: Object.values(okCounters).every((v) => v === 0),
      okReadsUnchanged: ctl.loaderEnvReads.length === snapshotReads,
      okUrlsUnchanged: [...urls].sort().join("|") === snapshotUrls,
      abortCode: abortRun.primaryCode,
      abortStagesThroughRollback: abortRun.stages,
      abortCountersZero: Object.values(counters).every((v) => v === 0),
      abortReadsUnchanged: ctl.loaderEnvReads.length === snapshotReads,
      abortUrlsUnchanged: [...urls].sort().join("|") === snapshotUrls,
      abortRollback: abortRun.rollback,
      envSensitiveTotal: ctl.sensitiveEnvCount(),
      hostileRefCode: hostileRefFindings.find(() => true)?.code ?? null,
    };
  }
  process.stdout.write(JSON.stringify(receipt) + "\\n");
}
main().catch((error) => { process.stderr.write("HARNESS_FAIL " + String(error?.stack || error).slice(0, 800) + "\\n"); process.exit(1); });
`;
}

let harnessDirPromise = null;
function ensureHarnessDir() {
  if (harnessDirPromise === null) {
    harnessDirPromise = (async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "amend8-harness-"));
      await writeFile(path.join(dir, "classifier.mjs"), CLASSIFIER_SOURCE);
      await writeFile(path.join(dir, "tracker.mjs"), TRACKER_SOURCE);
      await writeFile(path.join(dir, "harness-child.mjs"), harnessChildSource());
      return dir;
    })();
  }
  return harnessDirPromise;
}

async function runHarnessChild(mode, parityPath) {
  const dir = await ensureHarnessDir();
  return new Promise((resolve, reject) => {
    const child = spawn(NODE, [path.join(dir, "harness-child.mjs"), mode, parityPath], {
      cwd: dir,
      env: {},
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`harness child timed out (mode ${mode}): ${stderr.slice(-400)}`));
    }, 120_000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`harness child exited ${code} (mode ${mode}): ${stderr.slice(-600)}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim().split("\n").pop()));
      } catch (error) {
        reject(new Error(`harness child produced no receipt (mode ${mode}): ${stdout.slice(0, 200)} ${stderr.slice(0, 400)}`));
      }
    });
  });
}

// Frozen packed-target closure authority: relative module-URL set digest and
// exported direct-entrypoint set digest of the exact installed tree.
const PACKED_MODULE_URL_SET_COUNT = 185;
const PACKED_MODULE_URL_SET_DIGEST = "7879078db482052d668978ef1991f0f24ab19cfc26d24ec10f61b3288665d9f8";
const PACKED_EXPORT_SET_DIGEST = "a5b005520bfd0717544afdc231033e0402ff7f8f8e0eb097173b4743f89c7b63";

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

/** Bind the fetched live document's schema authorities in this process so the
 * parity audit resolves compiled validators instead of failing closed. */
async function prepareFetchedDocuments({ agentcash, mpp, circleGatewayEnabled }) {
  const paidCount = (document) => Object.values(document.paths).reduce((sum, item) => sum + (item?.get?.["x-payment-info"] ? 1 : 0) + (item?.post?.["x-payment-info"] ? 1 : 0), 0);
  const receipt = await prepareOpenApiParityStartup({
    documents: { agentcash, mpp },
    resolveRequestContract: () => null,
    circleGatewayEnabled,
    expectedPaidRouteCounts: { agentcash: paidCount(agentcash), mpp: paidCount(mpp) },
  });
  assert.equal(receipt.ok, true, `fetched-document prepare failed at ${receipt.stage} (${receipt.primaryCode})`);
  return receipt;
}

// ===========================================================================
// 19 focused nodes (exact existing identities). The complete hostile matrix
// runs as labeled assertions inside these nodes; the final node asserts the
// exact sorted ID set and both frozen digests.
// ===========================================================================

test("scopes the public signature exception to the canonical Solana receipt query", () => {
  assert.deepEqual(PUBLIC_SOLANA_SIGNATURE_QUERY, {
    method: "GET",
    route: "/chain/solana-transaction-receipt",
    field: "signature",
    schemaPattern: "^[1-9A-HJ-NP-Za-km-z]{80,90}$",
  });
  // The bare key is rejected everywhere by default...
  assert.equal(isSensitiveExampleName("signature"), true);
  assert.equal(isSensitiveExampleName("requestSignature"), true);
  // ...and allowed only through the explicitly scoped option, which the
  // projection and gate apply only on the exact method-route.
  assert.equal(isSensitiveExampleName("signature", { allowPublicSolanaSignatureField: true }), false);
  assert.equal(isSensitiveExampleName("requestSignature", { allowPublicSolanaSignatureField: true }), true);
  assert.equal(isSensitiveExampleName("api_token"), true);
  assert.equal(isSensitiveExampleName("accessToken"), true);
  assert.equal(isSensitiveExampleName("session-id"), true);
  assert.equal(isSensitiveExampleName("__proto__"), true);
  assert.equal(isSensitiveExampleName("rewardUsd"), false);
  assert.equal(isSensitiveExampleName("hourlyCostUsd"), false);
});

test("classifies scalars, templates, and credential-like values", () => {
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

  // L.finding-cap-128: 129 otherwise-safe findings keep a bounded public list
  // of at most 128, report truncation, and expose FINDING_CAP_REACHED as the
  // primary code separately from the bounded list.
  const capFixture = {};
  for (let index = 0; index < MAX_FINDINGS + 1; index += 1) capFixture[`note${index}`] = `Bearer zz${index}`;
  const report = exampleFindingsReport(capFixture);
  assert.equal(report.findings.length, MAX_FINDINGS);
  assert.equal(report.truncated, true);
  probe("R5.L.finding-cap-128", report.primaryCode);
  noEcho(report.findings);

  // L.deterministic-order: repeated scans produce identical bounded output.
  const orderFixture = { b: "Bearer zz1", a: "Bearer zz2", c: "Bearer zz3" };
  const first = exampleFindingsReport(orderFixture);
  const second = exampleFindingsReport(orderFixture);
  assert.deepEqual(first.findings, second.findings);
  assert.equal(first.truncated, false);
  noEcho(first.findings);
  probe("R5.L.deterministic-order", null);
});

test("rejects credential-bearing URLs and keeps ordinary public URLs valid", () => {
  // Ordinary public URLs — including ordinary query strings — stay valid.
  assert.deepEqual(credentialBearingUrlFindings("https://example.com/page"), []);
  assert.deepEqual(credentialBearingUrlFindings("https://agents.samedaydesk.com/defi/morpho-position?address=0x8ee9c15c3e5332cbc6ef39a2bb036c63c6549b6e"), []);
  assert.deepEqual(credentialBearingUrlFindings("https://example.com/extract?url=https%3A%2F%2Fexample.com"), []);
  assert.deepEqual(credentialBearingUrlFindings("eip155:8453"), []);
  assert.deepEqual(credentialBearingUrlFindings("0x8ee9c15c3e5332cbc6ef39a2bb036c63c6549b6e"), []);
  // Userinfo, fragments, sensitive query keys/values, nested URL userinfo, and hidden channels.
  assert.ok(credentialBearingUrlFindings("https://user:pass@example.com/page").some((f) => f.code === "USERINFO_CREDENTIALS"));
  assert.ok(credentialBearingUrlFindings("https://example.com/page#token=zzz").some((f) => f.code === "FRAGMENT_CHANNEL"));
  assert.ok(credentialBearingUrlFindings("https://example.com/page?api_key=sk-live-abc123").some((f) => f.code === "CREDENTIAL_LIKE_KEY"));
  assert.ok(credentialBearingUrlFindings("https://example.com/page?authorization=Bearer%20zzz").some((f) => f.code === "CREDENTIAL_LIKE_KEY"));
  assert.ok(credentialBearingUrlFindings("https://example.com/page?session=abc123").some((f) => f.code === "CREDENTIAL_LIKE_KEY"));
  assert.ok(credentialBearingUrlFindings("https://example.com/extract?url=https://user:pass@evil.example/").some((f) => f.code === "USERINFO_CREDENTIALS"));

  // D-class URI-channel surfaces at raw/percent1/percent2 with the fixed
  // public sentinels. Every fixture fails closed with its exact primary code
  // and never echoes the sentinel.
  const urlFixture = (surface, depth) => {
    const encode = depth === "raw" ? (s) => s : depth === "percent1" ? percentEncode1 : percentEncode2;
    if (surface === "url-query-key") return `https://example.com/?${encode(KEY_SENTINEL)}=public`;
    if (surface === "url-query-value") return `https://example.com/?target=${encode(VALUE_SENTINEL)}`;
    if (surface === "userinfo") return `https://${encode(VALUE_SENTINEL)}@example.com/`;
    if (surface === "host") return `https://${encode(VALUE_SENTINEL)}.example.com/`;
    if (surface === "path") return `https://example.com/${encode(VALUE_SENTINEL)}`;
    if (surface === "fragment") return `https://example.com/page#${encode(VALUE_SENTINEL)}`;
    if (surface === "nested-url") {
      const nested = `https://evil.example/?token=${encode(VALUE_SENTINEL)}`;
      return depth === "raw" || depth === "percent1"
        ? `https://example.com/extract?url=${encodeURIComponent(nested)}`
        : `https://example.com/extract?url=${nested}`;
    }
    throw new Error(`unknown URI surface ${surface}`);
  };
  for (const surface of ["url-query-key", "url-query-value", "userinfo", "host", "path", "fragment", "nested-url"]) {
    for (const depth of ["raw", "percent1", "percent2"]) {
      const value = urlFixture(surface, depth);
      let findings;
      try {
        findings = credentialBearingUrlFindings(value);
      } catch (error) {
        assert.notEqual(error?.name, "URIError", `${surface}/${depth} threw URIError`);
        throw error;
      }
      assert.equal(findings.length > 0, true, `${surface}/${depth} stayed clean`);
      noEcho(findings);
      probe(`R5.D.${surface}.${depth}`, findings[0].code);
    }
  }
});

test("bounded multi-decode URL privacy fails closed without URIError or secret leakage", () => {
  // J-class transport cases over the strict URI state machine.
  const cases = [
    ["raw-path-percent25-clean", "https://example.com/100%25-guaranteed", null],
    ["raw-query-percent25-clean", "https://example.com/?rate=50%25", null],
    ["raw-malformed-ZZ", "https://example.com/%ZZ", "MALFORMED_PERCENT"],
    ["raw-truncated-2", "https://example.com/%2", "MALFORMED_PERCENT"],
    ["raw-invalid-utf8-80", "https://example.com/%80", "MALFORMED_PERCENT"],
    ["raw-double-percent", "https://example.com/%%20", "MALFORMED_PERCENT"],
    ["raw-percent-u", "https://example.com/%u041", "MALFORMED_PERCENT"],
    ["transport1-percent25-clean", "https://example.com/100%2525-guaranteed", null],
    ["transport2-percent25-clean", "https://example.com/rate%3D50%2525", null],
    ["decoded-prose-bare-percent-clean", "https://example.com/50%25%20complete", null],
    ["transport1-encoded-malformed", "https://example.com/%25ZZ", "MALFORMED_PERCENT"],
    ["transport2-encoded-malformed", "https://example.com/%2525ZZ", "MALFORMED_PERCENT"],
  ];
  for (const [member, value, expected] of cases) {
    let findings;
    try {
      findings = credentialBearingUrlFindings(value);
    } catch (error) {
      assert.notEqual(error?.name, "URIError", `${member} threw URIError`);
      throw error;
    }
    noEcho(findings);
    probe(`R5.J.${member}`, findings.some((f) => f.code === "MALFORMED_PERCENT" || f.code === "PERCENT_DECODE_LIMIT") ? findings[0].code : (findings[0]?.code ?? null));
    if (expected === null) assert.deepEqual(findings, [], `${member} must stay clean`);
  }
  // %252525 reaches the decode limit.
  assert.equal(credentialBearingUrlFindings("https://example.com/%252525")[0]?.code, "PERCENT_DECODE_LIMIT");
  assert.deepEqual(credentialBearingUrlFindings("https://example.com/extract?url=https%3A%2F%2Fexample.com"), []);
  assert.deepEqual(credentialBearingUrlFindings("https://example.com/page"), []);

  // A9.E privacy rows (same host node): no serialized finding set carries raw
  // percent bytes, and the query-key channel is redacted.
  const hostilePercentSets = [
    credentialBearingUrlFindings("https://example.com/?%80=x"),
    credentialBearingUrlFindings("https://example.com/?target=%C0%AF"),
    unsafeExampleFindings({ target: "%E0%80%80" }),
  ];
  for (const findings of hostilePercentSets) {
    assert.doesNotThrow(() => JSON.stringify(findings));
    assert.equal(SECRET_MATERIAL_RE.test(JSON.stringify(findings)), false, `secret material leaked: ${JSON.stringify(findings).slice(0, 400)}`);
    assert.equal(JSON.stringify(findings).includes("%80"), false, "raw %80 bytes echoed");
    assert.equal(JSON.stringify(findings).includes("%C0%AF"), false, "raw %C0%AF bytes echoed");
    assert.equal(JSON.stringify(findings).includes("%E0%80%80"), false, "raw %E0%80%80 bytes echoed");
  }
  recordLabeled("A9.E.no-raw-percent-bytes", null);
  const queryKey80 = credentialBearingUrlFindings("https://example.com/?%80=x").find((f) => f.channel === "query key");
  assert.ok(queryKey80, "expected a query-key finding");
  assert.equal(queryKey80.code, "MALFORMED_PERCENT");
  assert.equal(queryKey80.message, "$: URL example query key carries malformed percent encoding");
  noEcho([queryKey80]);
  recordLabeled("A9.E.query-key-redacted", queryKey80.code);
});

test("nested object example values fail closed on encoded secrets and encoded URLs", () => {
  const decodeOf = (needle, code) => (findings) => findings.some((f) => f.code === needle) || findings[0]?.code === code;
  assert.ok(decodeOf("CREDENTIAL_LIKE_KEY")(unsafeExampleFindings({ nested: { target: "https://example.com/?%2574oken=plain-secret-material" } })));
  assert.ok(decodeOf("USERINFO_CREDENTIALS")(unsafeExampleFindings({ nested: { next: "https://example.com/?next=https%253A%252F%252Fu%253Ap%2540evil.example%252F" } })));
  assert.ok(decodeOf("CREDENTIAL_LIKE_VALUE")(unsafeExampleFindings({ header: "%73k-live-abc123" })));
  assert.ok(decodeOf("CREDENTIAL_LIKE_VALUE")(unsafeExampleFindings({ header: "%2573k-live-abc123" })));
  assert.ok(decodeOf("CREDENTIAL_LIKE_KEY")(unsafeExampleFindings({ "%2574oken": "public" })));
  assert.deepEqual(unsafeExampleFindings({ ok: true, url: "https://example.com" }), []);

  // D-class object/array surfaces with the fixed public sentinels.
  const plainFixture = (surface, depth) => {
    const encode = depth === "raw" ? (s) => s : depth === "percent1" ? percentEncode1 : percentEncode2;
    if (surface === "object-root-key") return { [encode(KEY_SENTINEL)]: "public" };
    if (surface === "object-root-value") return { target: encode(VALUE_SENTINEL) };
    if (surface === "object-nested-key") return { outer: { [encode(KEY_SENTINEL)]: "public" } };
    if (surface === "object-nested-value") return { outer: { target: encode(VALUE_SENTINEL) } };
    if (surface === "array-value") return { items: [encode(VALUE_SENTINEL)] };
    throw new Error(`unknown plain surface ${surface}`);
  };
  for (const surface of ["object-root-key", "object-root-value", "object-nested-key", "object-nested-value", "array-value"]) {
    for (const depth of ["raw", "percent1", "percent2"]) {
      const findings = unsafeExampleFindings(plainFixture(surface, depth));
      assert.equal(findings.length > 0, true, `${surface}/${depth} stayed clean`);
      noEcho(findings);
      probe(`R5.D.${surface}.${depth}`, findings[0].code);
    }
  }
});

test("walks example trees for credential-like keys, prototype names, templates, and URLs", () => {
  assert.deepEqual(unsafeExampleFindings({ ok: true, url: "https://example.com" }), []);
  assert.ok(unsafeExampleFindings({ api_token: "not-a-secret" }).some((f) => f.code === "CREDENTIAL_LIKE_KEY"));
  assert.ok(unsafeExampleFindings({ nested: { constructor: {} } }).some((f) => f.code === "PROTOTYPE_KEY_REJECTED"));
  assert.ok(unsafeExampleFindings({ note: "{missing}" }).some((f) => f.code === "UNRESOLVED_TEMPLATE"));
  assert.ok(unsafeExampleFindings({ header: "Bearer zzz" }).some((f) => f.code === "CREDENTIAL_LIKE_VALUE"));
  assert.ok(unsafeExampleFindings({ target: "https://u:p@example.com" }).some((f) => f.code === "USERINFO_CREDENTIALS"));
  assert.ok(unsafeExampleFindings({ target: "https://example.com/?token=zz" }).some((f) => f.code === "CREDENTIAL_LIKE_KEY"));

  // D-class schema-position and validator-instance surfaces: the sentinel is
  // fixture data in schema/instance positions and never echoes into findings.
  const encode = (depth, s) => (depth === "raw" ? s : depth === "percent1" ? percentEncode1(s) : percentEncode2(s));
  for (const depth of ["raw", "percent1", "percent2"]) {
    let findings = unsafeExampleFindings({ schema: { properties: { [encode(depth, KEY_SENTINEL)]: { type: "string" } } } });
    noEcho(findings);
    probe(`R5.D.schema-property-key.${depth}`, findings[0]?.code ?? null);

    findings = unsafeExampleFindings({ schema: { required: [encode(depth, KEY_SENTINEL)] } });
    noEcho(findings);
    probe(`R5.D.schema-required-value.${depth}`, findings[0]?.code ?? null);

    findings = unsafeExampleFindings({ schema: { const: encode(depth, VALUE_SENTINEL) } });
    noEcho(findings);
    probe(`R5.D.schema-const-value.${depth}`, findings[0]?.code ?? null);

    findings = unsafeExampleFindings({ schema: { enum: [encode(depth, VALUE_SENTINEL)] } });
    noEcho(findings);
    probe(`R5.D.schema-enum-value.${depth}`, findings[0]?.code ?? null);

    findings = unsafeExampleFindings({ instance: encode(depth, VALUE_SENTINEL) });
    noEcho(findings);
    probe(`R5.D.validator-instance.${depth}`, findings[0]?.code ?? null);
  }
});

test("compares values canonically without stringify order equality", async () => {
  assert.equal(valuesCanonicallyEqual({ a: 1, b: [2, { c: 3 }] }, { b: [2, { c: 3 }], a: 1 }), true);
  assert.equal(valuesCanonicallyEqual({ a: 1 }, { a: 2 }), false);
  assert.equal(valuesCanonicallyEqual([1, 2], [2, 1]), false);
  assert.equal(valuesCanonicallyEqual({ a: 1 }, { a: 1, b: undefined }), false);
  assert.equal(valuesCanonicallyEqual("x", "x"), true);
  assert.equal(valuesCanonicallyEqual(10, 10), true);
  assert.equal(JSON.stringify({ b: 1, a: 2 }) === JSON.stringify({ a: 2, b: 1 }), false);
  assert.equal(valuesCanonicallyEqual({ b: 1, a: 2 }, { a: 2, b: 1 }), true);

  // Frozen digest primitives (constants, never generated by the code under
  // test as its own oracle).
  const vcBytes = Buffer.from(canonicalBytes(V_C_VECTOR), "utf8");
  assert.equal(vcBytes.toString("hex"), DIGEST_VECTORS.V_C_BYTES);
  assert.equal(createHash("sha256").update(vcBytes).digest("hex"), DIGEST_VECTORS.V_C_SHA256);
  assert.equal(taggedDigest("x402-parity/vector/v1"), DIGEST_VECTORS.H_ZERO_FIELD);
  assert.equal(taggedDigest("x402-parity/vector/v1", "", "alpha", "00"), DIGEST_VECTORS.H_EMPTY_ALPHA_00);
  assert.equal(computeCacheManifestDigest([]), DIGEST_VECTORS.D_CACHE_EMPTY);
  assert.equal(
    computeCacheManifestDigest([
      `${"3ba06a60fb5b33189e6b01fcc310e3a7c465dfb58820c3718174fb2d48d879d8"}\0${DIALECT_IDENTITIES.OAS30}\0${PARITY_RUNTIME_VERSION}`,
      `${"b570d235a268343f969633a12c157534587da49bb7ccb92e197a23f40eb26b02"}\0${DIALECT_IDENTITIES.OAS31_BASE}\0${PARITY_RUNTIME_VERSION}`,
    ]),
    DIGEST_VECTORS.D_CACHE_TWO,
  );
  assert.deepEqual(BOOT_MODES, ["circle_enabled", "circle_disabled"]);
  assert.equal(FAILURE_CODES.includes("STARTUP_ABORTED"), true);
  assert.equal(FAILURE_CODES.length, 53);

  // P-class digest/lifecycle probes over a clean synthetic boot.
  resetParityAuthorityForTests();
  const builder = () => {
    const document = syntheticGetDocument({});
    applyDiscoveryRequestExamples(document, (label) => (label === "GET /probe" ? syntheticQueryContract() : null));
    return document;
  };
  const options = { buildDocument: builder, resolveRequestContract: () => null, expectedPaidRouteCounts: { agentcash: 1, mpp: 1 } };
  const firstBoot = await prepareOpenApiParityStartup({ ...options, injectFailureAt: "terminal-audit" });
  probe("R5.P.source-digest-stable-on-failure", firstBoot.primaryCode);
  assert.equal(firstBoot.rollback.sourceDigestsReproduced, true);
  const okBoot = await prepareOpenApiParityStartup(options);
  probe("R5.P.prepared-digest-changes-on-projection", okBoot.ok && okBoot.receipts.prepared.agentcash !== okBoot.receipts.source.agentcash ? null : "DIGEST_MISMATCH");
  probe("R5.P.published-digest-equals-prepared", okBoot.receipts.published.agentcash === okBoot.receipts.prepared.agentcash && okBoot.receipts.published.mpp === okBoot.receipts.prepared.mpp ? null : "DIGEST_MISMATCH");
  const originalDigestAfter = taggedDigest("x402-parity/source-doc/v1", okBoot.mode, "agentcash", createHash("sha256").update(Buffer.from(canonicalBytes(builder()), "utf8")).digest("hex"));
  probe("R5.P.original-digest-unchanged", originalDigestAfter === okBoot.receipts.source.agentcash ? null : "ORIGINAL_MUTATED");
  probe("R5.P.cache-manifest-exact", computeCacheManifestDigest([]) === DIGEST_VECTORS.D_CACHE_EMPTY && computeCacheManifestDigest([
    `${"3ba06a60fb5b33189e6b01fcc310e3a7c465dfb58820c3718174fb2d48d879d8"}\0${DIALECT_IDENTITIES.OAS30}\0${PARITY_RUNTIME_VERSION}`,
    `${"b570d235a268343f969633a12c157534587da49bb7ccb92e197a23f40eb26b02"}\0${DIALECT_IDENTITIES.OAS31_BASE}\0${PARITY_RUNTIME_VERSION}`,
  ]) === DIGEST_VECTORS.D_CACHE_TWO ? null : "DIGEST_MISMATCH");
  probe("R5.P.boot-digest-default", okBoot.mode === "circle_disabled" || okBoot.mode === "circle_enabled" ? null : "STARTUP_ABORTED");
  const enabledBoot = await prepareOpenApiParityStartup({ ...options, mode: "circle_enabled" });
  probe("R5.P.boot-digest-circle-disabled", enabledBoot.ok && enabledBoot.receipts.dBoot !== okBoot.receipts.dBoot ? null : "DIGEST_MISMATCH");
  const secondBoot = await prepareOpenApiParityStartup(options);
  probe("R5.P.second-boot-cache-hit", secondBoot.ok && secondBoot.compiledNew === 0 && secondBoot.receipts.dBoot === okBoot.receipts.dBoot ? null : "CACHE_IDENTITY_MISMATCH");
  const rollbackBoot = await prepareOpenApiParityStartup({ ...options, injectFailureAt: "cache-bind" });
  probe("R5.P.cache-transaction-rollback", rollbackBoot.primaryCode);
  probe("R5.P.digest-stage-order-acyclic", okBoot.stages.every((stage, index) => stage === STARTUP_STAGES[index]) ? null : "STARTUP_ABORTED");

  // A9.P policy rows (same host node): a synthetic document whose only
  // hostile member is the frozen keyword aborts at POLICY_SCAN with
  // POLICY_KEYWORD_REJECTED — the walk visits every materialized object.
  await resetParityAuthorityForTests();
  const policyDocOf = (schema) => ({
    openapi: "3.1.0",
    info: { title: "policy", version: "1.23.20" },
    paths: { "/probe": { get: { "x-payment-info": {}, operationId: "getProbe", parameters: [{ name: "q", in: "query", required: true, schema, example: "https://example.com" }], responses: SYNTHETIC_RESPONSE() } } },
  });
  for (const [id, schema] of [
    ["A9.P.dynamicRef-only", { type: "string", $dynamicRef: "#foo" }],
    ["A9.P.additionalItems-only", { type: "array", additionalItems: false }],
  ]) {
    const receipt = await prepareOpenApiParityStartup({
      documents: { agentcash: policyDocOf(structuredClone(schema)), mpp: policyDocOf(structuredClone(schema)) },
      resolveRequestContract: () => null,
      expectedPaidRouteCounts: { agentcash: 1, mpp: 1 },
    });
    recordLabeled(id, receipt.primaryCode);
    assert.equal(receipt.ok, false);
    assert.equal(receipt.stage, "POLICY_SCAN");
    assert.equal(receipt.primaryCode, "POLICY_KEYWORD_REJECTED");
  }
  await resetParityAuthorityForTests();
});

test("validates examples with the standards-complete 2020-12 validator, fail-closed on hostile schemas", async () => {
  await warmAuthority([
    [{ type: "number", exclusiveMinimum: 0 }, 10],
    [{ type: "string", pattern: "^0x[0-9a-fA-F]{40}$" }, `0x${"a".repeat(40)}`],
    [{ type: "string", format: "uri" }, "https://example.com"],
    [{ type: "integer" }, 2],
    [{ type: "object", properties: { url: { type: "string", format: "uri" } }, required: ["url"], additionalProperties: false }, { url: "https://example.com" }],
    [{ type: "object", properties: { url: { type: "string" }, catalog: { type: "object" } }, required: ["url"], additionalProperties: false }, { url: "https://example.com" }],
    [{ allOf: [{ type: "string" }, { minLength: 2 }] }, "abc"],
    [{ oneOf: [{ type: "string" }, { type: "number" }] }, 5],
    [{ anyOf: [{ type: "string" }, { type: "number" }] }, "x"],
    [{ not: { type: "string" } }, 7],
    [{ if: { type: "string" }, then: { minLength: 2 }, else: { type: "number" } }, "hot"],
    [{ type: "object", properties: { known: { type: "string" } }, unevaluatedProperties: false }, { known: "x" }],
    [{ type: "object", properties: { a: { type: "number" }, name: { type: "string" } }, dependentRequired: { a: ["name"] } }, { a: 1, name: "n" }],
    [{ type: "object", patternProperties: { "^tag$": { type: "string", minLength: 2 } }, propertyNames: { pattern: "^[a-z]+$" } }, { tag: "ab" }],
    [{ $defs: { inner: { type: "integer" } }, properties: { nested: { $ref: "#/$defs/inner" } }, required: ["nested"] }, { nested: 1 }],
    [{ const: { a: 2, b: 1 } }, { b: 1, a: 2 }],
    [{ const: { a: 1, b: 1 } }, { a: 1, b: 1 }],
    [{ type: "string", format: "date-time" }, "2024-01-15T10:30:00Z"],
    [{ type: "string", format: "nope" }, "anything"],
    [{ type: "string", enum: ["base", "ethereum"] }, "base"],
    [{ type: "object", properties: { a: { type: "string" } }, dependentSchemas: { a: { properties: { name: { type: "string" } }, required: ["name"] } } }, { a: "x", name: "n" }],
  ]);
  const V = (value, schema, options = {}) => firstCode(validateExampleAgainstSchema(value, schema, "$", options));
  // Core assertion vocabulary and applicators the old fail-open subset ignored.
  assert.equal(V(10, { type: "number", exclusiveMinimum: 0 }), null);
  assert.equal(V(0, { type: "number", exclusiveMinimum: 0 }), "INSTANCE_VALIDATION_FAILED");
  assert.equal(V("nope", { type: "string", enum: ["base", "ethereum"] }), "INSTANCE_VALIDATION_FAILED");
  assert.equal(V(`0x${"a".repeat(40)}`, { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" }), null);
  assert.equal(V(1.5, { type: "integer" }), "INSTANCE_VALIDATION_FAILED");
  assert.equal(V(true, { oneOf: [{ type: "string" }, { type: "number" }] }), "INSTANCE_VALIDATION_FAILED");
  assert.equal(V("x", { not: { type: "string" } }), "INSTANCE_VALIDATION_FAILED");
  assert.equal(V("x", { if: { type: "string" }, then: { minLength: 2 }, else: { type: "number" } }), "INSTANCE_VALIDATION_FAILED");
  assert.equal(V({ known: "x", extra: 1 }, { type: "object", properties: { known: { type: "string" } }, unevaluatedProperties: false }), "INSTANCE_VALIDATION_FAILED");
  assert.equal(V({ a: 1 }, { type: "object", properties: { a: { type: "number" }, name: { type: "string" } }, dependentRequired: { a: ["name"] } }), "INSTANCE_VALIDATION_FAILED");
  assert.equal(V({ catalog: { source: "x" } }, { type: "object", properties: { url: { type: "string" }, catalog: { type: "object" } }, required: ["url"], additionalProperties: false }), "INSTANCE_VALIDATION_FAILED");
  assert.equal(V({ b: 1, a: 2 }, { const: { a: 2, b: 1 } }), null);
  assert.equal(V({ a: 2, b: 1 }, { const: { a: 1, b: 1 } }), "INSTANCE_VALIDATION_FAILED");
  // 3.1 formats are annotations: negative-format instances stay valid.
  assert.equal(V("not-a-uri", { type: "string", format: "uri" }), null);
  assert.equal(V("not-a-timestamp", { type: "string", format: "date-time" }), null);
  assert.equal(V("anything", { type: "string", format: "nope" }), null);
  // Credential-bearing instances fail the privacy scan with bounded codes.
  assert.equal(V("https://u:p@example.com", { type: "string", format: "uri" }), "USERINFO_CREDENTIALS");
  // Policy rejections stay fail-closed.
  assert.equal(V("x", { $ref: "https://evil.example/schema.json" }), "POLICY_KEYWORD_REJECTED");
  assert.equal(V("x", { $ref: "./sibling.json" }), "POLICY_KEYWORD_REJECTED");
  assert.equal(V("x", { $ref: "#anchor" }), "POLICY_KEYWORD_REJECTED");
  assert.equal(V("x", { $id: "https://evil.example/x" }), "POLICY_KEYWORD_REJECTED");
  assert.equal(V("x", { $dynamicRef: "#foo" }), "POLICY_KEYWORD_REJECTED");
  await prepareSchemaAuthority({ contentSchema: { type: "object" } });
  assert.equal(V("x", { contentSchema: { type: "object" } }), null); // unknown keywords are annotations under the 3.1 engine

  // A-class: ten hostile 3.1 keyword shapes x get-query/post-json x
  // projection/terminal. The projection variant aborts the transaction at
  // meta-validation; the terminal variant reports the recorded rejection.
  const A_SHAPES = {
    "properties-array": { properties: [] },
    "prefixItems-object": { prefixItems: {} },
    "additionalProperties-number": { additionalProperties: 1 },
    "defs-array": { $defs: [] },
    "minLength-string": { type: "string", minLength: "1" },
    "required-string": { type: "string", required: "req" },
    "enum-string": { enum: "base" },
    "dependentRequired-array": { dependentRequired: [] },
    "multipleOf-string": { type: "number", multipleOf: "2" },
    "minItems-negative": { type: "array", minItems: -1 },
  };
  for (const [shape, schema] of Object.entries(A_SHAPES)) {
    for (const method of ["get-query", "post-json"]) {
      const projection = await buildWithFixture({
        method: method === "get-query" ? "get" : "post",
        schema,
        example: method === "get-query" ? "https://example.com" : { url: "https://example.com" },
      });
      probe(`R5.A.${shape}.${method}.projection`, projection.primaryCode);
      const terminal = validateExampleAgainstSchema(
        method === "get-query" ? "https://example.com" : { url: "https://example.com" },
        schema,
        "$",
      );
      probe(`R5.A.${shape}.${method}.terminal`, firstCode(terminal));
    }
  }

  // B-class: six hostile 3.0 keyword shapes.
  const B_SHAPES = {
    "properties-array": { properties: [] },
    "required-string": { required: "r" },
    "nullable-string": { nullable: "true" },
    "items-array": { items: [{ type: "string" }] },
    "prefixItems-array": { prefixItems: [{ type: "string" }] },
    "type-array": { type: ["string"] },
  };
  for (const [shape, schema] of Object.entries(B_SHAPES)) {
    for (const method of ["get-query", "post-json"]) {
      const projection = await buildWithFixture({
        method: method === "get-query" ? "get" : "post",
        schema,
        openapi: "3.0.3",
        example: method === "get-query" ? "https://example.com" : { url: "https://example.com" },
      });
      probe(`R5.B.${shape}.${method}.projection`, projection.primaryCode);
      const terminal = validateExampleAgainstSchema(
        method === "get-query" ? "https://example.com" : { url: "https://example.com" },
        schema,
        "$",
        { documentOpenApiVersion: "3.0.3" },
      );
      probe(`R5.B.${shape}.${method}.terminal`, firstCode(terminal));
    }
  }

  // C-class cross-dialect confusion.
  await warmAuthority([[{ type: "string", nullable: true }, "x"]]);
  for (const stage of ["projection", "terminal"]) {
    const nested = validateExampleAgainstSchema("x", { $schema: DIALECT_IDENTITIES.OAS31_BASE, type: "string" }, "$", { documentOpenApiVersion: "3.0.3" });
    probe(`R5.C.oas30-nested-oas31-schema.${stage}`, firstCode(nested));
    const nullable = validateExampleAgainstSchema(null, { type: "string", nullable: true }, "$");
    probe(`R5.C.oas31-nullable-semantics.${stage}`, firstCode(nullable));
    const dialect = validateExampleAgainstSchema("x", { type: "string" }, "$", { documentOpenApiVersion: "3.1.0", documentJsonSchemaDialect: "https://example.com/custom-dialect" });
    probe(`R5.C.unsupported-jsonSchemaDialect.${stage}`, firstCode(dialect));
  }

  // M-class dialect policy.
  assert.equal(V("x", { $schema: "http://json-schema.org/draft-07/schema#", type: "string" }), "DIALECT_REJECTED");
  assert.equal(V("x", { $schema: "https://json-schema.org/draft/2019-09/schema", type: "string" }), "DIALECT_REJECTED");
  assert.equal(V("x", { $schema: "https://example.com/custom", type: "string" }), "DIALECT_REJECTED");
  assert.equal(V("x", { type: "string" }, { documentOpenApiVersion: "3.2.0" }), "UNSUPPORTED_OAS_VERSION");
  assert.equal(V("x", { type: "string" }, { documentOpenApiVersion: "2.0" }), "UNSUPPORTED_OAS_VERSION");
  assert.equal(V("x", { type: "string" }, { documentOpenApiVersion: "garbage" }), "UNSUPPORTED_OAS_VERSION");
  assert.equal(V("x", { type: "string" }, { documentOpenApiVersion: "3.0.3", documentJsonSchemaDialect: "https://example.com/x" }), "DIALECT_REJECTED");
  probe("R5.M.oas30-nested-schema", firstCode(validateExampleAgainstSchema("x", { $schema: DIALECT_IDENTITIES.DRAFT_2020_12, type: "string" }, "$", { documentOpenApiVersion: "3.0.3" })));
  probe("R5.M.oas31-draft07", V("x", { $schema: "http://json-schema.org/draft-07/schema#", type: "string" }));
  probe("R5.M.oas31-draft2019", V("x", { $schema: "https://json-schema.org/draft/2019-09/schema", type: "string" }));
  probe("R5.M.oas31-custom", V("x", { $schema: "https://example.com/custom", type: "string" }));
  probe("R5.M.malformed-openapi-version", V("x", { type: "string" }, { documentOpenApiVersion: "3.x" }));
  probe("R5.M.unsupported-jsonSchemaDialect", V("x", { type: "string" }, { documentOpenApiVersion: "3.1.0", documentJsonSchemaDialect: "https://example.com/d" }));
  probe("R5.M.ref-key-inside-const-enum", V("x", { type: "object", const: { a: { $ref: "https://evil.example/x" } } }));

  // N-class format matrix. OAS 3.0 known formats assert; OAS 3.1 formats are
  // annotations; unknown formats never assert.
  await warmAuthority([
    [{ type: "string", format: "ipv4" }, "192.168.1.1"],
    [{ type: "string", format: "uri" }, "https://example.com"],
    [{ type: "string", format: "date-time" }, "2024-01-15T10:30:00Z"],
    [{ type: "string", format: "nope" }, "anything"],
  ], { openapi: "3.0.3" });
  await warmAuthority([
    [{ type: "string", format: "ipv4" }, "192.168.1.1"],
    [{ type: "string", format: "uri" }, "https://example.com"],
    [{ type: "string", format: "date-time" }, "2024-01-15T10:30:00Z"],
    [{ type: "string", format: "nope" }, "anything"],
  ]);
  const formatMatrix = [
    ["ipv4", "192.168.1.1", "999.1.1.1"],
    ["uri", "https://example.com", "not-a-uri"],
    ["date-time", "2024-01-15T10:30:00Z", "not-a-timestamp"],
  ];
  for (const [format, positive, negative] of formatMatrix) {
    const schema = { type: "string", format };
    probe(`R5.N.oas30.${format}.positive`, V(positive, schema, { documentOpenApiVersion: "3.0.3" }));
    probe(`R5.N.oas30.${format}.negative`, V(negative, schema, { documentOpenApiVersion: "3.0.3" }));
    probe(`R5.N.oas31.${format}.positive`, V(positive, schema));
    probe(`R5.N.oas31.${format}.negative`, V(negative, schema));
  }
  probe("R5.N.oas30.unknown-format", V("anything", { type: "string", format: "nope" }, { documentOpenApiVersion: "3.0.3" }));
  probe("R5.N.oas31.unknown-format", V("anything", { type: "string", format: "nope" }));

  // ---------------------------------------------------------------------------
  // Amendment 9 section 5.1 prepared-path percent fixtures + amendment 10
  // section 4 third envelope. All run after a fresh prepared string authority.
  // ---------------------------------------------------------------------------
  await resetParityAuthorityForTests();
  await prepareSchemaAuthority({ type: "string" });
  const PS = (value) => firstCode(validateExampleAgainstSchema(value, { type: "string" }, "$"));

  // A9.S percent-envelope rows: controlled value-free findings, exact frozen
  // messages, no TypeError/RangeError/URIError.
  for (const [id, input] of [
    ["A9.S.prepared-percent-80", "%80"],
    ["A9.S.prepared-percent-c0af", "%C0%AF"],
    ["A9.S.prepared-percent-ff", "%FF"],
  ]) {
    const findings = validateExampleAgainstSchema(input, { type: "string" }, "$");
    assert.equal(Array.isArray(findings), true);
    // Exactly one value-free finding for the whole prepared result (A9 §5 total
    // stringSafety rule; duplicate findings are TEST_MANIFEST_DRIFT-adjacent).
    assert.equal(findings.length, 1);
    assert.deepEqual(findings, [{ code: "MALFORMED_PERCENT", message: "$: malformed percent envelope" }]);
    noEcho(findings);
    recordLabeled(id, findings[0].code);
  }
  // Lowercase and mixed-case complete envelopes behave identically (A9 §5.1).
  assert.equal(PS("%c0%af"), "MALFORMED_PERCENT");
  assert.equal(PS("%C0%af"), "MALFORMED_PERCENT");

  // A10.S prepared-third-envelope: P3 is the exact literal output of three
  // successive percentEncode1 applications to "%"; the preserved two-stage
  // plain decoder reports the controlled PERCENT_DECODE_LIMIT with the exact
  // value-free message, no later stage inspection, and no thrown error type.
  const p3 = assertP3Fixture();
  assert.equal(decodePlainStages("%252525").outcome, "clean"); // misleading literal stays clean
  const p3Findings = validateExampleAgainstSchema(p3, { type: "string" }, "$");
  assert.equal(Array.isArray(p3Findings), true);
  // Non-vacuous: the complete result is exactly one value-free finding — the
  // duplicate-finding regression (unsafeExampleFindings plus stringSafety both
  // reporting the same controlled decoder failure) must stay impossible.
  assert.equal(p3Findings.length, 1);
  assert.deepEqual(p3Findings, [{ code: "PERCENT_DECODE_LIMIT", message: "$: percent decode limit" }]);
  recordLabeled("A10.S.prepared-third-envelope", p3Findings[0].code);
  // Native-error totality: the actual production call must return a controlled
  // findings array rather than throwing a TypeError/RangeError/URIError for
  // every complete malformed or over-limit envelope.
  for (const hostileValue of [p3, "%80", "%C0%AF", "%FF"]) {
    let produced;
    try {
      produced = validateExampleAgainstSchema(hostileValue, { type: "string" }, "$");
      assert.equal(Array.isArray(produced), true);
      assert.equal(produced.length, 1);
    } catch (error) {
      assert.fail(`native error escaped prepared path for ${JSON.stringify(hostileValue)}: ${error?.name}: ${error?.message}`);
    }
    noEcho(produced);
  }

  // The misleading "%252525" literal is an explicit clean negative on the
  // prepared path: no decode-limit special case, first code null.
  assert.equal(PS("%252525"), null);

  // A9.S clean-literal rows.
  assert.equal(PS("%8"), null);
  recordLabeled("A9.S.prepared-truncated", PS("%8"));
  assert.equal(PS("%"), null);
  recordLabeled("A9.S.prepared-lone-percent", PS("%"));
  assert.equal(PS("%41%ZZ"), null);
  recordLabeled("A9.S.prepared-mixed-envelope", PS("%41%ZZ"));
  assert.equal(PS("hello"), null);
  recordLabeled("A9.S.prepared-ordinary", PS("hello"));

  // A9.S hostile object/proxy on the prepared path.
  const hostileObjectFindings = validateExampleAgainstSchema({ x: 1 }, { type: "string" }, "$");
  assert.equal(hostileObjectFindings[0].code, "INSTANCE_VALIDATION_FAILED");
  recordLabeled("A9.S.hostile-object", hostileObjectFindings[0].code);
  const hostileProxy = new Proxy({}, {});
  const hostileProxyFindings = validateExampleAgainstSchema(hostileProxy, { type: "string" }, "$");
  assert.equal(hostileProxyFindings[0].code, "PROXY_REJECTED");
  recordLabeled("A9.S.hostile-proxy", hostileProxyFindings[0].code);

  // A9.S URL-component percent-80 on the prepared path.
  const url80Findings = validateExampleAgainstSchema("https://example.com/%80", { type: "string", format: "uri" }, "$");
  assert.equal(url80Findings[0].code, "MALFORMED_PERCENT");
  noEcho(url80Findings);
  recordLabeled("A9.S.url-component-percent-80", url80Findings[0].code);

  // A9.F local-reference policy inside this same host node.
  await assert.rejects(() => prepareSchemaAuthority({ $ref: "#" }), (error) => error instanceof Error && error.code === "POLICY_KEYWORD_REJECTED");
  const documentRootFindings = validateExampleAgainstSchema("x", { $ref: "#" }, "$");
  assert.equal(documentRootFindings[0].code, "POLICY_KEYWORD_REJECTED");
  recordLabeled("A9.F.ref-document-root", documentRootFindings[0].code);
  await resetParityAuthorityForTests();
  await prepareSchemaAuthority({
    $defs: { node: { type: "object", properties: { child: { $ref: "#/$defs/node" } }, additionalProperties: false } },
    $ref: "#/$defs/node",
  });
  assert.deepEqual(validateExampleAgainstSchema({ child: { child: {} } }, {
    $defs: { node: { type: "object", properties: { child: { $ref: "#/$defs/node" } }, additionalProperties: false } },
    $ref: "#/$defs/node",
  }, "$"), []);
  recordLabeled("A9.F.ref-recursive-defs", null);
  await resetParityAuthorityForTests();
  const mutualSchema = {
    $defs: {
      a: { type: "object", properties: { b: { $ref: "#/$defs/b" } }, additionalProperties: false },
      b: { type: "object", properties: { a: { $ref: "#/$defs/a" } }, additionalProperties: false },
    },
    $ref: "#/$defs/a",
  };
  await prepareSchemaAuthority(mutualSchema);
  assert.deepEqual(validateExampleAgainstSchema({ b: { a: {} } }, mutualSchema, "$"), []);
  recordLabeled("A9.F.ref-mutual-cycle", null);
  await resetParityAuthorityForTests();
});

test("required GET missing and boolean-false request schemas fail closed before listen", () => {
  assert.ok(validateExampleAgainstSchema("x", false).some((error) => error.message.includes("boolean schema false")));
  assert.equal(firstCode(validateExampleAgainstSchema("x", false)), "INSTANCE_VALIDATION_FAILED");
  assert.ok(validateExampleAgainstSchema("x", undefined).some((error) => error.code === "MISSING_SCHEMA"));
  assert.ok(validateExampleAgainstSchema("x", null).some((error) => error.code === "MISSING_SCHEMA"));
  assert.ok(validateExampleAgainstSchema("x", []).some((error) => error.code === "INVALID_SCHEMA_TYPE"));
  assert.deepEqual(validateExampleAgainstSchema("x", true), []);
  assert.ok(validateExampleAgainstSchema("https://u:p@example.com", true).some((error) => error.code === "USERINFO_CREDENTIALS"));

  const falseDocument = { openapi: "3.1.0", paths: {
    "/q": paidGetOperation([{ name: "q", in: "query", required: true, schema: false, example: "x" }]),
  } };
  const missingDocument = { openapi: "3.1.0", paths: {
    "/q": paidGetOperation([{ name: "q", in: "query", required: true, example: "x" }]),
  } };
  assert.ok(collectOpenApiRequestExampleFindings({ document: falseDocument })
    .some((finding) => finding.code === "INSTANCE_VALIDATION_FAILED"));
  assert.ok(collectOpenApiRequestExampleFindings({ document: missingDocument })
    .some((finding) => finding.code === "MISSING_SCHEMA"));

  // E-class materialization hostility: every boundary is exercised through
  // the descriptor-first materializer and never executes a trap or accessor.
  const nesting = (depth) => {
    let value = { leaf: true };
    for (let i = 0; i < depth; i += 1) value = { child: value };
    return value;
  };
  const wideObject = (count) => Object.fromEntries(Array.from({ length: count }, (_, i) => [`k${i}`, i]));
  const codeOf = (fn) => { try { fn(); return null; } catch (error) { return error.code ?? "STARTUP_ABORTED"; } };

  probe("R5.E.depth-at", codeOf(() => materializeSafe(nesting(32), "example")));
  probe("R5.E.depth-over", codeOf(() => materializeSafe(nesting(33), "example")));
  const binaryTree = (depth) => (depth === 0 ? { leaf: true } : { a: binaryTree(depth - 1), b: binaryTree(depth - 1) });
  // A full binary tree of depth 11 has 2^12 - 1 = 4095 containers; the root
  // wrapper adds exactly one more (4096), and one more node exceeds it.
  probe("R5.E.nodes-at", codeOf(() => materializeSafe({ tree: binaryTree(11) }, "example")));
  probe("R5.E.nodes-over", codeOf(() => materializeSafe({ tree: binaryTree(11), extra: { over: true } }, "example")));
  probe("R5.E.keys-at", codeOf(() => materializeSafe(wideObject(2048), "example")));
  probe("R5.E.keys-over", codeOf(() => materializeSafe(wideObject(2049), "example")));
  probe("R5.E.string-at", codeOf(() => materializeSafe({ s: "a".repeat(65536) }, "example")));
  probe("R5.E.string-over", codeOf(() => materializeSafe({ s: "a".repeat(65537) }, "example")));
  probe("R5.E.sparse-hole", codeOf(() => { const a = [1, 2, 3]; delete a[1]; materializeSafe(a); }));
  probe("R5.E.array-noncanonical-index", codeOf(() => { const a = [1]; Object.defineProperty(a, "01", { value: 1, enumerable: true, writable: true, configurable: true }); materializeSafe(a); }));
  probe("R5.E.array-extra-string-key", codeOf(() => { const a = [1]; a.extra = "x"; materializeSafe(a); }));
  probe("R5.E.symbol-key", codeOf(() => materializeSafe({ [Symbol("s")]: 1 })));
  probe("R5.E.nonenumerable-data", codeOf(() => { const o = {}; Object.defineProperty(o, "x", { value: 1, enumerable: false, writable: true, configurable: true }); materializeSafe(o); }));
  probe("R5.E.direct-cycle", codeOf(() => { const o = {}; o.self = o; materializeSafe(o); }));
  probe("R5.E.mutual-cycle", codeOf(() => { const a = {}; const b = {}; a.b = b; b.a = a; materializeSafe(a); }));
  probe("R5.E.repeated-alias", codeOf(() => { const shared = { x: 1 }; materializeSafe({ a: shared, b: shared }); }));
  const trapCounters = () => {
    const counts = { ownKeys: 0, getOwnPropertyDescriptor: 0, get: 0, getPrototypeOf: 0 };
    const target = {};
    const proxy = new Proxy(target, {
      ownKeys: (t) => { counts.ownKeys += 1; return Reflect.ownKeys(t); },
      getOwnPropertyDescriptor: (t, p) => { counts.getOwnPropertyDescriptor += 1; return Reflect.getOwnPropertyDescriptor(t, p); },
      get: (t, p) => { counts.get += 1; return Reflect.get(t, p); },
      getPrototypeOf: (t) => { counts.getPrototypeOf += 1; return Reflect.getPrototypeOf(t); },
    });
    return { counts, proxy };
  };
  const ordinary = trapCounters();
  probe("R5.E.ordinary-proxy", (() => { const code = codeOf(() => materializeSafe(ordinary.proxy)); return Object.values(ordinary.counts).every((v) => v === 0) ? code : "PROXY_TRAP_EXECUTED"; })());
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  probe("R5.E.revoked-proxy", codeOf(() => materializeSafe(revoked.proxy)));
  const accessorRuns = { getter: 0, setter: 0 };
  const accessorObject = {};
  Object.defineProperty(accessorObject, "x", { enumerable: true, configurable: true, get() { accessorRuns.getter += 1; return 1; }, set(v) { accessorRuns.setter += 1; } });
  const accessorCode = codeOf(() => materializeSafe(accessorObject));
  probe("R5.E.getter-uncalled", accessorRuns.getter === 0 && accessorRuns.setter === 0 ? accessorCode : "ACCESSOR_EXECUTED");
  const setterObject = {};
  Object.defineProperty(setterObject, "x", { enumerable: true, configurable: true, set(v) { accessorRuns.setter += 1; } });
  const setterCode = codeOf(() => materializeSafe(setterObject));
  probe("R5.E.setter-uncalled", accessorRuns.getter === 0 && accessorRuns.setter === 0 ? setterCode : "ACCESSOR_EXECUTED");
  const gopdTrap = trapCounters();
  probe("R5.E.trap-ownKeys-zero", (() => { const code = codeOf(() => materializeSafe(gopdTrap.proxy)); return Object.values(gopdTrap.counts).every((v) => v === 0) ? code : "PROXY_TRAP_EXECUTED"; })());
  const getTrap = trapCounters();
  probe("R5.E.trap-get-zero", (() => { const code = codeOf(() => materializeSafe(getTrap.proxy)); return Object.values(getTrap.counts).every((v) => v === 0) ? code : "PROXY_TRAP_EXECUTED"; })());
  const gopdTrap2 = trapCounters();
  probe("R5.E.trap-getOwnPropertyDescriptor-zero", (() => { const code = codeOf(() => materializeSafe(gopdTrap2.proxy)); return Object.values(gopdTrap2.counts).every((v) => v === 0) ? code : "PROXY_TRAP_EXECUTED"; })());
  const protoTrap = trapCounters();
  probe("R5.E.trap-getPrototypeOf-zero", (() => { const code = codeOf(() => materializeSafe(protoTrap.proxy)); return Object.values(protoTrap.counts).every((v) => v === 0) ? code : "PROXY_TRAP_EXECUTED"; })());
  probe("R5.E.custom-prototype", codeOf(() => materializeSafe(Object.create({ custom: true }))));
  probe("R5.E.own-toJSON", codeOf(() => { const o = { a: 1 }; o.toJSON = () => "x"; materializeSafe(o); }));
  probe("R5.E.own-valueOf", codeOf(() => { const o = { a: 1 }; o.valueOf = () => 1; materializeSafe(o); }));
  probe("R5.E.own-toString", codeOf(() => { const o = { a: 1 }; o.toString = () => "x"; materializeSafe(o); }));
  probe("R5.E.own-symbolToPrimitive", codeOf(() => { const o = { a: 1 }; Object.defineProperty(o, Symbol.toPrimitive, { value: () => 1, enumerable: true, writable: true, configurable: true }); materializeSafe(o); }));
  const mutatee = { stable: 1, child: { deeper: 2 } };
  probe("R5.E.mutation-during-walk", codeOf(() => materializeSafe(mutatee, "example", { afterDescriptorsCaptured: (node) => { if (node === mutatee) node.injected = "drift"; } })));
  probe("R5.E.nan-rejected", codeOf(() => materializeSafe({ n: NaN })));
  probe("R5.E.infinity-rejected", codeOf(() => materializeSafe({ n: Infinity })));

  // D-class unreachable hostile payloads: the sentinel sits inside trap and
  // accessor payloads that no decoder or exception formatter may observe.
  for (const depth of ["raw", "percent1", "percent2"]) {
    const encode = depth === "raw" ? (s) => s : depth === "percent1" ? percentEncode1 : percentEncode2;
    const payload = encode(VALUE_SENTINEL);
    let proxyRuns = 0;
    const hostile = new Proxy({}, { get() { proxyRuns += 1; throw new Error(payload); } });
    const proxyCode = codeOf(() => materializeSafe(hostile));
    assert.equal(proxyRuns, 0, `proxy-error/${depth} observed the payload`);
    probe(`R5.D.proxy-error.${depth}`, proxyCode);
    let getterRuns = 0;
    const accessorHostile = {};
    Object.defineProperty(accessorHostile, "x", { enumerable: true, configurable: true, get() { getterRuns += 1; throw new Error(payload); } });
    const accessorCode2 = codeOf(() => materializeSafe(accessorHostile));
    assert.equal(getterRuns, 0, `accessor-error/${depth} observed the payload`);
    probe(`R5.D.accessor-error.${depth}`, accessorCode2);
  }
});

test("2020-12 tuple projection fails closed on obsolete additionalItems and honors unevaluatedItems", async () => {
  await prepareSchemaAuthority({ type: "array", prefixItems: [{ type: "number" }], unevaluatedItems: false });
  const obsolete = { type: "array", prefixItems: [{ type: "number" }], additionalItems: false };
  const findings = validateExampleAgainstSchema([1, "escape"], obsolete);
  assert.ok(findings.some((error) => error.code === "POLICY_KEYWORD_REJECTED"), JSON.stringify(findings));
  assert.ok(
    validateExampleAgainstSchema([1, "escape"], {
      type: "array",
      prefixItems: [{ type: "number" }],
      unevaluatedItems: false,
    }).some((error) => error.code === "INSTANCE_VALIDATION_FAILED"),
  );
  assert.deepEqual(
    validateExampleAgainstSchema([1], {
      type: "array",
      prefixItems: [{ type: "number" }],
      unevaluatedItems: false,
    }),
    [],
  );
});

function paidGetOperation(parameters) {
  return {
    get: {
      "x-payment-info": {},
      parameters,
      responses: { "200": { content: { "application/json": { schema: { type: "object" } } } } },
    },
  };
}

const EXTRACT_CONTRACT = Object.freeze({
  example: { type: "http", method: "GET", queryParams: { url: "https://example.com" } },
  schema: { type: "object", properties: { queryParams: { required: ["url"] } } },
});

function contractFor(routeKey) {
  if (
    routeKey === "GET /equal"
    || routeKey === "GET /drifted"
    || routeKey === "GET /missing"
    || routeKey === "GET /commerce/payment-offer-preflight"
  ) return structuredClone(EXTRACT_CONTRACT);
  return null;
}

test("projects canonical examples with authority over authored ones", async () => {
  await warmAuthority([[{ type: "string" }, "https://example.com"], [{ type: "string", example: "https://example.com" }, "https://example.com"]]);
  assert.equal(REQUEST_CONTRACT_ALIASES["GET /gateway/commerce/payment-offer-preflight"], "GET /commerce/payment-offer-preflight");
  const document = { openapi: "3.1.0", paths: {
    // Authored example canonically equal to the canonical value stays.
    "/equal": paidGetOperation([
      { name: "url", in: "query", required: true, schema: { type: "string", example: "https://example.com" } },
    ]),
    // Drifted authored example is deterministically overwritten.
    "/drifted": paidGetOperation([
      { name: "url", in: "query", required: true, schema: { type: "string", example: "https://stale.example" } },
    ]),
    // Missing example is applied.
    "/missing": paidGetOperation([{ name: "url", in: "query", required: true, schema: { type: "string" } }]),
    // The Circle gateway GET alias resolves through the explicit alias map.
    "/gateway/commerce/payment-offer-preflight": paidGetOperation([
      { name: "url", in: "query", required: true, schema: { type: "string" } },
    ]),
    "/free": paidGetOperation([{ name: "url", in: "query", required: true, schema: { type: "string" } }]),
  } };
  const receipt = applyDiscoveryRequestExamples(document, contractFor);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.queryExamples, 2);
  assert.equal(receipt.queryVerified, 1);
  assert.equal(receipt.queryOverwritten, 1);
  assert.equal(document.paths["/equal"].get.parameters[0].schema.example, "https://example.com");
  assert.equal(document.paths["/drifted"].get.parameters[0].schema.example, undefined);
  assert.equal(document.paths["/drifted"].get.parameters[0].example, "https://example.com");
  assert.equal(document.paths["/missing"].get.parameters[0].example, "https://example.com");
  const aliasParameter = document.paths["/gateway/commerce/payment-offer-preflight"].get.parameters[0];
  assert.equal(aliasParameter.example ?? aliasParameter.schema?.example, "https://example.com");
  // Idempotent re-run: everything verifies, nothing changes.
  const second = applyDiscoveryRequestExamples(document, contractFor);
  assert.equal(second.queryExamples, 0);
  assert.equal(second.queryOverwritten, 0);
  assert.equal(second.queryVerified, 4);

  // H-class cache/authority probes over the synthetic boot.
  const builder = () => {
    const doc = syntheticGetDocument({});
    applyDiscoveryRequestExamples(doc, (label) => (label === "GET /probe" ? syntheticQueryContract() : null));
    return doc;
  };
  const options = { buildDocument: builder, resolveRequestContract: () => null, expectedPaidRouteCounts: { agentcash: 1, mpp: 1 } };
  // canonical-key-order-equal: canonical digest ignores key order.
  probe("R5.H.canonical-key-order-equal", canonicalBytes({ a: 1, b: 2 }) === canonicalBytes({ b: 2, a: 1 }) ? null : "CANONICALIZATION_FAILED");
  // package-version-diff: a mismatched receipt aborts with VERSION_AUTHORITY_DRIFT.
  const drifted = await prepareOpenApiParityStartup({ ...options, dependencyVersionReceipts: { resolved: "1.17.7" } });
  probe("R5.H.package-version-diff", drifted.primaryCode);
  const verified = await prepareOpenApiParityStartup({ ...options, dependencyVersionReceipts: { manifest: "1.17.8", lock: "1.17.8", resolved: "1.17.8" } });
  assert.equal(verified.ok, true, "matching version receipts must boot");
  // boot-cache-hit-no-urn: a second equal boot compiles nothing new.
  const again = await prepareOpenApiParityStartup(options);
  probe("R5.H.boot-cache-hit-no-urn", again.ok && again.compiledNew === 0 ? null : "REGISTRY_NOT_EMPTY");
  assert.deepEqual(parityRegistrySnapshot(), []);
  probe("R5.H.synthetic-registry-empty", parityRegistrySnapshot().length === 0 ? null : "REGISTRY_NOT_EMPTY");
  // duplicate-registration-collision: pre-registering the exact synthetic URN
  // a miss compilation would use aborts with REGISTRY_IDENTITY_COLLISION.
  resetParityAuthorityForTests();
  const collisionSchema = { type: "string", maxLength: 4321 };
  const probeIdentity = await prepareSchemaAuthority(collisionSchema);
  const collisionDAuth = probeIdentity.dAuth;
  // The harness compile path derives its synthetic URN from the fixed nonce
  // `harness:<dAuth>`; pre-registering exactly that URN forces the collision.
  const expectedUrn = `urn:x402-parity:${collisionDAuth}:${createHash("sha256").update(`harness:${collisionDAuth}:${collisionDAuth}`).digest("hex")}`;
  const { registerSchema, unregisterSchema } = await import("@hyperjump/json-schema/openapi-3-1");
  registerSchema({ type: "string" }, expectedUrn, "https://spec.openapis.org/oas/3.1/dialect/base");
  resetParityAuthorityForTests();
  let collisionCode = null;
  try {
    await prepareSchemaAuthority(collisionSchema);
  } catch (error) {
    collisionCode = error.code ?? null;
  }
  unregisterSchema(expectedUrn);
  probe("R5.H.duplicate-registration-collision", collisionCode);
  const beforeCollision = await prepareOpenApiParityStartup(options);
  assert.equal(beforeCollision.ok, true);
  // schema-mutation-mismatch: a mutated schema fails closed instead of
  // validating under stale authority.
  const mutated = validateExampleAgainstSchema("https://example.com", { type: "string", minLength: 64 }, "$");
  probe("R5.H.schema-mutation-mismatch", firstCode(mutated));
  // cache-budget boundaries over a fresh cache: exactly 128 admitted, the
  // 129th distinct identity fails before registration.
  resetParityAuthorityForTests();
  const longExample = "a".repeat(200);
  const budgetEntries = Array.from({ length: CACHE_BUDGET }, (_, i) => [{ type: "string", minLength: i + 1 }, longExample]);
  const atBudget = await warmAuthority(budgetEntries);
  assert.equal(atBudget.ok, true, `cache-budget-128 warm failed: ${atBudget.stage} ${atBudget.primaryCode}`);
  probe("R5.H.cache-budget-128", atBudget.ok ? null : atBudget.primaryCode);
  const overflow = await warmAuthority([[{ type: "number", multipleOf: 3 }, 9]], { expectOk: false });
  probe("R5.H.cache-budget-129-reject", overflow.primaryCode);
  resetParityAuthorityForTests();
});

test("projection throws loudly on missing parameters and unsafe canonical values", async () => {
  await warmAuthority([[{ type: "number" }, 10], [{ type: "string" }, "https://example.com"]]);
  assert.throws(() => applyDiscoveryRequestExamples({
    paths: { "/preflight": { post: { "x-payment-info": {}, requestBody: { content: { "application/json": { schema: { type: "object" } } } } } } },
  }, () => ({ example: { method: "POST" }, schema: {} })), /lacks a JSON body example/);
  assert.throws(() => applyDiscoveryRequestExamples({
    paths: { "/extract": paidGetOperation([{ name: "rewardUsd", in: "query", required: true, schema: { type: "number" } }]) },
  }, () => (structuredClone(EXTRACT_CONTRACT))), /declares no query parameter for required discovery input url/);
  assert.throws(() => applyDiscoveryRequestExamples({
    paths: { "/extract": paidGetOperation([{ name: "url", in: "query", required: true, schema: { type: "string" } }]) },
  }, () => ({
    example: { queryParams: { url: "{template}" } },
    schema: { type: "object", properties: { queryParams: { required: ["url"] } } },
  })), /unresolved template/);
  assert.throws(() => applyDiscoveryRequestExamples({
    paths: { "/extract": paidGetOperation([{ name: "url", in: "query", required: true, schema: { type: "string" } }]) },
  }, () => ({
    example: { queryParams: { url: "https://u:p@example.com" } },
    schema: { type: "object", properties: { queryParams: { required: ["url"] } } },
  })), /credential-bearing URL/);
});

test("canonical POST body overwrites a drifted authored example", async () => {
  await warmAuthority([[{ type: "object", properties: { url: { type: "string" } }, required: ["url"] }, { url: "https://example.com" }]]);
  const contract = {
    example: { type: "http", method: "POST", bodyType: "json", body: { url: "https://example.com" } },
    schema: { type: "object" },
  };
  const document = { openapi: "3.1.0", paths: {
    "/preflight": { post: {
      "x-payment-info": {},
      requestBody: { content: { "application/json": {
        schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
        example: { url: "https://stale.example" },
      } } },
      responses: { "200": { content: { "application/json": { schema: { type: "object" } } } } },
    } },
  } };
  const receipt = applyDiscoveryRequestExamples(document, () => contract);
  assert.equal(receipt.bodyOverwritten, 1);
  assert.deepEqual(document.paths["/preflight"].post.requestBody.content["application/json"].example, { url: "https://example.com" });
});

const SOLANA_CONTRACT = Object.freeze({
  example: { type: "http", method: "GET", queryParams: { signature: SOLANA_SIGNATURE_EXAMPLE } },
  schema: {
    type: "object",
    properties: { queryParams: { required: ["signature"] } },
  },
});

test("enforces the scoped signature exception only on the canonical Solana receipt route", async () => {
  await warmAuthority([[{ type: "string", pattern: PUBLIC_SOLANA_SIGNATURE_QUERY.schemaPattern }, SOLANA_SIGNATURE_EXAMPLE]]);
  const canonicalSchema = { type: "string", pattern: PUBLIC_SOLANA_SIGNATURE_QUERY.schemaPattern };
  const document = { openapi: "3.1.0", paths: {
    "/chain/solana-transaction-receipt": paidGetOperation([
      { name: "signature", in: "query", required: true, schema: structuredClone(canonicalSchema) },
    ]),
  } };
  const receipt = applyDiscoveryRequestExamples(document, (routeKey) => (
    routeKey === "GET /chain/solana-transaction-receipt" ? structuredClone(SOLANA_CONTRACT) : null
  ));
  assert.equal(receipt.queryExamples, 1);
  assert.equal(document.paths["/chain/solana-transaction-receipt"].get.parameters[0].example, SOLANA_SIGNATURE_EXAMPLE);

  // Wrong schema under the exception is rejected.
  assert.throws(() => applyDiscoveryRequestExamples({ openapi: "3.1.0", paths: {
    "/chain/solana-transaction-receipt": paidGetOperation([
      { name: "signature", in: "query", required: true, schema: { type: "string", pattern: "^.*$" } },
    ]),
  } }, (routeKey) => (routeKey === "GET /chain/solana-transaction-receipt" ? structuredClone(SOLANA_CONTRACT) : null)), /canonical public Solana base58 schema/);

  // The same contract key anywhere else is rejected as credential-like.
  assert.throws(() => applyDiscoveryRequestExamples({ openapi: "3.1.0", paths: {
    "/elsewhere": paidGetOperation([
      { name: "signature", in: "query", required: true, schema: structuredClone(canonicalSchema) },
    ]),
  } }, (routeKey) => (routeKey === "GET /elsewhere" ? structuredClone(SOLANA_CONTRACT) : null)), /unsafe accepted example/);
});

test("parity gate audits every generated paid operation and the exact inventory", async () => {
  await warmAuthority([
    [{ type: "string" }, "https://example.com"],
    [{ type: "object", properties: { rewardUsd: { type: "number", exclusiveMinimum: 0 } }, required: ["rewardUsd"] }, { rewardUsd: 10 }],
    [{ type: "object", properties: { target: { type: "string" } }, required: ["target"] }, { target: "https://example.com" }],
  ]);
  const healthy = { openapi: "3.1.0", paths: {
    "/extract": paidGetOperation([{ name: "url", in: "query", required: true, schema: { type: "string" }, example: "https://example.com" }]),
    "/work/opportunity-preflight": { post: {
      "x-payment-info": {},
      operationId: "createOpportunity",
      requestBody: { content: { "application/json": {
        schema: { type: "object", properties: { rewardUsd: { type: "number", exclusiveMinimum: 0 } }, required: ["rewardUsd"] },
        example: { rewardUsd: 10 },
      } } },
      responses: { "200": { content: { "application/json": { schema: { type: "object" } } } } },
    } },
  } };

  // Full-surface enumeration needs no action list at all.
  assert.deepEqual(collectOpenApiRequestExampleFindings({ document: healthy }), []);

  const lostQuery = structuredClone(healthy);
  delete lostQuery.paths["/extract"].get.parameters[0].example;
  assert.ok(collectOpenApiRequestExampleFindings({ document: lostQuery })
    .some((finding) => finding.code === "INVENTORY_DRIFT" && finding.message.includes("lost its accepted request example")));

  const nonScalar = structuredClone(healthy);
  nonScalar.paths["/extract"].get.parameters[0].example = { url: "https://example.com" };
  assert.ok(collectOpenApiRequestExampleFindings({ document: nonScalar })
    .some((finding) => finding.code === "INVALID_SCHEMA_TYPE"));

  const templated = structuredClone(healthy);
  templated.paths["/extract"].get.parameters[0].example = "{your-url-here}";
  assert.ok(collectOpenApiRequestExampleFindings({ document: templated })
    .some((finding) => finding.code === "UNRESOLVED_TEMPLATE"));

  const credential = structuredClone(healthy);
  credential.paths["/extract"].get.parameters[0] = { name: "api_token", in: "query", required: true, schema: { type: "string" }, example: "Bearer zz" };
  const credentialFindings = collectOpenApiRequestExampleFindings({ document: credential });
  noEcho(credentialFindings);
  assert.ok(credentialFindings.some((finding) => finding.code === "CREDENTIAL_LIKE_KEY"));

  // A bare `signature` key outside the scoped exception is rejected.
  const signatureElsewhere = structuredClone(healthy);
  signatureElsewhere.paths["/extract"].get.parameters[0] = { name: "signature", in: "query", required: true, schema: { type: "string", pattern: "^[1-9A-HJ-NP-Za-km-z]{80,90}$" }, example: SOLANA_SIGNATURE_EXAMPLE };
  assert.ok(collectOpenApiRequestExampleFindings({ document: signatureElsewhere })
    .some((finding) => finding.code === "CREDENTIAL_LIKE_KEY"));

  const bodyMismatch = structuredClone(healthy);
  delete bodyMismatch.paths["/work/opportunity-preflight"].post.requestBody.content["application/json"].example.rewardUsd;
  assert.ok(collectOpenApiRequestExampleFindings({ document: bodyMismatch })
    .some((finding) => finding.code === "INSTANCE_VALIDATION_FAILED"));

  const bodyLost = structuredClone(healthy);
  delete bodyLost.paths["/work/opportunity-preflight"].post.requestBody.content["application/json"].example;
  assert.ok(collectOpenApiRequestExampleFindings({ document: bodyLost })
    .some((finding) => finding.code === "INVENTORY_DRIFT" && finding.message.includes("lost its accepted construction example")));

  const lostSuccessSchema = structuredClone(healthy);
  delete lostSuccessSchema.paths["/work/opportunity-preflight"].post.responses["200"].content;
  assert.ok(collectOpenApiRequestExampleFindings({ document: lostSuccessSchema })
    .some((finding) => finding.code === "INVENTORY_DRIFT" && finding.message.includes("formal 200 JSON response schema")));

  const credentialUrlBody = structuredClone(healthy);
  credentialUrlBody.paths["/work/opportunity-preflight"].post.requestBody.content["application/json"].example.target = "https://u:p@example.com";
  assert.ok(collectOpenApiRequestExampleFindings({ document: credentialUrlBody })
    .some((finding) => finding.code === "USERINFO_CREDENTIALS"));

  // Exact inventory reconciliation: missing, renamed, and extra routes drift.
  const expected = expectedPaidMethodRoutes({ profile: "mpp", circleGatewayEnabled: false });
  assert.equal(expected.length, EXPECTED_PAID_METHOD_ROUTE_COUNTS.mpp);
  assert.ok(collectOpenApiRequestExampleFindings({ document: healthy, expectedPaidMethodRoutes: expected })
    .some((finding) => finding.code === "INVENTORY_DRIFT" && finding.message.includes("paid inventory drift")));
  const catalog = [{ method: "GET", route: "/not-a-paid-route" }];
  assert.ok(collectOpenApiRequestExampleFindings({ document: healthy, actions: catalog })
    .some((finding) => finding.code === "INVENTORY_DRIFT" && finding.message.includes("canonical catalog action missing")));
});

test("startup generation gate fails closed on inventory drift and missing contracts", async () => {
  assert.throws(() => assertGeneratedOpenApiSurfaceGate(), /documents/);
  assert.throws(() => assertGeneratedOpenApiSurfaceGate({ documents: {} }), /resolveRequestContract/);
  assert.throws(() => assertGeneratedOpenApiSurfaceGate({
    documents: { agentcash: { paths: {} }, mpp: { paths: {} } },
  }), /resolveRequestContract/);
  assert.throws(() => assertGeneratedOpenApiSurfaceGate({
    documents: { agentcash: { paths: {} }, mpp: { paths: {} } },
    resolveRequestContract: () => null,
    circleGatewayEnabled: true,
  }), /generation gate failed/);
  assert.throws(() => assertGeneratedOpenApiSurfaceGate({
    documents: { agentcash: { paths: {} }, mpp: { paths: {} } },
    resolveRequestContract: () => structuredClone(EXTRACT_CONTRACT),
    circleGatewayEnabled: true,
  }), /missing canonical request contract|paid inventory drift/);
  assert.equal(EXPECTED_PAID_METHOD_ROUTE_COUNTS.agentcash, 25);
  assert.equal(EXPECTED_PAID_METHOD_ROUTE_COUNTS.mpp, 24);
  assert.equal(EXPECTED_ENABLED_SURFACE_COUNTS.agentcashCircleEnabled, 25);
  assert.equal(EXPECTED_ENABLED_SURFACE_COUNTS.agentcashCircleDisabled, 24);
  assert.equal(EXPECTED_ENABLED_SURFACE_COUNTS.mpp, 24);
  assert.equal(expectedPaidMethodRoutes({ profile: "agentcash", circleGatewayEnabled: true }).length, EXPECTED_ENABLED_SURFACE_COUNTS.agentcashCircleEnabled);
  assert.equal(expectedPaidMethodRoutes({ profile: "agentcash", circleGatewayEnabled: false }).length, EXPECTED_ENABLED_SURFACE_COUNTS.agentcashCircleDisabled);
  assert.equal(expectedPaidMethodRoutes({ profile: "mpp", circleGatewayEnabled: true }).length, EXPECTED_ENABLED_SURFACE_COUNTS.mpp);
  assert.equal(expectedPaidMethodRoutes({ profile: "mpp", circleGatewayEnabled: false }).length, EXPECTED_ENABLED_SURFACE_COUNTS.mpp);

  // G-class rollback injections: one hostile fault at every prepublish stage.
  const builder = () => {
    const document = syntheticGetDocument({});
    applyDiscoveryRequestExamples(document, (label) => (label === "GET /probe" ? syntheticQueryContract() : null));
    return document;
  };
  await warmAuthority([[{ type: "string" }, "https://example.com"]]);
  for (const member of HOSTILE_PROBE_CLASSES.G) {
    const receipt = await prepareOpenApiParityStartup({
      buildDocument: builder,
      resolveRequestContract: () => null,
      expectedPaidRouteCounts: { agentcash: 1, mpp: 1 },
      injectFailureAt: member,
    });
    assert.equal(receipt.ok, false, `injection at ${member} must abort`);
    assert.equal(receipt.rollback.processCacheUnchanged, true);
    assert.equal(receipt.rollback.sourceDigestsReproduced, true);
    assert.equal(receipt.rollback.parityRegistryEmpty, true);
    assert.equal(receipt.rollback.publishedPointerUnchanged, true);
    probe(`R5.G.${member}`, receipt.primaryCode);
  }

  // O-class seam controls: isolated children with exact empty environment,
  // pinned Node, all seams installed before any dynamic import, and the
  // packed-artifact module closure.
  const packed = await ensurePackedConsumer();
  const receipts = {};
  for (const seam of ["fetch", "http-request", "https-request", "dns-lookup", "net-connect", "fs-read", "credential-sentinel", "process-env"]) {
    receipts[seam] = await runHarnessChild(`sensitivity:${seam}`, packed.parityPath);
    assert.equal(receipts[seam].count, 1, `${seam} sensitivity count`);
    assert.equal(receipts[seam].blocked, true, `${seam} sensitivity must block the real operation`);
    assert.equal(receipts[seam].observed, "NOT_EXPOSED");
    probe(`R5.O.${seam}.sensitivity`, receipts[seam].count === 1 && receipts[seam].blocked ? null : "TRIPWIRE_NOT_SENSITIVE");
  }
  const packedReceipt = await runHarnessChild("target-packed", packed.parityPath);
  assert.equal(packedReceipt.node, "v22.23.2");
  assert.equal(packedReceipt.loaderEnv.sensitiveEnvCount, 0);
  assert.equal(packedReceipt.loaderEnv.total >= 1 && packedReceipt.loaderEnv.total <= 4096, true);
  assert.equal(packedReceipt.loaderEnv.onlyAdmittedTuples, true);
  assert.equal(Object.values(packedReceipt.seams).every((v) => v === 0), true);
  const relativeUrls = packedReceipt.moduleUrls
    .map((u) => (u.startsWith("file://") ? u.slice("file://".length).replace(packed.consumerNodeModules + "/", "node_modules/") : u))
    .sort();
  assert.equal(relativeUrls.length, PACKED_MODULE_URL_SET_COUNT);
  assert.equal(createHash("sha256").update(relativeUrls.join("\n")).digest("hex"), PACKED_MODULE_URL_SET_DIGEST);
  assert.equal(createHash("sha256").update(JSON.stringify(packedReceipt.exports)).digest("hex"), PACKED_EXPORT_SET_DIGEST);
  assert.equal(packedReceipt.parityOk, true);
  const seamKeyOf = { "fetch": "fetch", "http-request": "httpRequest", "https-request": "httpsRequest", "dns-lookup": "dnsLookup", "net-connect": "netConnect", "credential-sentinel": "credentialSentinel" };
  for (const seam of ["fetch", "http-request", "https-request", "dns-lookup", "net-connect", "credential-sentinel"]) {
    probe(`R5.O.${seam}.target-zero`, packedReceipt.seams[seamKeyOf[seam]] === 0 ? null : "ZERO_IO_TRIPWIRE");
  }
  probe("R5.O.process-env.target-zero", packedReceipt.loaderEnv.sensitiveEnvCount === 0 && packedReceipt.loaderEnv.total >= 1 && packedReceipt.loaderEnv.total <= 4096 ? null : "ZERO_IO_TRIPWIRE");
  const transactionReceipt = await runHarnessChild("target-transaction", packed.parityPath);
  const tx = transactionReceipt.transaction;
  assert.equal(tx.ok, true);
  assert.deepEqual(tx.okStages, [...STARTUP_STAGES]);
  assert.equal(tx.okCountersZero && tx.abortCountersZero, true);
  assert.equal(tx.okReadsUnchanged && tx.abortReadsUnchanged, true);
  assert.equal(tx.okUrlsUnchanged && tx.abortUrlsUnchanged, true);
  assert.equal(tx.envSensitiveTotal, 0);
  assert.equal(tx.abortRollback.processCacheUnchanged && tx.abortRollback.parityRegistryEmpty, true);
  probe("R5.O.fs-read.target-zero", tx.okCountersZero && tx.abortCountersZero ? null : "ZERO_IO_TRIPWIRE");
  // The hostile unregistered HTTPS $ref never reaches retrieval.
  probe("R5.F.hostile-ref-zero-fetch", tx.hostileRefCode);

  // ---------------------------------------------------------------------------
  // Amendment 9 sections 6-7 R-family probes + amendment 10 sections 5-7
  // corrective probes. Every probe compares live pre/post cache identity,
  // registry contents, and published semantics — not receipt flags alone.
  // ---------------------------------------------------------------------------
  const emptyCacheDigest = computeCacheManifestDigest([]);

  // A9.R.after-cache-bind: empty prior cache; the after-cache-bind injection
  // is not a G-class member; the bind loop really mutates, then rollback
  // restores the exact empty vector.
  await resetParityAuthorityForTests();
  {
    const beforeKeys = processCacheKeys();
    const beforeEntries = new Map(beforeKeys.map((k) => [k, processCacheEntry(k)]));
    const receipt = await prepareOpenApiParityStartup({
      buildDocument: builder,
      resolveRequestContract: () => null,
      expectedPaidRouteCounts: { agentcash: 1, mpp: 1 },
      injectFailureAt: "after-cache-bind",
    });
    assert.equal(receipt.ok, false);
    assert.equal(receipt.aborted, true);
    assert.equal(receipt.primaryCode, "CACHE_TRANSACTION_ABORTED");
    assert.deepEqual(beforeKeys, processCacheKeys());
    for (const [k, v] of beforeEntries) assert.equal(processCacheEntry(k), v);
    assert.equal(cacheManifestSnapshot(), emptyCacheDigest);
    assert.equal(receipt.rollback.processCacheUnchanged, true);
    assert.equal(receipt.rollback.stagedDiscarded, 0);
    assert.equal(receipt.rollback.publishedPointerUnchanged, true);
    recordLabeled("A9.R.after-cache-bind", receipt.primaryCode);
  }

  // A9.R.after-cache-bind-seeded + A9.R.cache-identity: a prior binding keeps
  // its exact object identity through a hostile post-bind abort.
  await resetParityAuthorityForTests();
  {
    await prepareSchemaAuthority({ type: "string" });
    const seededDAuth = processCacheKeys()[0];
    const seededEntry = processCacheEntry(seededDAuth);
    assert.ok(seededEntry);
    const hostileSchema = { type: "object", properties: { url: { type: "string" } }, required: ["url"] };
    const hostileExample = { url: "https://example.com" };
    await warmAuthority([[hostileSchema, hostileExample]]);
    const secondDAuth = processCacheKeys().find((k) => k !== seededDAuth);
    assert.ok(secondDAuth);
    const receipt = await prepareOpenApiParityStartup({
      buildDocument: builder,
      resolveRequestContract: () => null,
      expectedPaidRouteCounts: { agentcash: 1, mpp: 1 },
      injectFailureAt: "after-cache-bind",
    });
    assert.equal(receipt.ok, false);
    assert.equal(receipt.primaryCode, "CACHE_TRANSACTION_ABORTED");
    assert.equal(processCacheEntry(seededDAuth), seededEntry);
    assert.equal(typeof processCacheEntry(secondDAuth), "function" === typeof processCacheEntry(secondDAuth) ? "object" : typeof processCacheEntry(secondDAuth));
    assert.equal(cacheManifestSnapshot(), computeCacheManifestDigest([
      `${seededDAuth}\0${processCacheEntry(seededDAuth).exactDialect}\0${PARITY_RUNTIME_VERSION}`,
      `${secondDAuth}\0${processCacheEntry(secondDAuth).exactDialect}\0${PARITY_RUNTIME_VERSION}`,
    ]));
    recordLabeled("A9.R.after-cache-bind-seeded", receipt.primaryCode);
    recordLabeled("A9.R.cache-identity", null);
  }

  // A9.R.boot-entry-nonempty + A9.R.unrelated-prefix-preserved.
  await resetParityAuthorityForTests();
  {
    const { registerSchema } = await import("@hyperjump/json-schema/openapi-3-1");
    registerSchema({ type: "string" }, "urn:x402-parity:preexisting", "https://spec.openapis.org/oas/3.1/dialect/base");
    registerSchema({ type: "string" }, "urn:other:keep-me", "https://spec.openapis.org/oas/3.1/dialect/base");
    const beforeKeys = processCacheKeys();
    const receipt = await prepareOpenApiParityStartup({
      buildDocument: builder,
      resolveRequestContract: () => null,
      expectedPaidRouteCounts: { agentcash: 1, mpp: 1 },
    });
    assert.equal(receipt.ok, false);
    assert.equal(receipt.stage, null);
    assert.equal(receipt.primaryCode, "REGISTRY_NOT_EMPTY");
    assert.deepEqual(parityRegistrySnapshot(), ["urn:x402-parity:preexisting"]);
    assert.equal(allRegisteredSchemaUris().includes("urn:other:keep-me"), true);
    assert.equal(allRegisteredSchemaUris().includes("https://spec.openapis.org/oas/3.0/schema"), true);
    assert.equal(receipt.rollback.parityRegistryEmpty, false);
    assert.deepEqual(processCacheKeys(), beforeKeys);
    recordLabeled("A9.R.boot-entry-nonempty", receipt.primaryCode);
    recordLabeled("A9.R.unrelated-prefix-preserved", null);
    const { unregisterSchema } = await import("@hyperjump/json-schema/openapi-3-1");
    unregisterSchema("urn:x402-parity:preexisting");
    unregisterSchema("urn:other:keep-me");
  }

  // A9.R.late-registry-projection: the builder registers an owned parity URI
  // on its third call — the PROJECTION re-projection inside the transaction —
  // so the URI exists after CACHE_BIND; the abort unregisters it and restores
  // the cache.
  await resetParityAuthorityForTests();
  {
    await prepareSchemaAuthority({ type: "string" });
    const { registerSchema } = await import("@hyperjump/json-schema/openapi-3-1");
    let builderCalls = 0;
    const lateRegisteringBuilder = () => {
      const document = syntheticGetDocument({});
      applyDiscoveryRequestExamples(document, (label) => (label === "GET /probe" ? syntheticQueryContract() : null));
      builderCalls += 1;
      if (builderCalls === 3) {
        registerSchema({ type: "string" }, "urn:x402-parity:hostile-late-registry", "https://spec.openapis.org/oas/3.1/dialect/base");
      }
      return document;
    };
    const receipt = await prepareOpenApiParityStartup({
      buildDocument: lateRegisteringBuilder,
      resolveRequestContract: () => null,
      expectedPaidRouteCounts: { agentcash: 1, mpp: 1 },
    });
    assert.equal(receipt.ok, false);
    assert.equal(receipt.primaryCode, "REGISTRY_NOT_EMPTY");
    assert.equal(receipt.stage, "CACHE_BIND");
    assert.equal(parityRegistrySnapshot().includes("urn:x402-parity:hostile-late-registry"), false);
    assert.equal(receipt.rollback.parityRegistryEmpty, true);
    assert.equal(receipt.rollback.processCacheUnchanged, true);
    recordLabeled("A9.R.late-registry-projection", receipt.primaryCode);
  }

  // A9.R.unregister-fault-honest: late-registry inject plus
  // injectRollbackFault "unregister"; the first owned unregister throws once,
  // the loop continues is irrelevant here (single URI), the receipt is
  // returned, and the live registry still contains the hostile URI.
  await resetParityAuthorityForTests();
  {
    await prepareSchemaAuthority({ type: "string" });
    const { registerSchema } = await import("@hyperjump/json-schema/openapi-3-1");
    let unregisterBuilderCalls = 0;
    const unregisterLateBuilder = () => {
      const document = syntheticGetDocument({});
      applyDiscoveryRequestExamples(document, (label) => (label === "GET /probe" ? syntheticQueryContract() : null));
      unregisterBuilderCalls += 1;
      if (unregisterBuilderCalls === 3) {
        registerSchema({ type: "string" }, "urn:x402-parity:hostile-unregister-fault", "https://spec.openapis.org/oas/3.1/dialect/base");
      }
      return document;
    };
    const receipt = await prepareOpenApiParityStartup({
      buildDocument: unregisterLateBuilder,
      resolveRequestContract: () => null,
      expectedPaidRouteCounts: { agentcash: 1, mpp: 1 },
      injectRollbackFault: "unregister",
    });
    assert.equal(receipt.ok, false);
    assert.equal(receipt.aborted, true);
    assert.equal(receipt.primaryCode, "REGISTRY_NOT_EMPTY");
    assert.equal(parityRegistrySnapshot().includes("urn:x402-parity:hostile-unregister-fault"), true);
    assert.equal(receipt.rollback.parityRegistryEmpty, false);
    recordLabeled("A9.R.unregister-fault-honest", receipt.primaryCode);
    const { unregisterSchema } = await import("@hyperjump/json-schema/openapi-3-1");
    unregisterSchema("urn:x402-parity:hostile-unregister-fault");
    assert.deepEqual(parityRegistrySnapshot(), []);
  }

  // A10.R.published-semantic-receipt (amendment 10 section 7): internal
  // pointer flag plus independently observable deep-equal semantic receipts.
  await resetParityAuthorityForTests();
  {
    const okBoot = await prepareOpenApiParityStartup({
      buildDocument: builder,
      resolveRequestContract: () => null,
      expectedPaidRouteCounts: { agentcash: 1, mpp: 1 },
    });
    assert.equal(okBoot.ok, true);
    const preReceipt = structuredClone(publishedStartupReceipt());
    assert.notEqual(preReceipt, null);
    const hostileReceipt = await prepareOpenApiParityStartup({
      buildDocument: builder,
      resolveRequestContract: () => null,
      expectedPaidRouteCounts: { agentcash: 1, mpp: 1 },
      injectFailureAt: "after-cache-bind",
    });
    assert.equal(hostileReceipt.ok, false);
    assert.equal(hostileReceipt.aborted, true);
    assert.equal(hostileReceipt.rollback.publishedPointerUnchanged, true);
    const postReceipt = publishedStartupReceipt();
    assert.deepEqual(postReceipt, preReceipt);
    recordLabeled("A10.R.published-semantic-receipt", null);
  }

  // A10.R.cache-restore-fault-honest (amendment 10 section 5): two new
  // post-bind D_auth bindings, injected partial restore leaves exactly one
  // new key live while every prior binding preserves === identity.
  await resetParityAuthorityForTests();
  {
    const priorOk = await prepareOpenApiParityStartup({
      buildDocument: builder,
      resolveRequestContract: () => null,
      expectedPaidRouteCounts: { agentcash: 1, mpp: 1 },
    });
    assert.equal(priorOk.ok, true);
    const priorSnapshot = structuredClone(publishedStartupReceipt());
    const priorKeys = processCacheKeys();
    const priorEntries = new Map(priorKeys.map((k) => [k, processCacheEntry(k)]));

    const twoNewBuilder = () => {
      const document = {
        openapi: "3.1.0",
        info: { title: "two-new", version: "1.23.20" },
        paths: {
          "/alpha": { get: { "x-payment-info": {}, operationId: "getAlpha", parameters: [{ name: "q", in: "query", required: true, schema: { type: "string", minLength: 2 }, example: "https://example.com" }], responses: SYNTHETIC_RESPONSE() } },
          "/beta": { get: { "x-payment-info": {}, operationId: "getBeta", parameters: [{ name: "q", in: "query", required: true, schema: { type: "string", maxLength: 100 }, example: "https://example.com" }], responses: SYNTHETIC_RESPONSE() } },
        },
      };
      const contractAlpha = { example: { type: "http", method: "GET", queryParams: { q: "https://example.com" } }, schema: { type: "object", properties: { queryParams: { required: ["q"] } } } };
      applyDiscoveryRequestExamples(document, (label) => ((label === "GET /alpha" || label === "GET /beta") ? structuredClone(contractAlpha) : null));
      return document;
    };
    const receipt = await prepareOpenApiParityStartup({
      buildDocument: twoNewBuilder,
      resolveRequestContract: () => null,
      expectedPaidRouteCounts: { agentcash: 2, mpp: 2 },
      injectFailureAt: "after-cache-bind",
      injectRollbackFault: "cache-restore",
    });
    assert.equal(receipt.ok, false);
    assert.equal(receipt.aborted, true);
    assert.equal(receipt.stage, "CACHE_BIND");
    assert.equal(receipt.primaryCode, "CACHE_TRANSACTION_ABORTED");

    const keysAfter = processCacheKeys();
    const newKeys = keysAfter.filter((k) => !priorEntries.has(k));
    assert.equal(newKeys.length, 1, `exactly one of the two new keys must remain, saw ${newKeys.length}`);
    for (const [k, v] of priorEntries) assert.equal(processCacheEntry(k), v, `prior binding ${k} lost === identity`);
    assert.equal(keysAfter.length, priorKeys.length + 1);
    assert.equal(cacheManifestSnapshot(), computeCacheManifestDigest(
      [...priorEntries.keys(), ...newKeys].map((k) => `${k}\0${processCacheEntry(k).exactDialect}\0${PARITY_RUNTIME_VERSION}`),
    ));
    assert.equal(receipt.rollback.processCacheUnchanged, false);
    assert.equal(receipt.rollback.stagedDiscarded, 0);
    assert.deepEqual(parityRegistrySnapshot(), []);
    assert.equal(receipt.rollback.parityRegistryEmpty, true);
    assert.deepEqual(structuredClone(publishedStartupReceipt()), priorSnapshot);
    assert.equal(receipt.rollback.publishedPointerUnchanged, true);
    recordLabeled("A10.R.cache-restore-fault-honest", receipt.primaryCode);
  }

  // A10.R.overlapping-transaction (amendment 10 section 6): deterministic
  // barrier with two deferred promises — no clocks, no sleeps.
  await resetParityAuthorityForTests();
  {
    let enteredResolve;
    const entered = new Promise((resolve) => { enteredResolve = resolve; });
    let releaseResolve;
    const release = new Promise((resolve) => { releaseResolve = resolve; });

    const overlapOptions = () => ({
      buildDocument: builder,
      resolveRequestContract: () => null,
      expectedPaidRouteCounts: { agentcash: 1, mpp: 1 },
      injectTransactionBarrier: async () => {
        enteredResolve();
        await release;
      },
    });

    const preKeys = processCacheKeys();
    const preEntries = new Map(preKeys.map((k) => [k, processCacheEntry(k)]));
    const preRegistry = parityRegistrySnapshot();
    const preSemantic = structuredClone(publishedStartupReceipt());

    let secondBuilderCalls = 0;
    const firstCall = prepareOpenApiParityStartup(overlapOptions());
    await entered;

    const secondReceipt = await prepareOpenApiParityStartup({
      ...overlapOptions(),
      injectTransactionBarrier: undefined,
      buildDocument: () => { secondBuilderCalls += 1; return builder(); },
    });
    assert.deepEqual(secondReceipt, {
      ok: false,
      aborted: true,
      stage: null,
      primaryCode: "CACHE_TRANSACTION_ABORTED",
      stages: [],
      rollback: {
        stagedDiscarded: 0,
        processCacheUnchanged: true,
        sourceDigestsReproduced: true,
        parityRegistryEmpty: true,
        publishedPointerUnchanged: true,
      },
    });
    assert.equal(secondBuilderCalls, 0);

    // Before release: no live mutation of cache, registry, or published state.
    assert.deepEqual(processCacheKeys(), preKeys);
    for (const [k, v] of preEntries) assert.equal(processCacheEntry(k), v);
    assert.deepEqual(parityRegistrySnapshot(), preRegistry);
    assert.deepEqual(structuredClone(publishedStartupReceipt()), preSemantic);
    recordLabeled("A10.R.overlapping-transaction", secondReceipt.primaryCode);

    releaseResolve();
    const firstReceipt = await firstCall;
    assert.equal(firstReceipt.ok, true);
    assert.deepEqual(firstReceipt.stages, [...STARTUP_STAGES]);
    assert.equal(secondBuilderCalls, 0);
  }

  // Unknown harness option values fail argument validation before any write.
  await resetParityAuthorityForTests();
  {
    const beforeKeys = processCacheKeys();
    assert.rejects(
      () => prepareOpenApiParityStartup({
        buildDocument: builder,
        resolveRequestContract: () => null,
        expectedPaidRouteCounts: { agentcash: 1, mpp: 1 },
        injectRollbackFault: "bogus",
      }),
      /unknown rollback fault/,
    );
    assert.rejects(
      () => prepareOpenApiParityStartup({
        buildDocument: builder,
        resolveRequestContract: () => null,
        expectedPaidRouteCounts: { agentcash: 1, mpp: 1 },
        injectTransactionBarrier: "bogus",
      }),
      /injectTransactionBarrier/,
    );
    assert.deepEqual(processCacheKeys(), beforeKeys);
    assert.deepEqual(parityRegistrySnapshot(), []);
  }

  // Combined labeled receipt arithmetic: 28 unique IDs, both A10 combined
  // digests, A9 subset count/digests, and the 255-row R5 family.
  const snapshotIds = hostileProbeIds();
  assert.equal(snapshotIds.filter((id) => id.startsWith("A9.") || id.startsWith("A10.")).length, 0, "labeled IDs leaked into recordHostileProbe");
  const combinedRecords = Object.fromEntries(labeledReceipt.records);
  const combinedIds = Object.keys(combinedRecords);
  assert.equal(combinedIds.length, 28, `expected 28 labeled records, saw ${combinedIds.length}`);
  assert.deepEqual([...combinedIds].sort(), Object.keys(combinedExpected()).sort());
  assert.equal(new Set(combinedIds).size, 28);
  assert.equal(labeledPrimaryMapDigest(COMBINED_PRIMARY_MAP_TAG, combinedRecords), A10_PRIMARY_MAP_DIGEST);
  assert.equal(labeledManifestDigest(COMBINED_MANIFEST_TAG, combinedIds), A10_MANIFEST_DIGEST);
  const a9Records = Object.fromEntries(Object.entries(combinedRecords).filter(([id]) => id.startsWith("A9.")));
  assert.equal(Object.keys(a9Records).length, 24);
  assert.equal(labeledPrimaryMapDigest(A9_PRIMARY_MAP_TAG, a9Records), A9_PRIMARY_MAP_DIGEST);
  assert.equal(labeledManifestDigest(A9_MANIFEST_TAG, Object.keys(a9Records)), A9_MANIFEST_DIGEST);
  await resetParityAuthorityForTests();
});

test("live generated surface: exact 25/24 paid inventories, full parity, zero findings", { timeout: 180_000 }, async (t) => {
  const base = await bootServer(t);
  const catalog = await readJson(base, "/api/actions");
  assert.equal(catalog.actions.length, 22);

  const frozenBaselines = {
    agentcash: { operations: 39, operationDigest: "b52525aee0afc31e45e333d08f49d96e516acff682d3fbcdd97da5591d7dab7d", paid: 25, paidRouteDigest: "bc4ec8f63723e173dce3f5fe59e01b0ea6ca9c7d33bd150f6ee9fb6dcb9facca" },
    mpp: { operations: 38, operationDigest: "2c8b9955304ce74a279c8467f77df47d74c2966fd0644805719e9d2e68d36b4c", paid: 24, paidRouteDigest: "1d6151ca5f7c652c201d34d864aa10a5e03c86c586363191574a383359e2a8a0" },
  };

  for (const [profile, route] of [["agentcash", "/openapi.json"], ["mpp", "/mpp-openapi.json"]]) {
    const document = await readJson(base, route);
    assert.equal(document.openapi, "3.1.0");
    assert.equal(document.info.version, "1.23.21");

    // Exact paid inventory reconciliation over EVERY generated paid operation.
    const expectedRoutes = expectedPaidMethodRoutes({ profile, circleGatewayEnabled: true });
    assert.equal(expectedRoutes.length, EXPECTED_PAID_METHOD_ROUTE_COUNTS[profile]);
    assert.deepEqual(paidMethodRoutesOf(document), expectedRoutes);
    await prepareFetchedDocuments({
      agentcash: profile === "agentcash" ? document : (await readJson(base, "/openapi.json")),
      mpp: profile === "mpp" ? document : (await readJson(base, "/mpp-openapi.json")),
      circleGatewayEnabled: true,
    });

    // Full request-example, response-schema, and safety parity across 25/24.
    const findings = collectOpenApiRequestExampleFindings({ document, actions: catalog.actions, expectedPaidMethodRoutes: expectedRoutes });
    assert.deepEqual(findings, []);

    // F-class frozen operation/paid-route baselines over the live documents.
    const operations = operationIdManifest(document);
    const paid = paidRouteManifest(document);
    assert.equal(operations.count, frozenBaselines[profile].operations);
    assert.equal(operations.digest, frozenBaselines[profile].operationDigest);
    assert.equal(paid.count, frozenBaselines[profile].paid);
    assert.equal(paid.digest, frozenBaselines[profile].paidRouteDigest);
    probe(`R5.I.default-${profile}`, null);

    for (const [method, actionPath, name] of REQUIRED_QUERY_EXAMPLE_INPUTS) {
      const parameter = document.paths[actionPath].get.parameters.find((entry) => entry.in === "query" && entry.name === name && entry.required === true);
      assert.ok(parameter, `${method} ${actionPath} missing required query input ${name} in ${profile}`);
      assert.ok(isScalarQueryValue(parameterExampleValue(parameter)), `${method} ${actionPath} query input ${name} lacks a scalar example in ${profile}`);
    }
    for (const [, actionPath] of PAID_POST_ROUTES) {
      const bodyExample = document.paths[actionPath].post.requestBody.content["application/json"].example;
      assert.ok(bodyExample && typeof bodyExample === "object", `${actionPath} lacks a JSON-body request example in ${profile}`);
    }

    // The scoped public signature exception carries the canonical base58 schema.
    const solanaOperation = document.paths["/chain/solana-transaction-receipt"].get;
    const signatureParameter = solanaOperation.parameters.find((entry) => entry.in === "query" && entry.name === "signature" && entry.required === true);
    assert.equal(signatureParameter.schema.pattern, PUBLIC_SOLANA_SIGNATURE_QUERY.schemaPattern);
    assert.equal(signatureParameter.example, SOLANA_SIGNATURE_EXAMPLE);
  }

  // The Circle gateway GET alias maps onto its canonical GET request contract:
  // its accepted example is canonically equal to the canonical contract value.
  const agentcash = await readJson(base, "/openapi.json");
  const aliasParameter = agentcash.paths["/gateway/commerce/payment-offer-preflight"].get.parameters.find((entry) => entry.in === "query" && entry.name === "url" && entry.required === true);
  const canonicalParameter = agentcash.paths["/commerce/payment-offer-preflight"].get.parameters.find((entry) => entry.in === "query" && entry.name === "url" && entry.required === true);
  assert.ok(valuesCanonicallyEqual(parameterExampleValue(aliasParameter), parameterExampleValue(canonicalParameter)));

  // F-class package/runtime authority probes (Phase A harness reads).
  const rootManifest = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8"));
  assert.equal(rootManifest.dependencies["@hyperjump/browser"], "1.5.0");
  assert.equal(rootManifest.dependencies["@hyperjump/json-schema"], "1.17.8");
  assert.equal("@cfworker/json-schema" in rootManifest.dependencies, false);
  probe("R5.F.direct-dependency", null);
  const lock = JSON.parse(readFileSync(path.join(cwd, "package-lock.json"), "utf8"));
  assert.equal(lock.packages[""].dependencies["@hyperjump/browser"], "1.5.0");
  assert.equal(lock.packages[""].dependencies["@hyperjump/json-schema"], "1.17.8");
  assert.equal(lock.packages["node_modules/@hyperjump/browser"].version, "1.5.0");
  assert.equal(lock.packages["node_modules/@hyperjump/browser"].peer, undefined);
  assert.equal(lock.packages["node_modules/@hyperjump/json-schema"].peerDependencies["@hyperjump/browser"], "^1.1.0");
  assert.equal(lock.packages["node_modules/@hyperjump/json-schema"].integrity, "sha512-XOqbR9GRNHaH4JEXHdbsm7xfYwudZG7HVDq3qPZUb1gi+ZQPklgNvhMi6zf0Plf433qR61MK+xeeprUwUUvGPg==");
  probe("R5.F.lock-integrity", null);
  const paritySource = readFileSync(path.join(cwd, "openapi-request-example-parity.mjs"), "utf8");
  assert.equal(paritySource.includes("@cfworker"), false);
  probe("R5.F.old-validator-parity-unreachable", null);
  assert.equal(/SUPPORTED_SCHEMA_KEYWORDS|visitSchemaTree|SUBSCHEMA_MAP_KEYWORDS|unsupportedKeywordFindings/.test(paritySource), false);
  probe("R5.F.private-walker-absent", null);
  assert.deepEqual(parityRegistrySnapshot(), []);
  probe("R5.F.synthetic-registry-empty", null);
  const registered = allRegisteredSchemaUris();
  assert.equal(registered.includes("https://spec.openapis.org/oas/3.0/schema"), true);
  assert.equal(registered.includes("https://spec.openapis.org/oas/3.1/schema"), true);
  assert.equal(registered.includes("https://spec.openapis.org/oas/3.1/dialect/base"), true);
  probe("R5.F.package-metas-preserved", null);

  // Packed consumer import + tarball exclusions + resolved version.
  const packed = await ensurePackedConsumer();
  const consumerFormats = await import(pathToFileURL(path.join(packed.consumerNodeModules, "@hyperjump/json-schema/formats/index.js")).href);
  const consumerOas30 = await import(pathToFileURL(path.join(packed.consumerNodeModules, "@hyperjump/json-schema/openapi-3-0/index.js")).href);
  const consumerOas31 = await import(pathToFileURL(path.join(packed.consumerNodeModules, "@hyperjump/json-schema/openapi-3-1/index.js")).href);
  const consumerParity = await import(pathToFileURL(packed.parityPath).href);
  assert.deepEqual(Object.keys(consumerFormats), []);
  probe("R5.F.packed-import-formats", typeof consumerOas31.registerSchema === "function" ? null : "DEPENDENCY_AUTHORITY_DRIFT");
  probe("R5.F.packed-import-oas30", typeof consumerOas30.registerSchema === "function" ? null : "DEPENDENCY_AUTHORITY_DRIFT");
  probe("R5.F.packed-import-oas31", typeof consumerOas31.registerSchema === "function" ? null : "DEPENDENCY_AUTHORITY_DRIFT");
  assert.equal(typeof consumerParity.prepareOpenApiParityStartup, "function");
  const installedHyperjump = JSON.parse(readFileSync(path.join(packed.consumerNodeModules, "@hyperjump/json-schema/package.json"), "utf8"));
  assert.equal(installedHyperjump.version, "1.17.8");
  probe("R5.F.version-authority", installedHyperjump.version === PARITY_RUNTIME_VERSION ? null : "VERSION_AUTHORITY_DRIFT");
  const excluded = packed.packFiles.filter((p) => p.startsWith("evidence/") || p.startsWith("assignment/") || /^(PROMPT|RESULT|RUN|TRACE|TRANSCRIPT)/i.test(path.basename(p)));
  assert.deepEqual(excluded, []);
  probe("R5.F.tarball-exclusions", excluded.length === 0 ? null : "DEPENDENCY_AUTHORITY_DRIFT");
});

test("credential-free unpaid 402 constructibility canary: all 25 AgentCash paid method-routes construct from generated examples and receive HTTP 402", { timeout: 180_000 }, async (t) => {
  // Transport canary only: constructibility from generated examples, no
  // credential/payment headers, HTTP 402, no top-level success envelope, no
  // reported charge, and no Set-Cookie. This is not proof that a business
  // handler, outbound request, persistent mutation, or other application
  // effect did not run before the 402.
  const base = await bootServer(t);
  const document = await readJson(base, "/openapi.json");
  const routes = paidMethodRoutesOf(document);
  assert.equal(routes.length, EXPECTED_PAID_METHOD_ROUTE_COUNTS.agentcash);

  const outcomes = [];
  for (const route of routes) {
    const [method, pathname] = route.split(" ");
    const operation = document.paths[pathname][method.toLowerCase()];
    let url = `${base}${pathname}`;
    const init = { method, headers: {}, redirect: "manual" };
    if (method === "GET") {
      const query = new URLSearchParams();
      for (const parameter of (operation.parameters || []).filter((entry) => entry.in === "query" && entry.required === true)) {
        const example = parameterExampleValue(parameter);
        assert.ok(isScalarQueryValue(example), `${route}: generated example is not a constructible scalar`);
        query.set(parameter.name, String(example));
      }
      url = `${url}?${query.toString()}`;
    } else {
      const body = operation.requestBody?.content?.["application/json"]?.example;
      assert.ok(body && typeof body === "object", `${route}: generated body example missing`);
      init.headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    // Zero credentials, wallet, signer, settlement, or payment material is sent.
    const sentHeaderNames = Object.keys(init.headers).map((name) => name.toLowerCase());
    assert.deepEqual(sentHeaderNames.filter((name) => ["authorization", "cookie", "x-payment", "payment-signature", "x-api-key"].includes(name)), []);
    assert.equal(Object.hasOwn(init, "body") && /"privateKey"|"mnemonic"|"secret"/i.test(String(init.body || "")), false);
    const response = await fetch(url, init);
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    assert.equal(response.status, 402, `${route}: expected an unpaid 402 challenge`);
    assert.ok(body && typeof body === "object", `${route}: 402 challenge body is not JSON`);
    let headerChallenge = "";
    const paymentRequired = response.headers.get("payment-required");
    if (paymentRequired) {
      try { headerChallenge = Buffer.from(paymentRequired, "base64").toString("utf8"); } catch { headerChallenge = ""; }
    }
    const challengeMaterial = `${JSON.stringify(body)}\n${headerChallenge}\n${response.headers.get("www-authenticate") || ""}`;
    assert.match(challengeMaterial, /accepts|offers|payment|x402/i, `${route}: 402 carries no payment challenge`);
    assert.notEqual(body.ok, true, `${route}: unpaid request produced application success output`);
    assert.equal(body.decision, undefined, `${route}: unpaid request produced an application decision`);
    assert.ok(!response.headers.get("set-cookie"), `${route}: unpaid challenge tried to set credential state`);
    assert.notEqual(body.charged, true, `${route}: unpaid challenge reported a charge`);
    outcomes.push({ route, status: response.status });
  }
  assert.equal(outcomes.length, 25);
  assert.equal(outcomes.filter((entry) => entry.status === 402).length, 25);
  probe("R5.K.default-25-of-25", null);
});

test("CIRCLE_GATEWAY_ENABLED=false boots and derives 24/24 inventories from enabled mounted surfaces", { timeout: 180_000 }, async (t) => {
  const base = await bootServer(t, { CIRCLE_GATEWAY_ENABLED: "false" });
  const catalog = await readJson(base, "/api/actions");
  assert.equal(catalog.actions.length, 22);

  const frozenDisabled = { operations: 38, operationDigest: "2c8b9955304ce74a279c8467f77df47d74c2966fd0644805719e9d2e68d36b4c", paid: 24, paidRouteDigest: "1d6151ca5f7c652c201d34d864aa10a5e03c86c586363191574a383359e2a8a0" };
  for (const [profile, route, expectedCount] of [
    ["agentcash", "/openapi.json", EXPECTED_ENABLED_SURFACE_COUNTS.agentcashCircleDisabled],
    ["mpp", "/mpp-openapi.json", EXPECTED_ENABLED_SURFACE_COUNTS.mpp],
  ]) {
    const document = await readJson(base, route);
    assert.equal(document.openapi, "3.1.0");
    assert.equal(document.info.version, "1.23.21");
    const expectedRoutes = expectedPaidMethodRoutes({ profile, circleGatewayEnabled: false });
    assert.equal(expectedRoutes.length, expectedCount);
    assert.deepEqual(paidMethodRoutesOf(document), expectedRoutes);
    assert.equal(document.paths["/gateway/commerce/payment-offer-preflight"], undefined);
    await prepareFetchedDocuments({
      agentcash: profile === "agentcash" ? document : (await readJson(base, "/openapi.json")),
      mpp: profile === "mpp" ? document : (await readJson(base, "/mpp-openapi.json")),
      circleGatewayEnabled: false,
    });
    assert.deepEqual(collectOpenApiRequestExampleFindings({
      document,
      actions: catalog.actions,
      expectedPaidMethodRoutes: expectedRoutes,
    }), []);
    const operations = operationIdManifest(document);
    const paid = paidRouteManifest(document);
    assert.equal(operations.count, frozenDisabled.operations);
    assert.equal(operations.digest, frozenDisabled.operationDigest);
    assert.equal(paid.count, frozenDisabled.paid);
    assert.equal(paid.digest, frozenDisabled.paidRouteDigest);
    probe(`R5.I.circle-disabled-${profile}`, null);
  }
  // 24-of-24 credential-free unpaid 402 constructibility in the disabled mode.
  const disabledDocument = await readJson(base, "/openapi.json");
  const disabledRoutes = paidMethodRoutesOf(disabledDocument);
  assert.equal(disabledRoutes.length, 24);
  const disabledOutcomes = [];
  for (const route of disabledRoutes) {
    const [method, pathname] = route.split(" ");
    const operation = disabledDocument.paths[pathname][method.toLowerCase()];
    let url = `${base}${pathname}`;
    const init = { method, headers: {}, redirect: "manual" };
    if (method === "GET") {
      const query = new URLSearchParams();
      for (const parameter of (operation.parameters || []).filter((entry) => entry.in === "query" && entry.required === true)) {
        query.set(parameter.name, String(parameterExampleValue(parameter)));
      }
      url = `${url}?${query.toString()}`;
    } else {
      init.headers["content-type"] = "application/json";
      init.body = JSON.stringify(operation.requestBody?.content?.["application/json"]?.example);
    }
    const response = await fetch(url, init);
    assert.equal(response.status, 402, `${route}: expected an unpaid 402 challenge`);
    disabledOutcomes.push({ route, status: response.status });
  }
  assert.equal(disabledOutcomes.filter((entry) => entry.status === 402).length, 24);
  probe("R5.K.circle-disabled-24-of-24", null);

  // Final focused node: the shared hostile receipt carries every one of the
  // 255 stable IDs exactly once, with both frozen digests.
  const snapshot = hostileProbeReceiptSnapshot();
  const expectedIds = hostileProbeIds();
  assert.equal(snapshot.count, 255);
  assert.deepEqual(snapshot.ids, expectedIds);
  assert.equal(new Set(snapshot.ids).size, 255);
  assert.equal(hostileProbeManifestDigest(snapshot.ids), HOSTILE_PROBE_MANIFEST_DIGEST);
  assert.equal(hostilePrimaryMapDigest(snapshot.ids), HOSTILE_PRIMARY_MAP_DIGEST);
  const classCounts = Object.fromEntries(Object.entries(HOSTILE_PROBE_CLASSES).map(([cls, members]) => [cls, members.length]));
  assert.deepEqual(classCounts, { A: 40, B: 24, C: 6, D: 57, E: 32, F: 12, G: 9, H: 8, I: 4, J: 12, K: 2, L: 2, M: 7, N: 14, O: 16, P: 10 });
});

// ---------------------------------------------------------------------------
// Shared server boot helper (unchanged shape from the accepted baseline).
// ---------------------------------------------------------------------------

function paidMethodRoutesOf(document) {
  const routes = [];
  for (const [pathname, pathItem] of Object.entries(document.paths)) {
    for (const method of ["get", "post"]) {
      if (pathItem?.[method]?.["x-payment-info"]) routes.push(`${method.toUpperCase()} ${pathname}`);
    }
  }
  return routes.sort();
}

async function bootServer(t, extraEnv = {}) {
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
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const listening = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup timed out: ${output.slice(-2000)}`)), 120_000);
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
  assert.equal(SERVICE_VERSION, "1.23.21");
  return `http://127.0.0.1:${port}`;
}

// ===========================================================================
// Adversarial recut coverage (current-master recut): six focused failure
// classes required by the recut assignment. These complement the hostile
// matrix above without touching its shared receipt (no recordHostileProbe
// calls here) and run after every other node in this file.
// ===========================================================================

test("adversarial: prepared percent-encoding failures fail closed before publication", async () => {
  resetParityAuthorityForTests();
  const hostile = "https://example.com/%ZZ";
  const buildDocument = () => {
    const doc = syntheticGetDocument({ example: hostile });
    applyDiscoveryRequestExamples(doc, (label) => (label === "GET /probe" ? syntheticQueryContract(hostile) : null));
    return doc;
  };
  // Unit boundary: the bounded multi-decode reports the malformed envelope.
  assert.throws(() => decodeUriStages("%ZZ"), { code: "MALFORMED_PERCENT" });
  // Synchronous projection refuses the hostile envelope outright.
  assert.throws(() => buildDocument(), { code: "MALFORMED_PERCENT" });
  // The asynchronous preparation transaction aborts at MATERIALIZING with the
  // same bounded identity and publishes nothing.
  const aborted = await prepareOpenApiParityStartup({
    buildDocument,
    resolveRequestContract: () => null,
    expectedPaidRouteCounts: { agentcash: 1, mpp: 1 },
  });
  assert.equal(aborted.ok, false);
  assert.equal(aborted.stage, "MATERIALIZING");
  assert.equal(aborted.primaryCode, "MALFORMED_PERCENT");
  assert.equal(aborted.rollback.publishedPointerUnchanged, true);
  assert.equal(aborted.rollback.processCacheUnchanged, true);
  assert.equal(aborted.rollback.parityRegistryEmpty, true);
  assert.equal(publishedStartupReceipt(), null);
});

test("adversarial: nested schema dialect drift fails closed and never reuses stale authority", async () => {
  resetParityAuthorityForTests();
  const healthySchema = { type: "object", properties: { url: { type: "string", minLength: 1 } } };
  await warmAuthority([[structuredClone(healthySchema), { url: "https://example.com" }]]);
  // The prepared authority validates the conforming instance...
  assert.deepEqual(validateExampleAgainstSchema({ url: "https://example.com" }, structuredClone(healthySchema), "$"), []);
  // ...a top-level draft-07 $schema drift is rejected outright under the
  // declared OAS 3.1 dialect...
  const DRAFT_07 = "http://json-schema.org/draft-07/schema#";
  assert.deepEqual(
    validateExampleAgainstSchema({ url: "https://example.com" }, { $schema: DRAFT_07, type: "object", properties: { url: { type: "string" } } }, "$").map((finding) => finding.code),
    ["DIALECT_REJECTED"],
  );
  // ...the same $schema inside a 3.0 document gains no 3.1 semantics...
  assert.deepEqual(
    validateExampleAgainstSchema({ url: "https://example.com" }, { $schema: DRAFT_07, type: "object", properties: { url: { type: "string" } } }, "$", { documentOpenApiVersion: "3.0.3" }).map((finding) => finding.code),
    ["NESTED_DIALECT_REJECTED"],
  );
  // ...and a nested property-level $schema drift changes the authority
  // identity and fails closed instead of reusing the stale compiled
  // validator of the original identity.
  const nestedDrift = { type: "object", properties: { url: { $schema: DRAFT_07, type: "string" } } };
  assert.deepEqual(
    validateExampleAgainstSchema({ url: "https://example.com" }, nestedDrift, "$").map((finding) => finding.code),
    ["CACHE_IDENTITY_MISMATCH"],
  );
  // ...and an uncompiled nested-shape drift (tightened minLength) likewise
  // never falls back to the stale compiled validator of the original identity.
  const driftedNested = { type: "object", properties: { url: { type: "string", minLength: 64 } } };
  assert.deepEqual(
    validateExampleAgainstSchema({ url: "https://example.com" }, driftedNested, "$").map((finding) => finding.code),
    ["CACHE_IDENTITY_MISMATCH"],
  );
  // Full preparation also aborts on the top-level dialect drift.
  const buildDocument = () => {
    const doc = syntheticPostDocument({ schema: { $schema: DRAFT_07, type: "object", properties: { url: { type: "string" } } }, example: { url: "https://example.com" } });
    applyDiscoveryRequestExamples(doc, (label) => (label === "POST /probe" ? syntheticBodyContract({ url: "https://example.com" }) : null));
    return doc;
  };
  const aborted = await prepareOpenApiParityStartup({
    buildDocument,
    resolveRequestContract: () => null,
    expectedPaidRouteCounts: { agentcash: 1, mpp: 1 },
  });
  assert.equal(aborted.ok, false);
  assert.equal(aborted.stage, "MATERIALIZING");
  assert.equal(aborted.primaryCode, "DIALECT_REJECTED");
  assert.equal(aborted.rollback.publishedPointerUnchanged, true);
  resetParityAuthorityForTests();
});

test("adversarial: canonical examples bind to the exact method-route and profile inventory", async () => {
  // Warm the compiled authorities for the fixture schemas so standalone
  // synchronous projection resolves validators instead of failing closed.
  resetParityAuthorityForTests();
  await warmAuthority([[{ type: "string" }, "https://example.com"], [{ type: "object" }, { url: "https://example.com" }]]);
  const queryContract = syntheticQueryContract("https://example.com");
  const bodyContract = syntheticBodyContract({ url: "https://example.com" });
  const document = {
    openapi: "3.1.0",
    info: { title: "substitution", version: "1.23.20" },
    paths: {
      "/probe": {
        get: { "x-payment-info": {}, operationId: "getProbe", parameters: [{ name: "q", in: "query", required: true, schema: { type: "string" } }], responses: SYNTHETIC_RESPONSE() },
        post: { "x-payment-info": {}, operationId: "postProbe", requestBody: { content: { "application/json": { schema: { type: "object" } } } }, responses: SYNTHETIC_RESPONSE() },
      },
    },
  };
  const receipt = applyDiscoveryRequestExamples(document, (label) => {
    if (label === "GET /probe") return structuredClone(queryContract);
    if (label === "POST /probe") return structuredClone(bodyContract);
    return null;
  });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.queryExamples, 1);
  assert.equal(receipt.bodyExamples, 1);
  // Each canonical value landed on its exact method-route and nowhere else.
  assert.equal(document.paths["/probe"].get.parameters[0].example, "https://example.com");
  assert.deepEqual(document.paths["/probe"].post.requestBody.content["application/json"].example, { url: "https://example.com" });
  assert.equal(document.paths["/probe"].get.requestBody, undefined);
  assert.equal(document.paths["/probe"].post.parameters, undefined);

  // Method substitution fails closed in both directions: a GET-shaped
  // contract cannot feed a POST JSON body...
  assert.throws(
    () => applyDiscoveryRequestExamples(syntheticPostDocument({}), (label) => (label === "POST /probe" ? structuredClone(queryContract) : null)),
    { code: "INVALID_SCHEMA_TYPE" },
  );
  // ...and a POST-shaped contract cannot feed GET query inputs.
  assert.throws(
    () => applyDiscoveryRequestExamples(syntheticGetDocument({}), (label) => (label === "GET /probe" ? structuredClone(bodyContract) : null)),
    { code: "INVENTORY_DRIFT" },
  );

  // Profile substitution: the Circle gateway alias joins only the AgentCash
  // enabled inventory; MPP never inherits it even with the gateway enabled.
  // The derived counts equal the frozen current-inventory constants.
  const agentcashEnabled = expectedPaidMethodRoutes({ profile: "agentcash", circleGatewayEnabled: true });
  assert.equal(agentcashEnabled.length, EXPECTED_ENABLED_SURFACE_COUNTS.agentcashCircleEnabled);
  assert.equal(agentcashEnabled.length, EXPECTED_PAID_METHOD_ROUTE_COUNTS.agentcash);
  assert.ok(agentcashEnabled.includes("GET /gateway/commerce/payment-offer-preflight"));
  const agentcashDisabled = expectedPaidMethodRoutes({ profile: "agentcash", circleGatewayEnabled: false });
  assert.equal(agentcashDisabled.length, EXPECTED_ENABLED_SURFACE_COUNTS.agentcashCircleDisabled);
  assert.ok(!agentcashDisabled.includes("GET /gateway/commerce/payment-offer-preflight"));
  const mppEnabled = expectedPaidMethodRoutes({ profile: "mpp", circleGatewayEnabled: true });
  assert.equal(mppEnabled.length, EXPECTED_ENABLED_SURFACE_COUNTS.mpp);
  assert.equal(mppEnabled.length, EXPECTED_PAID_METHOD_ROUTE_COUNTS.mpp);
  assert.ok(!mppEnabled.includes("GET /gateway/commerce/payment-offer-preflight"));
});

test("adversarial: projected examples are isolated from mutable contract inputs and document outputs", async () => {
  // Warm the compiled authorities for the fixture schemas so the standalone
  // synchronous projection can resolve validators instead of failing closed
  // on unprepared identities.
  resetParityAuthorityForTests();
  await warmAuthority([[{ type: "string" }, "https://example.com"], [{ type: "object" }, { url: "https://example.com" }]]);
  // Safe materialization is isolated in both directions.
  const input = { url: { path: "https://example.com" } };
  const snapshot = materializeSafe(input, "example");
  input.url.path = "https://drifted.example";
  input.extra = "late";
  assert.equal(snapshot.url.path, "https://example.com");
  assert.equal(snapshot.extra, undefined);
  snapshot.url.path = "mutated-output";
  assert.equal(input.url.path, "https://drifted.example");
  // Frozen inputs materialize without mutation attempts.
  assert.deepEqual(materializeSafe(Object.freeze({ ok: Object.freeze({ nested: 1 }) }), "example"), { ok: { nested: 1 } });

  // Contract-object mutation after projection never leaks into the generated
  // document: the projected example is a structured clone of the canonical
  // value, not a live reference into the resolver's return value.
  const holder = { contract: syntheticQueryContract("https://example.com") };
  const doc = syntheticGetDocument({});
  applyDiscoveryRequestExamples(doc, (label) => (label === "GET /probe" ? holder.contract : null));
  holder.contract.example.queryParams.q = "https://mutated-after.example";
  assert.equal(doc.paths["/probe"].get.parameters[0].example, "https://example.com");
  // Document-side tampering is detected and deterministically re-overwritten.
  doc.paths["/probe"].get.parameters[0].example = "https://stale.example";
  const second = applyDiscoveryRequestExamples(doc, (label) => (label === "GET /probe" ? syntheticQueryContract("https://example.com") : null));
  assert.equal(second.queryOverwritten, 1);
  assert.equal(second.queryVerified, 0);
  assert.equal(doc.paths["/probe"].get.parameters[0].example, "https://example.com");
  // The same isolation holds for POST bodies.
  const mutableBody = { contract: syntheticBodyContract({ url: "https://example.com" }) };
  const postDoc = syntheticPostDocument({});
  applyDiscoveryRequestExamples(postDoc, (label) => (label === "POST /probe" ? mutableBody.contract : null));
  mutableBody.contract.example.body.url = "https://mutated-after.example";
  assert.deepEqual(postDoc.paths["/probe"].post.requestBody.content["application/json"].example, { url: "https://example.com" });
});

test("adversarial: partial startup publication leaves prior published state and process cache intact", async () => {
  resetParityAuthorityForTests();
  // One good boot publishes authority for the base fixture.
  const first = await warmAuthority([[{ type: "string" }, "https://example.com"]]);
  assert.equal(first.ok, true);
  const beforeReceipt = publishedStartupReceipt();
  const beforeCacheDigest = cacheManifestSnapshot();
  const beforeCacheKeys = processCacheKeys();
  const options = { resolveRequestContract: () => null, expectedPaidRouteCounts: { agentcash: 1, mpp: 1 } };
  // A hostile injection after CACHE_BIND aborts the transaction: the staged
  // bind must never become the published pointer swap.
  const freshBuilder = () => {
    const doc = syntheticGetDocument({ schema: { type: "string", minLength: 8 }, example: "https://example.com" });
    applyDiscoveryRequestExamples(doc, (label) => (label === "GET /probe" ? syntheticQueryContract("https://example.com") : null));
    return doc;
  };
  const abortedBind = await prepareOpenApiParityStartup({ buildDocument: freshBuilder, injectFailureAt: "after-cache-bind", ...options });
  assert.equal(abortedBind.ok, false);
  assert.equal(abortedBind.primaryCode, "CACHE_TRANSACTION_ABORTED");
  assert.equal(abortedBind.rollback.publishedPointerUnchanged, true);
  assert.deepEqual(publishedStartupReceipt(), beforeReceipt);
  assert.deepEqual(processCacheKeys(), beforeCacheKeys);
  assert.equal(cacheManifestSnapshot(), beforeCacheDigest);
  // A later-stage hostile injection (inventory gate) behaves identically.
  const abortedGate = await prepareOpenApiParityStartup({ buildDocument: freshBuilder, injectFailureAt: "inventory-gate", ...options });
  assert.equal(abortedGate.ok, false);
  assert.equal(abortedGate.stage, "INVENTORY_GATE");
  assert.equal(abortedGate.primaryCode, "STARTUP_ABORTED");
  assert.equal(abortedGate.rollback.publishedPointerUnchanged, true);
  assert.deepEqual(publishedStartupReceipt(), beforeReceipt);
  assert.deepEqual(processCacheKeys(), beforeCacheKeys);
  // Request-time synchronous generation keeps resolving from the prior
  // published authority: it can never observe partly prepared state.
  assert.deepEqual(validateExampleAgainstSchema("https://example.com", { type: "string" }, "$"), []);
  assert.deepEqual(
    validateExampleAgainstSchema("https://example.com", { type: "string", minLength: 8 }, "$").map((finding) => finding.code),
    ["CACHE_IDENTITY_MISMATCH"],
  );
  resetParityAuthorityForTests();
});

test("adversarial: paid inventory changing underneath a stale prepared cache fails closed", async () => {
  resetParityAuthorityForTests();
  await warmAuthority([[{ type: "string" }, "https://example.com"]]);
  const published = publishedStartupReceipt();
  // Rebuild with an extra paid method-route: the stale cache still holds the
  // old compiled validator, but both manifests drift from the published
  // bindings, so the drift is detectable instead of silently served.
  const grown = syntheticGetDocument({});
  grown.paths["/probe2"] = {
    get: {
      "x-payment-info": {},
      operationId: "getProbe2",
      parameters: [{ name: "q", in: "query", required: true, schema: { type: "string" }, example: "https://example.com" }],
      responses: SYNTHETIC_RESPONSE(),
    },
  };
  applyDiscoveryRequestExamples(grown, (label) => (label === "GET /probe" || label === "GET /probe2" ? syntheticQueryContract("https://example.com") : null));
  for (const profile of ["agentcash", "mpp"]) {
    const grownRoutes = paidRouteManifest(grown);
    assert.notEqual(grownRoutes.digest, published.paidRouteManifests[profile].digest);
    assert.notEqual(grownRoutes.count, published.paidRouteManifests[profile].count);
    assert.notEqual(operationIdManifest(grown).digest, published.operationManifests[profile].digest);
  }
  // The audit reports the exact drift against the canonical expected set...
  const growthFindings = collectOpenApiRequestExampleFindings({ document: grown, expectedPaidMethodRoutes: ["GET /probe"] });
  assert.ok(growthFindings.some((finding) => finding.code === "INVENTORY_DRIFT" && finding.message.includes("paid inventory drift")));
  // ...the removal direction fails closed the same way...
  const shrunk = syntheticGetDocument({});
  delete shrunk.paths["/probe"];
  const shrinkFindings = collectOpenApiRequestExampleFindings({ document: shrunk, expectedPaidMethodRoutes: ["GET /probe"] });
  assert.ok(shrinkFindings.some((finding) => finding.code === "INVENTORY_DRIFT"));
  // ...and the synchronous generation gate rejects a drifted rebuilt surface.
  assert.throws(() => assertGeneratedOpenApiSurfaceGate({
    documents: { agentcash: grown, mpp: structuredClone(grown) },
    resolveRequestContract: () => null,
    circleGatewayEnabled: false,
  }), /generation gate failed/);
  // The frozen current-inventory constants stay consistent with the derived
  // enabled-surface inventories (no stale hard-coded counts).
  assert.equal(expectedPaidMethodRoutes({ profile: "agentcash", circleGatewayEnabled: true }).length, EXPECTED_PAID_METHOD_ROUTE_COUNTS.agentcash);
  assert.equal(expectedPaidMethodRoutes({ profile: "mpp" }).length, EXPECTED_PAID_METHOD_ROUTE_COUNTS.mpp);
  resetParityAuthorityForTests();
});
