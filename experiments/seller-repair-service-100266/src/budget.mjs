export function createBudget(maxEffort, now = Date.now()) {
  return {
    maxEffort,
    startedAt: now,
    probesUsed: 0,
    bodyBytesSeen: 0,
    redirectsSeen: 0,
  };
}

export function admitProbe(budget, now = Date.now()) {
  const remaining = budget.maxEffort.totalResponseMs - (now - budget.startedAt);
  if (budget.probesUsed >= budget.maxEffort.probes) return { ok: false, reason: "effort_exhausted" };
  if (budget.bodyBytesSeen >= budget.maxEffort.totalBodyBytes) return { ok: false, reason: "total_body_ceiling" };
  if (remaining < 20) return { ok: false, reason: "total_response_deadline" };
  return {
    ok: true,
    deadlineMs: Math.min(budget.maxEffort.deadlineMs, remaining),
    bodyBytes: Math.min(budget.maxEffort.bodyBytes, budget.maxEffort.totalBodyBytes - budget.bodyBytesSeen),
  };
}

export function noteProbe(budget, probe) {
  budget.probesUsed += 1;
  const seen = Number.isInteger(probe?.bytesSeen) ? probe.bytesSeen : Number(probe?.byteLength || 0);
  budget.bodyBytesSeen += seen;
  if (probe?.redirectUnfollowed) budget.redirectsSeen += 1;
}

export function budgetView(budget) {
  return {
    probes: budget?.probesUsed || 0,
    bodyBytes: budget?.bodyBytesSeen || 0,
    redirects: budget?.redirectsSeen || 0,
    responseMs: budget ? Math.max(0, Date.now() - budget.startedAt) : 0,
    redirectsFollowed: 0,
  };
}
