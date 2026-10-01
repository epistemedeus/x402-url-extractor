#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DeliveryError } from "../src/errors.mjs";
import { joinSnapshot } from "../src/join.mjs";

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return null;
  return process.argv[index + 1];
}

function reject(code) {
  process.stderr.write(`${JSON.stringify({ decision: "reject", reason: code })}\n`);
  process.exit(2);
}

const command = process.argv[2];
const input = arg("--input");
if (command !== "replay" || !input) reject("invalid_snapshot");

let snapshot;
try {
  snapshot = JSON.parse(readFileSync(input, "utf8"));
} catch {
  reject("invalid_snapshot");
}

const base = dirname(resolve(input));
const files = {};
for (const source of snapshot.sources || []) {
  if (source.kind !== "public_aggregate" || !source.path) continue;
  try {
    files[source.id] = readFileSync(resolve(base, source.path), "utf8");
  } catch {
    reject("source_digest_mismatch");
  }
}

try {
  const readout = joinSnapshot(snapshot, { files });
  const view = arg("--view") === "experiment-input" ? readout.experimentInput : readout;
  process.stdout.write(`${JSON.stringify(view, null, 2)}\n`);
} catch (error) {
  if (error instanceof DeliveryError || typeof error?.code === "string") reject(error.code);
  throw error;
}
