#!/usr/bin/env node
import { resolve } from "node:path";

import { compose } from "../src/compose.mjs";
import { BasePayCompositionError } from "../src/errors.mjs";
import {
  MAPPING_FIXTURE,
  OBSERVATION_FIXTURE_FILES,
  PUBLISHED_RESULT_FIXTURE,
  REPLAY_RESULT_FIXTURE,
} from "../src/paths.mjs";
import {
  BASEPAY_TIP_COMMIT,
  COMMENT,
  MERCHANT_PIN,
  OFFICIAL_COMMAND,
  PUBLISHED_RESULT_FIXTURE_COMMIT,
} from "../src/pins.mjs";

function usage(exitCode = 0) {
  const text = `SameDayDesk BasePay composition example

Credential-free two-layer composition. Never reads wallet credentials, signs,
broadcasts, or calls a paid provider API.

Layer 1: supplied observation matrix evaluated by SameDayDesk
         statefulWalletPolicyConformance (POST /security/stateful-wallet-policy-conformance).
Layer 2: independently executed exact-revision BasePay conformance result.
         Official command: ${OFFICIAL_COMMAND}

Default (complete-safe observations + pinned published result + independent replay copy):
  npm start
  npm run compose
  node bin/cli.mjs

Copyable CLI:
  node bin/cli.mjs --observations ./fixtures/observations/complete-safe.json
  node bin/cli.mjs --observations ./fixtures/observations/complete-safe.json \\
    --result ./fixtures/basepay/published-conformance-result.json \\
    --mapping ./fixtures/basepay/stateful-taxonomy-mapping-2026-09-05.json \\
    --replay-result ./fixtures/basepay/replay-conformance-result.json

Adversarial observation matrices (layer 1 rejected or partial; layer 2 unchanged):
  node bin/cli.mjs --observations ./fixtures/observations/missing-required.json
  node bin/cli.mjs --observations ./fixtures/observations/partial.json
  node bin/cli.mjs --observations ./fixtures/observations/contradictory.json
  node bin/cli.mjs --observations ./fixtures/observations/unknown-case.json
  node bin/cli.mjs --observations ./fixtures/observations/version-skew.json

Pins:
  comment     ${COMMENT.url}
  BasePay tip ${BASEPAY_TIP_COMMIT}
  published   ${PUBLISHED_RESULT_FIXTURE_COMMIT}
  merchant    ${MERCHANT_PIN}

Notes:
  - providerNativeVerified is layer-1 only (deny + enforcementClass policy).
  - Layer-2 19/19 PASS does not upgrade providerNativeVerified.
  - Mapping coverage 4 covered / 1 partial / 2 gaps is pinned-revision only.
  - This is not live-wallet assurance and not full stateful coverage.
`;
  console.log(text);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = {
    help: false,
    observationsPath: OBSERVATION_FIXTURE_FILES.completeSafe,
    publishedResultPath: PUBLISHED_RESULT_FIXTURE,
    mappingPath: MAPPING_FIXTURE,
    replayResultPath: REPLAY_RESULT_FIXTURE,
    requireReplay: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--observations") args.observationsPath = resolve(argv[++i]);
    else if (token === "--result") args.publishedResultPath = resolve(argv[++i]);
    else if (token === "--mapping") args.mappingPath = resolve(argv[++i]);
    else if (token === "--replay-result") args.replayResultPath = resolve(argv[++i]);
    else if (token === "--no-replay") {
      args.replayResultPath = null;
      args.requireReplay = false;
    } else {
      throw new Error(`unknown argument: ${token}`);
    }
  }
  return args;
}

function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(String(error?.message || error));
    usage(1);
    return;
  }
  if (args.help) {
    usage(0);
    return;
  }
  try {
    const report = compose({
      observationsPath: args.observationsPath,
      publishedResultPath: args.publishedResultPath,
      mappingPath: args.mappingPath,
      replayResultPath: args.replayResultPath,
      requireReplay: args.requireReplay,
    });
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    const message = error instanceof BasePayCompositionError
      ? `${error.kind}: ${error.message}`
      : String(error?.message || error);
    console.error(message);
    process.exitCode = 1;
  }
}

main();
