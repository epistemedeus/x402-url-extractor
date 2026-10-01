import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { CLOSED_SPONSORED_REF } from "./useful-result-reuse/constants.mjs";
import { createReuseStore } from "./useful-result-reuse/store.mjs";
import { createUsefulResultReuse, selectExistingPaidOperation } from "./useful-result-reuse/service.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = "useful-result-reuse-grant-token-32b-minimum-value";
const OTHER = "different-grant-token-also-32-bytes-minimum";

function dir() {
  return mkdtempSync(path.join(tmpdir(), "useful-reuse-"));
}

function outcome(patch = {}) {
  return {
    schema: "samedaydesk.useful-result.v1",
    schemaVersion: "1",
    availability: "present",
    disposition: "useful",
    code: "unpaid_receipt_readable",
    httpStatus: 200,
    ...patch,
  };
}

function bindInput(patch = {}) {
  return {
    taskLabel: "caller-unpaid-receipt",
    operationId: "read-unpaid-receipt",
    method: "GET",
    route: "/read",
    outcomeSchema: "samedaydesk.useful-result.v1",
    outcomeSchemaVersion: "1",
    classification: "owner",
    outcome: outcome(),
    ...patch,
  };
}

function service(dataDir, token = TOKEN) {
  return createUsefulResultReuse({ dataDir, internalToken: token, now: () => Date.parse("2026-10-01T12:00:00.000Z") });
}

