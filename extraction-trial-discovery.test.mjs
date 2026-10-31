import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { getOpenAPI, isOpenApiParseFailure, checkL2ForOpenAPI } from "@agentcash/discovery";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { fixture, authority, NOW } from "./extraction-trial-test-fixture.mjs";
import { createExtractionTrialBudget } from "./extraction-trial.mjs";
import { AIAX_MAX_BYTES } from "./aiax-discovery/projection.mjs";
import { PLATFORM_HEALTH_CARDS } from "./platform-health.mjs";
import { FREE_PAGE_COMPARE_SKILL_ID, omitFreePageCompareAgentSkill, omitFreePageCompareLlmsSection } from "./page-change-free-surface.mjs";

const BASE = "c2aeb77a8546c1d8bb7b27473fc466b373538c72";
const origin = "https://agents.samedaydesk.com";
const guideLink = text => text.match(/Walletless extraction trial contract \(current availability, request and limits\): (https:\/\/[^\s]+)/)?.[1];
const entries = [
  ...["/openapi.json", "/openapi.yaml", "/swagger.json", "/mpp-openapi.json", "/openapi.mpp.json"].map(route => [route, r => r.json["x-service-info"].docs.extractionTrial]),
  ...["/.well-known/aiax.json", "/aiax/manifest.json", "/aiax/sections/extract.json"].map(route => [route, r => r.json.extensions.samedaydesk.extraction_trial_discovery]),
  ["/mcp", r => r.json.extractionTrial.discovery],
  ["/api/actions", r => r.json.discovery.extractionTrial],
  ...["/llms.txt", "/skill.md", "/SKILL.md"].map(route => [route, r => guideLink(r.text)]),
  ...["/.well-known/agent-card.json", "/.well-known/agent.json"].map(route => [route, r => guideLink(r.json.description)]),
  ["/", r => r.json.extractionTrial.discovery],
];
const ajv = addFormats(new Ajv2020({ strict: false, allErrors: true }));
const validate = {};
for (const kind of ["manifest", "section"]) validate[kind] = ajv.compile(JSON.parse(await readFile(new URL(`./aiax-discovery/fixtures/${kind}.schema.json`, import.meta.url))));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
async function stored(dir) {
  const found = {};
  for (const name of (await readdir(dir)).sort()) found[name] = hash(await readFile(path.join(dir, name)));
  return found;
}
function localPath(link) {
  assert.equal(typeof link, "string", "entry advertises a link");
  const url = new URL(link, origin);
  assert.equal(url.origin, origin); assert.equal(url.search, ""); assert.equal(url.hash, "");
  return url.pathname;
}
async function tools(merchant) {
  const client = new Client({ name: "root7650-offline", version: "1.0.0" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${merchant.base}/mcp`)));
    return await client.listTools();
  } finally { await client.close(); }
}

test("each machine entry discovers canonical trial request and truthful availability without work", { timeout: 60000 }, async t => {
  const f = await fixture(t);
  for (const availability of ["disabled", "enabled", "exhausted", "expired"]) await t.test(availability, async t => {
    const store = await f.store(authority(availability === "expired" ? { startsAt: new Date(NOW - 86400000).toISOString(), expiresAt: new Date(NOW - 1).toISOString() } : { maxStarted: 1 }));
    if (availability === "exhausted") {
      const budget = createExtractionTrialBudget({ enabled: true, dir: store, now: () => NOW });
      const lease = await budget.acquire(); await lease.spend(); await lease.release();
    }
    const merchant = await f.start({ store, enabled: availability !== "disabled" });
    const before = await stored(store), hops = f.sourceCalls.length, calls = f.calls.length;
    let constructed, constructedRead;
    for (const [entry, find] of entries) await t.test(entry, async () => {
      const response = await merchant.request(entry);
      assert.equal(response.status, 200, entry);
      const link = find(response);
      const discovery = await merchant.request(localPath(link));
      assert.equal(discovery.status, 200);
      assert.equal(discovery.headers["cache-control"], "no-store");
      const contract = discovery.json;
      assert.equal(contract.availability, availability);
      // Preserve the installed contract, including its status-schema spread.
      assert.equal(contract.schema, availability === "disabled" ? "samedaydesk.extraction-trial.v1" : "samedaydesk.extraction-trial-budget.v1");
      assert.equal(contract.request.method, "POST");
      assert.equal(contract.request.contentType, "application/json");
      assert.deepEqual(Object.keys(contract.request.body), ["url"]);
      assert.equal(new URL(contract.request.body.url).protocol, "https:");
      assert.equal(contract.limits.concurrency, 1); assert.equal(contract.limits.maxStarted, 20);
      assert.match(contract.accounting, /No per-caller credit or automatic renewal/);
      constructed = { path: contract.request.path, method: contract.request.method,
        headers: { "content-type": contract.request.contentType }, body: { ...contract.request.body, url: f.url() } };
      assert.equal(contract.reader.request.path, "/trial/read");
      assert.equal(contract.reader.markdownLimitChars.maximum, 40000);
      assert.match(contract.reader.sharedBudget, /same original authority/);
      assert.equal(contract.reader.paidNextTask.path, "/read?url={encodedPublicUrl}");
      constructedRead = { path: contract.reader.request.path, method: contract.reader.request.method,
        headers: { "content-type": contract.reader.request.contentType }, body: { ...contract.reader.request.body, url: f.url("/table") } };
      if (entry.includes("aiax")) {
        const kind = entry.includes("sections") ? "section" : "manifest";
        assert.equal(validate[kind](response.json), true, JSON.stringify(validate[kind].errors));
        assert.ok(Buffer.byteLength(response.text) <= AIAX_MAX_BYTES[kind]);
        assert.equal(response.headers["cache-control"], "public, max-age=300");
      }
    });
    assert.deepEqual(await stored(store), before, "all entry and contract GETs preserve authority bytes");
    assert.equal(f.sourceCalls.length, hops); assert.equal(f.calls.length, calls);
    // Execute only the request constructed from discovery, through disposable transport.
    const result = await merchant.request(constructedRead.path, constructedRead);
    assert.equal(result.status, availability === "enabled" ? 200 : 503);
    if (availability === "enabled") {
      assert.equal(result.json.sourceOk, true);
      assert.match(result.json.markdown, /<td>Alpha<\/td><td><\/td><td>Yes/);
      assert.equal(result.json.capture.markdownLimitChars, 40000);
      assert.equal(result.json.truncated, false);
    }
    else assert.equal(result.json.availability, availability);
    for (const header of ["payment-required", "www-authenticate", "payment-response"]) assert.equal(result.headers[header], undefined);
    assert.equal(f.sourceCalls.length, hops + (availability === "enabled" ? 1 : 0));
    const extractResult = await merchant.request(constructed.path, constructed);
    assert.equal(extractResult.status, 503);
    assert.equal(extractResult.json.availability, availability === "enabled" ? "exhausted" : availability);
    // Cached entry links still require a fresh contract after the allowance is spent.
    if (availability === "enabled") {
      const response = await merchant.request("/api/actions");
      const contract = await merchant.request(localPath(response.json.discovery.extractionTrial));
      assert.equal(contract.json.availability, "exhausted");
      assert.equal(contract.json.remaining, 0);
    }
    await merchant.stop();
  });
});

// Remove precisely the admitted pointer additions, then compare entire documents.
function withoutLink(route, response) {
  if (route === "/llms.txt") return omitFreePageCompareLlmsSection(response.text.replace(/^- Walletless extraction trial contract \(current availability, request and limits\): https:\/\/[^\n]+\n/m, ""));
  if (["/skill.md", "/SKILL.md"].includes(route)) return response.text.replace(/^- Walletless extraction trial contract \(current availability, request and limits\): https:\/\/[^\n]+\n/m, "");
  const value = structuredClone(response.json);
  if (route.includes("openapi") || route === "/swagger.json") delete value["x-service-info"].docs.extractionTrial;
  if (route === "/api/actions") delete value.discovery.extractionTrial;
  if (route === "/mcp") delete value.extractionTrial;
  if (route.includes("agent-card") || route === "/.well-known/agent.json") {
    value.description = value.description.replace(/ Walletless extraction trial contract.*$/, "");
    return omitFreePageCompareAgentSkill(value);
  }
  if (route.includes("aiax")) {
    if (route.includes("sections")) delete value.extensions.samedaydesk.extraction_trial_discovery;
    else {
      if (value.extensions) {
        assert.deepEqual(Object.keys(value.extensions), ["samedaydesk"]);
        assert.deepEqual(Object.keys(value.extensions.samedaydesk), ["extraction_trial_discovery"]);
        delete value.extensions;
      }
      delete value.updated_at;
    }
  }
  return value;
}

test("exact admitted base preserves paid documents, challenges, MCP tools and all emitted human assets", { timeout: 60000 }, async t => {
  const f = await fixture(t);
  async function capture(merchant, stripLinks = true) {
    const docs = {};
    for (const [entry] of entries) {
      const response = await merchant.request(entry);
      assert.equal(response.status, 200); docs[entry] = stripLinks ? withoutLink(entry, response) : response.json || response.text;
    }
    const challenge = await merchant.request("/extract?url=https%3A%2F%2Fexample.com%2F");
    assert.equal(challenge.status, 402);
    docs.challenge = { body: challenge.text, offer: challenge.headers["payment-required"], mpp: challenge.headers["www-authenticate"] };
    docs.tools = await tools(merchant);
    const human = {};
    for (const route of ["/", "/platforms", "/radar", "/platforms/methodology", "/alerts", ...PLATFORM_HEALTH_CARDS.map(card => `/platforms/${card.platform_id}`), "/favicon.ico", "/favicon.svg"]) {
      const response = await merchant.request(route, { headers: { accept: "text/html" } });
      human[route] = { status: response.status, body: response.text, type: response.headers["content-type"], location: response.headers.location };
    }
    docs.human = human;
    // trial_read is an additive MCP entry. Removing it restores the admitted tool order.
    if (docs["/mcp"]?.freeTools) docs["/mcp"].freeTools = docs["/mcp"].freeTools.filter((tool) => tool.name !== "trial_read");
    if (Array.isArray(docs.tools?.tools)) docs.tools.tools = docs.tools.tools.filter((tool) => tool.name !== "trial_read");
    return docs;
  }
  const base = await f.start({ sourceBase: BASE, enabled: false });
  const expected = await capture(base); await base.stop();
  const amended = await f.start({ enabled: false });
  const listed = await tools(amended);
  const trial = listed.tools.find((tool) => tool.name === "trial_read");
  assert.ok(trial, "current MCP lists trial_read");
  assert.equal(trial.annotations?.readOnlyHint, false);
  assert.equal(trial.annotations?.idempotentHint, false);
  assert.equal(trial.annotations?.destructiveHint, false);
  assert.equal(trial.annotations?.openWorldHint, true);
  assert.equal(trial._meta?.samedaydesk?.charged, false);
  assert.equal(trial._meta?.samedaydesk?.paymentRequired, false);
  assert.equal(trial._meta?.x402, undefined);
  assert.equal(trial.inputSchema.additionalProperties, false);
  assert.equal(trial.outputSchema.properties.charged.const, false);
  assert.match(trial.description, /charged is false/);
  assert.match(trial.description, /same original authority/);
  const descriptor = await amended.request("/mcp");
  const advertised = descriptor.json.freeTools.find((tool) => tool.name === "trial_read");
  assert.equal(advertised.charged, false);
  assert.equal(advertised.paymentRequired, false);
  assert.equal(advertised.consumesSharedTrialAllowance, true);
  assert.equal(advertised.discovery, descriptor.json.extractionTrial.discovery);
  const actual = await capture(amended);
  const fullActual = await capture(amended, false);
  for (const route of ["/openapi.json", "/mpp-openapi.json"]) await t.test(`official AgentCash parser ${route}`, async () => {
    const result = await getOpenAPI(amended.base, {}, undefined, `${amended.base}${route}`);
    assert.equal(result.isErr(), false);
    assert.ok(result.value);
    assert.equal(isOpenApiParseFailure(result.value), false);
    assert.ok(checkL2ForOpenAPI(result.value).routes.some(row => row.path === "/extract"));
  });
  await amended.stop();
  const measurementBase = "dbfd97a42e4fa629cdb028b12952075ca0573acf";
  const admitted = await f.start({ sourceBase: measurementBase, enabled: false });
  const fullExpected = await capture(admitted, false);
  await admitted.stop();
  await t.test("exact measurement base preserves all sixteen full entries, paid challenge, MCP tools and human bytes", () => {
    const comparable = structuredClone(fullActual);
    comparable["/llms.txt"] = omitFreePageCompareLlmsSection(comparable["/llms.txt"]);
    for (const route of ["/.well-known/agent-card.json", "/.well-known/agent.json"]) comparable[route] = omitFreePageCompareAgentSkill(comparable[route]);
    assert.deepEqual(comparable, fullExpected);
    assert.match(fullActual["/llms.txt"], /compare_page_observations/);
    assert.equal(fullActual["/.well-known/agent-card.json"].skills.some((skill) => skill.id === FREE_PAGE_COMPARE_SKILL_ID), true);
    assert.deepEqual(fullActual.human, fullExpected.human);
  });
  for (const [entry, value] of Object.entries(expected)) await t.test(entry, () => assert.deepEqual(actual[entry], value));
  assert.equal(Object.keys(actual.human).length, 12);
  assert.equal(f.sourceCalls.length, 0);
  assert.ok(f.calls.every(call => call === "GET /supported"));
  t.diagnostic(`Exact base ${BASE}; 10 HTML routes + 2 favicon outputs raw equal; human SHA256 ${hash(JSON.stringify(actual.human))}`);
});
