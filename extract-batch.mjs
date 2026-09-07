import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { PAYMENT_IDENTIFIER, declarePaymentIdentifierExtension } from "@x402/extensions/payment-identifier";

import { BAZAAR_SERVICE_ICON_URL } from "./bazaar-resource-metadata.mjs";
import { declareDiscoveryContract } from "./discovery-contract.mjs";
import { decodeReplayPayment } from "./idempotency-replay.mjs";
import { planJob, runBatch } from "./extract-batch-c1/index.mjs";
import { ALL_FIELDS, normalizeRequirement } from "./extract-batch-c1/extract.mjs";
import { publicFetch } from "./extract-batch-c1/public-fetch.mjs";
import { assertPublicHttpUrl } from "./extract-batch-c1/url-guard.mjs";
import {
  DEFAULT_EXTRACT_BATCH_COST,
  EXTRACT_BATCH_AMOUNT_ATOMIC,
  EXTRACT_BATCH_DESCRIPTION,
  EXTRACT_BATCH_MAX_URL_LENGTH,
  EXTRACT_BATCH_MAX_URLS,
  EXTRACT_BATCH_MAX_RESPONSE_BYTES,
  EXTRACT_BATCH_METHOD,
  EXTRACT_BATCH_PATH,
  EXTRACT_BATCH_PRICE_DISPLAY,
  EXTRACT_BATCH_PRICE_USD,
  EXTRACT_BATCH_PRODUCT,
  EXTRACT_BATCH_QUOTE_MEANING,
  EXTRACT_BATCH_SCHEMA_VERSION,
  extractBatchCostParameters,
  isExtractBatchEnabled,
} from "./extract-batch-config.mjs";

export {
  DEFAULT_EXTRACT_BATCH_COST,
  EXTRACT_BATCH_AMOUNT_ATOMIC,
  EXTRACT_BATCH_DESCRIPTION,
  EXTRACT_BATCH_MAX_URLS,
  EXTRACT_BATCH_METHOD,
  EXTRACT_BATCH_PATH,
  EXTRACT_BATCH_PRICE_DISPLAY,
  EXTRACT_BATCH_PRICE_USD,
  EXTRACT_BATCH_PRODUCT,
  EXTRACT_BATCH_QUOTE_MEANING,
  EXTRACT_BATCH_SCHEMA_VERSION,
  extractBatchCostParameters,
  isExtractBatchEnabled,
};

export { ALL_FIELDS };

export const EXTRACT_BATCH_READ_ONLY_POST = Object.freeze({
  method: EXTRACT_BATCH_METHOD,
  path: EXTRACT_BATCH_PATH,
});

const ALLOWED_BODY_KEYS = new Set(["urls", "fields"]);
const inProcessJobs = new Map();

export class ExtractBatchInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "ExtractBatchInputError";
    this.code = "invalid_batch_input";
  }
}

export function assertPublicHttpsUrl(raw) {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new ExtractBatchInputError("each url must be a public HTTPS URL");
  }
  if (raw.length > EXTRACT_BATCH_MAX_URL_LENGTH) {
    throw new ExtractBatchInputError(`url exceeds ${EXTRACT_BATCH_MAX_URL_LENGTH} characters`);
  }
  const url = assertPublicHttpUrl(raw);
  if (url.protocol !== "https:") {
    throw new ExtractBatchInputError("only public HTTPS URLs are accepted");
  }
  if (url.href.length > EXTRACT_BATCH_MAX_URL_LENGTH) throw new ExtractBatchInputError("normalized url exceeds length limit");
  return url.href;
}

export function normalizeExtractBatchInput(body) {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    throw new ExtractBatchInputError("request body must be a JSON object");
  }
  const extra = Object.keys(body).filter((key) => !ALLOWED_BODY_KEYS.has(key));
  if (extra.length) {
    throw new ExtractBatchInputError(`unexpected field: ${extra[0]}`);
  }
  if (!Array.isArray(body.urls) || body.urls.length < 1 || body.urls.length > EXTRACT_BATCH_MAX_URLS) {
    throw new ExtractBatchInputError(`urls must be an array of 1 to ${EXTRACT_BATCH_MAX_URLS} public HTTPS URLs`);
  }
  const urls = body.urls.map((value) => assertPublicHttpsUrl(value));
  if (body.fields !== undefined && (!Array.isArray(body.fields) || body.fields.length < 1 || body.fields.length > ALL_FIELDS.length || new Set(body.fields).size !== body.fields.length)) {
    throw new ExtractBatchInputError("fields must be a non-empty unique bounded array");
  }
  let requirement;
  try {
    requirement = normalizeRequirement(body.fields === undefined ? {} : { fields: body.fields });
  } catch (error) {
    throw new ExtractBatchInputError(error.message || "invalid fields");
  }
  return Object.freeze({
    urls: Object.freeze(urls),
    fields: Object.freeze([...requirement.fields]),
  });
}

