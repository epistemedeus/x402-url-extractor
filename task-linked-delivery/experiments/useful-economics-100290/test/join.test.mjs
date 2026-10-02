import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { BUNDLE_SCHEMA, HISTORIC_BANKED_REVENUE_USDC, OBSERVATION_SCHEMA } from "../src/constants.mjs";
import { mergeCosts, observeGross, projectCosts, settleEconomics } from "../src/economics.mjs";
import { EconomicsError } from "../src/errors.mjs";
import { evaluateBundle, toPublic } from "../src/evaluate.mjs";
import { readNdjson } from "../src/read.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, "..");
const retainedCase = JSON.parse(await readFile(path.resolve(here, "../../../../experiments/seller-repair-service-100266/cases/retained-case.json"), "utf8"));
const TX = `0x${"ab".repeat(32)}`;

function observation(extra) {
  return {
    schema: OBSERVATION_SCHEMA,
    eventId: "event-a",
    operationId: "normalized-transaction-receipt",
    taskRef: "task-a",
    stage: "verified_delivery",
    sourceClass: "server_execution",
    authority: "server_execution",
    cohort: "public_aggregate",
    ...extra,
  };
}

function bundle(extra) {
  return { schema: BUNDLE_SCHEMA, coverage: "supplied_records", observations: [], ...extra };
}

test("reordered records keep one observation digest and a later append does not rewrite it", async () => {
  const first = observation({ eventId: "b-row", stage: "attempted_call" });
  const second = observation({
    eventId: "a-row",
    stage: "verified_delivery",
    serverExecution: "not_found",
    callerExpectation: "agreed_negative",
    expectationAuthority: "operation_contract",
    settlementStatus: "verified",
    settlementTrusted: true,
  });
  const left = await evaluateBundle(bundle({ observations: [first, second] }));
  const right = await evaluateBundle(bundle({ observations: [second, first] }));
  assert.equal(left.observationDigest, right.observationDigest);
  assert.equal(left.journeys[0].useful, "agreed_negative");
  const again = await evaluateBundle(bundle({ observations: [second] }), { prior: left });
  assert.equal(again.generation, 2);
  assert.equal(again.priorReceiptId, left.receiptId);
  assert.equal(again.observations.some((row) => row.eventId === "b-row"), true);
  assert.equal(left.observations.some((row) => row.eventId === "b-row"), true);
  assert.notEqual(again.receiptId, left.receiptId);
});

test("a conflicting duplicate stays unjoinable and a torn line stays incomplete", async () => {
  const conflict = await evaluateBundle(bundle({
    observations: [
      observation({ eventId: "same-id", explicitCriterionMet: true, serverExecution: "found" }),
      observation({ eventId: "same-id", explicitCriterionMet: false, serverExecution: "absent", httpStatus: 200 }),
    ],
  }));
  assert.equal(conflict.journeys[0].status, "unjoinable");
  assert.equal(conflict.journeys[0].useful === "true", false);
  assert.equal(conflict.gaps.includes("duplicate_id_conflict"), true);
  const torn = readNdjson("{\"schema\":\"samedaydesk.useful-economics.observation.v1\"}\n{\"eventId\":");
  assert.equal(torn.truncated, 1);
  const incomplete = await evaluateBundle(bundle({ records: torn.rows, truncatedRecords: torn.truncated }));
  const truncated = incomplete.journeys.find((journey) => journey.operationId === "truncated-record");
  assert.equal(truncated.status, "incomplete");
  assert.equal(truncated.useful, "unknown");
  assert.equal(incomplete.query.eligible.rate, null);
});

