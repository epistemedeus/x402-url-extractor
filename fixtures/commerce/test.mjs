import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { evaluateListingIdentity, SCHEMAS } from "agent-payment-policy";
import {
  COMMERCE_FIXTURE_PRODUCT,
  SDS_EXTRACT,
  UNPAID_MATERIALIZE_SCHEMA,
  classifyFixture,
  createFixtureFetch,
  loadFixture,
  loadManifest,
  probeExitCode,
  refusedFlag,
  runCommerceFixture,
  runCommerceFixtureCli,
  runReceipt,
  runUnpaidMaterialize,
  runWrapper,
  usage,
} from "./check.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECK = join(HERE, "check.mjs");
const NOW = Date.parse("2026-09-17T00:00:00.000Z");
const ROOT = join(HERE, "../..");

function spawnCheck(args) {
  return spawnSync(process.execPath, [CHECK, ...args], {
    encoding: "utf8",
    cwd: ROOT,
  });
}

function fixturePath(rel) {
  return join(HERE, rel);
}

test("manifest pins unpublished commerce fixtures and refuses live/registry mutation", () => {
  const manifest = loadManifest();
  assert.equal(manifest.unpublished, true);
  assert.equal(manifest.liveListing, false);
  assert.equal(manifest.boundary.paymentSent, false);
  assert.equal(manifest.boundary.cdpPolled, false);
  assert.equal(manifest.boundary.neomorphicIoTouched, false);
  assert.equal(manifest.cases.length, 9);
  const docs = readFileSync(join(HERE, "README.md"), "utf8");
  assert.match(docs, /fixtures\/commerce\/check\.mjs/);
  assert.match(docs, /forged-offer-receipt/);
  assert.match(docs, /charged:false/);
  assert.doesNotMatch(docs, /neomorphic\.io/);
  assert.equal(refusedFlag(["--live"]), "--live");
  assert.equal(refusedFlag(["--cdp"]), "--cdp");
  assert.match(usage(), /Never pays/);
});

test("fixture fetch serves validator and search only", async () => {
  const fixture = loadFixture(fixturePath("unpaid-materialize/seeded-absence.json"));
  const fetchImpl = createFixtureFetch(fixture);
  const validator = await fetchImpl("https://api.cdp.coinbase.com/platform/v2/x402/validate");
  const search = await fetchImpl("https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?query=x");
  assert.equal((await validator.json()).simulation.outcome, "accepted");
  assert.deepEqual((await search.json()).resources, []);
  await assert.rejects(
    () => fetchImpl("https://api.cdp.coinbase.com/platform/v2/x402/discovery/merchant?payTo=0x1"),
    /refused non-fixture fetch/,
  );
});

test("seeded-absence drives unpaid materialize to provider_accepted_not_materialized", async () => {
  const lines = [];
  const code = await runCommerceFixtureCli(
    [fixturePath("unpaid-materialize/seeded-absence.json")],
    { stdout: (value) => lines.push(String(value)), stderr: () => {} },
  );
  const report = JSON.parse(lines.join(""));
  assert.equal(code, 1);
  assert.equal(report.schemaVersion, UNPAID_MATERIALIZE_SCHEMA);
  assert.equal(report.product, COMMERCE_FIXTURE_PRODUCT);
  assert.equal(report.ok, false);
  assert.equal(report.charged, false);
  assert.equal(report.verdict, "provider_accepted_not_materialized");
  assert.equal(report.materialization.state, "provider_accepted_not_materialized");
  assert.equal(report.materialization.validator.simulationOutcome, "accepted");
  assert.equal(report.materialization.catalog.exactResourceFound, false);
  assert.equal(report.listingIdentity.status, "route_absent");
  assert.equal(report.listingIdentity.decision, "absent");
  assert.equal(report.wrapper.charged, false);
  assert.equal(report.wrapper.httpStatus, 402);
  assert.equal(report.claimsRejected, true);
  assert.ok(report.states.includes("provider_accepted_not_materialized"));
  assert.ok(report.states.includes("route_absent"));
  assert.ok(report.states.includes("charged:false"));
  assert.equal(report.boundary.paymentSent, false);
  assert.equal(report.boundary.cdpPolled, false);

  const spawned = spawnCheck(["fixtures/commerce/unpaid-materialize/seeded-absence.json"]);
  assert.equal(spawned.status, 1, spawned.stderr);
  assert.match(spawned.stdout, /provider_accepted_not_materialized/);
  assert.match(spawned.stdout, /route_absent/);
  assert.match(spawned.stdout, /"charged": false/);
});

