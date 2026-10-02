import {
  PAID_OPERATION_PATH,
  assessSellerIntegrityUsefulness,
  operationUrl,
  planRestart,
} from "../../../paid-useful-journey.mjs";
import {
  PAID_METHOD,
  PAID_PRICE_ATOMIC,
  PAID_PRICE_DISPLAY,
  PAID_PRODUCT,
  PAID_ROUTE,
  PAID_VERSION,
} from "./constants.mjs";

function decodeChallenge(response) {
  const encoded = response.headers.get("payment-required");
  if (!encoded || response.status !== 402) return null;
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    try {
      return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    } catch {
      return null;
    }
  }
}

export function exactPaidRequest(intake) {
  const url = new URL(`https://merchant.invalid${PAID_ROUTE}`);
  url.searchParams.set("origin", intake.origin);
  url.searchParams.set("route", intake.resource);
  url.searchParams.set("method", intake.method);
  if (intake.expectedUsefulOutput.paths.length) {
    url.searchParams.set("requiredPaths", intake.expectedUsefulOutput.paths.join(","));
  }
  url.searchParams.set("requireBazaar", "false");
  return {
    method: PAID_METHOD,
    route: PAID_ROUTE,
    product: PAID_PRODUCT,
    version: PAID_VERSION,
    query: {
      origin: intake.origin,
      route: intake.resource,
      method: intake.method,
      requiredPaths: intake.expectedUsefulOutput.paths.join(","),
      requireBazaar: "false",
    },
    pathAndQuery: `${url.pathname}${url.search}`,
  };
}

export function validatePaidReport(body, intake) {
  return assessSellerIntegrityUsefulness(body, {
    origin: intake.origin,
    route: intake.resource,
    method: intake.method,
  });
}

export async function buildHandoff({ intake, merchantBase = null, fetchImpl = fetch }) {
  const request = exactPaidRequest(intake);
  const expectation = {
    product: PAID_PRODUCT,
    version: PAID_VERSION,
    decisions: ["machine_buyable", "contract_ready", "repair_required"],
    additionalWork: ["report.responseContract", "report.repairPlan", "report.findings"],
    validation: "assessSellerIntegrityUsefulness",
    doesNotEstablish: ["paid response body of the target", "handler execution", "useful task equivalence"],
  };
  const handoff = {
    request,
    expectation,
    price: {
      display: PAID_PRICE_DISPLAY,
      atomic: PAID_PRICE_ATOMIC,
      authority: "documented_existing_route",
      priceChanged: false,
      skuAdded: false,
    },
    purchasePerformed: false,
    paymentSent: false,
    revenueRecognized: false,
    operationPath: PAID_OPERATION_PATH,
  };
  if (!merchantBase) return handoff;
  const url = operationUrl(merchantBase, {
    origin: intake.origin,
    route: intake.resource,
    method: intake.method,
  });
  const response = await fetchImpl(url, {
    method: "GET",
    redirect: "manual",
    headers: { accept: "application/json" },
  });
  const challenge = decodeChallenge(response);
  const accept = challenge?.accepts?.find((item) => item?.scheme === "exact") || challenge?.accepts?.[0] || null;
  const atomic = accept?.amount === undefined || accept?.amount === null ? null : String(accept.amount);
  return {
    ...handoff,
    live: {
      status: response.status,
      charged: response.status === 400 ? false : null,
      amountAtomic: atomic,
      priceMatchesDocumented: atomic === PAID_PRICE_ATOMIC,
      payToPresent: typeof accept?.payTo === "string" && accept.payTo.length > 0,
    },
    price: {
      ...handoff.price,
      atomic: atomic || PAID_PRICE_ATOMIC,
      authority: atomic ? "existing_route_challenge" : "documented_existing_route",
      priceChanged: atomic !== null && atomic !== PAID_PRICE_ATOMIC,
    },
  };
}

export function observePaidOutcome(observation = {}) {
  const kind = observation.kind || observation.reason || "unknown";
  const restart = planRestart({
    events: observation.priorEvents || [],
    journeyId: observation.journeyId || "0".repeat(32),
    session: observation.session || null,
  });
  let preserved = "unspecified";
  if (observation.charged === false || kind === "no_charge_input_failure" || observation.status === 400) {
    preserved = "no_charge_input_failure";
  } else if (restart.action === "stop" && restart.reason === "duplicate_settled") preserved = "replay";
  else if (restart.action === "stop" && restart.reason === "unknown_financial_outcome") preserved = "unknown";
  else if (kind === "replay" || kind === "duplicate_settled" || observation.replay === true) preserved = "replay";
  else if (kind === "unknown" || kind === "unknown_financial_outcome" || observation.financialOutcome === "unknown") preserved = "unknown";
  else if (kind === "failure" || kind === "delivery_failed" || observation.usefulDelivery === "false") preserved = "failure";
  else if (kind === "valid_delivery" || observation.usefulDelivery === "true") preserved = "delivered";
  const validated = observation.body ? validatePaidReport(observation.body, observation.intake || {
    origin: observation.origin,
    resource: observation.route,
    method: observation.method || "GET",
    expectedUsefulOutput: { paths: [] },
  }) : { useful: false, reason: "body_unavailable" };
  const blocked = ["failure", "replay", "unknown", "no_charge_input_failure"].includes(preserved);
  const actualValidDelivery = blocked ? false : preserved === "delivered" && validated.useful === true;
  return {
    preserved,
    actualValidDelivery,
    usefulReason: validated.reason,
    paymentSentByPackage: false,
    revenueRecognized: false,
    recognizedRevenueAtomic: "0",
    historicalRevenue: "unknown",
    restart,
  };
}
