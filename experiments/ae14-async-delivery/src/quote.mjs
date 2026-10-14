import { COMMERCE_PIN } from "./adapter.mjs";
import { address, atomic, id, requireThat } from "./boundary.mjs";
import { digest } from "./digest.mjs";
import { singleCaptureTotals } from "./fee.mjs";

/** Same pin object as commerce-payments-v1.1.0.pin.json in the A amend tree. */
export const COMMERCE_PAYMENTS_PIN = COMMERCE_PIN;

export const PRODUCTION_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
export const DISPOSABLE_CHAIN = "eip155:31337";

const LEGACY = /^(221400|234100)(?:[./_-].*)?$/;

export function isLegacyTerms(termsVersion) {
  return typeof termsVersion === "string" && LEGACY.test(termsVersion);
}

export function legacyRefusal(input) {
  requireThat(isLegacyTerms(input.termsVersion), "not_legacy_terms");
  return {
    ok: false,
    schemaVersion: "ae14.async-delivery.v1",
    qualification: "pending-join",
    code: "legacy_terms_unchanged",
    statusCode: 409,
    termsVersion: input.termsVersion,
    feeApplied: false,
    repriced: false,
    walletRequired: false,
    signupRequired: false,
    earnedNet: typeof input.earnedNet === "string" ? input.earnedNet : null,
    platformFee: null,
    acceptedSettled: false,
    paymentCompleted: false,
    fundedAcceptance: false,
    usefulWork: false,
  };
}

function assetOf(input) {
  const asset = input.asset;
  requireThat(asset && typeof asset === "object", "asset");
  requireThat(asset.chain === DISPOSABLE_CHAIN, "disposable_chain_only");
  const token = address(String(asset.token || "").toLowerCase(), "asset_token");
  requireThat(token !== PRODUCTION_USDC, "production_asset_refused");
  requireThat(asset.decimals === 6, "asset_decimals");
  id(asset.symbol, "asset_symbol");
  requireThat(asset.symbol === "USDC", "rail_asset_binding");
  return { chain: asset.chain, token, decimals: 6, symbol: "USDC" };
}

export function buildQuote(input, now = new Date()) {
  requireThat(!isLegacyTerms(input.termsVersion), "legacy_terms_unchanged");
  const totals = singleCaptureTotals(input.gross, input.railCost ?? "0");
  const requesterId = id(input.requesterId, "requester");
  const evaluatorId = id(input.evaluatorId, "evaluator");
  const contributorId = id(input.contributorId, "contributor");
  const fundingAuthorityId = id(input.fundingAuthorityId, "funding_authority");
  const settlementAuthorityId = id(input.settlementAuthorityId, "settlement_authority");
  requireThat(requesterId !== contributorId && evaluatorId !== contributorId, "actor_conflict");
  requireThat(fundingAuthorityId !== settlementAuthorityId, "authority_conflation");
  const expiresAt = input.expiresAt;
  requireThat(typeof expiresAt === "string" && Number.isFinite(Date.parse(expiresAt)), "expires_at");
  requireThat(Date.parse(expiresAt) > now.getTime(), "quote_expired");
  const quote = {
    schemaVersion: "pilot.agent-economy.v2",
    quoteId: id(input.quoteId, "quote_id"),
    tenantId: id(input.tenantId, "tenant"),
    taskId: id(input.taskId, "task"),
    canonicalTaskId: id(input.canonicalTaskId, "allocation"),
    taskVersion: 1,
    termsVersion: id(input.termsVersion, "terms"),
    requesterId,
    evaluatorId,
    contributorId,
    payoutDestination: id(input.payoutDestination, "payout_destination"),
    fundingAuthorityId,
    settlementAuthorityId,
    asset: assetOf(input),
    gross: totals.gross,
    contributorNet: totals.contributorNet,
    platformFee: totals.platformFee,
    subsidy: totals.subsidy,
    fee: {
      schemaVersion: "pilot.agent-economy.v2",
      bps: 500,
      basis: "new_job_gross",
      profile: {
        id: "commerce-payments-v1.1.0-single-capture",
        rounding: "per_capture_floor",
        mode: "single_capture",
        escrow: COMMERCE_PAYMENTS_PIN,
      },
    },
    rail: { mode: "deduct_gross", costCap: totals.railCost },
    fundingTarget: id(input.fundingTarget, "funding_target"),
    expiresAt: new Date(Date.parse(expiresAt)).toISOString(),
    rules: {
      partial: "accepted_gross_only",
      refund: "unaccepted_gross_only",
      dispute: "hold_until_authoritative_resolution",
      reversal: "reconcile_without_repricing_earned_obligation",
      rightsTermsRef: id(input.rightsTermsRef, "rights"),
    },
    feeRecipient: address(String(input.feeRecipient).toLowerCase(), "fee_recipient"),
  };
  requireThat(atomic(quote.gross) === atomic(quote.contributorNet) + atomic(quote.platformFee) + atomic(quote.rail.costCap), "money_not_conserved");
  return { quote, quoteDigest: digest(quote), totals };
}
