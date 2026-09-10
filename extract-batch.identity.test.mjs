import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

import {
  executeExtractBatch,
  extractBatchOutputSchema,
  normalizeExtractBatchInput,
} from "./extract-batch.mjs";

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
    const bytes = page.bytes || new TextEncoder().encode(page.body || "");
    let delivered = false;
    return {
      status: page.status || 200,
      headers: { get: (name) => {
        const key = String(name).toLowerCase();
        if (key === "content-type") return page.contentType || "text/html; charset=utf-8";
        return null;
      } },
      body: {
        getReader() {
          return {
            async read() {
              if (delivered) return { done: true };
              delivered = true;
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

async function run(urls, pages, fields) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "extract-batch-identity-"));
  const fetchImpl = mockFetch(pages);
  const input = normalizeExtractBatchInput({ urls, ...(fields ? { fields } : {}) });
  try {
    const result = await executeExtractBatch({
      input,
      rawBody: Buffer.from(JSON.stringify(input)),
      headers: {},
      dataDir,
      fetchImpl,
    });
    assertOutput(result);
    return { result, fetchImpl, input };
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
}

test("batch pairs each row to the requested URL, not completion order", async () => {
  const { result } = await run(
    ["https://beta.example/", "https://alpha.example/"],
    {
      "https://alpha.example/": { body: "<!doctype html><title>Alpha</title><h1>Alpha</h1>" },
      "https://beta.example/": { body: "<!doctype html><title>Beta</title><h1>Beta</h1>" },
    },
    ["title", "headings"],
  );
  assert.equal(result.sources.length, 2);
  assert.equal(result.sources[0].id, "item-001");
  assert.equal(result.sources[0].source, "https://beta.example/");
  assert.equal(result.sources[0].data.title, "Beta");
  assert.equal(result.sources[1].id, "item-002");
  assert.equal(result.sources[1].source, "https://alpha.example/");
  assert.equal(result.sources[1].data.title, "Alpha");
});

test("duplicate and missing URLs keep original slots and identities", async () => {
  const { result } = await run(
    ["https://alpha.example/", "https://missing.example/", "https://alpha.example/"],
    {
      "https://alpha.example/": { body: "<!doctype html><title>Alpha</title><h1>Alpha</h1>" },
    },
    ["title", "text"],
  );
  assert.equal(result.sources.length, 3);
  assert.equal(result.sources[0].source, "https://alpha.example/");
  assert.equal(result.sources[0].status, "success");
  assert.equal(result.sources[1].source, "https://missing.example/");
  assert.equal(result.sources[1].status, "failure");
  assert.equal(result.sources[1].httpStatus, 404);
  assert.equal(result.sources[2].status, "skipped_duplicate");
  assert.equal(result.sources[2].source, "https://alpha.example/");
  assert.equal(result.accounting.skippedDuplicate, 1);
});

test("403/404 with block text keep source HTTP status and parsed text", async () => {
  const { result } = await run(
    ["https://block.example/", "https://gone.example/"],
    {
      "https://block.example/": {
        status: 403,
        body: "<html><body><h1>Access Denied</h1><p>meaningful block copy</p></body></html>",
      },
      "https://gone.example/": {
        status: 404,
        body: "<html><body><h1>Not Found</h1><p>helpful looking missing page</p></body></html>",
      },
    },
    ["title", "text", "headings"],
  );
  assert.equal(result.ok, false);
  assert.equal(result.partial, true);
  assert.equal(result.sources[0].status, "failure");
  assert.equal(result.sources[0].httpStatus, 403);
  assert.equal(result.sources[0].error.code, "http_403");
  assert.match(result.sources[0].data.text, /meaningful block copy/);
  assert.equal(result.sources[0].source, "https://block.example/");
  assert.equal(result.sources[1].httpStatus, 404);
  assert.equal(result.sources[1].error.code, "http_404");
  assert.match(result.sources[1].data.text, /helpful looking missing page/);
});

test("redirect records requested source and observed final URL", async () => {
  const { result } = await run(
    ["https://start.example/"],
    {
      "https://start.example/": { redirect: "https://end.example/", status: 302 },
      "https://end.example/": { body: "<!doctype html><title>End</title><h1>End</h1>" },
    },
    ["title"],
  );
  assert.equal(result.sources[0].source, "https://start.example/");
  assert.equal(result.sources[0].finalUrl, "https://end.example/");
  assert.equal(result.sources[0].httpStatus, 200);
  assert.equal(result.sources[0].data.title, "End");
  assert.equal(result.sources[0].status, "success");
});

test("429 and 5xx are source failures with retained body, not empty success", async () => {
  const { result } = await run(
    ["https://limited.example/", "https://down.example/"],
    {
      "https://limited.example/": { status: 429, body: "rate limited", contentType: "text/plain" },
      "https://down.example/": { status: 503, body: "<html><body>upstream down</body></html>" },
    },
    ["text"],
  );
  assert.equal(result.sources[0].httpStatus, 429);
  assert.equal(result.sources[0].status, "failure");
  assert.equal(result.sources[0].error.code, "http_429");
  assert.match(result.sources[0].data.text, /rate limited/);
  assert.equal(result.sources[1].httpStatus, 503);
  assert.equal(result.sources[1].error.code, "http_503");
  assert.match(result.sources[1].data.text, /upstream down/);
});
