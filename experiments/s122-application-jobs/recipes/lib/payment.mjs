/**
 * Payment authority stays outside these application recipes.
 * A prior payment receipt never becomes an automatic replay.
 */

export function inspectPaymentAuthority(prior, operator) {
  const priorPayment = prior?.payment && typeof prior.payment === "object" ? prior.payment : {};
  const wantsReplay = Boolean(operator?.replayPayment || operator?.approvePayment || operator?.autoPay);
  const hasReceipt =
    priorPayment.attempted === true ||
    priorPayment.receiptId ||
    priorPayment.authorizationId ||
    priorPayment.charged === true;

  if (wantsReplay && hasReceipt) {
    return {
      ok: false,
      code: "payment_replay_blocked",
      attempted: false,
      replayBlocked: true,
      message:
        "prior payment or authorization evidence is present; recipes never automatically replay payment.",
    };
  }

  if (wantsReplay && !hasReceipt) {
    return {
      ok: false,
      code: "payment_authority_required",
      attempted: false,
      replayBlocked: true,
      message:
        "recipes do not purchase. A future paid freshness call remains the merchant extract 0.005 / batch 0.01 USDC listed prices and is not invoked here.",
    };
  }

  return {
    ok: true,
    attempted: false,
    replayBlocked: true,
    hasPriorReceipt: Boolean(hasReceipt),
  };
}
