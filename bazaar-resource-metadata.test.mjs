import assert from "node:assert/strict";
import test from "node:test";

import {
  BAZAAR_RESOURCE_METADATA,
  bazaarResourceMetadataFor,
  validateBazaarResourceMetadata,
} from "./bazaar-resource-metadata.mjs";

test("declares one valid provider identity and route-specific tags for all paid routes", () => {
  const validation = validateBazaarResourceMetadata();
  assert.deepEqual(validation, { valid: true, errors: [] });
  assert.equal(Object.keys(BAZAAR_RESOURCE_METADATA).length, 13);
  assert.deepEqual(new Set(Object.values(BAZAAR_RESOURCE_METADATA).map((entry) => entry.serviceName)), new Set(["SameDayDesk"]));
  assert.deepEqual(bazaarResourceMetadataFor("/extract"), {
    serviceName: "SameDayDesk",
    tags: ["web", "url-extraction", "clean-text", "structured-data", "json-ld"],
  });
  assert.throws(() => bazaarResourceMetadataFor("/missing"), /Missing Bazaar resource metadata/);
});

test("rejects unsafe, oversized, duplicated, or incomplete resource metadata", () => {
  const validation = validateBazaarResourceMetadata({
    "bad?route": { serviceName: "Same\nName", tags: ["tag", "TAG"] },
    "/too-many": { serviceName: "x".repeat(33), tags: ["1", "2", "3", "4", "5", "6"] },
    "/missing": { serviceName: "Valid", tags: [] },
  });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes("invalid route")));
  assert.ok(validation.errors.some((error) => error.includes("invalid serviceName")));
  assert.ok(validation.errors.some((error) => error.includes("duplicate tag")));
  assert.ok(validation.errors.some((error) => error.includes("invalid tag count")));
});
