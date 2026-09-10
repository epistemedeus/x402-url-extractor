import { loadPrior, summarizePrior } from "./lib/prior.mjs";
import { inspectPaymentAuthority } from "./lib/payment.mjs";
import { classifyStaleCurrent } from "./lib/recovery.mjs";
import { NPM_COMPARE_FIELDS, normalizeNpmObservation, requiredNpmCoverage } from "./lib/npm-packument.mjs";
import {
  DEFAULT_VERCEL_POLICY,
  mergePolicy,
  selectNpmNextAction,
} from "./lib/npm-decision.mjs";
import { diffFields } from "./lib/field-diff.mjs";
import { evidenceClassFor, fetchOfficialJson, OFFICIAL_JSON_URLS } from "./lib/observe.mjs";
import { failResult, finishResult } from "./lib/result.mjs";
import { tryReadJsonFile } from "./lib/io.mjs";

export const RECIPE_ID = "npm-cli-release-followup";
export const RECIPE_SCHEMA = "s122.application-job-result.v1";

export const META = Object.freeze({
  recipeId: RECIPE_ID,
  userBenefit:
    "Turn two official npm registry observations plus an immutable pin into one next action: review changelog, bump pin, refresh agent tool notes, or do nothing.",
  operatorSupplies: [
    "priorPath",
    "scheduleHint",
    "clock",
    "current fixture or --live-official",
    "optional operator pin, agent tool notes, policy, horizonHours",
  ],
  acceptedContracts: [
    "samedaydesk.recurring-job-prior.v1",
    "samedaydesk.recurring-job-recipe-result.v1 outcomes",
  ],
  officialSource: OFFICIAL_JSON_URLS.vercel,
  defaultPackage: "vercel",
});

export async function runNpmCliReleaseFollowup(input = {}) {
  return runNpmReleaseRecipe({
    ...input,
    recipeId: input.recipeId || RECIPE_ID,
    meta: input.meta || META,
    defaultPolicy: input.defaultPolicy || DEFAULT_VERCEL_POLICY,
    defaultPackage: input.defaultPackage || META.defaultPackage,
    officialUrl: input.officialUrl || META.officialSource,
  });
}

