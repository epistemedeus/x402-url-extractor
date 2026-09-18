import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  AMOUNT_MISMATCH_COMMAND,
  BUNDLED_CASES,
  EMPTY_SEARCH_COMMAND,
  EXPECTED_AMOUNT_ATOMIC,
  EXPECTED_PAY_TO,
  INVENTED_FIELD_COMMAND,
  LOCKFILE_PIN_DELTA_MCP_TOOL,
  LOCKFILE_PIN_DELTA_RESOURCE,
  LOCKFILE_PIN_DELTA_UNPAID_SCHEMA,
  TREAT_ABSENCE_AS_DEMAND_COMMAND,
  bundledCaseSource,
  cdpFixtureKind,
  createFixtureFetch,
  demandClaim,
  inventedReceiptFields,
  loadFixture,
  probeExitCode,
  refusedFlag,
  runLockfilePinDeltaUnpaidCli,
  runLockfilePinDeltaUnpaidProbe,
  usage,
} from "./lib.mjs";
import { LOCKFILE_PIN_DELTA_AMOUNT_ATOMIC, LOCKFILE_PIN_DELTA_PATH } from "../../../../lockfile-pin-delta-config.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "check.mjs");
const REPO = join(HERE, "../../../..");

function spawnCase(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    cwd: REPO,
  });
}

test("pins copy-paste operator commands and refuses collector flags", () => {
  const docs = readFileSync(join(HERE, "README.md"), "utf8");
  assert.equal(EMPTY_SEARCH_COMMAND, "node tools/unpaid-materialize-probe/fixtures/lockfile-pin-delta/check.mjs empty-search");
  assert.equal(TREAT_ABSENCE_AS_DEMAND_COMMAND, "node tools/unpaid-materialize-probe/fixtures/lockfile-pin-delta/check.mjs treat-absence-as-demand");
  assert.equal(AMOUNT_MISMATCH_COMMAND, "node tools/unpaid-materialize-probe/fixtures/lockfile-pin-delta/check.mjs amount-mismatch");
  assert.equal(INVENTED_FIELD_COMMAND, "node tools/unpaid-materialize-probe/fixtures/lockfile-pin-delta/check.mjs invented-field");
  assert.equal(docs.includes(EMPTY_SEARCH_COMMAND), true);
  assert.equal(docs.includes(TREAT_ABSENCE_AS_DEMAND_COMMAND), true);
  assert.equal(EXPECTED_AMOUNT_ATOMIC, LOCKFILE_PIN_DELTA_AMOUNT_ATOMIC);
  assert.equal(EXPECTED_AMOUNT_ATOMIC, "5000");
  assert.equal(LOCKFILE_PIN_DELTA_PATH, "/lockfile-pin-delta");
  assert.equal(LOCKFILE_PIN_DELTA_MCP_TOOL, "lockfile_pin_delta");
  assert.equal(refusedFlag(["--live"]), "--live");
  assert.equal(refusedFlag(["--cdp"]), "--cdp");
  assert.equal(refusedFlag(["--pay"]), "--pay");
  assert.equal(refusedFlag(["empty-search"]), null);
  assert.match(usage(), /route_absent, not demand/);
});

test("CLI empty-search: unpaid 402 amount 5000 plus empty catalog is route_absent, not demand", async () => {
  const lines = [];
  const code = await runLockfilePinDeltaUnpaidCli(["empty-search"], {
    stdout: (value) => lines.push(String(value)),
    stderr: () => {},
  });
  const report = JSON.parse(lines.join(""));
  assert.equal(code, 1);
  assert.equal(report.schemaVersion, LOCKFILE_PIN_DELTA_UNPAID_SCHEMA);
  assert.equal(report.ok, false);
  assert.equal(report.demand, false);
  assert.equal(report.code, "route_absent");
  assert.equal(report.charged, false);
  assert.equal(report.resource, LOCKFILE_PIN_DELTA_RESOURCE);
  assert.equal(report.method, "POST");
  assert.equal(report.expectedAmountAtomic, "5000");
  assert.equal(report.amountAtomic, "5000");
  assert.equal(report.wrapper.httpStatus, 402);
  assert.equal(report.wrapper.wwwAuthenticate, null);
  assert.equal(report.x402Only, true);
  assert.equal(report.listingIdentity.status, "route_absent");
  assert.equal(report.listingIdentity.decision, "absent");
  assert.equal(report.materialization.state, "provider_accepted_not_materialized");
  assert.equal(report.materialization.catalog.exactResourceFound, false);
  assert.equal(report.bazaarTracker.routePresent, false);
  assert.equal(report.bazaarTracker.cdpPolled, false);
  assert.equal(report.bazaarTracker.ownerRefresh, false);
  assert.ok(report.states.includes("route_absent"));
  assert.ok(report.states.includes("provider_accepted_not_materialized"));
  assert.ok(report.notClaimed.includes("did not treat catalog absence as demand"));
  assert.doesNotMatch(JSON.stringify(report), /"demand": true/);
  assert.equal(report.reused.includes("evaluateListingIdentity"), true);
  assert.equal(report.reused.includes("auditCoinbaseMaterialization"), true);

  const spawned = spawnCase(["empty-search"]);
  assert.equal(spawned.status, 1, spawned.stderr);
  assert.match(spawned.stdout, /"code": "route_absent"/);
  assert.match(spawned.stdout, /"demand": false/);
  assert.match(spawned.stdout, /provider_accepted_not_materialized/);
});

