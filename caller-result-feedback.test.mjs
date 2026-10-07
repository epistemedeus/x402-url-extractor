import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { capturePaidEvidenceResponseDigest } from "./commerce-events.mjs";
import { SCHEMA_VERSION } from "./commerce-settlement-reconciler.mjs";
import { bindMerchantHttpDeliveryContracts } from "./http-delivery-evidence/bind-merchant-contracts.mjs";
import { declareCallerUsefulness } from "./http-delivery-evidence/caller-declaration.mjs";
import { RESOURCES } from "./http-delivery-evidence/contract.mjs";
import { PAID_EVIDENCE_FILENAME } from "./http-delivery-evidence/historical.mjs";
import { VALIDATION_FILENAME, recordFromObservedResponse } from "./http-delivery-evidence/store.mjs";
import { historicalV1Row, validExtractBody } from "./http-delivery-evidence/test/helpers.mjs";
import {
  joinOrdinaryDeliveries,
  receiveOrdinaryDeliveryJoin,
  reportViolations,
} from "./ordinary-delivery-join.mjs";
import {
  CALLER_RESULT_FEEDBACK_FILENAME,
  CALLER_RESULT_FEEDBACK_HEADER,
  CALLER_RESULT_FEEDBACK_LINK,
  CALLER_RESULT_FEEDBACK_TTL_MS,
  attachCallerResultFeedbackHeader,
  createCallerResultFeedbackService,
  issueCallerResultFeedbackToken,
  readCallerResultFeedbackToken,
} from "./caller-result-feedback.mjs";

bindMerchantHttpDeliveryContracts();

const WINDOW_START = "2026-09-10T00:00:00.000Z";
const WINDOW_END = "2026-09-10T00:00:02.000Z";

function key() {
  return randomBytes(32).toString("hex");
}

function observedPair({ id, requestDigest, settlement, title }) {
  const bytes = Buffer.from(JSON.stringify(validExtractBody(title ? { title } : {})));
  const validation = recordFromObservedResponse({
    method: "GET",
    resource: RESOURCES.EXTRACT,
    responseBytes: bytes,
    merchantHttpStatus: 200,
    settlementClass: "simulated",
    settlementReference: settlement,
    paidEvidenceId: id,
    requestDigest,
  });
  const paid = historicalV1Row({
    id,
    method: "GET",
    route: RESOURCES.EXTRACT,
    requestDigest,
    responseDigest: validation.responseDigest,
    settlementReference: settlement,
  });
  return { paid, validation, bytes };
}

async function writeCaptures(dir, pairs) {
  await writeFile(
    path.join(dir, PAID_EVIDENCE_FILENAME),
    `${pairs.map((pair) => JSON.stringify(pair.paid)).join("\n")}\n`,
  );
  await writeFile(
    path.join(dir, VALIDATION_FILENAME),
    `${pairs.map((pair) => JSON.stringify(pair.validation)).join("\n")}\n`,
  );
}

function tokenFor(pair, secret, now = 1_700_000_000_000) {
  return issueCallerResultFeedbackToken({
    key: secret,
    eventId: pair.paid.id,
    method: pair.paid.method,
    route: pair.paid.route,
    requestDigest: pair.paid.requestDigest,
    responseDigest: pair.paid.responseDigest,
    now,
  });
}

function submit(service, token, body, query = {}) {
  const rawBody = Buffer.from(JSON.stringify(body));
  return service.submit({ token, body, rawBody, query });
}

function ledger(paid) {
  return {
    schemaVersion: SCHEMA_VERSION,
    state: "reconciled",
    sourceEventId: paid.id,
    sourceEventTimestamp: paid.responseFinishedAt,
    route: paid.route,
    protocol: paid.paymentProtocol,
    paymentClass: "unclassified",
    settlementReference: paid.settlementReference,
    amountAtomic: "5000",
  };
}

