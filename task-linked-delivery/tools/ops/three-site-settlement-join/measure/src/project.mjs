import { SITE_META } from "../../src/constants.mjs";
import { LEDGER_SCHEMA } from "./constants.mjs";
import { containsRestrictedKey, restrictedOwnEntries } from "./restricted.mjs";

const PRIOR_OBSERVATION_PATH = /^[A-Za-z0-9._/-]{1,240}$/;

// latestPartialCapitalObservation.priorObservation is a ledger file pointer.
// The same key on an observation is a causal alias, so only this string path
// is exempt. Every experiment row is still scanned in full.
function sourceIsRestricted(ledger) {
  const meta = ledger.latestPartialCapitalObservation;
  const rest = { ...ledger };
  delete rest.latestPartialCapitalObservation;
  if (containsRestrictedKey(rest)) return true;
  if (meta == null) return false;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return true;
  const metaRest = { ...meta };
  delete metaRest.priorObservation;
  if (containsRestrictedKey(metaRest)) return true;
  if (meta.priorObservation == null) return false;
  return typeof meta.priorObservation !== "string" || !PRIOR_OBSERVATION_PATH.test(meta.priorObservation);
}

export class CollectError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CollectError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new CollectError(code, message);
}

function httpsHost(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 240) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.hostname;
  } catch {
    return null;
  }
}

// Six-decimal USDC to an atomic integer string. Rejects values that are not
// already exact at six places so a float is not relabeled as a settlement.
export function usdcToAtomic(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const text = value.toFixed(6);
  if (Number(text) !== value) return null;
  const [whole, frac] = text.split(".");
  if (!frac || frac.length !== 6) return null;
  const atomic = `${whole}${frac}`.replace(/^0+/, "");
  if (!/^[1-9][0-9]{0,77}$/.test(atomic)) return null;
  return atomic;
}

function closedObservation(row, siteId, outcomeClass, valueAtomic) {
  const observation = {
    siteId,
    brand: SITE_META[siteId].brand,
    class: outcomeClass,
    observationId: row.id,
  };
  if (valueAtomic != null) observation.valueAtomic = valueAtomic;
  return observation;
}

// One admitted ledger row becomes at most one observation. settlementCount is
// not repeated into extra events and is not traffic.
function attribute(row) {
  if (httpsHost(row.publicUrl) === "neomorphic.io") {
    const settled = row.settlementCount == null ? 0 : row.settlementCount;
    if (row.externalRevenueUsdc === 0 && settled === 0) {
      return {
        observation: closedObservation(row, "neomorphic", "discovery", null),
        recognized: false,
        counterparty: "absent",
      };
    }
    return { withhold: true };
  }
  if (row.settlementScope === "tracked_extract_cohort_only"
    && row.class === "conditional-incoming-settlement-observation") {
    if (row.recognized === false && row.counterpartyControl === "unknown") {
      return {
        observation: closedObservation(row, "samedaydesk", "settlement", usdcToAtomic(row.unclassifiedSettledUsdc)),
        recognized: false,
        counterparty: "unknown",
      };
    }
    return { withhold: true };
  }
  return null;
}

function poisonedObservation(row, attributed) {
  const siteId = attributed?.observation?.siteId || "samedaydesk";
  const outcomeClass = attributed?.observation?.class || "settlement";
  const observation = {
    siteId,
    brand: SITE_META[siteId].brand,
    class: outcomeClass,
    observationId: row.id,
  };
  for (const [key, value] of restrictedOwnEntries(row)) observation[key] = value;
  if (!containsRestrictedKey(observation)) observation.rawPrompt = true;
  return observation;
}

export function projectLedger(ledger) {
  if (!ledger || typeof ledger !== "object" || Array.isArray(ledger) || ledger.schema !== LEDGER_SCHEMA) {
    fail("wrong_source_schema", "source schema is not the recorded experiment-return ledger");
  }
  if (typeof ledger.updatedDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(ledger.updatedDate)) {
    fail("invalid_source", "updatedDate must be YYYY-MM-DD");
  }
  if (!Array.isArray(ledger.experiments) || ledger.experiments.length < 1 || ledger.experiments.length > 256) {
    fail("invalid_source", "experiments must be an array of 1 to 256 rows");
  }
  const restricted = sourceIsRestricted(ledger);
  const attributions = [];
  const poisoned = [];
  let withheld = 0;
  for (const row of ledger.experiments) {
    if (!row || typeof row !== "object" || Array.isArray(row)) fail("invalid_source", "experiment row must be an object");
    const attributed = containsRestrictedKey(row) ? null : attribute(row);
    if (containsRestrictedKey(row)) {
      poisoned.push(poisonedObservation(row, attribute(row)));
      continue;
    }
    if (!attributed) continue;
    if (attributed.withhold) {
      withheld += 1;
      continue;
    }
    attributions.push(attributed);
  }
  if (restricted && poisoned.length === 0) {
    poisoned.push({
      siteId: "samedaydesk",
      brand: SITE_META.samedaydesk.brand,
      class: "settlement",
      observationId: "restricted-root",
      rawPrompt: true,
    });
  }
  return {
    restricted,
    clock: `${ledger.updatedDate}T00:00:00.000Z`,
    experimentRows: ledger.experiments.length,
    withheld,
    attributions,
    poisoned,
  };
}
