import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

import { parseMapping } from "../src/record/mapping.mjs";
import { projectRecords } from "../src/record/project.mjs";
import {
  MERCHANT_BATCH_AMOUNT_ATOMIC,
  MERCHANT_BATCH_PRODUCT,
  MERCHANT_BATCH_SCHEMA_VERSION,
} from "../src/record/constants.mjs";

const root = dirname(fileURLToPath(import.meta.url));

test("product fixture matches public extract_batch seller field names", () => {
  const body = JSON.parse(readFileSync(join(root, "../fixtures/record/product-jsonld/delivery/extract-batch.json"), "utf8"));
  assert.equal(body.product, MERCHANT_BATCH_PRODUCT);
  assert.equal(body.schemaVersion, MERCHANT_BATCH_SCHEMA_VERSION);
  assert.equal(body.quote.amountAtomic, MERCHANT_BATCH_AMOUNT_ATOMIC);
  assert.equal(body.sources.length, 3);
  assert.deepEqual(
    Object.keys(body.sources[0]).sort(),
    ["data", "error", "finalUrl", "httpStatus", "id", "notes", "provenance", "source", "status"].sort(),
  );
  for (const [index, row] of body.sources.entries()) {
    assert.equal(row.id, `item-${String(index + 1).padStart(3, "0")}`);
  }
  const mapping = parseMapping(JSON.parse(readFileSync(join(root, "../fixtures/record/product-jsonld/mapping.json"), "utf8")));
  const result = projectRecords({
    document: body,
    mapping,
    schema: JSON.parse(readFileSync(join(root, "../fixtures/record/product-jsonld/schema.json"), "utf8")),
    artifactName: mapping.artifact,
    inputText: JSON.stringify(body),
  });
  assert.equal(result.merchantCompat.ok, true);
  assert.equal(result.kind, "extract_batch");
  const success = body.sources.filter((row) => row.status === "success");
  for (const row of success) {
    assert.ok(Object.hasOwn(row.data, "jsonLd"));
  }
});

test("extract fixture matches public single-URL extract keys used by the customer validator", () => {
  const body = JSON.parse(readFileSync(join(root, "../fixtures/record/org-contact/delivery/extract.json"), "utf8"));
  for (const key of ["ok", "url", "title", "text", "fetchedAt", "jsonLd", "aiReadiness"]) {
    assert.ok(Object.hasOwn(body, key), key);
  }
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.jsonLd));
  const mapping = parseMapping(JSON.parse(readFileSync(join(root, "../fixtures/record/org-contact/mapping.json"), "utf8")));
  const result = projectRecords({
    document: body,
    mapping,
    schema: JSON.parse(readFileSync(join(root, "../fixtures/record/org-contact/schema.json"), "utf8")),
    artifactName: mapping.artifact,
    inputText: JSON.stringify(body),
  });
  assert.equal(result.kind, "extract");
  assert.equal(result.merchantCompat.ok, true);
  assert.equal(result.accounting.requestedFieldsMissing, 0);
});

test("success vs partial vs failure source statuses stay distinct", () => {
  const body = JSON.parse(readFileSync(join(root, "../fixtures/record/product-jsonld/delivery/extract-batch.json"), "utf8"));
  assert.deepEqual(body.sources.map((row) => row.status), ["success", "success", "failure"]);
  const mapping = parseMapping(JSON.parse(readFileSync(join(root, "../fixtures/record/product-jsonld/mapping.json"), "utf8")));
  const result = projectRecords({
    document: body,
    mapping,
    schema: JSON.parse(readFileSync(join(root, "../fixtures/record/product-jsonld/schema.json"), "utf8")),
    artifactName: mapping.artifact,
    inputText: JSON.stringify(body),
  });
  assert.equal(result.records[0].status, "success");
  assert.equal(result.partialRecords[0].status, "partial");
  assert.equal(result.accounting.sourceRowsSkippedStatus, 1);
});
