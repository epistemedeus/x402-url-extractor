#!/usr/bin/env node
/**
 * Fresh-consumer CLI for R2-CONSUMER-JOBS-07 (evidence-based procurement brief).
 *
 *   node src/cli.mjs brief <input.json>
 *   node src/cli.mjs brief -   # read JSON from stdin
 *   node src/cli.mjs demo
 *   node src/cli.mjs validate <input.json>
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildProcurementBrief } from "./compare.mjs";
import { BRIEF_STATUS } from "./constants.mjs";
import { validateProcurementInput } from "./validate.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function loadJson(path) {
  if (path === "-" || path === "/dev/stdin") {
    return JSON.parse(readFileSync(0, "utf8"));
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function usage() {
  console.error(`Usage:
  node src/cli.mjs brief <input.json|->
  node src/cli.mjs validate <input.json|->
  node src/cli.mjs demo`);
  process.exit(2);
}

const [cmd, a] = process.argv.slice(2);
if (!cmd) usage();

try {
  if (cmd === "brief") {
    if (!a) usage();
    const brief = buildProcurementBrief(loadJson(a));
    console.log(JSON.stringify(brief, null, 2));
    if (brief.status === BRIEF_STATUS.REJECTED) process.exit(1);
  } else if (cmd === "validate") {
    if (!a) usage();
    const normalized = validateProcurementInput(loadJson(a));
    console.log(JSON.stringify({ ok: true, normalized }, null, 2));
  } else if (cmd === "demo") {
    const fixtures = [
      "positive.json",
      "partial-missing-price.json",
      "partial-unavailable-free.json",
      "external-cost.json",
      "negative-malformed.json",
    ];
    const results = {};
    for (const name of fixtures) {
      const raw = loadJson(join(root, "fixtures", name));
      const brief = buildProcurementBrief(raw, {
        clock: () => Date.parse("2026-09-10T12:00:00.000Z"),
      });
      results[name] = {
        status: brief.status,
        contractCount: brief.comparisons?.length ?? 0,
        priceStates: (brief.comparisons || []).map((c) => c.priceState),
        freeStates: (brief.comparisons || []).map((c) => c.freeBaseline?.freeAlternativeState),
        error: brief.error ?? null,
        hasInvestmentRecommendation: Object.prototype.hasOwnProperty.call(
          brief,
          "investmentRecommendation",
        ),
      };
    }
    console.log(
      JSON.stringify(
        {
          schema: "x402.r2.consumer.procurement_brief.v1",
          demo: true,
          note: "Synthetic fixtures only; no live paid calls.",
          results,
        },
        null,
        2,
      ),
    );
  } else {
    usage();
  }
} catch (err) {
  console.error(
    JSON.stringify({
      error: err.code || "error",
      message: err.message,
      details: err.details || null,
    }),
  );
  process.exit(1);
}
