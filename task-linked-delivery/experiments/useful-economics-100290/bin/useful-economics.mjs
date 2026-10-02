#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";

import { evaluateBundle, toPublic } from "../src/evaluate.mjs";
import { EconomicsError } from "../src/errors.mjs";

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      out._.push(token);
      continue;
    }
    const name = token.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) out[name] = true;
    else {
      out[name] = value;
      i += 1;
    }
  }
  return out;
}

function readBundle(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function refuse(error) {
  const code = error instanceof EconomicsError ? error.code : "invalid_bundle";
  process.stderr.write(`${code}\n`);
  process.exitCode = 2;
}

const [command] = process.argv.slice(2);
const args = parseArgs(process.argv.slice(3));

try {
  if (command === "join" || command === "query") {
    const receipt = await evaluateBundle(readBundle(args.bundle), { sealedAt: args.at || "2026-10-02T00:00:00.000Z" });
    const body = args.view === "full" ? receipt : toPublic(receipt);
    process.stdout.write(`${JSON.stringify(body)}\n`);
  } else if (command === "reject-seeded") {
    let receipt = null;
    try {
      receipt = await evaluateBundle(readBundle(args.bundle || args._[0]));
    } catch (error) {
      refuse(error);
    }
    if (receipt) {
      const acceptedUseful = receipt.journeys.some((journey) => journey.useful === "true" || journey.useful === "agreed_negative");
      const bookedHistory = receipt.economics.historicalCountedInBreakeven === true
        || receipt.economics.historicalCountsAsMargin === true
        || receipt.economics.recognizedRevenueAtomic !== "0";
      if (acceptedUseful || bookedHistory) {
        process.stderr.write("seeded_claim_was_accepted\n");
        process.exitCode = 1;
      } else {
        process.stderr.write(`${receipt.journeys[0]?.reasons?.[0] || "seeded_rejected"}\n`);
        process.exitCode = 2;
      }
    }
  } else if (command === "append") {
    const file = args.receipts;
    const priorText = await readFile(file, "utf8");
    const lines = priorText.split("\n").filter(Boolean);
    const prior = JSON.parse(lines[lines.length - 1]);
    const before = Buffer.byteLength(priorText);
    const receipt = await evaluateBundle(readBundle(args.bundle), { prior, sealedAt: args.at || prior.sealedAt });
    if (receipt.observationDigest === prior.observationDigest) {
      process.stderr.write("duplicate_append\n");
      process.exitCode = 2;
    } else {
      await appendFile(file, `${JSON.stringify(receipt)}\n`);
      const after = await readFile(file);
      if (!after.subarray(0, before).equals(Buffer.from(priorText))) {
        process.stderr.write("receipt_rewritten\n");
        process.exitCode = 1;
      } else {
        process.stdout.write(`${JSON.stringify({ generation: receipt.generation, priorReceiptId: receipt.priorReceiptId, receiptId: receipt.receiptId })}\n`);
      }
    }
  } else {
    process.stderr.write("usage: useful-economics.mjs join|query|reject-seeded|append --bundle file\n");
    process.exitCode = 2;
  }
} catch (error) {
  refuse(error);
}
