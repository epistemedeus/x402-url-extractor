import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

import {
  EXTRACT_BATCH_AMOUNT_ATOMIC,
  EXTRACT_BATCH_PATH,
  assertPublicHttpsUrl,
  executeExtractBatch,
  extractBatchCheckpointPath,
  extractBatchJobId,
  normalizeExtractBatchInput,
  formatMerchantResult,
  serveExtractBatch,
  extractBatchOutputSchema,
  extractBatchOutputExample,
  extractBatchMcpOutputSchema,
  extractBatchInputRefusalSchema,
  extractBatchInputRefusalPayload,
  extractBatchInputRefusalDeclaration,
  readExtractBatchInputRefusalCode,
  validateExtractBatchRequest,
  maxAdmittedBatchExcerptChars,
  ExtractBatchInputError,
} from "./extract-batch.mjs";
import { DEFAULT_EXTRACT_BATCH_COST, EXTRACT_BATCH_MAX_URL_LENGTH, extractBatchCostParameters, isExtractBatchEnabled } from "./extract-batch-config.mjs";
import { publicFetch } from "./extract-batch-c1/public-fetch.mjs";

const ALPHA = `<!doctype html><html lang="en"><head><title>Alpha</title><meta name="description" content="A"></head><body><h1>Alpha</h1><script type="application/ld+json">{"@type":"WebPage"}</script></body></html>`;
const BETA = `<!doctype html><html><head><title>Beta</title></head><body><h1>Beta</h1><script type="application/ld+json">{not json}</script></body></html>`;
const validateOutput = new Ajv2020({ strict: false, allErrors: true }).compile(extractBatchOutputSchema());
function assertOutput(result) {
  assert.equal(validateOutput(result), true, JSON.stringify(validateOutput.errors));
}

function mockFetch(pages) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const page = pages[url] || pages["*"];
    if (!page) {
      return {
        status: 404,
        headers: { get: () => null },
        body: { getReader() { return { async read() { return { done: true }; }, async cancel() {} }; } },
      };
    }
    if (page.redirect) {
      return {
        status: page.status || 302,
        headers: { get: (name) => name.toLowerCase() === "location" ? page.redirect : null },
        body: { cancel: async () => {} },
      };
    }
    const bytes = new TextEncoder().encode(page.body || "");
    return {
      status: page.status || 200,
      headers: { get: (name) => (name.toLowerCase() === "content-type" ? "text/html" : null) },
      body: {
        getReader() {
          let done = false;
          return {
            async read() {
              if (done) return { done: true };
              done = true;
              return { done: false, value: bytes };
            },
            async cancel() {},
          };
        },
      },
    };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

test("rejects invalid batch input before any job is planned", () => {
  assert.throws(() => normalizeExtractBatchInput(null), /JSON object/);
  assert.throws(() => normalizeExtractBatchInput({ urls: [] }), /1 to 5/);
  assert.throws(() => normalizeExtractBatchInput({ urls: ["https://example.com/", "https://example.com/", "https://example.com/", "https://example.com/", "https://example.com/", "https://example.com/"] }), /1 to 5/);
  assert.throws(() => normalizeExtractBatchInput({ urls: ["http://example.com/"] }), /HTTPS/);
  assert.throws(() => normalizeExtractBatchInput({ urls: ["https://127.0.0.1/"] }), /private|loopback|blocked/i);
  assert.throws(() => normalizeExtractBatchInput({ urls: ["https://example.com/"], fields: ["title", "nope"] }), /unsupported/);
  assert.throws(() => normalizeExtractBatchInput({ urls: ["https://example.com/"], extra: true }), /unexpected field/);
  assert.equal(assertPublicHttpsUrl("https://example.com/path"), "https://example.com/path");
});

test("accepted C1 runs after a planned job and reports partial JSON-LD failure", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "extract-batch-unit-"));
  const fetchImpl = mockFetch({
    "https://alpha.example/": { body: ALPHA },
    "https://beta.example/": { body: BETA },
  });
  const input = normalizeExtractBatchInput({
    urls: ["https://alpha.example/", "https://beta.example/"],
    fields: ["title", "jsonLd", "headings"],
  });
  const rawBody = Buffer.from(JSON.stringify(input));
  const result = await executeExtractBatch({
    input,
    rawBody,
    headers: {},
    dataDir,
    fetchImpl,
  });
  assert.equal(result.product, "samedaydesk-extract-batch");
  assert.equal(result.quote.amountAtomic, EXTRACT_BATCH_AMOUNT_ATOMIC);
  assert.equal(result.costInputs.hostingCosts, "unknown");
  assert.equal(result.costInputs.monetaryMargin, null);
  assert.equal(result.boundary.guaranteedUrlSuccess, false);
  assert.equal(result.partial, true);
  assert.equal(result.sources[0].status, "success");
  assert.equal(result.sources[1].status, "partial");
  assertOutput(result);
  assert.equal(fetchImpl.calls.length, 2);
  await rm(dataDir, { recursive: true, force: true });
});

