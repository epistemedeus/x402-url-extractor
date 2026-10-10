#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { measure } from "./measure.mjs";

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function readJson(file) {
  const bytes = readFileSync(file);
  return {
    bytes,
    value: JSON.parse(bytes.toString("utf8")),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

const receiptPath = arg("--receipt");
const fixturePath = arg("--fixture") || arg("--body");
const serviceUrl = arg("--service");
const query = arg("--query");
const collect = process.argv.includes("--collect");

if (process.argv.includes("--live")) fail("live-query-refused");
if (!serviceUrl) fail("service-required");
if (collect && (fixturePath || receiptPath)) fail("one-input-required");

let document;
if (collect) {
  if (!query) fail("query-required");
  document = await measure({
    serviceUrl,
    collect: true,
    query,
    type: arg("--type") || undefined,
    limit: arg("--limit") || undefined,
    fetchImpl: globalThis.fetch,
  });
} else if (receiptPath || fixturePath) {
  const file = receiptPath || fixturePath;
  let loaded;
  try {
    loaded = readJson(file);
  } catch (error) {
    const absent = error.code === "ENOENT";
    fail(absent ? (receiptPath ? "receipt-absent" : "fixture-absent") : (receiptPath ? "receipt-invalid" : "fixture-invalid"));
  }
  document = await measure({ serviceUrl, body: loaded.value });
  if (receiptPath) {
    document.receiptSha256 = loaded.sha256;
    document.receiptBytes = loaded.bytes.length;
  } else {
    document.inputSha256 = loaded.sha256;
  }
} else {
  fail("input-required");
}

process.stdout.write(`${JSON.stringify(document)}\n`);
if (document.ok !== true) process.exit(2);
