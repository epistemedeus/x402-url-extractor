#!/usr/bin/env node
import { readFile } from "node:fs/promises";

import { compareArms } from "../src/compare.mjs";
import { startFixtureSeller } from "../src/fixture-seller.mjs";
import { normalizeIntake } from "../src/intake.mjs";
import { runJourney } from "../src/journey.mjs";
import { rejectSeeded } from "../src/seed.mjs";

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] || null;
}

const command = process.argv[2];
const casePath = arg("--case");

if (command === "reject-seeded") {
  const file = process.argv[3];
  const claim = JSON.parse(await readFile(file, "utf8"));
  const result = rejectSeeded(claim);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(result.refused ? 2 : 1);
}

if (!casePath) {
  process.stderr.write("case_required\n");
  process.exit(1);
}
const raw = JSON.parse(await readFile(casePath, "utf8"));
const seller = await startFixtureSeller();
try {
  if (command === "reproduce") {
    const result = await runJourney({
      intake: raw,
      baseUrl: seller.baseUrl,
      fixtureMode: "contradict",
      retestFixtureMode: "repaired",
      authorizeContribution: arg("--authorize") === "1",
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exit(result.repair?.useful === true ? 0 : 1);
  }
  if (command === "retest") {
    const mode = arg("--mode") || "repaired";
    const result = await runJourney({
      intake: raw,
      baseUrl: seller.baseUrl,
      fixtureMode: "contradict",
      retestFixtureMode: mode,
    });
    process.stdout.write(`${JSON.stringify({ useful: result.repair?.useful === true, reason: result.repair?.reason || result.classification.reason })}\n`);
    process.exit(0);
  }
  if (command === "compare") {
    const intake = normalizeIntake(raw);
    const result = await compareArms({
      raw,
      intake,
      baseUrl: seller.baseUrl,
      fixtureMode: "contradict",
      retestFixtureMode: "repaired",
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exit(result.repairUseful === true ? 0 : 1);
  }
  process.stderr.write("unknown_command\n");
  process.exit(1);
} finally {
  await seller.close();
}
