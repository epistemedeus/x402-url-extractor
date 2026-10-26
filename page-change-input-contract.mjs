import { createRequire } from "node:module";
import { z } from "zod";
import {
  ALL_FIELDS, C1_REQUIRED_KEYS, DEFAULT_LIMITS, MERCHANT_REQUIRED_KEYS,
  MERCHANT_SOURCE_REQUIRED_KEYS, ROW_STATUSES,
} from "./examples/customer-x402/src/page-change/constants.mjs";

const require = createRequire(import.meta.url);
const merchantSchema = require("./examples/customer-x402/src/record/merchant-batch-schema.json");
const populatedMerchant = require("./examples/customer-x402/fixtures/page-change/merchant/unchanged-before.json");
const syntheticNote = "SYNTHETIC offline construction example only. No URL fetch, payment, receipt, observation or freshness is evidenced.";
const selectedFields = "Compare only the explicitly selected data keys present on both matched rows. Missing keys are coverage unknown, not deletions; explicit null is a present value. Unselected metadata is not a content delta.";
const identity = "Stable source identity, separate from row id and observation time. Matching normalizes source strings (URL fragments removed). Use the same non-empty identity on both sides; duplicate active identities are ambiguous. Synthetic URL STRINGS are inert and are never fetched by this transform.";

export function pageChangeRequestExample() {
  // Reuse the populated merchant format; remove its illustrative live/charged
  // metadata rather than advertising synthetic input as an extraction receipt.
  const before = structuredClone(populatedMerchant);
  before.jobId = "0".repeat(64);
  before.charged = false;
  before.quote.meaning = syntheticNote;
  before.sources = before.sources.slice(0, 1);
  Object.assign(before.sources[0], {
    source: "https://synthetic.example.invalid/page",
    data: { title: "Synthetic title before", description: "Stable synthetic description" },
    provenance: { transport: "synthetic", note: syntheticNote },
  });
  before.accounting = Object.fromEntries(Object.keys(before.accounting).map(key => [key, 0]));
  before.costInputs = { note: syntheticNote };
  const after = structuredClone(before);
  after.jobId = "1".repeat(64);
  after.sources[0].data.title = "Synthetic title after";
  return { before, after, fields: ["title", "description"] };
}

export function pageChangeRequestExamples() {
  const titleChanged = pageChangeRequestExample();
  const unchanged = structuredClone(titleChanged);
  unchanged.after = structuredClone(unchanged.before);
  unchanged.after.jobId = "2".repeat(64);
  const envelope = structuredClone(titleChanged);
  for (const side of ["before", "after"]) envelope[side] = { mediaType: "application/json", body: envelope[side] };
  const legacyC1 = structuredClone(titleChanged);
  for (const side of ["before", "after"]) {
    const artifact = legacyC1[side];
    legacyC1[side] = {
      jobId: artifact.jobId, status: artifact.jobStatus, costParameters: {},
      accounting: artifact.accounting, items: artifact.sources,
    };
  }
  return {
    titleChanged: { summary: `${syntheticNote} Expected title-only change; description unchanged.`, value: titleChanged },
    unchanged: { summary: `${syntheticNote} Expected unchanged selected fields.`, value: unchanged },
    envelope: { summary: `${syntheticNote} JSON envelope; expected title-only change.`, value: envelope },
    legacyC1: { summary: `${syntheticNote} Supported legacy C1 result; expected title-only change.`, value: legacyC1 },
    diagnostic: {
      summary: "Deliberately incomplete diagnostic input. Expected incomparable, never proof of unchanged content.",
      value: { before: {}, after: {}, fields: ["title"] },
    },
  };
}

