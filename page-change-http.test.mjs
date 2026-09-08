import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { comparePageBatches } from "./examples/customer-x402/src/page-change/compare.mjs";
import {
  PAGE_CHANGE_HTTP_PATH,
  admitPageChangeRequest,
  isPageChangeHttpEnabled,
  isPageChangeHttpPath,
  ownedPageChangeWorkerCount,
  pageChangeHttpHealth,
  pageChangeHttpLimits,
  pageChangeHttpOpenApiExample,
  reapPageChangeWorker,
  runPageChangeCompare,
  xagentVerification,
  PageChangeHttpError,
} from "./page-change-http.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const fx = (...parts) => join(root, "examples/customer-x402/fixtures/page-change", ...parts);
const load = (...parts) => JSON.parse(readFileSync(fx(...parts), "utf8"));
const wrap = (body, observedAt) => ({
  mediaType: "application/json",
  body,
  ...(observedAt ? { observedAt } : {}),
});

const expectedVerdicts = {
  unchanged_pages: "unchanged",
  changed_selected_fields: "changed",
  row_reorder: "reordered",
  duplicate_urls: "unchanged",
  missing_requested_field: "incomplete",
  failed_fetch: "incomplete",
  partial_batch: "changed",
  differing_requested_fields: "incomplete",
  unknown_observation_freshness: "unchanged",
};

function serverLimits() {
  return pageChangeHttpLimits({});
}

test("companion is disabled unless an explicit enable flag is set", () => {
  assert.equal(isPageChangeHttpEnabled({}), false);
  assert.equal(isPageChangeHttpEnabled({ PAGE_CHANGE_HTTP_ENABLED: "0" }), false);
  assert.equal(isPageChangeHttpEnabled({ PAGE_CHANGE_HTTP_ENABLED: "1" }), true);
  assert.equal(isPageChangeHttpPath(PAGE_CHANGE_HTTP_PATH), true);
  assert.equal(isPageChangeHttpPath("/extract"), false);
});

test("health omits commit when disabled or provenance is missing/invalid", () => {
  const disabled = pageChangeHttpHealth({});
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.error, "page_change_http_disabled");
  assert.equal(Object.hasOwn(disabled, "commit"), false);
  const missing = pageChangeHttpHealth({ PAGE_CHANGE_HTTP_ENABLED: "1" });
  assert.equal(missing.status, "ok");
  assert.equal(missing.commit, null);
  assert.equal(missing.commitStatus, "unavailable");
  assert.equal(missing.reason, "missing_source_commit");
  const invalid = pageChangeHttpHealth({
    PAGE_CHANGE_HTTP_ENABLED: "1",
    PAGE_CHANGE_SOURCE_COMMIT: "not-a-commit",
  });
  assert.equal(invalid.commitStatus, "unavailable");
  assert.equal(invalid.reason, "invalid_source_commit");
  const pin = "e0daf4d9a9e775a8180ae0aa9bee351c10b850c8";
  const ok = pageChangeHttpHealth({
    PAGE_CHANGE_HTTP_ENABLED: "1",
    PAGE_CHANGE_SOURCE_COMMIT: pin,
  });
  assert.equal(ok.commit, pin);
  assert.equal(ok.commitStatus, "available");
});

test("xagent proof is unavailable unless slug and exact commit are configured", () => {
  assert.equal(xagentVerification({ PAGE_CHANGE_HTTP_ENABLED: "1" }).error, "xagent_verification_unavailable");
  assert.equal(xagentVerification({
    PAGE_CHANGE_HTTP_ENABLED: "1",
    PAGE_CHANGE_XAGENT_SLUG: "samedaydesk-page-change",
    PAGE_CHANGE_XAGENT_COMMIT: "deadbeef",
  }).error, "xagent_verification_unavailable");
  const pin = "e0daf4d9a9e775a8180ae0aa9bee351c10b850c8";
  const proof = xagentVerification({
    PAGE_CHANGE_HTTP_ENABLED: "1",
    PAGE_CHANGE_XAGENT_SLUG: "samedaydesk-page-change",
    PAGE_CHANGE_SOURCE_COMMIT: pin,
  });
  assert.equal(proof.schemaVersion, 1);
  assert.equal(proof.slug, "samedaydesk-page-change");
  assert.equal(proof.commit, pin);
});

test("operator env can only tighten server ceilings", () => {
  assert.equal(pageChangeHttpLimits({}).maxBytes, 131072);
  assert.equal(pageChangeHttpLimits({ PAGE_CHANGE_HTTP_MAX_BYTES: "4096" }).maxBytes, 4096);
  assert.throws(() => pageChangeHttpLimits({ PAGE_CHANGE_HTTP_MAX_BYTES: "999999" }), /1 through 131072/);
  assert.throws(() => pageChangeHttpLimits({ PAGE_CHANGE_HTTP_TIMEOUT_MS: "0" }), /1 through 5000/);
  assert.throws(() => pageChangeHttpLimits({ PAGE_CHANGE_HTTP_MAX_CONCURRENT: "3" }), /1 through 2/);
});

