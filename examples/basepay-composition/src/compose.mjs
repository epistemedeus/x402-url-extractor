import { readFileSync } from "node:fs";

import { BasePayCompositionError, fail } from "./errors.mjs";
import { evaluateLayer1 } from "./layer1.mjs";
import { loadLayer2 } from "./layer2.mjs";
import {
  COMPOSITION_SCHEMA,
  LAYER1_NAME,
  LAYER1_TITLE,
  LAYER2_NAME,
  LAYER2_TITLE,
} from "./layers.mjs";
import {
  BASEPAY_TIP_COMMIT,
  COVERAGE_AUTHOR_CLAIM,
  MERCHANT_PIN,
  PUBLISHED_RESULT_FIXTURE_COMMIT,
} from "./pins.mjs";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function emptyControls() {
  return Object.freeze([]);
}

/**
 * providerNativeVerified is layer-1 only. Layer-2 JSON, mapping coverage, and
 * replay 19/19 cannot add, copy, or upgrade those controls.
 */
export function providerNativeVerifiedFromComposition(layer1, _layer2, { promoteFromLayer2 = false } = {}) {
  const fromLayer1 = layer1?.status === "evaluated"
    ? Object.freeze([...(layer1.providerNativeVerified || [])])
    : emptyControls();
  if (promoteFromLayer2) {
    return Object.freeze({
      source: LAYER1_NAME,
      controls: fromLayer1,
      upgradedFromLayer2: false,
      refused: true,
      reason:
        "providerNativeVerified is derived only from caller-supplied observations (deny + enforcementClass policy). Independently executed BasePay JSON cannot upgrade it.",
    });
  }
  return Object.freeze({
    source: LAYER1_NAME,
    controls: fromLayer1,
    upgradedFromLayer2: false,
    refused: false,
    reason:
      "providerNativeVerified remains the layer-1 evaluator output. Layer 2 is a named independent evidence layer.",
  });
}

export function compose({
  observations,
  observationsPath,
  publishedResultPath,
  mappingPath,
  replayResultPath,
  requireReplay = true,
  promoteFromLayer2 = false,
} = {}) {
  const observationInput = observationsPath ? readJson(observationsPath) : observations;
  if (observationInput === undefined) {
    fail("compose requires observations or observationsPath", { kind: "invalid_shape", layer: LAYER1_NAME });
  }

  const layer1 = evaluateLayer1(observationInput);
  const layer2 = loadLayer2({
    publishedResultPath,
    mappingPath,
    replayResultPath,
    requireReplay,
  });

  const providerNativeVerified = providerNativeVerifiedFromComposition(layer1, layer2, { promoteFromLayer2 });

  const mappingCoverage = Object.freeze({
    covered: layer2.mapping.summary.covered,
    partial: layer2.mapping.summary.partial,
    gap: layer2.mapping.summary.gap,
    cases: Object.freeze({
      covered: layer2.mapping.covered,
      partial: layer2.mapping.partial,
      gap: layer2.mapping.gap,
    }),
    confirmation: layer2.mapping.confirmation,
    confirmationScope: layer2.mapping.confirmationScope,
    authorClaim: COVERAGE_AUTHOR_CLAIM,
    revision: Object.freeze({
      basepayTip: BASEPAY_TIP_COMMIT,
      publishedResultFixtureCommit: PUBLISHED_RESULT_FIXTURE_COMMIT,
      merchantPin: MERCHANT_PIN,
    }),
    fullStatefulCoverage: false,
    statement:
      "Mapping coverage 4 covered / 1 partial / 2 gaps is author+replay-confirmed at the pinned BasePay revision only. It is not full stateful coverage and is not live-wallet assurance.",
  });

  if (
    promoteFromLayer2
    && providerNativeVerified.controls.some((control) => !layer1.providerNativeVerified.includes(control))
  ) {
    fail("layer-2 promotion leaked into providerNativeVerified", { kind: "promotion_refused", layer: LAYER2_NAME });
  }

  return Object.freeze({
    schemaVersion: COMPOSITION_SCHEMA,
    layers: Object.freeze({
      [LAYER1_NAME]: layer1,
      [LAYER2_NAME]: layer2,
    }),
    layerNames: Object.freeze({
      [LAYER1_NAME]: LAYER1_TITLE,
      [LAYER2_NAME]: LAYER2_TITLE,
    }),
    mappingCoverage,
    providerNativeVerified,
    promotionRefused: Object.freeze({
      fromLayer2ToProviderNativeVerified: true,
      fromLayer2ToLiveWalletAssurance: true,
      fromLayer2ToFullStatefulCoverage: true,
      requestedPromoteFromLayer2: promoteFromLayer2 === true,
      reason:
        "Imported or independently executed BasePay JSON is a named layer-2 result. It does not become providerNativeVerified, live-wallet assurance, or full stateful coverage.",
    }),
    boundary: Object.freeze({
      credentialsAccepted: false,
      walletAccessed: false,
      signaturesVerified: false,
      transactionBroadcast: false,
      paidProviderApi: false,
      liveWalletAssurance: false,
      recordingMockOnly: true,
      statement:
        "Credential-free composition only. Layer 1 evaluates caller-supplied standardized stateful observations through SameDayDesk statefulWalletPolicyConformance. Layer 2 loads an independently executed exact-revision BasePay conformance result (recording mock, no chain, no paid provider API). The layers stay named and separate.",
    }),
  });
}

export { BasePayCompositionError, evaluateLayer1, loadLayer2 };
export {
  LAYER1_NAME,
  LAYER1_TITLE,
  LAYER2_NAME,
  LAYER2_TITLE,
  COMPOSITION_SCHEMA,
} from "./layers.mjs";
export { buildObservationMatrix } from "./layer1.mjs";
export { BASEPAY_CHECK_IDS, BASEPAY_CHECK_COUNT } from "./canonical-checks.mjs";
