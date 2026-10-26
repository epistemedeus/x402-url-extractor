import assert from "node:assert/strict";
import { readFile, readdir, chmod, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";
import { EventEmitter, once } from "node:events";
import { Readable } from "node:stream";
import { createServer } from "node:http";
import express from "express";
import { readMcpOutputSchema, extractMcpOutputSchema } from "./extract.mjs";
import { publicFetch } from "./extract-batch-c1/public-fetch.mjs";
import { createExtractionTrialBudget, mountExtractionTrial } from "./extraction-trial.mjs";
import { fixture, authority, NOW, waitFor } from "./extraction-trial-test-fixture.mjs";

const READ = "/trial/read", EXTRACT = "/trial/extract", DISCOVERY = "/.well-known/extraction-trial";
const status = async m => (await m.request(DISCOVERY)).json;
const post = (m, route, url, extra = {}) => m.request(route, { method: "POST", body: { url, ...extra } });
const ready = m => waitFor(async () => (await status(m)).availability !== "busy");
function unpaid(r) {
  assert.equal(r.headers["cache-control"], "no-store");
  for (const key of ["payment-required", "payment-response", "www-authenticate", "set-cookie"]) assert.equal(r.headers[key], undefined);
}

test("actual merchant reader preserves table meaning, failures, limits and recovery under the extraction budget", { timeout: 60000 }, async t => {
  const f = await fixture(t), store = await f.store();
  const m = await f.start({ store });
  const contract = (await status(m)).reader;
  assert.ok(contract, "canonical discovery must describe a reader operation");
  assert.equal(contract.request.path, READ);
  assert.equal(contract.request.method, "POST");
  assert.equal(contract.paidNextTask.path, "/read?url={encodedPublicUrl}");
  const request = { ...contract.request, body: { ...contract.request.body, url: f.url("/table") } };
  const table = await m.request(request.path, request);
  assert.equal(table.status, 200); unpaid(table);
  assert.equal(readMcpOutputSchema.safeParse(table.json).success, true, table.text);
  assert.match(table.json.markdown, /<th rowspan="2">Engine<\/th><th colspan="2">Support<\/th>/);
  assert.match(table.json.markdown, /<td>Alpha<\/td><td><\/td><td>Yes/);
  assert.match(table.json.markdown, new RegExp(`href="${f.url("/table")}#fn1"`));
  assert.match(table.json.markdown, /<span id="fn1">Preview<\/span>/);
  assert.equal(table.json.truncated, false); assert.equal(table.json.capture.textTruncated, false);
  await ready(m);
  const extracted = await post(m, EXTRACT, f.url());
  assert.equal(extractMcpOutputSchema.safeParse(extracted.json).success, true);
  assert.equal(extracted.json.capture.textExcerptLimitChars, 1200); unpaid(extracted); await ready(m);
  assert.equal((await status(m)).started, 2);
  const cases = [
    ["unsupported table", "/table-bad", {}, data => { assert.match(data.markdown, /Table omitted:/); assert.equal(data.truncated, true); }],
    ["bounded Markdown", "/excerpt", { markdownLimitChars: 25 }, data => { assert.equal(data.markdown.length, 25); assert.equal(data.capture.markdownLimitChars, 25); assert.equal(data.truncated, true); }],
    ["body cap", "/oversize", {}, data => { assert.equal(data.capture.bodyBytes, 3000000); assert.equal(data.capture.bodyTruncated, true); assert.equal(data.truncated, true); }],
    ["source HTTP refusal", "/refused", {}, data => { assert.equal(data.sourceOk, false); assert.equal(data.error.code, "http_403"); }],
    ["source HTTP error", "/error", {}, data => { assert.equal(data.sourceOk, false); assert.equal(data.error.code, "http_500"); }],
    ...[["timeout", "/slow", "timeout"], ["encoding", "/encoding", "unsupported_encoding"], ["invalid response", "/invalid-response", "invalid_response"], ["private redirect", "/redirect-private", "ssrf_blocked"]]
      .map(([name, target, code]) => [name, target, {}, data => { assert.equal(data.ok, false); assert.equal(data.error.code, code); assert.equal(data.capture.textExcerptLimitChars, null); assert.equal(data.capture.markdownLimitChars, 40000); }]),
  ];
  for (const [name, target, extra, check] of cases) await t.test(name, async () => {
    const r = await post(m, READ, f.url(target), extra); assert.equal(r.status, 200); unpaid(r); check(r.json); await ready(m);
  });
  const redirected = await post(m, READ, f.url("/redirect-ok"));
  assert.equal(redirected.json.requestedUrl, f.url("/redirect-ok"));
  assert.equal(redirected.json.finalUrl, f.url("/chosen-final")); await ready(m);
  const dns = await post(m, READ, "http://private-dns.example/dns");
  assert.equal(dns.json.error.code, "ssrf_blocked"); await ready(m);
  const recovered = await post(m, "/TRIAL/READ/", f.url("/table"));
  assert.equal(recovered.json.markdown, table.json.markdown); assert.equal(recovered.json.truncated, false); await ready(m);
  const rows = (await f.events(m)).filter(row => row.extractionTrialOutcome);
  assert.ok(rows.some(row => row.extractionTrialOperation === "read" && row.extractionTrialOutcome.outcome === "partial"));
  assert.ok(rows.some(row => row.extractionTrialOperation === "extract"));
  const view = (await m.request("/v0/commerce-demand.json")).json.extractionTrial;
  assert.equal(view.operations.populations.unattributed.extract.completed, 1);
  assert.equal(view.operations.populations.unattributed.read.failed, 7);
  assert.equal(view.usefulness, "unknown"); assert.equal(view.independentUse, "unknown");
  assert.doesNotMatch(JSON.stringify(rows), /caller.example|private-dns|Preview/);
  assert.ok(f.calls.every(call => call === "GET /supported"));
  await m.stop();
});

test("reader malformed input and unknown methods refuse before spend, then valid input recovers", { timeout: 30000 }, async t => {
  const f = await fixture(t), store = await f.store(), m = await f.start({ store });
  for (const value of [null, 0, -1, 1.5, 40001, "25", [], {}]) {
    const r = await post(m, READ, f.url(), { markdownLimitChars: value });
    assert.equal(r.status, 400, JSON.stringify(value)); unpaid(r);
  }
  for (const body of [{}, { url: "http://127.0.0.1/" }, { url: "https://u:p@example.com/" }, { url: f.url(), textExcerptLimitChars: 10 }, { url: f.url(), beforeFetch: true }]) {
    assert.equal((await m.request(READ, { method: "POST", body })).status, 400);
  }
  for (const [raw, expected] of [["{", 400], [JSON.stringify({ padding: "x".repeat(5000) }), 413]]) {
    assert.equal((await m.request(READ, { method: "POST", raw })).status, expected);
  }
  for (const method of ["GET", "HEAD", "PUT", "OPTIONS", "DELETE"]) {
    const r = await m.request(READ, { method }); assert.equal(r.status, 405); assert.equal(r.headers.allow, "POST"); unpaid(r);
  }
  assert.equal((await m.request(READ + "?markdownLimitChars=1", { method: "POST", body: { url: f.url() } })).status, 400);
  assert.equal((await m.request(READ, { method: "POST", raw: "fixture", headers: { "content-encoding": "gzip" } })).status, 400);
  assert.equal((await status(m)).started, 0); assert.equal(f.sourceCalls.length, 0);
  assert.equal((await post(m, READ, f.url(), { markdownLimitChars: 1 })).json.capture.markdownLimitChars, 1);
  await ready(m); assert.equal((await status(m)).started, 1); await m.stop();
});

test("read and extract share one global lease, interleaved durable hops and restart exhaustion", { timeout: 60000 }, async t => {
  const f = await fixture(t), store = await f.store(authority({ maxStarted: 4 }));
  const original = await readFile(path.join(store, "authority.json"));
  let m = await f.start({ store });
  for (const [firstRoute, secondRoute] of [[READ, EXTRACT], [EXTRACT, READ]]) {
    const unblock = f.block();
    try {
      const hops = f.sourceCalls.length, pending = post(m, firstRoute, f.url("/gate"));
      await waitFor(() => f.sourceCalls.length === hops + 1);
      const r = await post(m, secondRoute, f.url());
      assert.equal(r.status, 503); assert.equal(r.json.availability, "busy");
      assert.equal(f.sourceCalls.length, hops + 1); unblock(); assert.equal((await pending).json.sourceOk, true); await ready(m);
    } finally { unblock(); }
  }
  const dataDir = m.data; await m.stop(); m = await f.start({ store, dataDir });
  assert.equal((await status(m)).started, 2);
  assert.equal((await post(m, READ, f.url())).json.sourceOk, true); await ready(m);
  const hops = f.sourceCalls.length;
  const last = await post(m, READ, f.url("/redirect-ok"));
  assert.equal(last.json.error.code, "trial_exhausted"); assert.equal(f.sourceCalls.length, hops + 1);
  await ready(m); await m.stop(); m = await f.start({ store, dataDir });
  for (const route of [READ, EXTRACT]) {
    const r = await post(m, route, f.url()); assert.equal(r.status, 503); assert.equal(r.json.availability, "exhausted");
  }
  assert.equal((await status(m)).started, 4); assert.equal(f.sourceCalls.length, hops + 1);
  assert.deepEqual(await readFile(path.join(store, "authority.json")), original);
  assert.equal((await readdir(store)).filter(name => name.startsWith("spent-")).length, 4);
  await m.stop();
});

test("reader preserves strict disabled, scheduled, expired, corrupt and abandoned-lease behavior", { timeout: 60000 }, async t => {
  const f = await fixture(t);
  const corrupt = await f.store(); await chmod(path.join(corrupt, "authority.json"), 0o600); await writeFile(path.join(corrupt, "authority.json"), "{");
  const busy = await f.store(); await mkdir(path.join(busy, ".active"));
  const cases = [
    [await f.store(), "disabled", false],
    [await f.store(authority({ startsAt: new Date(NOW + 1000).toISOString() })), "scheduled"],
    [await f.store(authority({ startsAt: new Date(NOW - 86400000).toISOString(), expiresAt: new Date(NOW - 1).toISOString() })), "expired"],
    [corrupt, "unavailable"], [path.join(f.scratch, "missing"), "unavailable"], [busy, "busy"],
  ];
  for (const [store, availability, enabled = true] of cases) {
    const m = await f.start({ store, enabled });
    const r = await post(m, READ, f.url()); assert.equal(r.status, 503); assert.equal(r.json.availability, availability); unpaid(r);
    await m.stop();
  }
  assert.equal(f.sourceCalls.length, 0);
});

test("mounted reader spends sealed starts before each DNS lookup and refuses uncertain persistence or mid-redirect expiry", async t => {
  const f = await fixture(t);
  const previous = globalThis.__SAMEDAYDESK_EXTRACT_FETCH__;
  t.after(() => { globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = previous; });
  for (const mode of ["redirect", "dns-refusal", "persistence-failure", "expiry"]) await t.test(mode, async () => {
    const store = await f.store();
    const raw = await readFile(path.join(store, "authority.json"));
    const seal = createHash("sha256").update(raw).digest("hex") + "\n";
    let clock = NOW, lookups = 0, requests = 0;
    const budget = createExtractionTrialBudget({ enabled: true, dir: store, now: () => clock });
    const app = express();
    mountExtractionTrial(app, { budget: { status: budget.status, async acquire() {
      const lease = await budget.acquire();
      // A disposable filesystem fault after lease acquisition must prevent DNS
      // and leave the uncertain lease closed. This never touches live authority.
      if (mode === "persistence-failure") await mkdir(path.join(store, "spent-01"));
      return lease;
    } } });
    globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = (url, init) => publicFetch(url, init, {
      async lookup() {
        lookups++;
        assert.equal((await budget.status()).started, lookups, "durable spend precedes DNS, including redirects");
        assert.equal(await readFile(path.join(store, `spent-0${lookups}`), "utf8"), seal);
        return [{ address: mode === "dns-refusal" ? "127.0.0.1" : "93.184.216.34", family: 4 }];
      },
      request(_url, _options, callback) {
        requests++;
        const req = new EventEmitter();
        req.end = () => {
          const body = Readable.from([Buffer.from("<p>fixture</p>")]);
          body.statusCode = requests === 1 ? 302 : 200;
          body.headers = requests === 1 ? { location: "/final" } : {};
          if (mode === "expiry") clock = Date.parse(authority().expiresAt);
          callback(body);
        };
        return req;
      },
    });
    const server = createServer(app); server.listen(0, "127.0.0.1"); await once(server, "listening");
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${READ}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://ordering.fixture.example/start" }),
      });
      const data = await response.json();
      if (mode === "redirect") {
        assert.equal(data.sourceOk, true, JSON.stringify(data)); assert.equal(lookups, 2); assert.equal(requests, 2);
      } else if (mode === "dns-refusal") {
        assert.equal(data.error.code, "ssrf_blocked"); assert.equal(lookups, 1); assert.equal(requests, 0);
      } else if (mode === "expiry") {
        assert.equal(data.error.code, "trial_expired"); assert.equal(lookups, 1); assert.equal(requests, 1);
        assert.equal((await budget.status()).availability, "expired");
      } else {
        assert.equal(response.status, 503); assert.equal(data.availability, "unavailable");
        assert.equal(lookups, 0); assert.equal(requests, 0);
        assert.ok((await readdir(store)).includes(".active"));
        const restarted = createExtractionTrialBudget({ enabled: true, dir: store, now: () => clock });
        await assert.rejects(restarted.acquire(), { code: "trial_unavailable" });
      }
      assert.deepEqual(await readFile(path.join(store, "authority.json")), raw);
    } finally {
      server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    }
  });
});
