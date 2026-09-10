import { loadPrior, summarizePrior } from "./lib/prior.mjs";
import { inspectPaymentAuthority } from "./lib/payment.mjs";
import { DEFAULT_URGENT_DAYS, selectEolNextAction, sourceCycleDiff } from "./lib/eol-decision.mjs";
import { normalizeEolObservation } from "./lib/eol-cycles.mjs";
import { evidenceClassFor, fetchOfficialJson, OFFICIAL_JSON_URLS } from "./lib/observe.mjs";
import { failResult, finishResult } from "./lib/result.mjs";
import { tryReadJsonFile } from "./lib/io.mjs";

export const RECIPE_ID = "runtime-eol-watch";
export const RECIPE_SCHEMA = "s122.application-job-result.v1";

export const META = Object.freeze({
  recipeId: RECIPE_ID,
  userBenefit:
    "Given official endoflife.date Node.js rows and an operator clock, emit one next action: upgrade now, schedule an upgrade, monitor, or do nothing.",
  operatorSupplies: [
    "priorPath",
    "scheduleHint",
    "clock",
    "horizonDays",
    "watchCycles",
    "current fixture or --live-official",
    "optional urgentDays and pinnedRuntime",
  ],
  acceptedContracts: [
    "samedaydesk.recurring-job-prior.v1",
    "samedaydesk.recurring-job-recipe-result.v1 outcomes",
  ],
  officialSource: OFFICIAL_JSON_URLS.nodejsEol,
});

export async function runRuntimeEolWatch(input = {}) {
  const clock = input.clock || null;
  const scheduleHint = input.scheduleHint || null;
  if (!clock) {
    return failResult({
      recipeId: RECIPE_ID,
      meta: META,
      code: "missing_clock",
      message: "operator clock is required; the pack does not invent it",
      clock,
      scheduleHint,
    });
  }
  if (!scheduleHint) {
    return failResult({
      recipeId: RECIPE_ID,
      meta: META,
      code: "missing_schedule",
      message: "operator schedule hint is required; the pack does not invent it",
      clock,
      scheduleHint,
    });
  }

  const priorLoad = loadPrior(input.priorPath);
  if (!priorLoad.ok) {
    return failResult({
      recipeId: RECIPE_ID,
      meta: META,
      code: priorLoad.code,
      message: priorLoad.message,
      clock,
      scheduleHint,
    });
  }

  const payment = inspectPaymentAuthority(priorLoad.prior, input);
  if (!payment.ok) {
    return failResult({
      recipeId: RECIPE_ID,
      meta: META,
      code: payment.code,
      message: payment.message,
      clock,
      scheduleHint,
      extra: { payment, prior: summarizePrior(priorLoad) },
    });
  }

  const operator = loadOperator(input);
  const watchCycles =
    operator.watchCycles ||
    input.watchCycles ||
    priorLoad.prior.payload.watchCycles ||
    priorLoad.prior.payload.watch_cycles ||
    null;
  const horizonDays = firstNumber(input.horizonDays, operator.horizonDays);
  const urgentDays = firstNumber(input.urgentDays, operator.urgentDays, DEFAULT_URGENT_DAYS);
  const pinnedRuntime = operator.pinnedRuntime || input.pinnedRuntime || priorLoad.prior.payload.pinnedRuntime || null;

  if (!Array.isArray(watchCycles) || watchCycles.length === 0) {
    return failResult({
      recipeId: RECIPE_ID,
      meta: META,
      code: "missing_watch_cycles",
      message: "operator watchCycles are required; the pack does not invent the runtime list",
      clock,
      scheduleHint,
      extra: { payment, prior: summarizePrior(priorLoad) },
    });
  }
  if (horizonDays == null) {
    return failResult({
      recipeId: RECIPE_ID,
      meta: META,
      code: "missing_horizon_days",
      message: "operator horizonDays is required to choose schedule_upgrade vs monitor",
      clock,
      scheduleHint,
      extra: { payment, prior: summarizePrior(priorLoad) },
    });
  }

  const observed = await observeEol(input, watchCycles);
  if (!observed.ok) {
    return finishResult({
      recipeId: RECIPE_ID,
      meta: META,
      outcome: observed.code === "timed_out" ? "timed_out" : "error",
      clock,
      scheduleHint,
      payment,
      prior: summarizePrior(priorLoad),
      nextAction: null,
      evidence: { kind: "observe_error", code: observed.code, message: observed.message },
    });
  }

  const priorNorm = normalizeEolObservation(priorLoad.prior.payload, watchCycles);
  if (!priorNorm.ok) {
    return failResult({
      recipeId: RECIPE_ID,
      meta: META,
      code: priorNorm.code,
      message: priorNorm.message,
      clock,
      scheduleHint,
      extra: { payment, prior: summarizePrior(priorLoad) },
    });
  }

  const current = observed.observation;
  const sourceDiff = sourceCycleDiff(priorNorm.observation.cycles, current.cycles);
  const priorClock = priorLoad.prior.payload.asOfClock || priorLoad.prior.payload.as_of_clock || priorLoad.prior.createdAt;

  const decision = selectEolNextAction({
    currentCycles: current.cycles,
    priorCycles: priorNorm.observation.cycles,
    clock,
    priorClock,
    horizonDays,
    urgentDays,
    pinnedRuntime,
  });

  const priorDecision = selectEolNextAction({
    currentCycles: priorNorm.observation.cycles,
    priorCycles: priorNorm.observation.cycles,
    clock: priorClock,
    priorClock,
    horizonDays,
    urgentDays,
    pinnedRuntime,
  });

  const deadlineCrossed = decision.nextAction !== priorDecision.nextAction;
  const complete = current.complete && priorNorm.observation.complete && sourceDiff.missing.length === 0;

  let outcome;
  if (!complete || decision.nextAction == null) outcome = "partial";
  else if (sourceDiff.changed.length || deadlineCrossed) outcome = "changed";
  else outcome = "unchanged";

  return finishResult({
    recipeId: RECIPE_ID,
    meta: META,
    outcome,
    clock,
    scheduleHint,
    payment,
    prior: summarizePrior(priorLoad),
    nextAction: outcome === "partial" ? null : decision.nextAction,
    justification: {
      ruleId: decision.ruleId,
      because: decision.because,
      horizonDays,
      urgentDays,
      pinnedRuntime,
      deadlineCrossed,
      priorNextAction: priorDecision.nextAction,
      perCycle: decision.perCycle,
    },
    observation: {
      ...current,
      evidenceClass: observed.evidenceClass,
      source: observed.source,
    },
    diff: sourceDiff,
    evidence: {
      kind: "eol_deadline_compare",
      source: observed.source,
      evidenceClass: observed.evidenceClass,
      changed: sourceDiff.changed,
      unchanged: sourceDiff.unchanged,
      missing: sourceDiff.missing,
      deadlineCrossed,
      complete,
    },
  });
}

