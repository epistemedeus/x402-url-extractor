#!/usr/bin/env node
import { readFile } from "node:fs/promises";

import { startFixtureSeller } from "../src/fixture-seller.mjs";
import { taskDigest } from "../src/intake.mjs";
import { laterApplicability } from "../src/later.mjs";
import { normalizeIntake } from "../src/intake.mjs";
import { runJourney } from "../src/journey.mjs";

const blocked = ["COMMERCE_DATA_DIR", "COMMERCE_INTERNAL_TOKEN", "USEFUL_RESULT_GRANT", "SELLER_REPAIR_PRIVATE"];
if (blocked.some((name) => process.env[name])) {
  process.stderr.write("producer_state_present\n");
  process.exit(2);
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] || null;
}

const casePath = process.argv[2];
if (!casePath || casePath.startsWith("--")) {
  process.stderr.write("case_required\n");
  process.exit(2);
}
const raw = JSON.parse(await readFile(casePath, "utf8"));
const intake = normalizeIntake(raw);
const sdk = arg("--sdk") || intake.declaredSdk;
const task = arg("--task");
const digest = task ? taskDigest(task) : intake.taskDigest;
const origin = arg("--origin") || intake.origin;
const resource = arg("--resource") || intake.resource;
const method = arg("--method") || intake.method;
const callerId = arg("--caller") || intake.callerId;
const target = { origin, method, resource };
if (sdk !== intake.declaredSdk || digest !== intake.taskDigest || origin !== intake.origin || resource !== intake.resource || method !== intake.method) {
  const refused = laterApplicability({
    intake,
    taskDigest: digest,
    sdk,
    target,
    callerId,
    retest: null,
    independentRetest: false,
  });
  process.stdout.write(`${JSON.stringify({ ...refused, probed: false, paymentSent: false, privateImported: false, trustedPriorUseful: false })}\n`);
  process.exit(2);
}

const seller = await startFixtureSeller();
try {
  const result = await runJourney({
    intake: raw,
    baseUrl: seller.baseUrl,
    fixtureMode: "contradict",
    retestFixtureMode: "repaired",
  });
  const later = laterApplicability({
    intake,
    taskDigest: digest,
    sdk,
    target,
    callerId,
    retest: result.repair,
    independentRetest: true,
  });
  process.stdout.write(`${JSON.stringify({
    ...later,
    outcome: result.classification.outcome,
    repairReason: result.repair?.reason || null,
    paymentSent: false,
    privateImported: false,
    recognizedRevenueAtomic: "0",
  })}\n`);
} finally {
  await seller.close();
}
