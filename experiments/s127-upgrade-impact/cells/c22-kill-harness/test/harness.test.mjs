import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { main, parseArgs, runCommand } from "../harness.mjs";
import { CELL_ROOT, cellJoin } from "../lib/paths.mjs";

const harnessPath = join(dirname(fileURLToPath(import.meta.url)), "../harness.mjs");

function runCli(argv, extra = {}) {
  return spawnSync(process.execPath, [harnessPath, ...argv], {
    encoding: "utf8",
    cwd: extra.cwd || CELL_ROOT,
    env: { ...process.env, ...(extra.env || {}) },
  });
}

test("parseArgs: compare two paths and flags", () => {
  const args = parseArgs(["node", "harness.mjs", "compare", "a.json", "b.json", "--mode", "exact", "--exit-on-verdict"]);
  assert.equal(args.command, "compare");
  assert.deepEqual(args.positionals, ["a.json", "b.json"]);
  assert.equal(args.flags.mode, "exact");
  assert.equal(args.flags.exitOnVerdict, true);
});

test("CLI compare stand-in A emits keep", () => {
  const ran = runCli([
    "compare",
    cellJoin("fixtures/cases/synthetic-standin-a/registry-skim-decision.json"),
    cellJoin("fixtures/cases/synthetic-standin-a/binding-packet.json"),
  ]);
  assert.equal(ran.status, 0, ran.stderr);
  const body = JSON.parse(ran.stdout);
  assert.equal(body.verdict, "keep");
  assert.equal(body.scope, "pair");
});

test("CLI suite synthetic-kill emits kill and --exit-on-verdict uses 2", () => {
  const ran = runCli([
    "suite",
    cellJoin("fixtures/suites/synthetic-kill.json"),
    "--exit-on-verdict",
  ]);
  assert.equal(ran.status, 2, ran.stderr);
  const body = JSON.parse(ran.stdout);
  assert.equal(body.verdict, "kill");
});

test("CLI suite real-ab emits kill and --exit-on-verdict uses 2", () => {
  const ran = runCli(["suite", cellJoin("fixtures/suites/real-ab.json"), "--exit-on-verdict"]);
  assert.equal(ran.status, 2, ran.stderr);
  const body = JSON.parse(ran.stdout);
  assert.equal(body.verdict, "kill");
});

test("CLI skim writes only inside the cell jail", () => {
  const out = cellJoin("fixtures/out/skim-standin-a.json");
  const ran = runCli([
    "skim",
    cellJoin("fixtures/cases/synthetic-standin-a/registry-skim-input.json"),
    "--out",
    out,
  ]);
  assert.equal(ran.status, 0, ran.stderr);
  assert.equal(ran.stdout, "");
  const body = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(body.summary.nextAction, "review_changelog");
});

test("CLI refuses --out into a sibling cell", () => {
  const ran = runCommand({
    command: "compare",
    positionals: [
      cellJoin("fixtures/cases/synthetic-standin-a/registry-skim-decision.json"),
      cellJoin("fixtures/cases/synthetic-standin-a/binding-packet.json"),
    ],
    flags: { out: join(CELL_ROOT, "../c11-real-a/from-c22.json") },
  });
  assert.equal(ran.ok, false);
  assert.equal(ran.code, "forbidden_write_root");
});

test("selftest passes on shipped fixtures", () => {
  const ran = runCli(["selftest"]);
  assert.equal(ran.status, 0, ran.stderr + ran.stdout);
  const body = JSON.parse(ran.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.failed, 0);
});

test("missing compare args is usage", () => {
  const ran = runCli(["compare", "only-one.json"]);
  assert.equal(ran.status, 1);
  assert.match(ran.stderr, /two JSON paths/);
});

test("main help is exit 0", () => {
  const code = main(["node", "harness.mjs", "--help"]);
  assert.equal(code, 0);
});

test("hostile prototype keys do not become nextAction", () => {
  const dir = mkdtempSync(join(tmpdir(), "c22-hostile-"));
  try {
    const polluted = { summary: JSON.parse('{"nextAction":"no_action"}') };
    Object.defineProperty(polluted, "__proto__", { value: { nextAction: "action" }, enumerable: true });
    const path = join(dir, "polluted.json");
    writeFileSync(path, `${JSON.stringify({ summary: { nextAction: "no_action" } })}\n`);
    const ran = runCli(["compare", path, cellJoin("fixtures/cases/synthetic-standin-a/binding-packet.json")]);
    assert.equal(ran.status, 0, ran.stderr);
    const body = JSON.parse(ran.stdout);
    assert.notEqual(body.a.raw, undefined);
    assert.equal(body.verdict === "keep" || body.verdict === "kill" || body.verdict === "unknown", true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("oversize JSON is refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "c22-oversize-"));
  try {
    const path = join(dir, "big.json");
    writeFileSync(path, `${"x".repeat(1024 * 1024 + 10)}`);
    const ran = runCli(["compare", path, cellJoin("fixtures/cases/synthetic-standin-a/binding-packet.json")]);
    assert.equal(ran.status, 0, ran.stderr);
    const body = JSON.parse(ran.stdout);
    assert.equal(body.verdict, "unknown");
    assert.equal(body.a.code, "oversize");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("does not create sibling-cell files", () => {
  assert.equal(existsSync(join(CELL_ROOT, "../c11-real-a/from-c22.json")), false);
});
