const LIMIT = 2n ** 120n;

export function perCaptureFloor(gross, railCost = "0") {
  if (typeof gross !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(gross)) {
    return { status: "unknown", reason: "gross_unreadable" };
  }
  if (typeof railCost !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(railCost)) {
    return { status: "unknown", reason: "rail_cost_unreadable" };
  }
  const g = BigInt(gross);
  const cost = BigInt(railCost);
  if (g <= 0n || g >= LIMIT || cost !== 0n) return { status: "unknown", reason: "amount_rejected" };
  const fee = (g * 500n) / 10000n;
  const net = g - fee;
  if (net < 0n || g !== net + fee + cost) return { status: "unknown", reason: "money_not_conserved" };
  return {
    status: "computed",
    gross: g.toString(),
    platformFee: fee.toString(),
    contributorNet: net.toString(),
    railCost: "0",
    profile: "per_capture_floor_500",
    bps: 500,
    rounding: "per_capture_floor",
  };
}

/**
 * Compare one accepted result with one capture record.
 * A mismatch, a missing capture, or a second capture stays unknown.
 */
export function reconcileAcceptedCapture({ acceptedDigest, capture, port } = {}) {
  if (!/^[a-f0-9]{64}$/.test(acceptedDigest || "")) return { status: "unknown", reason: "accepted_digest_absent" };
  if (!capture || capture.state !== "captured" || capture.finality !== "final" || capture.bound !== true) {
    return { status: "unknown", reason: "capture_not_final" };
  }
  if (!port || port.invocations !== 1) return { status: "unknown", reason: "capture_count" };
  const expected = perCaptureFloor(capture.gross, capture.railCost ?? "0");
  if (expected.status !== "computed") return { status: "unknown", reason: expected.reason };
  if (capture.platformFee !== expected.platformFee || capture.contributorNet !== expected.contributorNet) {
    return { status: "unknown", reason: "fee_mismatch", expected };
  }
  if (port.lastFeeAmount !== expected.platformFee) return { status: "unknown", reason: "posted_fee_mismatch", expected };
  if (capture.acceptedDigest !== acceptedDigest) return { status: "unknown", reason: "digest_mismatch" };
  return {
    status: "matched",
    acceptedDigest,
    gross: expected.gross,
    platformFee: expected.platformFee,
    contributorNet: expected.contributorNet,
    railCost: "0",
    invocations: 1,
    profile: expected.profile,
  };
}
