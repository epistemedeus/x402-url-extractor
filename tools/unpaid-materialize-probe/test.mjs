import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { SELLER_INTEGRITY_AUDIT_EXAMPLE } from "../../seller-integrity-audit.mjs";
import {
  compareDiscoveryLive,
  observationFromSellerIntegrity,
} from "../../discovery-drift.mjs";
import { evaluateListingIdentity, SCHEMAS } from "agent-payment-policy";
import {
  AMOUNT_MISMATCH_COMMAND,
  AMOUNT_MISMATCH_STATE,
  BUNDLED_CASES,
  CATALOG_REACH_GAP_STATES,
  FAILURE_STATES,
  OPERATOR_SURFACE,
  REFUSED_OPERATOR_FLAGS,
  SDS_BAZAAR_TRACKER_PIN,
  SDS_BAZAAR_TRACKER_TESTS,
  SDS_EXTRACT,
  SDS_EXTRACT_IDENTITY_COMMAND,
  SEEDED_ABSENCE_COMMAND,
  UNPAID_MATERIALIZE_SCHEMA,
  createFixtureFetch,
  inspectBazaarTrackerState,
  loadFixture,
  probeExitCode,
  refusedFlag,
  runUnpaidMaterializeCli,
  runUnpaidMaterializeProbe,
  usage,
} from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "cli.mjs");
const NOW = Date.parse("2026-09-17T00:00:00.000Z");

function spawnCase(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    cwd: join(HERE, "../.."),
  });
}

test("pins copy-paste operator commands and refuses collector flags", () => {
  const docs = readFileSync(join(HERE, "README.md"), "utf8");
  assert.equal(SEEDED_ABSENCE_COMMAND, "node tools/unpaid-materialize-probe/cli.mjs seeded-absence");
  assert.equal(AMOUNT_MISMATCH_COMMAND, "node tools/unpaid-materialize-probe/cli.mjs amount-mismatch");
  assert.equal(SDS_EXTRACT_IDENTITY_COMMAND, "node tools/unpaid-materialize-probe/cli.mjs sds-extract-identity");
  assert.equal(docs.includes(SEEDED_ABSENCE_COMMAND), true);
  assert.equal(docs.includes(AMOUNT_MISMATCH_COMMAND), true);
  assert.equal(docs.includes(SDS_EXTRACT_IDENTITY_COMMAND), true);
  assert.equal(SDS_BAZAAR_TRACKER_TESTS, 13);
  assert.match(docs, /775051602d91f42ca1aa920054cfd7a451982940/);
  assert.match(docs, /charged:false/);
  assert.match(docs, /never refreshes Bazaar as owner/);
  assert.match(docs, /x402scan fork/);
  assert.equal(refusedFlag(["--live"]), "--live");
  assert.equal(refusedFlag(["--cdp"]), "--cdp");
  assert.equal(refusedFlag(["--refresh"]), "--refresh");
  assert.equal(refusedFlag(["--poll"]), "--poll");
  assert.equal(refusedFlag(["seeded-absence"]), null);
  assert.match(usage(), /No CDP poll/);
  assert.deepEqual([...REFUSED_OPERATOR_FLAGS], ["--live", "--refresh", "--cdp", "--poll"]);
  assert.equal(FAILURE_STATES.includes("provider_accepted_not_materialized"), true);
  assert.equal(FAILURE_STATES.includes(AMOUNT_MISMATCH_STATE), true);
  assert.deepEqual([...CATALOG_REACH_GAP_STATES], ["provider_accepted_not_materialized", "route_absent"]);
});

