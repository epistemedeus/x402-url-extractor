import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "src", "cli.mjs");

function run(args, { input } = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    input,
    cwd: root,
  });
}

test("cli demo: emits statuses for all fixtures without investmentRecommendation", () => {
  const r = run(["demo"]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.demo, true);
  assert.equal(out.results["positive.json"].status, "ready");
  assert.equal(out.results["negative-malformed.json"].status, "rejected");
  assert.equal(out.results["partial-missing-price.json"].status, "partial_input");
  assert.equal(out.results["external-cost.json"].status, "ready");
  assert.deepEqual(out.results["external-cost.json"].priceStates.sort(), [
    "external_cost",
    "stale_or_untrusted_source",
  ]);
  for (const v of Object.values(out.results)) {
    assert.equal(v.hasInvestmentRecommendation, false);
  }
});

test("cli brief positive exits 0 with schema", () => {
  const r = run(["brief", join(root, "fixtures", "positive.json")]);
  assert.equal(r.status, 0, r.stderr);
  const brief = JSON.parse(r.stdout);
  assert.equal(brief.schema, "x402.r2.consumer.procurement_brief.v1");
  assert.equal(brief.status, "ready");
});

test("cli brief negative exits 1", () => {
  const r = run(["brief", join(root, "fixtures", "negative-malformed.json")]);
  assert.equal(r.status, 1);
  const brief = JSON.parse(r.stdout);
  assert.equal(brief.status, "rejected");
});

test("cli validate stdin works", () => {
  const payload = JSON.stringify({
    taskId: "stdin-demo",
    taskNeeds: { musts: ["x"] },
    serviceContracts: [
      {
        contractId: "c1",
        capabilityIds: ["x"],
        coveredMusts: ["x"],
        price: { amountAtomic: "1", currency: "USDC" },
        priceSource: "caller.supplied.quote",
        freeBaseline: {
          freeAlternativeState: "unavailable",
          freeAlternativeBasisId: "stdin_none_v1",
        },
      },
    ],
  });
  const r = run(["validate", "-"], { input: payload });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.normalized.taskId, "stdin-demo");
});
