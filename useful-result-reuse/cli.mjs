#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { publicHistoricalClient } from "../transaction-receipt.mjs";
import { CAPTURED_RECEIPT, clientFromCapture, directSolve, executeClosedSettlement, readCapture } from "./base-receipt.mjs";
import { createUsefulResultReuse, rejectSeededFixture, selectExistingPaidOperation } from "./service.mjs";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    data: { type: "string" },
    "token-file": { type: "string" },
    task: { type: "string" },
    operation: { type: "string" },
    method: { type: "string" },
    route: { type: "string" },
    schema: { type: "string" },
    "schema-version": { type: "string" },
    class: { type: "string" },
    "outcome-file": { type: "string" },
    "asserted-digest": { type: "string" },
    corrects: { type: "string" },
    share: { type: "string" },
    "source-sha": { type: "string" },
    "requirement-file": { type: "string" },
    "offer-file": { type: "string" },
    "authorization-file": { type: "string" },
    "receipt-file": { type: "string" },
    limit: { type: "string" },
    cursor: { type: "string" },
  },
});

function exitJson(status, body) {
  const stream = status === 0 ? process.stdout : process.stderr;
  stream.write(`${JSON.stringify(body)}\n`);
  process.exit(status);
}

const command = positionals[0] || "";

try {
  if (command === "reject-seeded") {
    const result = await rejectSeededFixture(positionals[1]);
    exitJson(result.refused ? 0 : 2, result);
  }
  if (command === "read-public") {
    const capture = await readCapture(values["receipt-file"] || CAPTURED_RECEIPT);
    const fixture = await executeClosedSettlement({
      client: clientFromCapture(capture),
      now: () => new Date(),
    });
    const live = await executeClosedSettlement({
      client: publicHistoricalClient("base"),
      now: () => new Date(),
    });
    const fixtureMatch = fixture.projection.pinMatch === true
      && live.projection.pinMatch === true
      && fixture.projection.evidenceDigest === live.projection.evidenceDigest
      && fixture.projection.transactionFeeWei === live.projection.transactionFeeWei
      && fixture.projection.blockNumber === live.projection.blockNumber
      && fixture.projection.matchedAtomic === live.projection.matchedAtomic;
    exitJson(fixtureMatch ? 0 : 2, {
      evidenceClass: "server_executed_output",
      fixtureMatch,
      live: {
        blockNumber: live.projection.blockNumber,
        decision: live.projection.decision,
        evidenceDigest: live.projection.evidenceDigest,
        matchedAtomic: live.projection.matchedAtomic,
        qualification: live.projection.qualification,
        status: live.projection.status,
        transactionFeeWei: live.projection.transactionFeeWei,
      },
      providerCalls: live.providerCalls,
      elapsedMs: live.elapsedMs,
      paymentPermitted: false,
    });
  }
  if (command === "direct-solve") {
    const capture = await readCapture(values["receipt-file"]);
    const solved = await directSolve({ client: clientFromCapture(capture), now: () => Date.now() });
    exitJson(solved.solved ? 0 : 2, solved);
  }
  if (command === "next-paid") {
    const requirement = JSON.parse(await readFile(values["requirement-file"], "utf8"));
    const offer = values["offer-file"] ? JSON.parse(await readFile(values["offer-file"], "utf8")) : null;
    const authorization = values["authorization-file"] ? JSON.parse(await readFile(values["authorization-file"], "utf8")) : null;
    exitJson(0, selectExistingPaidOperation(requirement, { offer, authorization, now: Date.now() }));
  }
  const token = values["token-file"]
    ? (await readFile(values["token-file"], "utf8")).trim()
    : String(process.env.USEFUL_RESULT_TOKEN || "");
  if (!values.data) exitJson(1, { error: "data_dir_required" });
  const service = createUsefulResultReuse({ dataDir: values.data, internalToken: token });
  if (command === "current") {
    exitJson(0, await service.current({
      limit: values.limit ? Number(values.limit) : 20,
      cursor: values.cursor || null,
    }));
  }
  if (command === "metrics") exitJson(0, await service.metrics());
  const common = {
    taskLabel: values.task,
    operationId: values.operation,
    classification: values.class,
  };
  if (command === "bind") {
    const outcome = values["outcome-file"] ? JSON.parse(await readFile(values["outcome-file"], "utf8")) : null;
    const result = await service.bind({
      ...common,
      method: values.method,
      route: values.route,
      outcomeSchema: values.schema,
      outcomeSchemaVersion: values["schema-version"],
      outcome,
      assertedDigest: values["asserted-digest"] || null,
      correctionOf: values.corrects || null,
    });
    exitJson(result.accepted ? 0 : 1, result);
  }
  if (command === "retrieve") exitJson(0, await service.retrieve(common));
  if (command === "share") {
    const result = await service.share(common);
    exitJson(result.accepted ? 0 : 1, result);
  }
  if (command === "revoke") exitJson(0, await service.revoke({ ...common, share: true }));
  if (command === "verify-settlement") {
    const result = await service.verifySettlement({
      ...common,
      receiptFile: values["receipt-file"],
    });
    exitJson(result.accepted ? 0 : 1, result);
  }
  if (command === "share-knowledge") {
    const result = await service.shareKnowledge(common);
    exitJson(result.accepted ? 0 : 1, result);
  }
  if (command === "correct-knowledge") {
    const result = await service.correctKnowledge({ ...common, receiptFile: values["receipt-file"] });
    exitJson(result.accepted ? 0 : 1, result);
  }
  if (command === "consume") {
    const result = await service.consume({
      ...common,
      shareId: values.share,
      method: values.method,
      route: values.route,
      outcomeSchema: values.schema,
      outcomeSchemaVersion: values["schema-version"],
      sourceSha: values["source-sha"],
    });
    exitJson(0, result);
  }
  exitJson(1, { error: "unknown_command" });
} catch (error) {
  exitJson(1, { error: error.code || "rejected" });
}
