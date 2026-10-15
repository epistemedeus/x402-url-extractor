#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { RELEASE_SCHEMA, SERVING_SOURCE_SHA, SERVING_VERSION, extensionPublicFields } from "../src/contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidate = {
  schema: RELEASE_SCHEMA,
  machineOnly: true,
  humanCopyChange: false,
  paidProbe: false,
  livePurchase: false,
  deployment: "not_performed",
  appliedToServing: "branch_only",
  mount: "route/ROOT-SERVER-MOUNT.patch",
  mountOwner: "existing serving owner + Root",
  next: "Procurement lead -> dr eggbot -> Root",
  servingSource: SERVING_SOURCE_SHA,
  servingVersion: SERVING_VERSION,
  extension: extensionPublicFields(),
  coldReplay: "node bin/cold-replay.mjs <data-dir>",
  runtimeReports: "derived_from_observations",
  repeatRule: "later_request_started_strictly_after_prior_response_finished_and_distinct_settlement_effect",
  settlementClassInMountTest: "simulated_loopback",
  tests: {
    line: "228/228 passed (owned 21/21, npm run test:nonlive 194/194, http-delivery-evidence store and contract 13/13, fail 0)",
    owned: "node --test --test-concurrency=1 experiments/ae14-useful-service-observation/test/*.test.mjs",
    nonlive: "npm run test:nonlive",
    storeContract: "node --test http-delivery-evidence/test/store.test.mjs http-delivery-evidence/test/contract.test.mjs",
  },
  e18: {
    repo: "epistemedeus/neomorphic-io",
    branch: "codex/ae14-e18-market-attribution-consumer",
    head: "11871c33e294ad6acecd0fa7049d9104d9152723",
    status: "pending-join",
    lsRemote: "unchanged_2026-10-15",
  },
  receipt: {
    note: "QA receipt for this amendment. Runtime reports do not encode these facts.",
    outsideUsefulAnswerArrived: false,
    outsideUsefulAnswerReason: "no qualified outside answer was present in the journals exercised here",
    hJoinRan: false,
    hJoinReason: "no H result was present in the inputs",
    e08AsyncDeliveryBuilt: false,
    e08UsefulWork: "unknown",
    finding: "D4 was a source-inspection finding, reproduced by a qualified fact and by absence",
  },
};
const destination = path.join(root, "candidate");
await mkdir(destination, { recursive: true });
await writeFile(path.join(destination, "release-candidate.json"), `${JSON.stringify(candidate, null, 2)}\n`);
process.stdout.write(`${path.join(destination, "release-candidate.json")}\n`);