export function extractBatchJobId({ headers, rawBody }) {
  const payment = decodeReplayPayment(headers) || {};
  const bodyHash = createHash("sha256").update(rawBody || Buffer.alloc(0)).digest("hex");
  return createHash("sha256")
    .update(`${payment.protocol || "unpaid"}:${payment.id || "none"}:${bodyHash}`)
    .digest("hex");
}

export function extractBatchCheckpointPath(dataDir, jobId) {
  return path.join(dataDir, "extract-batch-jobs", jobId, "checkpoint.json");
}

function resolveFetchImpl(fetchImpl) {
  const fetcher = fetchImpl || globalThis.__SAMEDAYDESK_EXTRACT_BATCH_FETCH__ || publicFetch;
  return (url, options) => fetcher(assertPublicHttpsUrl(url), options);
}

export const EXTRACT_BATCH_DISCOVERY_INPUT = Object.freeze({
  urls: Object.freeze(["https://example.com/"]),
  fields: Object.freeze(["title", "description", "headings"]),
});

export function extractBatchQuote() {
  return Object.freeze({
    amountAtomic: EXTRACT_BATCH_AMOUNT_ATOMIC,
    displayUsdc: EXTRACT_BATCH_PRICE_DISPLAY,
    meaning: EXTRACT_BATCH_QUOTE_MEANING,
  });
}

export function extractBatchBoundary() {
  return Object.freeze({
    guaranteedUrlSuccess: false,
    introductoryPrice: true,
    sourceFetchBeforeAuthorization: false,
    automaticRetries: false,
  });
}

export function canonicalExtractBatchBody(input) {
  const normalized = input?.urls ? input : normalizeExtractBatchInput(input);
  const body = { urls: [...normalized.urls] };
  if (normalized.fields) body.fields = [...normalized.fields];
  return Object.freeze(body);
}

export function extractBatchRawBody(input) {
  return Buffer.from(JSON.stringify(canonicalExtractBatchBody(input)));
}

export function extractBatchOutputExample() {
  return {
    ok: true,
    product: EXTRACT_BATCH_PRODUCT,
    schemaVersion: EXTRACT_BATCH_SCHEMA_VERSION,
    quote: extractBatchQuote(),
    jobId: "0".repeat(64),
    jobStatus: "completed",
    stopReason: null,
    partial: false,
    sources: [{
      id: "item-001",
      source: "https://example.com/",
      status: "success",
      data: { title: "Example Domain", description: null, headings: { h1: ["Example Domain"], h2: [] } },
      notes: [],
      error: null,
      provenance: { transport: "live", finalUrl: "https://example.com/", httpStatus: 200 },
    }],
    accounting: {
      requests: 1,
      bytes: 528,
      wallMs: 12,
      retries: 0,
      succeeded: 1,
      partial: 0,
      failed: 0,
      unknown: 0,
      skippedDuplicate: 0,
    },
    costInputs: {
      admittedBodyBytes: 528,
      requests: 1,
      wallMs: 12,
      hostingCosts: "unknown",
      modelCosts: "none",
      monetaryMargin: null,
      note: "accounting.bytes is uncompressed admitted application body bytes, including unresolved reservations, not socket wire billing",
    },
    charged: true,
    boundary: extractBatchBoundary(),
  };
}

export function extractBatchInputSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["urls"],
    properties: {
      urls: {
        type: "array",
        minItems: 1,
        maxItems: EXTRACT_BATCH_MAX_URLS,
        items: { type: "string", format: "uri", maxLength: EXTRACT_BATCH_MAX_URL_LENGTH },
        description: "One to five public HTTPS URLs. Charge is a bounded attempt, not per-URL success.",
      },
      fields: {
        type: "array",
        minItems: 1,
        maxItems: ALL_FIELDS.length,
        uniqueItems: true,
        items: { type: "string", enum: [...ALL_FIELDS] },
        description: "Optional bounded subset of structured extraction fields.",
      },
    },
  };
}

