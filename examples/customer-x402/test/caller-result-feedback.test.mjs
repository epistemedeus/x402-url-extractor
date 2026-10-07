import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import {
  callerResultFeedbackPublicContract,
  CALLER_RESULT_DISPOSITIONS as MERCHANT_DISPOSITIONS,
  CALLER_RESULT_REASON_CATEGORIES as MERCHANT_REASONS,
} from "../../../caller-result-feedback.mjs";
import { normalizeAuthorization } from "../src/authorization.mjs";
import {
  CALLER_RESULT_DISPOSITIONS,
  CALLER_RESULT_FEEDBACK_HEADER,
  CALLER_RESULT_FEEDBACK_PATH,
  CALLER_RESULT_REASON_CATEGORIES,
  reportCallerResult,
} from "../src/caller-result.mjs";
import { DEFAULT_AUTHORIZATION, DEFAULT_BATCH_AUTHORIZATION, OUTCOMES } from "../src/constants.mjs";
import { printPurchase, runAuthorizedPurchase } from "../src/purchase.mjs";
import { safeJson } from "../src/redact.mjs";
import {
  buildBatchPartialBody,
  createBatchFixtureFetch,
  createFixtureFetch,
} from "../fixtures/transport.mjs";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAC = "LeakMacSentinelFeedbackTokenValueXXXXYYYYYY";
const EVIDENCE_KEYS = [
  "authorizedAmountCapAtomic",
  "bodyDigest",
  "httpStatus",
  "outputDelivery",
  "outputReason",
  "outputReport",
  "outputValid",
  "retainedBody",
  "selectedAsset",
  "selectedNetwork",
  "selectedRecipient",
  "settlementParseError",
  "settlementPresent",
  "settlementSuccess",
  "settlementTransaction",
  "settlementVerification",
  "task",
];

function fixtureToken() {
  const payload = Buffer.from(JSON.stringify({ v: 1, marker: "fixture-capability" })).toString("base64url");
  const token = `${payload}.${MAC}`;
  assert.equal(MAC.length, 43);
  assert.match(token, /^[A-Za-z0-9_-]{20,1500}\.[A-Za-z0-9_-]{43}$/);
  return token;
}

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function acceptance(disposition, reasonCategory = null, extra = {}) {
  return jsonResponse(200, {
    ok: true,
    accepted: true,
    bound: true,
    idempotentReplay: false,
    charged: false,
    payerIdentity: false,
    usefulness: "unknown",
    disposition,
    reasonCategory,
    coverage: "this_retained_result_only",
    ...extra,
  });
}

function refusal(status, code, extra = {}) {
  return jsonResponse(status, {
    ok: false,
    accepted: false,
    bound: false,
    charged: false,
    payerIdentity: false,
    usefulness: "unknown",
    code,
    coverage: "this_retained_result_only",
    ...extra,
  });
}

function paidCount(calls) {
  return calls.filter((call) => call.hasPaymentSignature).length;
}

function assertClean(value, token) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  assert.equal(text.includes(token), false);
  assert.equal(text.includes(MAC), false);
}

