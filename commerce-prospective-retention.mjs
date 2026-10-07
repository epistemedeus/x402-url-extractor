// Prospective tail for the existing commerce attempt journal.
// One current file plus numbered rotations stay inside the single-process
// writer. This is not a second collector. Outcome, rare-funnel, paid-evidence,
// and settlement files keep their own bounds.

export const COMMERCE_PROSPECTIVE_TAIL_SCHEMA = "samedaydesk.commerce-prospective-retention.v1";
// Observed 2026-10-07 rotated generation: 6,189 parseable rows reached the
// 5 MiB rotation. A complete one-day cut the same evening held 12,439 rows.
// A cold producer replay of that count of canonical discovery rows occupied
// 10,436,321 bytes and one rotation, still inside two segments. The two-file
// tail loses the day when a later rotation unlinks the generation that held
// the window start; the 22:30 cut kept 6,791 rows and was correctly unknown.
// Four segments leave three full segments (15 MiB) after a rotation, about
// 5 MiB over that measured day. It does not cover an unbounded spike.
export const COMMERCE_PROSPECTIVE_SEGMENT_COUNT = 4;
export const COMMERCE_PROSPECTIVE_SEGMENT_LIMIT = 16;
export const COMMERCE_PROSPECTIVE_MAX_AGE_MS = 48 * 60 * 60 * 1000;
// Matches the authenticated cut reader's per-file slack (5 MiB + 8 KiB).
export const COMMERCE_SEGMENT_READ_SLACK_BYTES = 8192;
const MAX_AGE_MS = 366 * 24 * 60 * 60 * 1000;

export function attemptSegmentName(index) {
  if (index === 0) return "commerce-events.ndjson";
  if (!Number.isSafeInteger(index) || index < 1 || index > COMMERCE_PROSPECTIVE_SEGMENT_LIMIT) {
    throw new Error("unsafe commerce journal segment");
  }
  return `commerce-events.${index}.ndjson`;
}

export function resolveProspectiveRetention({
  maxBytes,
  retentionSegments,
  aggregateMaxBytes,
  maxAgeMs,
} = {}) {
  const segmentMaxBytes = Number.isSafeInteger(maxBytes) && maxBytes > 0
    ? maxBytes
    : 5 * 1024 * 1024;
  const segmentCount = retentionSegments === undefined
    ? COMMERCE_PROSPECTIVE_SEGMENT_COUNT
    : retentionSegments;
  if (
    !Number.isSafeInteger(segmentCount)
    || segmentCount < 2
    || segmentCount > COMMERCE_PROSPECTIVE_SEGMENT_LIMIT
  ) {
    throw new Error("commerce prospective retention segment count must be an integer from 2 to 16");
  }
  const age = maxAgeMs === undefined ? COMMERCE_PROSPECTIVE_MAX_AGE_MS : maxAgeMs;
  if (!Number.isSafeInteger(age) || age < 1 || age > MAX_AGE_MS) {
    throw new Error("commerce prospective retention age must be a positive safe integer millisecond bound");
  }
  const naturalAggregate = segmentCount * segmentMaxBytes;
  if (!Number.isSafeInteger(naturalAggregate) || !Number.isSafeInteger(segmentMaxBytes + COMMERCE_SEGMENT_READ_SLACK_BYTES)) {
    throw new Error("commerce prospective retention aggregate exceeds a safe integer");
  }
  let aggregate = naturalAggregate;
  if (aggregateMaxBytes !== undefined && aggregateMaxBytes !== null) {
    if (!Number.isSafeInteger(aggregateMaxBytes) || aggregateMaxBytes < segmentMaxBytes * 2) {
      throw new Error("commerce prospective retention aggregate must cover the current and rotated segments");
    }
    aggregate = Math.min(aggregateMaxBytes, naturalAggregate);
  }
  const admitted = Math.min(segmentCount, Math.floor(aggregate / segmentMaxBytes));
  return Object.freeze({
    segmentCount: admitted,
    segmentMaxBytes,
    aggregateMaxBytes: admitted * segmentMaxBytes,
    maxAgeMs: age,
    readCapBytes: segmentMaxBytes + COMMERCE_SEGMENT_READ_SLACK_BYTES,
  });
}

export function prospectiveTailReport({
  retention,
  occupiedSegments = 0,
  retainedBytes = 0,
  gap = false,
  capacityWithheld = false,
  unsafeSegment = false,
} = {}) {
  return Object.freeze({
    schemaVersion: COMMERCE_PROSPECTIVE_TAIL_SCHEMA,
    segmentCount: retention.segmentCount,
    segmentMaxBytes: retention.segmentMaxBytes,
    aggregateMaxBytes: retention.aggregateMaxBytes,
    maxAgeMs: retention.maxAgeMs,
    readCapBytes: retention.readCapBytes,
    occupiedSegments,
    retainedBytes,
    gap: gap === true,
    capacityWithheld: capacityWithheld === true,
    unsafeSegment: unsafeSegment === true,
    windowReachIsNotUptime: true,
    windowReachIsNotUniqueCustomers: true,
    windowReachIsNotConversionDenominator: true,
    discardedHistoryStaysLost: true,
    historicalBackfill: false,
  });
}