test("CLI treat-absence-as-demand is rejected and does not classify demand", async () => {
  const fixture = loadFixture(BUNDLED_CASES["treat-absence-as-demand"]);
  assert.equal(demandClaim(fixture), "treatAbsenceAsDemand");
  const lines = [];
  const code = await runLockfilePinDeltaUnpaidCli(["treat-absence-as-demand"], {
    stdout: (value) => lines.push(String(value)),
    stderr: () => {},
  });
  const report = JSON.parse(lines.join(""));
  assert.equal(code, 1);
  assert.equal(report.ok, false);
  assert.equal(report.demand, false);
  assert.equal(report.code, "treat_absence_as_demand");
  assert.equal(report.verdict, "treat_absence_as_demand");
  assert.doesNotMatch(JSON.stringify(report), /"demand": true/);
  assert.match(report.claim, /not buyer demand/);

  const spawned = spawnCase(["treat-absence-as-demand"]);
  assert.equal(spawned.status, 1, spawned.stderr);
  assert.match(spawned.stdout, /treat_absence_as_demand/);
  assert.match(spawned.stdout, /"demand": false/);
});

test("CLI amount-mismatch: seeded 10000 vs expected 5000 exits 1", async () => {
  const lines = [];
  const code = await runLockfilePinDeltaUnpaidCli(["amount-mismatch"], {
    stdout: (value) => lines.push(String(value)),
    stderr: () => {},
  });
  const report = JSON.parse(lines.join(""));
  assert.equal(code, 1);
  assert.equal(report.code, "amount_mismatch");
  assert.equal(report.expectedAmountAtomic, "5000");
  assert.ok(report.observedAmounts.includes("10000"));
  assert.equal(report.boundary?.unitsConverted ?? report.unitsConverted, false);

  const spawned = spawnCase(["amount-mismatch"]);
  assert.equal(spawned.status, 1, spawned.stderr);
  assert.match(spawned.stdout, /amount_mismatch/);
  assert.match(spawned.stdout, /10000/);
});

test("CLI invented-field rejects loyaltyPoints and throughBlock", async () => {
  const fixture = bundledCaseSource("invented-field");
  assert.deepEqual(inventedReceiptFields(fixture).sort(), ["loyaltyPoints", "throughBlock"]);
  const lines = [];
  const code = await runLockfilePinDeltaUnpaidCli(["invented-field"], {
    stdout: (value) => lines.push(String(value)),
    stderr: () => {},
  });
  const report = JSON.parse(lines.join(""));
  assert.equal(code, 1);
  assert.equal(report.code, "invented_receipt_field");
  assert.ok(report.invented.includes("loyaltyPoints"));
  assert.ok(report.invented.includes("throughBlock"));

  const spawned = spawnCase(["invented-field"]);
  assert.equal(spawned.status, 1, spawned.stderr);
  assert.match(spawned.stdout, /invented_receipt_field/);
});

test("CLI unpaid-402 capture is 402 amount 5000 x402-only and catalog miss is route_absent", async () => {
  const lines = [];
  const code = await runLockfilePinDeltaUnpaidCli(["unpaid-402"], {
    stdout: (value) => lines.push(String(value)),
    stderr: () => {},
  });
  const report = JSON.parse(lines.join(""));
  assert.equal(code, 1);
  assert.equal(report.code, "route_absent");
  assert.equal(report.wrapper.httpStatus, 402);
  assert.equal(report.amountAtomic, "5000");
  assert.equal(report.get.httpStatus, 404);
  assert.equal(report.mcp.tool, "lockfile_pin_delta");
  assert.equal(probeExitCode(report), 1);
});

