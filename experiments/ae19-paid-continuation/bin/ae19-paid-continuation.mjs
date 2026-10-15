#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { evaluateFit } from "../extraction-contract/fit.mjs";
import { readRuntimeTerms } from "../extraction-contract/terms.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const command = process.argv[2] || "help";

function flag(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

if (command === "help" || command === "--help") {
  process.stdout.write(`ae19-paid-continuation
  fit --url <url>     free fit-check, no payment
  terms               read merchant extract terms, no write
`);
  process.exit(0);
}

if (command === "fit") {
  const url = flag("url");
  if (!url) {
    process.stderr.write("missing --url\n");
    process.exit(2);
  }
  process.stdout.write(`${JSON.stringify({ schema: "ae19.fit.v1", ...evaluateFit(url, { requireHttps: flag("https") === "required" }) })}\n`);
  process.exit(0);
}

if (command === "terms") {
  const terms = readRuntimeTerms(repoRoot);
  process.stdout.write(`${JSON.stringify({ schema: "ae19.terms.v1", ...terms })}\n`);
  process.exit(0);
}

process.stderr.write("usage\n");
process.exit(2);
