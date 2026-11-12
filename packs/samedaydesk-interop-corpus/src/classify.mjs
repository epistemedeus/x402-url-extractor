import { loadCorpus, loadPin, loadProfile } from "./corpus.mjs";

export const REPORT_SCHEMA = "samedaydesk.interop-corpus.conformance-report.v1";
export const UNEXPLAINED = "unexplained_failure";

export const BASELINE_STATEMENT = "Baseline-relative result for the recorded SameDayDesk free page-change profile. "
  + "Exit 0 means no harness failure and no unexplained failure against this recorded baseline. "
  + "It is not universal conformance and not a certification claim.";

function errorText(check) {
  return [check?.errorMessage, check?.details ? JSON.stringify(check.details) : ""].filter(Boolean).join(" ");
}

function runnerMatchFor(cases, revision, scenario, check) {
  for (const entry of cases) {
    const match = entry.runnerMatch;
    if (!match) continue;
    if (match.revision !== revision || match.scenario !== scenario || match.checkId !== check.id) continue;
    if (new RegExp(match.errorPattern).test(errorText(check))) return entry;
  }
  return null;
}

function revisionApplicability(profile, revision, scenario) {
  const rev = profile.revisions?.[revision];
  if (!rev) return { applicability: "unknown_revision", reason: `revision ${revision} is not in the recorded profile` };
  for (const [extensionId, extension] of Object.entries(rev.extensions || {})) {
    if (extension.scenarioPrefix && scenario.startsWith(extension.scenarioPrefix)) {
      return { ...extension, extensionId };
    }
  }
  if (rev.scenarios?.[scenario]) return rev.scenarios[scenario];
  if (!rev.served && rev.default) return rev.default;
  return { applicability: rev.unlisted || "applicable", reason: "not listed in the recorded profile" };
}

/**
 * Map one official-runner check to an outcome class. The five classes are
 * successful, known_failure, unsupported, not_applicable, harness_failure.
 * A failure that fits none of them is reported as unexplained_failure, which
 * blocks the baseline instead of being excused.
 */
export function classifyCheck({ revision, scenario, check }, { profile = loadProfile(), cases = loadCorpus() } = {}) {
  const status = check?.status;
  const harness = profile.harness || {};
  const base = { revision, scenario, checkId: check?.id ?? null, status: status ?? null };

  if ((harness.checkIds || []).includes(check?.id) && status === "FAILURE") {
    return { ...base, outcomeClass: "harness_failure", blocking: true, reason: `runner harness check ${check.id} failed` };
  }
  if ((harness.descriptions || []).includes(check?.description) && status === "FAILURE") {
    return { ...base, outcomeClass: "harness_failure", blocking: true, reason: check.errorMessage || "runner failed to run the scenario" };
  }
  if (!["SUCCESS", "FAILURE", "WARNING", "SKIPPED", "INFO"].includes(status)) {
    return { ...base, outcomeClass: "harness_failure", blocking: true, reason: `unrecognized check status ${String(status)}` };
  }
  if (status === "SUCCESS") {
    return { ...base, outcomeClass: "successful", blocking: false, reason: null };
  }
  if (status === "SKIPPED" || status === "INFO") {
    return { ...base, outcomeClass: "not_applicable", blocking: false, reason: `runner reported ${status}` };
  }

  const known = runnerMatchFor(cases, revision, scenario, check);
  if (known) {
    return { ...base, outcomeClass: "known_failure", blocking: false, reason: known.title, caseRef: known.id };
  }

  const applicability = revisionApplicability(profile, revision, scenario);
  if (applicability.applicability === "unsupported") {
    return { ...base, outcomeClass: "unsupported", blocking: false, reason: applicability.reason, caseRef: applicability.caseRef ?? null };
  }
  if (applicability.applicability === "not_applicable") {
    return { ...base, outcomeClass: "not_applicable", blocking: false, reason: applicability.reason };
  }
  return {
    ...base,
    outcomeClass: UNEXPLAINED,
    blocking: status === "FAILURE",
    reason: check?.errorMessage || `${status} on an applicable requirement; triage it into the corpus or fix it`,
  };
}

function harnessEntry(revision, scenario, reason) {
  return { revision, scenario, checkId: null, status: null, outcomeClass: "harness_failure", blocking: true, reason };
}

const ORDER = ["harness_failure", UNEXPLAINED, "known_failure", "unsupported", "not_applicable", "successful"];

function scoredFlag(leg, scenario) {
  return Array.isArray(leg.scoredScenarios) ? leg.scoredScenarios.includes(scenario) : null;
}

