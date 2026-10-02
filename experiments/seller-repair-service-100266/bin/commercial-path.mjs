#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { readInputText } from "../commercial/read-input.mjs";

import {
  DELIVER_HELP,
  executeCallerRequest,
  resolveLater,
} from "../commercial/caller-request.mjs";
import {
  buyerPath,
  defaultCallers,
  invitationPacket,
  rejectCommercialSeed,
  runCommercialDeliver,
} from "../commercial/deliver.mjs";

const blocked = ["COMMERCE_DATA_DIR", "COMMERCE_INTERNAL_TOKEN", "USEFUL_RESULT_GRANT", "SELLER_REPAIR_PRIVATE"];
if (blocked.some((name) => process.env[name])) {
  process.stderr.write("producer_state_present\n");
  process.exit(2);
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] || null;
}

function publicReceipt(result, commandName) {
  return {
    schema: result.schema,
    ok: result.ok === true,
    failed: result.failed || [],
    charged: false,
    paymentSent: false,
    priceChanged: false,
    skuAdded: false,
    recognizedRevenueAtomic: "0",
    mode: result.mode || commandName,
    qa: result.qa === true,
    visitorExecution: result.visitorExecution === true,
    fixtureTransport: result.fixtureTransport === true,
    detail: result.detail || null,
    diagnosis: result.diagnosis || null,
    refusals: result.refusals || null,
    economics: result.economics || null,
    laterChanged: result.laterChanged || null,
    shareReplay: result.shareReplay || null,
    artifactTrusted: result.artifact?.trusted === true,
    command: `node experiments/seller-repair-service-100266/bin/commercial-path.mjs ${commandName}`,
  };
}


const command = process.argv[2];

if (command === "buyer") {
  process.stdout.write(`${JSON.stringify(buyerPath())}\n`);
  process.exit(0);
}

if (command === "invitation") {
  process.stdout.write(`${JSON.stringify(invitationPacket())}\n`);
  process.exit(0);
}

if (command === "reject-seeded") {
  const file = process.argv[3];
  if (!file) {
    process.stderr.write("claim_required\n");
    process.exit(2);
  }
  const claim = JSON.parse(await readInputText(file));
  const result = rejectCommercialSeed(claim);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(result.refused ? 2 : 1);
}

if (command === "later") {
  const artifactPath = arg("--artifact");
  const callerPath = arg("--caller");
  if (!artifactPath || !callerPath) {
    process.stderr.write("artifact_and_caller_required\n");
    process.exit(2);
  }
  let artifact;
  let caller;
  try {
    artifact = JSON.parse(await readInputText(artifactPath));
    caller = JSON.parse(await readInputText(callerPath));
  } catch (error) {
    process.stderr.write(`request_malformed\n${error.message}\n`);
    process.exit(2);
  }
  const later = await resolveLater(artifact, caller);
  process.stdout.write(`${JSON.stringify({ ...later, paymentSent: false, recognizedRevenueAtomic: "0" })}\n`);
  process.exit(later.exitCode ?? (later.refused ? 2 : 0));
}

if (command === "self-test") {
  const callers = defaultCallers();
  const result = await runCommercialDeliver(callers);
  const out = arg("--out");
  const receipt = publicReceipt(result, "self-test");
  if (out && result.artifact) {
    await mkdir(out, { recursive: true });
    await writeFile(`${out}/regression.json`, `${JSON.stringify(result.artifact, null, 2)}\n`);
    await writeFile(`${out}/buyer-path.json`, `${JSON.stringify(result.buyer, null, 2)}\n`);
    await writeFile(`${out}/invitation.json`, `${JSON.stringify(result.invitation, null, 2)}\n`);
    await writeFile(`${out}/receipt.json`, `${JSON.stringify(receipt, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  process.exit(result.ok ? 0 : 1);
}

if (command === "deliver") {
  const requestPath = arg("--request");
  if (!requestPath) {
    process.stderr.write(`${DELIVER_HELP}\n`);
    process.stdout.write(`${JSON.stringify({
      ok: false,
      executed: false,
      help: true,
      reason: "deliver_request_required",
      charged: false,
      paymentSent: false,
      order: false,
      recognizedRevenueAtomic: "0",
    })}\n`);
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
    process.stdout.write(`${JSON.stringify({
      ok: false,
      executed: false,
      help: true,
      reason: "deliver_request_required",
      charged: false,
      paymentSent: false,
      recognizedRevenueAtomic: "0",
    })}\n`);
    process.exit(2);
  }
  let input;
  try {
    input = JSON.parse(text);
  } catch (error) {
    process.stderr.write(`request_malformed\n${error.message}\n${DELIVER_HELP}\n`);
    process.stdout.write(`${JSON.stringify({
      ok: false,
      executed: false,
      help: true,
      reason: "request_malformed",
      charged: false,
      paymentSent: false,
      recognizedRevenueAtomic: "0",
    })}\n`);
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
}

process.stderr.write("command_required\n");
process.stderr.write("commands: buyer | invitation | deliver --request <file> | self-test | later --artifact <file> --caller <file> | reject-seeded <file>\n");
process.exit(2);