export function extractBatchOutputSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "ok", "product", "schemaVersion", "quote", "jobId", "jobStatus",
      "stopReason", "partial", "sources", "accounting", "costInputs", "charged", "boundary",
    ],
    properties: {
      ok: { type: "boolean" },
      product: { type: "string", const: EXTRACT_BATCH_PRODUCT },
      schemaVersion: { type: "string", const: EXTRACT_BATCH_SCHEMA_VERSION },
      quote: { type: "object", required: ["amountAtomic", "displayUsdc", "meaning"], properties: {
        amountAtomic: { type: "string", const: EXTRACT_BATCH_AMOUNT_ATOMIC },
        displayUsdc: { type: "string", const: EXTRACT_BATCH_PRICE_DISPLAY },
        meaning: { type: "string" },
      } },
      jobId: { type: "string", pattern: "^[a-f0-9]{64}$" },
      jobStatus: { type: "string", enum: ["running", "completed", "completed_with_unknown", "stopped", "interrupted"] },
      stopReason: { type: ["string", "null"] },
      partial: { type: "boolean" },
      sources: { type: "array", minItems: 1, maxItems: EXTRACT_BATCH_MAX_URLS, items: {
        type: "object", required: ["id", "source", "status", "data", "notes", "error", "provenance"],
        properties: {
          id: { type: "string" }, source: { type: "string" },
          status: { type: "string", enum: ["pending", "success", "partial", "failure", "unknown", "skipped_duplicate"] },
          data: { type: ["object", "null"] }, notes: { type: "array" },
          error: { type: ["object", "null"] }, provenance: { type: ["object", "null"] },
          finalUrl: { type: ["string", "null"] }, httpStatus: { type: ["integer", "null"] },
        },
      } },
      accounting: { type: "object" },
      costInputs: { type: "object" },
      charged: { type: "boolean" },
      boundary: { type: "object" },
      error: { type: "string" },
    },
  };
}

export const extractBatchMcpOutputSchema = z.object({
  ok: z.boolean(),
  product: z.literal(EXTRACT_BATCH_PRODUCT),
  schemaVersion: z.literal(EXTRACT_BATCH_SCHEMA_VERSION),
  quote: z.object({
    amountAtomic: z.literal(EXTRACT_BATCH_AMOUNT_ATOMIC),
    displayUsdc: z.literal(EXTRACT_BATCH_PRICE_DISPLAY),
    meaning: z.string(),
  }).strict(),
  jobId: z.string().regex(/^[a-f0-9]{64}$/),
  jobStatus: z.enum(["running", "completed", "completed_with_unknown", "stopped", "interrupted"]),
  stopReason: z.string().nullable(),
  partial: z.boolean(),
  sources: z.array(z.object({
    id: z.string(),
    source: z.string(),
    status: z.enum(["pending", "success", "partial", "failure", "unknown", "skipped_duplicate"]),
    data: z.record(z.any()).nullable(),
    notes: z.array(z.any()),
    error: z.record(z.any()).nullable(),
    provenance: z.record(z.any()).nullable(),
    finalUrl: z.string().nullable().optional(),
    httpStatus: z.number().int().nullable().optional(),
  }).passthrough()).min(1).max(EXTRACT_BATCH_MAX_URLS),
  accounting: z.record(z.any()),
  costInputs: z.record(z.any()),
  charged: z.boolean(),
  boundary: z.record(z.any()),
  error: z.string().optional(),
}).strict();