test("operator surface: each fixture maps to one invariant and the documented CLI exit", async () => {
  const docs = readFileSync(join(HERE, "README.md"), "utf8");
  const names = Object.keys(OPERATOR_SURFACE);
  assert.deepEqual(names, ["seeded-absence", "amount-mismatch", "sds-extract-identity", "wrapper-charged-true"]);
  for (const name of names) {
    const spec = OPERATOR_SURFACE[name];
    assert.match(docs, new RegExp(spec.invariant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(spec.expectedExit === 0 || spec.expectedExit === 1, true, name);
    const replay = spawnCase(["replay", "--fixture", spec.fixture]);
    assert.equal(replay.status, spec.expectedExit, `${name} replay stderr=${replay.stderr}`);
    const report = JSON.parse(replay.stdout);
    assert.equal(report.verdict, spec.expectedVerdict, name);
    assert.equal(probeExitCode(report), spec.expectedExit, name);
    for (const state of spec.expectedStates) {
      assert.equal(report.states.includes(state), true, `${name} missing state ${state}`);
    }
    if (spec.bundled) {
      const bundled = spawnCase([spec.bundled]);
      assert.equal(bundled.status, spec.expectedExit, `${name} bundled stderr=${bundled.stderr}`);
      assert.equal(JSON.parse(bundled.stdout).verdict, spec.expectedVerdict, name);
      assert.equal(bundled.status, replay.status, `${name} bundled vs replay exit`);
    }
  }
});

test("probeExitCode fail-closes catalog-reach gap and amount mismatch even if ok is true", () => {
  assert.equal(probeExitCode({
    ok: true,
    verdict: "provider_accepted_not_materialized",
    states: ["provider_accepted_not_materialized", "route_absent"],
  }), 1);
  assert.equal(probeExitCode({
    ok: true,
    verdict: "mismatch",
    states: ["mismatch"],
  }), 1);
  assert.equal(probeExitCode({
    ok: true,
    verdict: "canonical",
    states: ["canonical", "charged:false", "match"],
  }), 0);
});

test("fixture fetch serves validator and search only and refuses other URLs", async () => {
  const fixture = loadFixture(BUNDLED_CASES["seeded-absence"]);
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

test("CLI seeded-absence: validator-accepted unpaid 402 plus empty search is route_absent / provider_accepted_not_materialized", async () => {
  const lines = [];
  const code = await runUnpaidMaterializeCli(["seeded-absence"], {
    stdout: (value) => lines.push(String(value)),
    stderr: () => {},
  });
  const report = JSON.parse(lines.join(""));
  assert.equal(code, 1);
  assert.equal(report.schemaVersion, UNPAID_MATERIALIZE_SCHEMA);
  assert.equal(report.ok, false);
  assert.equal(report.charged, false);
  assert.equal(report.verdict, "provider_accepted_not_materialized");
  assert.equal(report.materialization.state, "provider_accepted_not_materialized");
  assert.equal(report.materialization.validator.simulationOutcome, "accepted");
  assert.equal(report.materialization.catalog.exactResourceFound, false);
  assert.equal(report.listingIdentity.status, "route_absent");
  assert.equal(report.listingIdentity.decision, "absent");
  assert.equal(report.listingIdentity.ownershipProven, false);
  assert.equal(report.wrapper.charged, false);
  assert.equal(report.wrapper.httpStatus, 402);
  assert.equal(report.bazaarTracker.mode, "readback");
  assert.equal(report.bazaarTracker.liveRefresh, false);
  assert.equal(report.bazaarTracker.cdpPolled, false);
  assert.equal(report.bazaarTracker.ownerRefresh, false);
  assert.equal(report.bazaarTracker.routePresent, false);
  assert.ok(report.states.includes("route_absent"));
  assert.ok(report.states.includes("provider_accepted_not_materialized"));
  assert.ok(report.states.includes("charged:false"));
  assert.ok(report.notClaimed.includes("did not treat catalog absence as demand"));
  assert.doesNotMatch(JSON.stringify(report), /buyer demand|treats absence as demand/i);
  assert.equal(report.reused.includes("evaluateListingIdentity"), true);
  assert.equal(report.reused.includes("auditCoinbaseMaterialization"), true);

  const spawned = spawnCase(["seeded-absence"]);
  assert.equal(spawned.status, 1, spawned.stderr);
  assert.match(spawned.stdout, /provider_accepted_not_materialized/);
  assert.match(spawned.stdout, /route_absent/);
  assert.match(spawned.stdout, /"charged": false/);
});

test("CLI amount-mismatch: 5000 vs 10000 atomic is discovery-drift mismatch", async () => {
  const lines = [];
  const code = await runUnpaidMaterializeCli(["amount-mismatch"], {
    stdout: (value) => lines.push(String(value)),
    stderr: () => {},
  });
  const report = JSON.parse(lines.join(""));
  assert.equal(code, 1);
  assert.equal(report.ok, false);
  assert.equal(report.verdict, "mismatch");
  assert.equal(report.discoveryDrift.status, "mismatch");
  assert.equal(report.discoveryDrift.observedMatch, false);
  assert.equal(report.discoveryDrift.resolvedCause, false);
  assert.equal(report.discoveryDrift.amountAtomic.catalog, "5000");
  assert.equal(report.discoveryDrift.amountAtomic.live, "10000");
  assert.equal(report.discoveryDrift.amountAtomic.disposition, "drifted");
  assert.equal(report.materialization.state, "materialized");
  assert.equal(report.listingIdentity.status, "canonical");
  assert.equal(report.boundary.unitsConverted, false);
  assert.ok(report.reused.includes("compareDiscoveryLive"));

  const spawned = spawnCase(["amount-mismatch"]);
  assert.equal(spawned.status, 1, spawned.stderr);
  assert.match(spawned.stdout, /"status": "mismatch"/);
  assert.match(spawned.stdout, /"catalog": "5000"/);
  assert.match(spawned.stdout, /"live": "10000"/);
});

test("CLI sds-extract-identity: SDS /extract listing identity is canonical", async () => {
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
  assert.equal(identity.sources[0].status, "canonical");
  assert.equal(identity.sources[0].canonicalOriginMatched, true);
  assert.equal(identity.sources[0].ownershipProven, false);

  const lines = [];
  const code = await runUnpaidMaterializeCli(["sds-extract-identity"], {
    stdout: (value) => lines.push(String(value)),
    stderr: () => {},
  });
  const report = JSON.parse(lines.join(""));
  assert.equal(code, 0);
  assert.equal(report.ok, true);
  assert.equal(report.charged, false);
  assert.equal(report.verdict, "canonical");
  assert.equal(report.resource, SDS_EXTRACT.resource);
  assert.equal(report.listingIdentity.decision, "canonical");
  assert.equal(report.listingIdentity.status, "canonical");
  assert.equal(report.listingIdentity.canonicalOriginMatched, true);
  assert.equal(report.listingIdentity.ownershipProven, false);
  assert.equal(report.materialization.state, "materialized");
  assert.equal(report.discoveryDrift.status, "match");
  assert.equal(report.bazaarTracker.routePresent, true);
  assert.equal(report.bazaarTracker.cdpPolled, false);
  assert.match(report.listingIdentity.evidenceBoundary, /does not prove marketplace ownership/);

  const spawned = spawnCase(["sds-extract-identity"]);
  assert.equal(spawned.status, 0, spawned.stderr);
  assert.match(spawned.stdout, /"decision": "canonical"/);
  assert.match(spawned.stdout, /"status": "canonical"/);
  assert.match(spawned.stdout, /agents\.samedaydesk\.com\/extract/);
});

test("composes the existing seller-integrity 5000 vs 10000 discovery-drift case", () => {
  const fixture = observationFromSellerIntegrity(SELLER_INTEGRITY_AUDIT_EXAMPLE, {
    observedAt: "2026-08-12T07:50:00.000Z",
  });
  assert.equal(fixture.offers[0].amountAtomic, "5000");
  const report = compareDiscoveryLive(fixture, {
    observedAt: "2026-09-10T07:21:39.018Z",
    source: "live-unpaid-402",
    resource: "https://agents.samedaydesk.com/commerce/payment-offer-preflight",
    lastUpdated: null,
    offers: [{
      protocol: "x402",
      network: "eip155:8453",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      amountAtomic: "10000",
      recipient: "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee",
    }],
  }, { now: NOW });
  assert.equal(report.status, "mismatch");
  assert.equal(report.dimensions.find((item) => item.dimension === "amountAtomic").catalog, "5000");
  assert.equal(report.dimensions.find((item) => item.dimension === "amountAtomic").live, "10000");
});

test("charged:true wrapper evidence is non-conforming and exits 1", async () => {
  const report = await runUnpaidMaterializeProbe(
    loadFixture(join(HERE, "fixtures/wrapper-charged-true.json")),
    { now: NOW },
  );
  assert.equal(report.ok, false);
  assert.equal(report.charged, false);
  assert.equal(report.verdict, "wrapper_nonconforming");
  assert.equal(report.wrapper.charged, true);
  assert.equal(report.wrapper.conformant, false);
  assert.equal(probeExitCode(report), 1);
});

test("bazaar-tracker readback never marks owner refresh or CDP poll", () => {
  const present = inspectBazaarTrackerState({
    schema: "samedaydesk.bazaar-observation.v3",
    sources: {
      "cdp-discovery": {
        sellers: {
          samedaydesk: {
            routes: { "https://agents.samedaydesk.com/extract": { digest: "ab".repeat(32) } },
          },
        },
      },
    },
  }, SDS_EXTRACT.resource);
  assert.equal(present.mode, "readback");
  assert.equal(present.routePresent, true);
  assert.equal(present.liveRefresh, false);
  assert.equal(present.cdpPolled, false);
  assert.equal(present.ownerRefresh, false);
  assert.throws(
    () => inspectBazaarTrackerState({ live: true, sources: {} }, SDS_EXTRACT.resource),
    /live refresh/,
  );
});

test("CLI refuses --live and does not probe the network", () => {
  const result = spawnCase(["--live"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--live is refused/);
  const help = spawnCase(["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /seeded-absence/);
  const empty = spawnCase([]);
  assert.equal(empty.status, 2);
});

test("CLI refuses --live --refresh --cdp --poll with exit 2", () => {
  for (const flag of REFUSED_OPERATOR_FLAGS) {
    const result = spawnCase([flag]);
    assert.equal(result.status, 2, flag);
    assert.match(result.stderr, new RegExp(`${flag} is refused`));
    assert.match(result.stderr, /does not poll CDP or refresh Bazaar as owner/);
    assert.equal(result.stdout, "");
  }
});

test("source tree does not invent a collector, x402scan fork, or owner refresh loop", () => {
  const lib = readFileSync(join(HERE, "lib.mjs"), "utf8");
  const cli = readFileSync(join(HERE, "cli.mjs"), "utf8");
  const readme = readFileSync(join(HERE, "README.md"), "utf8");
  assert.doesNotMatch(lib, /from ["'][^"']*x402scan/);
  assert.doesNotMatch(cli, /from ["'][^"']*x402scan/);
  assert.match(readme, /x402scan fork/);
  assert.match(lib, /does not fork x402scan/);
  assert.doesNotMatch(lib, /setInterval\(/);
  assert.doesNotMatch(cli, /setInterval\(/);
  assert.match(lib, /evaluateListingIdentity/);
  assert.match(lib, /auditCoinbaseMaterialization/);
  assert.match(lib, /compareDiscoveryLive/);
  assert.match(lib, /charged:false/);
});
