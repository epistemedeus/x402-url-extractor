import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { redact } from "./redact.mjs";

// --show-report is the pinned scanner's unverified viewer. It is not a scan.
export function viewStoredReport(report, skillguardRoot) {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    return { scanPerformed: false, authority: "none", exitCode: 64, inputError: { errors: ["malformed"] }, universalGuarantee: false, blanketSafetyScore: null };
  }
  if (typeof report.path === "string" || typeof report.reportPath === "string") {
    return { scanPerformed: false, authority: "none", exitCode: 64, inputError: { errors: ["path_not_accepted"] }, universalGuarantee: false, blanketSafetyScore: null };
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scoped-report-"));
  const file = path.join(dir, "report.json");
  try {
    fs.writeFileSync(file, JSON.stringify(report), { mode: 0o600 });
    const child = spawnSync(process.execPath, [path.join(skillguardRoot, "index.js"), "--show-report", file], {
      encoding: "utf8",
      cwd: dir,
      env: { PATH: process.env.PATH || "" },
    });
    const first = redact((child.stdout || child.stderr || "").split("\n")[0] || "");
    return {
      scanPerformed: false,
      authority: "none",
      unverified: child.status === 66,
      exitCode: child.status ?? 65,
      label: first,
      universalGuarantee: false,
      blanketSafetyScore: null,
      storedVerdictIsProcessResult: false,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
