import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CODES, EXTRACT_AMOUNT_ATOMIC, MATRIX, SCAN_AMOUNT_ATOMIC } from "./constants.mjs";
import { CHECK, FIXTURES, REPO_ROOT } from "./paths.mjs";

function spawnCheck(args, { timeout = 20_000 } = {}) {
  return spawnSync(process.execPath, [CHECK, ...args], {
    encoding: "utf8",
    cwd: REPO_ROOT,
    timeout,
    env: { ...process.env, FORCE_COLOR: "0" },
  });
}

function reportFrom(result) {
  const text = result.stdout.trim();
  return JSON.parse(text.slice(text.indexOf("{")));
}

test("check.mjs --all-fixtures exits 0", () => {
  const result = spawnCheck(["--all-fixtures"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = reportFrom(result);
  assert.equal(report.ok, true);
  assert.equal(report.counted, 5);
});

test("check.mjs --seeded-failure exits 1 amount_mismatch / copy_extract_onto_scan", () => {
  const result = spawnCheck(["--seeded-failure"]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const report = reportFrom(result);
  assert.equal(report.ok, false);
  assert.equal(report.codes.includes(CODES.AMOUNT_MISMATCH), true);
  assert.equal(report.codes.includes(CODES.COPY_EXTRACT_ONTO_SCAN), true);
  const scan = report.rows.find((row) => row.id === "scan");
  assert.equal(scan.httpAmount, EXTRACT_AMOUNT_ATOMIC);
  assert.equal(scan.expectedAmountAtomic, SCAN_AMOUNT_ATOMIC);
  assert.match(result.stderr, /SEEDED_FAILURE rejected/);
});

test("check.mjs refuses --live, --pay, --cdp, --publish, --neo, and --live=true", () => {
  for (const flag of ["--live", "--pay", "--cdp", "--publish", "--neo", "--live=true"]) {
    const result = spawnCheck([flag, "--cold"]);
    assert.equal(result.status, 2, `${flag}: ${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /is refused/);
  }
});

test("check.mjs refuses --stripe, --checkout, --settle, and unknown flags", () => {
  for (const flag of ["--stripe", "--checkout", "--settle", "--pay=now"]) {
    const result = spawnCheck([flag]);
    assert.equal(result.status, 2, `${flag}: ${result.stdout}${result.stderr}`);
    const report = reportFrom(result);
    assert.equal(report.code, "refused");
    assert.equal(report.paymentAttempted, false);
  }
  const unknown = spawnCheck(["--foo"]);
  assert.equal(unknown.status, 2, unknown.stdout + unknown.stderr);
  assert.equal(reportFrom(unknown).code, "unknown_flag");
});

test("check.mjs confines fixtures and JSON-fails malformed input", async () => {
  const escaped = spawnCheck(["package.json"]);
  assert.equal(escaped.status, 2, escaped.stdout + escaped.stderr);
  assert.equal(reportFrom(escaped).code, "fixture_escape");

  const outsideDir = await mkdtemp(join(tmpdir(), "w1010-outside-"));
  try {
    const outside = join(outsideDir, "canonical.json");
    await writeFile(outside, "{}");
    const outsideResult = spawnCheck([outside]);
    assert.equal(outsideResult.status, 2, outsideResult.stdout + outsideResult.stderr);
    assert.equal(reportFrom(outsideResult).code, "fixture_escape");
  } finally {
    await rm(outsideDir, { recursive: true, force: true });
  }

  const missing = spawnCheck(["fixtures/pass/does-not-exist.json"]);
  assert.equal(missing.status, 2, missing.stdout + missing.stderr);
  assert.equal(reportFrom(missing).code, "fixture_not_found");

  const malformedPath = join(FIXTURES, "reject", ".tmp-malformed.json");
  await writeFile(malformedPath, "{not json");
  try {
    const malformed = spawnCheck([malformedPath]);
    assert.equal(malformed.status, 2, malformed.stdout + malformed.stderr);
    assert.equal(reportFrom(malformed).code, "malformed_fixture");
  } finally {
    await rm(malformedPath, { force: true });
  }
});

test("check.mjs refuses a non-loopback --origin", () => {
  const result = spawnCheck(["--cold", "--origin", "https://agents.samedaydesk.com"]);
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stderr, /loopback-only/);
});

test("check.mjs --cold against a spawned local merchant exits 0", { timeout: 120_000 }, () => {
  const result = spawnCheck(["--cold"], { timeout: 90_000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = reportFrom(result);
  assert.equal(report.ok, true, JSON.stringify(report.codes));
  assert.equal(report.paymentAttempted, false);
  assert.equal(report.coldRun.paymentHeadersSent, false);
  assert.equal(report.coldRun.facilitatorSettleCalled, false);
  assert.equal(report.coldRun.facilitatorVerifyCalled, false);
  const byId = Object.fromEntries(report.rows.map((row) => [row.id, row]));
  for (const route of MATRIX) {
    const row = byId[route.id];
    assert.equal(row.httpStatus, 402, route.path);
    assert.equal(row.httpAmount, route.amountAtomic, `${route.path} http amount`);
    assert.equal(row.mcpAmount, route.amountAtomic, `${route.path} mcp amount`);
    assert.ok(row.openapi402Text.includes(route.openapi402Token), row.openapi402Text);
  }
  assert.equal(byId.extract.httpAmount, "5000");
  assert.equal(byId.scan.httpAmount, "200000");
  assert.equal(byId["transaction-receipt"].httpAmount, "2000");
  assert.match(result.stderr, /w1010-amount-matrix cold: pass/);
});