test("caller timestamps and flags cannot establish fresh or current observations", async () => {
  const artifact = load("merchant", "unchanged-before.json");
  const request = { before: wrap(artifact, "2026-09-08T12:00:00Z"), after: wrap(artifact, "2026-09-08T12:00:01Z"), fields: ["title"], clock: "2026-09-08T12:00:02Z", maxStaleMs: 10000 };
  assert.throws(() => admitPageChangeRequest({ ...request, allowFreshClaim: true }, serverLimits()), /cannot establish freshness/);
  const report = await runPageChangeCompare(admitPageChangeRequest(request, serverLimits()));
  assert.equal(report.claims.fresh, false);
  assert.equal(report.claims.current, false);
  assert.equal(report.snapshot.claims.fresh, false);
});

test("proof cannot diverge from health source commit", () => {
  const env = { PAGE_CHANGE_HTTP_ENABLED: "1", PAGE_CHANGE_SOURCE_COMMIT: "a".repeat(40), PAGE_CHANGE_XAGENT_COMMIT: "b".repeat(40), PAGE_CHANGE_XAGENT_SLUG: "samedaydesk-page-change" };
  assert.equal(xagentVerification(env).error, "xagent_verification_unavailable");
  assert.equal(xagentVerification({ ...env, PAGE_CHANGE_XAGENT_COMMIT: "a".repeat(40), PAGE_CHANGE_XAGENT_SLUG: "bad slug" }).error, "xagent_verification_unavailable");
});

test("pre-aborted calls do not spawn and capacity rejects before another worker", async () => {
  const artifact = load("merchant", "unchanged-before.json");
  const job = admitPageChangeRequest({ before: artifact, after: artifact, fields: ["title"] }, serverLimits());
  await assert.rejects(runPageChangeCompare(job, { abortSignal: AbortSignal.abort() }), /aborted/);
  assert.equal(ownedPageChangeWorkerCount(), 0);
  const controller = new AbortController();
  const env = { PAGE_CHANGE_HTTP_MAX_CONCURRENT: "1", PAGE_CHANGE_HTTP_WORKER_PATH: join(root, "page-change-http-sleep-worker.mjs") };
  const first = runPageChangeCompare(job, { env, abortSignal: controller.signal });
  const expectedAbort = assert.rejects(first, /aborted/);
  assert.equal(ownedPageChangeWorkerCount(), 1);
  await assert.rejects(runPageChangeCompare(job, { env }), (error) => error.code === "page_change_busy");
  controller.abort();
  await expectedAbort;
  assert.equal(ownedPageChangeWorkerCount(), 0);
});

test("admission rejects paths, fetches, extra keys, and caller-raised limits", () => {
  const limits = serverLimits();
  const artifact = load("merchant", "unchanged-before.json");
  assert.throws(() => admitPageChangeRequest({
    before: fx("merchant", "unchanged-before.json"),
    after: artifact,
    fields: ["title"],
  }, limits), /filesystem path/);
  assert.throws(() => admitPageChangeRequest({
    before: { path: "/tmp/secret.json" },
    after: artifact,
    fields: ["title"],
  }, limits), /filesystem/);
  assert.throws(() => admitPageChangeRequest({
    before: { url: "https://example.com/" },
    after: artifact,
    fields: ["title"],
  }, limits), /URL dereference/);
  assert.throws(() => admitPageChangeRequest({
    before: artifact,
    after: artifact,
    fields: ["title"],
    limits: { maxBytes: 999999 },
  }, limits), /cannot raise/);
  assert.throws(() => admitPageChangeRequest({
    before: artifact,
    after: artifact,
    fields: ["title"],
    maxBytes: 999999,
  }, limits), /cannot raise/);
  assert.throws(() => admitPageChangeRequest({
    before: artifact,
    after: artifact,
    fields: ["title"],
    timeoutMs: 60_000,
  }, limits), /cannot raise/);
  assert.throws(() => admitPageChangeRequest({
    before: artifact,
    after: artifact,
    fields: ["title"],
    eval: "1+1",
  }, limits), /unexpected field/);
  const admitted = admitPageChangeRequest({
    before: wrap(artifact),
    after: wrap(artifact),
    fields: ["title", "description"],
    clock: "2026-09-08T12:00:00.000Z",
    maxStaleMs: 86_400_000,
  }, limits);
  assert.equal(admitted.limits.maxBytes, limits.maxBytes);
  assert.equal(admitted.limits.maxStaleMs, 86_400_000);
  assert.equal(admitted.before.source.path, null);
});