test("unknown source and a self-asserted label are not eligible demand", async () => {
  const receipt = await evaluateBundle(bundle({
    coverage: "complete",
    records: [{ schema: "samedaydesk.not-a-source.v1", note: "unchecked" }],
    observations: [observation({
      eventId: "self-label",
      operationId: "self-op",
      taskRef: "task-self",
      sourceClass: "self_asserted_independent",
      authority: "caller_expectation",
      explicitCriterionMet: true,
      serverExecution: "found",
    })],
  }));
  const unknown = receipt.journeys.find((journey) => journey.status === "unknown_source");
  assert.ok(unknown);
  assert.equal(receipt.query.eligible.count >= 1, true);
  assert.equal(receipt.query.sourceCoverage.independentUse, 0);
  assert.equal(receipt.query.sourceCoverage.rate, undefined);
  assert.equal(receipt.journeys.every((journey) => journey.independentUse === 0), true);
  assert.equal(receipt.query.eligible.rate, null);
  assert.equal(receipt.demandEstablished, false);
  assert.equal(receipt.gaps.includes("self_asserted_independent_is_not_demand"), true);
  assert.equal(receipt.gaps.includes("unknown_source"), true);
});

test("two owners of one body stay distinct when one grant is withdrawn", async () => {
  const digest = "ab".repeat(32);
  const receipt = await evaluateBundle(bundle({
    records: [
      {
        schema: "samedaydesk.useful-result-reuse.customer-grant.v1",
        action: "retain",
        grantId: "aaaa1111aaaa1111",
        recordId: "record-a",
        operationId: "normalized-transaction-receipt",
        taskRef: "task-owners",
        comparable: digest,
        settlementStatus: "verified",
        paidValidDelivery: true,
        evidenceClass: "paid_valid_delivery",
        body: { decision: "found", request: { transactionHash: TX } },
      },
      {
        schema: "samedaydesk.useful-result-reuse.customer-grant.v1",
        action: "retain",
        grantId: "bbbb2222bbbb2222",
        recordId: "record-b",
        operationId: "normalized-transaction-receipt",
        taskRef: "task-owners",
        comparable: digest,
        settlementStatus: "verified",
        paidValidDelivery: true,
        evidenceClass: "paid_valid_delivery",
        body: { decision: "found", request: { transactionHash: TX } },
      },
      {
        schema: "samedaydesk.useful-result-reuse.customer-grant.v1",
        action: "revoke",
        grantId: "aaaa1111aaaa1111",
        targetId: "aaaa1111aaaa1111",
      },
      {
        schema: "samedaydesk.useful-result-reuse.metric.v1",
        kind: "useful_later_read",
        eventId: "later-read-1",
        taskRef: "task-owners",
      },
    ],
    observations: [observation({
      eventId: "other-op",
      operationId: "get:/extract",
      taskRef: null,
      stage: "attempted_call",
      bodyDigest: digest,
      httpStatus: 402,
      paymentPresented: false,
    })],
  }));
  const joined = receipt.journeys.find((journey) => journey.taskRef === "task-owners");
  assert.equal(joined.identicalBody, true);
  assert.equal(joined.revocationTransferred, false);
  assert.equal(joined.reused, true);
  assert.equal(joined.useful, "true");
  const live = joined.ownerSlots.find((slot) => slot.id === "bbbb2222bbbb2222");
  const withdrawn = joined.ownerSlots.find((slot) => slot.id === "aaaa1111aaaa1111");
  assert.equal(live.useful, "true");
  assert.equal(live.paidValidDelivery, true);
  assert.equal(withdrawn.withdrawn, true);
  assert.equal(withdrawn.useful, "false");
  const other = receipt.journeys.find((journey) => journey.operationId === "get:/extract");
  assert.equal(other.taskRef, null);
  assert.notEqual(other.bindingKey, joined.bindingKey);
  const published = JSON.stringify(toPublic(receipt));
  assert.equal(published.includes(TX), false);
  assert.equal(published.includes("aaaa1111aaaa1111"), false);
  assert.equal(published.includes(digest), false);
  assert.equal(receipt.economics.recognizedRevenueAtomic, "0");
});

