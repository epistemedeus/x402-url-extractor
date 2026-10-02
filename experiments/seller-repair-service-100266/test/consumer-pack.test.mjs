import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

const repo = join(import.meta.dirname, "..", "..", "..");
const exp = join(repo, "experiments", "seller-repair-service-100266");
const archive = join(exp, "candidate", "seller-repair-external-consumer-0.2.0.tar.gz");
const frozenConsumer = join(exp, "candidate", "seller-repair-external-consumer-0.1.0.tar.gz");
const node = process.execPath;
const stripped = {
  PATH: process.env.PATH,
  HOME: process.env.HOME || "/tmp",
  TMPDIR: process.env.TMPDIR || "/tmp",
  LANG: "C",
};
const PRIVATE = "PRIVATE_SENTINEL_do_not_keep";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function run(args, cwd) {
  return spawnSync(node, args, { cwd, env: stripped, encoding: "utf8" });
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const rel = path.slice(dir.length + 1);
    if (statSync(path).isDirectory()) walk(path, acc);
    else acc.push([rel, sha256(readFileSync(path))]);
  }
  return acc;
}

test("the portable consumer packs twice, extracts twice, and refuses a seeded claim", { timeout: 90_000 }, () => {
  assert.equal(sha256(readFileSync(frozenConsumer)), "3f3552e9cdedff9910211b1820b229daa834cf3811fcc5b38035046cefda4a27");
  assert.equal(readFileSync(frozenConsumer).length, 22870);
  const first = run([join(exp, "bin", "pack-consumer.mjs")], repo);
  assert.equal(first.status, 0, first.stderr);
  const firstHash = sha256(readFileSync(archive));
  const second = run([join(exp, "bin", "pack-consumer.mjs")], repo);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(sha256(readFileSync(archive)), firstHash);
  assert.equal(JSON.parse(readFileSync(join(exp, "candidate", "provenance.json"), "utf8")).sha256, firstHash);

  const listed = spawnSync("tar", ["-tzf", archive], { encoding: "utf8", env: stripped });
  assert.equal(listed.status, 0, listed.stderr);
  const names = listed.stdout.split("\n").filter(Boolean);
  assert.ok(names.includes("package/bin/seller-repair.mjs"));
  assert.ok(names.includes("package/SKILL.md"));
  assert.ok(names.includes("package/src/privacy.mjs"));
  for (const name of names) {
    assert.equal(name.includes(".git") || name.includes("node_modules") || name.includes(".grok"), false, name);
    assert.equal(name.endsWith("/scan.mjs") || name.endsWith("/handoff.mjs") || name.endsWith("/contribution.mjs") || name.includes("/route/"), false, name);
  }

  const roots = [0, 1].map(() => mkdtempSync(join(tmpdir(), "seller-repair-consumer-")));
  try {
    for (const root of roots) {
      const extracted = spawnSync("tar", ["-xzf", archive, "-C", root], { encoding: "utf8", env: stripped });
      assert.equal(extracted.status, 0, extracted.stderr);
    }
    assert.deepEqual(walk(roots[0]), walk(roots[1]));

    const delivered = run(["package/bin/seller-repair.mjs", "deliver"], roots[0]);
    assert.equal(delivered.status, 0, delivered.stderr);
    assert.match(delivered.stdout, /"privateTargetRefused":true/);
    assert.match(delivered.stdout, /"directBaselineAgrees":true/);
    assert.match(delivered.stdout, /"useful":true/);
    assert.match(delivered.stdout, /"useful":false/);
    assert.match(delivered.stdout, /"tokens":"unknown"/);
    assert.match(delivered.stdout, /"adaptationMaintenanceCost":"unknown"/);
    assert.equal(delivered.stdout.includes(PRIVATE), false);

    const reproduce = run(["package/bin/seller-repair.mjs", "reproduce", "--case", "package/cases/retained-case.json"], roots[0]);
    assert.equal(reproduce.status, 0, reproduce.stderr);
    assert.equal(reproduce.stdout.includes(PRIVATE), false);
    assert.match(reproduce.stdout, /"loopbackFix":true/);
    assert.match(reproduce.stdout, /"deployedCounterpartyRepair":false/);
    assert.match(reproduce.stdout, /"scanner":"not_bundled"/);
    assert.match(reproduce.stdout, /"paymentSent":false/);

    const retest = run(["package/bin/seller-repair.mjs", "retest", "--case", "package/cases/retained-case.json", "--mode", "repaired"], roots[1]);
    assert.equal(retest.status, 0, retest.stderr);
    assert.match(retest.stdout, /"useful":true/);
    assert.equal(retest.stdout.includes(PRIVATE), false);

    const later = run(["package/bin/cold-later.mjs", "package/cases/retained-case.json", "--resource", "/catalog/items"], roots[0]);
    assert.equal(later.status, 2, later.stdout);
    assert.match(later.stdout, /"stale_applicability"/);
    assert.match(later.stdout, /"probed":false/);
    assert.equal(later.stdout.includes(PRIVATE), false);

    const sameBinding = run(["package/bin/cold-later.mjs", "package/cases/retained-case.json", "--caller", "later-agent"], roots[1]);
    assert.equal(sameBinding.status, 0, sameBinding.stderr);
    assert.match(sameBinding.stdout, /"laterCaller":true/);
    assert.match(sameBinding.stdout, /"usefulTransferred":false/);
    assert.equal(sameBinding.stdout.includes(PRIVATE), false);

    const seeded = run(["package/bin/seller-repair.mjs", "reject-seeded", "package/fixtures/seeded-false-useful.json"], roots[1]);
    assert.equal(seeded.status, 2);
    assert.match(seeded.stdout, /unknown_coverage_is_not_useful/);
    assert.match(seeded.stdout, /declaration_is_not_execution/);
    assert.match(seeded.stdout, /counterparty_not_mutated/);
  } finally {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  }

  assert.equal(sha256(readFileSync(frozenConsumer)), "3f3552e9cdedff9910211b1820b229daa834cf3811fcc5b38035046cefda4a27");
  const frozen = {
    "public-acquisition/bytes/l09-next-action/0.1.0/l09-next-action-0.1.0.tar.gz": "23bf8574b37c485b4b99f2e15f9b77a3239d0b2308a9048c25e118425a7f63d0",
    "public-acquisition/bytes/retained-task/0.1.0/retained-task-0.1.0.tar.gz": "350629b7bf1a14b092d94e0c27579f2e05114bf7f2f05a33c33d32b4c68176de",
    "public-acquisition/bytes/composition-route-knowledge/0.1.0/composition-route-knowledge-0.1.0.tgz": "11d5a0e2df86282b6d4edbeab84b6d8ab5ccdb26b44364042cf76c9576c23817",
  };
  for (const [rel, digest] of Object.entries(frozen)) {
    assert.equal(sha256(readFileSync(join(repo, rel))), digest, rel);
  }
});
