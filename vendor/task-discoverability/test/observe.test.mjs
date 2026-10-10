import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { assessInput } from "../src/construct.mjs";
import { buildSearchUrl, collectSearch, frozenSearchUrl } from "../src/collect.mjs";
import { findRepoFile } from "../src/locate.mjs";
import { observeCall, observeFilterHonor, observeReceipt } from "../src/observe.mjs";
import {
  CHECKED_READERS,
  FROZEN_QUERY,
  FROZEN_SERVICE,
  RECEIPT_RELATIVE,
  SOURCE,
} from "../src/pins.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const cases = JSON.parse(readFileSync(join(root, "fixtures/cases.json"), "utf8"));
const fullGet = JSON.parse(readFileSync(join(root, "fixtures/full-get-constructible.json"), "utf8"));

test("pins name the maintained search route and leave filters unassumed", () => {
  assert.equal(SOURCE.commit, "f8f83309706b14cc696962f0a002eeeb66c3dc26");
  assert.equal(SOURCE.version, "2.28.0");
  assert.equal(SOURCE.license, "Apache-2.0");
  assert.equal(SOURCE.searchUrl, "https://api.cdp.coinbase.com/platform/v2/x402/discovery/search");
  assert.deepEqual(SOURCE.cdpListDocumentedQuery, ["type", "limit", "offset"]);
  assert.equal(SOURCE.sdkSearchQuery.includes("payTo"), true);
  assert.equal(SOURCE.filtersAssumedHonored, false);
  assert.equal(CHECKED_READERS.every((reader) => reader.sellerQuestion === false), true);
});

test("frozen search URL matches the retained CDP query", () => {
  assert.equal(
    frozenSearchUrl(),
    "https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?query=Extract+the+readable+text+from+one+public+web+page+URL+into+structured+JSON.&type=http&limit=20",
  );
  assert.throws(() => buildSearchUrl({ query: "x" }, "https://example.test/search"), /unverified-search-route/);
});

test("collector refuses a live query unless the caller asks", () => {
  let called = false;
  const result = collectSearch(
    { query: FROZEN_QUERY, type: "http", limit: 20 },
    { fetchImpl: () => { called = true; } },
  );
  assert.equal(called, false);
  assert.equal(result.networkSent, false);
  assert.equal(result.credentialSent, false);
  assert.equal(result.state, "refused");
  assert.equal(result.url, frozenSearchUrl());
});

test("full GET schema with a satisfied required query is constructible and not executed", () => {
  const observation = observeCall(fullGet, { serviceUrl: FROZEN_SERVICE, observedAt: "2026-10-10T18:32:35Z" });
  const row = observation.rows[0];
  assert.equal(row.input.applicationConstructible, true);
  assert.equal(row.requestConstructible, true);
  assert.equal(row.invoked, false);
  assert.equal(row.paid, false);
  assert.equal(row.output.executable, false);
  assert.equal(row.output.missing, false);
  assert.equal(observation.exactService.inInspectedRows, true);
  assert.deepEqual(observation.exactService.ranks, [1]);
  assert.equal(observation.exactService.catalogMembership, "unknown");
  assert.equal(observation.exactService.requestConstructibleFromThisResponse, true);
  assert.equal(observation.rank.method, "response-order");
  assert.equal(observation.rank.scoreUsed, false);
  assert.equal(observation.baseline.claims.moat, false);
  assert.equal(observation.baseline.claims.saving, false);
  assert.equal(observation.baseline.claims.customer, false);
  assert.equal(observation.authenticBuyerEncounter, false);
  assert.equal(observation.decision.causality, "not-this-query");
});

test("envelope required keys do not make an application body constructible", () => {
  const observation = observeCall(cases.envelopePost, { serviceUrl: "https://example.test/extract" });
  const row = observation.rows[0];
  assert.equal(row.input.applicationConstructible, "unknown");
  assert.equal(row.input.gaps.includes("body-required-list-absent"), true);
  assert.equal(row.requestConstructible, false);
  assert.equal(observation.exactService.requestConstructibleFromThisResponse, false);
});

test("a query example without a required-field schema stays unknown", () => {
  const observation = observeCall(cases.queryExampleOnly, { serviceUrl: "https://example.test/read" });
  assert.equal(observation.rows[0].input.applicationConstructible, "unknown");
  assert.equal(observation.rows[0].input.gaps.includes("query-example-without-required-schema"), true);
});

