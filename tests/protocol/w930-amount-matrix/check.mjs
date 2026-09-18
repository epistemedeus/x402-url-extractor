#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CODES, REFUSED_FLAGS } from "./constants.mjs";
import { evaluateAmountMatrix } from "./evaluate.mjs";
import { BUILTIN_FIXTURES } from "./fixtures.mjs";
import { captureUnpaidMatrix, startLocalMerchant } from "./probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures");

export const BUNDLED = Object.freeze({
  canonical: join(FIXTURES, "canonical-matrix.json"),
  "seeded-extract-onto-scan": join(FIXTURES, "seeded-extract-onto-scan.json"),
  "seeded-invented-field": join(FIXTURES, "seeded-invented-field.json"),
  "treat-absence-as-demand": join(FIXTURES, "treat-absence-as-demand.json"),
});

function usage(exitCode = 2) {
  console.error(`Usage: node tests/protocol/w930-amount-matrix/check.mjs [--cold|--seeded-failure|<fixture.json|canonical|seeded-extract-onto-scan|seeded-invented-field|treat-absence-as-demand>]
Unpublished w930 unpaid amount matrix. No pay, no --live, no CDP, no OpenServ listing.`);
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

function loadDocument(input) {
  if (BUILTIN_FIXTURES[input]) return BUILTIN_FIXTURES[input]();
  const path = resolveFixturePath(input);
  return JSON.parse(readFileSync(path, "utf8"));
}

function print(report) {
  console.log(JSON.stringify(report, null, 2));
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
  const seeded = argv.includes("--seeded-failure");
  const input = seeded
    ? "seeded-extract-onto-scan"
    : argv.find((arg) => !String(arg).startsWith("--"));
  if (!input) {
    usage(2);
  }
  let document;
  try {
    document = loadDocument(input);
  } catch (error) {
    print({
      ok: false,
      decision: "refuse",
      codes: ["malformed_fixture"],
      message: error.message,
      paymentAttempted: false,
    });
    return 1;
  }
  const report = evaluateAmountMatrix(document);
  print(report);
  if (seeded) {
    if (report.ok) {
      console.error("SEEDED_FAILURE must not pass the amount matrix");
      return 2;
    }
    if (!report.codes.includes(CODES.COPY_EXTRACT_ONTO_SCAN) || !report.codes.includes(CODES.AMOUNT_MISMATCH)) {
      console.error("SEEDED_FAILURE must reject copy of extract 5000 onto /scan");
      return 2;
    }
    console.error(
      `SEEDED_FAILURE rejected id=${document.id} codes=${report.codes.join(",")} scan.httpAmount=${report.rows.find((row) => row.id === "scan")?.httpAmount} expected=${report.rows.find((row) => row.id === "scan")?.expectedAmountAtomic}`,
    );
  }
  return report.ok ? 0 : 1;
}

export async function runCold(argv = process.argv.slice(2)) {
  const refused = refusedFlag(argv);
  if (refused) {
    console.error(`${refused} is refused`);
    return 2;
  }
  const originIndex = argv.indexOf("--origin");
  const origin = originIndex >= 0 ? argv[originIndex + 1] : null;
  let merchant = null;
  try {
    const base = origin || (merchant = await startLocalMerchant()).base;
    const captured = await captureUnpaidMatrix(base);
    const report = evaluateAmountMatrix(captured);
    report.coldRun = {
      base,
      spawned: !origin,
      paymentHeadersSent: false,
      facilitatorSettleCalled: false,
    };
    print(report);
    return report.ok ? 0 : 1;
  } finally {
    if (merchant) await merchant.close();
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const argv = process.argv.slice(2);
  if (argv.includes("--cold")) {
    process.exitCode = await runCold(argv);
  } else {
    process.exitCode = runCheck(argv);
  }
}
