#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createForwardOutcomeWriter,
  isForwardV2Record,
  isSchemaValidDeliveryEvidence,
  isTaskRefRecord,
} from "../../commerce-outcome-binding.mjs";
import { joinSnapshot } from "../experiments/delivery-outcome-100173/src/join.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "../experiments/delivery-outcome-100173");
const dataDir = process.env.TASK_LINK_DATA_DIR || process.env.COMMERCE_DATA_DIR || "";
const token = process.env.TASK_LINK_TOKEN || process.env.COMMERCE_INTERNAL_TOKEN || "";
const HISTORIC_BANKED_REVENUE_USDC = 10.955;
const H15 = "0x593559ea7a19277645a76e41aa29e713ed219db1f97e4be29c9dac9cf6cd4b37";
const errors = [];

function check(condition, message) {
  if (!condition) errors.push(message);
}

async function readLines(file) {
  const text = await readFile(file, "utf8").catch((error) => (error?.code === "ENOENT" ? "" : Promise.reject(error)));
  const rows = [];
  let torn = 0;
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      torn += 1;
    }
  }
  return { text, rows, torn };
}

if (!dataDir) {
  process.stderr.write("data dir required\n");
  process.exit(1);
}

const forwardCurrent = await readLines(path.join(dataDir, "commerce-outcome-binding.ndjson"));
const forwardRotated = await readLines(path.join(dataDir, "commerce-outcome-binding.1.ndjson"));
const taskCurrent = await readLines(path.join(dataDir, "commerce-outcome-task-ref.ndjson"));
const taskRotated = await readLines(path.join(dataDir, "commerce-outcome-task-ref.1.ndjson"));
const commerce = await readLines(path.join(dataDir, "commerce-events.ndjson"));
const forwardRows = [...forwardRotated.rows, ...forwardCurrent.rows].filter(isForwardV2Record);
const taskRows = [...taskRotated.rows, ...taskCurrent.rows].filter(isTaskRefRecord);
const taskBytesBefore = (await stat(path.join(dataDir, "commerce-outcome-task-ref.ndjson"))).size;

if (token && Buffer.byteLength(token, "utf8") >= 32 && taskRows[0]) {
  const writer = createForwardOutcomeWriter({ dataDir, maxBytes: 1024 * 1024, internalToken: token });
  const duplicate = await writer.appendTaskRef(taskRows[0]);
  check(duplicate.reason === "duplicate" && duplicate.accepted === false, `restart did not keep the duplicate (${duplicate.reason})`);
  const taskBytesAfter = (await stat(path.join(dataDir, "commerce-outcome-task-ref.ndjson"))).size;
  check(taskBytesAfter === taskBytesBefore, "restart duplicate rewrote the task file");
}

const taskText = `${taskCurrent.text}\n${taskRotated.text}`;
const forwardText = `${forwardCurrent.text}\n${forwardRotated.text}`;
check(!taskText.includes("task-useful-delivery"), "useful label was stored");
check(!taskText.includes("task-unpaid-obs"), "unpaid label was stored");
check(!taskCurrent.torn && !taskRotated.torn && [...taskCurrent.rows, ...taskRotated.rows].every(isTaskRefRecord), "task file violates the closed identity-free row contract");
check(!forwardText.includes(H15), "H15 expense was copied into the new forward rows");
check(!forwardText.includes("samedaydesk.outcome-task-ref.v1"), "task schema was written into forward v2");

const usefulDelivery = forwardRows.find((row) => row.operationId === "op-useful-delivery" && isSchemaValidDeliveryEvidence(row));
check(Boolean(usefulDelivery), "useful operation has no schema-valid delivery");
const unpaidDelivery = forwardRows.find((row) => row.operationId === "op-unpaid-obs" && isSchemaValidDeliveryEvidence(row));
check(!unpaidDelivery, "unpaid observation was treated as schema-valid delivery");

const linkedIds = new Set(taskRows.map((row) => row.commerceEventId));
const commerceEvents = commerce.rows.filter((row) => row && row.v === 3 && typeof row.id === "string");
const unlinked = commerceEvents.filter((row) => !linkedIds.has(row.id));
check(unlinked.length > 0, "every commerce event was given a task link");
check(unlinked.some((row) => row.paymentPresent === false), "unlinked row was not an unpaid transport observation");