test("missing output is explicit and the request is still unexecuted", () => {
  const observation = observeCall(cases.missingOutput, { serviceUrl: FROZEN_SERVICE });
  const row = observation.rows[0];
  assert.equal(row.output.missing, true);
  assert.equal(row.output.schemaPresent, false);
  assert.equal(row.output.executable, false);
  assert.equal(row.requestConstructible, true);
  assert.equal(row.invoked, false);
});

test("invalid schema is refused as a constructed request", () => {
  const observation = observeCall(cases.invalidSchema, { serviceUrl: "https://example.test/bad" });
  assert.equal(observation.rows[0].input.schemaState, "invalid");
  assert.equal(observation.rows[0].input.schemaError, "required-key-absent");
  assert.equal(observation.rows[0].input.applicationConstructible, false);
  assert.equal(observation.rows[0].requestConstructible, false);
});

test("unresolved schema refs are not constructible", () => {
  const observation = observeCall(cases.unresolvedRef, { serviceUrl: "https://example.test/ref" });
  assert.equal(observation.rows[0].input.applicationConstructible, false);
  assert.equal(observation.rows[0].input.gaps.includes("unresolved-schema-ref:url"), true);
});

test("contradictory duplicate amounts stay separate rows", () => {
  const observation = observeCall(cases.contradictoryDuplicates, { serviceUrl: FROZEN_SERVICE });
  assert.equal(observation.rows.length, 2);
  assert.deepEqual(observation.exactService.ranks, [1, 2]);
  assert.equal(observation.duplicates[0].contradictory, true);
  assert.equal(observation.duplicates[0].fields.includes("amount"), true);
  assert.equal(observation.exactService.requestConstructibleFromThisResponse, false);
  assert.equal(observation.rows[0].payment.amount, "5000");
  assert.equal(observation.rows[1].payment.amount, "9000");
});

test("cross-network accepts are not one payment identity", () => {
  const observation = observeCall(cases.crossNetwork, { serviceUrl: FROZEN_SERVICE });
  const payment = observation.rows[0].payment;
  assert.equal(payment.state, "multiple");
  assert.equal(payment.collapsed, false);
  assert.equal(payment.identities.length, 2);
  assert.equal(payment.identities[0].network, "eip155:8453");
  assert.equal(payment.identities[1].network, "eip155:1");
  assert.equal(payment.identities[0].asset === payment.identities[1].asset, false);
  assert.equal(observation.rows[0].requestConstructible, false);
  assert.equal(observation.rows[0].input.applicationConstructible, true);
});

test("an unchanged payTo page is observed and does not prove the filter was ignored", () => {
  const ignored = observeFilterHonor(cases.ignoredPayTo.baseline, cases.ignoredPayTo.filtered, "payTo");
  assert.equal(ignored.honored, "unknown");
  assert.equal(ignored.reason, "page-unchanged-identity-unobserved");
  assert.equal(ignored.pageUnchanged, true);
  assert.equal(ignored.baselineTotal, 32247);
  assert.equal(ignored.filteredTotal, 32247);
  assert.equal(ignored.baselineBytes, 81541);
  assert.equal(ignored.filteredBytes, 81541);
  assert.equal(ignored.firstResource, "https://www.ax1.vc/api/dashboard/q-verdict/resource");
  assert.equal(ignored.documentedOnCdpList, false);
  assert.equal(ignored.assumedHonored, false);
  assert.equal(ignored.identityContradiction, false);
  const changed = observeFilterHonor(cases.ignoredPayTo.baseline, cases.ignoredPayTo.changed, "payTo");
  assert.equal(changed.honored, "unknown");
  assert.equal(changed.reason, "page-differs-honor-unproven");
  assert.equal(changed.pageUnchanged, false);
});

test("partialResults true does not turn a missing service into catalog absence", () => {
  const observation = observeCall(cases.partialTrue, { serviceUrl: FROZEN_SERVICE });
  assert.equal(observation.coverage.partialResults, true);
  assert.equal(observation.coverage.matchSetTruncated, true);
  assert.equal(observation.exactService.inInspectedRows, false);
  assert.equal(observation.exactService.catalogMembership, "unknown");
  assert.equal(observation.coverage.unboundedCatalogMembership, "unknown");
  assert.equal(observation.coverage.observedCountIsCatalogMembership, false);
});

