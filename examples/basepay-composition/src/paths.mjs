import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = dirname(fileURLToPath(import.meta.url));

export const EXAMPLE_ROOT = join(SRC, "..");
export const MERCHANT_ROOT = join(EXAMPLE_ROOT, "..", "..");
export const FIXTURES = join(EXAMPLE_ROOT, "fixtures");
export const OBSERVATION_FIXTURES = join(FIXTURES, "observations");
export const BASEPAY_FIXTURES = join(FIXTURES, "basepay");

export const PUBLISHED_RESULT_FIXTURE = join(BASEPAY_FIXTURES, "published-conformance-result.json");
export const REPLAY_RESULT_FIXTURE = join(BASEPAY_FIXTURES, "replay-conformance-result.json");
export const MAPPING_FIXTURE = join(BASEPAY_FIXTURES, "stateful-taxonomy-mapping-2026-09-05.json");
export const DIGESTS_FIXTURE = join(BASEPAY_FIXTURES, "DIGESTS.json");

export const OBSERVATION_FIXTURE_FILES = Object.freeze({
  completeSafe: join(OBSERVATION_FIXTURES, "complete-safe.json"),
  missingRequired: join(OBSERVATION_FIXTURES, "missing-required.json"),
  partial: join(OBSERVATION_FIXTURES, "partial.json"),
  contradictory: join(OBSERVATION_FIXTURES, "contradictory.json"),
  unknownCase: join(OBSERVATION_FIXTURES, "unknown-case.json"),
  versionSkew: join(OBSERVATION_FIXTURES, "version-skew.json"),
});
