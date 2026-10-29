import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { maintainCycle } from "./maintain.mjs";
import { INTEGRATION_RECOMMENDATION } from "./recommendation.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_ROOT = join(ROOT, "..", "fixtures");
export const PIN = Object.freeze({ ecosystem: "npm", name: "axios", version: "1.19.0" });
export const PAGE_URL = "https://github.com/advisories/GHSA-3pq3-5fj3-cg6v";

function readJson(name) {
  return JSON.parse(readFileSync(join(FIXTURE_ROOT, name), "utf8"));
}

function shiftFixed(document, from, to) {
  const copy = structuredClone(document);
  for (const advisory of copy.vulns ?? []) {
    for (const affected of advisory.affected ?? []) {
      for (const range of affected.ranges ?? []) {
        for (const event of range.events ?? []) {
          if (event.fixed === from) event.fixed = to;
        }
      }
    }
  }
  return copy;
}

export async function runScenarios() {
  const osv = readJson("osv-query-axios-1.19.0.json");
  const page = readFileSync(join(FIXTURE_ROOT, "github-advisory-GHSA-3pq3-5fj3-cg6v.html"));
  const falseClear = readFileSync(join(FIXTURE_ROOT, "laboratory/false-clear.html"));
  const errorPage = readFileSync(join(FIXTURE_ROOT, "laboratory/error-page-says-clear.html"));
  const shifted = shiftFixed(osv, "1.20.0", "1.21.0");
  const shiftedPage = Buffer.from(page.toString("utf8").replaceAll("1.20.0", "1.21.0"), "utf8");
  const base = {
    pin: PIN,
    pageUrl: PAGE_URL,
    osvDocument: osv,
    pageHtml: page,
    pageClass: "primary-capture",
  };
  const initial = await maintainCycle(base);
  const previous = initial.acceptedState;
  const noChange = await maintainCycle({ ...base, previous });
  const recordOnly = await maintainCycle({
    ...base,
    osvDocument: shifted,
    pageClass: "laboratory-mutation",
    previous,
  });
  const change = await maintainCycle({
    ...base,
    osvDocument: shifted,
    pageHtml: shiftedPage,
    pageClass: "laboratory-mutation",
    previous,
  });
  const semanticFailure = await maintainCycle({
    ...base,
    pageHtml: falseClear,
    pageClass: "laboratory-mutation",
    previous,
  });
  const recovery = await maintainCycle({
    ...base,
    pageHtml: errorPage,
    pageStatus: 503,
    pageClass: "laboratory-mutation",
    previous,
  });
  const directOnly = await maintainCycle({
    ...base,
    pageHtml: errorPage,
    pageStatus: 503,
    pageClass: "laboratory-mutation",
  });
  return {
    pin: PIN,
    pageUrl: PAGE_URL,
    recommendation: INTEGRATION_RECOMMENDATION,
    initial,
    noChange,
    recordOnly,
    change,
    semanticFailure,
    recovery,
    directOnly,
  };
}

