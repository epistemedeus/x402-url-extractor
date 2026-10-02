#!/usr/bin/env node
// Anonymous public scan and retest. Declared dependencies are Node built-ins
// plus a pre-hydrated SkillGuard artifact. No retention authority and no git.

import fs from "node:fs";

import { rankExit, runScan } from "../src/adapter.mjs";
import { rerun } from "../src/retest.mjs";
import { skillguardMatches } from "../src/scanner-pin.mjs";

const forbidden = ["USEFUL_RESULT_GRANT", "COMMERCE_INTERNAL_TOKEN", "PAYMENT_SIGNATURE", "X402_PAYMENT", "GH_TOKEN", "GITHUB_TOKEN", "SCOPED_SURFACE_AUTHORITY"];
if (forbidden.some((name) => process.env[name])) {
  process.stderr.write("private_context_refused\n");
  process.exit(64);
}
const root = process.env.SKILLGUARD_ROOT;
if (!skillguardMatches(root)) {
  process.stderr.write("public_scanner_unavailable\n");
  process.exit(64);
}

const args = process.argv.slice(2);
if (args[0] === "--retest") {
  const original = JSON.parse(fs.readFileSync(args[1], "utf8"));
  const request = JSON.parse(fs.readFileSync(args[2], "utf8"));
  const result = await rerun({ original, request }, { skillguardRoot: root });
  process.stdout.write(`${JSON.stringify({
    schema: "samedaydesk.scoped-surface.public-retest.v1",
    comparison: result.comparison,
    reason: result.reason,
    exitCode: result.exitCode,
    universalGuarantee: false,
    blanketSafetyScore: null,
    fetchedOnRequest: false,
    authority: "none",
  })}\n`);
  process.exit(result.exitCode);
}

if (args.length !== 2) {
  process.stderr.write("two_tasks_required\n");
  process.exit(64);
}
const tasks = args.map((file) => JSON.parse(fs.readFileSync(file, "utf8")));
const reports = [];
for (const task of tasks) reports.push(await runScan(task, { skillguardRoot: root }));
process.stdout.write(`${JSON.stringify({
  schema: "samedaydesk.scoped-surface.public-scan.v1",
  tasks: tasks.map((task) => task.taskId),
  exits: reports.map((report) => report.exitCode),
  results: reports.map((report) => report.concern?.result || null),
  universalGuarantee: false,
  blanketSafetyScore: null,
  fetchedOnRequest: false,
  authority: "none",
  cash: "unknown",
})}\n`);
process.exit(rankExit(reports.map((report) => report.exitCode)));