test("sds-extract-canonical unpaid materialize is canonical charged:false", async () => {
  const identity = evaluateListingIdentity({
    schemaVersion: SCHEMAS.listingIdentityObservation,
    target: {
      canonicalOrigin: SDS_EXTRACT.origin,
      route: SDS_EXTRACT.route,
      settlementIdentity: SDS_EXTRACT.settlementIdentity,
    },
    sources: ["coinbase-bazaar"],
    records: [{
      source: "coinbase-bazaar",
      url: SDS_EXTRACT.resource,
      settlementIdentity: SDS_EXTRACT.settlementIdentity,
      rank: 1,
    }],
  }, { now: NOW });
  assert.equal(identity.decision, "canonical");
  assert.equal(identity.sources[0].ownershipProven, false);

  const report = await runUnpaidMaterialize(
    loadFixture(fixturePath("unpaid-materialize/sds-extract-canonical.json")),
    { now: NOW },
  );
  assert.equal(report.ok, true);
  assert.equal(report.verdict, "canonical");
  assert.equal(report.materialization.state, "materialized");
  assert.equal(report.listingIdentity.decision, "canonical");
  assert.equal(report.discoveryDrift.status, "match");
  assert.equal(report.wrapper.charged, false);
  assert.equal(report.bazaarTracker.routePresent, true);
  assert.equal(probeExitCode(report), 0);

  const spawned = spawnCheck(["fixtures/commerce/unpaid-materialize/sds-extract-canonical.json"]);
  assert.equal(spawned.status, 0, spawned.stderr);
  assert.match(spawned.stdout, /"decision": "canonical"/);
  assert.match(spawned.stdout, /"state": "materialized"/);
});

test("amount-mismatch is discovery-drift mismatch and exits 1", async () => {
  const report = await runUnpaidMaterialize(
    loadFixture(fixturePath("unpaid-materialize/amount-mismatch.json")),
    { now: NOW },
  );
  assert.equal(report.ok, false);
  assert.equal(report.verdict, "mismatch");
  assert.equal(report.discoveryDrift.status, "mismatch");
  assert.equal(report.discoveryDrift.amountAtomic.catalog, "5000");
  assert.equal(report.discoveryDrift.amountAtomic.live, "10000");
  assert.equal(report.claimsRejected, true);

  const spawned = spawnCheck(["fixtures/commerce/unpaid-materialize/amount-mismatch.json"]);
  assert.equal(spawned.status, 1, spawned.stderr);
  assert.match(spawned.stdout, /"status": "mismatch"/);
  assert.match(spawned.stdout, /"catalog": "5000"/);
  assert.match(spawned.stdout, /"live": "10000"/);
});

test("charged:true wrapper evidence is non-conforming and exits 1", async () => {
  const report = await runCommerceFixture(
    loadFixture(fixturePath("unpaid-materialize/wrapper-charged-true.json")),
    { now: NOW },
  );
  assert.equal(report.ok, false);
  assert.equal(report.verdict, "wrapper_nonconforming");
  assert.equal(report.wrapper.charged, true);
  assert.equal(report.wrapper.conformant, false);
  assert.equal(report.claimsRejected, true);
  assert.equal(probeExitCode(report), 1);

  const spawned = spawnCheck(["fixtures/commerce/unpaid-materialize/wrapper-charged-true.json"]);
  assert.equal(spawned.status, 1, spawned.stderr);
  assert.match(spawned.stdout, /wrapper_nonconforming/);
});

