/**
 * Isolation + fixture self-check. Writes receipts/self-check.json under this cell.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { engineRecord, isDirectRun } from "./engine.mjs";
import { sha256Hex, stableStringify } from "./lib/hash.mjs";
import {
  assertNoScriptRan,
  CELL_ROOT,
  isolationSnapshot,
  listFilesRecursive,
} from "./isolation.mjs";
import { extractPackageTypes } from "./types-entry.mjs";
import { runAllCases } from "./run.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

export function runSelfCheck() {
  const isolation = isolationSnapshot();
  const cases = runAllCases();
  const traversal = extractPackageTypes(join(HERE, "fixtures/hostile/traversal"), {
    packageName: "evil-types",
    label: "synthetic",
  });
  const oldPkg = join(HERE, "fixtures/packages/type-kit/1.0.0");
  const scripts = {
    old: assertNoScriptRan(oldPkg),
    traversal: assertNoScriptRan(join(HERE, "fixtures/hostile/traversal")),
  };
  const engine = engineRecord();
  const files = listFilesRecursive(HERE).map((f) => f.slice(HERE.length + 1));

  const ok =
    isolation.ownedWritesOk &&
    cases.every((c) => c.ok) &&
    traversal.ok === false &&
    scripts.old.ok &&
    scripts.traversal.ok &&
    engine.claimsFullChecker === false;

  const report = {
    schema: "s127.c18.dts-self-check.v1",
    clock: "2026-09-10T12:00:00.000Z",
    ok,
    isolation,
    engine,
    cases: cases.map((c) => ({
      id: c.caseId,
      ok: c.ok,
      nextAction: c.packet?.summary?.nextAction ?? null,
      failures: c.checks?.failures || (c.error ? [c.error] : []),
    })),
    traversalRefused: traversal.ok === false,
    scriptRanAbsent: scripts,
    label: "synthetic",
    liveCapture: false,
    paidDemand: false,
    claimsFullChecker: false,
    filesWrittenUnderCell: files.length,
  };

  const receiptsDir = join(HERE, "receipts");
  mkdirSync(receiptsDir, { recursive: true });
  const bytes = `${stableStringify(report)}\n`;
  writeFileSync(join(receiptsDir, "self-check.json"), bytes);
  return { ok, report, sha256: sha256Hex(bytes), path: join(receiptsDir, "self-check.json") };
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  const result = runSelfCheck();
  process.stdout.write(
    `${result.ok ? "PASS" : "FAIL"} c18 self-check sha256=${result.sha256} path=${result.path}\n`,
  );
  if (!result.ok) {
    for (const c of result.report.cases) {
      if (!c.ok) process.stdout.write(`  ${c.id}: ${c.failures.join("; ")}\n`);
    }
    process.exitCode = 1;
  }
}