test("redirect hops consume the request ceiling and publicFetch pins verified IPv4", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "extract-batch-redir-"));
  const fetchImpl = mockFetch({
    "https://start.example/": { redirect: "https://end.example/", status: 302 },
    "https://end.example/": { body: ALPHA },
  });
  try {
    const input = normalizeExtractBatchInput({ urls: ["https://start.example/"] });
    const result = await executeExtractBatch({
      input,
      rawBody: Buffer.from(JSON.stringify(input)),
      headers: {},
      dataDir,
      fetchImpl,
      costParameters: { ...DEFAULT_EXTRACT_BATCH_COST, maxRequests: 1 },
    });
    assert.equal(fetchImpl.calls.length, 1);
    assert.equal(result.stopReason, "exhausted_budget_requests");
    assert.equal(result.accounting.requests, 1);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }

  let requests = 0;
  await assert.rejects(publicFetch("https://example.com/", {}, {
    lookup: async () => [{ address: "127.0.0.1", family: 4 }],
    request: () => { requests += 1; },
  }), /DNS answer blocked/);
  assert.equal(requests, 0);
});

test("feature flag and cost ceilings cannot raise the documented maxima", () => {
  const original = { ...process.env };
  try {
    delete process.env.EXTRACT_BATCH_ENABLED;
    delete process.env.EXTRACT_BATCH_STAGING;
    assert.equal(isExtractBatchEnabled(), false);
    process.env.NODE_ENV = "production";
    process.env.RAILWAY_ENVIRONMENT = "production";
    assert.equal(isExtractBatchEnabled(), false);
    process.env.EXTRACT_BATCH_ENABLED = "true";
    assert.equal(isExtractBatchEnabled(), true);
    process.env.EXTRACT_BATCH_MAX_REQUESTS = "4";
    assert.equal(extractBatchCostParameters().maxRequests, 4);
    process.env.EXTRACT_BATCH_MAX_REQUESTS = "99";
    assert.throws(() => extractBatchCostParameters(), /EXTRACT_BATCH_MAX_REQUESTS/);
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in original)) delete process.env[key];
    }
    Object.assign(process.env, original);
  }
});

test("same payment and body reuse a per-job checkpoint path", () => {
  const headers = {};
  const rawBody = Buffer.from('{"urls":["https://example.com/"]}');
  const first = extractBatchJobId({ headers, rawBody });
  const second = extractBatchJobId({ headers, rawBody });
  assert.equal(first, second);
  assert.equal(first, createHash("sha256").update(`unpaid:none:${createHash("sha256").update(rawBody).digest("hex")}`).digest("hex"));
  assert.match(extractBatchCheckpointPath("/tmp/data", first), new RegExp(`${EXTRACT_BATCH_PATH.slice(1)}|extract-batch-jobs/${first}`));
});