function loadOperator(input) {
  if (input.operator && typeof input.operator === "object") return input.operator;
  if (input.operatorPath) {
    const loaded = tryReadJsonFile(input.operatorPath);
    if (!loaded.ok) return {};
    return loaded.body && typeof loaded.body === "object" ? loaded.body : {};
  }
  return {};
}

function firstNumber(...values) {
  for (const value of values) {
    if (value == null || value === "") continue;
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

async function observeEol(input, watchCycles) {
  if (input.currentFixturePath) {
    const loaded = tryReadJsonFile(input.currentFixturePath);
    if (!loaded.ok) return { ok: false, code: loaded.code, message: loaded.message };
    const normalized = normalizeEolObservation(loaded.body, watchCycles);
    if (!normalized.ok) return normalized;
    return {
      ok: true,
      observation: normalized.observation,
      evidenceClass: evidenceClassFor("fixture", input.evidenceClass),
      source: {
        kind: "fixture",
        path: input.currentFixturePath,
        label: loaded.body.label || "current",
        originalUrl: loaded.body.source || OFFICIAL_JSON_URLS.nodejsEol,
        capturedFromLive: loaded.body.captured_from_live_api === true,
        asOfClock: loaded.body.as_of_clock || null,
      },
    };
  }

  if (!input.liveOfficial) {
    return { ok: false, code: "missing_current", message: "supply --current-fixture or --live-official" };
  }

  const url = input.liveUrl || OFFICIAL_JSON_URLS.nodejsEol;
  const fetched = await fetchOfficialJson(url, { fetchImpl: input.fetchImpl, timeoutMs: input.timeoutMs });
  if (!fetched.ok) return fetched;
  const normalized = normalizeEolObservation(fetched.body, watchCycles);
  if (!normalized.ok) return normalized;
  return {
    ok: true,
    observation: normalized.observation,
    evidenceClass: evidenceClassFor("live_official", input.evidenceClass),
    source: { kind: "live_official", url, status: fetched.status },
  };
}
