/** Shared ISO-8601 clock helpers. Operator clock is never invented. */

export const CLOCK_ISO =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoClock(value) {
  return typeof value === "string" && CLOCK_ISO.test(value);
}

export function isIsoDate(value) {
  return typeof value === "string" && DATE_ISO.test(value);
}
