import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { collectBounded } from "../src/bounded-get.mjs";
import { findRepoFile } from "../src/locate.mjs";
import { measure } from "../src/measure.mjs";
import { PACKAGE, RECEIPT_RELATIVE, SOURCE } from "../src/pins.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const fullGet = JSON.parse(readFileSync(join(root, "fixtures/full-get-constructible.json"), "utf8"));
const cases = JSON.parse(readFileSync(join(root, "fixtures/cases.json"), "utf8"));
const service = "https://agents.samedaydesk.com/extract";

function response({ status = 200, body = "", headers = {} }) {
  return {
    status,
    headers: {
      get(name) {
        return headers[name.toLowerCase()] ?? null;
      },
    },
    async arrayBuffer() {
      return Buffer.from(body);
    },
  };
}

test("the public package names its version, license, and one provider", () => {
  assert.equal(PACKAGE.name, "task-discoverability");
  assert.equal(PACKAGE.version, "0.3.0");
  assert.equal(PACKAGE.license, "MIT");
  assert.equal(PACKAGE.schema, "pilot.task-discoverability.166000.v1");
  assert.equal(SOURCE.license, "Apache-2.0");
  assert.equal(SOURCE.globalMarket, undefined);
});

test("a supplied body stays offline and can construct a real request", async () => {
  let called = false;
  const document = await measure({
    serviceUrl: service,
    body: fullGet,
    fetchImpl: () => { called = true; },
  });
  assert.equal(called, false);
  assert.equal(document.ok, true);
  assert.equal(document.schema, PACKAGE.schema);
  assert.equal(document.provenance.kind, "supplied-body");
  assert.equal(document.provenance.officialLiveRead, false);
  assert.equal(document.provenance.networkSent, false);
  assert.equal(document.provenance.credentialSent, false);
  assert.equal(document.provider.globalMarket, false);
  assert.equal(document.provider.scope, "one-supported-provider");
  assert.equal(document.service.requestConstructible, true);
  assert.equal(document.rows[0].constructedRequest.query.url, "https://example.com");
  assert.equal(document.rows[0].invoked, false);
  assert.equal(document.rows[0].paid, false);
  assert.equal(document.rows[0].payment.amount, "5000");
  assert.equal(document.rows[0].payment.amountUnit, "atomic");
  assert.equal(document.rows[0].payment.moneyAmount, null);
  assert.equal(document.authenticBuyerEncounter, false);
  assert.equal(document.revenue, "unknown");
  assert.equal(document.buyer, "not-supplied");
  assert.equal(document.credentialSent, false);
  assert.equal(document.collector.globalDemand, "unknown");
  assert.equal(document.measurementRule, PACKAGE.measurementRule);
  assert.equal(document.provenance.pinnedRouteMatch, true);
  assert.match(document.nextAction, /does not invoke, pay/);
});

test("projected rows stay incomplete and a supplied receipt is not a live read", async () => {
  const projected = await measure({
    serviceUrl: service,
    body: cases.retainedSearch,
  });
  assert.equal(projected.rows[0].retention, "projection");
  assert.equal(projected.rows[0].applicationConstructible, "unknown");
  assert.equal(projected.service.requestConstructible, false);
  assert.equal(projected.coverage.declaredReturnedCount, 11);
  assert.equal(projected.coverage.inspectedCount, 2);
  assert.equal(projected.provenance.officialLiveRead, false);
});

test("blank identity, bad types, unsafe counts, and refs stay unconstructible", async () => {
  const blank = structuredClone(fullGet);
  for (const key of ["scheme", "network", "asset", "amount", "payTo"]) blank.resources[0].accepts[0][key] = "";
  const blankDoc = await measure({ serviceUrl: service, body: blank });
  assert.equal(blankDoc.rows[0].payment.state, "invalid");
  assert.equal(blankDoc.rows[0].requestConstructible, false);

  const wrong = structuredClone(fullGet);
  wrong.resources[0].extensions.bazaar.info.input.queryParams.url = 42;
  const wrongDoc = await measure({ serviceUrl: service, body: wrong });
  assert.equal(wrongDoc.rows[0].fieldsAvailable, true);
  assert.equal(wrongDoc.rows[0].valueSchemaValid, false);
  assert.equal(wrongDoc.rows[0].requestConstructible, false);

  const unsafe = structuredClone(fullGet);
  unsafe.resources[0].quality = { l30DaysTotalCalls: -1 };
  unsafe.itemCount = "9".repeat(52);
  const unsafeDoc = await measure({ serviceUrl: service, body: unsafe });
  assert.equal(unsafeDoc.rows[0].reportedCalls.state, "invalid");
  assert.equal(unsafeDoc.rows[0].reportedCalls.value, null);
  assert.equal(unsafeDoc.coverage.declaredReturnedCount, "invalid");
  assert.equal(unsafeDoc.coverage.measuredZero, false);

  const refDoc = await measure({ serviceUrl: service, body: cases.unresolvedRef });
  assert.equal(refDoc.rows[0].applicationConstructible, false);
  assert.equal(refDoc.rows[0].gaps.includes("unresolved-schema-ref:url"), true);
});

