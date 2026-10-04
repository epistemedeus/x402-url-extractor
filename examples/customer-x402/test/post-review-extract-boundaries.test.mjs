import assert from "node:assert/strict";
import test from "node:test";
import { buildCapture } from "../../../extract-capture.mjs";
import { validateBuyerOutput } from "../src/output.mjs";
import { decideExtractTask } from "../src/extract-task.mjs";
import { admitExtractBatchBody } from "../src/batch-admission.mjs";
import { assertPurchaseReady, classifyRequestConstruction } from "../src/request-construction.mjs";
import { normalizeExtractBatchInput, maxAdmittedBatchExcerptChars } from "../../../extract-batch.mjs";

const url = "https://agents.samedaydesk.com/extract/batch";
const contract = { mediaType: "application/json", requiredFields: ["url", "title", "text"], maxResponseBytes: 4096 };
const failure = () => ({
  ok: false, url: "https://example.com/", requestedUrl: "https://example.com/",
  finalUrl: null, status: null, sourceOk: false,
  error: { code: "timeout", message: "The source timed out" },
  capture: buildCapture({ bodyBytes: 0, charset: null, textExcerptLimitChars: 8000 }),
});

test("malformed or unknown unavailable results are invalid, not delivered", () => {
  for (const body of [
    { ok: false }, { ok: false, error: { code: "timeout" } },
    { ...failure(), error: { code: "made_up", message: "no" } },
    { ...failure(), capture: null },
    { ...failure(), capture: { ...failure().capture, bodyBytes: -1 } },
    { ...failure(), sourceOk: true },
    { ...failure(), ok: "false" },
  ]) {
    assert.equal(decideExtractTask(body).delivery, "invalid");
    const result = validateBuyerOutput(body, contract);
    assert.equal(result.valid, false);
    assert.equal(result.delivery, "invalid");
  }
});
test("typed unavailable records retain budget and enforce authorized bytes", () => {
  const result = validateBuyerOutput(failure(), contract);
  assert.equal(result.valid, true);
  assert.equal(result.delivery, "unavailable");
  assert.equal(result.task.satisfied, false);
  assert.ok(result.report);
  const oversize = { ...failure(), error: { code: "timeout", message: "x".repeat(5000) } };
  assert.equal(validateBuyerOutput(oversize, contract).valid, false);
  assert.equal(validateBuyerOutput(failure(), { ...contract, maxResponseBytes: 40 }).valid, false);
});

test("batch pre-wallet admission refuses malformed inputs", () => {
  for (const body of [undefined, null, [], {}, { urls: [] },
    { urls: ["http://example.com/"] }, { urls: ["https://127.0.0.1/"] },
    { urls: ["https://example.com/"], extra: true },
    { urls: ["https://example.com/"], textExcerptLimitChars: null },
    { urls: ["https://example.com/"], textExcerptLimitChars: 40001 },
    { urls: ["https://example.com/"], fields: ["text", "text"] },
  ]) {
    assert.equal(classifyRequestConstruction(url, { method: "POST", body }).purchaseReady, false);
    assert.throws(() => assertPurchaseReady(url, { method: "POST", body }));
  }
});
test("caller and merchant share the budget ceiling and unchanged omitted canonical binding", () => {
  const urls = Array.from({ length: 5 }, (_, i) => `https://example.com/${i}`);
  const ceiling = maxAdmittedBatchExcerptChars(urls.length);
  assert.equal(ceiling, 2730);
  const legacy = admitExtractBatchBody({ urls, fields: ["text"] });
  assert.equal(legacy.bodyRaw, JSON.stringify({ urls, fields: ["text"] }));
  assert.equal(Object.hasOwn(legacy, "textExcerptLimitChars"), false);
  const admitted = admitExtractBatchBody({ urls, fields: ["text"], textExcerptLimitChars: ceiling });
  assert.equal(admitted.textExcerptLimitChars, ceiling);
  assert.equal(JSON.parse(admitted.bodyRaw).textExcerptLimitChars, ceiling);
  assert.notEqual(admitted.bodyDigest, legacy.bodyDigest);
  assert.equal(normalizeExtractBatchInput(JSON.parse(admitted.bodyRaw)).textExcerptLimitChars, ceiling);
  assert.equal(classifyRequestConstruction(url, { method: "POST", body: admitted.bodyRaw }).purchaseReady, true);
  assert.equal(classifyRequestConstruction(url, { method: "POST", body: { urls, textExcerptLimitChars: ceiling + 1 } }).purchaseReady, false);
  assert.throws(() => admitExtractBatchBody({ urls, textExcerptLimitChars: ceiling + 1 }), /ceiling|exceeds/);
  assert.throws(() => normalizeExtractBatchInput({ urls, textExcerptLimitChars: ceiling + 1 }), /ceiling|exceeds/);
});
