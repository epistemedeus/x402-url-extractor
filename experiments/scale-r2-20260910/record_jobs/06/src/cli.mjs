#!/usr/bin/env node
/**
 * Fresh-consumer CLI for R2-RECORD-JOBS-06 (deadline evidence calendar).
 *
 *   node src/cli.mjs calendar <input.json>
 *   node src/cli.mjs calendar -   # read JSON from stdin
 *   node src/cli.mjs report <input.json>   # alias of calendar
 *   node src/cli.mjs demo
 *   node src/cli.mjs validate <input.json>
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDeadlineCalendar } from "./calendar.mjs";
import { REPORT_STATUS, SCHEMA } from "./constants.mjs";
import { validateDeadlineCalendarInput } from "./validate.mjs";

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
  node src/cli.mjs calendar <input.json|->
  node src/cli.mjs report <input.json|->
  node src/cli.mjs validate <input.json|->
  node src/cli.mjs demo`);
  process.exit(2);
}

const [cmd, a] = process.argv.slice(2);
if (!cmd) usage();

try {
  if (cmd === "calendar" || cmd === "report") {
    if (!a) usage();
    const calendar = buildDeadlineCalendar(loadJson(a));
    console.log(JSON.stringify(calendar, null, 2));
    if (calendar.status === REPORT_STATUS.REJECTED) process.exit(1);
  } else if (cmd === "validate") {
    if (!a) usage();
    const normalized = validateDeadlineCalendarInput(loadJson(a));
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
      const calendar = buildDeadlineCalendar(raw, {
        clock: () => Date.parse("2026-09-10T12:00:00.000Z"),
      });
      const summary = calendar.summary ?? null;
      results[name] = {
        status: calendar.status,
        entryCount: summary?.entryCount ?? 0,
        explicitCount: summary?.explicitCount ?? 0,
        ambiguousCount: summary?.ambiguousCount ?? 0,
        qualifiedCount: summary?.qualifiedCount ?? 0,
        error: calendar.error ?? null,
        scopeNotePresent: typeof calendar.scopeNote === "string",
        hasSeoRank: Object.prototype.hasOwnProperty.call(calendar, "seoRank"),
        hasTrafficProjection: Object.prototype.hasOwnProperty.call(
          calendar,
          "trafficProjection",
        ),
        hasInvestmentRecommendation: Object.prototype.hasOwnProperty.call(
          calendar,
          "investmentRecommendation",
        ),
        hasComplianceScore: Object.prototype.hasOwnProperty.call(
          calendar,
          "complianceScore",
        ),
        hasLegalCertification: Object.prototype.hasOwnProperty.call(
          calendar,
          "legalCertification",
        ),
        ambiguousRetained:
          (calendar.entries || []).filter((e) => e.ambiguous === true).length > 0 ||
          calendar.status === REPORT_STATUS.REJECTED ||
          (summary?.ambiguousCount ?? 0) > 0,
      };
    }
    console.log(
      JSON.stringify(
        {
          schema: SCHEMA,
          demo: true,
          note: "Synthetic fixtures only; no live crawl; calendar covers only supplied notices; ambiguous dates retained.",
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
