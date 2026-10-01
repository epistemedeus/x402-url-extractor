#!/usr/bin/env node
import { createForwardOutcomeWriter, buildTaskRefRecord, authorizeOutcomeBinding } from "../../commerce-outcome-binding.mjs";

const dataDir = process.env.TASK_LINK_DATA_DIR || "";
const token = process.env.TASK_LINK_TOKEN || "";
const mode = process.argv[2];
if (!dataDir || Buffer.byteLength(token, "utf8") < 32) {
  process.stderr.write("data dir and producer token required\n");
  process.exit(1);
}

function record(commerceEventId) {
  const claim = authorizeOutcomeBinding({
    "x-samedaydesk-internal": token,
    "x-samedaydesk-outcome-operation": "op-append-control",
    "x-samedaydesk-outcome-cohort": "controlled_test",
    "x-samedaydesk-outcome-task": "task-append-control",
  }, token);
  return buildTaskRefRecord({ claim, commerceEventId });
}

const writer = createForwardOutcomeWriter({ dataDir, maxBytes: 1024 * 1024, internalToken: token });
const firstId = "20000000-0000-4000-8000-0000000000a1";
const secondId = "20000000-0000-4000-8000-0000000000a2";
let result;
if (mode === "seed") result = await writer.appendTaskRef(record(firstId));
else if (mode === "fail" || mode === "retry") result = await writer.appendTaskRef(record(secondId));
else {
  process.stderr.write("mode must be seed, fail, or retry\n");
  process.exit(1);
}
process.stdout.write(`${JSON.stringify({ mode, accepted: result.accepted, reason: result.reason })}\n`);
if (mode === "seed" && !result.accepted) process.exit(1);
if (mode === "fail" && result.reason !== "write_outcome_unknown") process.exit(1);
if (mode === "retry" && !result.accepted) process.exit(1);
