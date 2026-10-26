import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { createServer, request as httpRequest } from "node:http";
import { mkdir, readFile, readdir, writeFile, chmod, symlink } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import express from "express";
import { createCommerceTelemetry } from "./commerce-events.mjs";
import { extractMcpOutputSchema } from "./extract.mjs";
import { PLATFORM_HEALTH_CARDS } from "./platform-health.mjs";
import { createExtractionTrialBudget, EXTRACTION_TRIAL_PATH as ROUTE, EXTRACTION_TRIAL_DISCOVERY as DISCOVERY, mountExtractionTrial, provisionExtractionTrial } from "./extraction-trial.mjs";
import { fixture, authority, NOW, waitFor } from "./extraction-trial-test-fixture.mjs";

const hash = text => createHash("sha256").update(text).digest("hex");
const post = (merchant, url, extra = {}) => merchant.request(ROUTE, { method: "POST", body: { url }, ...extra });
const status = async merchant => (await merchant.request(DISCOVERY)).json;
async function paidDiscoveryBody(merchant) {
  const document = (await merchant.request("/openapi.json")).json;
  // The standard-machine amendment may add this one docs link; every existing
  // operation and all remaining document bytes must still match the old base.
  delete document["x-service-info"].docs.extractionTrial;
  return JSON.stringify(document);
}
async function ready(merchant, availability = "enabled") { await waitFor(async () => (await status(merchant)).availability === availability, availability); }
function unpaid(response) {
  for (const header of ["payment-required", "payment-response", "www-authenticate", "set-cookie", "x-samedaydesk-caller-result"]) assert.equal(response.headers[header], undefined, header);
}

