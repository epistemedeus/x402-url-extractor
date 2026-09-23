#!/usr/bin/env node
// Merchant cross-surface verifier. Never pays, settles, or deploys.
// Exit 0 pass, 1 demonstrated failure, 2 bad invocation, 3 evidence missing, 64 unexpected.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "epistemedeus/x402-url-extractor";
const CANONICAL_HOST = "agents.samedaydesk.com";
const DEFAULT_ORIGIN = `https://${CANONICAL_HOST}`;
const RAILWAY_HOST = "x402-url-extractor-production.up.railway.app";
const ABSENT_TOOL = "__r0923_absent_tool__";
const ALLOWED_FLAGS = new Set(["--json", "--profile", "--fixture", "--origin", "--help"]);
const PROFILES = new Set(["local", "archive", "hosted-unpaid"]);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const ARCHIVE_PATH = path.join(ROOT, "test/fixtures/verify/canonical-routes.json");

const FOUR_ROUTES = [
  { id: "extract", method: "GET", path: "/extract", query: { url: "https://example.com" }, amount: "5000" },
  { id: "morpho-position", method: "GET", path: "/defi/morpho-position", query: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }, amount: "20000" },
  { id: "extract-batch", method: "POST", path: "/extract/batch", body: { urls: ["https://example.com/"], fields: ["title"] }, amount: "10000" },
  {
    id: "seller-integrity-audit",
    method: "GET",
    path: "/commerce/seller-integrity-audit",
    query: { origin: DEFAULT_ORIGIN, route: "/extract", method: "GET" },
    amount: "10000",
  },
];

const SECOND_EXTRACT = {
  id: "extract-second",
  method: "GET",
  path: "/extract",
  query: { url: "https://example.org/docs" },
  amount: "5000",
};

const LOCAL_FIXTURES = {
  "amount-5001": { kind: "amount", observedAmount: "5001", expectedAmount: "5000" },
  "payto-short": { kind: "payto", payTo: "0x1" },
  "manifest-openapi-drift": { kind: "price-surface", manifestAtomic: "5000", openapiDisplay: "0.01" },
  "price-surface-ok": { kind: "price-surface", manifestAtomic: "10000", openapiDisplay: "0.01" },
  "railway-canonical": { kind: "canonical-host", canonicalHost: RAILWAY_HOST },
  "settle-requested": { kind: "settle", requested: true },
  "healthz-missing-batch": { kind: "healthz-batch", manifestAtomic: "10000", healthzPrices: { extract: "$0.005" } },
  "healthz-batch-ok": { kind: "healthz-batch", manifestAtomic: "10000", healthzPrices: { "extract/batch": "10000", extract: "$0.005" } },
  "bazaar-sample-differs": {
    kind: "counterexample",
    case: "bazaar-sample",
    sampleInput: "https://example.com",
    requestUrl: "https://caller.example/page",
  },
  "a2a-redirect": {
    kind: "counterexample",
    case: "a2a-redirect",
    from: "https://samedaydesk.com/.well-known/agent-card.json",
    to: `${DEFAULT_ORIGIN}/.well-known/agent-card.json`,
  },
  "zero-charge-write": {
    kind: "counterexample",
    case: "zero-charge-write",
    method: "POST",
    route: "/recipes/page-change",
    charged: false,
    writesBrief: true,
  },
  "range-vs-fixed": {
    kind: "counterexample",
    case: "range-vs-fixed",
    rangeUsd: [490, 1500],
    fixedOfferUsd: 490,
  },
  "stripe-human": {
    kind: "counterexample",
    case: "stripe-human",
    checkout: "stripe",
    x402: null,
  },
  "railway-alias": {
    kind: "counterexample",
    case: "railway-alias",
    canonicalHost: CANONICAL_HOST,
    aliasHost: RAILWAY_HOST,
  },
};