test("missing pagination leaves the remainder unknown", () => {
  const observation = observeCall(cases.missingPagination, { serviceUrl: FROZEN_SERVICE });
  assert.equal(observation.coverage.partialResults, false);
  assert.equal(observation.coverage.paginationPresent, false);
  assert.equal(observation.coverage.cursor, null);
  assert.equal(observation.coverage.catalogRemainder, "unknown");
  assert.equal(observation.coverage.rowsBeyondThisResponse, "not-indicated");
  assert.equal(observation.coverage.reportedPageTotal, "unknown");
  assert.equal(observation.coverage.unboundedCatalogMembership, "unknown");
  assert.equal(observation.query.limitHonor, "unknown");
});

test("a returned count above the advisory limit shows the limit was not honored", () => {
  const observation = observeCall(cases.limitIgnored, { serviceUrl: FROZEN_SERVICE });
  assert.equal(observation.query.limitRole, "advisory");
  assert.equal(observation.query.limitHonor, false);
  assert.equal(observation.coverage.inspectedCount, 3);
});

test("a missing source clock stays unknown and a present clock can be stale", () => {
  const observation = observeCall(cases.clocks, {
    serviceUrl: "https://example.test/old",
    observedAt: "2026-10-10T00:00:00.000Z",
    staleAfterMs: 86_400_000,
  });
  assert.equal(observation.rows[0].sourceClock.freshness, "stale");
  assert.equal(typeof observation.rows[0].sourceClock.ageMs, "number");
  assert.equal(observation.rows[1].sourceClock.freshness, "unknown");
  assert.equal(observation.rows[1].sourceClock.reason, "source-clock-missing");
  const unlabeled = observeCall(cases.clocks, {
    serviceUrl: "https://example.test/old",
    observedAt: "2026-10-10T00:00:00.000Z",
  });
  assert.equal(unlabeled.rows[0].sourceClock.freshness, "known");
  assert.equal(unlabeled.rows[1].sourceClock.freshness, "unknown");
});

test("timeout and refusal keep encounter unknown rather than zero", () => {
  const timeout = observeCall(cases.timeout, { serviceUrl: FROZEN_SERVICE });
  assert.equal(timeout.transport.state, "unavailable");
  assert.equal(timeout.transport.reason, "timeout");
  assert.equal(timeout.exactService.inInspectedRows, "unknown");
  assert.equal(timeout.coverage.declaredReturnedCount, "unknown");
  assert.equal(timeout.coverage.measuredZero, false);
  const refusal = observeCall(cases.refusal, { serviceUrl: FROZEN_SERVICE });
  assert.equal(refusal.transport.state, "refused");
  assert.equal(refusal.transport.httpStatus, 405);
  assert.equal(refusal.transport.allow, "GET");
  assert.equal(refusal.exactService.inInspectedRows, "unknown");
  assert.equal(refusal.coverage.measuredZero, false);
});

test("an empty resource list is a measured zero and a missing list is unknown", () => {
  const empty = observeCall(cases.emptyResources, { serviceUrl: FROZEN_SERVICE });
  assert.equal(empty.coverage.measuredZero, true);
  assert.equal(empty.coverage.declaredReturnedCount, 0);
  assert.equal(empty.exactService.inInspectedRows, false);
  assert.equal(empty.exactService.catalogMembership, "unknown");
  const missing = observeCall(cases.statusWithoutList, { serviceUrl: FROZEN_SERVICE });
  assert.equal(missing.transport.state, "invalid");
  assert.equal(missing.coverage.declaredReturnedCount, "unknown");
  assert.equal(missing.coverage.measuredZero, false);
  assert.equal(missing.exactService.inInspectedRows, "unknown");
});