test("USD and USDC stay declared symbols and do not replace atomic text", async () => {
  const usdc = structuredClone(fullGet);
  usdc.resources[0].accepts[0].extra = { name: "USDC" };
  usdc.resources[0].accepts[0].amount = "123456789012345678901";
  const usdcDoc = await measure({ serviceUrl: service, body: usdc });
  assert.equal(usdcDoc.rows[0].payment.amount, "123456789012345678901");
  assert.equal(usdcDoc.rows[0].payment.declaredSymbol, "USDC");
  assert.equal(usdcDoc.rows[0].payment.moneyAmount, null);
  assert.equal(usdcDoc.rows[0].payment.moneyUnit, null);

  const usd = structuredClone(fullGet);
  usd.resources[0].accepts[0].extra = { name: "USD", quotedAmount: "1.50" };
  const usdDoc = await measure({ serviceUrl: service, body: usd });
  assert.equal(usdDoc.rows[0].payment.amount, "5000");
  assert.equal(usdDoc.rows[0].payment.declaredSymbol, "USD");
  assert.equal(usdDoc.rows[0].payment.moneyAmount, "1.50");
  assert.equal(usdDoc.rows[0].payment.moneyUnit, "USD");
  assert.equal(usdDoc.rows[0].payment.amount === usdDoc.rows[0].payment.moneyAmount, false);
});

test("known zero stays measured and a missing count stays unknown", async () => {
  const zero = await measure({
    serviceUrl: service,
    body: {
      status: 200,
      itemCount: "0",
      resources: [],
    },
  });
  assert.equal(zero.coverage.declaredReturnedCount, 0);
  assert.equal(zero.coverage.measuredZero, true);
  const unknown = await measure({
    serviceUrl: service,
    body: { status: 200, partialResults: false, url: `${SOURCE.searchUrl}?query=extract&type=http` },
  });
  assert.equal(unknown.coverage.declaredReturnedCount, "unknown");
  assert.equal(unknown.coverage.measuredZero, false);
});

test("collect sends nothing until the caller asks, then one bounded GET", async () => {
  let calls = 0;
  const idle = await collectBounded({ query: "a seller task", type: "http" }, {
    fetchImpl: () => { calls += 1; },
  });
  assert.equal(calls, 0);
  assert.equal(idle.networkSent, false);
  assert.equal(idle.reason, "live-query-not-requested");
  assert.equal(idle.url.includes("Extract+the+readable+text"), false);

  const missing = await collectBounded({}, { allowLive: true, fetchImpl: () => { calls += 1; } });
  assert.equal(calls, 0);
  assert.equal(missing.reason, "query-required");

  const blank = await collectBounded({ query: "task", payTo: "" }, {
    allowLive: true,
    fetchImpl: () => { calls += 1; },
  });
  assert.equal(calls, 0);
  assert.equal(blank.reason, "blank-filter:payTo");

  const foreign = await collectBounded({ query: "task" }, {
    allowLive: true,
    baseUrl: "https://example.invalid/discovery/search",
    fetchImpl: () => { calls += 1; },
  });
  assert.equal(calls, 0);
  assert.equal(foreign.reason, "unverified-search-route");

  const seen = [];
  const live = await collectBounded({ query: "one fresh seller task", type: "http", limit: 2 }, {
    allowLive: true,
    fetchImpl: (url, init) => {
      calls += 1;
      seen.push({ url, init });
      return response({
        body: JSON.stringify({
          partialResults: false,
          resources: [],
        }),
      });
    },
  });
  assert.equal(calls, 1);
  assert.equal(live.state, "supported");
  assert.equal(live.officialLiveRead, true);
  assert.equal(live.credentialSent, false);
  assert.equal(live.httpStatus, 200);
  assert.equal(typeof live.elapsedMs, "number");
  assert.equal(live.timeoutMs, 8000);
  assert.equal(live.maxBytes, 262144);
  assert.equal(seen[0].init.method, "GET");
  assert.equal(seen[0].init.headers.authorization, undefined);
  assert.equal(seen[0].init.headers.Authorization, undefined);
  assert.match(seen[0].url, /^https:\/\/api\.cdp\.coinbase\.com\/platform\/v2\/x402\/discovery\/search\?/);
  assert.equal(seen[0].url.includes("one+fresh+seller+task"), true);
  assert.equal(seen[0].url.includes("limit=2"), true);
});

