#!/usr/bin/env node
/**
 * Cold consumer B — invoke the public CLI only.
 * Case: cookie 1.1.1 → 2.0.1 with a parse-only caller slice.
 */
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packRoot = join(here, "../..");
const cli = join(packRoot, "scripts/cli.mjs");
const out = join(here, "packet.json");
const caller = join(here, "caller-primary");
const clock = "2026-09-10T10:48:00.000Z";

mkdirSync(join(caller, "src"), { recursive: true });
cpSync(
  join(packRoot, "fixtures/real-b/caller/package.json"),
  join(caller, "package.json"),
);
cpSync(
  join(packRoot, "fixtures/real-b/caller/src/read-session-cookie.mjs"),
  join(caller, "src/read-session-cookie.mjs"),
);

const args = [
  cli,
  "analyze",
  "--dep",
  "cookie",
  "--old",
  "1.1.1",
  "--new",
  "2.0.1",
  "--clock",
  clock,
  "--manifest",
  join(caller, "package.json"),
  "--source-root",
  join(caller, "src"),
  "--fixture-old",
  join(packRoot, "fixtures/real-b/extracted/cookie-1.1.1"),
  "--fixture-new",
  join(packRoot, "fixtures/real-b/extracted/cookie-2.0.1"),
  "--evidence-class",
  "fixture",
  "--out",
  out,
];

const ran = spawnSync(process.execPath, args, {
  cwd: packRoot,
  encoding: "utf8",
  maxBuffer: 8 * 1024 * 1024,
});
if (ran.status !== 0) {
  process.stderr.write(ran.stderr || ran.stdout || "cli failed\n");
  process.exit(ran.status || 1);
}

const packet = JSON.parse(ran.stdout.slice(ran.stdout.indexOf("{")));
const next = packet.summary?.nextAction;
const actionable = packet.summary?.actionableChanges || [];
const unused = packet.summary?.unusedChanges || [];
const summary = {
  cell: "c16-cold-b",
  ok: packet.ok === true,
  nextAction: next,
  actionableChanges: actionable,
  unusedIncludesSerialize: unused.includes("serialize"),
  packetPath: out,
};
writeFileSync(join(here, "receipt.json"), `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (next !== "action" || !actionable.includes("parse")) {
  process.exit(1);
}
