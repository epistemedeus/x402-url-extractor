import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { executeExtractBatch, extractBatchOutputSchema, normalizeExtractBatchInput } from "./extract-batch.mjs";
import { parseMapping } from "./examples/customer-x402/src/record/mapping.mjs";
import { projectRecords } from "./examples/customer-x402/src/record/project.mjs";

const root = dirname(fileURLToPath(import.meta.url));

test("injected HTML batch deliveries compose with the public record recipe", async () => {
  const schema = JSON.parse(readFileSync(join(root, "examples/customer-x402/src/record/merchant-batch-schema.json"), "utf8"));
  assert.deepEqual(schema, extractBatchOutputSchema());
  const scratch = mkdtempSync(join(tmpdir(), "extract-batch-record-"));
  try {
    const input = normalizeExtractBatchInput({
      urls: ["https://merchant-fixture.example/one", "https://merchant-fixture.example/two"],
      fields: ["jsonLd", "title"],
    });
    let calls = 0;
    const body = await executeExtractBatch({
      input,
      rawBody: Buffer.from(JSON.stringify(input)),
      headers: {},
      dataDir: scratch,
      fetchImpl: async (url) => {
        calls += 1;
        const jsonLd = String(url).endsWith("one")
          ? '{"@type":"Product","name":"Alpha","sku":"A-1"}'
          : "{broken";
        return new Response(
          `<html><head><title>Fixture</title><script type="application/ld+json">${jsonLd}</script></head></html>`,
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
    assert.equal(result.networkUsed, false);
    assert.equal(result.llmUsed, false);
    assert.match(result.disclaimer, /Not proof of legal existence/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
