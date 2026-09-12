#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { compilePortableEvidence, readBoundedJson, readRunDirectory } from "../src/index.mjs";

function usage() {
  return "Usage: cw01-outcome-evidence --run <directory> [--run <directory> ...] [--catalog <json>] [--output <json>]";
}

function args(argv) {
  const out = { runs: [], catalog: null, output: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--run" && argv[i + 1]) out.runs.push(argv[++i]);
    else if (flag === "--catalog" && argv[i + 1]) out.catalog = argv[++i];
    else if (flag === "--output" && argv[i + 1]) out.output = argv[++i];
    else throw new Error(`${usage()}\nUnknown or incomplete option: ${flag}`);
  }
  if (out.runs.length === 0) throw new Error(usage());
  return out;
}

try {
  const options = args(process.argv.slice(2));
  const catalog = options.catalog ? readBoundedJson(options.catalog) : null;
  const exportValue = compilePortableEvidence(options.runs.map(directory => readRunDirectory(directory, { catalog })));
  const json = `${JSON.stringify(exportValue, null, 2)}\n`;
  if (options.output) writeFileSync(resolve(options.output), json, { encoding: "utf8", mode: 0o600, flag: "wx" });
  else process.stdout.write(json);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