export function assertScenarioContract(scenarios) {
  const problems = [];
  const expect = (condition, message) => {
    if (!condition) problems.push(message);
  };
  const initial = scenarios.initial.report;
  const noChange = scenarios.noChange.report;
  const recordOnly = scenarios.recordOnly.report;
  const change = scenarios.change.report;
  const semantic = scenarios.semanticFailure.report;
  const recovery = scenarios.recovery.report;
  const directOnly = scenarios.directOnly.report;

  expect(initial.cycle === "initial", `initial cycle ${initial.cycle}`);
  expect(initial.decision === "affected", `initial decision ${initial.decision}`);
  expect(initial.direct.affectingIds.length === 12, `affecting ${initial.direct.affectingIds.length}`);
  expect(initial.direct.sufficient === true, "direct feed not sufficient");
  expect(initial.productWin === false, "initial product win");
  expect(initial.reader.defaultExcerptCarriesRange === false, "default excerpt unexpectedly carried the range");
  expect(initial.reader.raisedExtractCarriesRange === true, "raised extract missed the range");
  expect(initial.reader.markdownCarriesRange === true, "markdown reader missed the range");
  expect(initial.reader.agreement.state === "agrees", `initial agreement ${initial.reader.agreement.state}`);
  expect(initial.reader.agreement.readerCoversEveryAffectingAdvisory === false, "one page covered every advisory");
  expect(initial.reader.agreement.explicitPinClearance === false, "real page cleared the pin");
  expect(initial.reader.browserAdapterQualifierSeen === true, "browser-adapter qualifier was not in the raised extract");
  expect(initial.fresh === false, "initial claimed fresh");
  expect(initial.charged === false && initial.pricing === null, "initial priced the prototype");
  expect(initial.effort.ledgerWrite === false, "initial wrote a ledger");
  expect(initial.monitor === null, "initial compared without a previous page");

  expect(noChange.cycle === "no_change", `no_change cycle ${noChange.cycle}`);
  expect(noChange.decision === "affected", "no_change decision moved");
  expect(noChange.noChangeProven === true, "no_change was not proven");
  expect(noChange.monitor?.verdict === "unchanged", `no_change monitor ${noChange.monitor?.verdict}`);
  expect(noChange.monitor?.fresh === false, "no_change monitor claimed fresh");
  expect(noChange.monitor?.paymentImpliesUsefulOutput === false, "monitor treated payment as usefulness");
  expect(noChange.recordChanged === false, "no_change record changed");

  expect(recordOnly.cycle === "change", `record-only cycle ${recordOnly.cycle}`);
  expect(recordOnly.changeKind === "record", `record-only kind ${recordOnly.changeKind}`);
  expect(recordOnly.decision === "affected", "record-only cleared the pin");
  expect(recordOnly.pageNoChangeDoesNotDecidePin === true, "unchanged page was allowed to decide the pin");
  expect(recordOnly.monitor?.noChangeProven === true, "record-only page was not unchanged");
  expect(recordOnly.productWin === false, "record-only product win");

  expect(change.cycle === "change", `change cycle ${change.cycle}`);
  expect(change.changeKind === "record_and_page", `change kind ${change.changeKind}`);
  expect(change.decision === "affected", "page-and-record change cleared the pin");
  expect(change.monitor?.verdict === "changed", `change monitor ${change.monitor?.verdict}`);
  expect(change.recordChanged === true, "change record digest stayed equal");
  expect(change.reader.agreement.state === "agrees", `changed page agreement ${change.reader.agreement.state}`);

  expect(semantic.cycle === "semantic_failure", `semantic cycle ${semantic.cycle}`);
  expect(semantic.decision === "affected", "semantic failure cleared the pin");
  expect(semantic.decisionSource === "osv-json", "semantic failure trusted the page");
  expect(semantic.reader.agreement.state === "contradicts", `semantic agreement ${semantic.reader.agreement.state}`);
  expect(semantic.reader.agreement.reasons.includes("explicit_pin_clearance"), "missing explicit clearance reason");
  expect(semantic.reader.agreement.reasons.includes("stated_range_excludes_pin"), "missing range contradiction");
  expect(semantic.productWin === false, "semantic failure became a product win");

  expect(recovery.cycle === "recovery", `recovery cycle ${recovery.cycle}`);
  expect(recovery.decision === "affected", "recovery cleared the pin");
  expect(recovery.recovered === true, "recovery flag missing");
  expect(recovery.noChangeProven === false, "failed page proved no change");
  expect(recovery.monitor?.verdict === "incomplete", `recovery monitor ${recovery.monitor?.verdict}`);
  expect(recovery.refusedPageClearance === true, "error page clearance was not refused");
  expect(recovery.reader.refused === true, "recovery accepted the error page");
  expect(scenarios.recovery.acceptedState === scenarios.initial.acceptedState, "recovery replaced the last good page batch");

  expect(directOnly.cycle === "direct_only", `direct-only cycle ${directOnly.cycle}`);
  expect(directOnly.decision === "affected", "direct-only cleared the pin");
  expect(directOnly.recovered === false, "direct-only pretended to recover a missing baseline");
  expect(directOnly.refusedPageClearance === true, "direct-only accepted the error-page clearance");
  expect(directOnly.reader.refused === true, "direct-only accepted the error page");
  expect(directOnly.reader.httpStatus === 503, `direct-only http status ${directOnly.reader.httpStatus}`);
  expect(scenarios.directOnly.acceptedState?.batch == null, "direct-only stored the failed page as a baseline");
  expect(recovery.reader.httpStatus === 503, `recovery http status ${recovery.reader.httpStatus}`);
  expect(recovery.reader.code === "http_503", `recovery code ${recovery.reader.code}`);

  for (const [name, result] of Object.entries(scenarios)) {
    if (!result?.report?.effort) continue;
    const effort = result.report.effort;
    expect(effort.pricing === null && effort.charged === false && effort.ledgerWrite === false, `${name} effort priced or charged`);
    expect(Number.isFinite(effort.elapsedMs) && effort.elapsedMs >= 0, `${name} effort elapsed missing`);
    expect(effort.directParses === 1, `${name} did not parse the direct feed`);
  }
  if (problems.length) {
    throw new Error(problems.join("\n"));
  }
}
