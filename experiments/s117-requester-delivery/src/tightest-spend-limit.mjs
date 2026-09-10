/**
 * One rule for the binding spend limit: an unreadable allowance has no room
 * and is the tightest limit. A status report must not skip it and print the
 * next healthy figure as ready.
 *
 * Related: JustaName-id/jaw-mono#319 (open, owner PR in review). This is a
 * portable reduction of that requested outcome, not a competing patch.
 */

function remainingOnLimit(limit) {
  if (!limit || typeof limit !== "object" || Array.isArray(limit)) {
    return { remaining: 0n, readable: false, reason: "not_object" };
  }
  const raw = limit.remaining;
  if (raw === undefined || raw === null || raw === "") {
    return { remaining: 0n, readable: false, reason: "missing_remaining" };
  }
  const text = typeof raw === "bigint" ? raw.toString() : String(raw).trim();
  if (!/^\d+$/.test(text)) {
    return { remaining: 0n, readable: false, reason: "unreadable_remaining" };
  }
  return { remaining: BigInt(text), readable: true, reason: null };
}

export function diagnoseSpendLimits(limits = []) {
  if (!Array.isArray(limits)) throw new Error("limits must be an array");
  const diagnosed = limits.map((limit, index) => {
    const room = remainingOnLimit(limit);
    return {
      index,
      id: typeof limit?.id === "string" ? limit.id : `limit[${index}]`,
      remaining: room.remaining.toString(),
      readable: room.readable,
      reason: room.reason,
    };
  });
  let binding = null;
  for (const entry of diagnosed) {
    if (!binding) {
      binding = entry;
      continue;
    }
    if (BigInt(entry.remaining) < BigInt(binding.remaining)) binding = entry;
  }
  const unreadablePresent = diagnosed.some((entry) => entry.readable === false);
  const remaining = binding ? BigInt(binding.remaining) : 0n;
  const ready = Boolean(binding) && !unreadablePresent && remaining > 0n;
  return Object.freeze({
    schemaVersion: "s117.tightest-spend-limit.v1",
    ready,
    bindingLimitId: binding?.id ?? null,
    bindingRemaining: remaining.toString(),
    unreadablePresent,
    limits: Object.freeze(diagnosed.map((entry) => Object.freeze(entry))),
    notes: Object.freeze({
      residual_pr: "https://github.com/JustaName-id/jaw-mono/pull/319",
      unreadable_binds_as_zero: true,
      local_recipe_is_not_upstream_merge: true,
    }),
  });
}
