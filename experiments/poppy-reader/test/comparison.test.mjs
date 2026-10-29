import assert from "node:assert/strict";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import test from "node:test";
import { gzipSync } from "node:zlib";

import { publicFetch } from "../../../extract-batch-c1/public-fetch.mjs";
import { createExtractionTrialBudget, READER_TRIAL_PATH, TRIAL_READ_MCP_TOOL } from "../../../extraction-trial.mjs";
import { fixture, NOW, waitFor } from "../../../extraction-trial-test-fixture.mjs";
import { createPoppyReaderAdapter } from "../src/adapter.mjs";
import { verifyBoundaryFixture, boundaryFixtureHeader } from "../src/boundary-fixture.mjs";
import { challengeTerms, decodePaymentRequiredHeader, readerFields } from "../src/compare.mjs";
import {
  DEFAULT_ISSUER,
  DEFAULT_ORIGIN,
  PAID_READ_GUARD_PATH,
  TRIAL_READ_PATH,
} from "../src/constants.mjs";
import { listen, rawRequest } from "./support.mjs";

const PAYMENT = Buffer.from(JSON.stringify({ x402Version: 2, payload: { kind: "fixture" } }), "utf8").toString("base64");

function sessionHeader(path, method) {
  return boundaryFixtureHeader({
    clientId: "https://client.lab.example/agent",
    sid: "sid-guest",
    sub: "guest-lab",
    htm: method,
    htu: `${DEFAULT_ORIGIN}${path}`,
    aud: DEFAULT_ISSUER,
  });
}

function installParentFetch(t, sourcePort) {
  const previousFetch = globalThis.__SAMEDAYDESK_EXTRACT_FETCH__;
  const previousTimeout = globalThis.__SAMEDAYDESK_EXTRACT_TIMEOUT_MS__;
  t.after(() => {
    globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = previousFetch;
    globalThis.__SAMEDAYDESK_EXTRACT_TIMEOUT_MS__ = previousTimeout;
  });
  globalThis.__SAMEDAYDESK_EXTRACT_TIMEOUT_MS__ = 300;
  globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = (input, init) => {
    const url = new URL(input);
    if (url.pathname === "/invalid-response") return { status: 200, headers: new Headers(), body: null };
    return publicFetch(input, init, {
      lookup: async (host) => [{ address: host === "private-dns.example" ? "127.0.0.1" : "93.184.216.34", family: 4 }],
      request(target, options, callback) {
        return httpRequest({ ...options, hostname: "127.0.0.1", port: sourcePort, path: target.pathname + target.search }, callback);
      },
    });
  };
}

