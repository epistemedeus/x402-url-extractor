#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

import { createRecordingMcp, wrapFakeMcpWithTimeoutCap } from "./client.mjs";
import {
  TEN_MINUTE_MS,
  TEN_MINUTE_SECONDS,
} from "./derive.mjs";
import {
  evaluateCatalog,
  evaluateProductCase,
  evaluateSeededClaim,
  seededAsRequiredTruth,
} from "./evaluate.mjs";
import { inspectInstalledMcp } from "./inspect-sdk.mjs";
import { CATALOG_PATH, FIXTURE_ROOT } from "./paths.mjs";

const USAGE = `x402 MCP 10m timeout regression

Usage:
  node tests/protocol/timeout-10m/run.mjs [--json]
  node tests/protocol/timeout-10m/run.mjs --seeded-failure [--json]
  node tests/protocol/timeout-10m/run.mjs --fixture <path> [--json]
  node tests/protocol/timeout-10m/run.mjs --list

Write boundary: tests/protocol/timeout-10m/**.
Does not pay, settle, publish, or wait 10 minutes.
`;

const SCHEMA = "x402.mcp.timeout-10m.report.v1";
const MAX_WALL_MS = 5_000;

function parseArgs(argv) {
  const out = { json: false, list: false, seededFailure: false, fixture: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--json") out.json = true;
    else if (a === "--list") out.list = true;
    else if (a === "--seeded-failure") out.seededFailure = true;
    else if (a === "--cold") out.cold = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--fixture") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) throw usageError("missing_operand", "--fixture requires a path");
      out.fixture = next;
      i += 1;
    } else throw usageError("unknown_flag", `unknown argument ${a}`);
  }
  return out;
}

