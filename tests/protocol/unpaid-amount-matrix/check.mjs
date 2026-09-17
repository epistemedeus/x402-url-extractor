#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { REFUSED_FLAGS } from "./constants.mjs";
import { evaluateAmountMatrix } from "./evaluate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures");

export const BUNDLED = Object.freeze({
  canonical: join(FIXTURES, "canonical-matrix.json"),
  "seeded-extract-onto-scan": join(FIXTURES, "seeded-extract-onto-scan.json"),
  "seeded-invented-field": join(FIXTURES, "seeded-invented-field.json"),
  "treat-absence-as-demand": join(FIXTURES, "treat-absence-as-demand.json"),
});

function usage(exitCode = 2) {
  console.error("Usage: node tests/protocol/unpaid-amount-matrix/check.mjs <fixture.json|canonical|seeded-extract-onto-scan|seeded-invented-field|treat-absence-as-demand>");
  console.error("Unpublished unpaid amount matrix. No pay, no --live, no CDP, no OpenServ listing.");
  process.exit(exitCode);
}

function refusedFlag(argv) {
  for (const arg of argv) {
    const name = String(arg).replace(/^--/, "");
    if (REFUSED_FLAGS.includes(name)) return arg;
  }
  return null;
}

export function resolveFixturePath(input) {
  if (!input) return null;
  if (BUNDLED[input]) return BUNDLED[input];
  return resolve(input);
}

export function runCheck(argv = process.argv.slice(2)) {
  const refused = refusedFlag(argv);
  if (refused) {
    console.error(`${refused} is refused`);
    return 2;
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    usage(0);
  }
  const input = argv.find((arg) => !String(arg).startsWith("--"));
  if (!input) {
    usage(2);
  }
  const path = resolveFixturePath(input);
  let document;
  try {
    document = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    console.log(JSON.stringify({
      ok: false,
      decision: "refuse",
      codes: ["malformed_fixture"],
      message: error.message,
      paymentAttempted: false,
    }, null, 2));
    return 1;
  }
  const report = evaluateAmountMatrix(document);
  console.log(JSON.stringify(report, null, 2));
  return report.ok ? 0 : 1;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  process.exitCode = runCheck();
}