test("bounded collect fails cleanly on redirect, HTTP, timeout, size, and schema", async () => {
  const redirect = await collectBounded({ query: "task" }, {
    allowLive: true,
    fetchImpl: () => response({ status: 302, headers: { location: "https://example.invalid/elsewhere" } }),
  });
  assert.equal(redirect.reason, "redirect-off-request");
  assert.equal(redirect.officialLiveRead, false);
  assert.equal(redirect.networkSent, true);

  const missing = await collectBounded({ query: "task" }, {
    allowLive: true,
    fetchImpl: () => response({ status: 404, body: "{}" }),
  });
  assert.equal(missing.state, "refused");
  assert.equal(missing.reason, "http-404");

  const timed = await collectBounded({ query: "task" }, {
    allowLive: true,
    timeoutMs: 20,
    fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      });
    }),
  });
  assert.equal(timed.reason, "timeout");
  assert.equal(timed.officialLiveRead, false);
  assert.equal(timed.credentialSent, false);

  const huge = await collectBounded({ query: "task" }, {
    allowLive: true,
    maxBytes: 8,
    fetchImpl: () => response({ body: "{\"resources\":[]}" }),
  });
  assert.equal(huge.state, "bounded");
  assert.equal(huge.reason, "body-cap");
  assert.equal(huge.bodyBound, "buffered-fallback");

  const bad = await collectBounded({ query: "task" }, {
    allowLive: true,
    fetchImpl: () => response({ body: "{" }),
  });
  assert.equal(bad.reason, "malformed-json");
});

test("an explicit collect result is official and does not call the service", async () => {
  const document = await measure({
    serviceUrl: "https://seller.example/extract",
    collect: true,
    query: "read one public page",
    type: "http",
    fetchImpl: () => response({
      body: JSON.stringify({
        partialResults: false,
        resources: [{
          resource: "https://seller.example/extract",
          accepts: [{
            scheme: "exact",
            network: "eip155:8453",
            asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            amount: "5000",
            payTo: "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee",
            extra: { name: "USDC" },
          }],
          extensions: fullGet.resources[0].extensions,
        }],
      }),
    }),
  });
  assert.equal(document.provenance.officialLiveRead, true);
  assert.equal(document.provenance.networkSent, true);
  assert.equal(document.provenance.credentialSent, false);
  assert.equal(document.provenance.httpStatus, 200);
  assert.equal(document.service.inInspectedRows, true);
  assert.equal(document.service.requestConstructible, true);
  assert.equal(document.rows[0].invoked, false);
  assert.equal(document.rows[0].paid, false);
  assert.equal(document.rows[0].payment.declaredSymbol, "USDC");
  assert.equal(document.rows[0].payment.amount, "5000");
});

test("a supplied 161000 receipt stays offline and keeps five inspected rows", (t) => {
  const receiptPath = process.env.PILOT_RECEIPT || findRepoFile(root, RECEIPT_RELATIVE);
  if (!receiptPath) {
    t.skip("receipt not supplied");
    return;
  }
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  let called = false;
  const document = measure({
    serviceUrl: service,
    body: receipt,
    fetchImpl: () => { called = true; },
  });
  return document.then((value) => {
    assert.equal(called, false);
    assert.equal(value.ok, true);
    assert.equal(value.provenance.kind, "supplied-receipt");
    assert.equal(value.provenance.officialLiveRead, false);
    assert.equal(value.provenance.networkSent, false);
    assert.equal(value.credentialSent, false);
    assert.equal(value.receiptCredentialSent, false);
    assert.equal(value.coverage.inspectedCount, 5);
    assert.equal(value.coverage.declaredReturnedCount, 11);
    assert.equal(value.coverage.uninspectedCount, 6);
    assert.equal(value.collector.declaredOursCount, 0);
    assert.equal(value.collector.globalDemand, "unknown");
    assert.equal(value.service.inInspectedRows, false);
    assert.equal(value.service.requestConstructible, false);
    assert.equal(value.filter.list.honored, "unknown");
    assert.equal(value.filter.list.reason, "page-unchanged-identity-unobserved");
    assert.equal(value.filter.list.pageUnchanged, true);
    assert.equal(value.filter.list.baselineTotal, 32247);
    assert.equal(value.filter.assumedHonored, false);
    assert.equal(value.readersCompleteSellerQuestion, false);
    assert.equal(value.revenue, "unknown");
    assert.match(value.nextAction, /Leave price, payee, and payment authority unchanged/);
  });
});

