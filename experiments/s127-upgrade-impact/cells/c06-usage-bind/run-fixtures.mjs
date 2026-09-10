#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bindUsageToExportDiff } from "./bind.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "fixtures");

const rows = [];
for (const name of readdirSync(fixturesDir).sort()) {
  if (!name.endsWith(".json") || name === "PROVENANCE.json") continue;
  const fixture = JSON.parse(readFileSync(join(fixturesDir, name), "utf8"));
  const result = bindUsageToExportDiff(fixture.input);
  rows.push({
    id: fixture.id,
    label: fixture.label,
    expected: fixture.expect?.nextAction,
    nextAction: result.summary.nextAction,
    actionable: result.summary.actionableChanges.map((row) => row.symbol),
    unused: result.summary.unusedChanges.map((row) => row.symbol),
    unknownReasons: result.summary.unknownReasons,
    match: result.summary.nextAction === fixture.expect?.nextAction,
  });
}

console.log(JSON.stringify({ label: "synthetic", count: rows.length, rows }, null, 2));
const failed = rows.filter((row) => !row.match);
if (failed.length > 0) {
  console.error(`fixture mismatches: ${failed.map((row) => row.id).join(", ")}`);
  process.exit(1);
}
