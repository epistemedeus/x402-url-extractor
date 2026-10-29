import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { compareVersions, decidePin } from "../src/osv-pin.mjs";
import { claimsFromText } from "../src/reader-claim.mjs";
import { INTEGRATION_RECOMMENDATION } from "../src/recommendation.mjs";
import { REQUIRED_FILES } from "../src/required-files.mjs";
import { maintainCycle } from "../src/maintain.mjs";
import { assertScenarioContract, FIXTURE_ROOT, PIN, runScenarios } from "../src/scenarios.mjs";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

test("semver ordering matches the OSV fixed and last_affected examples", () => {
  assert.equal(compareVersions("1.19.0", "1.20.0"), -1);
  assert.equal(compareVersions("1.20.0", "1.20.0"), 0);
  assert.equal(compareVersions("1.20.0-rc.1", "1.20.0"), -1);
  assert.equal(compareVersions("1.20.0+build", "1.20.0"), 0);
  assert.equal(compareVersions("1.0.0-alpha", "1.0.0-alpha.1"), -1);
  assert.equal(compareVersions("0", "0.0.1"), -1);
  assert.equal(compareVersions("1.2.3", "*"), -1);
});

test("direct OSV evaluation follows the schema on authored boundaries", () => {
  const pin = { ecosystem: "npm", name: "left-pad", version: "1.0.1" };
  const fixed = decidePin({
    vulns: [{
      id: "GHSA-test-fixe-0001",
      affected: [{
        package: { ecosystem: "npm", name: "left-pad" },
        ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "1.0.2" }] }],
      }],
    }],
  }, pin);
  assert.equal(fixed.decision, "affected");
  const cleared = decidePin({
    vulns: [{
      id: "GHSA-test-fixe-0001",
      affected: [{
        package: { ecosystem: "npm", name: "left-pad" },
        ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "1.0.2" }] }],
      }],
    }],
  }, { ...pin, version: "1.0.2" });
  assert.equal(cleared.decision, "not_affected");

  const last = decidePin({
    id: "GHSA-test-last-0001",
    affected: [{
      package: { ecosystem: "npm", name: "left-pad" },
      ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { last_affected: "2.1.214" }] }],
    }],
  }, { ...pin, version: "2.1.214" });
  assert.equal(last.decision, "affected");
  const afterLast = decidePin({
    id: "GHSA-test-last-0001",
    affected: [{
      package: { ecosystem: "npm", name: "left-pad" },
      ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { last_affected: "2.1.214" }] }],
    }],
  }, { ...pin, version: "2.1.215" });
  assert.equal(afterLast.decision, "not_affected");

  const listed = decidePin({
    vulns: [{
      id: "GHSA-test-list-0001",
      affected: [{ package: { ecosystem: "npm", name: "left-pad" }, versions: ["1.0.1"], ranges: [] }],
    }],
  }, pin);
  assert.equal(listed.decision, "affected");

  const wildcard = decidePin({
    vulns: [{
      id: "GHSA-test-wild-0001",
      affected: [{
        package: { ecosystem: "npm", name: "*" },
        ranges: [{ type: "SEMVER", events: [{ introduced: "1.0.0" }, { fixed: "1.0.2" }] }],
      }],
    }],
  }, pin);
  assert.equal(wildcard.decision, "affected");

  const git = decidePin({
    vulns: [{
      id: "GHSA-test-gitx-0001",
      affected: [{
        package: { ecosystem: "npm", name: "left-pad" },
        ranges: [{ type: "GIT", events: [{ introduced: "abc" }, { limit: "def" }] }],
      }],
    }],
  }, pin);
  assert.equal(git.decision, "unknown");
  assert.equal(git.sufficient, false);

  const mixed = decidePin({
    vulns: [
      {
        id: "GHSA-test-gitx-0001",
        affected: [{
          package: { ecosystem: "npm", name: "left-pad" },
          ranges: [{ type: "GIT", events: [{ introduced: "abc" }] }],
        }],
      },
      {
        id: "GHSA-test-fixe-0001",
        affected: [{
          package: { ecosystem: "npm", name: "left-pad" },
          ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "9.0.0" }] }],
        }],
      },
    ],
  }, pin);
  assert.equal(mixed.decision, "affected");

  const limited = decidePin({
    vulns: [{
      id: "GHSA-test-limt-0001",
      affected: [{
        package: { ecosystem: "npm", name: "left-pad" },
        ranges: [{ type: "SEMVER", events: [{ introduced: "1.0.0" }, { fixed: "2.0.0" }, { limit: "1.5.0" }] }],
      }],
    }],
  }, pin);
  assert.equal(limited.decision, "affected");
  const pastLimit = decidePin({
    vulns: [{
      id: "GHSA-test-limt-0001",
      affected: [{
        package: { ecosystem: "npm", name: "left-pad" },
        ranges: [{ type: "SEMVER", events: [{ introduced: "1.0.0" }, { fixed: "2.0.0" }, { limit: "1.5.0" }] }],
      }],
    }],
  }, { ...pin, version: "1.6.0" });
  assert.equal(pastLimit.decision, "not_affected");

  const unknownOnly = decidePin({
    vulns: [{
      id: "GHSA-test-bad-00001",
      affected: [{
        package: { ecosystem: "npm", name: "left-pad" },
        ranges: [{ type: "SEMVER", events: [{ introduced: "1.0.0", fixed: "1.0.2" }] }],
      }],
    }],
  }, pin);
  assert.equal(unknownOnly.decision, "unknown");
  assert.equal(decidePin({}, pin).decision, "not_affected");
});

