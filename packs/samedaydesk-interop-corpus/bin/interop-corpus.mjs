#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  buildReport,
  loadCorpus,
  loadResiduals,
  loadSkipped,
  readLegResults,
  runOfficialConformance,
} from "../src/index.mjs";

const USAGE = `usage:
  interop-corpus cases
  interop-corpus conformance --url <mcp endpoint> --out <dir> [--revisions 2025-11-25,2026-07-28] [--report <file>] [--scenario-timeout <ms>]
  interop-corpus classify (--fixture <legs.json> | --results <dir> [--revisions ...]) [--report <file>]

The report is baseline-relative. Exit 0 is not universal conformance and not a certification claim.`;

function emit(value, reportPath) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (reportPath) writeFileSync(reportPath, text);
  process.stdout.write(text);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({
    args: rest,
    options: {
      url: { type: "string" },
      out: { type: "string" },
      revisions: { type: "string", default: "2025-11-25,2026-07-28" },
      report: { type: "string" },
      fixture: { type: "string" },
      results: { type: "string" },
      "scenario-timeout": { type: "string", default: "10000" },
    },
    allowPositionals: false,
  });
  const revisions = values.revisions.split(",").map((item) => item.trim()).filter(Boolean);

  if (command === "cases") {
    const cases = loadCorpus().map((entry) => ({
      id: entry.id,
      title: entry.title,
      author: entry.author.name,
      publication: entry.publication.allowed,
      earlierNegative: { kind: entry.earlierNegative.kind, commit: entry.earlierNegative.commit },
      outcomeClass: entry.outcomeClass,
      consumer: entry.consumer,
    }));
    emit({ schema: "samedaydesk.interop-corpus.cases.v1", cases, residuals: loadResiduals().residuals.map((r) => r.id), skipped: loadSkipped().skipped.length });
    return 0;
  }
  if (command === "conformance") {
    if (!values.url || !values.out) throw new Error("--url and --out are required");
    const report = await runOfficialConformance({
      url: values.url,
      outRoot: values.out,
      revisions,
      scenarioTimeoutMs: Number(values["scenario-timeout"]),
    });
    emit(report, values.report);
    return report.exitCode;
  }
  if (command === "classify") {
    let legs;
    if (values.fixture) {
      legs = JSON.parse(readFileSync(values.fixture, "utf8")).legs;
    } else if (values.results) {
      legs = revisions.map((revision) => ({ revision, scenarios: readLegResults(join(values.results, revision)) }));
    } else {
      throw new Error("--fixture or --results is required");
    }
    const report = buildReport(legs, { target: null, observedAt: null });
    emit(report, values.report);
    return report.exitCode;
  }
  process.stderr.write(`${USAGE}\n`);
  return 64;
}

main().then((code) => { process.exitCode = code; }, (error) => {
  process.stderr.write(`interop-corpus: ${error.message}\n`);
  process.exitCode = 2;
});