export async function runNpmReleaseRecipe(input = {}) {
  const recipeId = input.recipeId || RECIPE_ID;
  const meta = input.meta || META;
  const clock = input.clock || null;
  const scheduleHint = input.scheduleHint || null;

  if (!clock) {
    return failResult({
      recipeId,
      meta,
      code: "missing_clock",
      message: "operator clock is required; the pack does not invent it",
      clock,
      scheduleHint,
    });
  }
  if (!scheduleHint) {
    return failResult({
      recipeId,
      meta,
      code: "missing_schedule",
      message: "operator schedule hint is required; the pack does not invent it",
      clock,
      scheduleHint,
    });
  }

  const priorLoad = loadPrior(input.priorPath);
  if (!priorLoad.ok) {
    return failResult({
      recipeId,
      meta,
      code: priorLoad.code,
      message: priorLoad.message,
      clock,
      scheduleHint,
    });
  }

  const payment = inspectPaymentAuthority(priorLoad.prior, input);
  if (!payment.ok) {
    return failResult({
      recipeId,
      meta,
      code: payment.code,
      message: payment.message,
      clock,
      scheduleHint,
      extra: { payment, prior: summarizePrior(priorLoad) },
    });
  }

  const operator = loadOperator(input);
  const policy = mergePolicy(input.defaultPolicy || DEFAULT_VERCEL_POLICY, operator.policy);
  const expectedPackage = operator.pin?.package || priorLoad.prior.payload.package || input.defaultPackage;

  const observed = await observeNpm(input, {
    officialUrl: input.officialUrl,
    expectedPackage,
  });
  if (!observed.ok) {
    return finishResult({
      recipeId,
      meta,
      outcome: observed.code === "timed_out" ? "timed_out" : "error",
      clock,
      scheduleHint,
      payment,
      prior: summarizePrior(priorLoad),
      nextAction: null,
      evidence: { kind: "observe_error", code: observed.code, message: observed.message },
    });
  }

  const stale = classifyStaleCurrent(observed.capturedAt, clock, input.horizonHours);
  if (stale.stale) {
    return finishResult({
      recipeId,
      meta,
      outcome: "stale_baseline",
      clock,
      scheduleHint,
      payment,
      prior: summarizePrior(priorLoad),
      stale,
      nextAction: null,
      observation: observed.observation,
      evidence: { kind: "stale_current", ...stale, source: observed.source },
    });
  }

  const priorNorm = normalizeNpmObservation(priorLoad.prior.payload, { role: "prior" });
  if (!priorNorm.ok) {
    return failResult({
      recipeId,
      meta,
      code: priorNorm.code,
      message: priorNorm.message,
      clock,
      scheduleHint,
      extra: { payment, prior: summarizePrior(priorLoad) },
    });
  }

  const current = observed.observation;
  const priorObs = priorNorm.observation;

  if (expectedPackage && current.package && current.package !== expectedPackage) {
    return failResult({
      recipeId,
      meta,
      code: "identity_mismatch",
      message: `current package ${current.package} does not match pin/prior ${expectedPackage}`,
      clock,
      scheduleHint,
      extra: { payment, prior: summarizePrior(priorLoad) },
    });
  }
  if (priorObs.package && current.package && priorObs.package !== current.package) {
    return failResult({
      recipeId,
      meta,
      code: "identity_mismatch",
      message: `current package ${current.package} does not match prior package ${priorObs.package}`,
      clock,
      scheduleHint,
      extra: { payment, prior: summarizePrior(priorLoad) },
    });
  }

  const before = {
    version: priorObs.version,
    publishedAt: priorObs.publishedAt,
    deprecated: priorObs.deprecated,
  };
  const after = {
    version: current.version,
    publishedAt: current.publishedAt,
    deprecated: current.deprecated,
  };
  const diff = diffFields(before, after, NPM_COMPARE_FIELDS);
  const complete = requiredNpmCoverage(current) && requiredNpmCoverage(priorObs);

  let outcome;
  if (!complete || diff.missing.length) outcome = "partial";
  else if (diff.changed.length) outcome = "changed";
  else outcome = "unchanged";

  const pinVersion = operator.pin?.version || priorObs.version;
  const decision = selectNpmNextAction({
    outcome,
    priorVersion: priorObs.version,
    currentVersion: current.version,
    pinVersion,
    notesLastReviewedVersion: operator.agentToolNotes?.lastReviewedVersion || null,
    policy,
    deprecatedNow: Boolean(current.deprecated),
  });

  return finishResult({
    recipeId,
    meta,
    outcome,
    clock,
    scheduleHint,
    payment,
    prior: summarizePrior(priorLoad),
    stale,
    policy,
    nextAction: decision.nextAction,
    justification: {
      ruleId: decision.ruleId,
      because: decision.because,
      delta: decision.delta || null,
      followUp: decision.followUp || null,
      pinVersion,
      notesLastReviewedVersion: operator.agentToolNotes?.lastReviewedVersion || null,
      flagSensitive: operator.agentToolNotes?.flagSensitive === true,
    },
    observation: {
      ...current,
      priorVersion: priorObs.version,
      capturedAt: observed.capturedAt,
      evidenceClass: observed.evidenceClass,
      source: observed.source,
    },
    diff,
    evidence: {
      kind: "npm_registry_compare",
      source: observed.source,
      evidenceClass: observed.evidenceClass,
      fields: NPM_COMPARE_FIELDS,
      changed: diff.changed,
      unchanged: diff.unchanged,
      missing: diff.missing,
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

async function observeNpm(input, { officialUrl, expectedPackage }) {
  if (input.currentFixturePath) {
    const loaded = tryReadJsonFile(input.currentFixturePath);
    if (!loaded.ok) {
      return { ok: false, code: loaded.code, message: loaded.message };
    }
    const normalized = normalizeNpmObservation(loaded.body, { role: "current" });
    if (!normalized.ok) return normalized;
    const capturedAt =
      loaded.body.captured_at ||
      loaded.body.capturedAt ||
      loaded.body.published_at ||
      loaded.body.publishedAt ||
      null;
    return {
      ok: true,
      observation: normalized.observation,
      capturedAt,
      evidenceClass: evidenceClassFor("fixture", input.evidenceClass),
      source: {
        kind: "fixture",
        path: input.currentFixturePath,
        label: loaded.body.label || "current",
        originalUrl: loaded.body.source || officialUrl,
        capturedFromLive: loaded.body.captured_from_live_registry === true,
      },
    };
  }

  if (!input.liveOfficial) {
    return {
      ok: false,
      code: "missing_current",
      message: "supply --current-fixture or --live-official",
    };
  }

  const url = input.liveUrl || officialUrl || OFFICIAL_JSON_URLS.vercel;
  const fetched = await fetchOfficialJson(url, {
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
  });
  if (!fetched.ok) return fetched;
  const normalized = normalizeNpmObservation(fetched.body, { role: "current" });
  if (!normalized.ok) return normalized;
  if (expectedPackage && normalized.observation.package && normalized.observation.package !== expectedPackage) {
    return {
      ok: false,
      code: "identity_mismatch",
      message: `live package ${normalized.observation.package} does not match ${expectedPackage}`,
    };
  }
  return {
    ok: true,
    observation: normalized.observation,
    capturedAt: input.clock,
    evidenceClass: evidenceClassFor("live_official", input.evidenceClass),
    source: { kind: "live_official", url, status: fetched.status },
  };
}
