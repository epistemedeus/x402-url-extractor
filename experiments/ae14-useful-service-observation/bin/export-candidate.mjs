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
  appliedToServing: false,
  mount: "route/ROOT-SERVER-MOUNT.patch",
  mountOwner: "existing serving owner + Root",
  next: "Procurement lead -> dr eggbot -> Root",
  servingSource: SERVING_SOURCE_SHA,
  servingVersion: SERVING_VERSION,
  extension: extensionPublicFields(),
  coldReplay: "node bin/cold-replay.mjs <data-dir>",
  hJoin: { status: "pending-join", ran: false },
  e18: { status: "pending-join", ingested: false },
  e08AsyncDeliveryBuilt: false,
};
const destination = path.join(root, "candidate");
await mkdir(destination, { recursive: true });
await writeFile(path.join(destination, "release-candidate.json"), `${JSON.stringify(candidate, null, 2)}\n`);
process.stdout.write(`${path.join(destination, "release-candidate.json")}\n`);
