// Scoped report delivery for the SkillGuard CLI.
// Turns an existing analyze() result into skillguard.report.v1 JSON.
// Does not score, does not scan, and does not execute the scanned tree.
// --show-report is an unverified local viewer. It does not rescan, and the
// stored verdict is not the process exit. Correction text and the rescan line
// are derived from the rule id and the target. The stored rescan object is
// only { derived: true } and is never passed to a shell.

import fs from "node:fs";
import path from "node:path";
import { RULE_CATALOG, correctionFor, labelFor, ruleById } from "./rules.js";
import { escapeTerminal, scannerVersion } from "./version.js";

export const SCHEMA_ID = "skillguard.report.v1";
export const UNVERIFIED_EXIT = 66;
export const UNVERIFIED_LABEL = "unverified: local report viewer. This process did not scan the target. The stored verdict is not a process result.";

export { correctionFor, labelFor };

const VERDICT_EXIT = { clean: 0, suspicious: 2, dangerous: 3 };
const VERDICT_STATE = { clean: "none", suspicious: "review", dangerous: "required" };
const GENERATED_AT = "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z$";
const GENERATED_AT_RE = new RegExp(GENERATED_AT);
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;
const SAFE_TEXT = "^(?!/)[^\\u0000-\\u001f\\u007f-\\u009f]+$";

const REPORT_KEYS = ["schema", "generatedAt", "scanner", "target", "scanned", "fileCount", "verdict", "exitCode", "blanketSafetyScore", "findings", "correction"];
const SCANNER_KEYS = ["name", "version", "staticOnly", "executedTarget"];
const FINDING_KEYS = ["file", "rule", "severity"];
const CORRECTION_KEYS = ["state", "summary", "rescan"];

const SUMMARIES = {
  none: "No flagged files. Re-scan after the tree changes. This report is not a safety score.",
  review: "Review each warning and edit the file if the pattern is unintended, then re-scan this target. This report is not a safety score.",
  required: "Edit each flagged file, then re-scan this target. Do not install while the verdict is dangerous. This report is not a safety score.",
};

export function quoteArg(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

export function displayReportPath(reportPath) {
  const abs = path.resolve(String(reportPath || "skillguard-report.json"));
  const rel = path.relative(process.cwd(), abs);
  if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) return rel.split(path.sep).join("/");
  return path.basename(abs) || "skillguard-report.json";
}

export function canonicalRescan(target, reportPath) {
  return `node index.js ${quoteArg(target)} --report ${quoteArg(displayReportPath(reportPath))}`;
}

export function derivedSteps(findings) {
  return (findings || []).map((finding) => ({
    file: finding.file,
    rule: finding.rule,
    action: correctionFor(finding.rule),
  }));
}

function severitySchema(rule) {
  if (rule.severities.length === 1) return { const: rule.severities[0] };
  return { enum: [...rule.severities] };
}

function findingSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [...FINDING_KEYS],
    properties: {
      file: { type: "string", minLength: 1, pattern: SAFE_TEXT },
      rule: { enum: RULE_CATALOG.map((rule) => rule.id) },
      severity: { enum: ["danger", "warn"] },
    },
    allOf: RULE_CATALOG.map((rule) => ({
      if: { properties: { rule: { const: rule.id } }, required: ["rule"] },
      then: { properties: { severity: severitySchema(rule) } },
    })),
  };
}

function verdictBranch(verdict, findings) {
  const state = VERDICT_STATE[verdict];
  return {
    if: { properties: { verdict: { const: verdict } }, required: ["verdict"] },
    then: {
      properties: {
        exitCode: { const: VERDICT_EXIT[verdict] },
        findings,
        correction: {
          properties: {
            state: { const: state },
            summary: { const: SUMMARIES[state] },
          },
          required: ["state", "summary"],
        },
      },
    },
  };
}

const dangerFinding = {
  type: "object",
  properties: { severity: { const: "danger" } },
  required: ["severity"],
};
const warnFinding = {
  type: "object",
  properties: { severity: { const: "warn" } },
  required: ["severity"],
};

