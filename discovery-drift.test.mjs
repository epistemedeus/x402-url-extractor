import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import http from "node:http";
import { fileURLToPath } from "node:url";

import { SELLER_INTEGRITY_AUDIT_EXAMPLE } from "./seller-integrity-audit.mjs";
import {
  DISCOVERY_DRIFT_CHANGE_SCHEMA,
  DISCOVERY_DRIFT_OPERATOR_COMMAND,
  DISCOVERY_DRIFT_SCHEMA,
  DISCOVERY_DRIFT_STATUSES,
  fetchBazaarMerchant,
  normalizeDiscoveryObservation,
  T1_S94,
  compareDiscoveryDriftChange,
  compareDiscoveryLive,
  observationFromBazaarMerchant,
  observationFromPreflight,
  observationFromSellerIntegrity,
  observeDiscoveryDrift,
  replayT1S94,
  runDiscoveryDriftCli,
} from "./discovery-drift.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const RESOURCE = T1_S94.resource;
const ASSET = T1_S94.asset;
const OTHER_ASSET = "0x0000000000000000000000000000000000000001";
const NOW = Date.parse(T1_S94.recordedAt) + 2000;

function catalogOffer(overrides = {}) {
  return {
    observedAt: T1_S94.recordedAt,
    source: "coinbase-bazaar-merchant-discovery",
    resource: RESOURCE,
    lastUpdated: T1_S94.lastUpdated,
    offers: [{
      protocol: "x402",
      network: "eip155:8453",
      asset: ASSET,
      amountAtomic: "20000",
      recipient: T1_S94.payTo,
      ...overrides.offer,
    }],
    ...overrides.observation,
  };
}

function liveOffer(overrides = {}) {
  return {
    observedAt: "2026-09-10T07:21:39.018Z",
    source: "live-unpaid-402",
    resource: RESOURCE,
    offers: [{
      protocol: "x402",
      network: "eip155:8453",
      asset: ASSET,
      amountAtomic: "20000",
      recipient: T1_S94.payTo,
      ...overrides.offer,
    }],
    ...overrides.observation,
  };
}

test("pins the copy-paste operator command and status vocabulary", () => {
  assert.equal(
    DISCOVERY_DRIFT_OPERATOR_COMMAND,
    "node discovery-drift.mjs observe --url 'https://agent-economy-signal-x402-mainnet.bronzetti-andrea.workers.dev/premium/agent-brief' --bazaar-pay-to '0xbda48b29607b9dc66ef7e38b68ad53f2b17efb23'",
  );
  const docs = readFileSync(join(ROOT, "docs/discovery-drift.md"), "utf8");
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  assert.equal(docs.includes(DISCOVERY_DRIFT_OPERATOR_COMMAND), true);
  assert.equal(readme.includes(DISCOVERY_DRIFT_OPERATOR_COMMAND), true);
  assert.deepEqual(DISCOVERY_DRIFT_STATUSES, [
    "match",
    "mismatch",
    "unknown",
    "stale",
    "reordered-multiple-offer",
    "network-mismatch",
    "asset-mismatch",
  ]);
  assert.match(docs, /Recorded T1 case/);
  assert.match(docs, /did not reindex Bazaar/);
  assert.doesNotMatch(docs, /This observation reindexed|we reindexed/);
});

test("records T1 S94 amount match without claiming reindex or lastUpdated cause", () => {
  const report = replayT1S94();
  assert.equal(report.schemaVersion, DISCOVERY_DRIFT_SCHEMA);
  assert.equal(report.status, "match");
  assert.equal(report.observedMatch, true);
  assert.equal(report.resolvedCause, false);
  assert.equal(report.dimensions.find((item) => item.dimension === "amountAtomic").disposition, "matched");
  assert.equal(report.dimensions.find((item) => item.dimension === "amountAtomic").catalog, "20000");
  assert.equal(report.dimensions.find((item) => item.dimension === "amountAtomic").live, "20000");
  assert.equal(report.dimensions.find((item) => item.dimension === "resource").disposition, "matched");
  assert.equal(report.dimensions.find((item) => item.dimension === "network").disposition, "matched");
  assert.equal(report.dimensions.find((item) => item.dimension === "asset").disposition, "matched");
  assert.equal(report.dimensions.find((item) => item.dimension === "freshness").disposition, "unknown");
  assert.equal(report.boundary.reindexPerformed, false);
  assert.equal(report.boundary.paymentSent, false);
  assert.equal(report.boundary.unitsConverted, false);
  assert.ok(report.notClaimed.includes("did not reindex any catalog"));
  assert.ok(report.notClaimed.includes("did not resolve lastUpdated lag as a cause"));
  assert.equal(report.replay.mode, "recorded-fixture");
  assert.match(report.replay.claim, /did not reindex Bazaar/);
  assert.equal(JSON.stringify(report).includes("0.02"), false);
});

