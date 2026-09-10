import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  REPORT_STATUS,
  REUSE_FROM,
  SCHEMA,
  SCOPE_NOTE,
  SEPARATE_FROM,
  UNKNOWN_LICENSE,
  buildDependencyFootprintOverlap,
} from "../src/index.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = (name) => JSON.parse(readFileSync(join(root, "fixtures", name), "utf8"));
const FIXED = () => Date.parse("2026-09-10T12:00:00.000Z");

test("positive: detects multi-version and multi-tree runtime duplicates + licenses", () => {
  const report = buildDependencyFootprintOverlap(load("positive.json"), { clock: FIXED });
  assert.equal(report.schema, SCHEMA);
  assert.equal(report.status, REPORT_STATUS.READY);
  assert.equal(report.generatedAt, "2026-09-10T12:00:00.000Z");
  assert.equal(report.reuseFrom, REUSE_FROM);
  assert.equal(report.scopeNote, SCOPE_NOTE);
  assert.equal(report.separateFrom, SEPARATE_FROM);
  assert.match(report.scopeNote, /not S127/i);

  const byName = Object.fromEntries(
    report.duplicateRuntimeDependencies.map((d) => [d.name, d]),
  );

  // lodash: 4.17.21 in A, 4.17.20 in B → multi-version + multi-tree
  assert.ok(byName.lodash);
  assert.ok(byName.lodash.reasons.includes("multiple_versions"));
  assert.ok(byName.lodash.reasons.includes("multiple_trees"));
  assert.deepEqual(byName.lodash.versions, ["4.17.20", "4.17.21"]);

  // express: same version in both trees → multi-tree only
  assert.ok(byName.express);
  assert.ok(byName.express.reasons.includes("multiple_trees"));
  assert.equal(byName.express.reasons.includes("multiple_versions"), false);

  // typescript / eslint are dev-only → not in duplicate runtime list
  assert.equal(byName.typescript, undefined);
  assert.equal(byName.eslint, undefined);

  // left-pad / uuid / semver unique runtime → not duplicates
  assert.equal(byName["left-pad"], undefined);
  assert.equal(byName.uuid, undefined);
  assert.equal(byName.semver, undefined);

  // licenses retained; debug has unknown
  const debugLic = report.declaredLicenses.find(
    (l) => l.name === "debug" && l.treeId === "service-b",
  );
  assert.ok(debugLic);
  assert.equal(debugLic.license, UNKNOWN_LICENSE);
  assert.equal(debugLic.licenseUnknown, true);

  const lodashA = report.declaredLicenses.find(
    (l) => l.name === "lodash" && l.treeId === "service-a",
  );
  assert.equal(lodashA.license, "MIT");
  assert.equal(lodashA.licenseDeclared, true);

  assert.ok(report.summary.duplicateRuntimeCount >= 2);
  assert.equal(Object.prototype.hasOwnProperty.call(report, "cveScore"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(report, "securityCertification"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(report, "legalAdvice"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(report, "complianceScore"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(report, "investAdvice"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(report, "seoRank"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(report, "trafficProjection"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(report, "s127ApiImpact"), false);
  assert.match(report.dryRun, /never invent licenses/i);
});

test("negative: forbidden fields yield rejected report", () => {
  const report = buildDependencyFootprintOverlap(load("negative-malformed.json"), {
    clock: FIXED,
  });
  assert.equal(report.status, REPORT_STATUS.REJECTED);
  assert.equal(report.error.code, "forbidden_claim");
  assert.equal(report.separateFrom, SEPARATE_FROM);
  assert.equal(report.scopeNote, SCOPE_NOTE);
  assert.equal(Object.prototype.hasOwnProperty.call(report, "cveScore"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(report, "securityCertification"), false);
});

test("partial: incomplete lock entries yield partial_input", () => {
  const report = buildDependencyFootprintOverlap(load("partial-incomplete.json"), {
    clock: FIXED,
  });
  assert.equal(report.status, REPORT_STATUS.PARTIAL_INPUT);
  assert.ok(report.partialReasons.includes("incomplete_dependency_entries"));
  // lodash complete entry still present in licenses
  const lodash = report.declaredLicenses.find((l) => l.name === "lodash");
  assert.ok(lodash);
  assert.equal(lodash.incomplete, false);
  // mystery-pkg missing version → incomplete + unknown-ish retained
  const mystery = report.declaredLicenses.find((l) => l.name === "mystery-pkg");
  assert.ok(mystery);
  assert.equal(mystery.incomplete, true);
});

test("unknown license retained without inventing SPDX", () => {
  const report = buildDependencyFootprintOverlap(
    {
      reportId: "unknown-lic",
      trees: [
        {
          id: "t1",
          dependencies: [{ name: "plain", version: "1.0.0" }],
        },
      ],
    },
    { clock: FIXED },
  );
  assert.equal(report.status, REPORT_STATUS.READY);
  assert.equal(report.declaredLicenses[0].license, UNKNOWN_LICENSE);
  assert.equal(report.declaredLicenses[0].licenseUnknown, true);
  assert.equal(report.summary.unknownLicenseCount, 1);
});

test("S127 separation note always present", () => {
  const report = buildDependencyFootprintOverlap(load("positive.json"), { clock: FIXED });
  assert.equal(report.separateFrom, "S127");
  assert.match(report.scopeNote, /S127/);
  assert.ok(!/api impact score/i.test(JSON.stringify(report)));
});

test("single-tree multi-version duplicate detected", () => {
  const report = buildDependencyFootprintOverlap(
    {
      reportId: "single-multi-ver",
      trees: [
        {
          id: "t1",
          dependencies: [
            { name: "foo", version: "1.0.0", license: "MIT" },
            { name: "foo", version: "2.0.0", license: "MIT", path: "nested" },
          ],
        },
      ],
    },
    { clock: FIXED },
  );
  assert.equal(report.status, REPORT_STATUS.READY);
  assert.equal(report.duplicateRuntimeDependencies.length, 1);
  assert.equal(report.duplicateRuntimeDependencies[0].name, "foo");
  assert.deepEqual(report.duplicateRuntimeDependencies[0].versions, ["1.0.0", "2.0.0"]);
  assert.ok(report.duplicateRuntimeDependencies[0].reasons.includes("multiple_versions"));
});
