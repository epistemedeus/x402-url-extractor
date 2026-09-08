import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Writable } from "node:stream";
import test from "node:test";
import { main } from "../src/page-change/cli.mjs";
import { C1_COMMIT, C2_COMMIT, MERCHANT_COMMIT } from "../src/page-change/constants.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const repo = join(root, "..");

async function run(argv) {
  let stdout = "";
  let stderr = "";
  const io = {
    stdout: new Writable({ write(chunk, _enc, cb) { stdout += String(chunk); cb(); } }),
    stderr: new Writable({ write(chunk, _enc, cb) { stderr += String(chunk); cb(); } }),
  };
  const code = await main(argv, io);
  return { code, stdout, stderr };
}

test("CLI compare prints the customer-job JSON report", async () => {
  const result = await run([
    "compare",
    "--before", join(repo, "fixtures/page-change/customer-job/before.json"),
    "--after", join(repo, "fixtures/page-change/customer-job/after.json"),
    "--fields", "title,description,headings",
    "--clock", "2026-09-08T12:00:00.000Z",
    "--max-stale-ms", "86400000",
  ]);
  assert.equal(result.code, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schema, "pilot/page-change-brief/v1");
  assert.equal(report.verdict, "changed");
  assert.equal(report.kind, "merchant_extract_batch");
  assert.equal(report.claims.fresh, false);
  assert.equal(report.claims.paymentImpliesUsefulOutput, false);
});

test("CLI job wraps the customer example", async () => {
  const result = await run(["job", "--job", join(repo, "fixtures/page-change/customer-job/job.json")]);
  assert.equal(result.code, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.job.id, "rfq-and-vendor-page-watch");
  assert.equal(payload.report.verdict, "changed");
  assert.equal(payload.report.provenance.c2.commit, C2_COMMIT);
  assert.equal(payload.report.provenance.c1.commit, C1_COMMIT);
  assert.equal(payload.report.provenance.merchant.commit, MERCHANT_COMMIT);
  assert.equal(payload.report.provenance.c2.acceptance, "reviewed_source_vendored");
  assert.equal(payload.report.provenance.c1.acceptance, "in_repo_public_identity_helper");
});

test("CLI text format names the changed source", async () => {
  const result = await run([
    "compare",
    "--before", join(repo, "fixtures/page-change/customer-job/before.json"),
    "--after", join(repo, "fixtures/page-change/customer-job/after.json"),
    "--fields", "title,description",
    "--format", "text",
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /verdict: changed/);
  assert.match(result.stdout, /rfq\.example\/widgets/);
  assert.match(result.stdout, /paymentImpliesUsefulOutput: false/);
});

test("CLI rejects unknown options and missing fields", async () => {
  const unknown = await run([
    "compare",
    "--before", join(repo, "fixtures/page-change/customer-job/before.json"),
    "--after", join(repo, "fixtures/page-change/customer-job/after.json"),
    "--field", "title",
  ]);
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /unknown option --field/);
  const missing = await run([
    "compare",
    "--before", join(repo, "fixtures/page-change/customer-job/before.json"),
    "--after", join(repo, "fixtures/page-change/customer-job/after.json"),
  ]);
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /requires --fields/);
});

test("CLI rejects compare without paths", async () => {
  const result = await run(["compare", "--fields", "title"]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /before and --after/);
});