test("mounted walletless trial preserves source semantics, paid boundaries and human emissions", { timeout: 180000 }, async t => {
  const f = await fixture(t);
  let baseline, before, paidDiscovery;
  async function retainEmissions(name, outputs) {
    const dir = process.env.ROOT7540_EMISSIONS_DIR;
    if (!dir) return;
    assert.ok(path.isAbsolute(dir));
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(path.join(dir, `${name}.json`), JSON.stringify({ schema: "root7540.emitted-human-outputs.v1", name, outputs }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  }
  const humanPaths = ["/", "/platforms", "/radar", "/platforms/methodology", "/alerts", ...PLATFORM_HEALTH_CARDS.map(card => `/platforms/${card.platform_id}`)];
  async function human(merchant) {
    const found = {};
    for (const target of humanPaths) {
      const response = await merchant.request(target, { headers: { accept: "text/html" } });
      assert.equal(response.status, 200, target);
      assert.match(response.headers["content-type"], /^text\/html/);
      found[target] = { body: response.text, type: response.headers["content-type"] };
    }
    for (const target of ["/favicon.ico", "/favicon.svg"]) {
      const response = await merchant.request(target);
      assert.equal(response.status, 302);
      found[target] = { status: response.status, body: response.text, location: response.headers.location, type: response.headers["content-type"] };
    }
    return found;
  }
  async function paid(merchant) {
    const response = await merchant.request("/extract?url=https%3A%2F%2Fexample.com%2F");
    assert.equal(response.status, 402);
    const challenge = JSON.parse(Buffer.from(response.headers["payment-required"], "base64").toString());
    assert.equal(challenge.accepts[0].amount, "5000");
    return { challenge, body: response.json };
  }
  await t.test("base emits all human pages and the ordinary exact paid challenge", async () => {
    const merchant = await f.start({ baseline: true, enabled: false });
    baseline = await human(merchant);
    await retainEmissions("before-base-fb88d0b5", baseline);
    before = await paid(merchant);
    paidDiscovery = await paidDiscoveryBody(merchant);
    await merchant.stop();
    assert.equal(f.sourceCalls.length, 0);
  });
  await t.test("default disabled discovery and refusal preserve emitted human bytes and paid terms", async () => {
    const merchant = await f.start({ enabled: null }); // no feature flag at all
    const discover = await status(merchant);
    assert.equal(discover.availability, "disabled");
    assert.equal(discover.request.method, "POST");
    assert.equal(discover.request.path, ROUTE);
    const response = await post(merchant, f.url());
    assert.equal(response.status, 503); assert.equal(response.json.availability, "disabled"); unpaid(response);
    assert.deepEqual(await paid(merchant), before);
    const disabledEmissions = await human(merchant);
    await retainEmissions("after-disabled", disabledEmissions);
    assert.deepEqual(disabledEmissions, baseline);
    assert.equal((await merchant.request("/")).json.extractionTrial.discovery, DISCOVERY);
    assert.equal(await paidDiscoveryBody(merchant), paidDiscovery);
    const view = (await merchant.request("/v0/commerce-demand.json")).json.extractionTrial;
    assert.ok(view.captureStartedAt); assert.equal(view.currentCapture.coverage, "prospective_process_only");
    assert.equal(view.populations.unattributed.refused, 1);
    assert.deepEqual(view.diagnostics.populations.unattributed.refused,
      { known: 1, unknown: 0, byReason: { "admission.disabled": 1 } });
    await merchant.stop();
    assert.equal(f.sourceCalls.length, 0);
  });
  const store = await f.store();
  const merchant = await f.start({ store });
  const callsBefore = f.calls.length;
  await t.test("caller-selected public URL returns the normal typed result without credentials, signer or facilitator", async () => {
    const url = f.url("/chosen-by-caller?private-query-marker=private-value-marker");
    const response = await post(merchant, url);
    assert.equal(response.status, 200); unpaid(response);
    assert.equal(extractMcpOutputSchema.safeParse(response.json).success, true, response.text);
    assert.equal(response.json.requestedUrl, url); assert.equal(response.json.finalUrl, url);
    assert.equal(response.json.title, "Caller-selected page"); assert.equal(response.json.sourceOk, true);
    assert.match(response.json.text, /chosen-by-caller/); assert.equal(response.json.capture.javascriptExecuted, false);
    assert.equal(response.json.capture.maxBodyBytes, 3_000_000); assert.equal(response.json.capture.textExcerptLimitChars, 1200);
    assert.equal(f.sourceCalls.at(-1).url, "/chosen-by-caller?private-query-marker=private-value-marker");
    await ready(merchant); assert.equal((await status(merchant)).started, 1);
    assert.deepEqual(f.calls.slice(callsBefore), []);
  });
  const invalidCases = [
    ["missing URL", {}], ["nonstring URL", { url: [f.url()] }], ["invalid URL", { url: "not-a-url" }],
    ["private literal", { url: "http://127.1/" }], ["private IPv6", { url: "http://[::1]/" }],
    ["private name", { url: "http://localhost/" }], ["credentials", { url: "https://user:password@example.com/" }],
    ["non-HTTP protocol", { url: "file:///etc/passwd" }], ["arbitrary fetch headers", { url: f.url(), headers: { authorization: "private-header-marker" } }],
    ["oversized excerpt", { url: f.url(), textExcerptLimitChars: 9999999 }], ["duplicate-shaped excerpt", { url: f.url(), textExcerptLimitChars: [] }],
  ];
  for (const [name, body] of invalidCases) await t.test(`local refusal before allowance or fetch: ${name}`, async () => {
    const started = (await status(merchant)).started, count = f.sourceCalls.length;
    const response = await merchant.request(ROUTE, { method: "POST", body });
    assert.equal(response.status, 400, response.text); unpaid(response);
    assert.equal((await status(merchant)).started, started); assert.equal(f.sourceCalls.length, count);
  });
  for (const [name, options, expected] of [
    ["malformed JSON", { raw: "{\"private-body-marker\":" }, 400],
    ["oversized JSON", { raw: JSON.stringify({ url: f.url(), padding: "x".repeat(5000) }) }, 413],
    ["compressed body", { raw: "private-compressed-marker", headers: { "content-encoding": "gzip" } }, 400],
  ]) await t.test(`mounted parser refusal: ${name}`, async () => {
    const response = await merchant.request(ROUTE, { method: "POST", ...options });
    assert.equal(response.status, expected); unpaid(response); assert.equal(response.json.error, "invalid_trial_body");
    assert.doesNotMatch(response.text, /private-.*marker/);
  });
  await t.test("query data and non-POST methods refuse without work", async () => {
    for (const method of ["GET", "HEAD", "PUT", "OPTIONS"]) {
      const response = await merchant.request(ROUTE, { method });
      assert.equal(response.status, 405); assert.equal(response.headers.allow, "POST"); unpaid(response);
    }
    const response = await merchant.request(ROUTE + "?private-key-marker=private-value-marker", { method: "POST", body: { url: f.url() } });
    assert.equal(response.status, 400); assert.equal((await status(merchant)).started, 1);
  });
  for (const [name, target, code, starts] of [
    ["private DNS answer", "http://private-dns.example/dns", "ssrf_blocked", 1],
    ["private redirect", f.url("/redirect-private"), "ssrf_blocked", 1],
    ["redirect limit", f.url("/redirect-loop"), "redirect_error", 4],
    ["timeout", f.url("/slow"), "timeout", 1],
    ["invalid streaming response", f.url("/invalid-response"), "invalid_response", 1],
  ]) await t.test(`admitted network failure consumes each attempted hop: ${name}`, async () => {
    const count = (await status(merchant)).started;
    const response = await post(merchant, target);
    assert.equal(response.status, 200); unpaid(response); assert.equal(response.json.ok, false);
    assert.equal(response.json.sourceOk, false); assert.equal(response.json.error.code, code);
    await ready(merchant); assert.equal((await status(merchant)).started, count + starts);
    assert.deepEqual((await f.events(merchant)).filter(row => row.extractionTrialOutcome?.outcome === "failed").at(-1).extractionTrialReason,
      { v: 1, family: "fetch", code });
  });
  await t.test("public redirects preserve requested/final identity and consume two starts", async () => {
    const count = (await status(merchant)).started;
    const response = await post(merchant, f.url("/redirect-ok"));
    assert.equal(response.json.requestedUrl, f.url("/redirect-ok"));
    assert.equal(response.json.finalUrl, f.url("/chosen-final"));
    await ready(merchant); assert.equal((await status(merchant)).started, count + 2);
  });
  for (const [name, target, sourceStatus] of [["refusal", "/refused", 403], ["server error", "/error", 500]]) await t.test(`truthful typed source ${name}`, async () => {
    const response = await post(merchant, f.url(target));
    assert.equal(response.status, 200); assert.equal(response.json.ok, true);
    assert.equal(response.json.status, sourceStatus); assert.equal(response.json.sourceOk, false);
    assert.equal(response.json.error.code, `http_${sourceStatus}`); assert.equal(extractMcpOutputSchema.safeParse(response.json).success, true);
    await ready(merchant);
    assert.deepEqual((await f.events(merchant)).filter(row => row.extractionTrialOutcome?.outcome === "failed").at(-1).extractionTrialReason,
      { v: 1, family: "source_http", code: sourceStatus === 403 ? "http_403" : "http_5xx" });
  });
  await t.test("oversize content remains bounded and explicitly partial", async () => {
    const response = await post(merchant, f.url("/oversize"));
    assert.equal(response.json.ok, true); assert.equal(response.json.capture.bodyBytes, 3_000_000);
    assert.equal(response.json.capture.bodyTruncated, true); assert.equal(response.json.capture.textTruncated, true);
    assert.equal(response.json.text.length, 1200); await ready(merchant);
  });
  await t.test("valid excerpt override reports text truncation independently of the body cap", async () => {
    const response = await merchant.request(ROUTE, { method: "POST", body: { url: f.url("/excerpt"), textExcerptLimitChars: 1500 } });
    assert.equal(response.json.text.length, 1500); assert.equal(response.json.capture.textExcerptLimitChars, 1500);
    assert.equal(response.json.capture.textTruncated, true); assert.equal(response.json.capture.bodyTruncated, false);
    await ready(merchant);
  });
  await t.test("Express case and trailing-slash aliases stay inside the same unpaid observed mount", async () => {
    const response = await merchant.request("/TRIAL/EXTRACT/", { method: "POST", body: { url: f.url("/alias") } });
    assert.equal(response.json.sourceOk, true); unpaid(response); await ready(merchant);
  });
  await t.test("credentials and arbitrary caller headers never reach fetched sites or payment code", async () => {
    const response = await post(merchant, f.url("/owner-observation"), { headers: {
      authorization: "Bearer private-credential-marker", "payment-signature": "private-payment-marker", "x-custom": "private-header-marker",
      "user-agent": "SameDayDesk-owner-test", "x-samedaydesk-agent-source": "private-source-marker",
    } });
    assert.equal(response.status, 200); unpaid(response);
    const headers = f.sourceCalls.at(-1).headers;
    assert.equal(headers.authorization, undefined); assert.equal(headers["payment-signature"], undefined); assert.equal(headers["x-custom"], undefined);
    await ready(merchant);
    const response2 = await post(merchant, f.url("/internal-observation"), { headers: { "x-samedaydesk-internal": "owner-fixture-authority-".repeat(4) } });
    assert.equal(response2.status, 200); await ready(merchant);
    const crawler = await post(merchant, f.url("/crawler-observation"), { headers: { "user-agent": "GPTBot", "x-samedaydesk-internal": "forged" } });
    assert.equal(crawler.status, 200); await ready(merchant);
    assert.deepEqual(f.calls.slice(callsBefore), []);
  });
  await t.test("actual aggregate capture is private and separates owner/test from unattributed", async () => {
    const events = await f.events(merchant), rows = events.filter(row => row.route === ROUTE);
    assert.ok(rows.length > 30); assert.ok(rows.every(row => row.kind === "free" && !row.paymentPresent && row.settlementReference === null));
    assert.equal(new Set(rows.map(row => row.actor)).size, 1, "aggregate-only actor never derives caller identity");
    const view = (await merchant.request("/v0/commerce-demand.json")).json.extractionTrial;
    assert.equal(view.populations.owner_monitor.completed, 1); assert.equal(view.populations.internal.completed, 1);
    assert.ok(view.populations.unattributed.admitted >= 10); assert.ok(view.populations.unattributed.failed >= 7);
    assert.equal(view.populations.unattributed.partial, 2); assert.equal(view.populations.crawler.completed, 1);
    assert.equal(view.usefulness, "unknown"); assert.equal(view.laterPaidChoice, "unknown");
    assert.equal(view.requestedWindowComplete, false);
    for (const forbidden of ["caller.example", "private-dns.example", "private-query-marker", "private-value-marker", "private-key-marker", "private-body-marker", "private-credential-marker", "private-payment-marker", "private-header-marker", "private-source-marker", "CallerFixture", "127.0.0.1", "Useful heading"]) {
      assert.ok(!JSON.stringify(rows).includes(forbidden), forbidden); assert.ok(!JSON.stringify(view).includes(forbidden), forbidden);
    }
    const enabledEmissions = await human(merchant);
    await retainEmissions("after-enabled", enabledEmissions);
    assert.deepEqual(enabledEmissions, baseline, "enabled trial also preserves actual emitted human pages");
    t.diagnostic(`raw-equal emitted human pages: ${humanPaths.length}, icon redirects: 2; combined SHA256 ${hash(JSON.stringify(baseline))}`);
    assert.deepEqual(await paid(merchant), before, "paid exact challenge remains byte-equivalent after trial work");
    assert.equal(await paidDiscoveryBody(merchant), paidDiscovery, "existing paid discovery bytes remain exact");
  });
  await merchant.stop();
});

test("mounted durable authority refuses missing, expired, scheduled, exhausted and corrupt stores", { timeout: 120000 }, async t => {
  const f = await fixture(t);
  const cases = [
    ["missing", path.join(f.scratch, "missing"), "unavailable"],
    ["expired", await f.store(authority({ startsAt: new Date(NOW - 86400_000).toISOString(), expiresAt: new Date(NOW - 1).toISOString() })), "expired"],
    ["scheduled", await f.store(authority({ startsAt: new Date(NOW + 1000).toISOString() })), "scheduled"],
  ];
  const corrupt = await f.store(); await chmod(path.join(corrupt, "authority.json"), 0o600); await writeFile(path.join(corrupt, "authority.json"), "{bad");
  cases.push(["corrupt authority", corrupt, "unavailable"]);
  const hole = await f.store(); await writeFile(path.join(hole, "spent-02"), "corrupt"); cases.push(["missing spend authority", hole, "unavailable"]);
  const link = await f.store(); await symlink(path.join(link, "authority.json"), path.join(link, "spent-01")); cases.push(["symlink spend authority", link, "unavailable"]);
  const unwritable = await f.store(); await chmod(unwritable, 0o500); cases.push(["unwritable volume directory", unwritable, "unavailable"]);
  for (const [name, store, availability] of cases) await t.test(name, async () => {
    const merchant = await f.start({ store });
    assert.equal((await status(merchant)).availability, availability);
    const response = await post(merchant, f.url());
    assert.equal(response.status, 503); assert.equal(response.json.availability, availability); unpaid(response);
    const rows = (await f.events(merchant)).filter(row => row.extractionTrialOutcome);
    assert.equal(rows.length, 1, "authority refusal emits no admitted phase");
    assert.deepEqual(rows[0].extractionTrialReason, { v: 1, family: "admission", code: availability });
    await merchant.stop(); assert.equal(f.sourceCalls.length, 0);
    if (store === unwritable) await chmod(store, 0o700);
  });
  await t.test("redirect cannot exceed the last durable start; restart cannot replenish exhausted allowance", async () => {
    const store = await f.store(authority({ maxStarted: 1 }));
    let merchant = await f.start({ store });
    const count = f.sourceCalls.length;
    const response = await post(merchant, f.url("/redirect-ok"));
    assert.equal(response.json.error.code, "trial_exhausted"); assert.equal(f.sourceCalls.length, count + 1);
    await ready(merchant, "exhausted"); await merchant.stop();
    merchant = await f.start({ store });
    assert.equal((await status(merchant)).started, 1); assert.equal((await status(merchant)).availability, "exhausted");
    assert.equal((await post(merchant, f.url())).status, 503); assert.equal(f.sourceCalls.length, count + 1);
    await merchant.stop();
  });
});

test("mounted concurrency, duplicate controllers, unknown delivery and interrupted restart never replenish", { timeout: 120000 }, async t => {
  const f = await fixture(t);
  const store = await f.store(authority({ maxStarted: 4 }));
  let merchant = await f.start({ store });
  await t.test("one concurrent fetch across parallel callers and duplicate OS controllers sharing the volume", async () => {
    const duplicate = await f.start({ store });
    const unblock = f.block();
    try {
      const count = f.sourceCalls.length;
      const first = post(merchant, f.url("/gate"));
      await waitFor(() => f.sourceCalls.length === count + 1, "first request at controlled source");
      const refused = await Promise.all([post(merchant, f.url()), post(duplicate, f.url())]);
      assert.ok(refused.every(response => response.status === 503 && response.json.availability === "busy"));
      for (const current of [merchant, duplicate]) {
        const row = (await f.events(current)).filter(row => row.extractionTrialOutcome?.outcome === "refused").at(-1);
        assert.deepEqual(row.extractionTrialReason, { v: 1, family: "admission", code: "busy" });
      }
      assert.equal(f.sourceCalls.length, count + 1);
      unblock(); assert.equal((await first).json.sourceOk, true); await ready(merchant);
      assert.equal((await status(duplicate)).started, 1);
    } finally { unblock(); await duplicate.stop(); }
  });
  await t.test("graceful restart retains spent starts and does not replay work", async () => {
    await merchant.stop(); const count = f.sourceCalls.length;
    merchant = await f.start({ store }); assert.equal((await status(merchant)).started, 1);
    assert.equal(f.sourceCalls.length, count);
  });
  await t.test("lost HTTP response stays unknown; completion consumes once and triggers no automatic extraction", async () => {
    const unblock = f.block();
    const count = f.sourceCalls.length;
    const url = new URL(merchant.base);
    const req = httpRequest({ hostname: url.hostname, port: url.port, path: ROUTE, method: "POST", headers: { "content-type": "application/json" } });
    req.on("error", () => {}); req.end(JSON.stringify({ url: f.url("/gate-unknown") }));
    try {
      await waitFor(() => f.sourceCalls.length === count + 1);
      req.destroy();
      await waitFor(async () => (await f.events(merchant)).some(row => row.extractionTrialOutcome?.outcome === "unknown_response"));
      unblock(); await ready(merchant);
      assert.equal((await status(merchant)).started, 2); assert.equal(f.sourceCalls.length, count + 1);
      const lost = (await merchant.request("/v0/commerce-demand.json")).json.extractionTrial;
      assert.deepEqual(lost.diagnostics.populations.unattributed.unknown_response, { known: 0, unknown: 1, byReason: {} });
      await merchant.stop(); merchant = await f.start({ store });
      assert.equal((await status(merchant)).started, 2); assert.equal(f.sourceCalls.length, count + 1);
      const view = (await merchant.request("/v0/commerce-demand.json")).json.extractionTrial;
      assert.equal(view.requestedWindowComplete, false); // new mount does not backdate old capture
      assert.deepEqual(view.diagnostics.populations, {}, "this harness restart selects a fresh journal; no backfill");
    } finally { unblock(); req.destroy(); }
  });
  await t.test("process crash retains durable spend and abandoned lock; restart refuses ambiguous active work", async () => {
    const unblock = f.block(); const count = f.sourceCalls.length;
    const pending = post(merchant, f.url("/gate-crash")).catch(() => null);
    try {
      await waitFor(() => f.sourceCalls.length === count + 1);
      await merchant.stop("SIGKILL"); await pending; unblock();
      merchant = await f.start({ store });
      assert.equal((await status(merchant)).started, 3); assert.equal((await status(merchant)).availability, "busy");
      assert.equal((await post(merchant, f.url())).status, 503); assert.equal(f.sourceCalls.length, count + 1);
    } finally { unblock(); }
  });
  await merchant.stop();
});

test("authority provisioning is finite, create-only and never repairs corrupt persistence", async t => {
  const f = await fixture(t);
  for (const [name, overrides] of [["unbounded starts", { maxStarted: 21 }], ["zero starts", { maxStarted: 0 }], ["long duration", { expiresAt: new Date(NOW + 8 * 86400_000).toISOString() }], ["missing identity", { experimentId: null }], ["noncanonical expiry", { expiresAt: "tomorrow" }], ["extra authority", { reset: true }]]) {
    await t.test(name, async () => {
      const dir = path.join(f.scratch, name.replaceAll(" ", "-"));
      await assert.rejects(provisionExtractionTrial(dir, authority(overrides)));
    });
  }
  await t.test("existing authority cannot be reprovisioned; removing process state changes no spent rights", async () => {
    const store = await f.store();
    await assert.rejects(provisionExtractionTrial(store, authority()), { code: "EEXIST" });
    const budget = createExtractionTrialBudget({ enabled: true, dir: store, now: () => NOW });
    const lease = await budget.acquire(); await lease.spend(); await lease.release();
    assert.equal((await createExtractionTrialBudget({ enabled: true, dir: store, now: () => NOW }).status()).started, 1);
    await mkdir(path.join(store, "unexpected"));
    assert.equal((await budget.status()).availability, "unavailable");
    assert.equal((await readdir(store)).filter(name => name.startsWith("spent-")).length, 1);
    assert.equal((await readFile(path.join(store, "authority.json"), "utf8")).includes("http"), false);
  });
});

test("actual merchant restart retains old trial rows while current mount has no new extraction", { timeout: 60000 }, async t => {
  const f = await fixture(t);
  const store = await f.store();
  const headers = { "user-agent": "SameDayDesk-owner-test" };
  const first = await f.start({ store });
  assert.equal((await post(first, f.url(), { headers })).json.sourceOk, true);
  assert.equal((await first.request(ROUTE, { headers })).status, 405);
  const oldRows = (await f.events(first)).filter(row => row.extractionTrialOutcome);
  const before = (await first.request("/v0/commerce-demand.json?days=1")).json.extractionTrial;
  await first.stop();
  const hops = f.sourceCalls.length;
  const second = await f.start({ store, dataDir: first.data, now: NOW + 60000 });
  const read = (await second.request("/v0/commerce-demand.json?days=1")).json.extractionTrial;
  assert.equal(f.sourceCalls.length, hops, "restart and projection perform no extraction");
  assert.deepEqual(read.populations, before.populations);
  assert.deepEqual(read.diagnostics, before.diagnostics);
  assert.equal(read.populations.owner_monitor.admitted, 1);
  assert.equal(read.populations.owner_monitor.completed, 1);
  assert.equal(read.populations.owner_monitor.refused, 1);
  assert.ok(read.captureStartedAt > oldRows.at(-1).ts);
  assert.equal(read.coverage, "unknown_for_full_window");
  assert.equal(read.currentCapture.coverage, "prospective_process_only");
  assert.equal(read.currentCapture.startedAt, read.captureStartedAt);
  assert.equal(read.retainedObservationContinuity, "unknown");
  assert.equal(read.requestedWindowComplete, false);
  assert.equal(read.usefulness, "unknown");
  assert.equal(read.independentUse, "unknown");
  assert.equal(read.laterPaidChoice, "unknown");
  assert.deepEqual((await f.events(second)).filter(row => row.extractionTrialOutcome), oldRows);
  assert.equal((await status(second)).started, 1);
  // A current unattributed completion adds technical observations, never identity or a join.
  assert.equal((await post(second, f.url())).json.sourceOk, true);
  const current = (await second.request("/v0/commerce-demand.json?days=1")).json.extractionTrial;
  assert.deepEqual(current.populations.owner_monitor, read.populations.owner_monitor);
  assert.equal(current.populations.unattributed.admitted, 1);
  assert.equal(current.populations.unattributed.completed, 1);
  assert.equal(current.coverage, "unknown_for_full_window");
  assert.equal(current.currentCapture.startedAt, read.captureStartedAt);
  assert.equal((await status(second)).started, 2);
  assert.equal(f.sourceCalls.length, hops + 1);
  await second.stop();
});

test("pinned trial caller bytes and phase totals survive finite diagnostics for controlled source and refusal branches", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const f = await fixture(t);
  // Load the exact pinned producer with only relative import resolution adapted
  // to a data URL. Both mounts use the same extractor and offline-only transport.
  const pinnedCommit = "d9e5cde379cf7798f473d0cc6bf2139c9ec857d9";
  const pinnedSource = execFileSync("git", ["show", `${pinnedCommit}:extraction-trial.mjs`], { encoding: "utf8" })
    .replaceAll('"express"', JSON.stringify(import.meta.resolve("express")))
    .replaceAll('"./extract.mjs"', JSON.stringify(new URL("./extract.mjs", import.meta.url).href))
    .replaceAll('"./extract-capture.mjs"', JSON.stringify(new URL("./extract-capture.mjs", import.meta.url).href));
  const pinned = await import(`data:text/javascript;base64,${Buffer.from(pinnedSource).toString("base64")}`);
  const secret = "sk_live_ROOT9572_HTTP_SECRET";
  const previousFetch = globalThis.__SAMEDAYDESK_EXTRACT_FETCH__;
  t.after(() => {
    if (previousFetch === undefined) delete globalThis.__SAMEDAYDESK_EXTRACT_FETCH__;
    else globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = previousFetch;
  });
  let fetches = 0;
  globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = input => {
    const url = new URL(input);
    assert.equal(url.hostname, "diagnostic.fixture.example", "fixture must never use real transport");
    fetches++;
    const target = url.pathname.slice(1);
    if (["403", "429", "500"].includes(target)) return Promise.resolve(new Response("<body>fixture</body>", { status: Number(target) }));
    if (target === "ok" || target === "partial") return Promise.resolve(new Response(`<body>${target === "partial" ? "p".repeat(2000) : "fixture"}</body>`));
    if (target === "redirect") return Promise.resolve(new Response(null, { status: 302 }));
    if (target === "encoding") return Promise.resolve(new Response("fixture", { headers: { "content-encoding": "gzip" } }));
    if (target === "response") return Promise.resolve({ status: 200, headers: new Headers(), body: null });
    if (target === "timeout") throw new DOMException(secret, "AbortError");
    if (target === "ssrf") throw Object.assign(new Error(secret), { code: "ssrf_blocked" });
    if (target === "custom") throw Object.assign(new Error(secret), { code: secret });
    if (target === "http-code") throw Object.assign(new Error(secret), { code: "http_403" });
    if (target === "malformed") throw Object.assign(new Error(secret), { code: ["timeout"] });
    if (target === "no-code") throw new Error(secret);
    throw new Error("unconfigured offline fixture");
  };
  async function mounted(mount, name) {
    const telemetry = createCommerceTelemetry({ dataDir: path.join(f.scratch, name), secret: "diagnostic-fixture-key" });
    let availability = "enabled", started = 0;
    const budget = {
      async status() { return { availability }; },
      async acquire() {
        if (availability !== "enabled") throw Object.assign(new Error("fixture"), { code: `trial_${availability}` });
        return { async spend() { started++; }, async release() {} };
      },
    };
    const app = express(); mount(app, { budget, observe: telemetry.extractionTrialObserver() });
    const server = createServer(app); server.listen(0, "127.0.0.1"); await once(server, "listening");
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    return {
      telemetry, availability(value) { availability = value; }, started: () => started,
      async request({ target = "ok", method = "POST", raw, body } = {}) {
        return new Promise((resolve, reject) => {
          const req = httpRequest({ hostname: "127.0.0.1", port: server.address().port, path: ROUTE, method,
            headers: { "content-type": "application/json" } }, res => {
            const chunks = []; res.on("data", chunk => chunks.push(chunk));
            res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() }));
          });
          req.on("error", reject);
          req.end(raw ?? JSON.stringify(body ?? { url: `https://diagnostic.fixture.example/${target}` }));
        });
      },
    };
  }
  const before = await mounted(pinned.mountExtractionTrial, "pinned");
  const after = await mounted(mountExtractionTrial, "diagnostic");
  const cases = [
    ...["403", "429", "500"].map(target => ({ target, outcome: "failed", family: "source_http", code: target === "500" ? "http_5xx" : `http_${target}` })),
    ...[["timeout", "timeout"], ["ssrf", "ssrf_blocked"], ["redirect", "redirect_error"],
      ["encoding", "unsupported_encoding"], ["response", "invalid_response"]]
      .map(([target, code]) => ({ target, outcome: "failed", family: "fetch", code })),
    ...["custom", "http-code", "malformed", "no-code"].map(target => ({ target, outcome: "failed" })),
    { target: "ok", outcome: "completed" }, { target: "partial", outcome: "partial" },
    { method: "PUT", outcome: "refused", family: "admission", code: "method_not_allowed" },
    { raw: "{", outcome: "refused", family: "admission", code: "invalid_trial_body" },
    { body: { url: "file:///fixture" }, outcome: "refused", family: "admission", code: "invalid_trial_input" },
    ...["disabled", "scheduled", "expired", "exhausted", "busy", "unavailable"].map(availability =>
      ({ availability, outcome: "refused", family: "admission", code: availability })),
  ];
  for (const entry of cases) await t.test(entry.target || entry.code, async () => {
    before.availability(entry.availability || "enabled"); after.availability(entry.availability || "enabled");
    const fetchCount = fetches, starts = after.started();
    const expected = await before.request(entry), actual = await after.request(entry);
    assert.equal(actual.status, expected.status); assert.equal(actual.text, expected.text, "caller body bytes equal pinned producer");
    for (const key of ["cache-control", "x-samedaydesk-trial", "content-type", "content-length", "etag", "allow"]) {
      assert.equal(actual.headers[key], expected.headers[key], key);
    }
    unpaid(actual);
    await after.telemetry.flush();
    const rows = (await readFile(after.telemetry.paths.currentPath, "utf8")).trim().split("\n").map(JSON.parse);
    const terminal = rows.at(-1);
    assert.equal(terminal.extractionTrialOutcome.outcome, entry.outcome);
    assert.deepEqual(terminal.extractionTrialReason,
      entry.code ? { v: 1, family: entry.family, code: entry.code } : undefined);
    if (entry.outcome === "refused") {
      assert.equal(fetches, fetchCount, "refusal never fetches"); assert.equal(after.started(), starts, "refusal never spends");
    } else assert.equal(after.started(), starts + 1);
    assert.equal(after.started(), before.started());
  });
  const oldSummary = (await before.telemetry.snapshot()).extractionTrial;
  const summary = (await after.telemetry.snapshot()).extractionTrial;
  assert.deepEqual(summary.populations, oldSummary.populations, "all existing phase totals equal the pinned producer");
  assert.deepEqual(summary.diagnostics.populations.unattributed.failed, { known: 8, unknown: 4, byReason: {
    "source_http.http_403": 1, "source_http.http_429": 1, "source_http.http_5xx": 1,
    "fetch.timeout": 1, "fetch.ssrf_blocked": 1, "fetch.redirect_error": 1,
    "fetch.unsupported_encoding": 1, "fetch.invalid_response": 1,
  } });
  assert.equal(summary.diagnostics.populations.unattributed.refused.known, 9);
  const raw = await readFile(after.telemetry.paths.currentPath, "utf8");
  for (const marker of [secret, "diagnostic.fixture.example", "<body>"]) {
    assert.ok(!raw.includes(marker)); assert.ok(!JSON.stringify(summary).includes(marker));
  }
  assert.equal(new Set(raw.trim().split("\n").map(line => JSON.parse(line).actor)).size, 1);
  assert.equal(f.sourceCalls.length, 0, "no fixture fallback to another source");
  t.diagnostic(`${cases.length} controlled branches: caller body/header bytes and phase totals equal ${pinnedCommit}`);
});