test("binds a qualified unpaid result and ignores a caller digest and success flag", async () => {
  const dataDir = dir();
  try {
    const api = service(dataDir);
    const bound = await api.bind(bindInput({
      assertedDigest: "ab".repeat(32),
      outcome: outcome({ usefulDelivery: "true" }),
    }));
    assert.equal(bound.accepted, true);
    assert.equal(bound.qualification, "useful");
    assert.equal(bound.useful, "true");
    assert.equal(bound.assertedDigestMatches, false);
    assert.equal(bound.assertedSuccessIgnored, true);
    assert.equal(bound.independentUse, false);
    const text = readFileSync(path.join(dataDir, "useful-result-private.ndjson"), "utf8");
    const taskRefs = readFileSync(path.join(dataDir, "commerce-outcome-task-ref.ndjson"), "utf8");
    assert.equal(text.includes("caller-unpaid-receipt"), false);
    assert.equal(text.includes(TOKEN), false);
    assert.equal(taskRefs.includes("caller-unpaid-receipt"), false);
    assert.equal(taskRefs.includes(bound.taskRef), true);
    const again = service(dataDir);
    const retrieved = await again.retrieve({
      taskLabel: "caller-unpaid-receipt",
      operationId: "read-unpaid-receipt",
      classification: "owner",
    });
    assert.equal(retrieved.found, true);
    assert.equal(retrieved.recomputed, true);
    assert.equal(retrieved.useful, "true");
    assert.equal(retrieved.executionSaved, false);
    assert.equal(retrieved.currentAuthority, false);
    assert.equal(retrieved.derived.code, "unpaid_receipt_readable");
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("retains failed, partial, and unavailable outcomes", async () => {
  const dataDir = dir();
  try {
    const api = service(dataDir);
    const failed = await api.bind(bindInput({
      taskLabel: "caller-failed",
      outcome: outcome({ disposition: "failed", code: "delivery_failed", httpStatus: 500 }),
    }));
    const partial = await api.bind(bindInput({
      taskLabel: "caller-partial",
      outcome: outcome({ disposition: "partial", code: "audit_incomplete", availability: "partial", httpStatus: 200 }),
    }));
    const unavailable = await api.bind(bindInput({
      taskLabel: "caller-unavailable",
      outcome: outcome({ disposition: "unavailable", code: "provider_unavailable", availability: "unavailable", httpStatus: null }),
    }));
    assert.equal(failed.qualification, "failed");
    assert.equal(failed.useful, "false");
    assert.equal(partial.qualification, "partial");
    assert.equal(partial.useful, "false");
    assert.equal(unavailable.qualification, "unavailable");
    assert.equal(unavailable.useful, "unknown");
    const kept = await api.retrieve({
      taskLabel: "caller-failed",
      operationId: "read-unpaid-receipt",
      classification: "owner",
    });
    assert.equal(kept.found, true);
    assert.equal(kept.usable, false);
    assert.equal(kept.qualification, "failed");
    assert.equal(kept.derived.code, "delivery_failed");
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("rejects identity labels, restricted outcome fields, and a forged digest-only success", async () => {
  const dataDir = dir();
  try {
    const api = service(dataDir);
    await assert.rejects(() => api.bind(bindInput({ taskLabel: "person@example.com" })), /task_label_rejected/);
    await assert.rejects(() => api.bind(bindInput({ taskLabel: `0x${"ab".repeat(20)}` })), /task_label_rejected/);
    await assert.rejects(() => api.bind(bindInput({ taskLabel: "https://example.com/prompt" })), /task_label_rejected/);
    await assert.rejects(() => api.bind(bindInput({ outcome: outcome({ wallet: "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee" }) })), /restricted_field/);
    const digestOnly = await api.bind(bindInput({
      taskLabel: "caller-digest-only",
      outcome: null,
      assertedDigest: "cd".repeat(32),
    }));
    assert.equal(digestOnly.qualification, "unavailable");
    assert.equal(digestOnly.useful, "unknown");
    assert.equal(digestOnly.assertedDigestMatches, false);
    const files = ["useful-result-private.ndjson", "commerce-outcome-task-ref.ndjson"];
    const written = files.map((name) => readFileSync(path.join(dataDir, name), "utf8")).join("\n");
    assert.equal(written.includes("person@example.com"), false);
    assert.equal(written.includes("wallet"), false);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("a wrong grant and a wrong task do not return the stored result", async () => {
  const dataDir = dir();
  try {
    const api = service(dataDir);
    await api.bind(bindInput());
    await assert.rejects(() => api.retrieve({
      taskLabel: "caller-unpaid-receipt",
      operationId: "read-unpaid-receipt",
      classification: "owner",
      suppliedToken: OTHER,
    }), /unauthorized/);
    const wrongTask = await api.retrieve({
      taskLabel: "other-task",
      operationId: "read-unpaid-receipt",
      classification: "owner",
    });
    assert.equal(wrongTask.found, false);
    const independent = await api.bind(bindInput({ taskLabel: "caller-independent", classification: "independent" }));
    assert.equal(independent.classification, "independent");
    const metrics = await api.metrics();
    assert.equal(metrics.independentRepeat, "unknown");
    assert.equal(metrics.coverage, "unknown_for_full_window");
    assert.equal(metrics.verified_settlement, 0);
    assert.equal(metrics.fetchIsNotAdoption, true);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("explicit share is allowlisted and a different later task cannot apply it", async () => {
  const dataDir = dir();
  try {
    const api = service(dataDir);
    const bound = await api.bind(bindInput());
    const shared = await api.share({
      taskLabel: "caller-unpaid-receipt",
      operationId: "read-unpaid-receipt",
      classification: "owner",
    });
    assert.equal(shared.accepted, true);
    const encoded = JSON.stringify(shared.share);
    assert.equal(encoded.includes("caller-unpaid-receipt"), false);
    assert.equal(encoded.includes(TOKEN), false);
    assert.equal(encoded.includes("@"), false);
    assert.equal(encoded.includes("://"), false);
    assert.equal(shared.share.license, "MIT");
    assert.equal(shared.share.source, "merchant-outcome-binding");
    assert.equal(shared.share.derived.code, "unpaid_receipt_readable");
    const same = await api.consume({
      shareId: shared.share.shareId,
      taskLabel: "caller-unpaid-receipt",
      operationId: "read-unpaid-receipt",
      classification: "owner",
      method: "GET",
      route: "/read",
      outcomeSchema: "samedaydesk.useful-result.v1",
      outcomeSchemaVersion: "1",
      sourceSha: shared.share.sourceSha,
    });
    assert.equal(same.applied, true);
    assert.equal(same.executionSaved, false);
    assert.equal(same.currentAuthority, false);
    assert.equal(same.paymentPermitted, false);
    const different = await api.consume({
      shareId: shared.share.shareId,
      taskLabel: "later-different-task",
      operationId: "read-unpaid-receipt",
      classification: "unknown",
      method: "GET",
      route: "/read",
      outcomeSchema: "samedaydesk.useful-result.v1",
      outcomeSchemaVersion: "1",
      sourceSha: shared.share.sourceSha,
    });
    assert.equal(different.applied, false);
    assert.equal(different.reason, "different_task");
    assert.equal(different.usefulTransferred, false);
    const changedRoute = await api.consume({
      shareId: shared.share.shareId,
      taskLabel: "caller-unpaid-receipt",
      operationId: "read-unpaid-receipt",
      classification: "owner",
      method: "GET",
      route: "/scan",
      outcomeSchema: "samedaydesk.useful-result.v1",
      outcomeSchemaVersion: "1",
      sourceSha: shared.share.sourceSha,
    });
    assert.equal(changedRoute.reason, "changed_route");
    const staleSource = await api.consume({
      shareId: shared.share.shareId,
      taskLabel: "caller-unpaid-receipt",
      operationId: "read-unpaid-receipt",
      classification: "owner",
      method: "GET",
      route: "/read",
      outcomeSchema: "samedaydesk.useful-result.v1",
      outcomeSchemaVersion: "1",
      sourceSha: "aa".repeat(32),
    });
    assert.equal(staleSource.reason, "source_changed");
    const corrected = await api.bind(bindInput({
      correctionOf: bound.recordId,
      outcome: outcome({ disposition: "failed", code: "delivery_failed", httpStatus: 500 }),
    }));
    assert.equal(corrected.qualification, "failed");
    const after = await api.consume({
      shareId: shared.share.shareId,
      taskLabel: "caller-unpaid-receipt",
      operationId: "read-unpaid-receipt",
      classification: "owner",
      method: "GET",
      route: "/read",
      outcomeSchema: "samedaydesk.useful-result.v1",
      outcomeSchemaVersion: "1",
      sourceSha: shared.share.sourceSha,
    });
    assert.equal(after.applied, false);
    assert.equal(after.reason, "corrected");
    assert.equal(after.correctedQualification, "failed");
    assert.equal(after.applyPrior, false);
    const during = await api.current({ limit: 10 });
    assert.equal(during.items.some((item) => item.shareId === shared.share.shareId), false);
    await api.revoke({
      taskLabel: "caller-unpaid-receipt",
      operationId: "read-unpaid-receipt",
      classification: "owner",
      share: true,
    });
    const revoked = await api.retrieve({
      taskLabel: "caller-unpaid-receipt",
      operationId: "read-unpaid-receipt",
      classification: "owner",
    });
    assert.equal(revoked.reason, "revoked");
    assert.equal(revoked.derived, null);
    const page = await api.current({ limit: 10 });
    assert.equal(page.items.some((item) => item.shareId === shared.share.shareId), false);
    assert.equal(page.independentAdoption, "unknown");
    assert.equal(page.recognizedRevenueAtomic, "0");
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("changed schema, a useful negative, and a stored decision bit do not grant authority", async () => {
  const dataDir = dir();
  try {
    const api = service(dataDir);
    await api.bind(bindInput({
      taskLabel: "caller-negative",
      outcome: outcome({ disposition: "failed", code: "delivery_failed", httpStatus: 500 }),
    }));
    const shared = await api.share({
      taskLabel: "caller-negative",
      operationId: "read-unpaid-receipt",
      classification: "owner",
    });
    const negative = await api.consume({
      shareId: shared.share.shareId,
      taskLabel: "caller-negative",
      operationId: "read-unpaid-receipt",
      classification: "owner",
      method: "GET",
      route: "/read",
      outcomeSchema: "samedaydesk.useful-result.v1",
      outcomeSchemaVersion: "1",
      sourceSha: shared.share.sourceSha,
      storedDecisionBit: true,
    });
    assert.equal(negative.applied, false);
    assert.equal(negative.reason, "useful_negative");
    assert.equal(negative.retained, true);
    assert.equal(negative.currentAuthority, false);
    assert.equal(negative.executionSaved, false);
    const changedSchema = await api.consume({
      shareId: shared.share.shareId,
      taskLabel: "caller-negative",
      operationId: "read-unpaid-receipt",
      classification: "owner",
      method: "GET",
      route: "/read",
      outcomeSchema: "samedaydesk.useful-result.v1",
      outcomeSchemaVersion: "2",
      sourceSha: shared.share.sourceSha,
    });
    assert.equal(changedSchema.reason, "changed_schema");
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("free baseline blocks a paid recommendation, and an unmet receipt names the existing route", () => {
  const challenge = selectExistingPaidOperation({
    name: "protocol_challenge_fields",
    freeBaseline: {
      kind: "payment_required",
      httpStatus: 402,
      body: { x402Version: 2, error: "PAYMENT-REQUIRED", resource: {}, accepts: [{ scheme: "exact" }], extensions: {} },
    },
  });
  assert.equal(challenge.freeSufficient, true);
  assert.equal(challenge.offeredOperation, null);
  assert.equal(challenge.purchaseAuthorized, false);
  assert.equal(challenge.paymentSent, false);
  assert.equal(challenge.newSku, false);
  const fromAuditName = selectExistingPaidOperation({
    name: "seller_contract_decision",
    freeBaseline: {
      kind: "payment_required",
      body: { x402Version: 2, accepts: [{ scheme: "exact" }] },
    },
  });
  assert.equal(fromAuditName.offeredOperation, null);
  assert.equal(fromAuditName.reason, "challenge_fields_are_not_an_audit_gap");
  const download = selectExistingPaidOperation({
    name: "seller_contract_decision",
    freeBaseline: { kind: "download", method: "HEAD", httpStatus: 200 },
  });
  assert.equal(download.reason, "download_is_not_a_purchase");
  const digest = selectExistingPaidOperation({
    name: "asserted_digest",
    freeBaseline: { kind: "asserted_digest", digest: "ab".repeat(32) },
  });
  assert.equal(digest.reason, "digest_is_not_delivery");
  assert.equal(digest.offeredOperation, null);
  const sufficient = selectExistingPaidOperation({
    name: "seller_contract_decision",
    freeBaseline: {
      report: {
        schemaVersion: "samedaydesk.discovery-drift-report.v1",
        product: "samedaydesk-discovery-drift",
        status: "match",
        observedMatch: true,
        resolvedCause: false,
        catalog: { resource: "https://example.com/extract" },
        live: { resource: "https://example.com/extract" },
        dimensions: [],
        unknowns: [],
      },
    },
  });
  assert.equal(sufficient.offeredOperation, null);
  assert.equal(sufficient.freeSufficient, true);
  assert.equal(JSON.stringify(sufficient).includes("example.com"), false);
  const unmet = selectExistingPaidOperation({
    name: "seller_contract_decision",
    freeBaseline: {
      report: {
        schemaVersion: "samedaydesk.discovery-drift-report.v1",
        product: "samedaydesk-discovery-drift",
        status: "mismatch",
        observedMatch: false,
        resolvedCause: false,
        catalog: { resource: "https://example.com/extract" },
        live: { resource: "https://example.com/extract" },
        dimensions: [{ dimension: "resource", disposition: "drifted", catalog: "catalog", live: "live" }],
        unknowns: [],
      },
    },
  });
  assert.equal(unmet.offeredOperation.route, "/commerce/seller-integrity-audit");
  assert.equal(unmet.offeredOperation.method, "GET");
  assert.equal(unmet.purchaseAuthorized, false);
  assert.equal(unmet.requestConstructed, false);
  assert.equal(unmet.replayBoundary, "idempotency-replay");
  assert.equal(JSON.stringify(unmet).includes("example.com"), false);
  const sponsored = selectExistingPaidOperation({
    name: "normalized_transaction_receipt",
    freeBaseline: { txReference: CLOSED_SPONSORED_REF, hasNormalizedReceipt: false },
  });
  assert.equal(sponsored.offeredOperation, null);
  assert.equal(sponsored.reason, "closed_sponsored_reference");
  assert.equal(JSON.stringify(sponsored).includes(CLOSED_SPONSORED_REF), false);
  const receipt = selectExistingPaidOperation({
    name: "normalized_transaction_receipt",
    freeBaseline: { txReference: `0x${"1".repeat(64)}`, hasNormalizedReceipt: false },
  });
  assert.equal(receipt.offeredOperation.route, "/chain/transaction-receipt");
  assert.equal(receipt.offeredOperation.documentedFields.includes("transaction.transactionFeeWei"), true);
  assert.equal(receipt.purchaseAuthorized, false);
  assert.equal(JSON.stringify(receipt).includes(`0x${"1".repeat(64)}`), false);
  const already = selectExistingPaidOperation({
    name: "normalized_transaction_receipt",
    freeBaseline: {
      txReference: `0x${"2".repeat(64)}`,
      body: {
        product: "samedaydesk-transaction-receipt",
        decision: "found",
        transaction: { status: "success" },
      },
    },
  });
  assert.equal(already.freeSufficient, true);
  assert.equal(already.offeredOperation, null);
});

test("parallel writers, restart, symlink, fifo, sparse, and rotation stay bounded", async () => {
  const dataDir = dir();
  try {
    const api = service(dataDir);
    const results = await Promise.all(Array.from({ length: 6 }, (_, index) => api.bind(bindInput({
      taskLabel: `caller-parallel-${index}`,
    }))));
    assert.equal(results.every((item) => item.accepted), true);
    const lines = readFileSync(path.join(dataDir, "useful-result-private.ndjson"), "utf8").trim().split("\n");
    assert.equal(lines.length, 6);
    for (const line of lines) JSON.parse(line);
    const restarted = service(dataDir);
    const retrieved = await restarted.retrieve({
      taskLabel: "caller-parallel-3",
      operationId: "read-unpaid-receipt",
      classification: "owner",
    });
    assert.equal(retrieved.derived.code, "unpaid_receipt_readable");
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }

  const linked = dir();
  try {
    const target = path.join(linked, "elsewhere.ndjson");
    writeFileSync(target, "");
    symlinkSync(target, path.join(linked, "useful-result-private.ndjson"));
    const api = service(linked);
    await assert.rejects(() => api.bind(bindInput()), /symlink/);
  } finally {
    rmSync(linked, { recursive: true, force: true });
  }

  const fifo = dir();
  try {
    execFileSync("mkfifo", [path.join(fifo, "useful-result-private.ndjson")]);
    const store = createReuseStore({ dataDir: fifo });
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { createReuseStore } from ${JSON.stringify(path.join(root, "useful-result-reuse/store.mjs"))};
      const store = createReuseStore({ dataDir: process.argv[1] });
      await store.read("useful-result-private.ndjson");
    `, fifo], { timeout: 3000, encoding: "utf8" });
    assert.equal(child.status, 1, child.stderr);
    assert.match(child.stderr, /fifo/);
    await assert.rejects(() => store.read("useful-result-private.ndjson"), /fifo/);
  } finally {
    rmSync(fifo, { recursive: true, force: true });
  }

  const sparse = dir();
  try {
    const file = path.join(sparse, "useful-result-private.ndjson");
    writeFileSync(file, "");
    truncateSync(file, 8 * 1024 * 1024);
    const store = createReuseStore({ dataDir: sparse });
    await assert.rejects(() => store.read("useful-result-private.ndjson"), /bounds/);
  } finally {
    rmSync(sparse, { recursive: true, force: true });
  }

  const rotating = dir();
  try {
    const store = createReuseStore({ dataDir: rotating, maxFileBytes: 1 });
    const api = createUsefulResultReuse({
      dataDir: rotating,
      internalToken: TOKEN,
      now: () => Date.parse("2026-10-01T12:00:00.000Z"),
      store,
    });
    const ids = [];
    for (let index = 0; index < 3; index += 1) {
      const bound = await api.bind(bindInput({ taskLabel: `caller-rotate-${index}` }));
      ids.push(bound.recordId);
    }
    const kept = readFileSync(path.join(rotating, "useful-result-private.ndjson"), "utf8")
      + readFileSync(path.join(rotating, "useful-result-private.1.ndjson"), "utf8");
    assert.equal(kept.includes(ids[0]), false);
    assert.equal(kept.includes(ids[2]), true);
  } finally {
    rmSync(rotating, { recursive: true, force: true });
  }
});

test("seeded forged success is refused and forward retained-use stays unbound", async () => {
  const seeded = spawnSync(process.execPath, [
    "useful-result-reuse/cli.mjs",
    "reject-seeded",
    "useful-result-reuse/fixtures/seeded-forged-success.json",
  ], { cwd: root, encoding: "utf8" });
  assert.equal(seeded.status, 0, seeded.stderr);
  const body = JSON.parse(seeded.stdout);
  assert.equal(body.refused, true);
  assert.equal(body.reasons.includes("restricted_field"), true);
  assert.equal(body.reasons.includes("digest_not_delivery"), true);
  const dataDir = dir();
  try {
    const { createForwardOutcomeWriter } = await import("./commerce-outcome-binding.mjs");
    const writer = createForwardOutcomeWriter({ dataDir, internalToken: TOKEN });
    const noted = await writer.observeRetainedUse({
      internalToken: TOKEN,
      operationId: "read-unpaid-receipt",
      receiptDigest: "ab".repeat(32),
    });
    assert.equal(noted.accepted, false);
    assert.equal(noted.reason, "unbound_artifact");
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("current page refuses an unknown cursor and metrics separate exposure from adoption", async () => {
  const dataDir = dir();
  try {
    const api = service(dataDir);
    await api.bind(bindInput());
    await api.share({
      taskLabel: "caller-unpaid-receipt",
      operationId: "read-unpaid-receipt",
      classification: "owner",
    });
    await api.noteExposure();
    const metrics = await api.metrics();
    assert.equal(metrics.exposure, 1);
    assert.ok(metrics.useful_result_received >= 1);
    assert.ok(metrics.scoped_reuse >= 1);
    assert.equal(metrics.valid_delivery, 1);
    assert.equal(metrics.paid_attempt, 0);
    assert.equal(metrics.independentRepeat, "unknown");
    const page = await api.current({ limit: 1 });
    assert.equal(page.items.length, 1);
    await assert.rejects(() => api.current({ limit: 1, cursor: "missing" }), /page_rejected/);
    const noted = await api.notePaidAttempt({ purchaseAuthorized: false, paymentSent: false });
    assert.equal(noted.accepted, false);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
