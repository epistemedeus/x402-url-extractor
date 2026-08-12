const PROFILE_PATH = "/.well-known/paid-action-effects.json";

export const PAID_ACTION_EFFECT_PROFILE_VERSION = "0.1.0";
export const PAID_ACTION_EFFECT_PROFILE_PATH = PROFILE_PATH;

export const READ_ONLY_PAID_POST_OPERATIONS = Object.freeze([
  Object.freeze({ method: "POST", path: "/work/opportunity-preflight" }),
  Object.freeze({ method: "POST", path: "/commerce/payment-offer-preflight" }),
  Object.freeze({ method: "POST", path: "/security/wallet-policy-conformance" }),
  Object.freeze({ method: "POST", path: "/security/stateful-wallet-policy-conformance" }),
]);

const OPERATION_KEYS = new Set(READ_ONLY_PAID_POST_OPERATIONS.map(({ method, path }) => `${method} ${path}`));

export function isReadOnlyPaidPost(method, path) {
  return OPERATION_KEYS.has(`${String(method || "").toUpperCase()} ${String(path || "")}`);
}

export function paidActionEffectExtension() {
  return {
    version: PAID_ACTION_EFFECT_PROFILE_VERSION,
    classification: "read_only",
    unpaidRequest: {
      applicationEffects: "none",
      protocolStateMayBeRecorded: ["payment_challenge"],
      telemetryPersisted: false,
    },
    retry: {
      applicationEffectAtMostOnce: "not_applicable_read_only",
      responseReplay: "conditional",
      requestBinding: ["method", "canonical_url", "exact_raw_body_sha256", "payer", "payment_terms", "exact_settled_credential"],
      x402Requirement: "payment-identifier extension",
      mppRequirement: "exact settled credential",
      mismatchStatus: 409,
    },
    profile: PAID_ACTION_EFFECT_PROFILE_PATH,
  };
}

export function attachPaidActionEffectContracts(document) {
  for (const { method, path } of READ_ONLY_PAID_POST_OPERATIONS) {
    const operation = document?.paths?.[path]?.[method.toLowerCase()];
    if (!operation || typeof operation !== "object") {
      throw new Error(`Missing paid action operation for ${method} ${path}`);
    }
    operation["x-paid-effect"] = paidActionEffectExtension();
  }
  return document;
}

export function buildPaidActionEffectProfile({ origin, serviceVersion }) {
  const normalizedOrigin = new URL(origin).origin;
  return {
    schemaVersion: "samedaydesk.paid-action-effects.v0",
    status: "experimental",
    version: PAID_ACTION_EFFECT_PROFILE_VERSION,
    service: {
      origin: normalizedOrigin,
      version: String(serviceVersion),
    },
    semantics: {
      read_only: "The protected operation computes and returns evidence but does not create, update, or delete business state.",
      state_changing: "Reserved for a future profile that must bind a client-generated application idempotency key before the unpaid request.",
      boundary: "Payment replay, application-effect idempotency, and business-effect receipts are separate contracts.",
    },
    operations: READ_ONLY_PAID_POST_OPERATIONS.map(({ method, path }) => ({
      method,
      path,
      ...paidActionEffectExtension(),
    })),
    interoperability: {
      paymentProtocols: ["x402", "mpp"],
      idempotencyKeyDraft: "https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/",
      mppProtocol: "https://mpp.dev/protocol",
      x402PaymentIdentifier: "https://docs.x402.org/extensions/payment-identifier",
      adoptionClaim: "SameDayDesk dogfood only; no external standard or marketplace adoption is claimed.",
    },
  };
}

export function paidActionEffectHeaders(req, res, next) {
  if (isReadOnlyPaidPost(req.method, req.path)) {
    res.set("X-SameDayDesk-Paid-Effect", "read_only");
    res.set("X-SameDayDesk-Paid-Effect-Profile", PAID_ACTION_EFFECT_PROFILE_PATH);
  }
  return next();
}