function worst(classes) {
  for (const name of ORDER) if (classes.includes(name)) return name;
  return "not_applicable";
}

/**
 * Build the machine report from parsed runner legs.
 * Each leg: { revision, exitCode, signal, timedOut, spawnError, expectedScenarios, scenarios: [{ scenario, checks, parseError }] }
 */
export function buildReport(legs, { profile = loadProfile(), cases = loadCorpus(), pin = loadPin(), target = null, observedAt = null } = {}) {
  const entries = [];
  const revisions = [];
  for (const leg of legs) {
    const legEntries = [];
    if (leg.spawnError) legEntries.push(harnessEntry(leg.revision, null, `runner did not start: ${leg.spawnError}`));
    if (leg.timedOut) legEntries.push(harnessEntry(leg.revision, null, "runner exceeded the adapter timeout and was stopped"));
    if (leg.exitCode !== undefined && leg.exitCode !== null && ![0, 1].includes(leg.exitCode)) {
      legEntries.push(harnessEntry(leg.revision, null, `runner exited with unexpected code ${leg.exitCode}`));
    }
    if (leg.signal) legEntries.push(harnessEntry(leg.revision, null, `runner ended by signal ${leg.signal}`));
    const scenarios = [];
    const seen = new Set();
    for (const item of leg.scenarios || []) {
      seen.add(item.scenario);
      const checks = [];
      if (item.parseError) {
        checks.push(harnessEntry(leg.revision, item.scenario, `checks.json did not parse: ${item.parseError}`));
      } else if (!Array.isArray(item.checks)) {
        checks.push(harnessEntry(leg.revision, item.scenario, "checks.json is not an array"));
      } else {
        for (const check of item.checks) {
          checks.push(classifyCheck({ revision: leg.revision, scenario: item.scenario, check }, { profile, cases }));
        }
        if (item.checks.length === 0) {
          checks.push({ revision: leg.revision, scenario: item.scenario, checkId: null, status: null, outcomeClass: "not_applicable", blocking: false, reason: "runner emitted no checks" });
        }
      }
      legEntries.push(...checks);
      scenarios.push({ scenario: item.scenario, scored: scoredFlag(leg, item.scenario), outcomeClass: worst(checks.map((c) => c.outcomeClass)), checks });
    }
    const served = profile.revisions?.[leg.revision]?.served !== false;
    for (const name of leg.expectedScenarios || []) {
      if (!seen.has(name)) {
        // On a refused revision a scenario may throw before writing checks.json
        // because the wire itself is refused; that is the declared refusal, not
        // a harness fault. On a served revision it is a broken measurement.
        const entry = served
          ? harnessEntry(leg.revision, name, "scenario named by the requirement set produced no checks.json (not measured)")
          : {
            revision: leg.revision,
            scenario: name,
            checkId: null,
            status: null,
            outcomeClass: "unsupported",
            blocking: false,
            reason: "no checks.json on a revision the profile refuses; not measured",
            caseRef: profile.revisions?.[leg.revision]?.default?.caseRef ?? null,
          };
        legEntries.push(entry);
        scenarios.push({ scenario: name, scored: scoredFlag(leg, name), outcomeClass: entry.outcomeClass, checks: [entry] });
      }
    }
    if ((leg.scenarios || []).length === 0 && !legEntries.some((e) => e.outcomeClass === "harness_failure")) {
      legEntries.push(harnessEntry(leg.revision, null, "runner produced no scenario results"));
    }
    entries.push(...legEntries);
    revisions.push({
      revision: leg.revision,
      wire: profile.revisions?.[leg.revision]?.wire ?? null,
      served: profile.revisions?.[leg.revision]?.served ?? null,
      runnerExitCode: leg.exitCode ?? null,
      runnerExitCodeIsVerdict: false,
      harness: legEntries.filter((entry) => entry.scenario === null),
      scenarios,
    });
  }
  const totals = Object.fromEntries([...ORDER].map((name) => [name, entries.filter((e) => e.outcomeClass === name).length]));
  const blocking = entries.filter((e) => e.blocking);
  return {
    schema: REPORT_SCHEMA,
    scope: "baseline-relative",
    universalConformance: false,
    certification: false,
    statement: BASELINE_STATEMENT,
    observedAt,
    target,
    profile: { name: profile.profile, merchantCommit: profile.merchantCommit },
    runner: {
      package: pin.officialRunner.package,
      version: pin.officialRunner.version,
      gitHead: pin.officialRunner.gitHead,
    },
    revisions,
    totals,
    blocking: blocking.length,
    exitCode: blocking.length === 0 ? 0 : 1,
  };
}