const FAIL_FIXTURES = new Set([
  "amount-5001",
  "payto-short",
  "manifest-openapi-drift",
  "railway-canonical",
  "settle-requested",
  "healthz-missing-batch",
]);

function nodeInfo() {
  const major = Number(process.versions.node.split(".")[0]);
  return {
    wanted: ">=20",
    actual: process.version,
    major,
    satisfiesEngines: major >= 20,
  };
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

export function valuesMatch(observed, expected) {
  return JSON.stringify(stable(observed)) === JSON.stringify(stable(expected));
}

export function assertionPassed(executed, observed, expected) {
  return executed === true && valuesMatch(observed, expected);
}

function evidenceItem(id, executed, observed, expected, note) {
  return {
    id,
    executed,
    observed,
    expected,
    assertionPassed: assertionPassed(executed, observed, expected),
    note,
  };
}

function atomicToDisplay(atomic) {
  if (!/^[0-9]+$/.test(String(atomic))) return null;
  const value = BigInt(atomic);
  const whole = value / 1000000n;
  let fraction = (value % 1000000n).toString().padStart(6, "0").replace(/0+$/, "");
  if (!fraction) return whole.toString();
  if (fraction.length === 1) fraction += "0";
  return `${whole}.${fraction}`;
}

function normalizeDisplay(value) {
  return String(value ?? "").trim().replace(/^\$/, "").replace(/\s*USDC$/i, "");
}

export function pricesAgree(atomic, display) {
  const rendered = atomicToDisplay(atomic);
  return rendered !== null && rendered === normalizeDisplay(display);
}

function validPayTo(value) {
  return /^0x[0-9a-fA-F]{40}$/.test(String(value || ""));
}

function envelope({ command, feature, evidence, error, boundary, result, status }) {
  const passed = status === "pass" && evidence.every((item) => item.assertionPassed) && !error;
  const resolvedStatus = passed ? "pass" : (status === "pass" ? "fail" : status);
  return {
    ok: passed,
    schemaVersion: 1,
    command,
    repo: REPO,
    checkedAt: new Date().toISOString(),
    node: nodeInfo(),
    dryRun: false,
    status: resolvedStatus,
    feature,
    evidence,
    error,
    boundary,
    result,
  };
}

function parseArgs(argv) {
  const positionals = [];
  const flags = { json: false, profile: "local", fixture: null, origin: DEFAULT_ORIGIN, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("-")) {
      if (!ALLOWED_FLAGS.has(token)) return { error: `unknown flag: ${token}` };
      if (token === "--json") flags.json = true;
      else if (token === "--help") flags.help = true;
      else if (token === "--profile" || token === "--fixture" || token === "--origin") {
        const value = argv[i + 1];
        if (!value || value.startsWith("-")) return { error: `missing value for ${token}` };
        i += 1;
        if (token === "--profile") {
          if (!PROFILES.has(value)) return { error: `invalid profile: ${value}` };
          flags.profile = value;
        } else if (token === "--fixture") flags.fixture = value;
        else flags.origin = value;
      }
      continue;
    }
    positionals.push(token);
  }
  return { positionals, flags };
}

function commandName(positionals) {
  if (positionals[0] === "mcp" && positionals[1] === "list") return "mcp list";
  if (positionals[0] === "mcp" && positionals[1] === "absent") return "mcp absent";
  if (positionals[0] === "catalog" && positionals[1] === "check") return "catalog check";
  if (positionals[0] === "journey") return `journey ${positionals[1] || ""}`.trim();
  return positionals[0] || "";
}

function usage() {
  return [
    "tools/verify/cli.mjs <command> [--profile local|archive|hosted-unpaid] [--json]",
    "commands: discover | mcp list | challenge | mcp absent | catalog check | journey <id> | self-test",
    "local fixtures: " + Object.keys(LOCAL_FIXTURES).join(", "),
  ].join("\n");
}