function mcpCall(merchant, name, args) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  return new Promise((resolve, reject) => {
    const url = new URL(merchant.base);
    const req = httpRequest({
      hostname: url.hostname,
      port: url.port,
      path: "/mcp",
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "content-length": Buffer.byteLength(body),
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString();
        const line = text.split(/\r?\n/).filter((entry) => entry.startsWith("data:")).at(-1);
        let json = null;
        try {
          json = JSON.parse(line ? line.replace(/^data:\s?/, "") : text);
        } catch {
          json = null;
        }
        resolve({ status: response.statusCode, text, json });
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}

function mcpBody(message) {
  if (message?.result?.structuredContent) return message.result.structuredContent;
  return JSON.parse(message.result.content[0].text);
}

async function started(merchant) {
  return (await merchant.request("/.well-known/extraction-trial")).json.started ?? 0;
}

async function idle(merchant) {
  await waitFor(async () => (await merchant.request("/.well-known/extraction-trial")).json.availability !== "busy", "trial idle", 10000);
}

function sameTask(httpBody, otherBody, label) {
  assert.deepEqual(readerFields(otherBody), readerFields(httpBody), label);
}

async function startFacilitator() {
  const calls = { supported: 0, verify: 0, settle: 0 };
  const server = createHttpServer((req, res) => {
    if (req.method === "GET" && req.url === "/supported") calls.supported += 1;
    else if (req.method === "POST" && req.url === "/verify") calls.verify += 1;
    else if (req.method === "POST" && req.url === "/settle") calls.settle += 1;
    const status = req.url === "/supported" ? 200 : 500;
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({
      kinds: [{ network: "eip155:8453", scheme: "exact", x402Version: 2 }],
      extensions: [],
      signers: {},
    }));
  });
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  return {
    calls,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("direct HTTP, MCP, and the optional route share one reader task", { timeout: 180000 }, async (t) => {
  const f = await fixture(t);
  installParentFetch(t, Number(new URL(f.url("/x")).port));
  const store = await f.store();
  const merchant = await f.start({ store });
  const budget = createExtractionTrialBudget({ enabled: true, dir: store, now: () => NOW });
  const facilitator = await startFacilitator();
  t.after(() => facilitator.close());
  const reached = { count: 0 };
  const adapter = createPoppyReaderAdapter({
    verifier: async (input) => {
      if (input.header === "injected-signed-in") {
        if (input.authorization !== "Bearer injected-test-token") return { ok: false, error: "invalid_session" };
        return {
          ok: true,
          session: {
            clientId: "https://client.lab.example/agent",
            sid: "sid-signed",
            sub: "user-lab",
            agentId: "agent-lab",
            signedIn: true,
            htm: input.method,
            htu: input.url,
            aud: input.issuer,
          },
        };
      }
      return verifyBoundaryFixture(input);
    },
    budget,
    facilitatorUrl: facilitator.url,
    now: () => NOW,
    onPaidHandler: () => { reached.count += 1; },
  });
  const server = await listen(adapter.app);
  t.after(() => server.close());

  async function adapterRead(url, { limit, header, method = "POST", target = TRIAL_READ_PATH, raw, query = "" } = {}) {
    return rawRequest(server.base, `${target}${query}`, {
      method,
      raw,
      body: raw === undefined && method !== "GET" ? { url, ...(limit === undefined ? {} : { markdownLimitChars: limit }) } : undefined,
      headers: header === undefined ? { "poppy-session": sessionHeader(target, method) } : header,
    });
  }

  assert.equal(await started(merchant), 0);
  const callsBeforeMalformed = f.sourceCalls.length;

  const extraHttp = await merchant.request(`${READER_TRIAL_PATH}?spare=1`, { method: "POST", body: { url: f.url("/table"), extra: true } });
  const extraAdapter = await adapterRead(f.url("/table"), { query: "?spare=1", raw: JSON.stringify({ url: f.url("/table"), extra: true }) });
  assert.equal(extraHttp.status, 400);
  assert.deepEqual(extraAdapter.json, extraHttp.json);
  const extraMcp = await mcpCall(merchant, TRIAL_READ_MCP_TOOL, { url: f.url("/table"), extra: true });
  assert.equal(extraMcp.json.result.isError, true);
  assert.match(extraMcp.json.result.content[0].text, /Invalid arguments for tool trial_read/);

  for (const [name, body] of [
    ["bad-url", { url: "not a url" }],
    ["private-url", { url: "http://127.0.0.1/secret" }],
    ["ftp", { url: "ftp://example.com/a" }],
  ]) {
    const http = await merchant.request(READER_TRIAL_PATH, { method: "POST", body });
    const viaAdapter = await adapterRead(body.url, { raw: JSON.stringify(body) });
    assert.deepEqual(viaAdapter.json, http.json, name);
    assert.equal(http.status, 400, name);
    const viaMcp = await mcpCall(merchant, TRIAL_READ_MCP_TOOL, body);
    assert.equal(viaMcp.json.result.isError, true, name);
    assert.deepEqual(mcpBody(viaMcp.json), { ok: false, charged: false, error: "invalid_trial_input" }, name);
  }
  const badLimitBody = { url: f.url("/table"), markdownLimitChars: 0 };
  const badLimitHttp = await merchant.request(READER_TRIAL_PATH, { method: "POST", body: badLimitBody });
  const badLimitAdapter = await adapterRead(badLimitBody.url, { raw: JSON.stringify(badLimitBody) });
  assert.deepEqual(badLimitAdapter.json, badLimitHttp.json);
  assert.equal(badLimitHttp.json.error, "invalid_trial_input");
  const badLimitMcp = await mcpCall(merchant, TRIAL_READ_MCP_TOOL, badLimitBody);
  assert.equal(badLimitMcp.json.result.isError, true);
  assert.match(badLimitMcp.json.result.content[0].text, /Invalid arguments for tool trial_read/);

  const methodHttp = await merchant.request(READER_TRIAL_PATH, { method: "GET" });
  const methodAdapter = await adapterRead(undefined, { method: "GET", header: { "poppy-session": sessionHeader(TRIAL_READ_PATH, "GET") } });
  assert.equal(methodHttp.status, 405);
  assert.equal(methodAdapter.status, 405);
  assert.equal(methodAdapter.json.error, "method_not_allowed");
  assert.equal(methodHttp.json.error, "method_not_allowed");
  const missingSession = await rawRequest(server.base, TRIAL_READ_PATH, { method: "POST", raw: "{" });
  assert.deepEqual(missingSession.json, { error: "invalid_session" });
  const oversized = `{${"x".repeat(5000)}}`;
  const largeHttp = await merchant.request(READER_TRIAL_PATH, { method: "POST", raw: oversized });
  const largeAdapter = await adapterRead(undefined, { raw: oversized });
  assert.equal(largeHttp.status, 413);
  assert.deepEqual(largeAdapter.json, largeHttp.json);
  const gzipBody = gzipSync(Buffer.from(JSON.stringify({ url: f.url("/table") })));
  const gzipHttp = await merchant.request(READER_TRIAL_PATH, { method: "POST", raw: gzipBody, headers: { "content-encoding": "gzip" } });
  const gzipAdapter = await rawRequest(server.base, TRIAL_READ_PATH, {
    method: "POST",
    raw: gzipBody,
    headers: { "content-encoding": "gzip", "poppy-session": sessionHeader(TRIAL_READ_PATH, "POST") },
  });
  assert.deepEqual(gzipAdapter.json, gzipHttp.json);
  assert.equal(gzipAdapter.status, gzipHttp.status);
  assert.equal(await started(merchant), 0);
  assert.equal(f.sourceCalls.length, callsBeforeMalformed);

  async function triple(target, { limit, hops } = {}) {
    const http = await merchant.request(READER_TRIAL_PATH, {
      method: "POST",
      body: { url: f.url(target), ...(limit === undefined ? {} : { markdownLimitChars: limit }) },
    });
    await idle(merchant);
    const viaMcp = await mcpCall(merchant, TRIAL_READ_MCP_TOOL, {
      url: f.url(target),
      ...(limit === undefined ? {} : { markdownLimitChars: limit }),
    });
    await idle(merchant);
    const viaAdapter = await adapterRead(f.url(target), { limit });
    await idle(merchant);
    const mcp = mcpBody(viaMcp.json);
    sameTask(http.json, viaAdapter.json, target);
    sameTask(http.json, mcp, `${target} mcp`);
    assert.equal(mcp.charged, false, target);
    if (http.json.ok === true) {
      assert.equal(Object.hasOwn(http.json, "charged"), false);
      assert.equal(Object.hasOwn(viaAdapter.json, "charged"), false);
      assert.equal(typeof http.json.fetchedAt, "string");
      assert.equal(typeof viaAdapter.json.fetchedAt, "string");
    }
    assert.equal(http.status, viaAdapter.status);
    return { http: http.json, adapter: viaAdapter.json, mcp, hops };
  }

  const beforeSpend = await started(merchant);
  const table = await triple("/table");
  assert.equal(table.http.ok, true);
  assert.match(table.http.markdown, /Engine/);
  assert.match(table.http.markdown, /Alpha/);
  assert.equal(table.http.truncated, false);
  const signed = await adapterRead(f.url("/table"), {
    header: { "poppy-session": "injected-signed-in", authorization: "Bearer injected-test-token" },
  });
  await idle(merchant);
  sameTask(table.http, signed.json, "signed-in");
  assert.equal(Object.hasOwn(signed.json, "charged"), false);
  assert.equal(signed.headers["payment-required"], undefined);
  const forwarded = f.sourceCalls.at(-1).headers;
  assert.equal(forwarded["poppy-session"], undefined);
  assert.equal(forwarded.authorization, undefined);
  assert.equal(forwarded["payment-signature"], undefined);

  const redirect = await triple("/redirect-ok");
  assert.equal(redirect.http.ok, true);
  assert.match(redirect.http.finalUrl, /\/chosen-final$/);
  const limited = await triple("/excerpt", { limit: 25 });
  assert.equal(limited.http.markdown.length, 25);
  assert.equal(limited.http.truncated, true);
  assert.equal(limited.http.capture.markdownLimitChars, 25);
  const blocked = await triple("/redirect-private");
  assert.equal(blocked.http.ok, false);
  assert.equal(blocked.http.error.code, "ssrf_blocked");
  assert.equal(Object.hasOwn(blocked.http, "charged"), false);
  assert.equal(blocked.mcp.charged, false);

  const overHttp = await merchant.request(READER_TRIAL_PATH, { method: "POST", body: { url: f.url("/oversize") } });
  await idle(merchant);
  const overAdapter = await adapterRead(f.url("/oversize"));
  await idle(merchant);
  sameTask(overHttp.json, overAdapter.json, "oversize");
  assert.equal(overHttp.json.ok, true);
  assert.equal(overHttp.json.capture.bodyTruncated, true);
  assert.equal(overHttp.json.truncated, true);
  assert.ok(overHttp.json.markdown.length <= 40000);

  const spent = await started(merchant);
  assert.equal(spent, beforeSpend + 4 + 6 + 3 + 3 + 2, `started ${spent}`);

  const sourceBeforePaid = f.sourceCalls.length;
  const publicUrl = "https://example.com/paid-guard-not-fetched";
  const merchantChallenge = await merchant.request(`/read?url=${encodeURIComponent(publicUrl)}`);
  const adapterChallenge = await rawRequest(server.base, `${PAID_READ_GUARD_PATH}?url=${encodeURIComponent(publicUrl)}`, {
    headers: {
      "poppy-session": sessionHeader(PAID_READ_GUARD_PATH, "GET"),
      host: "evil.example",
      "x-forwarded-proto": "http",
      "payment-signature": PAYMENT,
      "x-payment": PAYMENT,
    },
  });
  assert.equal(merchantChallenge.status, 402);
  assert.equal(adapterChallenge.status, 402, adapterChallenge.text);
  const merchantTerms = challengeTerms(decodePaymentRequiredHeader(merchantChallenge.headers["payment-required"]));
  const adapterTerms = challengeTerms(decodePaymentRequiredHeader(adapterChallenge.headers["payment-required"]));
  assert.ok(merchantTerms, JSON.stringify(merchantChallenge.headers));
  assert.ok(adapterTerms, adapterChallenge.text);
  assert.equal(adapterTerms.amount, merchantTerms.amount);
  assert.equal(adapterTerms.payTo, merchantTerms.payTo);
  assert.equal(adapterTerms.network, merchantTerms.network);
  assert.equal(adapterTerms.asset, merchantTerms.asset);
  assert.equal(adapterTerms.maxTimeoutSeconds, merchantTerms.maxTimeoutSeconds);
  assert.equal(adapterTerms.scheme, "exact");
  assert.equal(adapterTerms.x402Version, 2);
  assert.equal(adapterTerms.paymentIdentifierRequired, false);
  assert.equal(merchantTerms.paymentIdentifierRequired, false);
  assert.equal(adapterTerms.amount, "5000");
  assert.equal(adapterTerms.authorizationNonce, null);
  assert.equal(adapterTerms.resourceUrl, `${DEFAULT_ORIGIN}${PAID_READ_GUARD_PATH}`);
  assert.equal(adapterChallenge.json.markdown, undefined);
  assert.equal(adapterChallenge.text.includes("hello"), false);
  assert.equal(reached.count, 0);
  assert.equal(facilitator.calls.verify, 0);
  assert.equal(facilitator.calls.settle, 0);
  assert.ok(facilitator.calls.supported >= 1);
  assert.equal(f.calls.every((call) => call === "GET /supported"), true);

  const signedPaid = await rawRequest(server.base, `${PAID_READ_GUARD_PATH}?url=${encodeURIComponent(publicUrl)}`, {
    headers: {
      "poppy-session": "injected-signed-in",
      authorization: "Bearer injected-test-token",
      "payment-signature": PAYMENT,
    },
  });
  assert.equal(signedPaid.status, 402, signedPaid.text);
  assert.equal(signedPaid.json.markdown, undefined);
  assert.equal(facilitator.calls.verify, 0);
  assert.equal(facilitator.calls.settle, 0);

  const wrongTarget = await rawRequest(server.base, `${PAID_READ_GUARD_PATH}?url=${encodeURIComponent(publicUrl)}`, {
    headers: { "poppy-session": sessionHeader(TRIAL_READ_PATH, "POST") },
  });
  assert.deepEqual(wrongTarget.json, { error: "invalid_session" });
  assert.equal(wrongTarget.headers["payment-required"], undefined);
  const badPaid = await rawRequest(server.base, `${PAID_READ_GUARD_PATH}?url=${encodeURIComponent("http://127.0.0.1/secret")}`, {
    headers: { "poppy-session": sessionHeader(PAID_READ_GUARD_PATH, "GET") },
  });
  const badMerchant = await merchant.request(`/read?url=${encodeURIComponent("http://127.0.0.1/secret")}`);
  assert.equal(badPaid.status, 400);
  assert.deepEqual(badPaid.json, badMerchant.json);
  assert.equal(badPaid.headers["payment-required"], undefined);
  assert.equal(await started(merchant), spent);
  assert.equal(f.sourceCalls.length, sourceBeforePaid);
  assert.equal(reached.count, 0);

  await merchant.stop();
  const storeB = await f.store();
  const merchantB = await f.start({ store: storeB });
  const budgetB = createExtractionTrialBudget({ enabled: true, dir: storeB, now: () => NOW });
  const adapterB = createPoppyReaderAdapter({
    verifier: verifyBoundaryFixture,
    budget: budgetB,
    facilitatorUrl: facilitator.url,
    now: () => NOW,
  });
  const serverB = await listen(adapterB.app);
  t.after(() => serverB.close());
  const lostHttp = await merchantB.request(READER_TRIAL_PATH, { method: "POST", body: { url: f.url("/slow") } });
  assert.equal(lostHttp.status, 200);
  assert.equal(lostHttp.json.ok, false);
  assert.equal(lostHttp.json.error.code, "timeout");
  assert.equal(lostHttp.json.markdown, undefined);
  const lostAdapter = await rawRequest(serverB.base, TRIAL_READ_PATH, {
    method: "POST",
    body: { url: f.url("/slow") },
    headers: { "poppy-session": sessionHeader(TRIAL_READ_PATH, "POST") },
  });
  sameTask(lostHttp.json, lostAdapter.json, "lost");
  assert.equal(await started(merchantB), 2);
  const recoveredHttp = await merchantB.request(READER_TRIAL_PATH, { method: "POST", body: { url: f.url("/table") } });
  await idle(merchantB);
  const recoveredAdapter = await rawRequest(serverB.base, TRIAL_READ_PATH, {
    method: "POST",
    body: { url: f.url("/table") },
    headers: { "poppy-session": sessionHeader(TRIAL_READ_PATH, "POST") },
  });
  sameTask(recoveredHttp.json, recoveredAdapter.json, "recovered");
  sameTask(table.http, recoveredAdapter.json, "recovered matches first table");
  assert.equal(recoveredAdapter.json.ok, true);
  assert.equal(await started(merchantB), 4);
});