test("CLI refuses --live and prints usage on empty argv", () => {
  const live = spawnCase(["--live"]);
  assert.equal(live.status, 2);
  assert.match(live.stderr, /--live is refused/);
  const help = spawnCase(["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /empty-search/);
  const empty = spawnCase([]);
  assert.equal(empty.status, 2);
});

function baseFixture(overrides = {}) {
  return {
    origin: "https://agents.samedaydesk.com",
    route: "/lockfile-pin-delta",
    method: "POST",
    intent: "compare two caller-supplied npm package-lock.json objects for pin changes",
    wrapper: { charged: false, httpStatus: 402, ok: false, wwwAuthenticate: null },
    unpaidOffer: {
      x402Version: 2,
      amountAtomic: "5000",
      scheme: "exact",
      network: "eip155:8453",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      payTo: EXPECTED_PAY_TO,
      resource: LOCKFILE_PIN_DELTA_RESOURCE,
      protocols: ["x402"],
      wwwAuthenticate: null,
    },
    validator: { valid: true, simulation: { outcome: "accepted" }, index: null },
    catalogSearch: { resources: [] },
    listingIdentity: {
      canonicalOrigin: "https://agents.samedaydesk.com",
      route: "/lockfile-pin-delta",
      settlementIdentity: EXPECTED_PAY_TO,
      sources: ["coinbase-bazaar"],
      records: [],
    },
    ...overrides,
  };
}

test("demand:true is treat_absence_as_demand, not silently overwritten route_absent", async () => {
  assert.equal(demandClaim({ demand: true }), "demand");
  assert.equal(demandClaim({ buyerDemand: true }), "buyerDemand");
  const report = await runLockfilePinDeltaUnpaidProbe(baseFixture({ demand: true }));
  assert.equal(report.code, "treat_absence_as_demand");
  assert.equal(report.demand, false);
  assert.equal(report.demandClaim, "demand");
  assert.equal(report.ok, false);
});

test("numeric amountAtomic 5000 is amount_mismatch, not string-exact 5000", async () => {
  const report = await runLockfilePinDeltaUnpaidProbe(baseFixture({
    unpaidOffer: {
      ...baseFixture().unpaidOffer,
      amountAtomic: 5000,
    },
  }));
  assert.equal(report.code, "amount_mismatch");
  assert.equal(report.unitsConverted, false);
  assert.deepEqual(report.observedAmounts, []);
  assert.ok(report.nonStringAmounts.includes("5000"));
});

test("missing unpaidOffer does not invent amountAtomic 5000", async () => {
  const fixture = baseFixture();
  delete fixture.unpaidOffer;
  const report = await runLockfilePinDeltaUnpaidProbe(fixture);
  assert.equal(report.code, "settlement_mismatch");
  assert.ok(report.mismatched.includes("unpaidOffer"));
  assert.notEqual(report.amountAtomic, "5000");
});

test("attacker payTo is settlement_mismatch, not route_absent", async () => {
  const report = await runLockfilePinDeltaUnpaidProbe(baseFixture({
    unpaidOffer: {
      ...baseFixture().unpaidOffer,
      payTo: "0x000000000000000000000000000000000000dEaD",
    },
  }));
  assert.equal(report.code, "settlement_mismatch");
  assert.ok(report.mismatched.includes("payTo"));
  assert.equal(report.expectedPayTo, EXPECTED_PAY_TO);
});

test("network and asset pins are required", async () => {
  const network = await runLockfilePinDeltaUnpaidProbe(baseFixture({
    unpaidOffer: { ...baseFixture().unpaidOffer, network: "eip155:1" },
  }));
  assert.equal(network.code, "settlement_mismatch");
  assert.ok(network.mismatched.includes("network"));
  const asset = await runLockfilePinDeltaUnpaidProbe(baseFixture({
    unpaidOffer: { ...baseFixture().unpaidOffer, asset: "0x0000000000000000000000000000000000000000" },
  }));
  assert.equal(asset.code, "settlement_mismatch");
  assert.ok(asset.mismatched.includes("asset"));
  const resource = await runLockfilePinDeltaUnpaidProbe(baseFixture({
    unpaidOffer: { ...baseFixture().unpaidOffer, resource: "https://evil.example/lockfile-pin-delta" },
  }));
  assert.equal(resource.code, "settlement_mismatch");
  assert.ok(resource.mismatched.includes("resource"));
});

test("mcp tool extract is wrong_mcp_tool", async () => {
  const report = await runLockfilePinDeltaUnpaidProbe(baseFixture({
    mcp: { tool: "extract", paymentRequired: true, amountAtomic: "5000" },
  }));
  assert.equal(report.code, "wrong_mcp_tool");
  assert.equal(report.observedTool, "extract");
  assert.equal(report.expectedTool, LOCKFILE_PIN_DELTA_MCP_TOOL);
});

test("GET 200 is get_not_404", async () => {
  const report = await runLockfilePinDeltaUnpaidProbe(baseFixture({
    get: { method: "GET", httpStatus: 200 },
  }));
  assert.equal(report.code, "get_not_404");
  assert.equal(report.get.httpStatus, 200);
});

test("fixture.pay true is owner_refresh_refused", async () => {
  await assert.rejects(
    () => runLockfilePinDeltaUnpaidProbe(baseFixture({ pay: true })),
    (error) => error.code === "owner_refresh_refused",
  );
});

test("listingIdentity route /extract cannot make lockfile probe ok:true", async () => {
  await assert.rejects(
    () => runLockfilePinDeltaUnpaidProbe(baseFixture({
      validator: { valid: true, simulation: { outcome: "accepted" }, index: 1 },
      catalogSearch: { resources: [{ resource: LOCKFILE_PIN_DELTA_RESOURCE }] },
      listingIdentity: {
        canonicalOrigin: "https://agents.samedaydesk.com",
        route: "/extract",
        settlementIdentity: EXPECTED_PAY_TO,
        sources: ["coinbase-bazaar"],
        records: [{
          source: "coinbase-bazaar",
          url: "https://agents.samedaydesk.com/extract",
          settlementIdentity: EXPECTED_PAY_TO,
          rank: 1,
        }],
      },
    })),
    (error) => error.code === "wrong_route" && /listingIdentity\.route/.test(error.message),
  );
});

test("fixture fetch only answers exact Coinbase validate and search URLs", async () => {
  assert.equal(cdpFixtureKind("https://api.cdp.coinbase.com/platform/v2/x402/validate"), "validate");
  assert.equal(cdpFixtureKind("https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?query=x"), "search");
  assert.equal(cdpFixtureKind("https://evil.example/steal?q=/x402/validate"), null);
  const fetchImpl = createFixtureFetch(baseFixture());
  await assert.rejects(
    () => fetchImpl("https://evil.example/steal?q=/x402/validate"),
    (error) => error.code === "cdp_poll_refused",
  );
  const ok = await fetchImpl("https://api.cdp.coinbase.com/platform/v2/x402/validate");
  assert.equal(ok.status, 200);
});

test("CLI replay refuses paths outside the fixture directory", () => {
  const outside = join(tmpdir(), "r11-402-04-outside.json");
  writeFileSync(outside, JSON.stringify(baseFixture({ id: "escaped" })));
  const escaped = spawnCase(["replay", "--fixture", outside]);
  assert.equal(escaped.status, 2, escaped.stderr);
  assert.match(escaped.stderr, /must stay inside/);
  const missing = spawnCase(["replay", "--fixture", join(HERE, "no-such-fixture.json")]);
  assert.equal(missing.status, 2, missing.stderr);
  assert.match(missing.stderr, /fixture not found/);
  const replay = spawnCase(["replay", "--fixture", "tools/unpaid-materialize-probe/fixtures/lockfile-pin-delta/empty-search.json"]);
  assert.equal(replay.status, 1, replay.stderr);
  assert.match(replay.stdout, /"code": "route_absent"/);
  const link = join(HERE, "symlink-escape.json");
  try {
    symlinkSync(outside, link);
    const viaLink = spawnCase(["replay", "--fixture", "tools/unpaid-materialize-probe/fixtures/lockfile-pin-delta/symlink-escape.json"]);
    assert.equal(viaLink.status, 2, viaLink.stderr);
    assert.match(viaLink.stderr, /must stay inside/);
  } finally {
    try { unlinkSync(link); } catch {}
    try { unlinkSync(outside); } catch {}
  }
});

test("buyerEmail is an invented receipt field", () => {
  assert.deepEqual(inventedReceiptFields({ unpaidOffer: { buyerEmail: "buyer@example.com" } }), ["buyerEmail"]);
});
