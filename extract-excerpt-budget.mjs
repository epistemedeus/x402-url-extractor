import {
  EXTRACT_BATCH_MAX_URLS,
  EXTRACT_BATCH_MAX_RESPONSE_BYTES,
} from "./extract-batch-config.mjs";

// Pure shared admission. No HTTP transport or wallet imports.
export const EXTRACT_TEXT_EXCERPT_CHARS = 1200;
export const READ_MARKDOWN_MAX_CHARS = 40_000;
// Same returned-text ceiling as /read. The source body is already capped at
// EXTRACT_MAX_BODY_BYTES, so a larger excerpt does not fetch again and does
// not promise rendered or full text. Omitted requests stay at the default.
export const EXTRACT_TEXT_EXCERPT_MAX_CHARS = READ_MARKDOWN_MAX_CHARS;

const EXCERPT_LIMIT_ERROR = `textExcerptLimitChars must be an integer from 1 through ${EXTRACT_TEXT_EXCERPT_MAX_CHARS}`;

/**
 * Admit an optional excerpt budget. Absent means the historical 1,200 default.
 * Rejects non-integers and out-of-range values before any fetch.
 */
export function parseTextExcerptLimit(value) {
  if (value === undefined) {
    return { ok: true, value: EXTRACT_TEXT_EXCERPT_CHARS, explicit: false };
  }
  if ((typeof value !== "number" && typeof value !== "string")
    || (typeof value === "number" && !Number.isInteger(value))) {
    return { ok: false, error: EXCERPT_LIMIT_ERROR };
  }
  const raw = typeof value === "number" ? String(value) : value.trim();
  if (!/^[1-9][0-9]*$/.test(raw)) return { ok: false, error: EXCERPT_LIMIT_ERROR };
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > EXTRACT_TEXT_EXCERPT_MAX_CHARS) {
    return { ok: false, error: EXCERPT_LIMIT_ERROR };
  }
  return { ok: true, value: parsed, explicit: true };
}


/**
 * Bound the excerpt share of the batch response ceiling before fetch.
 * JSON escapes a control character or lone surrogate into 6 ASCII bytes.
 * Reserve 48 KiB for the envelope and structured fields; their existing final
 * response check still applies. The default 1,200 fits five URLs.
 * Single-URL /extract may go up to EXTRACT_TEXT_EXCERPT_MAX_CHARS because
 * that route does not use this 128 KiB batch ceiling.
 */
export function maxAdmittedBatchExcerptChars(urlCount) {
  const count = Number(urlCount);
  if (!Number.isInteger(count) || count < 1 || count > EXTRACT_BATCH_MAX_URLS) {
    throw new RangeError(`urls must be an array of 1 to ${EXTRACT_BATCH_MAX_URLS} public HTTPS URLs`);
  }
  const reserve = 48 * 1024;
  const room = EXTRACT_BATCH_MAX_RESPONSE_BYTES - reserve;
  const perUrl = Math.floor(room / count / 6);
  const ceiling = Math.min(EXTRACT_TEXT_EXCERPT_MAX_CHARS, perUrl);
  if (ceiling < EXTRACT_TEXT_EXCERPT_CHARS) {
    throw new Error("batch response ceiling cannot admit the default excerpt");
  }
  return ceiling;
}