function batchSchemas() {
  const merchant = structuredClone(merchantSchema);
  merchant.title = "Supplied merchant extract-batch v0 artifact";
  merchant.description = "Representative merchant structure for useful comparisons; not a new paid request or proof of payment. " + selectedFields;
  // Required lists come from the same authority as parseBatch, not another format.
  merchant.required = [...MERCHANT_REQUIRED_KEYS];
  const row = merchant.properties.sources.items;
  row.required = [...MERCHANT_SOURCE_REQUIRED_KEYS];
  row.properties.status.enum = [...ROW_STATUSES];
  row.properties.source = { type: "string", minLength: 1, pattern: "\\S", description: identity };
  row.properties.id.description = "Row identifier; does not replace source identity.";
  row.properties.data = {
    type: ["object", "null"], description: selectedFields,
    properties: Object.fromEntries(ALL_FIELDS.map(field => [field, { description: `Selected extraction value: ${field}.` }])),
  };
  const c1 = {
    title: "Supplied legacy C1 batch result",
    type: "object", required: [...C1_REQUIRED_KEYS],
    description: "Existing C1 result compatibility. No merchant product/schemaVersion is required. " + selectedFields,
    properties: {
      jobId: { type: "string" }, status: { type: "string" },
      costParameters: { type: "object" }, accounting: { type: "object" },
      items: { type: "array", minItems: 1, maxItems: DEFAULT_LIMITS.maxSources, items: structuredClone(row) },
    },
  };
  return [merchant, c1];
}

function artifactSchema() {
  const batches = batchSchemas();
  return {
    type: "object",
    description: "Already held JSON artifact or JSON envelope, never a path or URL to dereference. " + identity
      + " The structured branches describe representative comparable inputs. Incomplete objects remain admitted for diagnostic reports, subject to unchanged HTTP safety checks; HTTP 200 does not establish completeness or usefulness.",
    anyOf: [
      ...batches,
      {
        title: "Supplied JSON envelope", type: "object", additionalProperties: false, required: ["body"],
        properties: {
          mediaType: { type: "string", const: "application/json" },
          body: { anyOf: batches },
          observedAt: { type: ["string", "null"], description: "Caller observation metadata only; does not attest freshness." },
          status: { type: "string" },
        },
      },
      {
        title: "Diagnostic object (may be incomplete or incomparable)", type: "object",
        description: "Intentionally permissive diagnostic alternative, not a template for a useful comparison. Missing/wrong schemas, keys, source identities or fields do not become valid comparison evidence. A missing snapshot can be supplied as {missing:true}. Safety admission still rejects paths, URL dereference, limit raises and invalid envelopes.",
      },
    ],
  };
}

export function pageChangeInputSchema() {
  return {
    type: "object", additionalProperties: false, required: ["before", "after", "fields"],
    description: `${selectedFields} Success is a complete comparable field report, not HTTP 200 alone. Supplied observations keep freshness unknown. Each artifact defaults to at most ${DEFAULT_LIMITS.maxBytes} JSON bytes, depth ${DEFAULT_LIMITS.maxJsonDepth}, ${DEFAULT_LIMITS.maxJsonNodes} nodes and ${DEFAULT_LIMITS.maxSources} compared sources; hosts can tighten ceilings.`,
    properties: {
      before: artifactSchema(), after: artifactSchema(),
      fields: {
        type: "array", minItems: 1, maxItems: DEFAULT_LIMITS.maxFields, uniqueItems: true,
        items: { type: "string", enum: [...ALL_FIELDS] }, description: "Explicit non-empty unique subset of supported fields. " + selectedFields,
      },
      clock: { type: ["string", "null"], description: "Optional caller UTC ISO-8601 timestamp with trailing Z, accepted for compatibility only; cannot attest freshness." },
      maxStaleMs: { type: ["integer", "null"], minimum: 0, description: "Optional freshness horizon, not a compute ceiling or freshness authority." },
      allowFreshClaim: { type: "boolean", const: false, description: "Supplied inputs cannot attest freshness. True is rejected." },
    },
    examples: [pageChangeRequestExample()],
  };
}

