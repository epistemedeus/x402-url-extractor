import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { encodePaymentResponseHeader } from "@x402/core/http";

import { decideExtractTask } from "./examples/customer-x402/src/extract-task.mjs";
import { classifyRequestConstruction } from "./examples/customer-x402/src/request-construction.mjs";
import { classifyPaidResponse } from "./examples/customer-x402/src/outcome.mjs";
import {
  EXTRACT_TEXT_EXCERPT_CHARS,
  EXTRACT_TEXT_EXCERPT_MAX_CHARS,
  parseTextExcerptLimit,
} from "./extract-capture.mjs";
import { maxAdmittedBatchExcerptChars, normalizeExtractBatchInput } from "./extract-batch.mjs";
import { createIdempotencyReplay } from "./idempotency-replay.mjs";

const payer = "0x1111111111111111111111111111111111111111";
const payTo = "0x2222222222222222222222222222222222222222";
const asset = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

function encodedPayment() {
  return Buffer.from(JSON.stringify({
    x402Version: 2,
    accepted: { scheme: "exact", network: "eip155:8453", asset, amount: "5000", payTo, maxTimeoutSeconds: 300 },
    payload: { authorization: { from: payer }, signature: "0xsigned-original" },
    extensions: { "payment-identifier": { info: { id: "extract_task_budget_001" } } },
  })).toString("base64");
}

function fakeResponse() {
  const headers = {};
  return {
    statusCode: 200,
    body: null,
    headers,
    set(name, value) { headers[String(name).toLowerCase()] = String(value); return this; },
    status(value) { this.statusCode = value; return this; },
    send(value) { this.body = Buffer.isBuffer(value) ? value : Buffer.from(String(value)); return this; },
    json(value) { this.set("content-type", "application/json"); this.body = Buffer.from(JSON.stringify(value)); return this; },
  };
}

function responseFor(body, { status = 200, settlement = null } = {}) {
  const headers = new Map([["content-type", "application/json"]]);
  if (settlement) headers.set("payment-response", encodePaymentResponseHeader(settlement));
  return {
    status,
    headers: { get: (name) => headers.get(String(name).toLowerCase()) ?? null },
    json: async () => body,
  };
}

function record(overrides = {}) {
  return {
    ok: true,
    requestedUrl: "https://example.com/doc",
    finalUrl: "https://example.com/doc",
    url: "https://example.com/doc",
    status: 200,
    sourceOk: true,
    error: null,
    title: "Doc",
    description: "A public page",
    text: "hello",
    jsonLd: [],
    openGraph: {},
    capture: {
      textExcerptLimitChars: EXTRACT_TEXT_EXCERPT_CHARS,
      textTruncated: false,
      bodyTruncated: false,
    },
    ...overrides,
  };
}

test("excerpt budget parser rejects bad values and keeps the default", () => {
  assert.equal(parseTextExcerptLimit(undefined).value, EXTRACT_TEXT_EXCERPT_CHARS);
  assert.equal(parseTextExcerptLimit("40000").value, EXTRACT_TEXT_EXCERPT_MAX_CHARS);
  for (const bad of [0, -1, 40001, 1.5, "1200abc", "0", "", "  ", true]) {
    if (bad === "") {
      assert.equal(parseTextExcerptLimit(bad).ok, true);
      continue;
    }
    assert.equal(parseTextExcerptLimit(bad).ok, false, String(bad));
  }
});

test("batch admission rejects an excerpt that cannot fit the response ceiling", () => {
  const five = maxAdmittedBatchExcerptChars(5);
  assert.ok(five >= EXTRACT_TEXT_EXCERPT_CHARS);
  assert.ok(five < EXTRACT_TEXT_EXCERPT_MAX_CHARS);
  const admitted = normalizeExtractBatchInput({
    urls: ["https://example.com/"],
    textExcerptLimitChars: 2000,
  });
  assert.equal(admitted.textExcerptLimitChars, 2000);
  assert.throws(
    () => normalizeExtractBatchInput({
      urls: Array.from({ length: 5 }, (_, index) => `https://example.com/${index}`),
      textExcerptLimitChars: EXTRACT_TEXT_EXCERPT_MAX_CHARS,
    }),
    /textExcerptLimitChars exceeds/,
  );
  const unchanged = normalizeExtractBatchInput({ urls: ["https://example.com/"], fields: ["title"] });
  assert.equal(Object.hasOwn(unchanged, "textExcerptLimitChars"), false);
});