function parseSseOrJson(text) {
  const dataLines = String(text || "").split(/\r?\n/).filter((line) => line.startsWith("data:"));
  const raw = dataLines.length ? dataLines.at(-1).replace(/^data:\s?/, "") : text;
  return JSON.parse(raw);
}

function challengeFromResponse(status, headers, text) {
  const encoded = headers.get("payment-required");
  if (encoded) return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  if (status === 402) return JSON.parse(text);
  return null;
}

async function fetchUnpaid(url, init = {}) {
  const response = await fetch(url, {
    method: init.method || "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(20000),
    headers: {
      accept: "application/json",
      "user-agent": "samedaydesk-mer-verify/1",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers || {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, headers: response.headers, text };
}

function routeUrl(origin, route) {
  const url = new URL(route.path, origin);
  if (route.query) {
    for (const [key, value] of Object.entries(route.query)) url.searchParams.set(key, value);
  }
  return url;
}

function resourceMatches(resourceUrl, requestedUrl) {
  const resource = new URL(resourceUrl);
  const requested = new URL(requestedUrl);
  if (resource.href === requested.href) return true;
  return resource.hostname === CANONICAL_HOST
    && resource.pathname === requested.pathname
    && resource.search === requested.search;
}

async function readChallenge(origin, route) {
  const url = routeUrl(origin, route);
  const response = await fetchUnpaid(url, { method: route.method, body: route.body });
  const challenge = challengeFromResponse(response.status, response.headers, response.text);
  const amount = challenge?.accepts?.[0]?.amount ?? null;
  const payTo = challenge?.accepts?.[0]?.payTo ?? null;
  const resourceUrl = challenge?.resource?.url ?? null;
  return {
    status: response.status,
    amount: amount === null ? null : String(amount),
    payTo,
    resourceUrl,
    requestedUrl: url.href,
    wwwAuthenticate: response.headers.get("www-authenticate"),
  };
}

function toolAmount(tool) {
  const meta = tool?._meta || {};
  const accepts = meta?.x402?.accepts || meta?.["x402/payment"]?.accepts;
  const amount = Array.isArray(accepts) ? accepts[0]?.amount : null;
  return amount === undefined || amount === null ? null : String(amount);
}

function mcpToolNameForRoute(route) {
  if (route === "/extract/batch") return "extract_batch";
  const segment = String(route || "").split("/").filter(Boolean).at(-1) || "";
  return segment.replaceAll("-", "_");
}

async function postMcp(origin, body, extraHeaders = {}) {
  const response = await fetch(new URL("/mcp", origin), {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(20000),
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "user-agent": "samedaydesk-mer-verify/1",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? parseSseOrJson(text) : null;
  } catch {
    payload = null;
  }
  return { status: response.status, headers: response.headers, payload, text };
}

async function mcpSession(origin) {
  const initialized = await postMcp(origin, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "samedaydesk-mer-verify", version: "1" },
    },
  });
  const session = initialized.headers.get("mcp-session-id");
  const extra = session ? { "mcp-session-id": session } : {};
  if (!initialized.payload?.result) {
    const error = new Error("mcp initialize did not return a result");
    error.code = "evidence-unavailable";
    throw error;
  }
  const listed = await postMcp(origin, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, extra);
  const tools = listed.payload?.result?.tools;
  if (!Array.isArray(tools)) {
    const error = new Error("mcp tools/list did not return tools");
    error.code = "evidence-unavailable";
    throw error;
  }
  return { extra, tools, protocol: initialized.payload.result.protocolVersion || null };
}

function evaluateFixture(fixture) {
  if (fixture.kind === "amount") {
    return [evidenceItem(
      "amount",
      true,
      fixture.observedAmount,
      fixture.expectedAmount,
      "402 atomic amount must match the expected amount",
    )];
  }
  if (fixture.kind === "payto") {
    return [evidenceItem(
      "payTo",
      true,
      validPayTo(fixture.payTo),
      true,
      "payTo must be a 42-character 0x address",
    )];
  }
  if (fixture.kind === "price-surface") {
    return [evidenceItem(
      "price-surface",
      true,
      pricesAgree(fixture.manifestAtomic, fixture.openapiDisplay),
      true,
      "manifest atomic units must equal the OpenAPI display price",
    )];
  }
  if (fixture.kind === "canonical-host") {
    return [evidenceItem(
      "canonical-host",
      true,
      fixture.canonicalHost,
      CANONICAL_HOST,
      "the Railway default domain is an alias, not the canonical host",
    )];
  }
  if (fixture.kind === "settle") {
    return [evidenceItem(
      "settle",
      true,
      fixture.requested ? "settlement-requested" : "not-requested",
      "not-requested",
      "the checker refuses to settle",
    )];
  }
  if (fixture.kind === "healthz-batch") {
    const observed = fixture.healthzPrices?.["extract/batch"];
    const normalized = observed === undefined || observed === null ? null : String(observed);
    return [evidenceItem(
      "healthz-extract-batch",
      true,
      normalized,
      String(fixture.manifestAtomic),
      "healthz prices.extract/batch must be the manifest atomic amount",
    )];
  }
  if (fixture.kind === "counterexample") {
    const observed = counterexampleObserved(fixture);
    return [evidenceItem(
      fixture.case,
      true,
      observed,
      { ...observed, defect: false },
      "this difference is not a defect",
    )];
  }
  throw new Error(`unknown fixture kind: ${fixture.kind}`);
}

function counterexampleObserved(fixture) {
  if (fixture.case === "bazaar-sample") {
    return {
      defect: false,
      reason: "fixed-sample-is-not-request-evidence",
      sampleInput: fixture.sampleInput,
      requestUrl: fixture.requestUrl,
      differs: fixture.sampleInput !== fixture.requestUrl,
    };
  }
  if (fixture.case === "a2a-redirect") {
    return {
      defect: false,
      reason: "apex-card-may-redirect-to-gateway",
      from: fixture.from,
      to: fixture.to,
    };
  }
  if (fixture.case === "zero-charge-write") {
    return {
      defect: fixture.charged !== false,
      reason: "truthful-zero-charge-on-a-writing-op",
      method: fixture.method,
      route: fixture.route,
      charged: fixture.charged,
      writesBrief: fixture.writesBrief,
    };
  }
  if (fixture.case === "range-vs-fixed") {
    const [low, high] = fixture.rangeUsd;
    const inside = fixture.fixedOfferUsd >= low && fixture.fixedOfferUsd <= high;
    return {
      defect: !inside,
      reason: "range-and-fixed-offer-are-different-scopes",
      rangeUsd: fixture.rangeUsd,
      fixedOfferUsd: fixture.fixedOfferUsd,
    };
  }
  if (fixture.case === "stripe-human") {
    return {
      defect: fixture.x402 !== null,
      reason: "human-stripe-checkout-has-no-x402-object",
      checkout: fixture.checkout,
      x402: fixture.x402,
    };
  }
  if (fixture.case === "railway-alias") {
    return {
      defect: fixture.canonicalHost !== CANONICAL_HOST,
      reason: "alias-is-not-rewritten-into-the-canonical-host",
      canonicalHost: fixture.canonicalHost,
      aliasHost: fixture.aliasHost,
    };
  }
  throw new Error(`unknown counterexample: ${fixture.case}`);
}

async function runLocalFixture(name) {
  const fixture = LOCAL_FIXTURES[name];
  if (!fixture) {
    const error = new Error(`unknown fixture: ${name}`);
    error.code = "bad-invocation";
    throw error;
  }
  return evaluateFixture(fixture);
}

async function runArchive() {
  let raw;
  try {
    raw = await readFile(ARCHIVE_PATH, "utf8");
  } catch {
    const error = new Error(`archive missing: ${ARCHIVE_PATH}`);
    error.code = "evidence-unavailable";
    throw error;
  }
  const archive = JSON.parse(raw);
  const byId = new Map((archive.routes || []).map((route) => [route.id, route]));
  const evidence = [];
  for (const route of [SECOND_EXTRACT, ...FOUR_ROUTES]) {
    const saved = byId.get(route.id);
    evidence.push(evidenceItem(
      route.id,
      Boolean(saved),
      saved ? { amount: String(saved.amount), host: new URL(saved.resourceUrl).hostname } : null,
      { amount: route.amount, host: CANONICAL_HOST },
      "archived unpaid route must keep the canonical host and amount",
    ));
  }
  return evidence;
}

async function runDiscover(origin) {
  const evidence = [];
  for (const route of [FOUR_ROUTES[0], SECOND_EXTRACT]) {
    const live = await readChallenge(origin, route);
    evidence.push(evidenceItem(
      `${route.id}-amount`,
      live.status === 402 && live.amount !== null,
      live.amount,
      route.amount,
      "unpaid 402 atomic amount",
    ));
    evidence.push(evidenceItem(
      `${route.id}-resource`,
      live.status === 402 && Boolean(live.resourceUrl),
      live.resourceUrl ? resourceMatches(live.resourceUrl, live.requestedUrl) : false,
      true,
      "resource URL matches the unpaid request or the canonical host with the same path and query",
    ));
    evidence.push(evidenceItem(
      `${route.id}-payTo`,
      live.status === 402,
      validPayTo(live.payTo),
      true,
      "payTo is a 42-character address",
    ));
  }
  return evidence;
}

async function runChallenge(origin) {
  const evidence = [];
  for (const route of FOUR_ROUTES) {
    const live = await readChallenge(origin, route);
    evidence.push(evidenceItem(
      `${route.id}-amount`,
      live.status === 402 && live.amount !== null,
      { status: live.status, amount: live.amount, host: live.resourceUrl ? new URL(live.resourceUrl).hostname : null },
      { status: 402, amount: route.amount, host: CANONICAL_HOST },
      "canonical bazaar route unpaid read matches production amount and canonical host",
    ));
  }
  return evidence;
}

async function runMcpList(origin) {
  const session = await mcpSession(origin);
  const manifestResponse = await fetchUnpaid(new URL("/.well-known/x402", origin).href);
  if (manifestResponse.status !== 200) {
    const error = new Error(`manifest HTTP ${manifestResponse.status}`);
    error.code = "evidence-unavailable";
    throw error;
  }
  const manifest = JSON.parse(manifestResponse.text);
  const items = Array.isArray(manifest.items) ? manifest.items : [];
  const payable = items.filter((item) => !String(item?.resource?.url || "").includes("/gateway/"));
  const toolsByName = new Map(session.tools.map((tool) => [tool.name, tool]));
  const evidence = [];
  for (const item of payable) {
    const route = new URL(item.resource.url).pathname;
    const name = mcpToolNameForRoute(route);
    const tool = toolsByName.get(name);
    const manifestAmount = item.accepts?.[0]?.amount == null ? null : String(item.accepts[0].amount);
    evidence.push(evidenceItem(
      `tool-${name}`,
      Boolean(tool) && manifestAmount !== null && toolAmount(tool) !== null,
      toolAmount(tool),
      manifestAmount,
      "tools/list amount matches the manifest",
    ));
  }
  const paidNames = new Set(payable.map((item) => mcpToolNameForRoute(new URL(item.resource.url).pathname)));
  const extraPaid = session.tools
    .filter((tool) => toolAmount(tool) !== null && !paidNames.has(tool.name))
    .map((tool) => tool.name);
  evidence.push(evidenceItem(
    "paid-tool-count",
    true,
    extraPaid.length === 0 ? paidNames.size : extraPaid,
    new URL(origin).hostname === CANONICAL_HOST ? 24 : paidNames.size,
    "canonical host lists 24 paid MCP amounts; a free tool is not a paid amount",
  ));
  return evidence;
}

async function runMcpAbsent(origin) {
  const session = await mcpSession(origin);
  const called = await postMcp(origin, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: ABSENT_TOOL, arguments: {} },
  }, session.extra);
  const code = called.payload?.error?.code ?? null;
  const hasToolResult = Boolean(called.payload?.result);
  const www = called.headers.get("www-authenticate");
  return [
    evidenceItem("listed-before-call", session.tools.length > 0, true, true, "tools/list ran before tools/call"),
    evidenceItem("jsonrpc-code", called.payload !== null, code, -32602, "unknown tool is JSON-RPC -32602"),
    evidenceItem("not-tool-result", called.payload !== null, hasToolResult, false, "unknown tool is not a tool-execution result"),
    evidenceItem("no-www-authenticate", true, www, null, "unknown tool does not advertise a payment challenge"),
  ];
}

