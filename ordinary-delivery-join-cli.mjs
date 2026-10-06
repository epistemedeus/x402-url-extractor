#!/usr/bin/env node
// Read-only operator receiver. Prints a join report. Does not create ledgers.
import { readFile } from "node:fs/promises";

import { FILE_CLASSES, receiveOrdinaryDeliveryJoin, reportViolations } from "./ordinary-delivery-join.mjs";

const HELP = `ordinary-delivery-join

Read canonical settlement, paid-success, HTTP validation, MCP delivery, and
task/outcome files. Join one settlement to its captured delivery by
paidEvidenceId, digest, route, and settlement reference. Aggregate route
counts are not a join. Schema validity is not buyer usefulness.

Usage
  node ordinary-delivery-join-cli.mjs \\
    --data-dir "$COMMERCE_DATA_DIR" \\
    --window-start 2026-10-06T00:17:10.607Z \\
    --window-end 2026-10-06T04:53:48.437Z \\
    --coverage unknown_for_full_window \\
    --source-sha cbfed005c5200f76feb419ebb3a4ce8ffee49644

File classes (read, never created)
  ${FILE_CLASSES.settlementLedger}
  ${FILE_CLASSES.paidSuccessEvidence}
  ${FILE_CLASSES.httpValidation}
  ${FILE_CLASSES.mcpDelivery}
  ${FILE_CLASSES.outcomeBinding}
  ${FILE_CLASSES.outcomeBindingRotated}
  ${FILE_CLASSES.taskRef}
  ${FILE_CLASSES.taskRefRotated}
  optional --caller-declarations <ndjson>  operator input, not a ledger

Contract
  Exit 0 prints samedaydesk.ordinary-delivery-join.v1. Missing files stay empty.
  Exit 2 when the directory, window, source sha, or an input file is unusable.
  The directory is not created. Historical output that is absent stays absent.
  --local-ids adds event id and settlement reference on stdout for the operator.
  Do not commit that output. Public rows omit bodies, digests, queries, and references.
  --check-report <file> prints violation codes and exits 1 when any are present.
  customerPlane stays null. usefulness stays unknown. An exact join requires a capture.
`;

function value(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0) return null;
  const next = process.argv[index + 1];
  if (!next || next.startsWith("--")) return null;
  return next;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function declarationsFrom(text) {
  const rows = [];
  for (const line of String(text || "").split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) rows.push(parsed);
    } catch {
      // An unreadable declaration is not evidence.
    }
  }
  return rows;
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  process.stdout.write(HELP);
  process.exit(0);
}

const checkReport = value("--check-report");
if (process.argv.includes("--check-report")) {
  if (!checkReport) fail("report file is required");
  let report;
  try {
    report = JSON.parse(await readFile(checkReport, "utf8"));
  } catch {
    fail("report file is unreadable");
  }
  const violations = reportViolations(report);
  process.stdout.write(`${JSON.stringify(violations)}\n`);
  process.exit(violations.length === 0 ? 0 : 1);
}

const dataDir = value("--data-dir");
const windowStart = value("--window-start");
const windowEnd = value("--window-end");
const sourceSha = value("--source-sha");
const coverage = value("--coverage") || "unknown_for_full_window";
const callerFile = value("--caller-declarations");
if (!dataDir || !windowStart || !windowEnd || !sourceSha) {
  fail("data directory, window start, window end, and source sha are required");
}

let callerDeclarations = [];
if (callerFile) {
  try {
    callerDeclarations = declarationsFrom(await readFile(callerFile, "utf8"));
  } catch {
    fail("caller declaration file is unreadable");
  }
}

try {
  const report = await receiveOrdinaryDeliveryJoin({
    dataDir,
    windowStart,
    windowEnd,
    coverage,
    sourceSha,
    includeLocalIds: process.argv.includes("--local-ids"),
    callerDeclarations,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  fail(error?.message || "read failed");
}