function usageError(code, message) {
  const err = new Error(message);
  err.code = code;
  err.usage = true;
  return err;
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function loadCatalog() {
  return loadJson(CATALOG_PATH);
}

function envelope({ ok, command, status, cases, seeded, error, result, wallMs, sdk, exercise }) {
  return {
    ok,
    schema: SCHEMA,
    schemaVersion: 1,
    command,
    repo: "x402-url-extractor",
    surface: "x402-mcp-timeout-10m",
    checkedAt: new Date().toISOString(),
    status,
    writeBoundary: "tests/protocol/timeout-10m/**",
    capSeconds: TEN_MINUTE_SECONDS,
    capMs: TEN_MINUTE_MS,
    wallMs,
    waitedTenMinutes: wallMs != null && wallMs >= TEN_MINUTE_MS,
    counts: summarize(cases || [], seeded || []),
    cases: cases || [],
    seeded: seeded || [],
    exercise: exercise ?? null,
    sdk: sdk ?? null,
    error,
    result: result ?? null,
    boundary: { paymentSent: false, settled: false, toolsCalledPaid: false },
  };
}

function summarize(cases, seeded) {
  const counts = { total: cases.length + seeded.length, pass: 0, fail: 0, caught: 0, missed: 0 };
  for (const row of cases) {
    if (row.status === "pass" || row.ok) counts.pass += 1;
    else counts.fail += 1;
  }
  for (const row of seeded) {
    if (row.status === "caught") counts.caught += 1;
    else if (row.status === "missed") counts.missed += 1;
    else counts.fail += 1;
  }
  return counts;
}

function print(report, { json, text }) {
  if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(`${text}\n`);
}

function exerciseWrap() {
  const mcp = createRecordingMcp();
  const client = wrapFakeMcpWithTimeoutCap(mcp);
  return Promise.all([
    client.callTool("enrich", { domain: "example.com" }),
    client.callToolWithPayment("enrich", { domain: "example.com" }, {
      x402Version: 2,
      resource: { url: "mcp://tool/enrich", mimeType: "application/json" },
      accepted: { scheme: "exact", maxTimeoutSeconds: 900 },
      payload: { signature: "0xseed" },
    }),
    client.callToolWithPayment("enrich", { domain: "example.com" }, {
      x402Version: 2,
      resource: { url: "mcp://tool/enrich", mimeType: "application/json" },
      accepted: { scheme: "exact", maxTimeoutSeconds: 300 },
      payload: { signature: "0xseed" },
    }),
  ]).then(() => {
    const probe = mcp.calls[0];
    const overCap = mcp.calls[1];
    const sds = mcp.calls[2];
    const ok = probe?.timeout === 300_000
      && overCap?.timeout === TEN_MINUTE_MS
      && overCap?.hasPayment === true
      && sds?.timeout === 300_000
      && mcp.calls.length === 3;
    return {
      ok,
      calls: mcp.calls,
      reason: ok
        ? "fake MCP wrap applied 300s probe, 10m cap on 900s accept, 300s SDS accept; never settled"
        : "fake MCP wrap did not apply the 10m timeout cap",
    };
  });
}

async function runCold() {
  const started = performance.now();
  const catalog = loadCatalog();
  const judged = evaluateCatalog(catalog);
  const exercise = await exerciseWrap();
  const sdk = inspectInstalledMcp();
  const wallMs = Math.round(performance.now() - started);
  const wallOk = wallMs < MAX_WALL_MS;
  const ok = judged.ok && exercise.ok && wallOk;
  return envelope({
    ok,
    command: "run",
    status: ok ? "pass" : "fail",
    cases: judged.cases,
    seeded: judged.seeded,
    wallMs,
    sdk,
    exercise,
    result: {
      catalogOk: judged.ok,
      exerciseOk: exercise.ok,
      wallOk,
      seededCaught: judged.counts.caught,
      productCases: judged.counts.pass,
      pinGap: sdk.pinGap === true,
    },
    error: ok ? null : {
      code: wallOk ? "EVAL_FAIL" : "WAITED_TOO_LONG",
      message: [
        judged.ok ? null : judged.reason,
        exercise.ok ? null : exercise.reason,
        wallOk ? null : `cold run wall ${wallMs}ms exceeded ${MAX_WALL_MS}ms (must not wait 10m)`,
      ].filter(Boolean).join("; "),
    },
  });
}

function runSeededFailure() {
  const started = performance.now();
  const catalog = loadCatalog();
  const seed = (catalog.seeded ?? [])[0];
  const truth = seededAsRequiredTruth(seed);
  const wallMs = Math.round(performance.now() - started);
  return envelope({
    ok: false,
    command: "seeded-failure",
    status: "fail",
    cases: [],
    seeded: [evaluateSeededClaim(seed)],
    wallMs,
    error: {
      code: truth.code,
      kind: truth.kind,
      message: truth.message,
      claimedTimeoutMs: truth.claimedTimeoutMs,
      derivedTimeoutMs: truth.derivedTimeoutMs,
    },
    result: {
      id: truth.id,
      rejected: truth.rejected,
      claimedTimeoutMs: truth.claimedTimeoutMs,
      derivedTimeoutMs: truth.derivedTimeoutMs,
      paid: false,
      settled: false,
    },
  });
}

function runFixture(path) {
  const started = performance.now();
  const fixture = loadJson(resolve(FIXTURE_ROOT, path));
  const wallMs = Math.round(performance.now() - started);
  if (fixture.kind === "false_accept" || fixture.expect === "reject") {
    const truth = seededAsRequiredTruth(fixture);
    const judged = evaluateSeededClaim(fixture);
    return envelope({
      ok: false,
      command: "fixture",
      status: "fail",
      cases: [],
      seeded: [judged],
      wallMs,
      error: {
        code: truth.code,
        kind: truth.kind,
        message: truth.message,
        claimedTimeoutMs: truth.claimedTimeoutMs,
        derivedTimeoutMs: truth.derivedTimeoutMs,
      },
      result: {
        id: fixture.id,
        path,
        rejected: truth.rejected,
        claimedTimeoutMs: truth.claimedTimeoutMs,
        derivedTimeoutMs: truth.derivedTimeoutMs,
        paid: false,
        settled: false,
      },
    });
  }
  const judged = evaluateProductCase(fixture);
  return envelope({
    ok: judged.ok,
    command: "fixture",
    status: judged.ok ? "pass" : "fail",
    cases: [judged],
    seeded: [],
    wallMs,
    error: judged.ok ? null : { code: "EVAL_FAIL", message: judged.reason },
    result: judged,
  });
}

function textCold(report) {
  const c = report.counts;
  return [
    `ok ${report.ok}  command ${report.command}  repo ${report.repo}  status ${report.status}`,
    `capSeconds ${report.capSeconds}  wallMs ${report.wallMs}  waitedTenMinutes ${report.waitedTenMinutes}`,
    `boundary.paymentSent ${report.boundary.paymentSent}  boundary.settled ${report.boundary.settled}`,
    `counts.total ${c.total}  pass ${c.pass}  fail ${c.fail}  caught ${c.caught}  missed ${c.missed}`,
    `result.seededCaught ${report.result?.seededCaught}  productCases ${report.result?.productCases}`,
    report.sdk?.present
      ? `sdk @x402/mcp@${report.sdk.version} hasDefaultCap ${report.sdk.hasDefaultCap} pinGap ${report.sdk.pinGap}`
      : "sdk @x402/mcp not installed (derivation fixture still ran)",
    report.exercise?.ok ? `exercise ${report.exercise.reason}` : `exercise FAIL ${report.exercise?.reason}`,
    ...(report.seeded || []).map((row) => `caught ${row.id} claimed ${row.claimedTimeoutMs} derived ${row.derivedTimeoutMs}`),
  ].join("\n");
}

function textSeeded(report) {
  return [
    `ok ${report.ok}  command ${report.command}  status ${report.status}`,
    `error.code: ${report.error?.code}`,
    `error.kind: ${report.error?.kind}`,
    `error.message: ${report.error?.message}`,
    `claimedTimeoutMs: ${report.result?.claimedTimeoutMs}`,
    `derivedTimeoutMs: ${report.result?.derivedTimeoutMs}`,
    `paid: false  settled: false`,
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    if (error?.usage) {
      process.stderr.write(`${error.message}\n${USAGE}`);
      process.exitCode = error.code === "unknown_flag" ? 2 : 1;
      process.stdout.write(`${JSON.stringify({ ok: false, error: { code: error.code, message: error.message } }, null, 2)}\n`);
      return;
    }
    throw error;
  }

  if (args.help) {
    process.stdout.write(USAGE);
    return;
  }

  if (args.list) {
    const catalog = loadCatalog();
    const rows = [
      ...(catalog.cases ?? []).map((item) => ({ id: item.id, kind: item.kind, role: "product" })),
      ...(catalog.seeded ?? []).map((item) => ({ id: item.id, kind: item.kind, role: "seeded" })),
    ];
    const report = { ok: true, command: "list", capSeconds: TEN_MINUTE_SECONDS, rows };
    print(report, { json: args.json, text: rows.map((row) => `${row.role}\t${row.id}\t${row.kind}`).join("\n") });
    return;
  }

  if (args.seededFailure) {
    const report = runSeededFailure();
    print(report, { json: args.json, text: textSeeded(report) });
    process.exitCode = 1;
    return;
  }

  if (args.fixture) {
    const report = runFixture(args.fixture);
    print(report, {
      json: args.json,
      text: report.command === "fixture" && report.error?.code === "SEED_REJECT"
        ? textSeeded(report)
        : `ok ${report.ok}  status ${report.status}  ${report.error?.message || report.result?.reason || ""}`,
    });
    process.exitCode = report.ok ? 0 : 1;
    return;
  }

  const report = await runCold();
  print(report, { json: args.json, text: textCold(report) });
  process.exitCode = report.ok ? 0 : 1;
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || error}\n`);
  process.exitCode = 1;
});
