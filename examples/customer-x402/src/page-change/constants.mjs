import { BATCH_SUPPORTED_FIELDS } from "../batch-admission.mjs";
import {
  EXTRACT_BATCH_SOURCE_REQUIRED_KEYS,
  EXTRACT_BATCH_SOURCE_STATUSES,
  EXTRACT_BATCH_TOP_FIELDS,
} from "../batch-output.mjs";
import {
  LIVE_BATCH_PRODUCT,
  LIVE_BATCH_SCHEMA_VERSION,
} from "../constants.mjs";

export const SCHEMA = "pilot/page-change-brief/v1";
export const ALL_FIELDS = BATCH_SUPPORTED_FIELDS;
export const MERCHANT_PRODUCT = LIVE_BATCH_PRODUCT;
export const MERCHANT_SCHEMA_VERSION = LIVE_BATCH_SCHEMA_VERSION;
export const MERCHANT_REQUIRED_KEYS = EXTRACT_BATCH_TOP_FIELDS;
export const MERCHANT_SOURCE_REQUIRED_KEYS = EXTRACT_BATCH_SOURCE_REQUIRED_KEYS;
export const ROW_STATUSES = EXTRACT_BATCH_SOURCE_STATUSES;

export const C2_COMMIT = "f4c6cff982f662ccfe65171b2ebb03b74cf4a986";
export const C2_MERGE = "670ce6e926dc5543d29c5a8afb2c9025846b46d6";
export const C2_PULL_REQUEST = 28;

export const C1_IDENTITY_MODULE = "extract-batch-c1/url-guard.mjs";
export const C1_COMMIT = "c247d0381ea41ab0975a666b53fc75c09db8a071";

export const MERCHANT_COMMIT = "d7ceb857de7c25a0113e5b6914ff73a1c8afd760";
export const MERCHANT_FILES = Object.freeze(["extract-batch.mjs", "extract-batch-config.mjs"]);

export const COMPARABLE_STATUSES = Object.freeze(["success", "partial"]);

export const C1_REQUIRED_KEYS = Object.freeze([
  "jobId",
  "status",
  "costParameters",
  "accounting",
  "items",
]);

export const DEFAULT_LIMITS = Object.freeze({
  maxBytes: 131_072,
  maxJsonDepth: 16,
  maxJsonNodes: 4_096,
  maxHtmlTokens: 2_048,
  maxSequenceLength: 512,
  maxChanges: 64,
  maxExcerptBytes: 200,
  maxStaleMs: null,
  maxSources: 32,
  maxFields: 11,
  maxActionItems: 32,
});
