import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  AMOUNT_MISMATCH_COMMAND,
  BUNDLED_CASES,
  EMPTY_SEARCH_COMMAND,
  EXPECTED_AMOUNT_ATOMIC,
  INVENTED_FIELD_COMMAND,
  LOCKFILE_PIN_DELTA_MCP_TOOL,
  LOCKFILE_PIN_DELTA_RESOURCE,
  LOCKFILE_PIN_DELTA_UNPAID_SCHEMA,
  TREAT_ABSENCE_AS_DEMAND_COMMAND,
  bundledCaseSource,
  demandClaim,
  inventedReceiptFields,
  loadFixture,
  probeExitCode,
  refusedFlag,
  runLockfilePinDeltaUnpaidCli,
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
