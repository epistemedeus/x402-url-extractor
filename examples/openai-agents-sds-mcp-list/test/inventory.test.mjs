import assert from "node:assert/strict";
import test from "node:test";

import { InventoryError } from "../src/errors.mjs";
import { assertUnpaidListInventory } from "../src/inventory.mjs";
import { fixtureTools } from "./helpers.mjs";

test("fixture inventory requires extract and extract_batch and accepts extras", () => {
  const found = assertUnpaidListInventory(fixtureTools());
  assert.equal(found.extractPresent, true);
  assert.equal(found.extractBatchPresent, true);
  assert.equal(found.extractInputRequiresUrl, true);
  assert.equal(found.extractBatchInputRequiresUrls, true);
  assert.equal(found.exactGlobalCountRequired, false);
  assert.ok(found.names.includes("read"));
});

test("missing extract is refused", () => {
  assert.throws(
    () => assertUnpaidListInventory(fixtureTools("tools-list-missing-extract.json")),
    (error) => error instanceof InventoryError && /extract/.test(error.message),
  );
});

test("duplicate extract is refused", () => {
  const tools = fixtureTools();
  tools.push(structuredClone(tools[0]));
  assert.throws(() => assertUnpaidListInventory(tools), InventoryError);
});