test("runtime input matches the declared fields shape and HTTPS redirect boundary", async () => {
  for (const fields of ["title", null, ["title", "title"], Array(30).fill("title")]) {
    assert.throws(() => normalizeExtractBatchInput({ urls: ["https://example.com/"], fields }), /fields/);
  }
  const dataDir = await mkdtemp(path.join(tmpdir(), "extract-batch-downgrade-"));
  const fetchImpl = mockFetch({ "https://start.example/": { redirect: "http://end.example/" }, "http://end.example/": { body: ALPHA } });
  try {
    const input = normalizeExtractBatchInput({ urls: ["https://start.example/"] });
    const result = await executeExtractBatch({ input, rawBody: Buffer.from(JSON.stringify(input)), headers: {}, dataDir, fetchImpl });
    assert.deepEqual(fetchImpl.calls, ["https://start.example/"]);
    assert.equal(result.sources[0].status, "failure");
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});

test("large structured rows are explicitly partial within the replayable response ceiling", () => {
  const response = formatMerchantResult({ status: "completed", accounting: { succeeded: 5 }, items: Array.from({ length: 5 }, (_, index) => ({
    id: `item-${index}`, source: "https://example.com/", status: "success", data: { jsonLd: ["x".repeat(300000)] },
  })) }, { jobId: "0".repeat(64) });
  assert.ok(Buffer.byteLength(JSON.stringify(response)) <= 128 * 1024);
  assert.equal(response.partial, true);
  assertOutput(response);
  assert.equal(response.accounting.partial, 5);
  assert.ok(response.sources.every((source) => source.status === "partial" && source.data === null));
});

test("exception response retains every source and all declared required fields without invented zero costs", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "extract-batch-failure-"));
  const { writeFile } = await import("node:fs/promises");
  const blocked = path.join(dataDir, "not-a-directory");
  await writeFile(blocked, "preserve");
  const saved = process.env.COMMERCE_DATA_DIR;
  process.env.COMMERCE_DATA_DIR = blocked;
  const input = normalizeExtractBatchInput({ urls: ["https://example.com/"] });
  let response;
  const res = { locals: { extractBatchInput: input }, set() {}, status() { return this; }, json(value) { response = value; return this; } };
  try {
    await serveExtractBatch({ headers: {}, rawBody: Buffer.from(JSON.stringify(input)) }, res);
    for (const key of extractBatchOutputSchema().required) assert.ok(Object.hasOwn(response, key), key);
    assert.equal(response.sources.length, 1);
    assert.equal(response.sources[0].status, "unknown");
    assert.equal(response.costInputs.requests, null);
    assert.equal(response.accounting.bytes, null);
    assert.equal(response.jobStatus, "interrupted");
    assertOutput(response);
  } finally {
    if (saved === undefined) delete process.env.COMMERCE_DATA_DIR; else process.env.COMMERCE_DATA_DIR = saved;
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("semantic refusal codes are static, strict, and do not echo caller values", () => {
  const validateRefusal = new Ajv2020({ strict: false, allErrors: true }).compile(extractBatchInputRefusalSchema());
  const declaration = extractBatchInputRefusalDeclaration();
  const secret = "sk_live_SYNTHETIC";
  const secretValue = "hunter2";
  const cases = [
    [null, "body_not_object"],
    [["https://example.com/"], "body_not_object"],
    [{ urls: ["https://example.com/"], [secret]: secretValue }, "unexpected_field"],
    [{}, "urls_invalid"],
    [{ urls: [] }, "urls_invalid"],
    [{ urls: Array.from({ length: 6 }, (_, index) => `https://example.com/${index}`) }, "urls_invalid"],
    [{ urls: "https://example.com/" }, "urls_invalid"],
    [{ urls: [""] }, "url_item_invalid"],
    [{ urls: ["   "] }, "url_item_invalid"],
    [{ urls: [1] }, "url_item_invalid"],
    [{ urls: [`https://example.com/${"a".repeat(EXTRACT_BATCH_MAX_URL_LENGTH)}`] }, "url_too_long"],
    [{ urls: ["not a url"] }, "url_malformed"],
    [{ urls: ["https://s3cret-user:s3cret-pass@example.com/hidden"] }, "url_credentials"],
    [{ urls: ["http://example.com/"] }, "url_scheme_not_https"],
    [{ urls: ["ftp://example.com/"] }, "url_scheme_unsupported"],
    [{ urls: ["https://127.0.0.1/do-not-store"] }, "url_not_public"],
    [{ urls: ["https://10.9.8.7/do-not-store"] }, "url_not_public"],
    [{ urls: ["https://192.168.1.20/do-not-store"] }, "url_not_public"],
    [{ urls: ["https://172.16.0.5/do-not-store"] }, "url_not_public"],
    [{ urls: ["https://[::1]/do-not-store"] }, "url_not_public"],
    [{ urls: ["https://localhost/do-not-store"] }, "url_not_public"],
    [{ urls: ["https://printer.local/do-not-store"] }, "url_not_public"],
    [{ urls: ["http://127.0.0.1/do-not-store"] }, "url_not_public"],
    [{ urls: [expandedUrl()] }, "url_normalized_too_long"],
    [{ urls: ["https://example.com/"], fields: "title" }, "fields_invalid"],
    [{ urls: ["https://example.com/"], fields: [] }, "fields_invalid"],
    [{ urls: ["https://example.com/"], fields: ["title", "title"] }, "fields_invalid"],
    [{ urls: ["https://example.com/"], fields: [1] }, "fields_invalid"],
    [{ urls: ["https://example.com/"], fields: ["nope"] }, "fields_unknown"],
    [{ urls: ["https://example.com/"], textExcerptLimitChars: null }, "text_excerpt_limit_invalid"],
    [{ urls: ["https://example.com/"], textExcerptLimitChars: "" }, "text_excerpt_limit_invalid"],
    [{ urls: ["https://example.com/"], textExcerptLimitChars: 1.5 }, "text_excerpt_limit_invalid"],
    [{ urls: ["https://example.com/"], textExcerptLimitChars: 0 }, "text_excerpt_limit_invalid"],
    [{ urls: Array.from({ length: 5 }, (_, index) => `https://example.com/${index}`), textExcerptLimitChars: 3000 }, "text_excerpt_ceiling"],
  ];
  const seen = new Set();
  for (const [body, code] of cases) {
    assert.throws(() => normalizeExtractBatchInput(body), (error) => {
      assert.equal(error instanceof ExtractBatchInputError, true);
      assert.equal(error.code, "invalid_batch_input");
      assert.equal(error.reason, code);
      const payload = extractBatchInputRefusalPayload(error.reason);
      assert.equal(validateRefusal(payload), true, JSON.stringify(validateRefusal.errors));
      assert.equal(validateOutput(payload), false);
      assert.equal(extractBatchMcpOutputSchema.safeParse(payload).success, false);
      assert.equal(payload.ok, false);
      assert.equal(payload.charged, false);
      assert.deepEqual(payload.boundary, { sourceFetch: false, settlement: false, guaranteedUrlSuccess: false });
      assert.equal(Object.hasOwn(payload, "jobId"), false);
      assert.equal(Object.hasOwn(payload, "sources"), false);
      const encoded = JSON.stringify(payload);
      for (const forbidden of [secret, secretValue, "s3cret-user", "s3cret-pass", "do-not-store", "nope", "hidden"]) {
        assert.equal(encoded.includes(forbidden), false, `${code} echoed ${forbidden}`);
      }
      seen.add(code);
      return true;
    });
  }
  assert.deepEqual([...seen].sort(), declaration.codes.filter((code) => code !== "excerpt_ceiling_unavailable").sort());
  const unavailable = extractBatchInputRefusalPayload("excerpt_ceiling_unavailable");
  assert.equal(validateRefusal(unavailable), true, JSON.stringify(validateRefusal.errors));
  assert.equal(unavailable.error, "batch response ceiling cannot admit the default excerpt");
  assert.throws(() => maxAdmittedBatchExcerptChars(0), (error) => error instanceof ExtractBatchInputError && error.reason === "urls_invalid");
  const one = normalizeExtractBatchInput({ urls: ["https://example.com/"], textExcerptLimitChars: 3000 });
  assert.equal(one.textExcerptLimitChars, 3000);
  const omitted = normalizeExtractBatchInput({ urls: ["https://example.com/", "https://example.com/"] });
  assert.equal(Object.hasOwn(omitted, "textExcerptLimitChars"), false);
  assert.equal(omitted.urls.length, 2);
  assert.equal(normalizeExtractBatchInput({ urls: ["https://example.com/"], textExcerptLimitChars: "2000" }).textExcerptLimitChars, 2000);
  const unknown = { ...extractBatchInputRefusalPayload("unexpected_field"), code: "not_a_code" };
  assert.equal(validateRefusal(unknown), false);
  assert.equal(validateRefusal({ ...extractBatchInputRefusalPayload("url_not_public"), schemaVersion: "samedaydesk.extract-batch.v0" }), false);
  assert.equal(validateRefusal(extractBatchOutputExample()), false);
  assert.equal(readExtractBatchInputRefusalCode(unknown), null);
  assert.equal(readExtractBatchInputRefusalCode(extractBatchInputRefusalPayload("fields_unknown")), "fields_unknown");
  let statusCode;
  let payload;
  validateExtractBatchRequest({ method: "POST", path: EXTRACT_BATCH_PATH, body: { urls: ["https://example.com/"], [secret]: secretValue } }, {
    locals: {},
    set() {},
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return this; },
  }, () => { throw new Error("invalid input must not continue"); });
  assert.equal(statusCode, 400);
  assert.equal(payload.code, "unexpected_field");
  assert.equal(JSON.stringify(payload).includes(secret), false);
});

function expandedUrl() {
  const base = "https://example.com/";
  const raw = `${base}${"é".repeat(EXTRACT_BATCH_MAX_URL_LENGTH - base.length)}`;
  assert.equal(raw.length, EXTRACT_BATCH_MAX_URL_LENGTH);
  assert.ok(new URL(raw).href.length > EXTRACT_BATCH_MAX_URL_LENGTH);
  return raw;
}
