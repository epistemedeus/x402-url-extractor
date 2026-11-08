// Structured content for compare_page_observations.
// The SDK advertises this Zod object as JSON Schema on tools/list, using the
// same conversion as the paid extract outputSchema (PR 26). isError tool
// results omit structuredContent, so they stay outside this contract.

import { z } from "zod";
import { merchantInteger } from "./merchant-zod4-values.mjs";
import { legacyMcpJsonSchema } from "./mcp-zod4-wire.mjs";
import { PAGE_CHANGE_HTTP_PRODUCT, PAGE_CHANGE_HTTP_SCHEMA } from "./page-change-http.mjs";
import {
  ALL_FIELDS,
  ROW_STATUSES,
  SCHEMA as PAGE_CHANGE_BRIEF_SCHEMA,
} from "./examples/customer-x402/src/page-change/constants.mjs";
import { SCHEMA as CHANGE_DIGEST_SCHEMA } from "./examples/customer-x402/src/page-change/vendor/change-digest/limits.mjs";
import {
  c1Provenance,
  c2Provenance,
  merchantProvenance,
} from "./examples/customer-x402/src/page-change/provenance.mjs";

const OBSERVATION_NOTE = "Source URL identity is separate from two-time observation identity. fetchedAt and completedAt are observation metadata, not content freshness.";
const FIELD_NAMES = [...ALL_FIELDS];
const ROW_STATUS_NAMES = [...ROW_STATUSES];
const LIMIT_HITS = ["maxBytes", "maxJsonNodes", "maxJsonDepth", "maxChanges", "maxSequenceLength"];
const SNAPSHOT_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const HEX_64 = /^[a-f0-9]{64}$/;

const c1 = c1Provenance();
const c2 = c2Provenance();
const merchant = merchantProvenance();

function closed(shape) {
  return z.object(shape).strict();
}

const sha256OrNull = z.string().regex(HEX_64).nullable();

function snapshotSide(role) {
  return closed({
    status: z.enum(["present", "missing", "invalid"]),
    mediaType: z.literal("application/json").nullable(),
    observedAt: z.string().regex(SNAPSHOT_TIME).nullable(),
    truncated: z.boolean(),
    byteLength: merchantInteger().nonnegative(),
    sha256: sha256OrNull,
    source: closed({
      kind: z.literal("supplied"),
      path: z.null(),
      role: z.literal(role),
    }),
    issues: z.array(z.string().min(1)),
  });
}

const semanticChange = closed({
  class: z.literal("semantic"),
  op: z.enum(["add", "remove", "replace"]),
  path: z.string(),
  sourceKey: z.string().min(1),
  before: z.string().optional(),
  after: z.string().optional(),
  beforeEvidence: z.string().optional(),
  afterEvidence: z.string().optional(),
  evidenceTruncated: z.boolean(),
});

const fieldOrderChange = closed({
  class: z.literal("order"),
  op: z.literal("reorder"),
  path: z.string(),
  sourceKey: z.string().min(1),
  before: z.string(),
  after: z.string(),
  beforeEvidence: z.string(),
  afterEvidence: z.string(),
  evidenceTruncated: z.boolean(),
});

const sourceOrderChange = closed({
  class: z.literal("order"),
  op: z.literal("reorder"),
  path: z.literal("/sources"),
  sourceKey: z.null(),
  before: z.array(z.string().min(1)),
  after: z.array(z.string().min(1)),
  beforeEvidence: z.string(),
  afterEvidence: z.string(),
});

const fieldCoverage = closed({
  sourceKey: z.string().min(1),
  field: z.enum(FIELD_NAMES),
  beforePresent: z.boolean(),
  afterPresent: z.boolean(),
  reason: z.literal("absent_field_is_coverage_unknown_not_deletion"),
});

const issueCoverage = closed({
  side: z.enum(["before", "after"]),
  code: z.string().min(1),
});

const diffCoverage = closed({
  sourceKey: z.string().min(1),
  field: z.null(),
  reason: z.string().min(1),
});

const rowIdentity = closed({
  id: z.string().nullable(),
  status: z.enum(ROW_STATUS_NAMES),
});

const rowOutcome = closed({
  id: z.string().nullable(),
  status: z.enum(ROW_STATUS_NAMES),
  error: z.unknown().optional(),
});

const observationRow = closed({
  sourceKey: z.string(),
  itemId: z.string().nullable(),
  requestedAt: z.unknown().optional(),
  completedAt: z.unknown().optional(),
  fetchedAt: z.unknown().optional(),
  requestedAtIsNotFreshness: z.literal(true),
  fetchedAtIsNotFreshness: z.literal(true),
});

