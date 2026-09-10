#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifyPaidCallTimeout,
  classifyValidateVsIndex,
  compareRouteTemplatePolicies,
  diagnoseSpendLimits,
  proveHungUpstreamAborts,
  recoverSettlementTxid,
} from "../src/index.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

async function readJson(path) {
  const resolved = path.startsWith("/") ? path : join(ROOT, path);
  return JSON.parse(await readFile(resolved, "utf8"));
}

function help() {
  return `s117-requester-delivery — offline requester residuals (no pay, no push)

Commands:
  settlement --fixture <json> [--evidence-class independently_observed|provided_report]
  route-template --value <template>
  timeout --accept-max-timeout <seconds> [--client-timeout <seconds>] [--settlement-observed]
  hung-upstream [--timeout-ms 80]
  spend-limit --fixture <json>
  validate-index --fixture <json>

Fixtures live under fixtures/. This CLI does not fetch paid resources.
`;
}

const command = process.argv[2];
if (!command || command === "--help" || command === "help") {
  process.stdout.write(help());
  process.exit(0);
}

try {
  let report;
  if (command === "settlement") {
    const fixture = await readJson(arg("fixture") || "fixtures/settlement/aibtc666-provided-report.json");
    report = recoverSettlementTxid(fixture.response, {
      evidenceClass: arg("evidence-class") || fixture.evidenceClass,
    });
  } else if (command === "route-template") {
    report = compareRouteTemplatePolicies(arg("value"));
  } else if (command === "timeout") {
    report = classifyPaidCallTimeout({
      acceptMaxTimeoutSeconds: arg("accept-max-timeout") === undefined
        ? undefined
        : Number(arg("accept-max-timeout")),
      clientTimeoutSeconds: arg("client-timeout") === undefined
        ? undefined
        : Number(arg("client-timeout")),
      settlementObserved: flag("settlement-observed"),
    });
  } else if (command === "hung-upstream") {
    report = await proveHungUpstreamAborts({
      timeoutMs: arg("timeout-ms") === undefined ? 80 : Number(arg("timeout-ms")),
    });
  } else if (command === "spend-limit") {
    const fixture = await readJson(arg("fixture") || "fixtures/spend-limit/unreadable.json");
    report = diagnoseSpendLimits(fixture.limits);
  } else if (command === "validate-index") {
    const fixture = await readJson(arg("fixture") || "fixtures/unpaid-observations/fractalai-validate-summary.json");
    report = classifyValidateVsIndex(fixture);
  } else {
    process.stderr.write(`unknown command: ${command}\n${help()}`);
    process.exit(2);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
