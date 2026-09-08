import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { parseMapping } from "../src/record/mapping.mjs";
import { projectRecords } from "../src/record/project.mjs";

const testDir = dirname(fileURLToPath(import.meta.url));
const customerRoot = join(testDir, "..");
const merchantRoot = join(customerRoot, "..", "..");
const merchantModule = join(merchantRoot, "extract-batch.mjs");
const merchantDepsPresent = existsSync(join(merchantRoot, "node_modules", "express"))
  || existsSync(join(merchantRoot, "node_modules", "@x402", "express"));
const requireOwning = process.env.RECORD_REQUIRE_MERCHANT === "1";
const skipConvenience = !merchantDepsPresent && !requireOwning;

test("exact public merchant schema and injected real partial runtime compose", {
  skip: skipConvenience
    ? "convenience: parent merchant runtime deps are not installed; this is not owning-runtime acceptance"
    : false,
}, async () => {
  assert.equal(existsSync(merchantModule), true, "merchant extract-batch.mjs missing from public checkout");
  // Exercise the owning checkout itself, including public source archives with
  // no Git history. Schema equality and injected delivery are the live boundary.
  const merchant = await import(pathToFileURL(merchantModule).href);
  const { executeExtractBatch, normalizeExtractBatchInput, extractBatchOutputSchema } = merchant;
  const schema = JSON.parse(readFileSync(new URL("../src/record/merchant-batch-schema.json", import.meta.url)));
  assert.deepEqual(schema, extractBatchOutputSchema());
  const input = normalizeExtractBatchInput({
    urls: ["https://example.com/one", "https://example.com/two"],
    fields: ["jsonLd", "title"],
  });
  const dataDir = mkdtempSync(join(tmpdir(), "record-runtime-"));
  let calls = 0;
  try {
    const body = await executeExtractBatch({
      input,
      rawBody: Buffer.from(JSON.stringify(input)),
      headers: {},
      dataDir,
      fetchImpl: async (url) => {
        calls += 1;
        return new Response(
          `<html><head><title>Fixture</title><script type="application/ld+json">${url.endsWith("one") ? '{"@type":"Product","name":"Alpha","sku":"A-1"}' : "{broken"}</script></head></html>`,
          { headers: { "content-type": "text/html" } },
        );
      },
    });
    assert.equal(calls, 2);
    assert.deepEqual(body.sources.map((row) => row.status), ["success", "partial"]);
    const mapping = parseMapping({
      schemaVersion: "pilot.c29.buyer-record-projection.mapping.v1",
      kind: "extract_batch",
      itemPointer: "/data/jsonLd",
      fields: { name: { from: "/name", required: true } },
    });
    const result = projectRecords({
      document: body,
      mapping,
      schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
      artifactName: "actual.json",
      inputText: JSON.stringify(body),
    });
    assert.equal(result.merchantCompat.ok, true, JSON.stringify(result.issues));
    assert.equal(result.status, "partial");
    assert.equal(result.records[0].fields.name, "Alpha");
    assert.equal(result.records[0].provenance.fields.name.pointer, "/sources/0/data/jsonLd/0/name");
    body.charged = "not-a-boolean";
    const invalid = projectRecords({
      document: body,
      mapping,
      schema: {},
      artifactName: "invalid.json",
      inputText: JSON.stringify(body),
    });
    assert.equal(invalid.merchantCompat.ok, false);
    assert.notEqual(invalid.status, "success");
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
