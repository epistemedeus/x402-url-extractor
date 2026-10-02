#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { readInputText } from "../commercial/read-input.mjs";

import { DELIVER_HELP, executeCallerRequest, resolveLater } from "../commercial/caller-request.mjs";

const blocked = ["COMMERCE_DATA_DIR", "COMMERCE_INTERNAL_TOKEN", "USEFUL_RESULT_GRANT", "SELLER_REPAIR_PRIVATE"];
if (blocked.some((name) => process.env[name])) {
  process.stderr.write("producer_state_present\n");
  process.exit(2);
}

const [major, minor, patch] = process.versions.node.split(".").map(Number);
const pinOk = major > 22 || (major === 22 && (minor > 22 || (minor === 22 && patch >= 0)));
if (!pinOk) {
  process.stderr.write(`node_pin_unsatisfied ${process.version} requires >=22.22.0\n`);
  process.exit(2);
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] || null;
}


const command = process.argv[2] || "deliver";

if (command === "later") {
  const artifactPath = arg("--artifact");
  const callerPath = arg("--caller");
  if (!artifactPath || !callerPath) {
    process.stderr.write("artifact_and_caller_required\n");
    process.exit(2);
  }
  const artifact = JSON.parse(await readInputText(artifactPath));
  const caller = JSON.parse(await readInputText(callerPath));
  const later = await resolveLater(artifact, caller);
  process.stdout.write(`${JSON.stringify({ ...later, paymentSent: false, privateImported: false, recognizedRevenueAtomic: "0" })}\n`);
  process.exit(later.exitCode ?? (later.refused ? 2 : 0));
}

if (command !== "deliver") {
  process.stderr.write("commands: deliver --request <file> | later --artifact <file> --caller <file>\n");
  process.exit(2);
}

const requestPath = arg("--request");
if (!requestPath) {
  process.stderr.write(`${DELIVER_HELP}\n`);
  process.stdout.write(`${JSON.stringify({ ok: false, executed: false, help: true, reason: "deliver_request_required", charged: false, paymentSent: false, recognizedRevenueAtomic: "0" })}\n`);
  process.exit(2);
}
let text;
try {
  text = await readInputText(requestPath);
} catch (error) {
  process.stderr.write(`${error.code || "request_unreadable"}\n`);
  process.exit(2);
}
if (!text.trim()) {
  process.stderr.write(`${DELIVER_HELP}\n`);
  process.exit(2);
}
let input;
try {
  input = JSON.parse(text);
} catch (error) {
  process.stderr.write(`request_malformed\n${error.message}\n`);
  process.exit(2);
}
const result = await executeCallerRequest(input);
const out = arg("--out");
if (out) {
  await mkdir(out, { recursive: true });
  if (result.artifact) await writeFile(`${out}/regression.json`, `${JSON.stringify(result.artifact, null, 2)}\n`);
  await writeFile(`${out}/receipt.json`, `${JSON.stringify(result.receipt, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify(result.receipt)}\n`);
process.exit(result.exitCode);
