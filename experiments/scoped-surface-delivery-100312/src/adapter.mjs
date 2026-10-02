import path from "node:path";
import { fileURLToPath } from "node:url";

import { budgetFromLimits } from "./budget.mjs";
import { runBoundedChild } from "./bounded-child.mjs";
import { inputFailure, validateInventory } from "./intake.mjs";
import { materializeInventory, removeTree } from "./materialize.mjs";
import {
  CONCERN_DECIDE,
  LIMITS,
  NEGATIVE_LIMITS,
  RULE_IDS,
  SCHEMA,
  SKILLGUARD,
} from "./pins.mjs";
import { redactTree } from "./redact.mjs";

const CHILD = fileURLToPath(new URL("./scan-child.mjs", import.meta.url));

function concernMatch(concernId, finding) {
  if (concernId === "any-danger") return finding.severity === "danger";
  if (concernId.startsWith("rule:")) return finding.rule === concernId.slice(5);
  return false;
}

function baseReport(inventory, extra) {
  return redactTree({
    schema: SCHEMA,
    taskId: inventory?.taskId || null,
    callerId: inventory?.callerId || null,
    contextId: inventory?.contextId || null,
    concern: inventory ? {
      id: inventory.concern.id,
      statement: inventory.concern.statement,
      result: extra.concernResult,
      reason: extra.concernReason || null,
      universalGuarantee: false,
    } : { result: extra.concernResult, universalGuarantee: false },
    scanner: {
      name: "skillguard",
      version: SKILLGUARD.version,
      commit: SKILLGUARD.commit,
      licenseDeclared: SKILLGUARD.licenseDeclared,
      licenseFile: SKILLGUARD.licenseFile,
      staticOnly: true,
      executedTarget: false,
      examinedRules: RULE_IDS,
    },
    examined: extra.examined || { fileCount: 0, textFiles: 0, bytes: 0, paths: [] },
    scannerVerdict: extra.scannerVerdict ?? null,
    scannerExit: extra.scannerExit ?? null,
    exitCode: extra.exitCode,
    blanketSafetyScore: null,
    findings: extra.findings || [],
    limits: {
      maxFiles: LIMITS.maxFiles,
      maxAggregateBytes: LIMITS.maxAggregateBytes,
      deadlineMs: extra.deadlineMs ?? inventory?.deadlineMs ?? LIMITS.deadlineMs,
      maxOutputBytes: extra.maxOutputBytes ?? inventory?.maxOutputBytes ?? LIMITS.maxOutputBytes,
      breached: extra.breached || [],
    },
    negativeLimits: NEGATIVE_LIMITS,
    inputError: extra.inputError || null,
    measurement: extra.measurement,
    authority: extra.authority,
    scanPerformed: extra.scanPerformed,
    freeBaseline: "npx github:epistemedeus/skillguard <local-tree>",
  });
}

function measurement(prepMicros, child) {
  return {
    requesterPrepMicros: prepMicros,
    wallMs: child ? Math.round(child.wallMs * 1000) / 1000 : 0,
    cpuUserMicros: child?.parsed?.cpuUserMicros ?? null,
    cpuSystemMicros: child?.parsed?.cpuSystemMicros ?? null,
    contributorPrepMicros: null,
    cash: "unknown",
    tokens: "unknown",
    profit: "unknown",
    recognizedRevenueAtomic: "0",
  };
}

function childEnv(skillguardRoot) {
  return {
    PATH: process.env.PATH || "",
    SKILLGUARD_ROOT: skillguardRoot,
  };
}

