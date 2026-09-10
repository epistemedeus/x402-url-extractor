import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  INPUT_SCHEMA,
  UNKNOWN_LICENSE,
  assertNoForbidden,
  validateDependencyEntry,
  validateDependencyFootprintInput,
} from "../src/index.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = (name) => JSON.parse(readFileSync(join(root, "fixtures", name), "utf8"));

test("validate positive fixture normalizes two trees", () => {
  const input = validateDependencyFootprintInput(load("positive.json"));
  assert.equal(input.schema, INPUT_SCHEMA);
  assert.equal(input.trees.length, 2);
  assert.equal(input.trees[0].id, "service-a");
  assert.equal(input.trees[1].id, "service-b");
  // packages{} expanded
  assert.ok(input.trees[1].dependencies.some((d) => d.name === "lodash"));
  assert.ok(input.trees[1].dependencies.some((d) => d.name === "debug" && d.licenseUnknown));
});

test("validate rejects forbidden claims", () => {
  assert.throws(
    () => validateDependencyFootprintInput(load("negative-malformed.json")),
    (err) => err.code === "forbidden_claim",
  );
});

test("validate partial allows incomplete entries", () => {
  const input = validateDependencyFootprintInput(load("partial-incomplete.json"));
  const incomplete = input.trees[0].dependencies.filter((d) => d.incomplete);
  assert.ok(incomplete.length >= 2);
});

test("missing license becomes unknown", () => {
  const dep = validateDependencyEntry({ name: "x", version: "1.0.0" }, 0);
  assert.equal(dep.license, UNKNOWN_LICENSE);
  assert.equal(dep.licenseUnknown, true);
  assert.equal(dep.licenseDeclared, false);
});

test("assertNoForbidden catches nested fields", () => {
  assert.throws(
    () => assertNoForbidden({ a: { cveScore: 1 } }, "input"),
    (err) => err.code === "forbidden_claim" && err.details?.field === "cveScore",
  );
});

test("missing trees rejected", () => {
  assert.throws(
    () => validateDependencyFootprintInput({ reportId: "x" }),
    (err) => err.code === "missing_requirement",
  );
});