export function buildReportSchema(version = scannerVersion()) {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: SCHEMA_ID,
    title: "SkillGuard scoped report",
    type: "object",
    additionalProperties: false,
    required: [...REPORT_KEYS],
    properties: {
      schema: { const: SCHEMA_ID },
      generatedAt: { type: "string", minLength: 20, pattern: GENERATED_AT },
      scanner: {
        type: "object",
        additionalProperties: false,
        required: [...SCANNER_KEYS],
        properties: {
          name: { const: "skillguard" },
          version: { const: version },
          staticOnly: { const: true },
          executedTarget: { const: false },
        },
      },
      target: { type: "string", minLength: 1, pattern: SAFE_TEXT },
      scanned: { type: "integer", minimum: 0 },
      fileCount: { type: "integer", minimum: 0 },
      verdict: { enum: ["clean", "suspicious", "dangerous"] },
      exitCode: { enum: [0, 2, 3] },
      blanketSafetyScore: { type: "null" },
      findings: { type: "array", items: findingSchema() },
      correction: {
        type: "object",
        additionalProperties: false,
        required: [...CORRECTION_KEYS],
        properties: {
          state: { enum: ["none", "review", "required"] },
          summary: { type: "string", minLength: 1 },
          rescan: {
            type: "object",
            additionalProperties: false,
            required: ["derived"],
            properties: { derived: { const: true } },
          },
        },
      },
    },
    allOf: [
      verdictBranch("clean", { maxItems: 0 }),
      verdictBranch("suspicious", {
        minItems: 1,
        contains: warnFinding,
        not: { contains: dangerFinding },
      }),
      verdictBranch("dangerous", {
        minItems: 1,
        contains: dangerFinding,
      }),
      {
        if: { properties: { findings: { contains: dangerFinding } }, required: ["findings"] },
        then: { properties: { verdict: { const: "dangerous" } } },
      },
      {
        if: {
          properties: { findings: { contains: warnFinding, not: { contains: dangerFinding } } },
          required: ["findings"],
        },
        then: { properties: { verdict: { const: "suspicious" } } },
      },
      {
        if: { properties: { findings: { maxItems: 0 } }, required: ["findings"] },
        then: { properties: { verdict: { const: "clean" } } },
      },
    ],
  };
}

