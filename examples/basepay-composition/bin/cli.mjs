#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { compose } from "../src/compose.mjs";
import { BasePayCompositionError } from "../src/errors.mjs";
import {
  ACQUIRED_MAPPING,
  ACQUIRED_RESULT,
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
Layer 2: BasePay conformance report. Default bytes are synthetic offline
         fixtures (evidenceOrigin=synthetic_offline_fixture). Optional acquired
         upstream JSON is provided_report, not an independently executed replay.
         Official command (separately labelled, not the default path): ${OFFICIAL_COMMAND}

Default (complete-safe observations + synthetic published/mapping/replay-shape):
  npm start
  npm run compose
  node bin/cli.mjs

Copyable CLI:
  node bin/cli.mjs --observations ./fixtures/observations/complete-safe.json
  node bin/cli.mjs --observations ./fixtures/observations/complete-safe.json \\
    --result ./fixtures/basepay/synthetic-published-conformance-result.json \\
    --mapping ./fixtures/basepay/synthetic-stateful-taxonomy-mapping.json \\
    --replay-result ./fixtures/basepay/synthetic-replay-conformance-result.json

Optional pinned upstream download (gitignored; never executed):
  npm run acquire-upstream
  node bin/cli.mjs --use-acquired
  node bin/cli.mjs --observations ./fixtures/observations/complete-safe.json \\
    --result ./runtime/upstream/conformance-result.json \\
    --mapping ./runtime/upstream/stateful-taxonomy-mapping-2026-09-05.json \\
    --no-replay

Adversarial observation matrices (layer 1 rejected or partial; layer 2 unchanged):
  node bin/cli.mjs --observations ./fixtures/observations/missing-required.json
  node bin/cli.mjs --observations ./fixtures/observations/partial.json
  node bin/cli.mjs --observations ./fixtures/observations/contradictory.json
  node bin/cli.mjs --observations ./fixtures/observations/unknown-case.json
  node bin/cli.mjs --observations ./fixtures/observations/version-skew.json

Separately labelled harness input (not auto-promoted from provided-report):
  node bin/cli.mjs --harness-result /path/to/harness/conformance-result.json

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
  - MIT on this example does not cover upstream JSON. Upstream bytes are not shipped.
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
    separatelyLabelledHarness: false,
    useAcquired: false,
    resultExplicit: false,
    mappingExplicit: false,
    replayExplicit: false,
    replayFlag: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--observations") args.observationsPath = resolve(argv[++i]);
    else if (token === "--result") {
      args.publishedResultPath = resolve(argv[++i]);
      args.resultExplicit = true;
    } else if (token === "--mapping") {
      args.mappingPath = resolve(argv[++i]);
      args.mappingExplicit = true;
    } else if (token === "--replay-result") {
      if (args.replayFlag && args.replayFlag !== "--replay-result") {
        throw new Error("cannot combine --replay-result with --harness-result or --no-replay");
      }
      args.replayResultPath = resolve(argv[++i]);
      args.requireReplay = true;
      args.separatelyLabelledHarness = false;
      args.replayExplicit = true;
      args.replayFlag = "--replay-result";
    } else if (token === "--harness-result") {
      if (args.replayFlag && args.replayFlag !== "--harness-result") {
        throw new Error("cannot combine --harness-result with --replay-result or --no-replay");
      }
      args.replayResultPath = resolve(argv[++i]);
      args.requireReplay = true;
      args.separatelyLabelledHarness = true;
      args.replayExplicit = true;
      args.replayFlag = "--harness-result";
    } else if (token === "--no-replay") {
      if (args.replayFlag && args.replayFlag !== "--no-replay") {
        throw new Error("cannot combine --no-replay with --replay-result or --harness-result");
      }
      args.replayResultPath = null;
      args.requireReplay = false;
      args.separatelyLabelledHarness = false;
      args.replayExplicit = true;
      args.replayFlag = "--no-replay";
    } else if (token === "--use-acquired") {
      args.useAcquired = true;
    } else {
      throw new Error(`unknown argument: ${token}`);
    }
  }
  if (args.useAcquired) {
    if (!args.resultExplicit) args.publishedResultPath = ACQUIRED_RESULT;
    if (!args.mappingExplicit) args.mappingPath = ACQUIRED_MAPPING;
    if (!args.replayExplicit) {
      args.replayResultPath = null;
      args.requireReplay = false;
    }
    if (!existsSync(args.publishedResultPath) || !existsSync(args.mappingPath)) {
      throw new Error("acquired upstream files missing; run: npm run acquire-upstream");
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
      separatelyLabelledHarness: args.separatelyLabelledHarness,
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
