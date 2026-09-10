#!/usr/bin/env node
/**
 * Fresh-consumer CLI for R2-RECORD-JOBS-07 (dependency footprint overlap).
 *
 *   node src/cli.mjs report <input.json>
 *   node src/cli.mjs overlap <input.json>   # alias of report
 *   node src/cli.mjs report -               # read JSON from stdin
 *   node src/cli.mjs demo
 *   node src/cli.mjs validate <input.json>
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { REPORT_STATUS, SCHEMA } from "./constants.mjs";
import { buildDependencyFootprintOverlap } from "./overlap.mjs";
import { validateDependencyFootprintInput } from "./validate.mjs";

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
  node src/cli.mjs overlap <input.json|->
  node src/cli.mjs validate <input.json|->
  node src/cli.mjs demo`);
  process.exit(2);
}

const [cmd, a] = process.argv.slice(2);
if (!cmd) usage();

try {
  if (cmd === "report" || cmd === "overlap") {
    if (!a) usage();
    const report = buildDependencyFootprintOverlap(loadJson(a));
    console.log(JSON.stringify(report, null, 2));
    if (report.status === REPORT_STATUS.REJECTED) process.exit(1);
  } else if (cmd === "validate") {
    if (!a) usage();
    const normalized = validateDependencyFootprintInput(loadJson(a));
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
      const report = buildDependencyFootprintOverlap(raw, {
        clock: () => Date.parse("2026-09-10T12:00:00.000Z"),
      });
      results[name] = {
        status: report.status,
        duplicateRuntimeCount: report.summary?.duplicateRuntimeCount ?? 0,
        unknownLicenseCount: report.summary?.unknownLicenseCount ?? 0,
        separateFrom: report.separateFrom ?? null,
        error: report.error ?? null,
        scopeNotePresent: typeof report.scopeNote === "string",
        hasCveScore: Object.prototype.hasOwnProperty.call(report, "cveScore"),
        hasSecurityCertification: Object.prototype.hasOwnProperty.call(
          report,
          "securityCertification",
        ),
        hasLegalAdvice: Object.prototype.hasOwnProperty.call(report, "legalAdvice"),
        hasComplianceScore: Object.prototype.hasOwnProperty.call(
          report,
          "complianceScore",
        ),
        hasInvestAdvice: Object.prototype.hasOwnProperty.call(report, "investAdvice"),
        hasSeoRank: Object.prototype.hasOwnProperty.call(report, "seoRank"),
        hasTrafficProjection: Object.prototype.hasOwnProperty.call(
          report,
          "trafficProjection",
        ),
        hasS127ApiImpact: Object.prototype.hasOwnProperty.call(report, "s127ApiImpact"),
      };
    }
    console.log(
      JSON.stringify(
        {
          schema: SCHEMA,
          demo: true,
          note: "Synthetic fixtures only; supplied lockfiles only; not security/legal certification; separateFrom S127.",
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