export function schemaDocument() {
  return `${JSON.stringify(buildReportSchema(scannerVersion()), null, 2)}\n`;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameKeys(value, allowed) {
  const keys = Object.keys(value);
  for (const key of keys) if (!allowed.includes(key)) return `unknown field ${key}`;
  for (const key of allowed) if (!Object.hasOwn(value, key)) return `missing ${key}`;
  return null;
}

function plain(value, label) {
  if (typeof value !== "string" || value.length === 0) return `${label} must be a non-empty string`;
  if (CONTROL_RE.test(value)) return `${label} contains a terminal control`;
  return null;
}

function safeScope(value, label) {
  const text = plain(value, label);
  if (text) return text;
  if (value.startsWith("/")) return `${label} must not be an absolute path`;
  return null;
}

let schemaReady = false;
function ensureSchemaParity() {
  if (schemaReady) return;
  const file = fs.readFileSync(new URL("./report.schema.json", import.meta.url), "utf8");
  if (file !== schemaDocument()) throw new Error("Schema/runtime mismatch: report.schema.json");
  schemaReady = true;
}

export function validateReport(report) {
  ensureSchemaParity();
  if (!isObject(report)) return { ok: false, reason: "report must be an object" };
  const root = sameKeys(report, REPORT_KEYS);
  if (root) return { ok: false, reason: root };
  if (report.schema !== SCHEMA_ID) return { ok: false, reason: `schema must be ${SCHEMA_ID}` };
  if (typeof report.generatedAt !== "string" || !GENERATED_AT_RE.test(report.generatedAt)) {
    return { ok: false, reason: "generatedAt must be UTC ISO time" };
  }
  if (!isObject(report.scanner)) return { ok: false, reason: "scanner must be an object" };
  const scannerKeys = sameKeys(report.scanner, SCANNER_KEYS);
  if (scannerKeys) return { ok: false, reason: `scanner ${scannerKeys}` };
  if (report.scanner.name !== "skillguard") return { ok: false, reason: "scanner.name must be skillguard" };
  const versionText = plain(report.scanner.version, "scanner.version");
  if (versionText) return { ok: false, reason: versionText };
  if (report.scanner.version !== scannerVersion()) {
    return { ok: false, reason: "scanner.version does not match this skillguard build" };
  }
  if (report.scanner.staticOnly !== true) return { ok: false, reason: "scanner.staticOnly must be true" };
  if (report.scanner.executedTarget !== false) return { ok: false, reason: "scanner.executedTarget must be false" };
  const targetText = safeScope(report.target, "target");
  if (targetText) return { ok: false, reason: targetText };
  if (!Number.isInteger(report.scanned) || report.scanned < 0) return { ok: false, reason: "scanned must be a non-negative integer" };
  if (!Number.isInteger(report.fileCount) || report.fileCount < 0) return { ok: false, reason: "fileCount must be a non-negative integer" };
  if (!Object.hasOwn(VERDICT_EXIT, report.verdict)) return { ok: false, reason: "verdict must be clean, suspicious, or dangerous" };
  if (report.exitCode !== VERDICT_EXIT[report.verdict]) return { ok: false, reason: "exitCode does not match verdict" };
  if (report.blanketSafetyScore !== null) return { ok: false, reason: "blanketSafetyScore must be null" };
  if (!Array.isArray(report.findings)) return { ok: false, reason: "findings must be an array" };

  for (const finding of report.findings) {
    if (!isObject(finding)) return { ok: false, reason: "finding must be an object" };
    const findingKeys = sameKeys(finding, FINDING_KEYS);
    if (findingKeys) return { ok: false, reason: `finding ${findingKeys}` };
    const ruleText = plain(finding.rule, "finding.rule");
    if (ruleText) return { ok: false, reason: ruleText };
    const fileScope = safeScope(finding.file, "finding.file");
    if (fileScope) return { ok: false, reason: fileScope };
    const rule = ruleById(finding.rule);
    if (!rule) return { ok: false, reason: "finding.rule is not a known rule" };
    if (finding.severity !== "danger" && finding.severity !== "warn") return { ok: false, reason: "finding.severity must be danger or warn" };
    if (!rule.severities.includes(finding.severity)) return { ok: false, reason: "finding.severity does not match rule" };
  }

  const hasDanger = report.findings.some((finding) => finding.severity === "danger");
  const hasWarn = report.findings.some((finding) => finding.severity === "warn");
  const expectedVerdict = hasDanger ? "dangerous" : hasWarn ? "suspicious" : "clean";
  if (report.verdict !== expectedVerdict) return { ok: false, reason: "verdict does not match findings" };

  if (!isObject(report.correction)) return { ok: false, reason: "correction must be an object" };
  const correctionKeys = sameKeys(report.correction, CORRECTION_KEYS);
  if (correctionKeys) {
    if (String(correctionKeys).includes("steps")) return { ok: false, reason: "correction.steps must match findings" };
    return { ok: false, reason: `correction ${correctionKeys}` };
  }
  if (report.correction.state !== VERDICT_STATE[report.verdict]) return { ok: false, reason: "correction.state does not match verdict" };
  const summary = plain(report.correction.summary, "correction.summary");
  if (summary) return { ok: false, reason: summary };
  if (report.correction.summary !== SUMMARIES[report.correction.state]) {
    return { ok: false, reason: "correction.summary is not the canonical summary" };
  }
  if (!isObject(report.correction.rescan)) return { ok: false, reason: "correction.rescan must be an object" };
  if (Object.hasOwn(report.correction.rescan, "command") || report.correction.rescan.derived !== true) {
    return { ok: false, reason: "correction.rescan.command is not the canonical rescan" };
  }
  const rescanKeys = sameKeys(report.correction.rescan, ["derived"]);
  if (rescanKeys) return { ok: false, reason: "correction.rescan.command is not the canonical rescan" };
  const steps = derivedSteps(report.findings);
  if (steps.length !== report.findings.length) return { ok: false, reason: "correction.steps must match findings" };
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].file !== report.findings[i].file || steps[i].rule !== report.findings[i].rule) {
      return { ok: false, reason: "correction step does not match finding" };
    }
    if (steps[i].action !== correctionFor(report.findings[i].rule)) {
      return { ok: false, reason: "correction step action must match finding correction" };
    }
  }
  return { ok: true };
}

