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
} from "./extract-batch.mjs";
import { DEFAULT_EXTRACT_BATCH_COST, extractBatchCostParameters, isExtractBatchEnabled } from "./extract-batch-config.mjs";
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
