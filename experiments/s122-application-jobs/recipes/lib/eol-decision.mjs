import { daysUntil } from "./dates.mjs";
import { indexCycles } from "./eol-cycles.mjs";

export const EOL_NEXT_ACTIONS = Object.freeze(["upgrade_now", "schedule_upgrade", "monitor", "no_action"]);

export const EOL_RANK = Object.freeze({
  upgrade_now: 3,
  schedule_upgrade: 2,
  monitor: 1,
  no_action: 0,
});

export const DEFAULT_URGENT_DAYS = 14;

export function classifyCycle({
  cycle,
  eol,
  support,
  latest,
  priorLatest,
  clock,
  priorClock,
  horizonDays,
  urgentDays,
} = {}) {
  if (!eol) {
    return {
      cycle,
      action: null,
      partial: true,
      ruleId: "missing_eol",
      because: `cycle ${cycle} is missing eol`,
    };
  }

  const daysToEol = daysUntil(eol, clock);
  const daysToSupport = support ? daysUntil(support, clock) : null;
  const priorDaysToEol = priorClock ? daysUntil(eol, priorClock) : null;
  const priorDaysToSupport = priorClock && support ? daysUntil(support, priorClock) : null;

  if (daysToEol == null) {
    return {
      cycle,
      action: null,
      partial: true,
      ruleId: "unparseable_eol",
      because: `cycle ${cycle} eol ${eol} is not a date`,
    };
  }

  if (daysToEol <= urgentDays) {
    return {
      cycle,
      action: "upgrade_now",
      partial: false,
      ruleId: daysToEol <= 0 ? "already_eol" : "eol_within_urgent",
      because:
        daysToEol <= 0
          ? `cycle ${cycle} reached eol ${eol} (${Math.abs(daysToEol)} days before operator clock)`
          : `cycle ${cycle} reaches eol ${eol} in ${daysToEol} days (urgentDays=${urgentDays})`,
      daysToEol,
      daysToSupport,
      priorDaysToEol,
      latest,
    };
  }

  if (daysToEol <= horizonDays) {
    return {
      cycle,
      action: "schedule_upgrade",
      partial: false,
      ruleId: "eol_within_horizon",
      because: `cycle ${cycle} reaches eol ${eol} in ${daysToEol} days (horizonDays=${horizonDays})`,
      daysToEol,
      daysToSupport,
      priorDaysToEol,
      latest,
    };
  }

  if (daysToSupport != null && daysToSupport > 0 && daysToSupport <= horizonDays) {
    return {
      cycle,
      action: "schedule_upgrade",
      partial: false,
      ruleId: "support_within_horizon",
      because: `cycle ${cycle} leaves active support ${support} in ${daysToSupport} days (horizonDays=${horizonDays}); eol remains ${eol}`,
      daysToEol,
      daysToSupport,
      priorDaysToSupport,
      latest,
    };
  }

  if (
    daysToSupport != null &&
    daysToSupport <= 0 &&
    priorDaysToSupport != null &&
    priorDaysToSupport > 0
  ) {
    return {
      cycle,
      action: "schedule_upgrade",
      partial: false,
      ruleId: "support_deadline_crossed",
      because: `cycle ${cycle} crossed support end ${support} between prior clock and operator clock`,
      daysToEol,
      daysToSupport,
      priorDaysToSupport,
      latest,
    };
  }

  if (priorLatest != null && latest != null && priorLatest !== latest) {
    return {
      cycle,
      action: "monitor",
      partial: false,
      ruleId: "latest_patch_changed",
      because: `cycle ${cycle} latest moved ${priorLatest} -> ${latest} while eol remains outside horizon`,
      daysToEol,
      daysToSupport,
      latest,
      priorLatest,
    };
  }

  return {
    cycle,
    action: "no_action",
    partial: false,
    ruleId: "outside_horizon_stable_latest",
    because: `cycle ${cycle} eol ${eol} is ${daysToEol} days away (horizonDays=${horizonDays})`,
    daysToEol,
    daysToSupport,
    latest,
  };
}

export function selectEolNextAction({
  currentCycles,
  priorCycles,
  clock,
  priorClock,
  horizonDays,
  urgentDays = DEFAULT_URGENT_DAYS,
  pinnedRuntime = null,
} = {}) {
  const priorIndex = indexCycles(priorCycles);
  const perCycle = [];
  for (const row of currentCycles || []) {
    const prior = priorIndex.get(String(row.cycle));
    perCycle.push(
      classifyCycle({
        cycle: row.cycle,
        eol: row.eol,
        support: row.support,
        latest: row.latest,
        priorLatest: prior?.latest ?? null,
        clock,
        priorClock,
        horizonDays,
        urgentDays,
      }),
    );
  }

  const partial = perCycle.some((row) => row.partial);
  let nextAction = "no_action";
  let winner = null;
  for (const row of perCycle) {
    if (!row.action) continue;
    if (EOL_RANK[row.action] > EOL_RANK[nextAction]) {
      nextAction = row.action;
      winner = row;
    }
  }

  if (partial) {
    return {
      nextAction: null,
      ruleId: "partial_cycles",
      because: "one or more watched cycles are missing required eol/latest fields",
      perCycle,
      pinnedRuntime,
    };
  }

  return {
    nextAction,
    ruleId: winner?.ruleId || "all_cycles_no_action",
    because: winner?.because || "no watched cycle requires action",
    perCycle,
    pinnedRuntime,
    pinRow: pinnedRuntime ? perCycle.find((row) => String(row.cycle) === String(pinnedRuntime)) || null : null,
  };
}

export function sourceCycleDiff(priorCycles, currentCycles) {
  const priorIndex = indexCycles(priorCycles);
  const currentIndex = indexCycles(currentCycles);
  const ids = [...new Set([...priorIndex.keys(), ...currentIndex.keys()])];
  const changed = [];
  const unchanged = [];
  const missing = [];
  for (const id of ids) {
    const before = priorIndex.get(id) || null;
    const after = currentIndex.get(id) || null;
    if (!after || after.missingFields?.length) {
      missing.push({ cycle: id, before, after });
      continue;
    }
    const fields = ["eol", "support", "latest", "lts"];
    const fieldChanges = [];
    for (const field of fields) {
      const left = before?.[field] ?? null;
      const right = after?.[field] ?? null;
      if (String(left) !== String(right)) fieldChanges.push({ field, before: left, after: right });
    }
    if (fieldChanges.length) changed.push({ cycle: id, fields: fieldChanges });
    else unchanged.push({ cycle: id, eol: after.eol, latest: after.latest, support: after.support });
  }
  return { changed, unchanged, missing };
}
