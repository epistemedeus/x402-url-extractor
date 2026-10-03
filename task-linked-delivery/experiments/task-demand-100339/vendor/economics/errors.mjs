export class EconomicsError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = "EconomicsError";
    this.code = code;
  }
}

export const MESSAGES = Object.freeze({
  invalid_bundle: "bundle is not a useful-economics document",
  restricted_fields: "restricted source fields were not projected",
  revenue_claim: "a source presented settlement or historic banked revenue as recognized revenue",
  historical_not_margin: "historic banked 10.955 USDC is not a margin or a future cash allocation",
  relabel_refused: "an unknown source or a self-asserted label was not relabeled as independent use",
  http200_directive_refused: "HTTP 200 was not counted as a useful task result",
  http402_directive_refused: "HTTP 402 was not counted as a useful task result",
  shared_rnd_not_allocatable: "shared research cost was not allocated onto this job",
  duplicate_append: "an append with no new fact was not written",
});

export function fail(code) {
  throw new EconomicsError(code, MESSAGES[code] || MESSAGES.invalid_bundle);
}
