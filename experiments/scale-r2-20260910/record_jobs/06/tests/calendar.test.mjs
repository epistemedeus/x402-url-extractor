import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  REPORT_STATUS,
  REUSE_FROM,
  SCHEMA,
  SCOPE_NOTE,
  buildDeadlineCalendar,
  extractDatesFromText,
  isAmbiguousDateRaw,
  tryParseExplicitDate,
} from "../src/index.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = (name) => JSON.parse(readFileSync(join(root, "fixtures", name), "utf8"));
const FIXED = () => Date.parse("2026-09-10T12:00:00.000Z");

test("positive: extracts explicit, qualified, and ambiguous dates with source links", () => {
  const cal = buildDeadlineCalendar(load("positive.json"), { clock: FIXED });
  assert.equal(cal.schema, SCHEMA);
  assert.equal(cal.status, REPORT_STATUS.READY);
  assert.equal(cal.generatedAt, "2026-09-10T12:00:00.000Z");
  assert.equal(cal.reuseFrom, REUSE_FROM);
  assert.equal(cal.scopeNote, SCOPE_NOTE);
  assert.match(cal.scopeNote, /only the supplied public notices/i);

  assert.ok(cal.entries.length >= 5);
  assert.ok(cal.summary.explicitCount >= 2);
  assert.ok(cal.summary.ambiguousCount >= 2);
  assert.ok(cal.summary.qualifiedCount >= 1);

  const byRaw = Object.fromEntries(
    cal.entries.filter((e) => e.dateRaw).map((e) => [e.dateRaw.toLowerCase(), e]),
  );

  // Explicit ISO / full dates
  const march = byRaw["march 15, 2026"];
  assert.ok(march);
  assert.equal(march.date, "2026-03-15");
  assert.equal(march.ambiguous, false);
  assert.equal(march.qualification, "no later than");
  assert.equal(march.sourceId, "notice-rfp-2026");
  assert.equal(march.sourceRef, "https://example.test/notices/rfp-2026");

  const july = byRaw["2026-07-01"];
  assert.ok(july);
  assert.equal(july.date, "2026-07-01");
  assert.equal(july.ambiguous, false);
  assert.equal(july.qualification, "tentatively");

  // Ambiguous retained — no invented ISO
  const q2 = byRaw["q2 2026"];
  assert.ok(q2);
  assert.equal(q2.date, null);
  assert.equal(q2.ambiguous, true);
  assert.equal(q2.qualification, "estimated");

  const midApril = byRaw["mid-april 2026"];
  assert.ok(midApril);
  assert.equal(midApril.date, null);
  assert.equal(midApril.ambiguous, true);

  // Text-only notice: May 15, December 2026 (ambiguous), TBD
  const may = cal.entries.find(
    (e) => e.sourceId === "notice-grant-2026" && e.date === "2026-05-15",
  );
  assert.ok(may);

  const dec = cal.entries.find(
    (e) =>
      e.sourceId === "notice-grant-2026" &&
      e.dateRaw &&
      /december\s+2026/i.test(e.dateRaw),
  );
  assert.ok(dec);
  assert.equal(dec.ambiguous, true);
  assert.equal(dec.date, null);

  const tbd = cal.entries.find(
    (e) => e.sourceId === "notice-grant-2026" && /tbd/i.test(e.dateRaw || ""),
  );
  assert.ok(tbd);
  assert.equal(tbd.ambiguous, true);
  assert.equal(tbd.date, null);

  // Forbidden fields absent
  assert.equal(Object.prototype.hasOwnProperty.call(cal, "seoRank"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(cal, "trafficProjection"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(cal, "investmentRecommendation"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(cal, "complianceScore"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(cal, "legalCertification"), false);
  assert.match(cal.dryRun, /never invent deadlines/i);
});

test("negative: forbidden fields yield rejected calendar", () => {
  const cal = buildDeadlineCalendar(load("negative-malformed.json"), { clock: FIXED });
  assert.equal(cal.status, REPORT_STATUS.REJECTED);
  assert.equal(cal.error.code, "forbidden_claim");
  assert.equal(cal.scopeNote, SCOPE_NOTE);
  assert.equal(cal.entries.length, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(cal, "complianceScore"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(cal, "seoRank"), false);
});

test("partial: incomplete notices yield partial_input", () => {
  const cal = buildDeadlineCalendar(load("partial-incomplete.json"), { clock: FIXED });
  assert.equal(cal.status, REPORT_STATUS.PARTIAL_INPUT);
  assert.ok(cal.partialReasons.includes("incomplete_notices"));
  // Complete notice still contributes an entry
  const june = cal.entries.find((e) => e.date === "2026-06-01");
  assert.ok(june);
  assert.equal(june.sourceId, "notice-complete");
});

test("ambiguous retention: never invents ISO for vague raw strings", () => {
  assert.equal(tryParseExplicitDate("Q2 2026"), null);
  assert.equal(isAmbiguousDateRaw("Q2 2026"), true);
  assert.equal(isAmbiguousDateRaw("mid-April 2026"), true);
  assert.equal(isAmbiguousDateRaw("December 2026"), true);
  assert.equal(isAmbiguousDateRaw("TBD"), true);
  assert.equal(tryParseExplicitDate("March 15, 2026"), "2026-03-15");
  assert.equal(isAmbiguousDateRaw("March 15, 2026"), false);
  assert.equal(tryParseExplicitDate("2026-04-30"), "2026-04-30");

  const cal = buildDeadlineCalendar(
    {
      calendarId: "ambig-only",
      notices: [
        {
          sourceId: "n1",
          text: "Decision expected Q3 2026. Hearing on or about mid-June.",
          statedDates: [
            { dateRaw: "Q3 2026", qualification: "expected", date: "2026-07-01" },
          ],
        },
      ],
    },
    { clock: FIXED },
  );
  assert.equal(cal.status, REPORT_STATUS.READY);
  for (const e of cal.entries) {
    if (/q3|mid-june/i.test(e.dateRaw || "")) {
      assert.equal(e.ambiguous, true);
      assert.equal(e.date, null, `must not invent ISO for ${e.dateRaw}`);
    }
  }
});

test("scopeNote always present and bounds the claim", () => {
  const cal = buildDeadlineCalendar(load("positive.json"), { clock: FIXED });
  assert.ok(cal.scopeNote.includes("supplied public notices"));
  assert.ok(!/all deadlines on the internet are complete/i.test(JSON.stringify(cal)));
  assert.ok(!/legal advice/i.test(JSON.stringify(cal)) || /nor legal advice/i.test(cal.scopeNote));
});

test("extractDatesFromText: finds ISO, long form, and ambiguous patterns", () => {
  const hits = extractDatesFromText(
    "Due 2026-03-15. Also March 20, 2026. Window Q1 2026. Status TBD.",
  );
  const raws = hits.map((h) => h.dateRaw.toLowerCase());
  assert.ok(raws.some((r) => r === "2026-03-15"));
  assert.ok(raws.some((r) => r.includes("march 20")));
  assert.ok(raws.some((r) => r.includes("q1 2026")));
  assert.ok(raws.some((r) => r === "tbd"));
  const ambig = hits.filter((h) => h.ambiguous);
  assert.ok(ambig.length >= 2);
});
