#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readReceipt, relateReceipts } from "./receipt.mjs";

const REFUSAL_FLAGS = ["pay", "settle", "publish", "sign", "reserve", "register", "deploy"];

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      out._.push(token);
      continue;
    }
    const name = token.slice(2);
    if (REFUSAL_FLAGS.includes(name)) {
      const error = new Error(`refusing --${name}`);
      error.code = "refused_flag";
      throw error;
    }
    if (name === "relate") {
      out.relate = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      out[name] = true;
      continue;
    }
    out[name] = value;
    i += 1;
  }
  return out;
}

async function readJson(path) {
  const text = await readFile(path, "utf8");
  return JSON.parse(text);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const now = typeof args.now === "string" ? args.now : undefined;
  if (args.relate) {
    const [leftPath, rightPath] = args._;
    if (!leftPath || !rightPath) {
      process.stderr.write("relate requires two receipt paths\n");
      process.exitCode = 2;
      return;
    }
    const relation = relateReceipts(await readJson(resolve(leftPath)), await readJson(resolve(rightPath)), { now });
    process.stdout.write(`${JSON.stringify(relation, null, 2)}\n`);
    return;
  }
  const [receiptPath] = args._;
  if (!receiptPath) {
    process.stderr.write("a receipt path is required\n");
    process.exitCode = 2;
    return;
  }
  const reading = readReceipt(await readJson(resolve(receiptPath)), { now });
  process.stdout.write(`${JSON.stringify(reading, null, 2)}\n`);
  if (!reading.completedTask && reading.currentAuthority.reason === "unreadable") process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message || error}\n`);
    process.exitCode = 2;
  });
}