test("mismatch: seller-integrity fixture 5000 vs live catalog 10000", () => {
  const fixture = observationFromSellerIntegrity(SELLER_INTEGRITY_AUDIT_EXAMPLE, {
    observedAt: "2026-08-12T07:50:00.000Z",
  });
  assert.equal(fixture.offers[0].amountAtomic, "5000");
  const liveCatalog = catalogOffer({
    offer: { amountAtomic: "10000" },
    observation: {
      source: "live-catalog",
      resource: "https://agents.samedaydesk.com/commerce/payment-offer-preflight",
      lastUpdated: "2026-09-10T00:00:00.000Z",
    },
  });
  const report = compareDiscoveryLive(fixture, {
    ...liveCatalog,
    source: "live-unpaid-402",
    lastUpdated: null,
  }, { now: NOW });
  assert.equal(report.status, "mismatch");
  assert.equal(report.observedMatch, false);
  assert.equal(report.resolvedCause, false);
  assert.equal(report.dimensions.find((item) => item.dimension === "amountAtomic").catalog, "5000");
  assert.equal(report.dimensions.find((item) => item.dimension === "amountAtomic").live, "10000");
});

test("unknown: missing amountAtomic is not treated as drift or converted units", () => {
  const report = compareDiscoveryLive(catalogOffer({
    offer: { amountAtomic: undefined },
  }), liveOffer(), { now: NOW });
  assert.equal(report.status, "unknown");
  assert.equal(report.dimensions.find((item) => item.dimension === "amountAtomic").disposition, "unknown");
  assert.equal(report.dimensions.find((item) => item.dimension === "amountAtomic").catalog, null);
  assert.ok(report.unknowns.includes("amountAtomic"));
});

test("stale: economics match and lastUpdated exceeds an explicit horizon", () => {
  const report = compareDiscoveryLive(catalogOffer(), liveOffer(), {
    now: NOW,
    staleMs: 60 * 60 * 1000,
  });
  assert.equal(report.status, "stale");
  assert.equal(report.observedMatch, true);
  assert.equal(report.resolvedCause, false);
  const freshness = report.dimensions.find((item) => item.dimension === "freshness");
  assert.equal(freshness.disposition, "stale");
  assert.match(freshness.note, /not a proved price-stale cause/);
});

test("reordered-multiple-offer preserves the offer set and does not invent drift", () => {
  const first = { protocol: "x402", network: "eip155:8453", asset: ASSET, amountAtomic: "20000", recipient: T1_S94.payTo };
  const second = { protocol: "x402", network: "eip155:1", asset: ASSET, amountAtomic: "30000", recipient: T1_S94.payTo };
  const report = compareDiscoveryLive({
    ...catalogOffer(),
    offers: [first, second],
  }, {
    ...liveOffer(),
    offers: [second, first],
  }, { now: NOW });
  assert.equal(report.status, "reordered-multiple-offer");
  assert.equal(report.offerAlignment.status, "reordered");
  assert.equal(report.dimensions.find((item) => item.dimension === "amountAtomic").disposition, "matched");
  assert.equal(report.observedMatch, true);
  assert.equal(report.resolvedCause, false);
});

test("network-mismatch does not compare amounts as decimals", () => {
  const report = compareDiscoveryLive(catalogOffer({
    offer: { network: "eip155:8453" },
  }), liveOffer({
    offer: { network: "eip155:1" },
  }), { now: NOW });
  assert.equal(report.status, "network-mismatch");
  assert.equal(report.dimensions.find((item) => item.dimension === "network").disposition, "drifted");
  assert.equal(report.dimensions.find((item) => item.dimension === "amountAtomic").disposition, "matched");
});

test("asset-mismatch keeps atomic strings exact and does not equate units", () => {
  const report = compareDiscoveryLive(catalogOffer({
    offer: { asset: ASSET },
  }), liveOffer({
    offer: { asset: OTHER_ASSET },
  }), { now: NOW });
  assert.equal(report.status, "asset-mismatch");
  assert.equal(report.dimensions.find((item) => item.dimension === "asset").catalog, ASSET);
  assert.equal(report.dimensions.find((item) => item.dimension === "asset").live, OTHER_ASSET);
  assert.equal(report.boundary.unitsConverted, false);
});

