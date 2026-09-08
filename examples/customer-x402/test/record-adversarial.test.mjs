import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, symlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { parseMapping } from "../src/record/mapping.mjs";
import { projectRecords } from "../src/record/project.mjs";
import { getByPointer } from "../src/record/pointer.mjs";
import { inspectJsonSchema } from "../src/record/schema.mjs";
import { DEFAULT_LIMITS } from "../src/record/constants.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const bin = join(root, "bin/record.mjs");

function mappingBase(overrides = {}) {
  return {
    schemaVersion: "pilot.c29.buyer-record-projection.mapping.v1",
    kind: "json",
    artifact: "input.json",
    rowsPointer: "",
    merchantCompat: false,
    fields: {
      name: { from: "/name", base: "row", required: true },
    },
    ...overrides,
  };
}

test("mapping rejects eval/fetch/remote execution keys", () => {
  for (const key of ["eval", "fetch", "http", "jmespath", "jsonpath", "$ref"]) {
    assert.throws(() => parseMapping({ ...mappingBase(), [key]: true }), /forbidden|unsupported/);
  }
});

test("schema $ref and remote keywords are unsupported", () => {
  const issues = inspectJsonSchema({ $ref: "https://example.com/schema.json" }, DEFAULT_LIMITS);
  assert.ok(issues.some((item) => item.code === "schema.unsupported"));
});

test("ambiguous array mapping fails the job closed with zero records", () => {
  const result = projectRecords({
    document: { jsonLd: [{ name: "Alpha" }] },
    mapping: parseMapping({
      schemaVersion: "pilot.c29.buyer-record-projection.mapping.v1",
      kind: "json",
      artifact: "input.json",
      rowsPointer: "",
      itemPointer: "/jsonLd",
      merchantCompat: false,
      fields: {
        name: { from: "/jsonLd/name", base: "row", required: true },
      },
    }),
    schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    artifactName: "input.json",
    inputText: "{}",
  });
  assert.equal(result.status, "failure");
  assert.equal(result.records.length, 0);
  assert.ok(result.issues.some((item) => item.code === "pointer.ambiguous_array"));
});

test("prototype keys on source objects are rejected", () => {
  const mapping = parseMapping(mappingBase());
  const document = { name: "x" };
  document.constructor = { polluted: true };
  const result = projectRecords({
    document,
    mapping,
    schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    artifactName: "input.json",
    inputText: '{"name":"x"}',
  });
  assert.equal(result.status, "failure");
  assert.ok(result.issues.some((item) => item.code === "pointer.prototype"));
});

test("CLI rejects a symlink input", () => {
  const dir = mkdtempSync(join(tmpdir(), "record-sym-"));
  const real = join(dir, "real.json");
  const link = join(dir, "link.json");
  writeFileSync(real, '{"name":"x"}');
  symlinkSync(real, link);
  const mappingPath = join(dir, "mapping.json");
  const schemaPath = join(dir, "schema.json");
  writeFileSync(mappingPath, JSON.stringify(mappingBase()));
  writeFileSync(schemaPath, JSON.stringify({ type: "object", properties: { name: { type: "string" } }, required: ["name"] }));
  const result = spawnSync(process.execPath, [bin, "--input", link, "--mapping", mappingPath, "--schema", schemaPath, "--out", join(dir, "out")], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stdout, /symlink/);
});

test("oversized input is rejected", () => {
  const dir = mkdtempSync(join(tmpdir(), "record-over-"));
  const mapping = mappingBase({ limits: { maxInputBytes: 32 } });
  writeFileSync(join(dir, "mapping.json"), JSON.stringify(mapping));
  writeFileSync(join(dir, "schema.json"), JSON.stringify({ type: "object", properties: { name: { type: "string" } } }));
  writeFileSync(join(dir, "input.json"), JSON.stringify({ name: "n".repeat(80) }));
  const result = spawnSync(process.execPath, [
    bin,
    "--input", join(dir, "input.json"),
    "--mapping", join(dir, "mapping.json"),
    "--schema", join(dir, "schema.json"),
    "--out", join(dir, "out"),
  ], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stdout, /oversized|above/);
});

test("itemPointer at a single object is ambiguous unless cardinality is one", () => {
  const result = projectRecords({
    document: { block: { name: "Alpha" } },
    mapping: parseMapping({
      schemaVersion: "pilot.c29.buyer-record-projection.mapping.v1",
      kind: "json",
      rowsPointer: "",
      itemPointer: "/block",
      itemCardinality: "array",
      merchantCompat: false,
      fields: { name: { from: "/name", base: "item", required: true } },
    }),
    schema: { type: "object", required: ["name"], properties: { name: { type: "string" } } },
    artifactName: "input.json",
    inputText: "{}",
  });
  assert.equal(result.status, "failure");
  assert.ok(result.issues.some((item) => item.code === "pointer.ambiguous_array"));
});

test("getByPointer never materializes missing as null", () => {
  const hit = getByPointer({ name: "Alpha" }, "/email");
  assert.equal(hit.present, false);
  assert.equal(hit.value, undefined);
});
