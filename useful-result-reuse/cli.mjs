#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

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