test("extracts Bazaar accepts amount strings and ignores example price_usd", () => {
  const observation = observationFromBazaarMerchant({
    payTo: T1_S94.payTo,
    resources: [{
      resource: RESOURCE,
      lastUpdated: T1_S94.lastUpdated,
      accepts: [{ amount: "20000", asset: ASSET, network: "eip155:8453", payTo: T1_S94.payTo, scheme: "exact" }],
      extensions: { bazaar: { info: { output: { example: { price_usd: 0.05 } } } } },
    }],
  }, { resource: RESOURCE, observedAt: T1_S94.recordedAt });
  assert.equal(observation.offers[0].amountAtomic, "20000");
  assert.equal(JSON.stringify(observation).includes("0.05"), false);
  assert.equal(JSON.stringify(observation).includes("price_usd"), false);
});

test("live adapter keeps only valid unpaid offers and redirect/payment flags", () => {
  const observation = observationFromPreflight({
    checkedAt: "2026-09-10T07:21:39.018Z",
    target: { url: RESOURCE, httpStatus: 402 },
    decision: "parseable_offer",
    protocols: ["x402"],
    offerCount: 1,
    offers: [
      { protocol: "x402", network: "eip155:8453", asset: ASSET, amountAtomic: "20000", recipient: T1_S94.payTo, valid: true },
      { protocol: "x402", network: "eip155:8453", asset: ASSET, amountAtomic: "1", recipient: T1_S94.payTo, valid: false },
    ],
    boundary: { credentialsUsed: false, paymentSent: false, redirectsFollowed: false },
  });
  assert.equal(observation.offers.length, 1);
  assert.equal(observation.offers[0].amountAtomic, "20000");
  assert.equal(observation.raw.redirectsFollowed, false);
});

test("observe reuses payment-offer-preflight and bazaar fetch without credentials or payment", async () => {
  let fetched;
  const report = await observeDiscoveryDrift({
    url: RESOURCE,
    bazaarPayTo: T1_S94.payTo,
    now: NOW,
    fetchImpl: async (url, init) => {
      fetched = { url: url.toString(), init };
      return new Response(readFileSync(join(ROOT, "fixtures/discovery-drift/t1-s94/bazaar-merchant.json")), { status: 200 });
    },
    paymentPreflightImpl: async () => JSON.parse(readFileSync(join(ROOT, "fixtures/discovery-drift/t1-s94/live-preflight.json"), "utf8")),
  });
  assert.equal(report.status, "match");
  assert.match(fetched.url, /discovery\/merchant\?payTo=0xbda48b29607b9dc66ef7e38b68ad53f2b17efb23/);
  assert.equal(fetched.init.method, "GET");
  assert.equal(fetched.init.redirect, "error");
  assert.equal(fetched.init.headers.authorization, undefined);
  assert.equal(report.boundary.credentialsUsed, false);
  assert.equal(report.boundary.paymentSent, false);
  assert.equal(report.coherence.available, true);
  assert.equal(report.listingIdentity.available, true);
});

test("repeat-change compares two snapshots without fetching", () => {
  const before = replayT1S94();
  const afterMatch = replayT1S94();
  const unchanged = compareDiscoveryDriftChange(before, afterMatch, { clock: "2026-09-10T08:00:00.000Z" });
  assert.equal(unchanged.schemaVersion, DISCOVERY_DRIFT_CHANGE_SCHEMA);
  assert.equal(unchanged.verdict, "unchanged");
  assert.equal(unchanged.resolvedCause, false);
  const drifted = compareDiscoveryLive(catalogOffer({ offer: { amountAtomic: "50000" } }), liveOffer(), { now: NOW });
  const changed = compareDiscoveryDriftChange(before, drifted, { clock: "2026-09-10T08:00:00.000Z" });
  assert.equal(changed.verdict, "changed");
  assert.ok(changed.changes.some((item) => item.field === "status"));
  assert.ok(changed.changes.some((item) => item.field === "catalog.amountAtomic"));
});

test("CLI replay-t1 and compare emit match JSON", async () => {
  const lines = [];
  const code = await runDiscoveryDriftCli(["replay-t1"], {
    stdout: (value) => lines.push(String(value)),
    stderr: () => {},
  });
  assert.equal(code, 0);
  const report = JSON.parse(lines.join("\n"));
  assert.equal(report.status, "match");
  assert.equal(report.replay.mode, "recorded-fixture");

  const compareLines = [];
  const compareCode = await runDiscoveryDriftCli([
    "compare",
    "--catalog", join(ROOT, "fixtures/discovery-drift/t1-s94/catalog.json"),
    "--live", join(ROOT, "fixtures/discovery-drift/t1-s94/live.json"),
    "--now", T1_S94.recordedAt,
  ], {
    stdout: (value) => compareLines.push(String(value)),
    stderr: () => {},
  });
  assert.equal(compareCode, 0);
  assert.equal(JSON.parse(compareLines.join("\n")).status, "match");
});