const receipt = usefulDelivery?.receiptDigest || "ab".repeat(32);
const produced = joinSnapshot({
  schema: "pilot.delivery-outcome.snapshot.v1",
  mode: "synthetic",
  asOf: "2026-10-01T12:00:00.000Z",
  events: [
    {
      eventId: "later-reuse-1",
      taskRef: "task-later-reuse",
      experimentId: "bounty-contract-reused-artifact",
      stage: "later_useful_call",
      criterion: "verified_artifact_reuse",
      artifactDigest: receipt,
      rewardPresent: true,
      contractCurrent: true,
      httpStatus: 200,
      paymentPresent: false,
      cohort: "controlled_test",
    },
    {
      eventId: "download-only-1",
      taskRef: "task-download-only",
      experimentId: "bounty-contract-reused-artifact",
      stage: "discovery_or_download",
      download: { httpStatus: 200 },
      cohort: "controlled_test",
    },
    {
      eventId: "missing-join-event",
      taskRef: "task-missing-join",
      stage: "valid_call",
      httpStatus: 200,
      paymentPresent: false,
      cohort: "controlled_test",
    },
    {
      eventId: "changed-task-1",
      taskRef: "task-changed",
      stage: "valid_call",
      httpStatus: 200,
      paymentPresent: false,
      taskDigest: "ab".repeat(32),
      cohort: "controlled_test",
    },
    {
      eventId: "changed-op-1",
      taskRef: "task-changed-op",
      operationId: "op-original",
      stage: "valid_call",
      httpStatus: 200,
      paymentPresent: false,
      cohort: "controlled_test",
    },
    {
      eventId: "unrelated-1",
      taskRef: "task-unrelated",
      stage: "valid_call",
      httpStatus: 200,
      paymentPresent: false,
      actorLabel: "independent",
      independentDemandConfirmed: true,
      cohort: "external_unknown",
    },
    {
      eventId: "revoked-1",
      taskRef: "task-revoked",
      stage: "useful_result",
      httpStatus: 200,
      paymentPresent: false,
      usefulDelivery: "false",
      usefulReason: "schema_invalid",
      correctionOf: "revoked-1",
      cohort: "controlled_test",
    },
    {
      eventId: "label-paid-1",
      taskRef: "task-label-paid",
      stage: "valid_call",
      httpStatus: 200,
      paymentPresent: true,
      typedResult: "paid_success",
      actorLabel: "independent",
      independentDemandConfirmed: true,
      cohort: "controlled_test",
    },
  ],
  tasks: [
    {
      taskRef: "task-changed",
      taskDigest: "ab".repeat(32),
      boundTaskDigest: "cd".repeat(32),
    },
  ],
  forwardRecords: [
    ...forwardRows,
    ...taskRows,
    {
      schemaVersion: "samedaydesk.outcome-task-ref.v1",
      writerId: "x402-url-extractor.createCommerceTelemetry.forward-v2",
      operationId: "op-missing-join",
      taskRef: "task-missing-join",
      cohort: "controlled_test",
      commerceEventId: "30000000-0000-4000-8000-000000000099",
      eventId: "30000000-0000-4000-8000-000000000098",
    },
    {
      schemaVersion: "samedaydesk.outcome-task-ref.v1",
      writerId: "x402-url-extractor.createCommerceTelemetry.forward-v2",
      operationId: "op-renamed",
      taskRef: "task-changed-op",
      cohort: "controlled_test",
      commerceEventId: "30000000-0000-4000-8000-000000000097",
      eventId: "30000000-0000-4000-8000-000000000096",
    },
  ],
});

const byTask = Object.fromEntries(produced.tasks.map((task) => [task.taskRef, task]));
const usefulRef = taskRows.find((row) => row.operationId === "op-useful-delivery");
const unpaidRef = taskRows.find((row) => row.operationId === "op-unpaid-obs");
check(Boolean(usefulRef && unpaidRef), "producer task links were not both readable");
check(usefulRef?.taskRef !== unpaidRef?.taskRef, "unpaid and useful observations collapsed to one link");
const usefulOp = produced.forward.operations.find((row) => row.operationId === "op-useful-delivery");
const unpaidOp = produced.forward.operations.find((row) => row.operationId === "op-unpaid-obs");
check(usefulOp?.schemaValidDelivery === true, "join missed schema-valid delivery");
check(usefulOp?.canonicalStageJoin === true, "controlled stages did not join");
check(usefulOp?.usefulness === "unknown", "schema-valid delivery was labeled useful");
check(usefulOp?.externalDemandProved === false, "controlled join was called external demand");
check(usefulOp?.recognizedRevenueAtomic === "0", "operation readout invented revenue");
check(usefulOp?.secondUseAfterCorrection === true, "corrected retained use was dropped");
check(unpaidOp?.schemaValidDelivery === false && unpaidOp?.canonicalStageJoin === false, "unpaid observation became a paid delivery");
check(byTask[usefulRef?.taskRef]?.useful === "unknown", "useful task link was promoted by a caller label");
check(byTask[usefulRef?.taskRef]?.independentUse === 0, "useful task link became independent use");
check(byTask[usefulRef?.taskRef]?.forwardOperationId === "op-useful-delivery", "task did not join to its operation");
check(byTask["task-later-reuse"]?.useful === "true" && byTask["task-later-reuse"]?.status === "joined", "later task did not consume the delivered artifact");
check(byTask["task-download-only"]?.downloadOnly === true && byTask["task-download-only"]?.nativeInstall === false, "download was treated as reuse");
check(byTask["task-download-only"]?.useful !== "true", "download became a useful result");
check(byTask["task-missing-join"]?.status !== "joined", "missing forward evidence still joined");
check(byTask["task-missing-join"]?.missingJoinReasons?.includes("forward_task_ref_without_useful_result"), "missing join reason absent");
check(byTask["task-changed"]?.status === "unjoinable" && byTask["task-changed"]?.missingJoinReasons?.includes("task_changed"), "changed task stayed joinable");
check(byTask["task-changed-op"]?.forwardOperationId === "op-renamed", "changed operation was not visible");
check(byTask["task-changed-op"]?.status !== "joined" && byTask["task-changed-op"]?.independentUse === 0, "renamed operation became demand");
check(byTask["task-unrelated"]?.callerClaimIndependent === true && byTask["task-unrelated"]?.independentUse === 0, "unrelated caller became independent use");
check(produced.independentUse === 0 && produced.actors.independent_use === 0, "readout counted independent use");
check(byTask["task-revoked"]?.useful === "false" && byTask["task-revoked"]?.missingJoinReasons?.includes("corrected"), "revoked output stayed useful");
check(byTask["task-label-paid"]?.useful !== "true", "unverified paid_success label became a useful result");
check(byTask["task-label-paid"]?.missingJoinReasons?.includes("handler_success_not_task_useful"), "paid_success label was not rejected");
check(produced.recognizedRevenueAtomic === "0", "partial readout revenue was not zero");
check(Number(produced.recognizedRevenueAtomic) !== HISTORIC_BANKED_REVENUE_USDC, "partial zero matched historic revenue");
check(produced.customerClaim === false, "readout claimed a customer");

