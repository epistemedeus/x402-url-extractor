import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { parseMapping } from "../src/record/mapping.mjs";
import { projectRecords } from "../src/record/project.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const example = (parts) => join(root, "..", "fixtures", "record", ...parts);

function load(parts) {
  return JSON.parse(readFileSync(example(parts), "utf8"));
}

function project(exampleDir) {
  const mapping = parseMapping(load([exampleDir, "mapping.json"]));
  const schema = load([exampleDir, "schema.json"]);
  const inputName = exampleDir === "product-jsonld"
    ? ["product-jsonld", "delivery", "extract-batch.json"]
    : ["org-contact", "delivery", "extract.json"];
  const text = readFileSync(example(inputName), "utf8");
  return projectRecords({
    document: JSON.parse(text),
    mapping,
    schema,
    artifactName: mapping.artifact,
    inputText: text,
  });
}

test("product JSON-LD example emits one complete record and one partial missing sku", () => {
  const result = project("product-jsonld");
  assert.equal(result.status, "partial");
  assert.equal(result.ok, false);
  assert.equal(result.accounting.sourceRows, 3);
  assert.equal(result.accounting.sourceRowsIncluded, 2);
  assert.equal(result.accounting.sourceRowsSkippedStatus, 1);
  assert.equal(result.accounting.itemCandidates, 2);
  assert.equal(result.records.length, 1);
  assert.equal(result.partialRecords.length, 1);
  assert.equal(result.records[0].fields.name, "Alpha");
  assert.equal(result.records[0].fields.sku, "A-1");
  assert.equal(result.records[0].provenance.fields.sku.pointer, "/sources/0/data/jsonLd/0/sku");
  assert.equal(result.partialRecords[0].fields.name, "Beta");
  assert.equal(Object.prototype.hasOwnProperty.call(result.partialRecords[0].fields, "sku"), false);
  assert.equal(result.partialRecords[0].fields.sku, undefined);
  assert.ok(result.missingPaths.some((item) => item.pointer === "/sources/1/data/jsonLd/0/sku"));
  assert.equal(result.llmUsed, false);
  assert.equal(result.networkUsed, false);
  assert.match(result.disclaimer, /Not proof of legal existence/);
});

test("organization contact example is partial because email is absent, not null", () => {
  const result = project("org-contact");
  assert.equal(result.status, "partial");
  assert.equal(result.partialRecords.length, 1);
  assert.equal(result.records.length, 0);
  const record = result.partialRecords[0];
  assert.equal(record.fields.name, "Example Organization");
  assert.equal(record.fields.telephone, "+1-555-0100");
  assert.equal(record.fields.streetAddress, "1 Example Way");
  assert.equal(Object.hasOwn(record.fields, "email"), false);
  assert.ok(result.missingPaths.some((item) => item.field === "email"));
});

test("missing optional field stays omitted unless buyer sets onMissing null", () => {
  const mapping = parseMapping(load(["org-contact", "mapping.json"]));
  mapping.fields.find((field) => field.name === "email").onMissing = "null";
  const text = readFileSync(example(["org-contact", "delivery", "extract.json"]), "utf8");
  const schema = load(["org-contact", "schema.json"]);
  schema.properties.email.type = ["string", "null"];
  const result = projectRecords({
    document: JSON.parse(text),
    mapping,
    schema,
    artifactName: "extract.json",
    inputText: text,
  });
  assert.equal(result.partialRecords[0].fields.email, null);
  assert.equal(result.partialRecords[0].provenance.fields.email.missing, "null");
});

test("source row cardinality is preserved and failure rows are not turned into records", () => {
  const result = project("product-jsonld");
  assert.equal(result.accounting.sourceRows, 3);
  assert.equal(
    result.accounting.recordsSuccess + result.accounting.recordsPartial + result.accounting.recordsInvalid,
    result.accounting.itemCandidates,
  );
});
