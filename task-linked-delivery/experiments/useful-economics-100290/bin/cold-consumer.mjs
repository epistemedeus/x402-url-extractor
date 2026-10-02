#!/usr/bin/env node
// Cold check of the public archive. Provider directories, internal tokens,
// and customer grants are refused. This process does not read a ledger.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateBundle } from "../src/evaluate.mjs";
import { EconomicsError } from "../src/errors.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

if (process.env.COMMERCE_DATA_DIR || process.env.COMMERCE_INTERNAL_TOKEN || process.env.USEFUL_RESULT_GRANT) {
  process.stderr.write("provider_env_refused\n");
  process.exit(2);
}

const [mode, fileArg] = process.argv.slice(2);
const fixture = (name) => path.join(root, "fixtures", name);

function readBundle(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

try {
  if (mode === "accepted") {
    const receipt = await evaluateBundle(readBundle(fileArg || fixture("accepted.json")));
    const useful = receipt.journeys.some((journey) => journey.useful === "agreed_negative" || journey.useful === "true");
    const booked = receipt.economics.recognizedRevenueAtomic !== "0"
      || receipt.economics.historicalCountsAsMargin === true
      || receipt.economics.historicalCountedInBreakeven === true
      || receipt.demandEstablished === true;
    if (!useful || booked) {
      process.stderr.write("accepted_check_failed\n");
      process.exitCode = 1;
    } else {
      process.stdout.write(`${JSON.stringify({
        useful: receipt.journeys.map((journey) => journey.useful),
        recognizedRevenueAtomic: receipt.economics.recognizedRevenueAtomic,
        historicalCountedInBreakeven: receipt.economics.historicalCountedInBreakeven,
        demandEstablished: false,
        profit: null,
      })}\n`);
    }
  } else if (mode === "reject") {
    let receipt = null;
    try {
      receipt = await evaluateBundle(readBundle(fileArg || fixture("seeded-http200.json")));
    } catch (error) {
      const code = error instanceof EconomicsError ? error.code : "invalid_bundle";
      process.stderr.write(`${code}\n`);
      process.exitCode = 2;
    }
    if (receipt) {
      const accepted = receipt.journeys.some((journey) => journey.useful === "true" || journey.useful === "agreed_negative");
      if (accepted || receipt.economics.recognizedRevenueAtomic !== "0" || receipt.economics.historicalCountsAsMargin === true) {
        process.stderr.write("seeded_claim_was_accepted\n");
        process.exitCode = 1;
      } else {
        process.stderr.write(`${receipt.journeys[0]?.reasons?.[0] || "seeded_rejected"}\n`);
        process.exitCode = 2;
      }
    }
  } else {
    process.stderr.write("usage: cold-consumer.mjs accepted|reject [bundle]\n");
    process.exitCode = 2;
  }
} catch (error) {
  const code = error instanceof EconomicsError ? error.code : "invalid_bundle";
  process.stderr.write(`${code}\n`);
  process.exitCode = 2;
}