test("a response capability is optional, scoped, and not an owner token", async () => {
  const source = await readFile(new URL("./caller-result-feedback.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("COMMERCE_INTERNAL_TOKEN"), false);
  assert.equal(source.includes("console."), false);
  const secret = key();
  const pair = observedPair({
    id: "11111111-1111-4111-8111-111111111111",
    requestDigest: "a".repeat(64),
    settlement: `0x${"d".repeat(64)}`,
  });
  const issuedAt = 1_700_000_000_000;
  const token = tokenFor(pair, secret, issuedAt);
  assert.equal(typeof token, "string");
  assert.equal(token.includes(secret), false);
  const read = readCallerResultFeedbackToken(token, secret, issuedAt);
  assert.equal(read.ok, true);
  assert.equal(read.claims.eventId, pair.paid.id);
  const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
  assert.equal(readCallerResultFeedbackToken(tampered, secret, issuedAt).code, "tampered_capability");
  assert.equal(readCallerResultFeedbackToken(token, secret, issuedAt + CALLER_RESULT_FEEDBACK_TTL_MS).code, "expired_capability");
  assert.equal(readCallerResultFeedbackToken(token, "", issuedAt).code, "key_absent");
  assert.equal(issueCallerResultFeedbackToken({ key: "short" }), null);
  assert.equal(issueCallerResultFeedbackToken({
    key: secret,
    eventId: "not-an-event",
    method: "GET",
    route: "/extract",
    requestDigest: "a".repeat(64),
    responseDigest: "b".repeat(64),
  }), null);

  const headers = {};
  const res = {
    statusCode: 200,
    headersSent: false,
    setHeader(name, value) { headers[name] = value; },
    append(name, value) { headers[name] = headers[name] ? `${headers[name]}, ${value}` : value; },
  };
  assert.equal(attachCallerResultFeedbackHeader(res, {
    key: secret,
    eventId: pair.paid.id,
    method: "GET",
    route: "/extract",
    requestDigest: pair.paid.requestDigest,
    responseDigest: pair.paid.responseDigest,
    statusCode: 200,
    replayed: false,
    now: issuedAt,
  }), true);
  assert.equal(headers[CALLER_RESULT_FEEDBACK_HEADER], token);
  assert.equal(headers.Link, CALLER_RESULT_FEEDBACK_LINK);
  assert.equal(attachCallerResultFeedbackHeader(res, { ...pair, key: secret, statusCode: 402, replayed: false }), false);
  assert.equal(attachCallerResultFeedbackHeader(res, {
    key: secret,
    eventId: pair.paid.id,
    method: "GET",
    route: "/extract",
    requestDigest: pair.paid.requestDigest,
    responseDigest: pair.paid.responseDigest,
    statusCode: 200,
    replayed: true,
  }), false);
  assert.equal(attachCallerResultFeedbackHeader(res, { key: "", statusCode: 200 }), false);

  const sent = [];
  const delivery = {
    statusCode: 200,
    headersSent: false,
    write() { return true; },
    end(chunk) {
      if (chunk) sent.push(Buffer.from(chunk));
      return this;
    },
  };
  const finish = capturePaidEvidenceResponseDigest(delivery, "GET", "/extract", {
    onCompleteBody() {
      throw new Error("feedback advertisement failed");
    },
  });
  const body = Buffer.from("{\"ok\":true}");
  delivery.end(body);
  assert.equal(Buffer.concat(sent).equals(body), true);
  assert.match(finish().digest, /^[0-9a-f]{64}$/);

  const bare = declareCallerUsefulness({
    validation: pair.validation,
    declaration: { source: "caller", disposition: "useful", inferred: false },
  });
  assert.equal(bare.present, false);
  assert.equal(bare.reason, "identity_mismatch");
  assert.equal(bare.usefulness, "unknown");
});

test("statements bind one retained capture and reject every other authority", async () => {
  const secret = key();
  const dir = await mkdtemp(path.join(tmpdir(), "caller-feedback-"));
  try {
    const useful = observedPair({
      id: "11111111-1111-4111-8111-111111111111",
      requestDigest: "a".repeat(64),
      settlement: `0x${"d".repeat(64)}`,
      title: "Useful fixture",
    });
    const silent = observedPair({
      id: "22222222-2222-4222-8222-222222222222",
      requestDigest: "b".repeat(64),
      settlement: `0x${"e".repeat(64)}`,
      title: "Silent fixture",
    });
    const negative = observedPair({
      id: "33333333-3333-4333-8333-333333333333",
      requestDigest: "c".repeat(64),
      settlement: `0x${"f".repeat(64)}`,
      title: "Negative fixture",
    });
    await writeCaptures(dir, [useful, silent, negative]);
    const issuedAt = 1_700_000_000_000;
    let clock = issuedAt;
    const service = createCallerResultFeedbackService({ dataDir: dir, key: secret, now: () => clock });
    const usefulToken = tokenFor(useful, secret, issuedAt);
    const negativeToken = tokenFor(negative, secret, issuedAt);
    const paidBefore = await readFile(path.join(dir, PAID_EVIDENCE_FILENAME), "utf8");
    const validationBefore = await readFile(path.join(dir, VALIDATION_FILENAME), "utf8");

    const accepted = await submit(service, usefulToken, { disposition: "useful", reasonCategory: "matched_task" });
    assert.equal(accepted.statusCode, 200);
    assert.equal(accepted.body.accepted, true);
    assert.equal(accepted.body.bound, true);
    assert.equal(accepted.body.idempotentReplay, false);
    assert.equal(accepted.body.charged, false);
    assert.equal(accepted.body.payerIdentity, false);
    assert.equal(accepted.body.usefulness, "unknown");
    assert.equal(accepted.body.disposition, "useful");
    assert.equal(accepted.body.reasonCategory, "matched_task");
    assert.equal(accepted.body.coverage, "this_retained_result_only");
    assert.equal(JSON.stringify(accepted.body).includes(usefulToken), false);

    const journal = await readFile(path.join(dir, CALLER_RESULT_FEEDBACK_FILENAME), "utf8");
    assert.equal(journal.includes(usefulToken), false);
    assert.equal(journal.includes(secret), false);
    assert.equal(journal.includes("https://"), false);
    const stored = JSON.parse(journal.trim());
    assert.equal(stored.usefulness, "unknown");
    assert.equal(stored.source, "caller");
    assert.equal(stored.capabilityHash.length, 64);
    assert.notEqual(stored.capabilityHash, usefulToken);

    const replay = await submit(service, usefulToken, { disposition: "useful", reasonCategory: "matched_task" });
    assert.equal(replay.body.idempotentReplay, true);
    assert.equal(await readFile(path.join(dir, CALLER_RESULT_FEEDBACK_FILENAME), "utf8"), journal);
    const conflict = await submit(service, usefulToken, { disposition: "not_useful", reasonCategory: "wrong_output" });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.body.code, "conflicting_statement");
    assert.equal(conflict.body.accepted, false);
    assert.equal(conflict.body.retainedDisposition, "useful");
    assert.equal(conflict.body.retainedReasonCategory, "matched_task");
    assert.equal(await readFile(path.join(dir, CALLER_RESULT_FEEDBACK_FILENAME), "utf8"), journal);

    const negativeResult = await submit(service, negativeToken, { disposition: "not_useful", reasonCategory: "not_actionable" });
    assert.equal(negativeResult.statusCode, 200);
    assert.equal(negativeResult.body.disposition, "not_useful");
    const cross = await submit(service, usefulToken, { disposition: "not_useful" });
    assert.equal(cross.body.code, "conflicting_statement");
    const { declarations } = await service.readDeclarations();
    assert.equal(declarations.some((item) => item.paidEvidenceId === silent.paid.id), false);

    const copied = await submit(service, "", {
      source: "caller",
      disposition: "useful",
      paidEvidenceId: useful.paid.id,
      requestDigest: useful.paid.requestDigest,
      settlementReference: useful.paid.settlementReference,
    });
    assert.equal(copied.statusCode, 400);
    assert.equal(copied.body.code, "unbounded_field");
    const queried = await submit(service, usefulToken, { disposition: "useful" }, { token: usefulToken });
    assert.equal(queried.statusCode, 400);
    assert.equal(queried.body.code, "query_rejected");
    const unbounded = await submit(service, usefulToken, { disposition: "useful", url: "https://secret.example/path" });
    assert.equal(unbounded.statusCode, 400);
    assert.equal(unbounded.body.code, "unbounded_field");
    const huge = await service.submit({
      token: usefulToken,
      body: { disposition: "useful" },
      rawBody: Buffer.alloc(513, 0x61),
      query: {},
    });
    assert.equal(huge.statusCode, 413);
    assert.equal(huge.body.code, "body_too_large");
    assert.equal((await readFile(path.join(dir, CALLER_RESULT_FEEDBACK_FILENAME), "utf8")).includes("secret.example"), false);

    const foreign = issueCallerResultFeedbackToken({
      key: secret,
      eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      method: "GET",
      route: "/extract",
      requestDigest: "1".repeat(64),
      responseDigest: "2".repeat(64),
      now: issuedAt,
    });
    const missing = await submit(service, foreign, { disposition: "useful" });
    assert.equal(missing.statusCode, 409);
    assert.equal(missing.body.code, "missing_capture");
    const tampered = await submit(service, `${usefulToken.slice(0, -1)}${usefulToken.endsWith("A") ? "B" : "A"}`, { disposition: "useful" });
    assert.equal(tampered.statusCode, 401);
    assert.equal(tampered.body.code, "tampered_capability");
    assert.equal(tampered.body.accepted, false);

    clock = issuedAt + CALLER_RESULT_FEEDBACK_TTL_MS;
    const expired = await submit(service, tokenFor(silent, secret, issuedAt), { disposition: "useful" });
    assert.equal(expired.statusCode, 401);
    assert.equal(expired.body.code, "expired_capability");
    clock = issuedAt;

    const paidPath = path.join(dir, PAID_EVIDENCE_FILENAME);
    const originalPaid = await readFile(paidPath, "utf8");
    const rewritten = JSON.parse(originalPaid.split("\n")[0]);
    rewritten.route = "/read";
    await writeFile(paidPath, `${JSON.stringify(rewritten)}\n${originalPaid.split("\n").slice(1).join("\n")}`);
    const wrongRoute = await submit(service, usefulToken, { disposition: "useful", reasonCategory: "matched_task" });
    assert.equal(wrongRoute.statusCode, 409);
    assert.equal(wrongRoute.body.code, "route_mismatch");
    rewritten.route = "/extract";
    rewritten.requestDigest = "9".repeat(64);
    await writeFile(paidPath, `${JSON.stringify(rewritten)}\n${originalPaid.split("\n").slice(1).join("\n")}`);
    const wrongRequest = await submit(service, usefulToken, { disposition: "useful", reasonCategory: "matched_task" });
    assert.equal(wrongRequest.body.code, "request_mismatch");
    rewritten.requestDigest = useful.paid.requestDigest;
    rewritten.responseDigest = "8".repeat(64);
    await writeFile(paidPath, `${JSON.stringify(rewritten)}\n${originalPaid.split("\n").slice(1).join("\n")}`);
    const wrongResponse = await submit(service, usefulToken, { disposition: "useful", reasonCategory: "matched_task" });
    assert.equal(wrongResponse.body.code, "response_mismatch");
    await writeFile(paidPath, originalPaid);
    const restored = await submit(service, usefulToken, { disposition: "useful", reasonCategory: "matched_task" });
    assert.equal(restored.body.idempotentReplay, true);

    await writeFile(paidPath, `${originalPaid}${JSON.stringify(useful.paid)}\n`);
    const duplicate = await submit(service, usefulToken, { disposition: "useful", reasonCategory: "matched_task" });
    assert.equal(duplicate.body.code, "duplicate_capture");
    await writeFile(paidPath, originalPaid);

    const unboundPaid = historicalV1Row({
      ...useful.paid,
      id: "44444444-4444-4444-8444-444444444444",
      requestDigest: "4".repeat(64),
      settlementReference: null,
    });
    const unboundValidation = recordFromObservedResponse({
      method: "GET",
      resource: RESOURCES.EXTRACT,
      responseBytes: useful.bytes,
      merchantHttpStatus: 200,
      settlementClass: "simulated",
      settlementReference: null,
      paidEvidenceId: unboundPaid.id,
      requestDigest: unboundPaid.requestDigest,
    });
    unboundPaid.responseDigest = unboundValidation.responseDigest;
    await writeFile(paidPath, `${JSON.stringify(unboundPaid)}\n`);
    await writeFile(path.join(dir, VALIDATION_FILENAME), `${JSON.stringify(unboundValidation)}\n`);
    const unboundToken = tokenFor({ paid: unboundPaid }, secret, issuedAt);
    const unbound = await submit(service, unboundToken, { disposition: "useful" });
    assert.equal(unbound.statusCode, 409);
    assert.equal(unbound.body.code, "settlement_unbound");
    await writeFile(paidPath, originalPaid);
    await writeFile(path.join(dir, VALIDATION_FILENAME), validationBefore);

    assert.equal(await readFile(paidPath, "utf8"), paidBefore);
    const absentKey = createCallerResultFeedbackService({ dataDir: dir, key: "" });
    const noKey = await submit(absentKey, usefulToken, { disposition: "useful" });
    assert.equal(noKey.statusCode, 503);
    assert.equal(noKey.body.code, "key_absent");
    assert.equal(noKey.body.accepted, false);

    const restarted = createCallerResultFeedbackService({ dataDir: dir, key: secret, now: () => issuedAt });
    const fromDisk = await submit(restarted, usefulToken, { disposition: "useful", reasonCategory: "matched_task" });
    assert.equal(fromDisk.body.idempotentReplay, true);
    const loaded = await restarted.readDeclarations();
    assert.equal(loaded.declarations.length, 2);

    const memory = joinOrdinaryDeliveries({
      settlements: [ledger(useful.paid)],
      paidEvidence: [useful.paid],
      validations: [useful.validation],
      feedbackDeclarations: loaded.declarations,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      sourceSha: "abc",
    });
    assert.equal(memory.rows[0].callerAcceptance, "bound");
    assert.equal(memory.rows[0].callerDisposition, "useful");
    assert.equal(memory.rows[0].usefulness, "unknown");
    assert.equal(memory.callerResultFeedback.sealBoundUseful, 1);
    assert.equal(memory.callerResultFeedback.measuredUsefulness, "unknown");
    assert.deepEqual(reportViolations(memory), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("torn, rotated, and unwritable journals keep prior statements and refuse new ones", async () => {
  const secret = key();
  const dir = await mkdtemp(path.join(tmpdir(), "caller-feedback-journal-"));
  try {
    const first = observedPair({
      id: "11111111-1111-4111-8111-111111111111",
      requestDigest: "a".repeat(64),
      settlement: `0x${"d".repeat(64)}`,
      title: "Rotate one",
    });
    const second = observedPair({
      id: "22222222-2222-4222-8222-222222222222",
      requestDigest: "b".repeat(64),
      settlement: `0x${"e".repeat(64)}`,
      title: "Rotate two",
    });
    await writeCaptures(dir, [first, second]);
    const now = 1_700_000_000_000;
    const service = createCallerResultFeedbackService({
      dataDir: dir,
      key: secret,
      maxFileBytes: 256,
      now: () => now,
    });
    const firstToken = tokenFor(first, secret, now);
    const secondToken = tokenFor(second, secret, now);
    assert.equal((await submit(service, firstToken, { disposition: "useful" })).statusCode, 200);
    assert.equal((await submit(service, secondToken, { disposition: "not_useful" })).statusCode, 200);
    const current = await readFile(service.currentPath, "utf8");
    const rotated = await readFile(service.rotatedPath, "utf8");
    assert.equal(current.includes(firstToken) || rotated.includes(firstToken), false);
    assert.equal(current.includes(second.paid.id) || rotated.includes(second.paid.id), true);
    assert.notEqual(rotated.trim(), "");
    await writeFile(service.currentPath, `${current}{\n`);
    const torn = await service.readDeclarations();
    assert.ok(torn.rejected >= 1);
    assert.equal(torn.declarations.length, 2);

    if (process.getuid() !== 0) {
      await chmod(service.currentPath, 0o444);
      await chmod(service.rotatedPath, 0o444);
      await chmod(dir, 0o555);
      const blocked = await submit(service, firstToken, { disposition: "not_useful" });
      assert.equal(blocked.statusCode, 409);
      assert.equal(blocked.body.code, "conflicting_statement");
      const third = observedPair({
        id: "55555555-5555-4555-8555-555555555555",
        requestDigest: "5".repeat(64),
        settlement: `0x${"a".repeat(64)}`,
        title: "Write failure",
      });
      await chmod(dir, 0o700);
      await writeFile(
        path.join(dir, PAID_EVIDENCE_FILENAME),
        `${JSON.stringify(first.paid)}\n${JSON.stringify(second.paid)}\n${JSON.stringify(third.paid)}\n`,
      );
      await writeFile(
        path.join(dir, VALIDATION_FILENAME),
        `${JSON.stringify(third.validation)}\n`,
        { flag: "a" },
      );
      await chmod(dir, 0o555);
      const failed = await submit(service, tokenFor(third, secret, now), { disposition: "useful" });
      assert.equal(failed.statusCode, 503);
      assert.equal(failed.body.code, "journal_write_failed");
      assert.equal(failed.body.accepted, false);
      await chmod(dir, 0o700);
      const after = await readFile(service.currentPath, "utf8");
      assert.equal(after.includes(third.paid.id), false);
      await chmod(service.currentPath, 0o600);
      await chmod(service.rotatedPath, 0o600);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the ordinary join reports supplied statements inside this window only", async () => {
  const secret = key();
  const dir = await mkdtemp(path.join(tmpdir(), "caller-feedback-join-"));
  try {
    const useful = observedPair({
      id: "11111111-1111-4111-8111-111111111111",
      requestDigest: "a".repeat(64),
      settlement: `0x${"d".repeat(64)}`,
      title: "Join useful",
    });
    const negative = observedPair({
      id: "33333333-3333-4333-8333-333333333333",
      requestDigest: "c".repeat(64),
      settlement: `0x${"f".repeat(64)}`,
      title: "Join negative",
    });
    const silent = observedPair({
      id: "22222222-2222-4222-8222-222222222222",
      requestDigest: "b".repeat(64),
      settlement: `0x${"e".repeat(64)}`,
      title: "Join silent",
    });
    await writeCaptures(dir, [useful, negative, silent]);
    await writeFile(path.join(dir, "commerce-settlements.ndjson"), [
      ledger(useful.paid),
      ledger(negative.paid),
      ledger(silent.paid),
    ].map((row) => JSON.stringify(row)).join("\n") + "\n");
    const now = 1_700_000_000_000;
    const service = createCallerResultFeedbackService({ dataDir: dir, key: secret, now: () => now });
    await submit(service, tokenFor(useful, secret, now), { disposition: "useful", reasonCategory: "saved_a_step" });
    await submit(service, tokenFor(negative, secret, now), { disposition: "not_useful", reasonCategory: "missing_field" });
    const report = await receiveOrdinaryDeliveryJoin({
      dataDir: dir,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      coverage: "unknown_for_full_window",
      sourceSha: "abc",
    });
    assert.deepEqual(reportViolations(report), []);
    assert.equal(report.schemaValidityIsBuyerUsefulness, false);
    assert.deepEqual(report.customerPlane, {
      attributableCustomerCount: null,
      buyerValidDeliveryCount: null,
      repeatIndependentCustomerCount: null,
    });
    const byRouteTime = Object.fromEntries(report.rows.map((row) => [row.callerSuppliedDisposition || "none", row]));
    assert.equal(byRouteTime.useful.callerAcceptance, "unknown");
    assert.equal(byRouteTime.useful.callerReason, "historical_intent_not_retained");
    assert.equal(byRouteTime.useful.callerSuppliedDisposition, "useful");
    assert.equal(byRouteTime.useful.callerSuppliedReasonCategory, "saved_a_step");
    assert.equal(byRouteTime.useful.usefulness, "unknown");
    assert.equal(byRouteTime.useful.disposition, "exact_join");
    assert.equal(byRouteTime.not_useful.callerSuppliedDisposition, "not_useful");
    assert.equal(byRouteTime.not_useful.callerDisposition, null);
    assert.equal(byRouteTime.none.callerAcceptance, "absent");
    assert.equal(byRouteTime.none.callerSuppliedDisposition, null);
    const aggregate = report.callerResultFeedback;
    assert.equal(aggregate.population, "rows_in_this_window");
    assert.equal(aggregate.globalFunnel, false);
    assert.equal(aggregate.customerCount, null);
    assert.equal(aggregate.measuredUsefulness, "unknown");
    assert.equal(aggregate.suppliedUseful, 1);
    assert.equal(aggregate.suppliedNotUseful, 1);
    assert.equal(aggregate.absent, 1);
    assert.equal(aggregate.unboundOrForeign, 0);
    assert.equal(aggregate.sealBoundUseful, 0);
    assert.equal(aggregate.suppliedUseful + aggregate.suppliedNotUseful + aggregate.absent + aggregate.unboundOrForeign, report.rows.length);
    const published = JSON.stringify(report);
    assert.equal(published.includes("0x"), false);
    assert.equal(published.includes(secret), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
