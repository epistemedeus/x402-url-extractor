#!/usr/bin/env node
/**
 * Cold consumer A — invoke the public CLI only.
 * Case: path-to-regexp 6.3.0 → 8.4.2 against fixtures/real-a/caller.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packRoot = join(here, "../..");
const cli = join(packRoot, "scripts/cli.mjs");
const out = join(here, "packet.json");
const clock = "2026-09-10T10:48:00.000Z";

const args = [
  cli,
  "analyze",
  "--dep",
  "path-to-regexp",
  "--old",
  "6.3.0",
  "--new",
  "8.4.2",
  "--clock",
  clock,
  "--manifest",
  join(packRoot, "fixtures/real-a/caller/package.json"),
  "--source-root",
  join(packRoot, "fixtures/real-a/caller/src"),
  "--fixture-old",
  join(packRoot, "fixtures/real-a/extracted/6.3.0/package"),
  "--fixture-new",
  join(packRoot, "fixtures/real-a/extracted/8.4.2/package"),
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
process.stdout.write(
  JSON.stringify(
    {
      cell: "c15-cold-a",
      ok: packet.ok === true,
      nextAction: next,
      actionableChanges: actionable,
      unusedSample: (packet.summary?.unusedChanges || []).slice(0, 6),
      packetPath: out,
    },
    null,
    2,
  ) + "\n",
);
if (next !== "action" || !actionable.includes("pathToRegexp")) {
  process.exit(1);
}
