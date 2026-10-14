import { atomic, requireThat } from "./boundary.mjs";

/** Selected rail profile. One capture, floor(amount * 500 / 10000). Not cumulative. */
export const PER_CAPTURE_FLOOR_500 = Object.freeze({
  id: "per_capture_floor_500",
  bps: 500,
  rounding: "per_capture_floor",
  denominator: 10000,
});

const COMMERCE_LIMIT = 2n ** 120n;

export function feeAt(gross) {
  const amount = atomic(gross);
  requireThat(amount >= 0n && amount < COMMERCE_LIMIT, "commerce_amount_overflow");
  return (amount * 500n / 10000n).toString();
}

export function singleCaptureTotals(gross, railCost = "0") {
  const g = atomic(gross);
  const cost = atomic(railCost);
  requireThat(g > 0n && g < COMMERCE_LIMIT, "commerce_amount_overflow");
  requireThat(cost === 0n, "unsupported_capture_cost_deduction");
  const fee = g * 500n / 10000n;
  const net = g - fee;
  requireThat(net >= 0n, "money_not_conserved");
  requireThat(g === net + fee + cost, "money_not_conserved");
  return {
    gross: g.toString(),
    platformFee: fee.toString(),
    contributorNet: net.toString(),
    railCost: cost.toString(),
    subsidy: "0",
    profile: PER_CAPTURE_FLOOR_500.id,
    rounding: PER_CAPTURE_FLOOR_500.rounding,
    cumulativeFloorDelta: "0",
  };
}

/** How far per-capture floors sit from one cumulative floor. Not a pricing mode. */
export function cumulativeFloorDelta(amounts) {
  requireThat(Array.isArray(amounts) && amounts.length > 0, "empty_capture_plan");
  let gross = 0n;
  let fee = 0n;
  for (const amount of amounts) {
    const g = atomic(amount);
    requireThat(g > 0n && g < COMMERCE_LIMIT, "commerce_amount_overflow");
    gross += g;
    fee += g * 500n / 10000n;
  }
  return (gross * 500n / 10000n - fee).toString();
}

export function assertSingleCapture(amounts) {
  requireThat(Array.isArray(amounts) && amounts.length === 1, "unsupported_partial_capture");
  cumulativeFloorDelta(amounts);
}
