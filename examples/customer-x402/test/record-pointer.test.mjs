import assert from "node:assert/strict";
import test from "node:test";

import {
  encodePointer,
  getByPointer,
  joinPointers,
  parsePointer,
} from "../src/record/pointer.mjs";

test("RFC 6901 empty pointer is the document", () => {
  const doc = { a: 1 };
  const hit = getByPointer(doc, "");
  assert.equal(hit.ok, true);
  assert.equal(hit.present, true);
  assert.equal(hit.value, doc);
});

test("pointer encode/decode roundtrip including ~ and /", () => {
  const tokens = ["a/b", "c~d", "0"];
  const pointer = encodePointer(tokens);
  assert.equal(pointer, "/a~1b/c~0d/0");
  assert.deepEqual(parsePointer(pointer), tokens);
});

test("joinPointers concatenates a relative pointer", () => {
  assert.equal(joinPointers("/sources/0", "/data/jsonLd/0"), "/sources/0/data/jsonLd/0");
  assert.equal(joinPointers("/sources/0", ""), "/sources/0");
  assert.equal(joinPointers("", "/jsonLd"), "/jsonLd");
});

test("array field name without an index is ambiguous, not missing", () => {
  const hit = getByPointer({ jsonLd: [{ name: "Alpha" }] }, "/jsonLd/name");
  assert.equal(hit.ok, false);
  assert.equal(hit.code, "pointer.ambiguous_array");
});

test("exact array index is present or missing, never guessed", () => {
  const doc = { jsonLd: [{ name: "Alpha" }] };
  assert.equal(getByPointer(doc, "/jsonLd/0/name").value, "Alpha");
  assert.equal(getByPointer(doc, "/jsonLd/1/name").present, false);
  assert.equal(getByPointer(doc, "/jsonLd/01/name").code, "pointer.ambiguous_array");
});

test("JSON Pointer '-' is rejected as write-append", () => {
  const hit = getByPointer({ jsonLd: [] }, "/jsonLd/-");
  assert.equal(hit.ok, false);
  assert.equal(hit.code, "pointer.append_unsupported");
});

test("prototype tokens are rejected", () => {
  for (const token of ["__proto__", "constructor", "prototype"]) {
    const hit = getByPointer({ [token]: { x: 1 } }, `/${token}`);
    assert.equal(hit.ok, false);
    assert.equal(hit.code, "pointer.prototype");
  }
});

test("property-based: indexed walk matches native access for nested objects and arrays", () => {
  const docs = [
    { a: { b: [ { c: "x" }, { c: "y" } ] } },
    { "@type": "Product", name: "Alpha" },
    { items: [{ sku: "A-1" }, { sku: "B-2" }] },
  ];
  for (const doc of docs) {
    const paths = [
      ["a", "b", "0", "c"],
      ["a", "b", "1", "c"],
      ["@type"],
      ["name"],
      ["items", "0", "sku"],
      ["items", "1", "sku"],
    ];
    for (const tokens of paths) {
      const pointer = encodePointer(tokens);
      let expected = doc;
      let present = true;
      for (const token of tokens) {
        if (expected == null || typeof expected !== "object" || !Object.prototype.hasOwnProperty.call(expected, token)) {
          present = false;
          break;
        }
        expected = expected[token];
      }
      const hit = getByPointer(doc, pointer);
      if (!present) {
        assert.equal(hit.present, false, pointer);
      } else {
        assert.equal(hit.present, true, pointer);
        assert.deepEqual(hit.value, expected);
      }
    }
  }
});
