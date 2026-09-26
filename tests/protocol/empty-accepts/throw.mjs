import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  decodeChallengeFromResponse,
  decodeSettlementHeader,
  selectExactAccept,
} from "../../../examples/customer-x402/src/challenge.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));

export const EMPTY_ACCEPTS_CODE = "empty_accepts";
export const EMPTY_ACCEPTS_MESSAGE =
  "x402 Payment-Required with empty accepts must throw; never settle";

export class EmptyAcceptsError extends Error {
  constructor(message = EMPTY_ACCEPTS_MESSAGE, extra = {}) {
    super(message);
    this.name = "EmptyAcceptsError";
    this.code = extra.code || EMPTY_ACCEPTS_CODE;
    this.settled = false;
    this.settlementVerification = "absent";
    this.facilitatorSettleCalls = 0;
    this.acceptCount = extra.acceptCount ?? 0;
    this.settlementClaim = extra.settlementClaim ?? null;
    if (extra.cause) this.cause = extra.cause;
  }
}

export function loadEmptyAcceptsChallenge() {
  return JSON.parse(readFileSync(join(ROOT, "challenge.json"), "utf8"));
}

export function loadSeededFailureChallenge() {
  return JSON.parse(readFileSync(join(ROOT, "seeded-failure.json"), "utf8"));
}

export function isEmptyAccepts(challenge) {
  if (!challenge || typeof challenge !== "object" || Array.isArray(challenge)) return true;
  if (!Array.isArray(challenge.accepts)) return true;
  return challenge.accepts.length === 0;
}

function settlementClaimFrom(settlement) {
  if (!settlement) return null;
  if (settlement.present === false) return null;
  if (settlement.present || settlement.success === true || settlement.decoded || settlement.raw) {
    return {
      present: true,
      success: settlement.decoded?.success ?? settlement.success ?? null,
    };
  }
  return null;
}

/**
 * Fail closed on an empty or missing `accepts` array.
 * A claimed PAYMENT-RESPONSE does not create settlement; this fixture never settles.
 */
export function throwIfEmptyAccepts(challenge, { settlement } = {}) {
  const acceptCount = Array.isArray(challenge?.accepts) ? challenge.accepts.length : 0;
  const claim = settlementClaimFrom(settlement);

  if (!isEmptyAccepts(challenge)) {
    return selectExactAccept(challenge);
  }

  let cause = null;
  try {
    selectExactAccept(challenge);
  } catch (error) {
    cause = error;
  }

  throw new EmptyAcceptsError(EMPTY_ACCEPTS_MESSAGE, {
    cause,
    acceptCount,
    settlementClaim: claim,
  });
}

export function refuseSettlement(reason = EMPTY_ACCEPTS_MESSAGE) {
  throw new EmptyAcceptsError(reason);
}

export async function throwOnEmptyAcceptsResponse(response, bodyText = null) {
  const text = bodyText ?? (typeof response?.text === "function" ? await response.clone().text() : null);
  const challenge = decodeChallengeFromResponse(response, text);
  const settlement = decodeSettlementHeader(response);
  return throwIfEmptyAccepts(challenge, { settlement });
}

export function neverSettledProof(stats = {}) {
  return Object.freeze({
    settled: false,
    settlementVerification: "absent",
    facilitatorSettleCalls: stats.settleCalls ?? 0,
    paidAttempts: stats.paidAttempts ?? 0,
    paymentSigned: false,
    walletAccessed: false,
  });
}
