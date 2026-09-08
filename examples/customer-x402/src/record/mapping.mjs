import {
  ARTIFACT_NAME,
  BASES,
  DEFAULT_LIMITS,
  FIELD_NAME,
  FORBIDDEN_MAPPING_KEYS,
  HARD_CAPS,
  ITEM_CARDINALITY,
  ITEM_WHEN_MISSING,
  KINDS,
  MAPPING_SCHEMA_VERSION,
  MERCHANT_BATCH_SOURCE_STATUSES,
  ON_MISSING,
  PROTOTYPE_KEYS,
} from "./constants.mjs";
import { parsePointer } from "./pointer.mjs";

const PROTOTYPE = new Set(PROTOTYPE_KEYS);
const FORBIDDEN = new Set(FORBIDDEN_MAPPING_KEYS);
const LIMIT_KEYS = Object.keys(DEFAULT_LIMITS);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertPointer(value, label) {
  if (typeof value !== "string") fail("mapping.malformed", `${label} must be a JSON Pointer string`);
  try {
    const tokens = parsePointer(value);
    if (tokens.some((token) => PROTOTYPE.has(token))) {
      fail("mapping.prototype", `${label} uses a prototype-special token`);
    }
    return value;
  } catch (error) {
    fail(error.code || "pointer.malformed", `${label}: ${error.message}`);
  }
}

function parseLimits(value) {
  if (value == null) return { ...DEFAULT_LIMITS };
  if (!isObject(value)) fail("mapping.malformed", "limits must be an object");
  const extra = Object.keys(value).filter((key) => !LIMIT_KEYS.includes(key));
  if (extra.length) fail("mapping.unsupported", `limits has unsupported keys: ${extra.join(", ")}`);
  const limits = { ...DEFAULT_LIMITS };
  for (const key of LIMIT_KEYS) {
    if (value[key] === undefined) continue;
    if (!Number.isInteger(value[key]) || value[key] < 1) {
      fail("mapping.malformed", `limits.${key} must be a positive integer`);
    }
    if (value[key] > HARD_CAPS[key]) {
      fail("mapping.unsupported", `limits.${key} exceeds hard cap ${HARD_CAPS[key]}`);
    }
    limits[key] = value[key];
  }
  return limits;
}