function openSession({ kind = "get", token, link, onPost, partial = false } = {}) {
  const auth = normalizeAuthorization(kind === "batch" ? DEFAULT_BATCH_AUTHORIZATION : DEFAULT_AUTHORIZATION);
  const inner = kind === "batch"
    ? createBatchFixtureFetch({
      authorization: auth,
      paidBody: partial
        ? buildBatchPartialBody({ urls: [...auth.batch.urls], fields: [...auth.batch.fields] })
        : undefined,
    })
    : createFixtureFetch();
  const posts = [];
  const seen = [];
  const fetchImpl = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input instanceof URL ? input.href : input);
    seen.push(url);
    if (new URL(url).pathname === CALLER_RESULT_FEEDBACK_PATH) {
      const request = input instanceof Request ? input : new Request(input, init);
      const entry = {
        url: request.url,
        method: request.method,
        token: request.headers.get(CALLER_RESULT_FEEDBACK_HEADER),
        names: [...request.headers.keys()].sort(),
        body: await request.text(),
      };
      posts.push(entry);
      if (onPost) return onPost(entry);
      const parsed = JSON.parse(entry.body);
      return acceptance(parsed.disposition, parsed.reasonCategory ?? null);
    }
    const response = await inner.fetchImpl(input, init);
    if (token === undefined || response.status === 402) return response;
    const bytes = Buffer.from(await response.arrayBuffer());
    const headers = new Headers(response.headers);
    headers.set(CALLER_RESULT_FEEDBACK_HEADER, token);
    if (link !== false) {
      headers.set("link", link ?? `</commerce/caller-result-feedback>; rel="caller-result-feedback"`);
    }
    return new Response(bytes, { status: response.status, headers });
  };
  return { auth, fetchImpl, posts, seen, calls: inner.calls };
}

async function purchase(options, extra = {}) {
  const session = openSession(options);
  const result = await runAuthorizedPurchase({
    authorization: session.auth,
    account: privateKeyToAccount(generatePrivateKey()),
    fetchImpl: session.fetchImpl,
    approve: true,
    ...extra,
  });
  return { ...session, result };
}

test("customer statement contract matches the merchant free contract", () => {
  const contract = callerResultFeedbackPublicContract();
  assert.equal(contract.path, CALLER_RESULT_FEEDBACK_PATH);
  assert.equal(contract.header, CALLER_RESULT_FEEDBACK_HEADER);
  assert.equal(contract.method, "POST");
  assert.equal(contract.optional, true);
  assert.equal(contract.charged, false);
  assert.equal(contract.payerIdentity, false);
  assert.equal(contract.usefulness, "unknown");
  assert.deepEqual(CALLER_RESULT_DISPOSITIONS, MERCHANT_DISPOSITIONS);
  assert.deepEqual(CALLER_RESULT_REASON_CATEGORIES, MERCHANT_REASONS);
  assert.deepEqual(contract.dispositions, [...CALLER_RESULT_DISPOSITIONS]);
  assert.deepEqual(contract.reasonCategories, [...CALLER_RESULT_REASON_CATEGORIES]);
});

test("complete delivery keeps evidence and waits for an explicit useful statement", async () => {
  const token = fixtureToken();
  const session = await purchase({ token });
  assert.equal(session.result.outcome, OUTCOMES.VALID_DELIVERED);
  assert.equal(session.result.evidence.outputValid, true);
  assert.deepEqual(Object.keys(session.result.evidence).sort(), EVIDENCE_KEYS);
  assert.equal(session.result.callerResultFeedback.available, true);
  assert.equal(session.result.callerResultFeedback.automatic, false);
  assert.equal(session.result.callerResultFeedback.charged, false);
  assert.equal("token" in session.result.callerResultFeedback, false);
  assert.equal(session.posts.length, 0);
  assert.equal(paidCount(session.calls), 1);
  assert.notEqual(session.result.evidence.task?.satisfied, true);

  const seeded = await reportCallerResult(session.result, { disposition: "useful_delivered" }, {
    fetchImpl: session.fetchImpl,
  });
  assert.equal(seeded.code, "disposition_rejected");
  assert.equal(seeded.accepted, false);
  assert.equal(session.posts.length, 0);

  const report = await reportCallerResult(session.result, {
    disposition: "useful",
    reasonCategory: "matched_task",
  }, { fetchImpl: session.fetchImpl });
  assert.equal(report.accepted, true);
  assert.equal(report.disposition, "useful");
  assert.equal(report.reasonCategory, "matched_task");
  assert.equal(report.charged, false);
  assert.equal(report.payerIdentity, false);
  assert.equal(report.usefulness, "unknown");
  assert.equal(report.taskSubmitted, false);
  assert.equal(report.repurchaseAuthorized, false);
  assert.equal(report.paymentAttempted, false);
  assert.equal(session.result.outcome, OUTCOMES.VALID_DELIVERED);
  assert.equal(session.result.paymentSent, true);
  assert.equal(paidCount(session.calls), 1);
  assert.equal(session.posts.length, 1);
  assert.equal(session.posts[0].method, "POST");
  assert.equal(session.posts[0].url, `https://agents.samedaydesk.com${CALLER_RESULT_FEEDBACK_PATH}`);
  assert.equal(session.posts[0].token, token);
  assert.equal(session.posts[0].body, JSON.stringify({ disposition: "useful", reasonCategory: "matched_task" }));
  assert.equal(session.posts[0].names.includes("payment-signature"), false);
  assert.equal(session.posts[0].names.includes("authorization"), false);
  assert.equal(new URL(session.posts[0].url).search, "");
  assertClean(session.posts[0].url, token);
  assertClean(session.posts[0].body, token);
  assertClean(session.result, token);
  assertClean(report, token);
  assertClean(safeJson(session.result), token);
  assertClean(safeJson(report), token);
});

