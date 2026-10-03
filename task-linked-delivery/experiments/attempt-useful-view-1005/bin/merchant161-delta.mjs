#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assertDeltaApplied, integrationDeltaState } from "../src/delta.mjs";
import { readPersistedAttempt } from "../src/read.mjs";

const MAX_BYTES = 1_048_576;

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return null;
  return process.argv[index + 1];
}

function reject(code) {
  process.stderr.write(`${JSON.stringify({
    decision: "reject",
    reason: code,
    attemptOf: null,
    liveCoverage: "unresolved",
    paidSuccess: "unresolved",
  })}\n`);
  process.exit(2);
}

const command = process.argv[2];
try {
  if (process.env.ATTEMPT_USEFUL_PIN_PROBE === "wrong-merchant") reject("merchant_pin_rejected");
  if (command === "check") {
    const delta = assertDeltaApplied();
    const committedPath = fileURLToPath(new URL("../export/ROOT-INTEGRATION-DELTA.json", import.meta.url));
    const committed = JSON.parse(readFileSync(committedPath, "utf8"));
    if (JSON.stringify(committed) !== JSON.stringify(delta)) reject("delta_export_drift");
    process.stdout.write(`${JSON.stringify(delta, null, 2)}\n`);
  } else if (command === "read") {
    const dataDir = arg("--data-dir");
    const task = arg("--task");
    const baselinePath = arg("--baseline");
    if (!dataDir || !task) reject("input_required");
    let baseline = null;
    if (baselinePath) {
      const text = readFileSync(baselinePath);
      if (text.length > MAX_BYTES) reject("input_bytes_exceeded");
      baseline = JSON.parse(text.toString("utf8"));
    }
    const report = await readPersistedAttempt({ dataDir, taskRef: task, baseline, internalToken: process.env.COMMERCE_INTERNAL_TOKEN || "", cutId: arg("--cut-id"), commerceEventId: arg("--event") });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    reject("invalid_command");
  }
} catch (error) {
  if (error?.code) reject(error.code);
  throw error;
}