export function formatMerchantResult(result, { jobId }) {
  const accounting = result.accounting || {};
  const partial = (accounting.partial || 0) > 0
    || (accounting.failed || 0) > 0
    || (accounting.unknown || 0) > 0
    || result.status !== "completed";
  const response = {
    ok: result.status === "completed" && (accounting.failed || 0) === 0 && (accounting.unknown || 0) === 0,
    product: EXTRACT_BATCH_PRODUCT,
    schemaVersion: EXTRACT_BATCH_SCHEMA_VERSION,
    quote: extractBatchQuote(),
    jobId,
    jobStatus: result.status,
    stopReason: result.stopReason || null,
    partial,
    sources: (result.items || []).map((item) => ({
      id: item.id,
      source: item.source,
      status: item.status,
      data: item.data || null,
      notes: item.notes || [],
      error: item.error || null,
      finalUrl: item.finalUrl || item.provenance?.finalUrl || null,
      httpStatus: item.httpStatus ?? item.provenance?.httpStatus ?? null,
      provenance: item.provenance || null,
    })),
    accounting: {
      requests: accounting.requests || 0,
      bytes: accounting.bytes || 0,
      wallMs: accounting.wallMs || 0,
      retries: accounting.retries || 0,
      succeeded: accounting.succeeded || 0,
      partial: accounting.partial || 0,
      failed: accounting.failed || 0,
      unknown: accounting.unknown || 0,
      skippedDuplicate: accounting.skippedDuplicate || 0,
    },
    costInputs: {
      admittedBodyBytes: accounting.bytes || 0,
      requests: accounting.requests || 0,
      wallMs: accounting.wallMs || 0,
      hostingCosts: "unknown",
      modelCosts: "none",
      monetaryMargin: null,
      note: "accounting.bytes is uncompressed admitted application body bytes, including unresolved reservations, not socket wire billing",
    },
    charged: true,
    boundary: extractBatchBoundary(),
  };
  for (const source of response.sources) {
    if (Buffer.byteLength(JSON.stringify(source)) <= 20_000) continue;
    source.data = null;
    source.notes = [{ code: "output_truncated", message: "Structured fields omitted to keep the paid response replayable within its byte ceiling." }];
    source.error = source.error ? { code: String(source.error.code || "source_error").slice(0, 100), message: String(source.error.message || "source error").slice(0, 500) } : null;
    source.finalUrl = source.finalUrl?.slice(0, 2048) || null;
    source.provenance = { transport: "live", finalUrl: source.finalUrl, httpStatus: source.httpStatus, outputTruncated: true };
    if (source.status === "success") {
      source.status = "partial";
      response.accounting.succeeded = Math.max(0, response.accounting.succeeded - 1);
      response.accounting.partial += 1;
    }
    response.partial = true;
    response.ok = false;
  }
  if (Buffer.byteLength(JSON.stringify(response)) > EXTRACT_BATCH_MAX_RESPONSE_BYTES) throw new Error("batch response exceeds ceiling");
  return response;
}

export async function executeExtractBatch({
  input,
  headers,
  rawBody,
  dataDir,
  fetchImpl,
  now,
  costParameters,
} = {}) {
  const normalized = input || normalizeExtractBatchInput(JSON.parse(Buffer.from(rawBody || "{}").toString("utf8") || "{}"));
  const jobId = extractBatchJobId({ headers, rawBody });
  const jobKey = `${path.resolve(dataDir)}:${jobId}`;
  const existing = inProcessJobs.get(jobKey);
  if (existing) return existing;

  const run = (async () => {
    const job = planJob({
      jobId,
      sources: [...normalized.urls],
      requirement: { fields: [...normalized.fields] },
      checkpointPath: extractBatchCheckpointPath(dataDir, jobId),
      allowLive: true,
      retryUnknown: false,
      costParameters: costParameters || extractBatchCostParameters(),
    });
    const result = await runBatch(job, { fetchImpl: resolveFetchImpl(fetchImpl), now });
    return formatMerchantResult(result, { jobId });
  })();

  inProcessJobs.set(jobKey, run);
  try {
    return await run;
  } finally {
    setTimeout(() => {
      if (inProcessJobs.get(jobKey) === run) inProcessJobs.delete(jobKey);
    }, 1_000).unref();
  }
}

export function validateExtractBatchRequest(req, res, next) {
  if (req.method !== EXTRACT_BATCH_METHOD || req.path !== EXTRACT_BATCH_PATH) return next();
  try {
    res.locals.extractBatchInput = normalizeExtractBatchInput(req.body);
    res.set("X-SameDayDesk-Paid-Effect", "read_only");
    res.set("X-SameDayDesk-Paid-Effect-Profile", "/.well-known/paid-action-effects.json");
    res.set("X-SameDayDesk-Extract-Batch", "enabled");
    return next();
  } catch (error) {
    const message = error instanceof ExtractBatchInputError
      ? error.message
      : "invalid extract batch request";
    res.set("Cache-Control", "no-store");
    return res.status(400).json({
      ok: false,
      product: EXTRACT_BATCH_PRODUCT,
      error: message,
      charged: false,
      boundary: {
        sourceFetch: false,
        settlement: false,
        guaranteedUrlSuccess: false,
      },
    });
  }
}

