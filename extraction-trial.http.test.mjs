import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { mkdir, readFile, readdir, writeFile, chmod, symlink } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { extractMcpOutputSchema } from "./extract.mjs";
import { PLATFORM_HEALTH_CARDS } from "./platform-health.mjs";
import { createExtractionTrialBudget, EXTRACTION_TRIAL_PATH as ROUTE, EXTRACTION_TRIAL_DISCOVERY as DISCOVERY, provisionExtractionTrial } from "./extraction-trial.mjs";
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
    assert.ok(view.captureStartedAt); assert.equal(view.coverage, "prospective_process_only");
    assert.equal(view.populations.unattributed.refused, 1);
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
      await merchant.stop(); merchant = await f.start({ store });
      assert.equal((await status(merchant)).started, 2); assert.equal(f.sourceCalls.length, count + 1);
      const view = (await merchant.request("/v0/commerce-demand.json")).json.extractionTrial;
      assert.equal(view.requestedWindowComplete, false); // new mount does not backdate old capture
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
