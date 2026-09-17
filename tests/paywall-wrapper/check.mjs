#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { evaluatePaywallWrapper } from "./evaluate.mjs";

function usage(exitCode = 2) {
  console.error("Usage: node tests/paywall-wrapper/check.mjs <fixture.json>");
  console.error("Local unpublished fixtures only. Never lists, pays, or calls OpenServ.");
  process.exit(exitCode);
}

const fixturePath = process.argv[2];
if (!fixturePath || fixturePath === "--help" || fixturePath === "-h") usage(fixturePath ? 0 : 2);

let fixture;
try {
  fixture = JSON.parse(readFileSync(resolve(fixturePath), "utf8"));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    decision: "refuse",
    codes: ["malformed_fixture"],
    message: error.message,
    walletAccessed: false,
    paymentSigned: false,
    paymentSent: false,
  }));
  process.exit(1);
}

const report = evaluatePaywallWrapper(fixture);
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