test("caller predicates do not treat schema-pass, refusal, or a cropped body as task completion", () => {
  const cropped = record({
    text: "x".repeat(EXTRACT_TEXT_EXCERPT_CHARS),
    capture: { textExcerptLimitChars: 1200, textTruncated: true, bodyTruncated: false },
  });
  const unlabeled = decideExtractTask(cropped, null);
  assert.equal(unlabeled.satisfied, null);
  assert.equal(unlabeled.delivery, "partial");
  assert.equal(unlabeled.nextAction.purchaseAuthorized, false);
  assert.equal(unlabeled.nextAction.executed, false);
  assert.equal(unlabeled.nextAction.id, "declare_predicate_or_use_read");

  const metadata = decideExtractTask(cropped, { kind: "metadata" });
  assert.equal(metadata.satisfied, true);
  assert.equal(metadata.reason, "metadata_sufficient_text_cropped");
  assert.equal(metadata.nextAction.id, "sufficient");

  const excerpt = decideExtractTask(cropped, { kind: "excerpt", requiredChars: 2000 });
  assert.equal(excerpt.satisfied, false);
  assert.equal(excerpt.nextAction.id, "raise_excerpt_budget");
  assert.equal(excerpt.nextAction.route, "/extract");
  assert.equal(excerpt.nextAction.executed, false);

  const markdown = decideExtractTask(record(), { kind: "markdown" });
  assert.equal(markdown.satisfied, false);
  assert.equal(markdown.nextAction.id, "use_existing_read");
  assert.equal(markdown.nextAction.route, "/read");

  const refused = decideExtractTask(record({
    status: 403,
    sourceOk: false,
    error: { code: "http_403", message: "source refused: HTTP 403" },
    text: "Access Denied",
  }), { kind: "excerpt" });
  assert.equal(refused.satisfied, false);
  assert.equal(refused.delivery, "source_refused");

  const unavailable = decideExtractTask({
    ok: false,
    sourceOk: false,
    error: { code: "timeout", message: "aborted" },
  }, { kind: "excerpt" });
  assert.equal(unavailable.delivery, "unavailable");
  assert.equal(unavailable.nextAction.purchaseAuthorized, false);

  const budget = decideExtractTask(record({
    capture: { textExcerptLimitChars: 1200, textTruncated: true, bodyTruncated: true },
  }), { kind: "excerpt" });
  assert.equal(budget.reason, "source_body_budget");
  assert.equal(budget.nextAction.id, "source_budget_exhausted");

  const malformed = decideExtractTask("not-json", { kind: "excerpt" });
  assert.equal(malformed.delivery, "invalid");

  const full = decideExtractTask(record({ text: "short page" }), { kind: "excerpt", requiredChars: 5 });
  assert.equal(full.satisfied, true);
  assert.equal(full.delivery, "excerpt_sufficient");
});

test("paid response classification keeps settlement failure and does not call truncated output useful", () => {
  const requiredOutput = {
    mediaType: "application/json",
    requiredFields: ["ok", "url", "title", "text"],
    maxResponseBytes: 500_000,
    task: { kind: "excerpt", requiredChars: 2000 },
  };
  const cropped = record({
    text: "x".repeat(1200),
    capture: { textExcerptLimitChars: 1200, textTruncated: true, bodyTruncated: false },
  });
  const partial = classifyPaidResponse({
    response: responseFor(cropped),
    body: cropped,
    requiredOutput,
    authorization: { bodyDigest: null, amountCapAtomic: "5000", network: "eip155:8453", asset, recipient: payTo },
  });
  assert.equal(partial.outcome, "partial_delivered");
  assert.notEqual(partial.evidence.outputDelivery, "useful");
  assert.equal(partial.evidence.task.satisfied, false);
  assert.equal(partial.evidence.task.nextAction.purchaseAuthorized, false);

  const failed = classifyPaidResponse({
    response: responseFor(cropped, { settlement: { success: false, errorReason: "fixture settle failure" } }),
    body: cropped,
    requiredOutput,
    authorization: { bodyDigest: null, amountCapAtomic: "5000", network: "eip155:8453", asset, recipient: payTo },
  });
  assert.equal(failed.outcome, "settlement_failed");
  assert.equal(failed.evidence.task.nextAction.executed, false);
});

test("a changed excerpt budget is not a replay of the cropped response", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "extract-task-replay-"));
  try {
    const replay = createIdempotencyReplay({ dataDir, secret: "test-secret", ttlMs: 60_000 });
    const headers = { "payment-signature": encodedPayment() };
    const original = replay.bindingFor({
      method: "GET",
      url: "https://agents.samedaydesk.com/extract?url=https%3A%2F%2Fexample.com%2Fdoc",
      headers,
    });
    await replay.store(original, {
      status: 200,
      headers: { "content-type": "application/json", "payment-response": "signed-settlement" },
      body: Buffer.from('{"ok":true,"text":"cropped"}'),
    });
    const replayed = fakeResponse();
    let runs = 0;
    await replay.middleware({
      method: "GET",
      path: "/extract",
      originalUrl: "/extract?url=https%3A%2F%2Fexample.com%2Fdoc",
      headers: { ...headers, host: "agents.samedaydesk.com", "x-forwarded-proto": "https" },
      protocol: "http",
    }, replayed, () => { runs += 1; });
    assert.equal(runs, 0);
    assert.equal(replayed.headers["x-payment-replay"], "hit");
    assert.equal(replayed.body.toString("utf8"), '{"ok":true,"text":"cropped"}');

    const changed = fakeResponse();
    let changedRuns = 0;
    await replay.middleware({
      method: "GET",
      path: "/extract",
      originalUrl: "/extract?textExcerptLimitChars=8000&url=https%3A%2F%2Fexample.com%2Fdoc",
      headers: { ...headers, host: "agents.samedaydesk.com", "x-forwarded-proto": "https" },
      protocol: "http",
    }, changed, () => { changedRuns += 1; });
    assert.equal(changedRuns, 0);
    assert.equal(changed.statusCode, 409);
    assert.equal(JSON.parse(changed.body).charged, false);
    assert.notEqual(changed.body.toString("utf8"), '{"ok":true,"text":"cropped"}');
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("the caller refuses a bad excerpt budget before purchase", () => {
  const bad = classifyRequestConstruction(
    "https://agents.samedaydesk.com/extract?url=https%3A%2F%2Fexample.com&textExcerptLimitChars=0",
  );
  assert.equal(bad.purchaseReady, false);
  assert.equal(bad.kind, "invalid_input");
  const good = classifyRequestConstruction(
    "https://agents.samedaydesk.com/extract?url=https%3A%2F%2Fexample.com&textExcerptLimitChars=8000",
  );
  assert.equal(good.purchaseReady, true);
  const legacy = classifyRequestConstruction(
    "https://agents.samedaydesk.com/extract?url=https%3A%2F%2Fexample.com",
  );
  assert.equal(legacy.purchaseReady, true);
});
