#!/usr/bin/env node
import { readFile } from "node:fs/promises";

import { consumeLaterArtifact } from "./later-consumer.mjs";

const blocked = ["COMMERCE_DATA_DIR", "COMMERCE_INTERNAL_TOKEN", "USEFUL_RESULT_GRANT", "SELLER_REPAIR_PRIVATE"];
if (blocked.some((name) => process.env[name])) {
  process.stderr.write("producer_state_present\n");
  process.exit(2);
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] || null;
}

const artifactPath = arg("--artifact");
const callerPath = arg("--caller");
if (!artifactPath || !callerPath) {
  process.stderr.write("artifact_and_caller_required\n");
  process.exit(2);
}
const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
const caller = JSON.parse(await readFile(callerPath, "utf8"));
const later = consumeLaterArtifact(artifact, caller);
process.stdout.write(`${JSON.stringify({ ...later, paymentSent: false, privateImported: false, recognizedRevenueAtomic: "0" })}\n`);
process.exit(later.refused ? 2 : 0);