test("http 200, http 402, wallet transfer, and historic margin are refused", async () => {
  const bare = await evaluateBundle(bundle({
    observations: [observation({ httpStatus: 200, serverExecution: "absent" })],
  }));
  assert.equal(bare.journeys[0].useful, "false");
  assert.equal(bare.journeys[0].reasons.includes("http_200_not_useful"), true);
  const challenge = await evaluateBundle(bundle({
    observations: [observation({ eventId: "challenge", stage: "attempted_call", httpStatus: 402, paymentPresented: false })],
  }));
  assert.equal(challenge.journeys[0].useful, "false");
  assert.equal(challenge.journeys[0].reasons.includes("challenge_not_useful"), true);
  await assert.rejects(() => evaluateBundle(bundle({ directives: { treatHttp200AsUseful: true } })), (error) => error.code === "http200_directive_refused");
  await assert.rejects(() => evaluateBundle(bundle({ directives: { bookHistoricalAsMargin: true } })), (error) => error.code === "historical_not_margin");
  await assert.rejects(() => evaluateBundle(bundle({
    observations: [observation({ email: "buyer@example.test" })],
  })), (error) => error instanceof EconomicsError && error.code === "restricted_fields");
  const wallet = await evaluateBundle(bundle({
    observations: [observation({
      eventId: "wallet",
      authority: "wallet_transfer",
      sourceClass: "explicit_source",
      settlementStatus: "verified",
      settlementTrusted: false,
      grossSettledAtomic: "10000",
    })],
  }));
  assert.equal(wallet.journeys[0].useful, "unknown");
  assert.equal(wallet.journeys[0].settlementTrusted, false);
  assert.equal(wallet.economics.recognizedRevenueAtomic, "0");
  assert.equal(wallet.economics.historicalBankedRevenueUsdc, HISTORIC_BANKED_REVENUE_USDC);
  assert.equal(wallet.economics.historicalCountedInBreakeven, false);
});

test("breakeven uses only known gross, fees, and cash marginal", () => {
  const ready = settleEconomics({
    supplied: {
      grossSettledRevenueAtomic: { atomic: "10000" },
      feesAtomic: { lower: "0", upper: "100" },
      cashMarginalAtomic: { lower: "50", upper: "80" },
      includedQuotaOpportunityCostAtomic: { atomic: "99999", countsAsCash: true },
      sharedRndAtomic: { atomic: "50" },
    },
    observedGross: { known: false, reason: "no_trusted_settlement" },
  });
  assert.equal(ready.breakeven.calculable, true);
  assert.equal(ready.breakeven.lowerNetAtomic, "9820");
  assert.equal(ready.breakeven.upperNetAtomic, "9950");
  assert.equal(ready.breakeven.position, "above");
  assert.equal(ready.breakeven.includedQuotaCountedAsCash, false);
  assert.equal(ready.breakeven.historicalCounted, false);
  assert.equal(ready.profit, null);
  assert.equal(ready.summed, false);
  const missing = settleEconomics({
    supplied: { grossSettledRevenueAtomic: { atomic: "10000" }, feesAtomic: { atomic: "1" } },
    observedGross: { known: false, reason: "no_trusted_settlement" },
  });
  assert.equal(missing.breakeven.calculable, false);
  assert.equal(missing.planes.cashMarginal.known, false);
  const merged = mergeCosts([
    projectCosts(null),
    { grossSettledRevenue: { known: true, lower: "10000", upper: "10000", countsAsCash: false } },
  ]);
  assert.equal(merged.grossSettledRevenue.lower, "10000");
  assert.equal(merged.cashMarginal.known, false);
  assert.throws(() => projectCosts({ sharedRndAtomic: { atomic: "1", allocatable: true } }), (error) => error.code === "shared_rnd_not_allocatable");
  const conflict = settleEconomics({
    supplied: { grossSettledRevenueAtomic: { atomic: "10000" }, feesAtomic: { atomic: "0" }, cashMarginalAtomic: { atomic: "0" } },
    observedGross: { known: true, lower: "9000", upper: "9000" },
  });
  assert.equal(conflict.planes.grossSettledRevenue.reason, "gross_conflict");
  assert.equal(conflict.breakeven.calculable, false);
  assert.equal(String(conflict.breakeven.lowerNetAtomic).includes("10.955"), false);
  assert.equal(observeGross([{ settlementStatus: "verified", settlementTrusted: true, grossSettledAtomic: null }]).reason, "incomplete_amounts");
});