test("SDS extract is one unpaid paywall; two-paywall wrap is refused", () => {
  const one = runWrapper(loadFixture(fixturePath("wrapper/sds-extract-one-paywall.json")));
  assert.equal(one.ok, true);
  assert.equal(one.verdict, "one_paywall");
  assert.equal(one.paywallCount, 1);
  assert.equal(one.settlementOwnerCount, 1);
  assert.equal(one.wrapper.charged, false);

  const two = runWrapper(loadFixture(fixturePath("wrapper/two-paywall-wrap.json")));
  assert.equal(two.ok, false);
  assert.equal(two.verdict, "two_paywall");
  assert.equal(two.paywallCount, 2);
  assert.equal(two.settlementOwnerCount, 2);
  assert.equal(two.claimsRejected, true);

  const spawnedOne = spawnCheck(["fixtures/commerce/wrapper/sds-extract-one-paywall.json"]);
  assert.equal(spawnedOne.status, 0, spawnedOne.stderr);
  const spawnedTwo = spawnCheck(["fixtures/commerce/wrapper/two-paywall-wrap.json"]);
  assert.equal(spawnedTwo.status, 1, spawnedTwo.stderr);
  assert.match(spawnedTwo.stdout, /two_paywall/);
});

test("seeded forged offer receipt is rejected as foreign_receipt_signer", async () => {
  const fixture = loadFixture(fixturePath("receipts/forged-offer-receipt.json"));
  assert.equal(classifyFixture(fixture), "receipt");
  assert.equal(fixture.claims.ok, true);
  const report = await runReceipt(fixture);
  assert.equal(report.ok, false);
  assert.equal(report.rejected, true);
  assert.equal(report.verdict, "forged_receipt_rejected");
  assert.equal(report.code, "foreign_receipt_signer");
  assert.equal(report.formatValid, true);
  assert.equal(report.recoveredSigner, "0x3E53A455cA724B87E9741CD7F025a1F9D3395106");
  assert.notEqual(String(report.recoveredSigner).toLowerCase(), String(fixture.merchantSigner).toLowerCase());
  assert.equal(report.claimedPayer, "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  assert.equal(report.boundary.paymentSent, false);
  assert.equal(report.claimsRejected, true);

  const spawned = spawnCheck(["fixtures/commerce/receipts/forged-offer-receipt.json"]);
  assert.equal(spawned.status, 1, spawned.stderr);
  assert.match(spawned.stdout, /forged_receipt_rejected/);
  assert.match(spawned.stdout, /foreign_receipt_signer/);
  assert.match(spawned.stdout, /0x3E53A455cA724B87E9741CD7F025a1F9D3395106/);
});

test("seeded forged signature receipt is rejected as invalid_receipt_signature", async () => {
  const report = await runReceipt(loadFixture(fixturePath("receipts/forged-signature-receipt.json")));
  assert.equal(report.ok, false);
  assert.equal(report.code, "invalid_receipt_signature");
  assert.equal(report.rejected, true);
  const spawned = spawnCheck(["fixtures/commerce/receipts/forged-signature-receipt.json"]);
  assert.equal(spawned.status, 1, spawned.stderr);
  assert.match(spawned.stdout, /invalid_receipt_signature/);
});

test("seeded forged attempt receipt is rejected before RPC", async () => {
  const report = await runReceipt(loadFixture(fixturePath("receipts/forged-attempt-receipt.json")));
  assert.equal(report.ok, false);
  assert.equal(report.code, "secret_material_refused");
  assert.match(report.message, /signature/);
  const spawned = spawnCheck(["fixtures/commerce/receipts/forged-attempt-receipt.json"]);
  assert.equal(spawned.status, 1, spawned.stderr);
  assert.match(spawned.stdout, /secret_material_refused/);
});

test("CLI refuses --live and missing fixtures", () => {
  const live = spawnCheck(["--live"]);
  assert.equal(live.status, 2);
  assert.match(live.stderr, /--live is refused/);
  const missing = spawnCheck(["fixtures/commerce/receipts/does-not-exist.json"]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /malformed_fixture/);
  const empty = spawnCheck([]);
  assert.equal(empty.status, 2);
});

test("source tree does not pay, poll CDP, or touch neomorphic.io", () => {
  const check = readFileSync(CHECK, "utf8");
  const manifest = readFileSync(join(HERE, "MANIFEST.json"), "utf8");
  assert.doesNotMatch(check, /neomorphic\.io/);
  assert.doesNotMatch(manifest, /neomorphic\.io/);
  assert.doesNotMatch(check, /setInterval\(/);
  assert.match(check, /auditCoinbaseMaterialization/);
  assert.match(check, /verifyReceiptSignatureEIP712/);
  assert.match(check, /charged:false/);
});
