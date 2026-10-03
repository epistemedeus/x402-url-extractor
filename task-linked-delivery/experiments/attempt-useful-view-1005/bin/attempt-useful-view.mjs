#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ATTEMPT_OF } from "../src/constants.mjs";
import { refuseFalseJoin } from "../src/seam.mjs";
import { readAttemptUsefulView, replayAttemptReport } from "../src/view.mjs";

const MAX_BYTES = 1_048_576;

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return null;
  return process.argv[index + 1];
}

function readJson(file) {
  const text = readFileSync(resolve(file));
  if (text.length > MAX_BYTES) {
    const error = new Error("input_bytes_exceeded");
    error.code = "input_bytes_exceeded";
    throw error;
  }
  try {
    return JSON.parse(text.toString("utf8"));
  } catch {
    const error = new Error("invalid_json");
    error.code = "invalid_json";
    throw error;
  }
}

function reject(code, extra = {}) {
  process.stderr.write(`${JSON.stringify({
    decision: "reject",
    reason: code,
    attemptOf: null,
    inheritedUsefulness: null,
    useful: null,
    ...extra,
  })}\n`);
  process.exit(2);
}

const command = process.argv[2];
try {
  if (command === "report") {
    const receipt = arg("--receipt");
    const task = arg("--task");
    const baselinePath = arg("--baseline");
    if (!receipt || !task) reject("input_required");
    const report = readAttemptUsefulView({
      attemptOf: ATTEMPT_OF,
      taskRef: task,
      journal: readJson(receipt),
      baseline: baselinePath ? readJson(baselinePath) : null,
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (command === "reject") {
    const input = arg("--input");
    const baselinePath = arg("--baseline");
    if (!input || !baselinePath) reject("input_required");
    const refusal = refuseFalseJoin(readJson(baselinePath), readJson(input));
    process.stderr.write(`${JSON.stringify(refusal)}\n`);
    process.exit(2);
  } else if (command === "replay") {
    const receipt = arg("--receipt");
    if (!receipt) reject("input_required");
    process.stdout.write(`${JSON.stringify(replayAttemptReport(readJson(receipt)), null, 2)}\n`);
  } else {
    reject("invalid_command");
  }
} catch (error) {
  if (error?.code) reject(error.code);
  throw error;
}