const observationSide = closed({
  jobId: z.unknown().optional(),
  jobStatus: z.unknown().optional(),
  charged: z.unknown().optional(),
  ok: z.unknown().optional(),
  snapshotObservedAt: z.string().regex(SNAPSHOT_TIME).nullable(),
  artifactObservedAt: z.string().nullable(),
  rows: z.array(observationRow),
});

const reportSchema = closed({
  schema: z.literal(PAGE_CHANGE_BRIEF_SCHEMA),
  kind: z.enum(["merchant_extract_batch", "c1_batch_result", "unknown"]).nullable(),
  verdict: z.enum(["changed", "unchanged", "reordered", "incomplete", "ambiguous", "incomparable"]),
  fields: z.array(z.enum(FIELD_NAMES)).min(1),
  claims: closed({
    noChangeProven: z.boolean(),
    contentUnchangedProven: z.boolean(),
    comparable: z.boolean(),
    complete: z.boolean(),
    current: z.literal(false),
    fresh: z.literal(false),
    usefulOutputProven: z.boolean(),
    paymentImpliesUsefulOutput: z.literal(false),
  }),
  freshness: z.enum(["unknown", "inverted"]),
  snapshot: closed({
    schema: z.literal(CHANGE_DIGEST_SCHEMA),
    verdict: z.enum(["changed", "unchanged", "reordered", "incomplete", "incomparable"]),
    claims: closed({
      noChangeProven: z.boolean(),
      current: z.literal(false),
      comparable: z.boolean(),
      fresh: z.literal(false),
    }),
    freshness: z.enum(["unknown", "inverted"]),
    before: snapshotSide("before"),
    after: snapshotSide("after"),
    limitsHit: z.array(z.enum(LIMIT_HITS)),
  }),
  summary: closed({
    matched: merchantInteger().nonnegative(),
    missing: merchantInteger().nonnegative(),
    failed: merchantInteger().nonnegative(),
    unknown: merchantInteger().nonnegative(),
    duplicates: merchantInteger().nonnegative(),
    coverageUnknown: merchantInteger().nonnegative(),
    semantic: merchantInteger().nonnegative(),
    order: merchantInteger().nonnegative(),
  }),
  rows: closed({
    matched: z.array(closed({
      sourceKey: z.string().min(1),
      source: z.string(),
      before: rowIdentity,
      after: rowIdentity,
    })),
    missing: z.array(closed({
      sourceKey: z.string().min(1),
      missingSide: z.enum(["before", "after"]),
      status: z.enum(ROW_STATUS_NAMES),
      source: z.string(),
      id: z.string().nullable(),
    })),
    failed: z.array(closed({
      sourceKey: z.string().min(1),
      before: rowOutcome,
      after: rowOutcome,
    })),
    unknown: z.array(closed({
      sourceKey: z.string().min(1),
      before: rowOutcome,
      after: rowOutcome,
    })),
    duplicates: z.array(closed({
      sourceKey: z.string().min(1),
      beforeIds: z.array(z.string().nullable()),
      afterIds: z.array(z.string().nullable()),
      reason: z.literal("duplicate_source_identity"),
    })),
  }),
  coverageUnknown: z.array(z.union([fieldCoverage, issueCoverage, diffCoverage])),
  changes: z.array(z.union([semanticChange, fieldOrderChange, sourceOrderChange])),
  observations: closed({
    before: observationSide.nullable(),
    after: observationSide.nullable(),
    note: z.literal(OBSERVATION_NOTE),
  }),
  provenance: closed({
    c1: closed({
      commit: z.literal(c1.commit),
      module: z.literal(c1.module),
      license: z.literal(c1.license),
      acceptance: z.literal(c1.acceptance),
    }),
    c2: closed({
      commit: z.literal(c2.commit),
      merge: z.literal(c2.merge),
      pullRequest: z.literal(c2.pullRequest),
      source: z.literal(c2.source),
      license: z.literal(c2.license),
      acceptance: z.literal(c2.acceptance),
    }),
    merchant: closed({
      commit: z.literal(merchant.commit),
      files: z.tuple([z.literal(merchant.files[0]), z.literal(merchant.files[1])]),
      acceptance: z.literal(merchant.acceptance),
    }),
    comparedWithClock: z.null(),
    beforeSha256: sha256OrNull,
    afterSha256: sha256OrNull,
    elapsedMs: z.number().nonnegative(),
    digestSha256: z.string().regex(HEX_64),
  }),
});

export const pageChangeMcpOutputSchema = closed({
  ok: z.literal(true),
  product: z.literal(PAGE_CHANGE_HTTP_PRODUCT),
  schemaVersion: z.literal(PAGE_CHANGE_HTTP_SCHEMA),
  charged: z.literal(false),
  report: reportSchema,
});

export function pageChangeMcpOutputJsonSchema() {
  return legacyMcpJsonSchema(pageChangeMcpOutputSchema, "output");
}
