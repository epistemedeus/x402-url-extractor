import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = dirname(fileURLToPath(import.meta.url));

export const EXAMPLE_ROOT = join(SRC, "..");
export const MERCHANT_ROOT = join(EXAMPLE_ROOT, "..", "..");
export const FIXTURES = join(EXAMPLE_ROOT, "fixtures");
export const OBSERVATION_FIXTURES = join(FIXTURES, "observations");
export const BASEPAY_FIXTURES = join(FIXTURES, "basepay");

export const SYNTHETIC_PUBLISHED_RESULT_FIXTURE = join(
  BASEPAY_FIXTURES,
  "synthetic-published-conformance-result.json",
);
export const SYNTHETIC_REPLAY_RESULT_FIXTURE = join(
  BASEPAY_FIXTURES,
  "synthetic-replay-conformance-result.json",
);
export const SYNTHETIC_MAPPING_FIXTURE = join(
  BASEPAY_FIXTURES,
  "synthetic-stateful-taxonomy-mapping.json",
);
export const DIGESTS_FIXTURE = join(BASEPAY_FIXTURES, "DIGESTS.json");
export const POINTER_FIXTURE = join(BASEPAY_FIXTURES, "POINTER.json");

/** Default compose/tests use synthetic fixtures (fresh clone, no network). */
export const PUBLISHED_RESULT_FIXTURE = SYNTHETIC_PUBLISHED_RESULT_FIXTURE;
export const REPLAY_RESULT_FIXTURE = SYNTHETIC_REPLAY_RESULT_FIXTURE;
export const MAPPING_FIXTURE = SYNTHETIC_MAPPING_FIXTURE;

export const VENDORED_UPSTREAM_FILENAMES = Object.freeze([
  "published-conformance-result.json",
  "stateful-taxonomy-mapping-2026-09-05.json",
  "replay-conformance-result.json",
]);

export const RUNTIME_DIR = join(EXAMPLE_ROOT, "runtime");
export const UPSTREAM_RUNTIME_DIR = join(RUNTIME_DIR, "upstream");
export const ACQUIRED_RESULT = join(UPSTREAM_RUNTIME_DIR, "conformance-result.json");
export const ACQUIRED_MAPPING = join(UPSTREAM_RUNTIME_DIR, "stateful-taxonomy-mapping-2026-09-05.json");
export const ACQUIRE_RECEIPT = join(UPSTREAM_RUNTIME_DIR, "RECEIPT.json");

export const OBSERVATION_FIXTURE_FILES = Object.freeze({
  completeSafe: join(OBSERVATION_FIXTURES, "complete-safe.json"),
  missingRequired: join(OBSERVATION_FIXTURES, "missing-required.json"),
  partial: join(OBSERVATION_FIXTURES, "partial.json"),
  contradictory: join(OBSERVATION_FIXTURES, "contradictory.json"),
  unknownCase: join(OBSERVATION_FIXTURES, "unknown-case.json"),
  versionSkew: join(OBSERVATION_FIXTURES, "version-skew.json"),
});