function openApiDisplay(document, route) {
  const operation = document?.paths?.[route.path]?.[route.method.toLowerCase()];
  const amount = operation?.["x-payment-info"]?.price?.amount;
  return amount === undefined ? null : String(amount);
}

async function runCatalog(origin) {
  const [manifestResponse, openapiResponse, healthResponse, llmsResponse] = await Promise.all([
    fetchUnpaid(new URL("/.well-known/x402", origin).href),
    fetchUnpaid(new URL("/openapi.json", origin).href),
    fetchUnpaid(new URL("/healthz", origin).href),
    fetchUnpaid(new URL("/llms.txt", origin).href),
  ]);
  if ([manifestResponse, openapiResponse, healthResponse].some((item) => item.status !== 200)) {
    const error = new Error("catalog surfaces were not all readable");
    error.code = "evidence-unavailable";
    throw error;
  }
  const manifest = JSON.parse(manifestResponse.text);
  const openapi = JSON.parse(openapiResponse.text);
  const healthz = JSON.parse(healthResponse.text);
  const evidence = [];
  for (const route of FOUR_ROUTES) {
    const item = (manifest.items || []).find((entry) => {
      try {
        return new URL(entry.resource.url).pathname === route.path;
      } catch {
        return false;
      }
    });
    const atomic = item?.accepts?.[0]?.amount == null ? null : String(item.accepts[0].amount);
    const display = openApiDisplay(openapi, route);
    evidence.push(evidenceItem(
      `${route.id}-manifest-openapi`,
      atomic !== null && display !== null,
      display === null ? null : pricesAgree(atomic, display),
      true,
      "manifest atomic price agrees with OpenAPI display price",
    ));
    evidence.push(evidenceItem(
      `${route.id}-amount`,
      atomic !== null,
      atomic,
      route.amount,
      "manifest amount matches the canonical route",
    ));
  }
  const batchItem = (manifest.items || []).find((entry) => String(entry?.resource?.url || "").includes("/extract/batch"));
  const manifestBatch = batchItem?.accepts?.[0]?.amount == null ? null : String(batchItem.accepts[0].amount);
  const healthBatch = healthz?.prices?.["extract/batch"];
  evidence.push(evidenceItem(
    "healthz-extract-batch",
    manifestBatch !== null,
    healthBatch === undefined || healthBatch === null ? null : String(healthBatch),
    manifestBatch,
    "healthz prices.extract/batch is present and matches the manifest",
  ));
  const llmsHasFree = /POST \/recipes\/page-change \(charged: false\)/.test(llmsResponse.text || "");
  const openApiFree = openapi?.paths?.["/recipes/page-change"]?.post;
  const freeChargedConst = openApiFree?.responses?.["200"]?.content?.["application/json"]?.schema?.properties?.charged?.const;
  if (openApiFree || llmsHasFree) {
    evidence.push(evidenceItem(
      "page-change-free",
      true,
      {
        openapi: Boolean(openApiFree) && openApiFree["x-payment-info"] === undefined && freeChargedConst === false && !openApiFree.responses?.["402"],
        llmsChargedFalse: llmsHasFree,
        llmsPriced: /\/recipes\/page-change[^\n]*USDC/.test(llmsResponse.text || ""),
      },
      { openapi: true, llmsChargedFalse: true, llmsPriced: false },
      "page-change is free on every surface that lists it",
    ));
  }
  evidence.push(...await runMcpList(origin).catch((error) => {
    if (error.code === "evidence-unavailable") throw error;
    return [evidenceItem("mcp-list", false, String(error.message), "listed", "mcp list failed")];
  }));
  return evidence;
}

