#!/usr/bin/env node
// Later accounting consumer. It does not import the merchant store or the producer token.
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import {
  clientFromCapture,
  compareSolves,
  containsAccount,
  directSolve,
  readCapture,
  receiveKnowledge,
} from "./base-receipt.mjs";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    derivative: { type: "string" },
    receipt: { type: "string" },
    correction: { type: "string" },
    task: { type: "string" },
    operation: { type: "string" },
    method: { type: "string", default: "GET" },
    route: { type: "string", default: "/chain/transaction-receipt" },
    schema: { type: "string", default: "samedaydesk-transaction-receipt" },
    "schema-version": { type: "string", default: "1.0.0" },
    direct: { type: "boolean", default: false },
    compare: { type: "boolean", default: false },
    now: { type: "string" },
  },
});

function exitJson(status, body) {
  if (containsAccount(body)) {
    process.stderr.write('{"error":"restricted_field"}\n');
    process.exit(1);
  }
  const stream = status === 1 ? process.stderr : process.stdout;
  stream.write(`${JSON.stringify(body)}\n`);
  process.exit(status);
}

const now = values.now ? Date.parse(values.now) : Date.parse("2026-10-01T12:00:00.000Z");
if (!Number.isFinite(now)) exitJson(1, { error: "clock_rejected" });
if (!values.receipt) exitJson(1, { error: "receipt_required" });

try {
  const capture = await readCapture(values.receipt);
  const clock = () => now;
  if (values.direct) {
    const solved = await directSolve({ client: clientFromCapture(capture), now: clock });
    exitJson(solved.solved ? 0 : 2, { ...solved, task: values.task || null });
  }
  if (!values.derivative) exitJson(1, { error: "derivative_required" });
  const derivative = JSON.parse(await readFile(values.derivative, "utf8"));
  const correction = values.correction ? JSON.parse(await readFile(values.correction, "utf8")) : null;
  const later = await receiveKnowledge({
    derivative,
    client: clientFromCapture(capture),
    correction,
    method: values.method,
    route: values.route,
    outcomeSchema: values.schema,
    outcomeSchemaVersion: values["schema-version"],
    now,
  });
  const body = { ...later, task: values.task || null, operationId: values.operation || null };
  if (values.compare) {
    const direct = await directSolve({ client: clientFromCapture(capture), now: clock });
    body.direct = {
      accounting: direct.accounting,
      elapsedMs: direct.elapsedMs,
      providerCalls: direct.providerCalls,
      solved: direct.solved,
    };
    body.compare = compareSolves(later, direct);
  }
  exitJson(later.knowledgeApplied ? 0 : 2, body);
} catch (error) {
  exitJson(1, { error: error.code || "rejected" });
}
