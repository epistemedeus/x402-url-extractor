import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import https from "node:https";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { digestValue } from "../extraction-contract/digest.mjs";
import { reconcileAcceptedCapture } from "../reconcile/fee.mjs";
import { E08_PIN, handExtractionToE08, loadUnchangedE08, materializeE08 } from "../seam/e08-pin.mjs";
import { SCHEMA } from "../extraction-contract/store.mjs";
import { ACTOR, TENANT, cannedExtract, repoRoot, withService, writerRoot } from "../support/helpers.mjs";

const PRODUCTION = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

function durableCapture(stored) {
  return {
    state: stored.capture?.state,
    finality: stored.capture?.finality,
    bound: stored.capture?.bound,
    gross: stored.quote?.gross,
    platformFee: stored.quote?.platformFee,
    contributorNet: stored.quote?.contributorNet,
    railCost: stored.quote?.rail?.costCap,
    acceptedDigest: stored.output?.digest,
  };
}

async function localCert(dir) {
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"),
    "-days", "1", "-nodes", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ], { stdio: "ignore" });
  return {
    key: await readFile(join(dir, "key.pem")),
    cert: await readFile(join(dir, "cert.pem")),
  };
}

test("unchanged E08 accepts one extraction artifact and reuse does not capture again", async (t) => {
  const materialized = await materializeE08({ repoRoot, pgModule: join(writerRoot, "node_modules/pg") });
  t.after(() => rm(materialized.root.split("/experiments/")[0], { recursive: true, force: true }).catch(() => {}));
  assert.equal(materialized.pin, E08_PIN);
  assert.ok(materialized.files > 10);
  const e08 = await loadUnchangedE08(materialized.root);
  const ctx = await e08.setupService();
  t.after(() => ctx.close());
  const refused = await ctx.service.openJob(e08.actors().requester, {
    ...e08.parties, termsVersion: "221400", gross: "20", expiresAt: e08.future(),
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "legacy_terms_unchanged");
  assert.equal(refused.repriced, false);
  const { service } = await withService(t, { extract: cannedExtract("Seam title") });
  const job = await service.submit({ tenantId: TENANT, actorId: ACTOR, url: "https://ok.example/" });
  await service.pump();
  const view = await service.read({ tenantId: TENANT, jobId: job.jobId });
  assert.equal(view.artifact.kind, "repair");
  assert.equal(view.artifact.digest, digestValue({ kind: view.artifact.kind, body: view.artifact.body }));
  const handed = await handExtractionToE08(e08, ctx, view.artifact);
  assert.equal(handed.stored.output.digest, view.artifact.digest);
  assert.equal(handed.stored.quote.gross, "105263");
  assert.equal(handed.stored.quote.platformFee, "5263");
  assert.equal(handed.stored.quote.contributorNet, "100000");
  assert.equal(handed.stored.quote.rail.costCap, "0");
  assert.notEqual(handed.stored.quote.asset.token, PRODUCTION);
  assert.equal(handed.stored.quote.termsVersion, "e08-async-v1");
  assert.equal(handed.accepted.usefulWork, true);
  assert.equal(handed.accepted.paymentCompleted, false);
  assert.equal(handed.accepted.acceptedSettled, false);
  assert.equal(handed.accepted.fundedAcceptance, false);
  assert.equal(handed.acceptedAgain.replayed, true);
  assert.equal(handed.port.invocations, 1);
  assert.equal(handed.portAfter.invocations, 1);
  assert.equal(handed.port.lastFeeAmount, "5263");
  assert.equal(handed.reused.newPayment, false);
  assert.equal(handed.reused.paidTaskCountDelta, 0);
  assert.equal(handed.reused.artifact.digest, view.artifact.digest);
  const verdict = reconcileAcceptedCapture({
    acceptedDigest: handed.stored.output.digest,
    capture: durableCapture(handed.stored),
    port: { invocations: handed.port.invocations, lastFeeAmount: handed.port.lastFeeAmount },
  });
  assert.equal(verdict.status, "matched");
  const mismatch = reconcileAcceptedCapture({
    acceptedDigest: handed.stored.output.digest,
    capture: durableCapture(handed.stored),
    port: { invocations: 2, lastFeeAmount: "5263" },
  });
  assert.equal(mismatch.status, "unknown");
  const recorded = await service.recordVerdict({
    tenantId: TENANT, jobId: view.jobId, acceptedDigest: handed.stored.output.digest, verdict,
  });
  const unknown = await service.recordVerdict({
    tenantId: TENANT, jobId: view.jobId, acceptedDigest: handed.stored.output.digest, verdict: mismatch,
  });
  assert.equal(unknown.storedStatus, "unknown");
  const rows = await service.pool.query(
    `SELECT status, accepted_digest FROM ${SCHEMA}.capture_verdict WHERE verdict_id IN ($1, $2) ORDER BY status`,
    [recorded.verdictId, unknown.verdictId],
  );
  assert.deepEqual(rows.rows.map((row) => row.status), ["matched", "unknown"]);
  assert.equal(rows.rows[0].accepted_digest, handed.stored.output.digest);
});

test("a late callback is reconciled without a second capture", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "ae19-cb-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { key, cert } = await localCert(dir);
  let allowAck = false;
  let hits = 0;
  const server = https.createServer({ key, cert }, (req, res) => {
    hits += 1;
    if (!allowAck) {
      res.writeHead(503);
      res.end("later");
      return;
    }
    res.writeHead(204);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const materialized = await materializeE08({ repoRoot, pgModule: join(writerRoot, "node_modules/pg") });
  t.after(() => rm(materialized.root.split("/experiments/")[0], { recursive: true, force: true }).catch(() => {}));
  const e08 = await loadUnchangedE08(materialized.root);
  const ctx = await e08.setupService({ callbackCa: cert });
  t.after(() => ctx.close());
  const funded = await e08.fund(ctx, {
    gross: "20",
    jobExtras: { callbackUrl: `https://127.0.0.1:${port}/cb` },
  });
  const artifact = { kind: "no_fit", body: "no compatible route", digest: digestValue({ kind: "no_fit", body: "no compatible route" }) };
  await ctx.service.deliverOutput(e08.actors().worker, funded.opened.jobId, artifact);
  const before = await ctx.journal.read(funded.opened.jobId);
  assert.equal(before.callback.acked, false);
  assert.equal(before.callback.attempts, 1);
  const accepted = await ctx.service.accept(e08.actors().reviewer, funded.opened.jobId, { artifactDigest: artifact.digest });
  assert.equal(accepted.callback.authority, false);
  assert.equal(accepted.callback.acked, false);
  assert.equal((await ctx.port.load(funded.proofId)).invocations, 1);
  allowAck = true;
  const restarted = new e08.AsyncDeliveryService({ journal: ctx.journal, port: ctx.port, callbackCa: cert });
  await restarted.resumeCallbacks();
  const after = await ctx.journal.read(funded.opened.jobId);
  assert.equal(after.callback.acked, true);
  assert.ok(after.callback.attempts >= 2);
  assert.equal((await ctx.port.load(funded.proofId)).invocations, 1);
  const again = await ctx.service.accept(e08.actors().reviewer, funded.opened.jobId, { artifactDigest: artifact.digest });
  assert.equal(again.replayed, true);
  assert.equal((await ctx.port.load(funded.proofId)).invocations, 1);
  assert.equal(hits >= 2, true);
  const reused = await ctx.service.reuse(e08.actors().later, funded.opened.jobId);
  assert.equal(reused.newPayment, false);
  assert.equal(reused.paidTaskCountDelta, 0);
});
