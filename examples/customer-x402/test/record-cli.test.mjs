import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { parseMapping } from "../src/record/mapping.mjs";
import { projectRecords } from "../src/record/project.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const bin = join(root, "bin/record.mjs");

function outDir() {
  return mkdtempSync(join(tmpdir(), "record-cli-"));
}

function runCli(args) {
  return spawnSync(process.execPath, [bin, ...args], {
    encoding: "utf8",
    cwd: root,
  });
}

test("product example CLI writes records, report, and missing-path map", () => {
  const out = outDir();
  const result = runCli([
    "--input", "fixtures/record/product-jsonld/delivery/extract-batch.json",
    "--mapping", "fixtures/record/product-jsonld/mapping.json",
    "--schema", "fixtures/record/product-jsonld/schema.json",
    "--out", out,
  ]);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "partial");
  assert.equal(report.records.length, 1);
  const written = JSON.parse(readFileSync(join(out, "records.json"), "utf8"));
  assert.equal(written.length, 2);
  assert.equal(written.filter((item) => item.status === "success").length, 1);
  assert.equal(written.filter((item) => item.status === "partial").length, 1);
  const missing = JSON.parse(readFileSync(join(out, "missing-paths.json"), "utf8"));
  assert.ok(missing.byPointer["/sources/1/data/jsonLd/0/sku"]);
  assert.equal(report.networkUsed, false);
});

test("org example CLI exits 1 for honest partial, not all-valid", () => {
  const out = outDir();
  const result = runCli([
    "--input", "fixtures/record/org-contact/delivery/extract.json",
    "--mapping", "fixtures/record/org-contact/mapping.json",
    "--schema", "fixtures/record/org-contact/schema.json",
    "--out", out,
  ]);
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.status, "partial");
  assert.equal(JSON.parse(readFileSync(join(out, "records.json"), "utf8")).length, 1);
});

test("required SKU example preserves a usable record and the invalid record", () => {
  const out = outDir();
  const result = runCli([
    "--input", "fixtures/record/product-jsonld/delivery/extract-batch.json",
    "--mapping", "fixtures/record/required-sku/mapping.json",
    "--schema", "fixtures/record/required-sku/schema.json",
    "--out", out,
  ]);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "partial");
  assert.equal(report.records.length, 1);
  assert.equal(report.invalidRecords.length, 1);
  assert.deepEqual(report.invalidRecords[0].missing.required, [{
    field: "sku",
    pointer: "/sources/1/data/jsonLd/0/sku",
    reason: "missing",
  }]);
  assert.equal(JSON.parse(readFileSync(join(out, "records.json"), "utf8")).length, 1);
  const missing = JSON.parse(readFileSync(join(out, "missing-paths.json"), "utf8"));
  assert.equal(missing.byPointer["/sources/1/data/jsonLd/0/sku"].reason, "missing");
});

test("CLI usage is flag-closed", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 2);
  const report = JSON.parse(result.stdout);
  assert.equal(report.issues[0].code, "cli.usage");
});

test("nonempty output directory is rejected", () => {
  const out = outDir();
  writeFileSync(join(out, "stale.json"), "{}");
  const result = runCli([
    "--input", "fixtures/record/org-contact/delivery/extract.json",
    "--mapping", "fixtures/record/org-contact/mapping.json",
    "--schema", "fixtures/record/org-contact/schema.json",
    "--out", out,
  ]);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /fresh or empty/);
});

test("library projection matches CLI accounting for the product fixture", () => {
  const mapping = parseMapping(JSON.parse(readFileSync(join(root, "fixtures/record/product-jsonld/mapping.json"), "utf8")));
  const text = readFileSync(join(root, "fixtures/record/product-jsonld/delivery/extract-batch.json"), "utf8");
  const result = projectRecords({
    document: JSON.parse(text),
    mapping,
    schema: JSON.parse(readFileSync(join(root, "fixtures/record/product-jsonld/schema.json"), "utf8")),
    artifactName: mapping.artifact,
    inputText: text,
  });
  const out = outDir();
  const cli = runCli([
    "--input", "fixtures/record/product-jsonld/delivery/extract-batch.json",
    "--mapping", "fixtures/record/product-jsonld/mapping.json",
    "--schema", "fixtures/record/product-jsonld/schema.json",
    "--out", out,
  ]);
  const stdout = JSON.parse(cli.stdout);
  assert.equal(stdout.accounting.recordsSuccess, result.accounting.recordsSuccess);
  assert.equal(stdout.accounting.sourceRows, result.accounting.sourceRows);
});

test("malformed input is rejected before any output files are written", () => {
  const out = outDir();
  const result = runCli([
    "--input", "fixtures/record/hostile/malformed.json",
    "--mapping", "fixtures/record/product-jsonld/mapping.json",
    "--schema", "fixtures/record/product-jsonld/schema.json",
    "--out", out,
  ]);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /not JSON|malformed/i);
  assert.deepEqual(readdirSync(out), []);
});
