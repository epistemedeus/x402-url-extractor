import assert from "node:assert/strict";
import test from "node:test";

import { acceptInventory, tryAcceptInventory } from "../src/accept.mjs";
import { DEFAULT_TOOLS } from "./helpers.mjs";

test("accepts extract and extract_batch and extra tools", () => {
  const accepted = acceptInventory([
    ...DEFAULT_TOOLS,
    { name: "read", inputSchema: { type: "object" } },
  ]);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.toolCount, 3);
  assert.equal(accepted.requiredPresent.extract, true);
  assert.equal(accepted.requiredPresent.extract_batch, true);
});

test("rejects missing extract", () => {
  const observed = tryAcceptInventory([DEFAULT_TOOLS[1]]);
  assert.equal(observed.ok, false);
  assert.equal(observed.code, "INVENTORY_REJECT");
  assert.match(observed.message, /missing extract/);
});

test("rejects duplicate names", () => {
  const observed = tryAcceptInventory([DEFAULT_TOOLS[0], DEFAULT_TOOLS[0], DEFAULT_TOOLS[1]]);
  assert.equal(observed.ok, false);
  assert.match(observed.message, /duplicate/);
});

test("rejects missing inputSchema", () => {
  const observed = tryAcceptInventory([
    { name: "extract" },
    { name: "extract_batch", inputSchema: { type: "object" } },
  ]);
  assert.equal(observed.ok, false);
  assert.match(observed.message, /inputSchema/);
});
