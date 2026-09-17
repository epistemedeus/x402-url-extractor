#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  classifyUnpaid402,
  loadProtocolFixtures,
} from "./unpaid-402.mjs";

function print(result, extra = {}) {
  process.stdout.write(`${JSON.stringify({ ...extra, ...result }, null, 2)}\n`);
}

function classifyFile(path) {
  const fixture = JSON.parse(readFileSync(path, "utf8"));
  const result = classifyUnpaid402(fixture);
  return {
    id: fixture.id || path,
    expect: fixture.expect,
    rejectCode: fixture.rejectCode,
    path,
    ...result,
  };
}

function expectedMatch(row) {
  if (row.expect === "pass") return row.ok === true && row.verdict === "unpaid_402";
  if (row.expect === "reject") {
    if (row.ok !== false || row.verdict !== "reject") return false;
    if (row.rejectCode && row.code !== row.rejectCode) return false;
    return true;
  }
  return false;
}

const args = process.argv.slice(2);
const strictUnpaid = args.includes("--strict-unpaid");
const positional = args.filter((arg) => !arg.startsWith("--"));
if (args.length === 0 || args.includes("--help")) {
  process.stderr.write("usage: node tests/protocol/classify-unpaid-402.mjs [--strict-unpaid] <fixture.json> | --all\n");
  process.exit(2);
}

if (args.includes("--all")) {
  const { fixtures } = loadProtocolFixtures();
  const rows = fixtures.map((entry) => {
    const result = classifyUnpaid402(entry.fixture);
    return {
      id: entry.id,
      expect: entry.expect,
      rejectCode: entry.rejectCode,
      path: entry.relativePath,
      ok: result.ok,
      verdict: result.verdict,
      code: result.code,
      errors: result.errors,
      match: expectedMatch({ ...entry, ...result }),
    };
  });
  const failed = rows.filter((row) => !row.match);
  print({
    ok: failed.length === 0,
    counted: rows.length,
    passed: rows.filter((row) => row.match && row.expect === "pass").length,
    rejectedAsExpected: rows.filter((row) => row.match && row.expect === "reject").length,
    failed: failed.map((row) => ({ id: row.id, expect: row.expect, code: row.code, errors: row.errors })),
    rows,
  });
  process.exit(failed.length === 0 ? 0 : 1);
}

if (!positional[0]) {
  process.stderr.write("usage: node tests/protocol/classify-unpaid-402.mjs [--strict-unpaid] <fixture.json> | --all\n");
  process.exit(2);
}
const path = resolve(positional[0]);
const row = classifyFile(path);
print(row);
if (strictUnpaid) process.exit(row.ok && row.verdict === "unpaid_402" ? 0 : 1);
if (row.expect === "pass") process.exit(row.ok ? 0 : 1);
if (row.expect === "reject") process.exit(row.ok ? 1 : 0);
process.exit(row.ok ? 0 : 1);