export async function serveExtractBatch(req, res) {
  res.set("Cache-Control", "no-store");
  res.set("X-SameDayDesk-Extract-Batch", "enabled");
  try {
    const result = await executeExtractBatch({
      input: res.locals.extractBatchInput,
      headers: req.headers,
      rawBody: req.rawBody,
      dataDir: process.env.COMMERCE_DATA_DIR || path.join(process.cwd(), "data"),
    });
    return res.status(200).json(result);
  } catch (error) {
    const input = res.locals.extractBatchInput;
    const unknownSources = (input?.urls || []).map((source, index) => ({
      id: `item-${String(index + 1).padStart(3, "0")}`, source, status: "unknown",
      data: null, notes: [], error: { code: "execution_interrupted", message: "Execution measurements are unavailable; do not retry a new payment automatically." }, provenance: null,
    }));
    return res.status(200).json({
      ok: false,
      product: EXTRACT_BATCH_PRODUCT,
      schemaVersion: EXTRACT_BATCH_SCHEMA_VERSION,
      quote: extractBatchQuote(),
      jobId: extractBatchJobId({ headers: req.headers, rawBody: req.rawBody }),
      jobStatus: "interrupted",
      stopReason: "execution_interrupted",
      error: "batch_execution_interrupted",
      charged: true,
      partial: true,
      sources: unknownSources,
      accounting: { requests: null, bytes: null, wallMs: null, retries: null, succeeded: null, partial: null, failed: null, unknown: unknownSources.length, skippedDuplicate: null },
      costInputs: {
        admittedBodyBytes: null,
        requests: null,
        wallMs: null,
        hostingCosts: "unknown",
        modelCosts: "none",
        monetaryMargin: null,
      },
      boundary: extractBatchBoundary(),
    });
  }
}

export function extractBatchResource({ publicUrl }) {
  return {
    url: `${publicUrl}${EXTRACT_BATCH_PATH}`,
    method: EXTRACT_BATCH_METHOD,
    amount: EXTRACT_BATCH_AMOUNT_ATOMIC,
    description: EXTRACT_BATCH_DESCRIPTION,
    mimeType: "application/json",
  };
}

export function extractBatchX402Route({ network, payTo, extensions }) {
  const example = extractBatchOutputExample();
  return {
    [`${EXTRACT_BATCH_METHOD} ${EXTRACT_BATCH_PATH}`]: {
      serviceName: "SameDayDesk",
      tags: ["web", "batch-extract", "structured-json", "multi-url", "x402"],
      iconUrl: BAZAAR_SERVICE_ICON_URL,
      accepts: [{ scheme: "exact", price: EXTRACT_BATCH_PRICE_USD, network, payTo }],
      description: EXTRACT_BATCH_DESCRIPTION,
      mimeType: "application/json",
      extensions: {
        ...extensions,
        [PAYMENT_IDENTIFIER]: declarePaymentIdentifierExtension(true),
        ...declareDiscoveryContract({
          routeKey: `${EXTRACT_BATCH_METHOD} ${EXTRACT_BATCH_PATH}`,
          method: EXTRACT_BATCH_METHOD,
          bodyType: "json",
          input: EXTRACT_BATCH_DISCOVERY_INPUT,
          inputSchema: extractBatchInputSchema(),
          output: { example },
          outputSchema: extractBatchOutputSchema(),
        }),
      },
    },
  };
}

export function extractBatchMppRoute() {
  return {
    amount: EXTRACT_BATCH_PRICE_DISPLAY,
    description: EXTRACT_BATCH_DESCRIPTION,
    method: EXTRACT_BATCH_METHOD,
    path: EXTRACT_BATCH_PATH,
    bindRequestBody: true,
  };
}

export function extractBatchOpenApiPath({ paymentInfo }) {
  return {
    post: {
      operationId: "extractPublicUrlsBatch",
      tags: ["Web Data"],
      summary: EXTRACT_BATCH_DESCRIPTION,
      requestBody: {
        required: true,
        content: { "application/json": { schema: extractBatchInputSchema() } },
      },
      responses: {
        "200": {
          description: "bounded batch attempt with truthful per-source success, partial, failure, or unknown facts",
          content: { "application/json": { schema: extractBatchOutputSchema() } },
        },
        "400": { description: "invalid input, charged nothing, no source fetch" },
        "402": { description: `payment required (x402 or MPP, ${EXTRACT_BATCH_PRICE_USD} introductory flat batch quote)` },
        "409": { description: "payment identifier already bound to a different request body" },
        "413": { description: "JSON request exceeds the 16 KiB request ceiling; no authorization or source fetch" },
        "503": { description: "matching execution is active or settlement is unresolved, or replay capacity is full; no new settlement or source fetch on this response" },
      },
      "x-payment-info": paymentInfo,
    },
  };
}