// Narrow projection of the keywords used above and in the existing merchant
// schema into the MCP SDK's required Zod shape. The JSON authority stays shared;
// no parser/engine validation is replaced by this discovery projection.
function mcpSchema(schema, cache) {
  const key = JSON.stringify(schema);
  if (cache.has(key)) return cache.get(key);
  let value;
  if (schema.anyOf) value = z.union(schema.anyOf.map(child => mcpSchema(child, cache)));
  else if (Array.isArray(schema.type)) value = z.union(schema.type.map(type => mcpSchema({ ...schema, type }, cache)));
  else if (Object.hasOwn(schema, "const")) value = z.literal(schema.const);
  else if (schema.enum) value = z.enum(schema.enum);
  else if (schema.type === "object") {
    const required = new Set(schema.required || []);
    const shape = Object.fromEntries(Object.entries(schema.properties || {}).map(([key, child]) => {
      const item = mcpSchema(child, cache);
      return [key, required.has(key) ? item : item.optional()];
    }));
    value = z.object(shape);
    value = schema.additionalProperties === false ? value.strict() : value.passthrough();
  } else if (schema.type === "array") {
    value = z.array(mcpSchema(schema.items || {}, cache));
    if (schema.minItems !== undefined) value = value.min(schema.minItems);
    if (schema.maxItems !== undefined) value = value.max(schema.maxItems);
  } else if (schema.type === "string") {
    value = z.string();
    if (schema.minLength !== undefined) value = value.min(schema.minLength);
    if (schema.pattern) value = value.regex(new RegExp(schema.pattern));
  } else if (schema.type === "integer") {
    value = z.number().int();
    if (schema.minimum !== undefined) value = value.min(schema.minimum);
  }
  else if (schema.type === "boolean") value = z.boolean();
  else if (schema.type === "null") value = z.null();
  else value = z.any();
  value = schema.description ? value.describe(schema.description) : value;
  cache.set(key, value);
  return value;
}

export function pageChangeMcpInputSchema() {
  const schema = pageChangeInputSchema();
  // Reuse identical Zod nodes so the pinned SDK emits references rooted in this
  // tool's own inputSchema. Runtime Zod validation and conversion stay SDK-owned.
  const cache = new Map();
  return Object.fromEntries(Object.entries(schema.properties).map(([key, child]) => {
    const value = mcpSchema(child, cache);
    return [key, schema.required.includes(key) ? value : value.optional()];
  }));
}

export function pageChangeMcpDescription() {
  return "Compare two already-held extract-batch JSON artifacts. charged is false. Not a paid SKU. Does not fetch, pay, or schedule a second observation. "
    + selectedFields + " " + syntheticNote + " Complete request example (title changes, description stays unchanged): "
    + JSON.stringify(pageChangeRequestExample());
}

// Apply only to the page-change request in its final OpenAPI document. References
// are rooted in the actual emitted document, including when it is the merchant
// root document. Examples remain complete inline values.
export function compactPageChangeOpenApi(document) {
  const schema = document.paths?.["/recipes/page-change"]?.post?.requestBody?.content?.["application/json"]?.schema;
  if (!schema) return document;
  const artifact = schema.properties.before;
  const merchant = artifact.anyOf[0];
  const c1 = artifact.anyOf[1];
  const row = merchant.properties.sources.items;
  const originals = { PageChangeArtifact: artifact, PageChangeMerchant: merchant, PageChangeC1: c1, PageChangeRow: row };
  const keys = new Map(Object.entries(originals).map(([name, value]) => [JSON.stringify(value), name]));
  function replace(value, defining = null) {
    if (!value || typeof value !== "object") return value;
    const name = keys.get(JSON.stringify(value));
    if (name && name !== defining) return { $ref: `#/components/schemas/${name}` };
    if (Array.isArray(value)) return value.map(child => replace(child));
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replace(child)]));
  }
  document.components ||= {};
  document.components.schemas ||= {};
  for (const name of Object.keys(originals)) {
    if (Object.hasOwn(document.components.schemas, name)) throw new Error(`page_change_schema_collision:${name}`);
  }
  for (const [name, value] of Object.entries(originals)) document.components.schemas[name] = replace(value, name);
  // Only schema structure is shared; annotations and every example stay exact.
  schema.properties.before = replace(artifact);
  schema.properties.after = replace(schema.properties.after);
  return document;
}
