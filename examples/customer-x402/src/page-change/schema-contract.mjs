import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALL_FIELDS,
  MERCHANT_FILES,
  MERCHANT_PRODUCT,
  MERCHANT_SCHEMA_VERSION,
  ROW_STATUSES,
} from "./constants.mjs";
import { merchantRoot } from "./provenance.mjs";
import { assertExtractBatchSellerShape } from "../batch-output.mjs";
import { isPlainObject } from "./util.mjs";

export function merchantSourceText(root = merchantRoot()) {
  return {
    extractBatch: readFileSync(join(root, MERCHANT_FILES[0]), "utf8"),
    config: readFileSync(join(root, MERCHANT_FILES[1]), "utf8"),
  };
}

export function assertMerchantSourceContract(root = merchantRoot()) {
  const { extractBatch, config } = merchantSourceText(root);
  const facts = [];
  if (!config.includes(`EXTRACT_BATCH_PRODUCT = "${MERCHANT_PRODUCT}"`)) {
    throw new Error("pinned merchant config product mismatch");
  }
  if (!config.includes(`EXTRACT_BATCH_SCHEMA_VERSION = "${MERCHANT_SCHEMA_VERSION}"`)) {
    throw new Error("pinned merchant config schema version mismatch");
  }
  if (!extractBatch.includes("export function extractBatchOutputSchema")) {
    throw new Error("pinned merchant missing extractBatchOutputSchema");
  }
  for (const status of ROW_STATUSES) {
    if (!extractBatch.includes(`"${status}"`)) {
      throw new Error(`pinned merchant source status missing ${status}`);
    }
  }
  const extractFields = readFileSync(join(root, "extract-batch-c1", "extract.mjs"), "utf8");
  for (const field of ALL_FIELDS) {
    if (!extractFields.includes(`"${field}"`)) {
      throw new Error(`pinned merchant field list missing ${field}`);
    }
  }
  facts.push("product", "schemaVersion", "outputSchema", "rowStatuses", "fields");
  return { facts, bytes: Buffer.byteLength(extractBatch, "utf8") };
}

export function inspectMerchantArtifact(body) {
  if (!isPlainObject(body)) return { ok: false, errors: ["not_an_object"] };
  try {
    assertExtractBatchSellerShape(body);
    return { ok: true, errors: [] };
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }
}
