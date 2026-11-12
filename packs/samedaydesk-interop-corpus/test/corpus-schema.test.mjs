import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  OUTCOME_CLASSES,
  caseProblems,
  loadCorpus,
  loadPin,
  loadResiduals,
  loadSkipped,
  validateCase,
} from "../src/index.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHA = /^[0-9a-f]{40}$/;
// Built from parts so this file does not match itself.
const INTERNAL_BRAND = new RegExp(["\\b", "Pi", "lot", "\\b"].join(""));
const CERTIFIED = new RegExp(["\\b", "certi", "fied", "\\b"].join(""), "i");

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules") return [];
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

test("positive: every corpus case validates and preserves author, publication, provenance, versions, and earlier negative", () => {
  const cases = loadCorpus();
  assert.deepEqual(cases.map((entry) => entry.id), ["CK-N12-001", "CK-N12-002", "CK-N12-003", "CK-N12-004"]);
  for (const entry of cases) {
    assert.deepEqual(caseProblems(entry), [], entry.id);
    assert.ok(entry.author.name.length > 0);
    assert.ok(["public-repo-merged", "public-repo-draft-pr"].includes(entry.publication.allowed), entry.id);
    assert.ok(entry.fixtureProvenance.length > 0);
    for (const ref of entry.fixtureProvenance.filter((item) => item.repo)) {
      assert.match(ref.commit, SHA);
      assert.match(ref.gitBlobSha, SHA);
    }
    assert.match(entry.earlierNegative.commit, SHA);
    assert.match(entry.sourceVersions.merchantCommit, SHA);
    assert.ok(OUTCOME_CLASSES.includes(entry.outcomeClass.earlierNegative));
    assert.equal(entry.outcomeClass.changedImplementation, "successful");
    assert.equal(entry.consumer, "samedaydesk-capability-compat-consumer");
  }
});

test("positive: the first case is the unknown-tool prefix failure with its recorded negative and fix", () => {
  const [first] = loadCorpus();
  assert.equal(first.id, "CK-N12-001");
  assert.equal(first.author.name, "Compatibility Knowledge Nov12");
  assert.equal(first.earlierNegative.commit, "b38dc14b6212bbe3fda5e23a8552101e414f22d7");
  assert.equal(first.earlierNegative.result, "4/6 pass");
  assert.equal(first.fix.commit, "24556fe277a0369897917d86e8fb92388e30edcf");
  assert.equal(first.earlierNegative.signature.message, "MCP error -32602: Unknown tool");
  const recorded = JSON.parse(readFileSync(join(root, "fixtures/negatives/CK-N12-001-vm1-b38dc14b.json"), "utf8"));
  assert.equal(recorded.caseId, first.id);
  assert.equal(recorded.commit, first.earlierNegative.commit);
  assert.deepEqual(recorded.tap, { tests: 6, pass: 4, fail: 2 });
  assert.equal(recorded.failing.every((item) => item.error === first.earlierNegative.signature.recordedMapperError), true);
});

test("failure: removing any preserved field makes the case invalid", () => {
  const [first] = loadCorpus();
  const required = ["author", "publication", "fixtureProvenance", "sourceVersions", "earlierNegative", "recovery", "outcomeClass", "replay", "consumer"];
  for (const field of required) {
    const copy = structuredClone(first);
    delete copy[field];
    assert.ok(caseProblems(copy).length > 0, field);
    assert.throws(() => validateCase(copy), { code: "corpus_case_invalid" });
  }
  const noBlob = structuredClone(first);
  delete noBlob.fixtureProvenance[0].gitBlobSha;
  assert.ok(caseProblems(noBlob).some((problem) => problem.includes("fixtureProvenance[0]")));
  const badClass = structuredClone(first);
  badClass.outcomeClass.earlierNegative = "flaky";
  assert.ok(caseProblems(badClass).some((problem) => problem.includes("outcomeClass.earlierNegative")));
  const badPublication = structuredClone(first);
  badPublication.publication.allowed = "anywhere";
  assert.ok(caseProblems(badPublication).some((problem) => problem.includes("publication.allowed")));
});

test("residuals name a consumer and a test; skipped candidates carry a reason", () => {
  const { residuals } = loadResiduals();
  assert.deepEqual(residuals.map((item) => item.id), ["R-01", "R-02", "R-03"]);
  for (const item of residuals) {
    assert.equal(item.consumer, "samedaydesk-capability-compat-consumer");
    assert.match(item.test, /interop-corpus\.test\.mjs$/);
    assert.ok(item.whyNotRunner.length > 0);
  }
  const { skipped } = loadSkipped();
  assert.ok(skipped.length >= 1);
  assert.equal(skipped.every((item) => item.reason.length > 0), true);
});

test("pin records the official runner and both wire versions without a live migration", () => {
  const pin = loadPin();
  assert.equal(pin.officialRunner.package, "@modelcontextprotocol/conformance");
  assert.equal(pin.officialRunner.version, "0.2.0-alpha.12");
  assert.match(pin.officialRunner.gitHead, SHA);
  assert.deepEqual(Object.keys(pin.officialRunner.requirementSets), ["2025-11-25", "2026-07-28"]);
  assert.equal(pin.merchant.servedProtocol, "2025-11-25");
  assert.equal(pin.merchant.refusedProtocol, "2026-07-28");
  assert.equal(pin.liveServiceMigration, false);
  assert.equal(pin.scope, "baseline-relative");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(pkg.devDependencies["@modelcontextprotocol/conformance"], pin.officialRunner.version);
  assert.equal(pkg.private, true);
});

test("package text uses the SameDayDesk brand, no em dashes, no certification claim", () => {
  const files = walk(root).filter((path) => /\.(mjs|json|md|sh)$/.test(path));
  for (const path of files) {
    const text = readFileSync(path, "utf8");
    const name = relative(root, path);
    assert.equal(text.includes("\u2014"), false, `em dash in ${name}`);
    assert.equal(INTERNAL_BRAND.test(text), false, `internal brand in ${name}`);
    assert.equal(CERTIFIED.test(text), false, `certification wording in ${name}`);
  }
});
