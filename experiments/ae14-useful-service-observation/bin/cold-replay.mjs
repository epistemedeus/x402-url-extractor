#!/usr/bin/env node
import { coldReplay } from "../src/cold-replay.mjs";

const dir = process.argv[2];
const coverage = process.argv.includes("--gap") ? "gap" : "unknown_for_full_window";
if (!dir) {
  process.stderr.write("usage: cold-replay.mjs <data-dir> [--gap]\n");
  process.exit(2);
}
const report = await coldReplay(dir, { windowCoverage: coverage });
process.stdout.write(`${JSON.stringify(report)}\n`);
