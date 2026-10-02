#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";

import {
  buyerPath,
  consumeLaterArtifact,
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

function publicReceipt(result) {
  return {
    schema: result.schema,
    ok: result.ok === true,
    failed: result.failed || [],
    charged: false,
    paymentSent: false,
    priceChanged: false,
    skuAdded: false,
    recognizedRevenueAtomic: "0",
    detail: result.detail || null,
    diagnosis: result.diagnosis || null,
    refusals: result.refusals || null,
    economics: result.economics || null,
    laterChanged: result.laterChanged || null,
    shareReplay: result.shareReplay || null,
    artifactTrusted: result.artifact?.trusted === true,
    command: "node experiments/seller-repair-service-100266/bin/commercial-path.mjs deliver",
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
  const claim = JSON.parse(await readFile(file, "utf8"));
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
  const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
  const caller = JSON.parse(await readFile(callerPath, "utf8"));
  const later = consumeLaterArtifact(artifact, caller);
  process.stdout.write(`${JSON.stringify({ ...later, paymentSent: false, recognizedRevenueAtomic: "0" })}\n`);
  process.exit(later.refused ? 2 : 0);
}

if (command === "deliver") {
  const callers = defaultCallers();
  const result = await runCommercialDeliver(callers);
  const out = arg("--out");
  if (out) {
    await mkdir(out, { recursive: true });
    await writeFile(`${out}/regression.json`, `${JSON.stringify(result.artifact, null, 2)}\n`);
    await writeFile(`${out}/buyer-path.json`, `${JSON.stringify(result.buyer, null, 2)}\n`);
    await writeFile(`${out}/invitation.json`, `${JSON.stringify(result.invitation, null, 2)}\n`);
    await writeFile(`${out}/receipt.json`, `${JSON.stringify(publicReceipt(result), null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(publicReceipt(result))}\n`);
  process.exit(result.ok ? 0 : 1);
}

process.stderr.write("command_required\n");
process.exit(2);
