import {
  ERROR_CODES,
  FORBIDDEN_FIELDS,
  FEED_SCHEMA,
} from "./constants.mjs";

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function feedError(code, message, details = undefined) {
  const err = new Error(message);
  err.code = code;
  if (details !== undefined) err.details = details;
  return err;
}

export function assertNoForbidden(record, label = "input") {
  if (!isPlainObject(record)) return;
  for (const key of FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      throw feedError(
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
 * Validate a built feed document shape (consumer-side check).
 */
export function validateDistRepairFeed(feed) {
  if (!isPlainObject(feed)) {
    throw feedError(ERROR_CODES.INVALID_INPUT, "feed must be an object");
  }
  assertNoForbidden(feed, "feed");
  if (feed.schema !== FEED_SCHEMA) {
    throw feedError(
      ERROR_CODES.INVALID_INPUT,
      `feed.schema must be ${FEED_SCHEMA}`,
      { got: feed.schema },
    );
  }
  if (!Array.isArray(feed.repairRecommendations)) {
    throw feedError(
      ERROR_CODES.MISSING_REQUIREMENT,
      "feed.repairRecommendations[] is required",
    );
  }
  if (!Array.isArray(feed.usableBy) || feed.usableBy.length < 1) {
    throw feedError(
      ERROR_CODES.MISSING_REQUIREMENT,
      "feed.usableBy[] is required",
    );
  }
  if (!isPlainObject(feed.pins)) {
    throw feedError(ERROR_CODES.MISSING_REQUIREMENT, "feed.pins is required");
  }
  for (const [i, rec] of feed.repairRecommendations.entries()) {
    if (!isPlainObject(rec)) {
      throw feedError(
        ERROR_CODES.INVALID_INPUT,
        `repairRecommendations[${i}] must be an object`,
      );
    }
    for (const req of ["routeKey", "delta", "recommendation", "confidence", "coveragePreserved"]) {
      if (!(req in rec)) {
        throw feedError(
          ERROR_CODES.MISSING_REQUIREMENT,
          `repairRecommendations[${i}].${req} is required`,
        );
      }
    }
  }
  return feed;
}