test("partial batch delivery can be called not_useful without another payment", async () => {
  const token = fixtureToken();
  const session = await purchase({ kind: "batch", partial: true, token });
  assert.equal(session.result.outcome, OUTCOMES.PARTIAL_DELIVERED);
  assert.equal(session.result.evidence.outputDelivery, "partial");
  assert.equal(session.posts.length, 0);
  const report = await reportCallerResult(session.result, {
    disposition: "not_useful",
    reasonCategory: "missing_field",
  }, { fetchImpl: session.fetchImpl });
  assert.equal(report.accepted, true);
  assert.equal(report.disposition, "not_useful");
  assert.equal(report.taskSubmitted, false);
  assert.equal(report.payerIdentity, false);
  assert.equal(session.result.outcome, OUTCOMES.PARTIAL_DELIVERED);
  assert.equal(paidCount(session.calls), 1);
  assert.equal(session.posts.length, 1);
  assertClean(safeJson(session.result), token);
});

test("absent and malformed capabilities do not invalidate paid output or post", async () => {
  const absent = await purchase({});
  assert.equal(absent.result.outcome, OUTCOMES.VALID_DELIVERED);
  assert.equal(absent.result.callerResultFeedback.available, false);
  assert.equal(absent.result.callerResultFeedback.reason, "absent");
  const absentReport = await reportCallerResult(absent.result, { disposition: "useful" }, {
    fetchImpl: absent.fetchImpl,
  });
  assert.equal(absentReport.code, "capability_absent");
  assert.equal(absent.posts.length, 0);
  assert.equal(paidCount(absent.calls), 1);

  const malformed = await purchase({ token: "not-a-capability" });
  assert.equal(malformed.result.outcome, OUTCOMES.VALID_DELIVERED);
  assert.equal(malformed.result.evidence.outputValid, true);
  assert.equal(malformed.result.callerResultFeedback.reason, "malformed_capability");
  const malformedReport = await reportCallerResult(malformed.result, { disposition: "not_useful" }, {
    fetchImpl: malformed.fetchImpl,
  });
  assert.equal(malformedReport.code, "malformed_capability");
  assert.equal(malformed.posts.length, 0);
  assert.equal(paidCount(malformed.calls), 1);
  assert.deepEqual(Object.keys(malformed.result.evidence).sort(), EVIDENCE_KEYS);
});

test("explicit no-action leaves the capability unsent", async () => {
  const token = fixtureToken();
  const session = await purchase({ token });
  assert.equal(session.result.callerResultFeedback.available, true);
  assert.equal(session.posts.length, 0);
  assert.equal(paidCount(session.calls), 1);
  assert.equal(session.seen.some((url) => url.includes(CALLER_RESULT_FEEDBACK_PATH)), false);
  assertClean(safeJson(session.result), token);
});