function parseField(name, value) {
  if (!FIELD_NAME.test(name) || PROTOTYPE.has(name)) {
    fail("mapping.malformed", `field name is invalid: ${name}`);
  }
  if (!isObject(value)) fail("mapping.malformed", `fields.${name} must be an object`);
  for (const key of Object.keys(value)) {
    if (FORBIDDEN.has(key) || PROTOTYPE.has(key)) {
      fail("mapping.unsupported", `fields.${name} has forbidden key ${key}`);
    }
  }
  const allowed = new Set(["from", "base", "required", "onMissing"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail("mapping.unsupported", `fields.${name} has unsupported key ${key}`);
  }
  const from = assertPointer(value.from, `fields.${name}.from`);
  const base = value.base ?? "item";
  if (!BASES.includes(base)) fail("mapping.malformed", `fields.${name}.base must be document, row, or item`);
  if (value.required != null && typeof value.required !== "boolean") {
    fail("mapping.malformed", `fields.${name}.required must be boolean`);
  }
  const required = value.required === true;
  const onMissing = value.onMissing ?? "omit";
  if (!ON_MISSING.includes(onMissing)) {
    fail("mapping.malformed", `fields.${name}.onMissing must be omit or null`);
  }
  if (required && onMissing === "null") {
    fail("mapping.malformed", `fields.${name}: required fields cannot use onMissing null`);
  }
  return { name, from, base, required, onMissing };
}

export function parseMapping(value) {
  if (!isObject(value)) fail("mapping.malformed", "mapping must be a JSON object");
  for (const key of Object.keys(value)) {
    if (FORBIDDEN.has(key) || PROTOTYPE.has(key)) {
      fail("mapping.unsupported", `mapping has forbidden key ${key}`);
    }
  }
  const allowed = new Set([
    "schemaVersion", "kind", "artifact", "rowsPointer", "itemPointer",
    "itemCardinality", "itemWhenMissing", "includeStatuses", "statusPointer",
    "requestedFields", "fields", "unmappedIgnore", "merchantCompat", "limits",
    "recordSchema",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail("mapping.unsupported", `mapping has unsupported key ${key}`);
  }
  if (value.schemaVersion !== MAPPING_SCHEMA_VERSION) {
    fail("mapping.unsupported", `schemaVersion must be ${MAPPING_SCHEMA_VERSION}`);
  }
  const kind = value.kind ?? "json";
  if (!KINDS.includes(kind)) fail("mapping.malformed", "kind must be extract, extract_batch, or json");
  let artifact = value.artifact ?? "input.json";
  if (typeof artifact !== "string" || !ARTIFACT_NAME.test(artifact) || artifact.includes("/") || artifact.includes("\\")) {
    fail("mapping.malformed", "artifact must be a bounded file name");
  }
  const rowsPointer = value.rowsPointer === undefined
    ? (kind === "extract_batch" ? "/sources" : "")
    : assertPointer(value.rowsPointer, "rowsPointer");
  const itemPointer = value.itemPointer === undefined
    ? null
    : assertPointer(value.itemPointer, "itemPointer");
  const itemCardinality = value.itemCardinality ?? (itemPointer == null ? "one" : "array");
  if (!ITEM_CARDINALITY.includes(itemCardinality)) {
    fail("mapping.malformed", "itemCardinality must be array or one");
  }
  if (itemPointer == null && itemCardinality === "array") {
    fail("mapping.malformed", "itemCardinality array requires itemPointer");
  }
  const itemWhenMissing = value.itemWhenMissing ?? "empty";
  if (!ITEM_WHEN_MISSING.includes(itemWhenMissing)) {
    fail("mapping.malformed", "itemWhenMissing must be empty or fail");
  }
  const statusPointer = value.statusPointer === undefined
    ? (kind === "extract_batch" ? "/status" : null)
    : (value.statusPointer === null ? null : assertPointer(value.statusPointer, "statusPointer"));
  let includeStatuses = value.includeStatuses;
  if (includeStatuses == null) {
    includeStatuses = kind === "extract_batch" ? ["success", "partial"] : null;
  } else if (!Array.isArray(includeStatuses) || !includeStatuses.length
    || includeStatuses.some((item) => typeof item !== "string")
    || new Set(includeStatuses).size !== includeStatuses.length) {
    fail("mapping.malformed", "includeStatuses must be a unique nonempty string array");
  } else if (kind === "extract_batch" && includeStatuses.some((item) => !MERCHANT_BATCH_SOURCE_STATUSES.includes(item))) {
    fail("mapping.unsupported", "includeStatuses contains an unknown merchant source status");
  }
  let requestedFields = value.requestedFields ?? null;
  if (requestedFields != null) {
    if (!Array.isArray(requestedFields) || !requestedFields.length) {
      fail("mapping.malformed", "requestedFields must be a nonempty array of JSON Pointers");
    }
    requestedFields = requestedFields.map((item, index) => assertPointer(item, `requestedFields[${index}]`));
  } else if (kind === "extract_batch") {
    requestedFields = ["/data/jsonLd"];
  } else if (kind === "extract") {
    requestedFields = ["/jsonLd"];
  }
  if (!isObject(value.fields) || !Object.keys(value.fields).length) {
    fail("mapping.malformed", "fields must be a nonempty object");
  }
  const fieldNames = Object.keys(value.fields);
  if (fieldNames.length > HARD_CAPS.maxFields) {
    fail("mapping.unsupported", `fields exceeds maxFields ${HARD_CAPS.maxFields}`);
  }
  if (new Set(fieldNames).size !== fieldNames.length) {
    fail("mapping.malformed", "fields contains duplicate names");
  }
  const fields = fieldNames.map((name) => parseField(name, value.fields[name]));
  if (itemPointer == null && fields.some((field) => field.base === "item")) {
    fail("mapping.malformed", "fields with base item require itemPointer");
  }
  let unmappedIgnore = value.unmappedIgnore ?? ["@context"];
  if (!Array.isArray(unmappedIgnore) || unmappedIgnore.some((item) => typeof item !== "string")) {
    fail("mapping.malformed", "unmappedIgnore must be an array of strings");
  }
  if (value.merchantCompat != null && typeof value.merchantCompat !== "boolean") {
    fail("mapping.malformed", "merchantCompat must be boolean");
  }
  const merchantCompat = value.merchantCompat ?? (kind !== "json");
  const mapping = {
    schemaVersion: MAPPING_SCHEMA_VERSION,
    kind,
    artifact,
    rowsPointer,
    itemPointer,
    itemCardinality,
    itemWhenMissing,
    includeStatuses,
    statusPointer,
    requestedFields,
    fields,
    unmappedIgnore,
    merchantCompat,
    limits: parseLimits(value.limits),
    recordSchema: value.recordSchema === undefined ? null : value.recordSchema,
  };
  if (mapping.fields.some((field) => parsePointer(field.from).length > mapping.limits.maxPointerTokens)
    || parsePointer(mapping.rowsPointer).length > mapping.limits.maxPointerTokens
    || (mapping.itemPointer && parsePointer(mapping.itemPointer).length > mapping.limits.maxPointerTokens)) {
    fail("mapping.unsupported", `JSON Pointer exceeds maxPointerTokens ${mapping.limits.maxPointerTokens}`);
  }
  if (mapping.fields.length > mapping.limits.maxFields
    || (mapping.requestedFields?.length ?? 0) > mapping.limits.maxFields
    || (mapping.requestedFields ?? []).some(p => parsePointer(p).length > mapping.limits.maxPointerTokens)
    || (mapping.statusPointer !== null && parsePointer(mapping.statusPointer).length > mapping.limits.maxPointerTokens)) {
    fail('mapping.unsupported', 'Selected fields or pointers exceed configured limits');
  }
  return mapping;
}