test("reported calls stay separate from query visibility", () => {
  const zero = observeCall(cases.callsZero, { serviceUrl: FROZEN_SERVICE });
  assert.equal(zero.rows[0].reportedCalls.state, "measured");
  assert.equal(zero.rows[0].reportedCalls.value, "0");
  assert.equal(zero.rows[0].queryVisibility, "in-this-response");
  assert.equal(zero.exactService.queryVisibility, "in-this-response");
  const unknown = observeCall(cases.callsUnknown, { serviceUrl: FROZEN_SERVICE });
  assert.equal(unknown.rows[0].reportedCalls.state, "unknown");
  assert.equal(unknown.rows[0].reportedCalls.value, null);
  assert.equal(unknown.exactService.queryVisibility, "not-in-inspected-rows");
});

test("a capped body is not decoded", () => {
  const observation = observeCall(cases.boundedBody, { serviceUrl: FROZEN_SERVICE, bodyCapBytes: 8 });
  assert.equal(observation.transport.state, "bounded");
  assert.equal(observation.rows.length, 0);
  assert.equal(observation.exactService.inInspectedRows, "unknown");
  assert.equal(observation.coverage.declaredReturnedCount, "unknown");
});

test("response order is the rank when a score field is present", () => {
  const observation = observeCall(cases.scoreIgnored, { serviceUrl: "https://example.test/second" });
  assert.equal(observation.rank.scoreUsed, false);
  assert.equal(observation.rows[0].responseOrder, 1);
  assert.equal(observation.rows[0].scoreIgnored, 0.99);
  assert.deepEqual(observation.exactService.ranks, [2]);
});

test("a retained projection does not promote declared rows or the old constructible flag", () => {
  const observation = observeCall(cases.retainedSearch, {
    serviceUrl: FROZEN_SERVICE,
    observedAt: "2026-10-10T18:32:35Z",
  });
  assert.equal(observation.coverage.declaredReturnedCount, 11);
  assert.equal(observation.coverage.inspectedCount, 2);
  assert.equal(observation.coverage.uninspectedCount, 9);
  assert.equal(observation.coverage.promotedUninspectedRows, false);
  assert.equal(observation.rows.length, 2);
  assert.equal(observation.collector.declaredOursCount, 0);
  assert.equal(observation.collector.reinspectedByThisConsumer, false);
  assert.equal(observation.collector.declarationIsSchemaInspection, false);
  assert.equal(observation.rows[0].input.applicationConstructible, "unknown");
  assert.equal(observation.rows[0].input.priorConstructibleFlag, true);
  assert.equal(observation.rows[0].input.priorFlagAdopted, false);
  assert.equal(observation.rows[0].output.schemaRetained, false);
  assert.equal(observation.rows[0].output.missing, false);
  assert.equal(observation.rows[1].output.missing, true);
  assert.equal(observation.rows[1].output.executable, false);
  assert.equal(observation.exactService.inInspectedRows, false);
  assert.equal(observation.exactService.inUninspectedRemainder, "unknown");
  assert.equal(observation.exactService.requestConstructibleFromThisResponse, false);
  assert.equal(observation.coverage.partialResults, false);
  assert.equal(observation.coverage.unboundedCatalogMembership, "unknown");
  assert.equal(observation.query.limitRole, "advisory");
  assert.equal(observation.query.limitHonor, "unknown");
  assert.equal(observation.query.requested.payTo, undefined);
  assert.equal(observation.decision.causality, "unresolved");
  assert.deepEqual(observation.decision.openExplanations, ["retrieval-terms", "response-order", "provider-index"]);
  assert.equal(observation.decision.localMerchantSchemaDefectFound, false);
  assert.equal(observation.decision.rootReplay.usedAsStoredBody, false);
  assert.equal(observation.decision.rootReplay.retainedInThisArtifact, false);
  assert.equal(observation.baseline.sameInput, true);
  assert.equal(observation.baseline.transformReplacesGet, false);
  assert.equal(observation.baseline.integrationCost, "unknown");
  assert.equal(observation.existingReadersCompleteSellerQuestion, false);
});

test("non-object resources are invalid inputs", () => {
  const assessed = assessInput(null);
  assert.equal(assessed.applicationConstructible, false);
  assert.equal(assessed.schemaError, "resource-not-object");
});

test("sources do not hardcode a VM path or send credentials", () => {
  for (const name of ["cli.mjs", "observe.mjs", "collect.mjs", "construct.mjs", "locate.mjs", "pins.mjs"]) {
    const text = readFileSync(join(root, "src", name), "utf8");
    assert.equal(text.includes("/workspace"), false, name);
    assert.equal(text.includes("/tmp/"), false, name);
    assert.equal(text.includes("Authorization"), false, name);
  }
});

