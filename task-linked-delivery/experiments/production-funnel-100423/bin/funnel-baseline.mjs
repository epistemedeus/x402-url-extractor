#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { projectFunnelBaseline } from "../src/baseline.mjs";
import { FunnelError } from "../src/errors.mjs";
import { readProductionBaseline } from "../src/read.mjs";
import { refuseFalseComplete } from "../src/seam.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return null;
  return process.argv[index + 1];
}

function reject(code, extra = {}) {
  process.stderr.write(`${JSON.stringify({ decision: "reject", reason: code, ...extra })}\n`);
  process.exit(2);
}

const command = process.argv[2];
const provenance = {
  model: "grok-4.7",
  effort: "xhigh",
  session: "73e7334c-abbc-4adc-bd36-2dda6865656a",
  jobId: "HEAVY-423-FUNNEL-100423",
};

try {
  if (command === "read") {
    const baseline = await readProductionBaseline(provenance);
    const text = `${JSON.stringify(baseline, null, 2)}\n`;
    if (process.argv.includes("--write-evidence")) {
      const dir = resolve(root, "evidence");
      mkdirSync(dir, { recursive: true });
      writeFileSync(resolve(dir, "baseline.stripped.json"), text);
    }
    process.stdout.write(text);
  } else if (command === "reject") {
    const input = arg("--input");
    if (!input) reject("invalid_input");
    const body = JSON.parse(readFileSync(resolve(input), "utf8"));
    const baseline = projectFunnelBaseline({
      coveredDocument: body.coveredDocument,
      rareDocument: body.rareDocument || null,
      coveredMeta: body.coveredMeta,
      rareMeta: body.rareMeta || null,
      provenance,
    });
    const refusal = refuseFalseComplete(baseline, body.proposal);
    process.stderr.write(`${JSON.stringify(refusal)}\n`);
    process.exit(2);
  } else {
    reject("invalid_command");
  }
} catch (error) {
  if (error instanceof FunnelError || typeof error?.code === "string") reject(error.code);
  throw error;
}
