import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "tools/verify/cli.mjs");

function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 20000,
  });
  let json = null;
  if (result.stdout) {
    try {
      json = JSON.parse(result.stdout);
    } catch {
      json = null;
    }
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, json };
}

test("unknown flag exits 2 before any check", () => {
  const result = run(["discover", "--not-a-flag", "--json"]);
  assert.equal(result.status, 2);
  assert.equal(result.json?.error?.code, "bad-invocation");
  assert.equal(result.json?.boundary?.paymentSent, false);
  assert.equal(result.json?.evidence?.length, 0);
});

test("self-test passes and the harness control is a real mismatch", () => {
  const result = run(["self-test", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.ok, true);
  assert.equal(result.json.schemaVersion, 1);
  assert.equal(result.json.boundary.settled, false);
  assert.equal(result.json.boundary.paymentSent, false);
  const control = result.json.evidence.find((item) => item.id === "harness-control");
  assert.equal(control.observed, false);
  assert.equal(control.expected, false);
  assert.equal(control.assertionPassed, true);
  for (const id of ["fixture-amount-5001", "fixture-payto-short", "fixture-manifest-openapi-drift", "fixture-railway-canonical", "fixture-healthz-missing-batch"]) {
    const item = result.json.evidence.find((entry) => entry.id === id);
    assert.equal(item.assertionPassed, true, id);
    assert.equal(item.observed, true, id);
  }
  for (const id of ["fixture-bazaar-sample-differs", "fixture-a2a-redirect", "fixture-zero-charge-write", "fixture-range-vs-fixed", "fixture-stripe-human"]) {
    const item = result.json.evidence.find((entry) => entry.id === id);
    assert.equal(item.assertionPassed, true, id);
    assert.equal(item.observed, false, id);
  }
});

test("seeded amount 5001 and a one-character payTo exit 1", () => {
  const amount = run(["catalog", "check", "--profile", "local", "--fixture", "amount-5001", "--json"]);
  assert.equal(amount.status, 1);
  assert.equal(amount.json.ok, false);
  assert.equal(amount.json.evidence[0].observed, "5001");
  assert.equal(amount.json.evidence[0].assertionPassed, false);
  const payTo = run(["catalog", "check", "--profile", "local", "--fixture", "payto-short", "--json"]);
  assert.equal(payTo.status, 1);
  assert.equal(payTo.json.evidence[0].observed, false);
});

test("manifest 5000 versus OpenAPI 0.01 exits 1 and 10000 versus 0.01 passes", () => {
  const drift = run(["catalog", "check", "--profile", "local", "--fixture", "manifest-openapi-drift", "--json"]);
  assert.equal(drift.status, 1);
  assert.equal(drift.json.evidence[0].observed, false);
  const ok = run(["catalog", "check", "--profile", "local", "--fixture", "price-surface-ok", "--json"]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.json.evidence[0].observed, true);
});

test("Railway host as canonical exits 1 and a truthful alias does not", () => {
  const railway = run(["catalog", "check", "--profile", "local", "--fixture", "railway-canonical", "--json"]);
  assert.equal(railway.status, 1);
  assert.match(String(railway.json.evidence[0].observed), /up\.railway\.app/);
  const alias = run(["catalog", "check", "--profile", "local", "--fixture", "railway-alias", "--json"]);
  assert.equal(alias.status, 0, alias.stderr);
  assert.equal(alias.json.evidence[0].observed.defect, false);
});

test("missing healthz extract/batch exits 1 and atomic 10000 passes", () => {
  const missing = run(["catalog", "check", "--profile", "local", "--fixture", "healthz-missing-batch", "--json"]);
  assert.equal(missing.status, 1);
  assert.equal(missing.json.evidence[0].observed, null);
  const present = run(["catalog", "check", "--profile", "local", "--fixture", "healthz-batch-ok", "--json"]);
  assert.equal(present.status, 0, present.stderr);
  assert.equal(present.json.evidence[0].observed, "10000");
});

test("settle request exits 1 without setting settled", () => {
  const result = run(["catalog", "check", "--profile", "local", "--fixture", "settle-requested", "--json"]);
  assert.equal(result.status, 1);
  assert.equal(result.json.boundary.settled, false);
  assert.equal(result.json.boundary.paymentSent, false);
  assert.equal(result.json.evidence[0].observed, "settlement-requested");
});

test("counterexample fixtures pass", () => {
  for (const name of ["bazaar-sample-differs", "a2a-redirect", "zero-charge-write", "range-vs-fixed", "stripe-human"]) {
    const result = run(["journey", "catalog", "--profile", "local", "--fixture", name, "--json"]);
    assert.equal(result.status, 0, `${name} ${result.stderr}`);
    assert.equal(result.json.evidence[0].observed.defect, false, name);
    assert.equal(result.json.boundary.settled, false);
  }
});

test("archive profile passes the canonical unpaid snapshot", () => {
  const result = run(["journey", "challenge", "--profile", "archive", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.evidence.every((item) => item.assertionPassed), true);
});
