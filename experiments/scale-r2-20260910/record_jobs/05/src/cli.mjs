#!/usr/bin/env node
/**
 * Fresh-consumer CLI for R2-RECORD-JOBS-05 (public route regression report).
 *
 *   node src/cli.mjs report <input.json>
 *   node src/cli.mjs report -   # read JSON from stdin
 *   node src/cli.mjs demo
 *   node src/cli.mjs validate <input.json>
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRouteRegressionReport } from "./compare.mjs";
import { REPORT_STATUS } from "./constants.mjs";
import { validateRouteRegressionInput } from "./validate.mjs";

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
  node src/cli.mjs report <input.json|->
  node src/cli.mjs validate <input.json|->
  node src/cli.mjs demo`);
  process.exit(2);
}

const [cmd, a] = process.argv.slice(2);
if (!cmd) usage();

try {
  if (cmd === "report") {
    if (!a) usage();
    const report = buildRouteRegressionReport(loadJson(a));
    console.log(JSON.stringify(report, null, 2));
    if (report.status === REPORT_STATUS.REJECTED) process.exit(1);
  } else if (cmd === "validate") {
    if (!a) usage();
    const normalized = validateRouteRegressionInput(loadJson(a));
    console.log(JSON.stringify({ ok: true, normalized }, null, 2));
  } else if (cmd === "demo") {
    const fixtures = [
      "positive.json",
      "partial-incomplete.json",
      "negative-malformed.json",
    ];
    const results = {};
    for (const name of fixtures) {
      const raw = loadJson(join(root, "fixtures", name));
      const report = buildRouteRegressionReport(raw, {
        clock: () => Date.parse("2026-09-10T12:00:00.000Z"),
      });
      const deltaCounts = report.summary?.deltaCounts ?? null;
      results[name] = {
        status: report.status,
        routeCount: report.summary?.routeCount ?? 0,
        deltaCounts,
        error: report.error ?? null,
        scopeNotePresent: typeof report.scopeNote === "string",
        hasSeoRank: Object.prototype.hasOwnProperty.call(report, "seoRank"),
        hasTrafficProjection: Object.prototype.hasOwnProperty.call(
          report,
          "trafficProjection",
        ),
        hasInvestmentRecommendation: Object.prototype.hasOwnProperty.call(
          report,
          "investmentRecommendation",
        ),
        hasSiteHealthScore: Object.prototype.hasOwnProperty.call(
          report,
          "siteHealthScore",
        ),
      };
    }
    console.log(
      JSON.stringify(
        {
          schema: "x402.r2.record.route_regression_report.v1",
          demo: true,
          note: "Synthetic fixtures only; no live crawl; not a claim about the entire internet.",
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
