export const REPORT_SCHEMA = "samedaydesk.attempt-useful-view.report.v1";
export const RETAINED_SCHEMA = "samedaydesk.attempt-useful-view.retained.v1";
export const JOB_ID = "SOL-LIVE-ATTEMPT-DELIVERY-261003";
export const ADAPT_JOB_ID = "HEAVY-ATTEMPT-USEFUL-ADAPT-161-1005";
export const COMPLETE_JOB_ID = "HEAVY-ATTEMPT-USEFUL-COMPLETE-161-1005";
export const ADAPT_HEAD = "e687ca11c2e05e8ac41ede83dc1b98cfe46c3a7c";
export const PRIOR_VIEW_HEAD = "4e49c4db58ea0f5897240781fd14d80566bbabd0";

// This view is not a child of a prior attempt. Callers may not set another value.
export const ATTEMPT_OF = null;

// An operation id this packet must not mint again.
export const FORBIDDEN_OPERATION = "add923ae-3eb5-474b-8b3e-e376666dee83";

export const DISPOSITIONS = Object.freeze([
  "producer-observed",
  "covered-absence",
  "caller asserted",
  "classified",
  "authorized",
  "unresolved",
]);

export const PINS = Object.freeze({
  causalProof301: "45db5507d1fef740dfe5fe84ec611c7b764d8c43",
  taskProducer339: "91fbf94786658c96c89f94e0f88b03caefd951b0",
  causalMeasurement395: "519645af3a2fa36f745d59f08aab4008776a4aa6",
  freeUseObserver421: "26d806f20e57d0c073321675dacb13395e30c643",
  terminalReader423: "5693610be4d7fdf7d13044be666f712b7ea189f8",
  seller041: "015f07d5a75d02a4e74709b17b2b1176501e92a5",
  // Merchant160 stays historical. Integration is pinned to merged merchant161.
  releasedMerchantHead: "32f07a836fb28e400d56b0e2e876043644bde31a",
  historicalReleasedMerchantHead: "dc32cf7bf5fd76a5cd9047865f49b2462252897c",
  // Cold-command receiving readback merged by merchant161. It is not a server patch.
  publicAcquisitionArtifact: "4b7928f315be9d9ec7d14f2604eab1b7b236a63a",
});

// Test-only clock-window fix. This branch does not apply it. Production freshness stays 900000 ms.
// Commit de4c2a1f is not an ancestor of merchant161. Merchant161's observer test blob matches that commit.
export const CLOCK_WINDOW_FIX = "de4c2a1f5e52065273b677a8694913a98850dcf0";
export const CLOCK_WINDOW_FIX_BRANCH = "codex/task-observer-window-1003";
export const CLOCK_WINDOW_FIX_APPLIED = false;
export const CLOCK_WINDOW_FIX_ON_THIS_BRANCH = false;
export const CLOCK_WINDOW_FIX_COMMIT_ANCESTOR_OF_MERCHANT161 = false;
export const CLOCK_WINDOW_FIX_CONTENT_ON_MERCHANT161 = true;
export const PRODUCTION_FRESHNESS_MAX_AGE_MS = 900_000;

export const TASK_REF = /^t[a-f0-9]{62}$/;
export const HEX64 = /^[0-9a-f]{64}$/;
export const EVENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