test("CLI binary replay-t1 is a one-shot unpaid fixture command", async () => {
  const child = spawn(process.execPath, ["discovery-drift.mjs", "replay-t1"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  const stdout = await new Promise((resolve, reject) => {
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`cli exited ${code}: ${err}`));
      else resolve(out);
    });
  });
  const report = JSON.parse(stdout);
  assert.equal(report.status, "match");
  assert.equal(report.boundary.paymentSent, false);
});

test("all offers participate: second amount drift, extra offers and ambiguous joins cannot match", () => {
  const first = catalogOffer().offers[0];
  const second = { ...first, network: "eip155:1", amountAtomic: "99" };
  const catalog = { ...catalogOffer(), offers: [first, second] };
  const live = { ...liveOffer(), offers: [{ ...second, amountAtomic: "100" }, first] };
  const drift = compareDiscoveryLive(catalog, live, { now: NOW });
  assert.equal(drift.status, "mismatch");
  assert.equal(drift.observedMatch, false);
  assert.equal(drift.dimensions.find(x => x.dimension === "amountAtomic").disposition, "drifted");
  assert.equal(compareDiscoveryLive(catalog, liveOffer(), { now: NOW }).status, "mismatch");
  const ambiguous = { ...catalogOffer(), offers: [first, { ...first, amountAtomic: "99" }] };
  const changed = { ...liveOffer(), offers: [first, { ...first, amountAtomic: "100" }] };
  assert.equal(compareDiscoveryLive(ambiguous, changed, { now: NOW }).status, "unknown");
});

test("zero is known, unsafe numeric amounts and missing network are unknown; asset case stays significant", () => {
  assert.equal(compareDiscoveryLive(catalogOffer({ offer: { amountAtomic: 0 } }), liveOffer({ offer: { amountAtomic: "0" } }), { now: NOW }).status, "match");
  for (const offer of [{ amountAtomic: 9007199254740992 }, { network: null }, { asset: null }]) {
    assert.equal(compareDiscoveryLive(catalogOffer({ offer }), liveOffer(), { now: NOW }).status, "unknown");
  }
  assert.equal(compareDiscoveryLive(catalogOffer({ offer: { asset: "CaseSensitiveMint" } }), liveOffer({ offer: { asset: "casesensitivemint" } }), { now: NOW }).status, "asset-mismatch");
  assert.equal(compareDiscoveryLive(catalogOffer(), liveOffer({ offer: { recipient: OTHER_ASSET } }), { now: NOW }).status, "mismatch");
});

test("truncated offers and non-402 or invalid-offer preflights cannot produce a match", () => {
  const many = { ...catalogOffer(), offers: Array.from({ length: 21 }, (_, i) => ({ ...catalogOffer().offers[0], amountAtomic: String(i) })) };
  assert.equal(compareDiscoveryLive(many, { ...many, source: "live" }, { now: NOW }).status, "unknown");
  const original = JSON.parse(readFileSync(join(ROOT, "fixtures/discovery-drift/t1-s94/live-preflight.json")));
  for (const change of [x => { x.target.httpStatus = 200; }, x => { x.offers.push({ valid: false }); }]) {
    const value = structuredClone(original); change(value);
    assert.equal(compareDiscoveryLive(catalogOffer(), observationFromPreflight(value), { now: NOW }).status, "unknown");
  }
});

test("catalog pagination is explicitly incomplete and unrelated or duplicate source URLs are not selected", () => {
  const body = JSON.parse(readFileSync(join(ROOT, "fixtures/discovery-drift/t1-s94/bazaar-merchant.json")));
  const partial = { ...body, pagination: { offset: 0, total: 50, limit: 20 } };
  const catalog = observationFromBazaarMerchant(partial, { resource: RESOURCE, observedAt: T1_S94.recordedAt });
  assert.equal(catalog.raw.coverage, "single_page_only");
  assert.equal(compareDiscoveryLive(catalog, liveOffer(), { now: NOW }).status, "unknown");
  body.resources.unshift({ resource: "http://127.0.0.1/private", accepts: [] });
  assert.equal(observationFromBazaarMerchant(body, { resource: RESOURCE }).offers.length, 1);
  body.resources.push(body.resources[1]);
  assert.equal(observationFromBazaarMerchant(body, { resource: RESOURCE }).offers.length, 0);
  assert.throws(() => observationFromBazaarMerchant(body, {}), /exact resource/);
});