export async function runScan(request, { skillguardRoot, childScript = CHILD, budget = null } = {}) {
  const operation = budget || budgetFromLimits(request?.limits);
  const prepStarted = process.hrtime.bigint();
  const validated = validateInventory(request);
  if (!validated.ok) {
    const prepMicros = Number(process.hrtime.bigint() - prepStarted) / 1000;
    return baseReport(null, {
      concernResult: "input_error",
      exitCode: 64,
      inputError: { code: "input_error", errors: validated.errors },
      measurement: measurement(prepMicros, null),
      authority: "none",
      scanPerformed: false,
    });
  }
  const inventory = validated.value;
  const reportedLimits = budget ? {
    deadlineMs: operation.deadlineMs,
    maxOutputBytes: operation.maxOutputBytes,
  } : {};
  let placed = null;
  try {
    placed = materializeInventory(inventory.files);
  } catch (error) {
    const code = error.code === "symlink" ? "symlink" : "path_traversal";
    return inputReport(inventory, [code], prepStarted);
  }
  const prepMicros = Number(process.hrtime.bigint() - prepStarted) / 1000;
  const remainingMs = operation.remainingMs();
  const remainingOutput = operation.remainingOutput();
  if (remainingMs < 1 || remainingOutput < 1) {
    removeTree(placed.root);
    const reason = remainingOutput < 1 ? "output_bounded" : "cancelled";
    return stopped(inventory, prepMicros, { wallMs: 0 }, reason, [remainingOutput < 1 ? "output" : "deadline"], reportedLimits);
  }
  operation.noteSpawn();
  const child = await runBoundedChild({
    command: process.execPath,
    args: [childScript, placed.tree],
    cwd: placed.root,
    env: childEnv(skillguardRoot),
    deadlineMs: Math.max(1, Math.floor(remainingMs)),
    maxStdout: remainingOutput,
    maxStderr: Math.min(LIMITS.maxStderrBytes, remainingOutput),
  });
  operation.chargeOutput(child.stdout.length + child.stderr.length);
  removeTree(placed.root);
  if (child.timedOut) {
    return stopped(inventory, prepMicros, child, "cancelled", ["deadline"], reportedLimits);
  }
  if (child.overOutput) {
    return stopped(inventory, prepMicros, child, "output_bounded", ["output"], reportedLimits);
  }
  let parsed;
  try {
    parsed = JSON.parse(child.stdout.toString("utf8"));
  } catch {
    return stopped(inventory, prepMicros, child, "child_output", ["output"], reportedLimits);
  }
  if (!parsed.ok) {
    return stopped(inventory, prepMicros, child, parsed.error || "scan_failed", [], reportedLimits);
  }
  const findings = (parsed.findings || []).map((finding) => ({
    file: finding.file,
    rule: finding.rule,
    severity: finding.sev,
    concernMatch: concernMatch(inventory.concern.id, { rule: finding.rule, severity: finding.sev }),
  }));
  const exitByVerdict = { clean: 0, suspicious: 2, dangerous: 3 };
  const scannerExit = exitByVerdict[parsed.verdict];
  if (scannerExit === undefined || parsed.version !== SKILLGUARD.version) {
    return stopped(inventory, prepMicros, child, "scanner_pin_mismatch", [], reportedLimits);
  }
  let concernResult = "no_match";
  let concernReason = "rule_absent";
  if (inventory.concern.id === CONCERN_DECIDE) {
    concernResult = "inconclusive";
    concernReason = "scanner_cannot_decide";
  } else if (findings.some((finding) => finding.concernMatch)) {
    concernResult = "match";
    concernReason = "rule_present";
  }
  return baseReport(inventory, {
    concernResult,
    concernReason,
    examined: {
      fileCount: inventory.files.length,
      textFiles: parsed.scanned,
      bytes: inventory.totalBytes,
      paths: inventory.files.map((file) => file.path),
    },
    scannerVerdict: parsed.verdict,
    scannerExit,
    exitCode: scannerExit,
    findings,
    measurement: {
      ...measurement(prepMicros, { wallMs: child.wallMs, parsed }),
    },
    authority: "pinned_scanner",
    scanPerformed: true,
    ...reportedLimits,
  });
}

function inputReport(inventory, errors, prepStarted) {
  const failure = inputFailure(errors);
  return baseReport(inventory, {
    concernResult: "input_error",
    exitCode: 64,
    inputError: failure.inputError,
    measurement: measurement(Number(process.hrtime.bigint() - prepStarted) / 1000, null),
    authority: "none",
    scanPerformed: false,
  });
}

function stopped(inventory, prepMicros, child, reason, breached, reportedLimits = {}) {
  return baseReport(inventory, {
    ...reportedLimits,
    concernResult: "inconclusive",
    concernReason: reason,
    exitCode: 65,
    scannerVerdict: null,
    scannerExit: null,
    breached,
    examined: {
      fileCount: inventory.files.length,
      textFiles: 0,
      bytes: inventory.totalBytes,
      paths: inventory.files.map((file) => file.path),
    },
    measurement: measurement(prepMicros, { wallMs: child.wallMs, parsed: null }),
    authority: "none",
    scanPerformed: false,
  });
}

export function concernKeys(report) {
  return (report.findings || [])
    .filter((finding) => finding.concernMatch)
    .map((finding) => `${finding.file}\0${finding.rule}`)
    .sort();
}

export function rankExit(codes) {
  const order = [64, 65, 3, 2, 66, 0];
  for (const code of order) {
    if (codes.includes(code)) return code;
  }
  return 65;
}

export function childScriptPath() {
  return CHILD;
}