const realPath = path.join(packageRoot, "fixtures/real/snapshot.json");
const realBody = JSON.parse(readFileSync(realPath, "utf8"));
const demandText = readFileSync(path.join(packageRoot, "fixtures/real/commerce-demand.json"), "utf8");
const real = joinSnapshot(realBody, { files: { "commerce-demand": demandText } });
check(real.recognizedRevenueAtomic === "0", "public readout booked revenue");
check(real.demand.settlementAmountAtomic === "1027000", "observed settlement total changed");
check(real.demand.settlementAmountIsRevenue === false, "settlement total was called revenue");
check(real.demand.zeroIsNotHistoricalZero === true, "incomplete zero was treated as history");
check(real.demand.independentUsefulDemand === "unknown", "public useful demand was fabricated");
check(real.experiments.freeDiagnosisPaidOperation.conversionRate === null, "partial coverage produced a rate");
check(real.experiments.nativeInstallUnpaidCall.conversionRate === null, "install coverage produced a rate");
check(real.historicalCustomers === "unknown", "historic customers were zeroed");
check(!JSON.stringify(real).includes(H15) || real.recognizedRevenueAtomic === "0", "H15 entered recognized revenue");

const pin = JSON.parse(readFileSync(path.join(packageRoot, "../../tools/ops/three-site-settlement-join/measure/pins/sponsored-outflow.json"), "utf8"));
check(pin.atomic === "200000" && pin.claim === "closed" && pin.recognizedRevenue === false, "H15 pin changed");
check(pin.movementRef === H15, "H15 reference changed");

const seeded = spawnSync(process.execPath, [
  path.join(packageRoot, "bin/delivery-outcome.mjs"),
  "replay",
  "--input",
  path.join(packageRoot, "fixtures/synthetic/seeded-relabel.json"),
], { encoding: "utf8" });
check(seeded.status === 2, `seeded relabel exit was ${seeded.status}`);

const summary = {
  schema: "samedaydesk.task-linked-delivery.readout.v1",
  controlled: true,
  independentConversion: "unknown",
  recognizedRevenueAtomic: produced.recognizedRevenueAtomic,
  historicBankedRevenueUsdc: HISTORIC_BANKED_REVENUE_USDC,
  partialReadoutZeroIsNotHistoricRevenue: true,
  observedSettlementAmountAtomic: real.demand.settlementAmountAtomic,
  settlementAmountIsRevenue: false,
  h15SponsoredExpenseAtomic: pin.atomic,
  h15Claim: pin.claim,
  h15InsideRecognizedRevenue: false,
  usefulSchemaValidDelivery: usefulOp?.schemaValidDelivery === true,
  usefulUsefulness: usefulOp?.usefulness || null,
  controlledEvidenceJoin: produced.forward.controlledEvidenceJoin === true,
  externalDemandProved: produced.forward.externalDemandProved,
  independentUse: produced.independentUse,
  laterReuseJoined: byTask["task-later-reuse"]?.status || null,
  downloadOnly: byTask["task-download-only"]?.downloadOnly === true,
  unlinkedCommerceEvents: unlinked.length,
  unlinkedMeansCustomers: "unknown",
  publicIndependentUsefulDemand: real.demand.independentUsefulDemand,
  publicConversionRate: real.experiments.freeDiagnosisPaidOperation.conversionRate,
  seededRelabelExit: seeded.status,
  errors: errors.length,
};
process.stdout.write(`${JSON.stringify(summary)}\n`);
if (errors.length) {
  process.stderr.write(`${errors.join("\n")}\n`);
  process.exit(1);
}