export function buildReport(result) {
  if (!result || !Object.hasOwn(VERDICT_EXIT, result.verdict)) {
    throw new Error(`Rejected report: unknown verdict ${result && result.verdict}`);
  }
  const findings = (result.findings || []).map((finding) => ({
    file: escapeTerminal(finding.file),
    rule: finding.rule,
    severity: finding.sev,
  }));
  const state = VERDICT_STATE[result.verdict];
  const target = escapeTerminal(result.target);
  const report = {
    schema: SCHEMA_ID,
    generatedAt: new Date().toISOString(),
    scanner: {
      name: "skillguard",
      version: scannerVersion(),
      staticOnly: true,
      executedTarget: false,
    },
    target,
    scanned: result.scanned,
    fileCount: result.fileCount,
    verdict: result.verdict,
    exitCode: VERDICT_EXIT[result.verdict],
    blanketSafetyScore: null,
    findings,
    correction: {
      state,
      summary: SUMMARIES[state],
      rescan: { derived: true },
    },
  };
  const check = validateReport(report);
  if (!check.ok) throw new Error(`Rejected report: ${check.reason}`);
  return report;
}

export function reportToJson(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function writeReport(filePath, report) {
  const check = validateReport(report);
  if (!check.ok) throw new Error(`Rejected report: ${check.reason}`);
  const abs = path.resolve(filePath);
  const dir = path.dirname(abs);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.skillguard-report-${process.pid}-${Date.now()}.tmp`);
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeFileSync(fd, reportToJson(report));
    fs.fchmodSync(fd, 0o600);
    fs.closeSync(fd);
    fs.renameSync(tmp, abs);
    fs.chmodSync(abs, 0o600);
  } catch (error) {
    try { fs.closeSync(fd); } catch { /* the fd may already be closed */ }
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore cleanup failure */ }
    throw error;
  }
  return abs;
}

export function readReport(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    throw new Error(`Report not found: ${filePath}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Report is not JSON");
  }
  const check = validateReport(data);
  if (!check.ok) throw new Error(`Rejected report: ${check.reason}`);
  return data;
}

export function formatRetrieval(report, reportPath) {
  const show = (value) => escapeTerminal(value);
  const steps = derivedSteps(report.findings);
  const lines = [
    UNVERIFIED_LABEL,
    "SkillGuard report retrieval",
    `schema: ${show(report.schema)}`,
    `target: ${show(report.target)}`,
    `verdict: ${show(report.verdict)}`,
    `exitCode: ${show(report.exitCode)}`,
    "blanketSafetyScore: null",
    "staticOnly: true",
    "executedTarget: false",
    "",
    `Correction (${show(report.correction.state)})`,
  ];
  if (!steps.length) lines.push("  No file changes required.");
  for (const step of steps) {
    lines.push(`  ${show(step.file)} [${show(step.rule)}]`);
    lines.push(`    ${show(labelFor(step.rule))}`);
    lines.push(`    ${show(step.action)}`);
  }
  lines.push(`Rescan: ${show(canonicalRescan(report.target, reportPath))}`);
  lines.push(show(report.correction.summary));
  lines.push("");
  return lines.join("\n");
}
