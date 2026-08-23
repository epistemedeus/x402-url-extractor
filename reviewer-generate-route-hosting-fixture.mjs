import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildCandidateManifestRecord,
  buildRouteHostingHarnessReceipt,
  canonicalize,
  computeCandidateFileDigests,
  sha256,
} from "./route-hosting-harness.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_RELATIVE = "test-fixtures/route-hosting-harness/v1.json";
const MANIFEST_RELATIVE = "test-fixtures/route-hosting-harness/candidate-manifest.json";

function fail(code) {
  process.stderr.write(`${code}\n`);
  process.exit(2);
}

if (process.env.REVIEWER_ROUTE_HOSTING_MAINTENANCE !== "1") {
  fail("reviewer_maintenance_required");
}
if (process.env.GENERATE_ROUTE_HOSTING_FIXTURE) {
  fail("hostile_env_binding");
}

const result = await buildRouteHostingHarnessReceipt();
writeFileSync(path.join(ROOT, FIXTURE_RELATIVE), result.encoded, { encoding: "utf8" });
const files = computeCandidateFileDigests();
const fixtureSha256 = sha256(result.encoded);
const manifest = buildCandidateManifestRecord({ files, fixtureSha256 });
if (manifest.candidateTreeSha256 !== result.candidateTreeSha256) {
  fail("candidate_tree_drift");
}
writeFileSync(path.join(ROOT, MANIFEST_RELATIVE), `${canonicalize(manifest)}\n`, { encoding: "utf8" });
process.stdout.write(`${canonicalize({
  fixtureRelative: FIXTURE_RELATIVE,
  fixtureSha256,
  candidateTreeSha256: manifest.candidateTreeSha256,
  manifestRelative: MANIFEST_RELATIVE,
})}\n`);
