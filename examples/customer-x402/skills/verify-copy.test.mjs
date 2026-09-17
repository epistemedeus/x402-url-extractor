import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { REMAINING_SKILL_NAMES } from "./verify-copy.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const VERIFY = join(HERE, "verify-copy.mjs");

function run(args, extra = {}) {
  return spawnSync(process.execPath, [VERIFY, ...args], {
    encoding: "utf8",
    cwd: HERE,
    timeout: 15_000,
    ...extra,
  });
}

test("cold verify of remaining well-known copies exits 0", () => {
  const result = run([]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /ok remaining well-known copies: page-change explicit-record/);
  assert.deepEqual([...REMAINING_SKILL_NAMES], ["page-change", "explicit-record"]);
});

test("named remaining skill is supported without network or payment", () => {
  const result = run(["page-change"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /ok remaining skill page-change/);
  assert.match(result.stdout, /pays=false network=false/);
});

test("seeded failure: purchase is rejected", () => {
  const result = run(["purchase"]);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /rejected action purchase: page-change is an offline compare/);
  assert.equal(result.stdout, "");
});

test("seeded failure: fetch, pay, and web-extract are rejected", () => {
  const fetchResult = run(["fetch"]);
  assert.equal(fetchResult.status, 1);
  assert.match(fetchResult.stderr, /rejected action fetch:/);

  const payResult = run(["pay"]);
  assert.equal(payResult.status, 1);
  assert.match(payResult.stderr, /rejected action pay:/);

  const webExtract = run(["web-extract"]);
  assert.equal(webExtract.status, 1);
  assert.match(webExtract.stderr, /rejected skill web-extract: not a remaining well-known copy/);
});

test("unknown skill name is rejected", () => {
  const result = run(["not-a-skill"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /rejected skill not-a-skill: remaining well-known copies are page-change and explicit-record only/);
});

test("sha256 drift fails closed with exit 2, not the purchase reject", () => {
  const skillPath = join(HERE, "page-change", "SKILL.md");
  const original = readFileSync(skillPath);
  try {
    writeFileSync(skillPath, `${original.toString("utf8")}\n`);
    const result = run(["purchase"]);
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.match(result.stderr, /does not match source\.liveSkillSha256/);
    assert.doesNotMatch(result.stderr, /rejected action purchase/);
  } finally {
    writeFileSync(skillPath, original);
  }
});

test("page-change and explicit-record reject wrappers default to purchase", () => {
  const pageChange = spawnSync(
    process.execPath,
    [join(HERE, "page-change", "scripts", "reject-network-pay.mjs")],
    { encoding: "utf8", timeout: 15_000 },
  );
  assert.equal(pageChange.status, 1, pageChange.stderr || pageChange.stdout);
  assert.match(pageChange.stderr, /rejected action purchase:/);

  const record = spawnSync(
    process.execPath,
    [join(HERE, "explicit-record", "scripts", "reject-network-pay.mjs"), "fetch"],
    { encoding: "utf8", timeout: 15_000 },
  );
  assert.equal(record.status, 1, record.stderr || record.stdout);
  assert.match(record.stderr, /rejected action fetch:/);
});