test("reader claims ignore a scope qualifier and keep an explicit pin clearance", () => {
  const qualifier = claimsFromText("Not affected: Browser adapters. Affected versions >= 1.13.0, < 1.20.0 Patched versions 1.20.0", PIN);
  assert.equal(qualifier.explicitPinClearance, false);
  assert.equal(qualifier.ranges[0].includesPin, true);
  const clearance = claimsFromText("Affected versions >= 1.13.0, < 1.19.0 axios 1.19.0 is not affected.", PIN);
  assert.equal(clearance.explicitPinClearance, true);
  assert.equal(clearance.ranges[0].includesPin, false);
});

test("pinned axios 1.19.0 and 1.20.0 OSV documents", () => {
  const affected = readJson(join(FIXTURE_ROOT, "osv-query-axios-1.19.0.json"));
  const clear = readJson(join(FIXTURE_ROOT, "osv-query-axios-1.20.0.json"));
  const atPin = decidePin(affected, PIN);
  assert.equal(atPin.decision, "affected");
  assert.equal(atPin.sufficient, true);
  assert.equal(atPin.affectingIds.length, 12);
  assert.ok(atPin.affectingIds.includes("GHSA-3pq3-5fj3-cg6v"));
  const atFixInSameDocument = decidePin(affected, { ...PIN, version: "1.20.0" });
  assert.equal(atFixInSameDocument.decision, "not_affected");
  assert.equal(atFixInSameDocument.affectingIds.length, 0);
  const prerelease = decidePin(affected, { ...PIN, version: "1.20.0-rc.1" });
  assert.equal(prerelease.decision, "affected");
  const beforeHistory = decidePin(affected, { ...PIN, version: "0.0.1" });
  assert.equal(beforeHistory.decision, "not_affected");
  const queriedFix = decidePin(clear, { ...PIN, version: "1.20.0" });
  assert.equal(queriedFix.decision, "not_affected");
  assert.equal(queriedFix.sufficient, true);
  assert.deepEqual(clear, {});
});