test("owner QA coverage does not become a world rate", async () => {
  const receipt = await evaluateBundle(bundle({
    coverage: "complete",
    observations: [observation({
      cohort: "owner_qa",
      serverExecution: "found",
      explicitCriterionMet: true,
      authority: "server_execution",
    })],
  }));
  assert.equal(receipt.journeys[0].useful, "true");
  assert.equal(receipt.query.useful.rate, null);
  assert.equal(receipt.query.sourceCoverage.complete, false);
  assert.equal(receipt.gaps.includes("owner_qa_is_not_world_coverage"), true);
  assert.equal(receipt.economics.planes.cashMarginal.known, false);
  assert.equal(receipt.meters.tokenMeter, "unknown");
});

test("seller repair, a retained negative, activation, and a maintained task share one core", async () => {
  const { runJourney } = await import("../../../../experiments/seller-repair-service-100266/src/journey.mjs");
  const { startFixtureSeller } = await import("../../../../experiments/seller-repair-service-100266/src/fixture-seller.mjs");
  const seller = await startFixtureSeller();
  try {
    const repair = await runJourney({
      intake: retainedCase,
      baseUrl: seller.baseUrl,
      fixtureMode: "contradict",
      retestFixtureMode: "repaired",
    });
    const receipt = await evaluateBundle(bundle({
      records: [
        repair,
        {
          schema: "samedaydesk.useful-result-reuse.customer-grant.v1",
          action: "retain",
          grantId: "cccc3333cccc3333",
          recordId: "negative-1",
          operationId: "normalized-transaction-receipt",
          taskRef: "task-negative",
          comparable: "cd".repeat(32),
          settlementStatus: "verified",
          paidValidDelivery: false,
          evidenceClass: "useful_negative",
          body: { decision: "not_found", receipt: { found: false }, request: { transactionHash: TX } },
        },
        {
          schema: "samedaydesk.paid-useful-journey.v1",
          eventId: "activation-1",
          operationId: "get:/commerce/seller-integrity-audit",
          taskRef: "task-activation",
          producedBy: "paidUsefulJourneyMetadata",
          usefulDelivery: "true",
          usefulReason: "additional_work_present",
          actor: "owner_test",
          sourceClass: "server_execution",
        },
        {
          schema: "samedaydesk.paid-useful-journey.v1",
          eventId: "activation-incomplete",
          operationId: "get:/commerce/seller-integrity-audit",
          taskRef: "task-audit",
          producedBy: "paidUsefulJourneyMetadata",
          usefulDelivery: "false",
          usefulReason: "audit_incomplete",
          actor: "owner_test",
          sourceClass: "server_execution",
        },
        {
          schema: "samedaydesk.maintained-task.envelope.v1",
          eventId: "page-change",
          operationId: "page-change",
          taskRef: "task-page",
          qualified: true,
          license: "MIT",
          executed: false,
        },
      ],
      observations: [observation({
        eventId: "later-job",
        operationId: "later-paid-job",
        taskRef: "task-activation",
        stage: "subsequent_useful_or_paid_job",
        sourceClass: "explicit_source",
        authority: "explicit_source",
        cohort: "public_aggregate",
        priorOperationId: "get:/commerce/seller-integrity-audit",
      })],
    }));
    const repairJourney = receipt.journeys.find((journey) => journey.operationId === "seller-repair");
    assert.equal(repairJourney.useful, "true");
    assert.equal(repairJourney.reused, true);
    assert.equal(receipt.economics.planes.apiEquivalentBuildEffort.countsAsCash, false);
    assert.equal(receipt.economics.planes.apiEquivalentBuildEffort.known, true);
    const negative = receipt.journeys.find((journey) => journey.taskRef === "task-negative");
    assert.equal(negative.useful, "agreed_negative");
    assert.equal(negative.paidValidDelivery, false);
    assert.equal(negative.complete, true);
    const activation = receipt.journeys.find((journey) => journey.taskRef === "task-activation" && journey.operationId.startsWith("get:"));
    assert.equal(activation.useful, "true");
    const audit = receipt.journeys.find((journey) => journey.taskRef === "task-audit");
    assert.equal(audit.useful, "false");
    assert.equal(audit.reasons.includes("audit_incomplete"), true);
    const maintained = receipt.journeys.find((journey) => journey.operationId === "page-change");
    assert.equal(maintained.stages.task_discovery, true);
    assert.equal(maintained.stages.qualification, true);
    assert.equal(maintained.stages.attempted_call, false);
    assert.equal(maintained.useful, "unknown");
    const later = receipt.journeys.find((journey) => journey.operationId === "later-paid-job");
    assert.equal(later.priorOperationId, "get:/commerce/seller-integrity-audit");
    assert.equal(receipt.query.repeat.count, 1);
    assert.equal(JSON.stringify(toPublic(receipt)).includes(TX), false);
    assert.equal(receipt.economics.recognizedRevenueAtomic, "0");
    assert.equal(receipt.gaps.includes("effort_ledger_not_in_checkout"), true);
  } finally {
    await seller.close();
  }
});

