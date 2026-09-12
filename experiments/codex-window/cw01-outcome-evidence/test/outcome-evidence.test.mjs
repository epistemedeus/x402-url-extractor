import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  EvidenceError,
  compilePortableEvidence,
  joinOutcomeEvidence,
  readBoundedJson,
  readRunDirectory,
  validateFeedback,
} from "../src/index.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SAMPLE = join(ROOT, "fixtures/sample");
const CATALOG = readBoundedJson(join(ROOT, "fixtures/published-examples.json"));
const read = name => readBoundedJson(join(SAMPLE, name));
const raw = () => ({
  receipt: read("receipt.json"), authorization: read("authorization.json"),
  purchase: read("purchase-result.json"), reconcile: read("reconcile.json"),
  feedback: read("feedback.json"), catalog: CATALOG,
});

test("positive join reuses current receipt and response validators without merging claim dimensions", () => {
  const joined = joinOutcomeEvidence(raw());
  assert.equal(joined.receiptConsistency, "consistent");
  assert.equal(joined.serverContract.validated, true);
  assert.equal(joined.serverContract.validator, "customer-x402.validateBatchBuyerOutput");
  assert.equal(joined.buyerAttestation.usefulness, "useful");
  assert.equal(joined.buyerAttestation.returnAttribution, "unattributed");
  assert.equal(joined.exampleReuse.reused, true);
  assert.equal(joined.settlement.exactMatched, true);
  assert.equal(joined.eligibleEvidence, true);
});

test("duplicate exact settlement is retained but only counted once", () => {
  const one = joinOutcomeEvidence(raw());
  const two = joinOutcomeEvidence(raw());
  const output = compilePortableEvidence([one, two], { generatedAt: "2026-09-12T02:00:00Z" });
  assert.equal(output.summary.total, 2);
  assert.equal(output.summary.eligible, 1);
  assert.equal(output.summary.duplicateSettlement, 1);
  assert.equal(output.records[1].duplicateSettlement, true);
  assert.equal(JSON.stringify(output).includes('"payer"'), false);
  assert.equal(JSON.stringify(output).includes('"nonce"'), false);
});

test("hostile request binding is classified as conflicting receipt", () => {
  const input = raw();
  input.purchase.evidence.bodyDigest = `sha256:${"ff".repeat(32)}`;
  const joined = joinOutcomeEvidence(input);
  assert.equal(joined.receiptConsistency, "conflicting_receipt");
  assert.ok(joined.conflicts.includes("purchase.evidence.bodyDigest"));
  assert.equal(joined.eligibleEvidence, false);
});

test("pre-send or unsent artifacts cannot become eligible post-run evidence", () => {
  const input = raw();
  input.receipt.stage = "ready_before_send";
  input.purchase.paymentSent = false;
  const joined = joinOutcomeEvidence(input);
  assert.equal(joined.receiptConsistency, "conflicting_receipt");
  assert.ok(joined.conflicts.includes("receipt.stage"));
  assert.ok(joined.conflicts.includes("purchase.paymentSent"));
  assert.equal(joined.eligibleEvidence, false);
});

test("conflicting HTTP and canonical transaction references are not exported as settlement", () => {
  const input = raw();
  input.purchase.evidence.settlementTransaction = `0x${"ef".repeat(32)}`;
  const joined = joinOutcomeEvidence(input);
  assert.equal(joined.settlement.status, "conflicting_receipt");
  assert.equal(joined.settlement.transactionHash, null);
  assert.equal(joined.eligibleEvidence, false);
});

test("hostile output cannot borrow a useful outcome string", () => {
  const input = raw();
  input.purchase.evidence.retainedBody.sources[0].source = "https://attacker.example/";
  const joined = joinOutcomeEvidence(input);
  assert.equal(joined.serverContract.validated, false);
  assert.match(joined.serverContract.reason, /conflicts|submitted URL/);
  assert.equal(joined.eligibleEvidence, false);
});

test("buyer feedback is explicit and inferred business claims are refused", () => {
  assert.throws(() => validateFeedback({ ...raw().feedback, usefulness: "profitable" }), EvidenceError);
  const dir = mkdtempSync(join(tmpdir(), "cw01-hostile-"));
  const path = join(dir, "claims.json");
  writeFileSync(path, JSON.stringify({ revenue: 42 }));
  assert.throws(() => readBoundedJson(path), error => error.code === "unsupported_claim");
});

test("missing reconcile stays unverified rather than becoming settlement proof", () => {
  const input = raw();
  input.reconcile = null;
  const joined = joinOutcomeEvidence(input);
  assert.equal(joined.settlement.status, "unverified");
  assert.equal(joined.settlement.exactMatched, false);
  assert.equal(joined.eligibleEvidence, false);
});

test("CLI emits the redacted portable schema and supports an exclusive output file", () => {
  const direct = spawnSync(process.execPath, [join(ROOT, "bin/cli.mjs"), "--run", SAMPLE, "--catalog", join(ROOT, "fixtures/published-examples.json")], { encoding: "utf8" });
  assert.equal(direct.status, 0, direct.stderr);
  const parsed = JSON.parse(direct.stdout);
  assert.equal(parsed.schema, "samedaydesk.outcome-evidence-export.v1");
  assert.equal(parsed.summary.eligible, 1);
  assert.equal(direct.stdout.includes('"payer"'), false);
  assert.equal(direct.stdout.includes('"nonce"'), false);

  const dir = mkdtempSync(join(tmpdir(), "cw01-cli-"));
  const output = join(dir, "evidence.json");
  const written = spawnSync(process.execPath, [join(ROOT, "bin/cli.mjs"), "--run", SAMPLE, "--catalog", join(ROOT, "fixtures/published-examples.json"), "--output", output], { encoding: "utf8" });
  assert.equal(written.status, 0, written.stderr);
  assert.equal(JSON.parse(readFileSync(output)).summary.eligible, 1);
  const overwrite = spawnSync(process.execPath, [join(ROOT, "bin/cli.mjs"), "--run", SAMPLE, "--output", output], { encoding: "utf8" });
  assert.equal(overwrite.status, 2);
});

test("actual directory reader consumes the synthetic labeled sample", () => {
  const joined = readRunDirectory(SAMPLE, { catalog: CATALOG });
  assert.equal(joined.sourceLabel, "sample");
  assert.match(joined.buyerAttestation.statement, /Synthetic example/);
  const expected = JSON.parse(readFileSync(join(ROOT, "results/synthetic-portable-evidence.json"), "utf8"));
  const actual = compilePortableEvidence([joined], { generatedAt: expected.generatedAt });
  assert.deepEqual(actual, expected);
});