test("CLI refuses --live and decodes a fixture", () => {
  const refused = spawnSync(process.execPath, ["src/cli.mjs", "--live"], { cwd: root, encoding: "utf8" });
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /live-query-refused/);
  const decoded = spawnSync(process.execPath, [
    "src/cli.mjs",
    "--fixture",
    "fixtures/full-get-constructible.json",
    "--service",
    FROZEN_SERVICE,
  ], { cwd: root, encoding: "utf8" });
  assert.equal(decoded.status, 0, decoded.stderr);
  const body = JSON.parse(decoded.stdout);
  assert.equal(body.service.requestConstructible, true);
  assert.equal(body.rows[0].invoked, false);
  assert.equal(body.rows[0].constructedRequest.query.url, "https://example.com");
  assert.equal(body.provenance.officialLiveRead, false);
  assert.equal(body.provenance.networkSent, false);
});

test("retained 161000 receipt answers this query without promoting five rows to eleven", (t) => {
  const receiptPath = process.env.PILOT_RECEIPT || findRepoFile(root, RECEIPT_RELATIVE);
  if (!receiptPath) {
    t.skip("receipt not supplied");
    return;
  }
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  const observation = observeReceipt(receipt, { serviceUrl: FROZEN_SERVICE });
  const search = observation.taskSearch;
  assert.equal(observation.decoderSentCredential, false);
  assert.equal(observation.receiptCredentialSent, false);
  assert.equal(search.coverage.declaredReturnedCount, 11);
  assert.equal(search.coverage.inspectedCount, 5);
  assert.equal(search.coverage.uninspectedCount, 6);
  assert.equal(search.rows.length, 5);
  assert.equal(search.collector.declaredOursCount, 0);
  assert.equal(search.exactService.inInspectedRows, false);
  assert.equal(search.exactService.inUninspectedRemainder, "unknown");
  assert.equal(search.exactService.catalogMembership, "unknown");
  assert.equal(search.exactService.requestConstructibleFromThisResponse, false);
  assert.equal(search.rows.every((row) => row.input.priorFlagAdopted === false), true);
  assert.equal(search.rows.every((row) => row.input.applicationConstructible === "unknown"), true);
  assert.equal(search.rows[2].resource, "https://web.openverbs.com/v1/extract");
  assert.equal(search.rows[2].output.missing, true);
  assert.equal(search.rows[0].resource, "https://api.oblique.markets/api/v1/paid/web-extract");
  assert.equal(search.rows[0].output.schemaRetained, false);
  assert.equal(search.query.text, FROZEN_QUERY);
  assert.equal(search.baseline.sameInput, true);
  assert.equal(search.baseline.sourceElapsedMs, 953.2);
  assert.equal(observation.listPayToFilter.honored, "unknown");
  assert.equal(observation.listPayToFilter.reason, "page-unchanged-identity-unobserved");
  assert.equal(observation.listPayToFilter.pageUnchanged, true);
  assert.equal(observation.listPayToFilter.baselineTotal, 32247);
  assert.equal(observation.listPayToFilter.filteredTotal, 32247);
  assert.equal(observation.listPayToFilter.baselineBytes, 81541);
  assert.equal(observation.listPayToFilter.firstResource, "https://www.ax1.vc/api/dashboard/q-verdict/resource");
  assert.equal(observation.listPayToFilter.documentedOnCdpList, false);
  assert.equal(observation.provenance.officialLiveRead, false);
  assert.equal(observation.provenance.networkSent, false);
  assert.equal(search.source.officialLiveRead, false);
  assert.equal(search.source.networkSent, false);
  assert.equal(search.provenance.pinnedRouteMatch, true);
  assert.equal(observation.hostDescriptor.llmsStatus, 200);
  assert.equal(observation.hostDescriptor.openapiStatus, 200);
  assert.equal(observation.hostDescriptor.extractPathPresent, true);
  assert.match(search.decision.nextAction, /Leave price, payee, and payment authority unchanged/);
  assert.equal(search.decision.rootReplay.exactServicePresent, false);
});