test("the owner CLI rejects seeded claims and keeps the first receipt bytes", async () => {
  const cli = path.join(pkg, "bin/useful-economics.mjs");
  const seeded = spawnSync(process.execPath, [cli, "reject-seeded", "--bundle", path.join(pkg, "fixtures/seeded-http200.json")], { encoding: "utf8" });
  assert.equal(seeded.status, 2, `${seeded.stdout}\n${seeded.stderr}`);
  assert.match(seeded.stderr, /http200_directive_refused/);
  const margin = spawnSync(process.execPath, [cli, "reject-seeded", "--bundle", path.join(pkg, "fixtures/seeded-margin.json")], { encoding: "utf8" });
  assert.equal(margin.status, 2, margin.stderr);
  assert.match(margin.stderr, /historical_not_margin/);
  const restricted = spawnSync(process.execPath, [cli, "reject-seeded", "--bundle", path.join(pkg, "fixtures/seeded-restricted.json")], { encoding: "utf8" });
  assert.equal(restricted.status, 2, restricted.stderr);
  assert.match(restricted.stderr, /restricted_fields/);
  const bare = await evaluateBundle(bundle({
    observations: [observation({ eventId: "bare-200", httpStatus: 200, serverExecution: "absent" })],
  }));
  assert.equal(bare.journeys[0].useful, "false");
  const dir = await mkdtemp(path.join(tmpdir(), "useful-economics-"));
  const receipts = path.join(dir, "receipts.ndjson");
  const accepted = path.join(pkg, "fixtures/accepted.json");
  const joined = spawnSync(process.execPath, [cli, "join", "--bundle", accepted, "--view", "full"], { encoding: "utf8" });
  assert.equal(joined.status, 0, joined.stderr);
  await writeFile(receipts, joined.stdout);
  const before = await readFile(receipts);
  const extra = path.join(dir, "extra.json");
  await writeFile(extra, JSON.stringify(bundle({
    observations: [observation({ eventId: "later-fact", stage: "authorized_retained_read", reused: true })],
  })));
  const appended = spawnSync(process.execPath, [cli, "append", "--receipts", receipts, "--bundle", extra], { encoding: "utf8" });
  assert.equal(appended.status, 0, appended.stderr);
  const after = await readFile(receipts);
  assert.equal(after.subarray(0, before.length).equals(before), true);
  const lines = after.toString("utf8").trim().split("\n");
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[1]).generation, 2);
  assert.equal(JSON.parse(lines[1]).observations.some((row) => row.eventId === "accepted-negative"), true);
  const duplicate = spawnSync(process.execPath, [cli, "append", "--receipts", receipts, "--bundle", extra], { encoding: "utf8" });
  assert.equal(duplicate.status, 2, duplicate.stdout);
  assert.match(duplicate.stderr, /duplicate_append/);
  const unchanged = await readFile(receipts);
  assert.equal(unchanged.equals(after), true);
});