test("server expiry and conflict do not erase delivery or send payment again", async () => {
  const expiredToken = fixtureToken();
  const expired = await purchase({
    token: expiredToken,
    onPost: () => refusal(401, "expired_capability"),
  });
  const expiredReport = await reportCallerResult(expired.result, { disposition: "useful" }, {
    fetchImpl: expired.fetchImpl,
  });
  assert.equal(expiredReport.code, "expired_capability");
  assert.equal(expiredReport.accepted, false);
  assert.equal(expiredReport.deliveryPreserved, true);
  assert.equal(expiredReport.repurchaseAuthorized, false);
  assert.equal(expired.result.outcome, OUTCOMES.VALID_DELIVERED);
  assert.equal(expired.result.paymentSent, true);
  assert.equal(paidCount(expired.calls), 1);
  assert.equal(expired.posts.length, 1);

  const conflict = await purchase({
    token: fixtureToken(),
    onPost: () => refusal(409, "conflicting_statement", {
      retainedDisposition: "useful",
      retainedReasonCategory: "matched_task",
    }),
  });
  const conflictReport = await reportCallerResult(conflict.result, {
    disposition: "not_useful",
    reasonCategory: "wrong_output",
  }, { fetchImpl: conflict.fetchImpl });
  assert.equal(conflictReport.code, "conflicting_statement");
  assert.equal(conflictReport.retainedDisposition, "useful");
  assert.equal(conflictReport.payerIdentity, false);
  assert.equal(conflict.result.paymentSent, true);
  assert.equal(paidCount(conflict.calls), 1);
});

test("redirect, oversize, timeout, and disconnect stay on the free path", async () => {
  const redirect = await purchase({
    token: fixtureToken(),
    onPost: () => new Response(null, { status: 302, headers: { location: "https://evil.example/taken" } }),
  });
  const redirectReport = await reportCallerResult(redirect.result, { disposition: "useful" }, {
    fetchImpl: redirect.fetchImpl,
  });
  assert.equal(redirectReport.code, "redirect_refused");
  assert.equal(redirect.seen.some((url) => url.includes("evil.example")), false);
  assert.equal(JSON.stringify(redirectReport).includes("evil.example"), false);
  assert.equal(paidCount(redirect.calls), 1);

  const oversize = await purchase({
    token: fixtureToken(),
    onPost: () => new Response("x".repeat(5000), { status: 200, headers: { "content-type": "application/json" } }),
  });
  const oversizeReport = await reportCallerResult(oversize.result, { disposition: "useful" }, {
    fetchImpl: oversize.fetchImpl,
  });
  assert.equal(oversizeReport.code, "response_too_large");
  assert.equal(oversize.result.outcome, OUTCOMES.VALID_DELIVERED);
  assert.equal(paidCount(oversize.calls), 1);

  const timeout = await purchase({
    token: fixtureToken(),
    onPost: () => new Promise(() => {}),
  });
  const timeoutReport = await reportCallerResult(timeout.result, { disposition: "not_useful" }, {
    fetchImpl: timeout.fetchImpl,
    timeoutMs: 50,
  });
  assert.equal(timeoutReport.code, "transport_timeout");
  assert.equal(timeout.result.paymentSent, true);
  assert.equal(paidCount(timeout.calls), 1);

  const token = fixtureToken();
  const dropped = await purchase({
    token,
    onPost: (entry) => {
      throw new Error(`socket hang up ${entry.token}`);
    },
  });
  const droppedReport = await reportCallerResult(dropped.result, { disposition: "useful" }, {
    fetchImpl: dropped.fetchImpl,
  });
  assert.equal(droppedReport.code, "transport_failed");
  assertClean(droppedReport, token);
  assert.equal(dropped.result.outcome, OUTCOMES.VALID_DELIVERED);
  assert.equal(paidCount(dropped.calls), 1);
});

