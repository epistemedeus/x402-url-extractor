import { randomBytes } from "node:crypto";
import { createDisposableDatabase, dropDisposableDatabase, PgJournal, poolFor } from "../src/journal.mjs";
import { STAND_IN_LABEL, StandInPort } from "../src/stand-in-port.mjs";
import { AsyncDeliveryService } from "../src/service.mjs";

export const parties = Object.freeze({
  tenantId: "tenant-a",
  requesterId: "requester-a",
  evaluatorId: "reviewer-a",
  contributorId: "worker-a",
  payoutDestination: "payout-a",
  fundingAuthorityId: "fund-auth-a",
  settlementAuthorityId: "settle-auth-a",
  fundingTarget: "escrow-local-a",
  feeRecipient: "0x1111111111111111111111111111111111111111",
  rightsTermsRef: "rights-a",
  termsVersion: "e08-async-v1",
  asset: Object.freeze({
    chain: "eip155:31337",
    token: "0x2222222222222222222222222222222222222222",
    decimals: 6,
    symbol: "USDC",
  }),
});

export function actors() {
  return {
    requester: { tenantId: parties.tenantId, actorId: parties.requesterId, role: "requester" },
    reviewer: { tenantId: parties.tenantId, actorId: parties.evaluatorId, role: "evaluator" },
    worker: { tenantId: parties.tenantId, actorId: parties.contributorId, role: "contributor" },
    later: { tenantId: parties.tenantId, actorId: "later-a", role: "later-consumer" },
    other: { tenantId: "tenant-b", actorId: parties.requesterId, role: "requester" },
  };
}

export function future(ms = 3_600_000) {
  return new Date(Date.now() + ms).toISOString();
}

export async function setupService(options = {}) {
  const database = `ae14e08_${randomBytes(8).toString("hex")}`;
  await createDisposableDatabase(database);
  const pool = poolFor(database);
  const journal = new PgJournal(pool);
  const port = new StandInPort(pool, { authorityId: options.authorityId ?? parties.fundingAuthorityId });
  await journal.migrate();
  await port.migrate();
  const service = new AsyncDeliveryService({ journal, port, ...options });
  return {
    database,
    pool,
    journal,
    port,
    service,
    async reset() {
      await pool.query("TRUNCATE ae14_async_job, ae14_async_receipt, ae14_async_standin");
    },
    async close() {
      await pool.end();
      await dropDisposableDatabase(database);
    },
  };
}

export async function fund(ctx, { gross = "20", stage = "confirmed_usable", proofExtras = {}, jobExtras = {} } = {}) {
  const who = actors();
  const opened = await ctx.service.openJob(who.requester, {
    ...parties,
    gross,
    expiresAt: future(),
    ...jobExtras,
  });
  const record = await ctx.journal.read(opened.jobId);
  const proofId = `proof${opened.jobId}`;
  await ctx.port.put({
    proofId,
    qualification: STAND_IN_LABEL,
    provenance: "fake",
    stage,
    finalityRef: stage === "confirmed_usable" ? "local:final:1" : null,
    tenantId: record.quote.tenantId,
    allocationId: record.quote.canonicalTaskId,
    quoteId: record.quote.quoteId,
    taskId: record.quote.taskId,
    requesterId: record.quote.requesterId,
    fundingAuthorityId: record.quote.fundingAuthorityId,
    asset: record.quote.asset,
    recipient: record.quote.fundingTarget,
    amount: record.quote.gross,
    quoteDigest: record.quoteDigest,
    effect: null,
    invocations: 0,
    operatorCaptured: false,
    mismatchFee: false,
    ...proofExtras,
  });
  const funding = await ctx.service.observeFunding(who.requester, opened.jobId, proofId);
  return { opened, proofId, funding, record };
}
