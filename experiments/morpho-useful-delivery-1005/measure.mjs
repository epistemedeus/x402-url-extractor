import { morphoPosition } from "../../morpho-position.mjs";
import { bindMerchantHttpDeliveryContracts } from "../../http-delivery-evidence/bind-merchant-contracts.mjs";
import {
  DELIVERY,
  RESOURCES,
  SETTLEMENT_CLASS,
  USEFULNESS_UNKNOWN,
  VERDICT,
  evaluateResponseBytes,
} from "../../http-delivery-evidence/index.mjs";
import { freeIndexBaseline } from "./baseline.mjs";
import { FIXTURE_ADDRESS, FREE_INDEX_ITEM, fixtureFetch, graphqlPage } from "./fixture.mjs";

const SHOCKS = [-10, -50];
const ADDRESS_RE = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/;

bindMerchantHttpDeliveryContracts();

async function produce(page) {
  return morphoPosition(FIXTURE_ADDRESS, {
    shocks: SHOCKS,
    rpcCheck: false,
    fetchImpl: fixtureFetch(page),
  });
}

function classify(body) {
  return evaluateResponseBytes({
    method: "GET",
    resource: RESOURCES.MORPHO_POSITION,
    responseBytes: Buffer.from(JSON.stringify(body)),
    merchantHttpStatus: 200,
    settlementClass: SETTLEMENT_CLASS.SIMULATED,
  });
}

export async function runMeasurement() {
  const snapshot = await produce(graphqlPage(FREE_INDEX_ITEM, {
    count: 1,
    countTotal: 1,
    limit: 100,
    skip: 0,
  }));
  const empty = await produce(graphqlPage(null, { count: 0, countTotal: 0, limit: 100, skip: 0 }));
  const truncated = await produce(graphqlPage(FREE_INDEX_ITEM, {
    count: 1,
    countTotal: 101,
    limit: 100,
    skip: 0,
  }));
  let upstream = null;
  try {
    await morphoPosition(FIXTURE_ADDRESS, {
      shocks: SHOCKS,
      rpcCheck: false,
      fetchImpl: async () => ({ ok: false, status: 502, json: async () => ({}) }),
    });
  } catch (error) {
    upstream = {
      ok: false,
      address: FIXTURE_ADDRESS,
      error: String(error?.message || error),
      boundary: "No transaction was prepared or executed.",
    };
  }
  const malformed = { ok: true, address: FIXTURE_ADDRESS.toLowerCase() };
  const contradictory = { ...snapshot, positionCount: snapshot.positionCount + 1 };
  const baseline = freeIndexBaseline(FREE_INDEX_ITEM, SHOCKS);
  const paid = snapshot.positions[0];
  const healthExact = paid.risk.healthFactor === baseline.healthFactor
    && paid.risk.healthFactor === baseline.apiHealthFactor;
  const moveExact = paid.risk.collateralPriceMoveToLiquidationPct === baseline.liquidationMovePct
    && baseline.apiMoveFraction * 100 === baseline.liquidationMovePct;
  const shocksExact = paid.scenarios.every((scenario, index) => (
    scenario.collateralPriceShockPct === baseline.shocks[index].collateralPriceShockPct
    && scenario.healthFactor === baseline.shocks[index].healthFactor
    && scenario.liquidatable === baseline.shocks[index].liquidatable
  ));
  const classes = {
    okSnapshot: classify(snapshot).deliveryClass,
    noPosition: classify(empty).deliveryClass,
    http200OkFalse: classify(upstream).deliveryClass,
    truncated: classify(truncated).deliveryClass,
    malformed: classify(malformed).deliveryClass,
    missingOutput: evaluateResponseBytes({
      method: "GET",
      resource: RESOURCES.MORPHO_POSITION,
      responseBytes: Buffer.alloc(0),
      merchantHttpStatus: 200,
      settlementClass: SETTLEMENT_CLASS.SIMULATED,
    }).deliveryClass,
    contradictoryCount: classify(contradictory).deliveryClass,
  };
  const measured = {
    schema: "samedaydesk.morpho-useful-delivery-1005.v1",
    task: "non-customer indexed borrower, shocks -10 and -50, same GraphQL page for both sides",
    historical: {
      eventId: "e87c5642-c177-49bb-809a-05912264d7e3",
      settlementReference: "0x2439870db33f6e81157beffed44c26b02aad663aff595424929ac04f9030008d",
      route: "/defi/morpho-position",
      outputRetained: false,
      backfilled: false,
      buyerPredicate: "unknown",
      usefulness: "unknown",
    },
    classes,
    verdicts: {
      okSnapshot: classify(snapshot).validatorVerdict,
      http200OkFalse: classify(upstream).validatorVerdict,
    },
    usefulnessOnMeasuredClasses: USEFULNESS_UNKNOWN,
    fidelity: {
      healthFactor: healthExact ? "exact" : "differs",
      liquidationMove: moveExact ? "same_quantity_rescaled_to_percent" : "differs",
      shockTable: shocksExact ? "exact_local_arithmetic" : "differs",
    },
    adaptation: {
      newUpstreamFacts: 0,
      localArithmetic: true,
      directRpcInThisComparison: "disabled_on_both_sides",
      fieldsRescaled: ["priceVariationToLiquidationPrice"],
      shocksPrecomputedFromFreeIntegers: shocksExact,
    },
    incrementalUtility: false,
    proposeNewPaidOffer: false,
    paymentTimingChanged: false,
    responseShapeChanged: false,
    http200IsNotComplete: classes.http200OkFalse === DELIVERY.UPSTREAM_FAILED
      && classify(upstream).validatorVerdict === VERDICT.INVALID,
  };
  const serialized = JSON.stringify(measured);
  if (ADDRESS_RE.test(serialized)) {
    throw new Error("measurement exported a wallet address");
  }
  if (measured.classes.okSnapshot !== DELIVERY.COMPLETE_USEFUL) {
    throw new Error("ok snapshot was not complete_useful");
  }
  if (measured.classes.noPosition !== DELIVERY.USEFUL_NEGATIVE) {
    throw new Error("empty portfolio was not useful_negative");
  }
  if (!measured.http200IsNotComplete) throw new Error("HTTP 200 ok:false counted as useful");
  if (measured.classes.truncated !== DELIVERY.TRUNCATED_PARTIAL) {
    throw new Error("truncated snapshot was not partial");
  }
  if (measured.classes.malformed !== DELIVERY.MALFORMED_BODY) {
    throw new Error("malformed body was not malformed");
  }
  if (measured.classes.missingOutput !== DELIVERY.MISSING_BODY) {
    throw new Error("missing output was not missing");
  }
  if (measured.classes.contradictoryCount !== DELIVERY.UNKNOWN) {
    throw new Error("contradictory count was not unknown");
  }
  if (measured.fidelity.healthFactor !== "exact" || measured.fidelity.shockTable !== "exact_local_arithmetic") {
    throw new Error("paid output did not match the free-index baseline");
  }
  return measured;
}
