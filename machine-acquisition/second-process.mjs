#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { authorizeReceiptAction } from "../machine-acquisition.mjs";

function fail(message, code = 2) {
  process.stderr.write(`${message}\n`);
  process.exitCode = code;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const name = token.slice(2);
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.receipt || !args.binding || !args["skill-dir"] || !args.out) {
    fail("use --receipt --binding --skill-dir --out");
    return;
  }
  const receipt = JSON.parse(readFileSync(resolve(args.receipt), "utf8"));
  const binding = JSON.parse(readFileSync(resolve(args.binding), "utf8"));
  const skillDir = resolve(args["skill-dir"]);
  const reader = await import(pathToFileURL(resolve(skillDir, "scripts/receipt.mjs")).href);
  const now = typeof args.now === "string" ? args.now : new Date().toISOString();
  const decision = authorizeReceiptAction(receipt, binding, {
    now,
    readReceipt: reader.readReceipt,
    observedRecipient: typeof args["observed-recipient"] === "string" ? args["observed-recipient"] : undefined,
  });
  decision.checkedAt = now;
  decision.nativeHermesInstall = false;
  if (args["run-skill-continue"] === true && decision.observationAccepted === true) {
    const continuedPath = resolve(args.out).replace(/\.json$/, ".skill-continue.json");
    const child = spawnSync(process.execPath, [
      resolve(skillDir, "scripts/lock-and-capture.mjs"),
      "continue",
      "--receipt",
      resolve(args.receipt),
      "--out",
      continuedPath,
      "--now",
      now,
    ], { encoding: "utf8" });
    decision.skillContinue = {
      exitCode: child.status,
      stdout: child.stdout,
      stderr: child.stderr,
    };
    if (child.status === 0) {
      const continued = JSON.parse(readFileSync(continuedPath, "utf8"));
      decision.skillContinue.body = continued;
      if (continued.newAuthority !== "denied" || continued.paymentPermitted !== false || continued.executed !== false) {
        decision.actionAuthorized = false;
        decision.reason = "skill_continue_authorized";
        decision.exitCode = 2;
      }
    } else {
      decision.observationAccepted = false;
      decision.reason = "skill_continue_disagrees";
      decision.exitCode = child.status ?? 2;
    }
  }
  mkdirSync(dirname(resolve(args.out)), { recursive: true });
  writeFileSync(resolve(args.out), `${JSON.stringify(decision, null, 2)}\n`);
  process.exitCode = decision.exitCode;
}

main().catch((error) => fail(error.message || String(error), 2));