async function dispatch(command, flags) {
  const boundary = { paymentSent: false, toolsCalled: false, settled: false };
  if (flags.profile === "local") {
    if (command === "discover") return { evidence: await runLocalFixture("price-surface-ok"), boundary, result: { profile: "local" } };
    if (command === "challenge") return { evidence: await runArchive(), boundary, result: { profile: "local-archive-fallback" } };
    if (command === "catalog check") {
      const name = flags.fixture || "healthz-batch-ok";
      return { evidence: await runLocalFixture(name), boundary, result: { profile: "local", fixture: name } };
    }
    if (command === "mcp list" || command === "mcp absent") {
      const error = new Error(`${command} needs --profile hosted-unpaid or a local --origin`);
      error.code = "evidence-unavailable";
      throw error;
    }
  }
  if (flags.profile === "archive") {
    return { evidence: await runArchive(), boundary, result: { profile: "archive" } };
  }
  if (command === "discover") {
    return { evidence: await runDiscover(flags.origin), boundary, result: { profile: flags.profile, origin: flags.origin } };
  }
  if (command === "challenge") {
    return { evidence: await runChallenge(flags.origin), boundary, result: { profile: flags.profile, origin: flags.origin } };
  }
  if (command === "mcp list") {
    return { evidence: await runMcpList(flags.origin), boundary, result: { profile: flags.profile, origin: flags.origin } };
  }
  if (command === "mcp absent") {
    boundary.toolsCalled = true;
    return { evidence: await runMcpAbsent(flags.origin), boundary, result: { profile: flags.profile, origin: flags.origin, tool: ABSENT_TOOL } };
  }
  if (command === "catalog check") {
    if (flags.fixture && flags.profile !== "hosted-unpaid") {
      return { evidence: await runLocalFixture(flags.fixture), boundary, result: { fixture: flags.fixture } };
    }
    if (flags.fixture && LOCAL_FIXTURES[flags.fixture] && flags.profile === "local") {
      return { evidence: await runLocalFixture(flags.fixture), boundary, result: { fixture: flags.fixture } };
    }
    return { evidence: await runCatalog(flags.origin), boundary, result: { profile: flags.profile, origin: flags.origin } };
  }
  const error = new Error(`unknown command: ${command}`);
  error.code = "bad-invocation";
  throw error;
}

