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
    if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error("usage");
    if (flag === "--run" && out.runs.length < 100) out.runs.push(argv[++i]);
    else if (flag === "--catalog" && out.catalog === null) out.catalog = argv[++i];
    else if (flag === "--output" && out.output === null) out.output = argv[++i];
    else throw new Error("usage");
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
  // Parser, validator and filesystem errors can contain private input fields,
  // URLs or paths. Emit only a fixed diagnostic vocabulary on this surface.
  const codes = new Set(["ENOENT", "EEXIST", "EACCES", "ELOOP", "ENOTDIR", "unsafe_input", "oversized_input", "malformed_json"]);
  const code = codes.has(error?.code) ? error.code : "invalid_evidence_or_arguments";
  process.stderr.write(`${code}\n${usage()}\n`);
  process.exitCode = 2;
}
