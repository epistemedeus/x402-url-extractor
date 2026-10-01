#!/usr/bin/env node
/**
 * route-lock-receipt 0.1.0
 * Maps one unpaid HTTP challenge through the vendored route-release-decision
 * 0.1.0 scripts, then lets a later process read that receipt at its own clock.
 * Payment, settlement, signature, and fund reservation stay refused.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readReceipt } from "./receipt.mjs";
import { runTask } from "./run-task.mjs";

const VERSION = "0.1.0";
const CONTINUATION_SCHEMA = "neomorphic.route-lock-receipt.continuation.v1";
const REFUSED = new Set([
  "pay",
  "settle",
  "publish",
  "sign",
  "reserve",
  "register",
  "deploy",
  "submit",
  "authenticate",
  "owner-pay",
]);

function fail(message, code = 2) {
  process.stderr.write(`${message}\n`);
  process.exitCode = code;
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      out._.push(token);
      continue;
    }
    const name = token.slice(2);
    if (REFUSED.has(name)) {
      const error = new Error(`refusing --${name}`);
      error.code = "refused_flag";
      throw error;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      out[name] = true;
      continue;
    }
    out[name] = value;
    i += 1;
  }
  return out;
}

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function continuation(reading) {
  const observationCurrent = reading.currentAuthority?.observationCurrent === true;
  return {
    schema: CONTINUATION_SCHEMA,
    skill: "route-lock-receipt",
    version: VERSION,
    newAuthority: "denied",
    reason: reading.currentAuthority?.reason || "unreadable",
    observationCurrent,
    diagnosticReusable: reading.diagnosticReuse?.reusable === true,
    paymentPermitted: false,
    fundsReserved: false,
    ownerPayment: false,
    paidServiceLaunch: false,
    executed: false,
    currentAuthority: {
      granted: false,
      observationCurrent,
      reason: reading.currentAuthority?.reason || "unreadable",
      id: reading.currentAuthority?.id || null,
      paymentPermitted: false,
    },
  };
}

async function mapChallenge(args) {
  if (typeof args.url !== "string" || typeof args.cache !== "string" || typeof args.out !== "string") {
    fail("map requires --url, --cache, and --out");
    return;
  }
  const receipt = await runTask({
    task: "map-unpaid-challenge",
    url: args.url,
    cache: resolve(args.cache),
    mutation: typeof args.mutation === "string" ? args.mutation : "none",
  });
  writeJson(resolve(args.out), receipt);
  process.exitCode = receipt.exitCode ?? 2;
}

function continueReceipt(args) {
  if (typeof args.receipt !== "string" || typeof args.out !== "string") {
    fail("continue requires --receipt and --out");
    return;
  }
  let receipt;
  try {
    receipt = JSON.parse(readFileSync(resolve(args.receipt), "utf8"));
  } catch (error) {
    const reading = {
      currentAuthority: { granted: false, observationCurrent: false, reason: "unreadable", id: null, paymentPermitted: false },
      diagnosticReuse: { reusable: false },
    };
    writeJson(resolve(args.out), continuation(reading));
    fail(error.message || "receipt is unreadable", 2);
    return;
  }
  const now = typeof args.now === "string" ? args.now : new Date().toISOString();
  const reading = readReceipt(receipt, { now });
  const record = continuation(reading);
  record.checkedAt = now;
  writeJson(resolve(args.out), record);
  if (reading.currentAuthority?.reason === "unreadable") {
    process.exitCode = 2;
    return;
  }
  process.exitCode = record.observationCurrent ? 0 : 3;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (command === "map") {
    await mapChallenge(args);
    return;
  }
  if (command === "continue") {
    continueReceipt(args);
    return;
  }
  fail("use map or continue");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    fail(error.message || String(error), error.code === "refused_flag" ? 2 : 2);
  });
}
