import assert from "node:assert/strict";
import test from "node:test";

import { validateOpenApiOperationIds } from "./openapi-operation-contract.mjs";

test("accepts unique stable operation IDs", () => {
  assert.deepEqual(validateOpenApiOperationIds({ paths: {
    "/one": { get: { operationId: "getOne" } },
    "/two": { post: { operationId: "createTwo" } },
  } }), { operationCount: 2, uniqueOperationIds: 2 });
});

test("rejects missing, malformed, or duplicate operation IDs", () => {
  assert.throws(() => validateOpenApiOperationIds({ paths: { "/missing": { get: {} } } }), /missing a stable operationId/);
  assert.throws(() => validateOpenApiOperationIds({ paths: { "/bad": { get: { operationId: "bad-id" } } } }), /missing a stable operationId/);
  assert.throws(() => validateOpenApiOperationIds({ paths: {
    "/one": { get: { operationId: "same" } },
    "/two": { post: { operationId: "same" } },
  } }), /Duplicate OpenAPI operationId/);
});
