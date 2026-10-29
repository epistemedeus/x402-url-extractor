#!/usr/bin/env node
import { assertScenarioContract, runScenarios } from "../src/scenarios.mjs";

function summarize(name, result) {
  const report = result.report;
  return {
    name,
    cycle: report.cycle,
    changeKind: report.changeKind,
    decision: report.decision,
    decisionSource: report.decisionSource,
    affecting: report.direct.affectingIds.length,
    sufficient: report.direct.sufficient,
    recovered: report.recovered,
    noChangeProven: report.noChangeProven,
    productWin: report.productWin,
    refusedPageClearance: report.refusedPageClearance,
    agreement: report.reader?.agreement?.state ?? null,
    pageRefused: report.reader?.refused === true,
    monitor: report.monitor?.verdict ?? null,
    defaultExcerptCarriesRange: report.reader?.defaultExcerptCarriesRange ?? null,
    raisedExtractCarriesRange: report.reader?.raisedExtractCarriesRange ?? null,
    markdownCarriesRange: report.reader?.markdownCarriesRange ?? null,
    effort: report.effort,
  };
}

const scenarios = await runScenarios();
assertScenarioContract(scenarios);
const summary = {
  schema: "samedaydesk.repeat-outcome.advisory.summary.v0",
  pin: scenarios.pin,
  pageUrl: scenarios.pageUrl,
  productWin: false,
  recommendation: scenarios.recommendation,
  cycles: [
    summarize("initial", scenarios.initial),
    summarize("noChange", scenarios.noChange),
    summarize("recordOnly", scenarios.recordOnly),
    summarize("change", scenarios.change),
    summarize("semanticFailure", scenarios.semanticFailure),
    summarize("recovery", scenarios.recovery),
    summarize("directOnly", scenarios.directOnly),
  ],
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