test("freshness does not invent capture times or accept future dates and includes live capture age", () => {
  const missing = normalizeDiscoveryObservation({ ...catalogOffer(), observedAt: undefined });
  assert.equal(missing.observedAt, null);
  const future = { ...catalogOffer(), lastUpdated: "2099-01-01T00:00:00Z" };
  assert.equal(compareDiscoveryLive(future, liveOffer(), { now: NOW, staleMs: 1000 }).dimensions.find(x => x.dimension === "freshness").disposition, "unknown");
  const recentCatalog = { ...catalogOffer(), lastUpdated: new Date(NOW).toISOString() };
  const oldLive = { ...liveOffer(), observedAt: "2020-01-01T00:00:00Z" };
  assert.equal(compareDiscoveryLive(recentCatalog, oldLive, { now: NOW, staleMs: 5000 }).status, "stale");
});

test("successive reports retain source identity and detect every offer, not only the first", () => {
  const first = catalogOffer().offers[0], second = { ...first, network: "eip155:1", amountAtomic: "99" };
  const before = compareDiscoveryLive({ ...catalogOffer(), offers: [first, second] }, { ...liveOffer(), offers: [first, second] }, { now: NOW });
  const altered = { ...second, amountAtomic: "100" };
  const after = compareDiscoveryLive({ ...catalogOffer(), offers: [first, altered] }, { ...liveOffer(), offers: [first, altered] }, { now: NOW + 1000 });
  assert.equal(compareDiscoveryDriftChange(before, after).verdict, "changed");
  for (const mutation of [x => { x.catalog.source = "other-registry"; }, x => { x.catalog.resource = "https://example.com/other"; }, x => { x.checkedAt = "2020-01-01T00:00:00Z"; }]) {
    const unrelated = structuredClone(after); mutation(unrelated);
    assert.equal(compareDiscoveryDriftChange(before, unrelated).verdict, "unknown");
  }
});

test("CLI rejects unknown or ignored options before network; injected live source must match target", async () => {
  const noNetwork = { paymentPreflightImpl() { assert.fail("unexpected network"); } };
  for (const args of [["observe", "--url", RESOURCE, "--typo", "yes"], ["observe", "--url", RESOURCE, "--live", "ignored.json"], ["compare", "extra"], ["change", "--live-replay"]]) {
    await assert.rejects(runDiscoveryDriftCli(args, noNetwork), /option|command/);
  }
  await assert.rejects(observeDiscoveryDrift({ url: RESOURCE, ...noNetwork }), /catalog input/);
  await assert.rejects(observeDiscoveryDrift({ url: RESOURCE, catalog: catalogOffer(), preflight: { target: { url: "https://example.com/other" } } }), /source identity/);
});

test("actual catalog transport bounds chunked data, deadline and redirects; merchant identity stays exact", async t => {
  const body = JSON.stringify({ payTo: T1_S94.payTo, resources: [], pagination: { offset: 0, total: 0 } });
  let targetHits = 0;
  const server = http.createServer((req, res) => {
    if (req.url === "/ok") { res.writeHead(200); res.write(body.slice(0, 10)); res.end(body.slice(10)); }
    else if (req.url === "/big") { res.writeHead(200); res.write(" ".repeat(125001)); res.end(" ".repeat(125001)); }
    else if (req.url === "/headers") { /* deliberately stalled */ }
    else if (req.url === "/body") { res.writeHead(200); res.write("{"); }
    else if (req.url === "/redirect") { res.writeHead(302, { location: "/target" }); res.end(); }
    else if (req.url === "/wrong") { res.end(JSON.stringify({ payTo: OTHER_ASSET, resources: [] })); }
    else { targetHits++; res.end(body); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const options = path => ({ timeoutMs: 150, fetchImpl: async (url, init) => {
    assert.match(String(url), /^https:\/\/api\.cdp\.coinbase\.com\/platform\/v2\/x402\/discovery\/merchant\?payTo=/);
    const response = await fetch(origin + path, init);
    return new Response(response.body, { status: response.status, headers: response.headers });
  } });
  assert.equal((await fetchBazaarMerchant(T1_S94.payTo, options("/ok"))).resources.length, 0);
  await assert.rejects(fetchBazaarMerchant(T1_S94.payTo, options("/big")), /size cap/);
  for (const path of ["/headers", "/body"]) await assert.rejects(fetchBazaarMerchant(T1_S94.payTo, options(path)), /deadline/);
  await assert.rejects(fetchBazaarMerchant(T1_S94.payTo, options("/redirect")));
  assert.equal(targetHits, 0);
  await assert.rejects(fetchBazaarMerchant(T1_S94.payTo, options("/wrong")), /identity/);
});
