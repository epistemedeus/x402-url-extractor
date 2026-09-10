import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ERROR_CODES,
  INPUT_SCHEMA,
  validateDeadlineCalendarInput,
  validateNotice,
  validateStatedDate,
} from "../src/index.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = (name) => JSON.parse(readFileSync(join(root, "fixtures", name), "utf8"));

test("validateDeadlineCalendarInput: positive fixture normalizes", () => {
  const n = validateDeadlineCalendarInput(load("positive.json"));
  assert.equal(n.schema, INPUT_SCHEMA);
  assert.equal(n.notices.length, 3);
  assert.equal(n.notices[0].statedDates.length, 4);
  assert.equal(n.notices[0].incomplete, false);
  assert.ok(n.notices[1].text.includes("15 May 2026"));
});

test("validateDeadlineCalendarInput: rejects forbidden invest/compliance/SEO fields", () => {
  assert.throws(
    () => validateDeadlineCalendarInput(load("negative-malformed.json")),
    (err) => err.code === ERROR_CODES.FORBIDDEN_CLAIM,
  );

  assert.throws(
    () =>
      validateDeadlineCalendarInput({
        calendarId: "x",
        notices: [
          {
            sourceId: "n",
            text: "Due March 1, 2026.",
            complianceScore: 100,
          },
        ],
      }),
    (err) => err.code === ERROR_CODES.FORBIDDEN_CLAIM && err.details?.field === "complianceScore",
  );

  assert.throws(
    () =>
      validateDeadlineCalendarInput({
        calendarId: "x",
        notices: [
          {
            sourceId: "n",
            text: "Due March 1, 2026.",
            legalCertification: "certified",
          },
        ],
      }),
    (err) =>
      err.code === ERROR_CODES.FORBIDDEN_CLAIM && err.details?.field === "legalCertification",
  );
});

test("validateNotice: incomplete when no text and no complete statedDates", () => {
  const incomplete = validateNotice({ sourceId: "empty", title: "No dates" }, 0);
  assert.equal(incomplete.incomplete, true);

  const withText = validateNotice(
    { sourceId: "t", text: "Due June 1, 2026." },
    0,
  );
  assert.equal(withText.incomplete, false);

  const withStated = validateNotice(
    { sourceId: "s", statedDates: [{ dateRaw: "2026-06-01" }] },
    0,
  );
  assert.equal(withStated.incomplete, false);
});

test("validateStatedDate: incomplete without dateRaw; qualifier alias", () => {
  const incomplete = validateStatedDate({ qualification: "estimated" }, 0);
  assert.equal(incomplete.incomplete, true);
  assert.equal(incomplete.dateRaw, null);

  const full = validateStatedDate(
    { dateRaw: "March 15, 2026", qualifier: "no later than", label: "due" },
    0,
  );
  assert.equal(full.incomplete, false);
  assert.equal(full.qualification, "no later than");
  assert.equal(full.label, "due");
});

test("validateDeadlineCalendarInput: requires notices[] and unique sourceId", () => {
  assert.throws(
    () => validateDeadlineCalendarInput({ calendarId: "x" }),
    (err) => err.code === ERROR_CODES.MISSING_REQUIREMENT,
  );

  assert.throws(
    () =>
      validateDeadlineCalendarInput({
        calendarId: "x",
        notices: [
          { sourceId: "dup", text: "Due March 1, 2026." },
          { sourceId: "dup", text: "Due April 1, 2026." },
        ],
      }),
    (err) => err.code === ERROR_CODES.INVALID_INPUT,
  );
});