test("statements post only to the trusted origin and exact free path", async () => {
  const token = fixtureToken();
  const session = await purchase({
    token,
    link: `<https://evil.example${CALLER_RESULT_FEEDBACK_PATH}>; rel="caller-result-feedback"`,
  });
  session.result.matched.url = "https://evil.example/extract?url=1";
  const wrong = await reportCallerResult(session.result, {
    disposition: "useful",
    url: "https://evil.example/post",
  }, { fetchImpl: session.fetchImpl });
  assert.equal(wrong.code, "unbounded_field");
  assert.equal(session.posts.length, 0);
  const report = await reportCallerResult(session.result, { disposition: "not_useful" }, {
    fetchImpl: session.fetchImpl,
  });
  assert.equal(report.accepted, true);
  assert.equal(session.posts.length, 1);
  assert.equal(session.posts[0].url, `https://agents.samedaydesk.com${CALLER_RESULT_FEEDBACK_PATH}`);
  assert.equal(session.seen.some((url) => url.includes("evil.example")), false);
  assert.equal(paidCount(session.calls), 1);
  assertClean(report, token);
});

test("a bearer echo, stdout, attempt receipt, and JSON copy do not retain the token", async () => {
  const token = fixtureToken();
  const dir = mkdtempSync(join(tmpdir(), "caller-result-"));
  const receiptPath = join(dir, "attempt.json");
  try {
    const session = await purchase({
      token,
      onPost: (entry) => jsonResponse(200, {
        ok: true,
        accepted: true,
        bound: true,
        charged: false,
        payerIdentity: false,
        usefulness: "unknown",
        disposition: "useful",
        reasonCategory: null,
        code: entry.token,
        coverage: "this_retained_result_only",
      }),
    }, { attemptReceiptPath: receiptPath });
    const logs = [];
    const original = console.log;
    console.log = (...args) => logs.push(args.map(String).join(" "));
    try {
      printPurchase(session.result);
    } finally {
      console.log = original;
    }
    const echoed = await reportCallerResult(session.result, { disposition: "useful" }, {
      fetchImpl: session.fetchImpl,
    });
    assert.equal(echoed.code, "bearer_echo_refused");
    const receipt = readFileSync(receiptPath, "utf8");
    const copied = JSON.parse(JSON.stringify(session.result));
    const fromCopy = await reportCallerResult(copied, { disposition: "useful" }, {
      fetchImpl: session.fetchImpl,
    });
    assert.equal(fromCopy.code, "bearer_not_in_process");
    assert.equal(session.posts.length, 1);
    assert.equal(paidCount(session.calls), 1);
    assertClean(logs.join("\n"), token);
    assertClean(receipt, token);
    assertClean(echoed, token);
    assertClean(fromCopy, token);
    assertClean(safeJson(session.result), token);
    assert.equal(session.result.attemptReceiptWritten, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cold recipe rejects a seeded disposition and does not pay production", { timeout: 60_000 }, () => {
  const run = spawnSync(process.execPath, ["recipes/caller-result-feedback.mjs"], {
    cwd: PKG,
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const summary = JSON.parse(run.stdout);
  assert.equal(summary.productionPayment, false);
  assert.equal(summary.accountFile, false);
  assert.equal(summary.outcome, "valid_delivered");
  assert.equal(summary.postsBeforeExplicitReport, 0);
  assert.equal(summary.paymentSends, 1);
  assert.equal(summary.feedbackPosts, 1);
  assert.equal(summary.explicitReport.accepted, true);
  assert.equal(summary.explicitReport.disposition, "useful");
  assert.equal(summary.seededFailure.code, "disposition_rejected");
  assert.equal(summary.seededFailure.accepted, false);
  assert.equal(summary.taskHelp.invoked, false);
  assert.equal(summary.taskSubmitted, false);
  assert.equal(run.stdout.includes(MAC), false);
  assert.equal(run.stderr.includes(MAC), false);
});