test("maintained outcome cycles and the direct-feed comparison", async () => {
  const scenarios = await runScenarios();
  assertScenarioContract(scenarios);
  assert.equal(scenarios.recommendation, INTEGRATION_RECOMMENDATION);
  assert.equal(scenarios.initial.report.effort.reads, 2);
  assert.equal(scenarios.initial.report.effort.monitorCompares, 0);
  assert.equal(scenarios.noChange.report.effort.monitorCompares, 1);
  assert.equal(scenarios.recovery.report.effort.recoveries, 1);
  assert.equal(scenarios.recovery.report.effort.readFailures, 1);
  assert.match(scenarios.initial.report.reader.evidence, />= 1\.13\.0, < 1\.20\.0/);
  assert.equal(scenarios.initial.report.reader.capture.javascriptExecuted, false);
  assert.equal(scenarios.initial.report.reader.capture.method, "http-get-no-javascript");
  assert.equal(scenarios.semanticFailure.report.reader.agreement.explicitPinClearance, true);
  assert.equal(scenarios.directOnly.acceptedState.batch, null);
  assert.equal(scenarios.initial.acceptedState.batch.body.charged, false);
  assert.equal(scenarios.initial.acceptedState.batch.body.sources[0].provenance.networkSent, false);
  assert.equal(scenarios.initial.acceptedState.batch.body.sources[0].provenance.httpStatus, 200);
  const afterDirect = await maintainCycle({
    pin: PIN,
    osvDocument: readJson(join(FIXTURE_ROOT, "osv-query-axios-1.19.0.json")),
    pageUrl: scenarios.pageUrl,
    pageHtml: readFileSync(join(FIXTURE_ROOT, "github-advisory-GHSA-3pq3-5fj3-cg6v.html")),
    previous: scenarios.directOnly.acceptedState,
  });
  assert.equal(afterDirect.report.cycle, "initial");
  assert.equal(afterDirect.report.decision, "affected");
  assert.ok(afterDirect.acceptedState.batch);
});

test("inventory verifies every required file and fixture hash", () => {
  const manifest = readJson(join(FIXTURE_ROOT, "manifest.json"));
  const listed = new Set();
  for (const entry of manifest.files) {
    const path = join(FIXTURE_ROOT, entry.path);
    assert.equal(sha256(path), entry.sha256, entry.path);
    assert.equal(statSync(path).size, entry.bytes, entry.path);
    listed.add(`fixtures/${entry.path}`);
  }
  for (const relative of REQUIRED_FILES) {
    const path = join(PACKAGE_ROOT, relative);
    const info = statSync(path);
    assert.ok(info.size > 0, relative);
    const inventory = readFileSync(join(PACKAGE_ROOT, "INVENTORY.md"), "utf8");
    assert.ok(inventory.includes(relative), `INVENTORY.md missing ${relative}`);
  }
  for (const requiredFixture of [
    "fixtures/osv-query-axios-1.19.0.json",
    "fixtures/osv-query-axios-1.20.0.json",
    "fixtures/github-advisory-GHSA-3pq3-5fj3-cg6v.html",
    "fixtures/laboratory/false-clear.html",
    "fixtures/laboratory/error-page-says-clear.html",
  ]) {
    assert.ok(listed.has(requiredFixture), requiredFixture);
  }
  const result = readFileSync(join(PACKAGE_ROOT, "RESULT.md"), "utf8");
  const research = readFileSync(join(PACKAGE_ROOT, "RESEARCH.md"), "utf8");
  assert.ok(result.includes(INTEGRATION_RECOMMENDATION));
  assert.ok(research.includes(INTEGRATION_RECOMMENDATION));
  assert.match(result, /grok-4\.7/);
  assert.match(result, /xhigh/);
  assert.match(result, /serial/);
  assert.equal(manifest.retrieval.axios1190.httpDate, "Thu, 29 Oct 2026 14:24:45 GMT");
  assert.equal(manifest.retrieval.githubAdvisory.httpDate, "Thu, 29 Oct 2026 14:25:01 GMT");
  assert.equal(manifest.retrieval.githubAdvisory.storedSetCookie, false);
});