async function selfTest() {
  const evidence = [];
  const control = assertionPassed(true, { amount: "5001" }, { amount: "5000" });
  evidence.push(evidenceItem(
    "harness-control",
    true,
    control,
    false,
    "a mismatched observation must not pass",
  ));
  for (const name of Object.keys(LOCAL_FIXTURES)) {
    const items = evaluateFixture(LOCAL_FIXTURES[name]);
    const failed = items.some((item) => !item.assertionPassed);
    const expectFail = FAIL_FIXTURES.has(name);
    evidence.push(evidenceItem(
      `fixture-${name}`,
      true,
      failed,
      expectFail,
      expectFail ? "seeded failure must exit as a failure" : "counterexample or consistent fixture must pass",
    ));
  }
  evidence.push(...await runArchive());
  return evidence;
}

function exitCodeFor(status, error) {
  if (error?.code === "bad-invocation") return 2;
  if (error?.code === "evidence-unavailable") return 3;
  if (status === "error") return 64;
  if (status === "pass") return 0;
  return 1;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.error) {
    process.stderr.write(`${parsed.error}\n${usage()}\n`);
    if (process.argv.includes("--json")) {
      process.stdout.write(`${JSON.stringify(envelope({
        command: "invalid",
        feature: null,
        evidence: [],
        error: { code: "bad-invocation", message: parsed.error },
        boundary: { paymentSent: false, toolsCalled: false, settled: false },
        result: null,
        status: "error",
      }))}\n`);
    }
    process.exit(2);
  }
  const { positionals, flags } = parsed;
  if (flags.help || positionals.length === 0) {
    process.stderr.write(`${usage()}\n`);
    process.exit(flags.help ? 0 : 2);
  }
  const command = commandName(positionals);
  const known = new Set(["discover", "mcp list", "challenge", "mcp absent", "catalog check", "self-test"]);
  const journeyId = positionals[0] === "journey" ? positionals[1] : null;
  if (!known.has(command) && !journeyId) {
    process.stderr.write(`unknown command\n${usage()}\n`);
    process.exit(2);
  }
  if (positionals[0] === "journey" && !journeyId) {
    process.stderr.write("journey requires an id\n");
    process.exit(2);
  }
  const effective = journeyId === "discover" ? "discover"
    : journeyId === "mcp-list" ? "mcp list"
      : journeyId === "challenge" ? "challenge"
        : journeyId === "mcp-absent" ? "mcp absent"
          : journeyId === "catalog" ? "catalog check"
            : journeyId ? null : command;
  if (positionals[0] === "journey" && !effective) {
    process.stderr.write(`unknown journey: ${journeyId}\n`);
    process.exit(2);
  }
  let tempDir;
  let exitCode = 0;
  try {
    tempDir = await mkdtemp(path.join(tmpdir(), "mer-verify-"));
    const feature = effective;
    let evidence;
    let boundary = { paymentSent: false, toolsCalled: false, settled: false };
    let result = null;
    if (effective === "self-test") {
      evidence = await selfTest();
      result = { profile: flags.profile, harnessControl: "must-fail" };
    } else if (flags.profile === "local" && flags.fixture) {
      evidence = await runLocalFixture(flags.fixture);
      result = { profile: "local", fixture: flags.fixture };
    } else {
      const ran = await dispatch(effective, flags);
      evidence = ran.evidence;
      boundary = ran.boundary;
      result = ran.result;
    }
    const passed = evidence.every((item) => item.assertionPassed);
    const body = envelope({
      command: journeyId ? `journey ${journeyId}` : effective,
      feature,
      evidence,
      error: null,
      boundary,
      result,
      status: passed ? "pass" : "fail",
    });
    if (flags.json) process.stdout.write(`${JSON.stringify(body)}\n`);
    else process.stderr.write(`${body.status} ${body.command}\n`);
    exitCode = passed ? 0 : 1;
  } catch (error) {
    const code = error?.code === "bad-invocation" ? "bad-invocation"
      : error?.code === "evidence-unavailable" ? "evidence-unavailable"
        : "unexpected";
    const status = code === "unexpected" ? "error" : "fail";
    const body = envelope({
      command: effective || command,
      feature: effective,
      evidence: [],
      error: { code, message: String(error?.message || error) },
      boundary: { paymentSent: false, toolsCalled: false, settled: false },
      result: null,
      status,
    });
    if (flags.json) process.stdout.write(`${JSON.stringify(body)}\n`);
    else process.stderr.write(`${error?.stack || error}\n`);
    exitCode = exitCodeFor(status, { code: error?.code || "unexpected" });
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  }
  process.exit(exitCode);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
