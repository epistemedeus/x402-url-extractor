import { ERROR_CODES, FORBIDDEN_FIELDS, INPUT_SCHEMA } from "./constants.mjs";

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function reportError(code, message, details = undefined) {
  const err = new Error(message);
  err.code = code;
  if (details !== undefined) err.details = details;
  return err;
}

function requireNonEmptyString(value, label, { max = 2000 } = {}) {
  if (typeof value !== "string" || !value.trim()) {
    throw reportError(ERROR_CODES.INVALID_INPUT, `${label} must be a non-empty string`);
  }
  if (value.length > max) {
    throw reportError(ERROR_CODES.INVALID_INPUT, `${label} exceeds max length ${max}`);
  }
  return value.trim();
}

export function assertNoForbidden(record, label) {
  if (!isPlainObject(record)) return;
  for (const key of FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      throw reportError(
        ERROR_CODES.FORBIDDEN_CLAIM,
        `${label} declares forbidden field ${key}`,
        { field: key },
      );
    }
  }
  for (const [k, v] of Object.entries(record)) {
    if (isPlainObject(v)) assertNoForbidden(v, `${label}.${k}`);
    else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (isPlainObject(item)) assertNoForbidden(item, `${label}.${k}[${i}]`);
      });
    }
  }
}

/**
 * Validate one caller-supplied stated date mention (structured).
 * Incomplete when dateRaw is missing.
 */
export function validateStatedDate(raw, index = 0, noticeLabel = "notice") {
  const label = `${noticeLabel}.statedDates[${index}]`;
  if (!isPlainObject(raw)) {
    throw reportError(ERROR_CODES.INVALID_INPUT, `${label} must be an object`);
  }
  assertNoForbidden(raw, label);

  const dateRaw =
    raw.dateRaw == null
      ? null
      : requireNonEmptyString(String(raw.dateRaw), `${label}.dateRaw`, { max: 240 });

  const qualification =
    raw.qualification == null && raw.qualifier == null
      ? null
      : requireNonEmptyString(
          String(raw.qualification ?? raw.qualifier),
          `${label}.qualification`,
          { max: 240 },
        );

  const labelText =
    raw.label == null
      ? null
      : requireNonEmptyString(String(raw.label), `${label}.label`, { max: 240 });

  // Optional caller-supplied ISO (only accepted if present as string; calendar
  // still re-validates and may mark ambiguous when parse fails).
  const dateHint =
    raw.date == null
      ? null
      : requireNonEmptyString(String(raw.date), `${label}.date`, { max: 64 });

  const ambiguousHint =
    raw.ambiguous === true ? true : raw.ambiguous === false ? false : null;

  const incomplete = dateRaw == null;

  return {
    dateRaw,
    qualification,
    label: labelText,
    dateHint,
    ambiguousHint,
    incomplete,
  };
}

/**
 * Validate one public notice.
 * Incomplete when neither usable text nor any complete statedDates exist.
 */
export function validateNotice(raw, index = 0) {
  const label = `notices[${index}]`;
  if (!isPlainObject(raw)) {
    throw reportError(ERROR_CODES.INVALID_INPUT, `${label} must be an object`);
  }
  assertNoForbidden(raw, label);

  const sourceId = requireNonEmptyString(
    String(raw.sourceId ?? raw.id ?? `notice-${index + 1}`),
    `${label}.sourceId`,
    { max: 128 },
  );

  const sourceRef =
    raw.sourceRef == null && raw.url == null
      ? null
      : requireNonEmptyString(String(raw.sourceRef ?? raw.url), `${label}.sourceRef`, {
          max: 4000,
        });

  const title =
    raw.title == null
      ? null
      : requireNonEmptyString(String(raw.title), `${label}.title`, { max: 500 });

  const text =
    raw.text == null && raw.body == null
      ? null
      : requireNonEmptyString(String(raw.text ?? raw.body), `${label}.text`, {
          max: 100_000,
        });

  const jurisdiction =
    raw.jurisdiction == null
      ? null
      : requireNonEmptyString(String(raw.jurisdiction), `${label}.jurisdiction`, {
          max: 240,
        });

  const publishedAt =
    raw.publishedAt == null
      ? null
      : requireNonEmptyString(String(raw.publishedAt), `${label}.publishedAt`, {
          max: 64,
        });

  let statedDates = [];
  if (raw.statedDates != null) {
    if (!Array.isArray(raw.statedDates)) {
      throw reportError(ERROR_CODES.INVALID_INPUT, `${label}.statedDates must be an array`);
    }
    statedDates = raw.statedDates.map((d, i) => validateStatedDate(d, i, label));
  }

  const hasText = text != null && text.length > 0;
  const completeStated = statedDates.filter((d) => !d.incomplete);
  const incomplete =
    !hasText && completeStated.length === 0;

  return {
    sourceId,
    sourceRef,
    title,
    text,
    jurisdiction,
    publishedAt,
    statedDates,
    incomplete,
  };
}

/**
 * Validate full deadline-calendar input (notices[]).
 */
export function validateDeadlineCalendarInput(raw) {
  if (!isPlainObject(raw)) {
    throw reportError(ERROR_CODES.INVALID_INPUT, "deadline calendar input must be an object");
  }
  assertNoForbidden(raw, "input");

  if (raw.schema != null && raw.schema !== INPUT_SCHEMA) {
    throw reportError(
      ERROR_CODES.INVALID_INPUT,
      `input.schema must be ${INPUT_SCHEMA} when present`,
    );
  }

  if (!Array.isArray(raw.notices)) {
    throw reportError(ERROR_CODES.MISSING_REQUIREMENT, "notices[] is required");
  }
  if (raw.notices.length < 1) {
    throw reportError(
      ERROR_CODES.MISSING_REQUIREMENT,
      "notices[] needs at least one notice",
    );
  }

  const notices = raw.notices.map((n, i) => validateNotice(n, i));

  // Duplicate sourceId is invalid (ambiguous source link).
  const seen = new Map();
  for (const n of notices) {
    if (seen.has(n.sourceId)) {
      throw reportError(
        ERROR_CODES.INVALID_INPUT,
        `notices duplicate sourceId ${n.sourceId}`,
        { sourceId: n.sourceId },
      );
    }
    seen.set(n.sourceId, true);
  }

  const calendarId = requireNonEmptyString(
    raw.calendarId ?? raw.reportId ?? raw.id ?? "unnamed-calendar",
    "calendarId",
    { max: 128 },
  );

  return {
    schema: INPUT_SCHEMA,
    calendarId,
    title:
      raw.title == null
        ? null
        : requireNonEmptyString(String(raw.title), "title", { max: 240 }),
    notices,
    demo: raw.demo === true,
    sourceLabel:
      raw.sourceLabel == null
        ? null
        : requireNonEmptyString(String(raw.sourceLabel), "sourceLabel", { max: 240 }),
  };
}