function trackedStream(chunks, observe) {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      observe.pulls += 1;
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      const chunk = chunks[index];
      index += 1;
      controller.enqueue(chunk);
    },
    cancel(reason) {
      observe.cancelled = true;
      observe.cancelReason = String(reason);
    },
  }, new CountQueuingStrategy({ highWaterMark: 0 }));
}

function nativeResponse({ status = 200, chunks, headers, observe }) {
  const stream = trackedStream(chunks, observe);
  const response = new Response(stream, { status, headers });
  let wholeBodyCalled = false;
  const wrapped = new Proxy(response, {
    get(target, prop, receiver) {
      if (prop === "arrayBuffer" || prop === "text") {
        return () => {
          wholeBodyCalled = true;
          const method = target[prop];
          return method.call(target);
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return {
    response: wrapped,
    wholeBodyCalled: () => wholeBodyCalled,
  };
}

test("a native stream stops at the cap and cancels the unread remainder", async () => {
  const observe = { pulls: 0, cancelled: false, cancelReason: null };
  const chunks = [Buffer.alloc(100, 0x61), Buffer.alloc(100, 0x62), Buffer.alloc(100, 0x63)];
  const made = nativeResponse({ chunks, observe });
  const result = await collectBounded({ query: "stream cap check" }, {
    allowLive: true,
    maxBytes: 150,
    fetchImpl: () => made.response,
  });
  assert.equal(result.state, "bounded");
  assert.equal(result.reason, "body-cap");
  assert.equal(result.bodyBound, "stream");
  assert.equal(result.officialLiveRead, false);
  assert.equal(result.bytes, 200);
  assert.equal(observe.pulls, 2);
  assert.equal(observe.cancelled, true);
  assert.equal(made.wholeBodyCalled(), false);
});

test("an exact byte cap is a supported stream read", async () => {
  const payload = Buffer.from('{"resources":[]}');
  const observe = { pulls: 0, cancelled: false, cancelReason: null };
  const made = nativeResponse({
    chunks: [payload.subarray(0, 8), payload.subarray(8)],
    observe,
  });
  const result = await collectBounded({ query: "exact cap" }, {
    allowLive: true,
    maxBytes: payload.byteLength,
    fetchImpl: () => made.response,
  });
  assert.equal(result.state, "supported");
  assert.equal(result.bodyBound, "stream");
  assert.equal(result.officialLiveRead, true);
  assert.equal(result.bytes, payload.byteLength);
  assert.equal(observe.cancelled, false);
  assert.equal(made.wholeBodyCalled(), false);
  assert.deepEqual(result.body.resources, []);
});

test("multibyte characters are counted as bytes", async () => {
  const text = '{"x":"é"}';
  const encoded = Buffer.from(text);
  assert.equal(text.length < encoded.byteLength, true);
  const overflow = { pulls: 0, cancelled: false, cancelReason: null };
  const over = nativeResponse({ chunks: [encoded], observe: overflow });
  const capped = await collectBounded({ query: "multibyte cap" }, {
    allowLive: true,
    maxBytes: text.length,
    fetchImpl: () => over.response,
  });
  assert.equal(capped.reason, "body-cap");
  assert.equal(capped.bodyBound, "stream");
  assert.equal(capped.bytes, encoded.byteLength);
  assert.equal(overflow.cancelled, true);
  const fit = { pulls: 0, cancelled: false, cancelReason: null };
  const exact = nativeResponse({ chunks: [encoded], observe: fit });
  const supported = await collectBounded({ query: "multibyte fit" }, {
    allowLive: true,
    maxBytes: encoded.byteLength,
    fetchImpl: () => exact.response,
  });
  assert.equal(supported.state, "supported");
  assert.equal(supported.bodyBound, "stream");
  assert.equal(supported.body.x, "é");
  assert.equal(fit.cancelled, false);
});

test("missing and false content-length do not replace the stream cap", async () => {
  const small = Buffer.from('{"resources":[]}');
  const missing = { pulls: 0, cancelled: false, cancelReason: null };
  const missingResponse = nativeResponse({
    chunks: [Buffer.alloc(80, 0x7b), Buffer.alloc(80, 0x7d)],
    observe: missing,
  });
  assert.equal(missingResponse.response.headers.get("content-length"), null);
  const missingCap = await collectBounded({ query: "missing length" }, {
    allowLive: true,
    maxBytes: 100,
    fetchImpl: () => missingResponse.response,
  });
  assert.equal(missingCap.reason, "body-cap");
  assert.equal(missingCap.bodyBound, "stream");
  assert.equal(missing.pulls, 2);
  assert.equal(missing.cancelled, true);

  const shortHeader = { pulls: 0, cancelled: false, cancelReason: null };
  const shortResponse = nativeResponse({
    chunks: [Buffer.alloc(40, 0x61), Buffer.alloc(40, 0x62)],
    headers: { "content-length": "1" },
    observe: shortHeader,
  });
  const shortCap = await collectBounded({ query: "false short length" }, {
    allowLive: true,
    maxBytes: 50,
    fetchImpl: () => shortResponse.response,
  });
  assert.equal(shortCap.reason, "body-cap");
  assert.equal(shortCap.bytes, 80);
  assert.equal(shortHeader.cancelled, true);

  const longHeader = { pulls: 0, cancelled: false, cancelReason: null };
  const longResponse = nativeResponse({
    chunks: [small],
    headers: { "content-length": "999999" },
    observe: longHeader,
  });
  const accepted = await collectBounded({ query: "false long length" }, {
    allowLive: true,
    maxBytes: small.byteLength,
    fetchImpl: () => longResponse.response,
  });
  assert.equal(accepted.state, "supported");
  assert.equal(accepted.bytes, small.byteLength);
  assert.equal(accepted.bodyBound, "stream");
  assert.notEqual(accepted.bytes, 999999);
});

test("a broken native stream is not an official read", async () => {
  const response = new Response(new ReadableStream({
    pull(controller) {
      controller.error(new Error("broken pipe"));
    },
  }), { status: 200 });
  const result = await collectBounded({ query: "broken stream" }, {
    allowLive: true,
    fetchImpl: () => response,
  });
  assert.equal(result.state, "unavailable");
  assert.equal(result.reason, "stream-failed");
  assert.equal(result.bodyBound, "stream");
  assert.equal(result.officialLiveRead, false);
  assert.equal(result.networkSent, true);
  assert.equal(result.credentialSent, false);
});

test("a stalled native stream times out and cancels", async () => {
  const observe = { pulls: 0, cancelled: false, cancelReason: null };
  const response = new Response(new ReadableStream({
    pull() {
      observe.pulls += 1;
      return new Promise(() => {});
    },
    cancel(reason) {
      observe.cancelled = true;
      observe.cancelReason = String(reason);
    },
  }), { status: 200 });
  const result = await collectBounded({ query: "stalled stream" }, {
    allowLive: true,
    timeoutMs: 30,
    fetchImpl: () => response,
  });
  assert.equal(result.reason, "timeout");
  assert.equal(result.bodyBound, "stream");
  assert.equal(result.officialLiveRead, false);
  assert.equal(observe.cancelled, true);
});

test("a native redirect cancels the body without reading it", async () => {
  const observe = { pulls: 0, cancelled: false, cancelReason: null };
  const made = nativeResponse({
    status: 302,
    chunks: [Buffer.alloc(1000, 0x78), Buffer.alloc(1000, 0x79)],
    headers: { location: "https://example.invalid/elsewhere" },
    observe,
  });
  const result = await collectBounded({ query: "redirect stream" }, {
    allowLive: true,
    fetchImpl: () => made.response,
  });
  assert.equal(result.reason, "redirect-off-request");
  assert.equal(result.officialLiveRead, false);
  assert.equal(result.networkSent, true);
  assert.equal(observe.pulls, 0);
  assert.equal(observe.cancelled, true);
  assert.equal(made.wholeBodyCalled(), false);
});

test("the CLI stays offline and fails closed without a service or a body", () => {
  const noInput = spawnSync(process.execPath, ["src/cli.mjs"], { cwd: root, encoding: "utf8" });
  assert.equal(noInput.status, 2);
  assert.match(noInput.stderr, /service-required/);
  const live = spawnSync(process.execPath, ["src/cli.mjs", "--live", "--service", service], { cwd: root, encoding: "utf8" });
  assert.equal(live.status, 2);
  assert.match(live.stderr, /live-query-refused/);
  const collect = spawnSync(process.execPath, ["src/cli.mjs", "--collect", "--service", service], { cwd: root, encoding: "utf8" });
  assert.equal(collect.status, 2);
  assert.match(collect.stderr, /query-required/);
});