test("customer RFQ job over comparePageBatches matches the HTTP-admitted worker", async () => {
  const before = load("customer-job", "before.json");
  const after = load("customer-job", "after.json");
  const fields = ["title", "description", "headings"];
  const direct = await comparePageBatches(wrap(before), wrap(after), { fields });
  const job = admitPageChangeRequest({ before, after, fields }, serverLimits());
  const viaWorker = await runPageChangeCompare(job);
  assert.equal(ownedPageChangeWorkerCount(), 0);
  assert.equal(viaWorker.verdict, direct.verdict);
  assert.equal(viaWorker.kind, "merchant_extract_batch");
  assert.equal(viaWorker.verdict, "changed");
  assert.equal(viaWorker.claims.paymentImpliesUsefulOutput, false);
  assert.equal(viaWorker.summary.failed, direct.summary.failed);
  assert.equal(viaWorker.summary.semantic, direct.summary.semantic);
  assert.ok(viaWorker.rows.failed.some((row) => String(row.sourceKey).includes("fasteners")));
  assert.ok(viaWorker.coverageUnknown.some((item) => item.field === "description"));
});

for (const entry of load("w5-corpus", "manifest.json").cases) {
  test(`W5 composition via admitted worker: ${entry.kind}`, async () => {
    const expected = load("w5-corpus", "cases", entry.case_id, "expected.json");
    const before = load("w5-corpus", "cases", entry.case_id, "observation-before.json");
    const after = load("w5-corpus", "cases", entry.case_id, "observation-after.json");
    const job = admitPageChangeRequest({
      before,
      after,
      fields: expected.buyer_owned_dependent_fields,
    }, serverLimits());
    const report = await runPageChangeCompare(job);
    const direct = await comparePageBatches(job.before, job.after, { fields: job.fields, clock: null, allowFreshClaim: false, limits: job.limits });
    // Elapsed wall time is intentionally nondeterministic; every other C31
    // report field, including its provenance digest, must survive the adapter.
    const stable = (value) => JSON.parse(JSON.stringify(value, (key, item) => key === "elapsedMs" ? undefined : item));
    assert.deepEqual(stable(report), stable(direct));
    assert.equal(report.verdict, expectedVerdicts[entry.kind]);
    assert.equal(report.freshness, "unknown");
    assert.equal(report.claims.fresh, false);
  });
}

test("duplicate active URLs stay ambiguous over the worker", async () => {
  const artifact = load("merchant", "duplicate-active.json");
  const job = admitPageChangeRequest({ before: artifact, after: artifact, fields: ["title"] }, serverLimits());
  const report = await runPageChangeCompare(job);
  assert.equal(report.verdict, "ambiguous");
  assert.ok(report.rows.duplicates.length);
});

test("reordered equal fields are order, not content change", async () => {
  const job = admitPageChangeRequest({
    before: load("merchant", "unchanged-before.json"),
    after: load("merchant", "reordered-after.json"),
    fields: ["title", "description"],
  }, serverLimits());
  const report = await runPageChangeCompare(job);
  assert.equal(report.verdict, "reordered");
  assert.equal(report.claims.contentUnchangedProven, true);
  assert.equal(report.summary.semantic, 0);
});

test("timeout reaps the owned worker", { timeout: 10_000 }, async () => {
  const artifact = load("merchant", "unchanged-before.json");
  const job = admitPageChangeRequest({ before: artifact, after: artifact, fields: ["title"] }, serverLimits());
  await assert.rejects(
    () => runPageChangeCompare(job, {
      env: {
        PAGE_CHANGE_HTTP_WORKER_PATH: join(root, "page-change-http-sleep-worker.mjs"),
        PAGE_CHANGE_HTTP_TIMEOUT_MS: "80",
      },
      timeoutMs: 80,
    }),
    (error) => error instanceof PageChangeHttpError && error.code === "compare_timeout" && error.status === 408,
  );
  await delay(200);
  assert.equal(ownedPageChangeWorkerCount(), 0);
});

test("abort reaps the owned worker", { timeout: 10_000 }, async () => {
  const artifact = load("merchant", "unchanged-before.json");
  const job = admitPageChangeRequest({ before: artifact, after: artifact, fields: ["title"] }, serverLimits());
  const abort = new AbortController();
  const pending = runPageChangeCompare(job, {
    env: { PAGE_CHANGE_HTTP_WORKER_PATH: join(root, "page-change-http-sleep-worker.mjs") },
    abortSignal: abort.signal,
    timeoutMs: 5_000,
  });
  await delay(40);
  abort.abort();
  await assert.rejects(pending, (error) => error instanceof PageChangeHttpError && error.code === "request_aborted");
  await delay(200);
  assert.equal(ownedPageChangeWorkerCount(), 0);
});

test("sidecar refuses to run without the official validator pin", () => {
  const result = spawnSync(process.execPath, [join(root, "scripts/page-change-xagent-sidecar.mjs")], {
    env: { ...process.env, XAGT_PLUGIN_ROOT: "" },
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /XAGT_PLUGIN_ROOT/);
});

test("compact OpenAPI example is unpaid and not a catalog expansion", () => {
  const spec = pageChangeHttpOpenApiExample();
  assert.equal(spec.paths[PAGE_CHANGE_HTTP_PATH].post.operationId, "postRecipesPageChange");
  assert.match(spec.info.description, /Not a paid SKU/);
  assert.equal(Object.keys(spec.paths).length, 2);
});

test("reap is a no-op for an already-exited child", async () => {
  await reapPageChangeWorker({ exitCode: 0, signalCode: null, kill() { throw new Error("should not kill"); } });
});
