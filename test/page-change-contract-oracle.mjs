import assert from "node:assert/strict";

// Independent receiving oracle, never used by the producer or runtime validator.
// Reject unsupported references rather than guessing, fetching, clipping or
// normalizing away annotations. Pointer bases are the supplied whole document.
export function dereferenceContract(document) {
  function target(ref) {
    assert.equal(typeof ref, "string");
    assert.ok(ref.startsWith("#/"), `non-local reference: ${ref}`);
    let value = document;
    for (const token of ref.slice(2).split("/")) {
      assert.ok(!/~(?:[^01]|$)/.test(token), `invalid pointer: ${ref}`);
      const key = token.replace(/~1/g, "/").replace(/~0/g, "~");
      assert.ok(value && typeof value === "object" && Object.hasOwn(value, key), `unresolved reference: ${ref}`);
      value = value[key];
    }
    assert.ok(value && typeof value === "object" && !Array.isArray(value), `wrong reference target: ${ref}`);
    return value;
  }
  function walk(value, stack = []) {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(child => walk(child, stack));
    const { $ref, ...siblings } = value;
    if ($ref !== undefined) {
      assert.ok(!stack.includes($ref), `cyclic reference: ${$ref}`);
      const resolved = walk(target($ref), [...stack, $ref]);
      const rest = walk(siblings, stack);
      // Conflicting sibling keywords need conjunction semantics. This candidate
      // emits none; fail closed rather than replacing one constraint with another.
      for (const key of Object.keys(rest)) if (Object.hasOwn(resolved, key)) assert.deepEqual(rest[key], resolved[key], `conflicting $ref sibling: ${key}`);
      return { ...resolved, ...rest };
    }
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, walk(child, stack)]));
  }
  return walk(document);
}

const definitionNames = ["PageChangeArtifact", "PageChangeMerchant", "PageChangeC1", "PageChangeRow"];
export function assertEquivalentOpenApi(baseline, candidate) {
  const expected = dereferenceContract(baseline);
  const actual = dereferenceContract(candidate);
  // Only the four representation definitions are bookkeeping; all operations,
  // keywords, constraints, descriptions, examples, values and array order remain.
  for (const name of definitionNames) {
    assert.ok(Object.hasOwn(actual.components?.schemas || {}, name));
    delete actual.components.schemas[name];
  }
  if (!Object.keys(actual.components.schemas).length && !expected.components?.schemas) delete actual.components.schemas;
  if (!Object.keys(actual.components).length && !expected.components) delete actual.components;
  assert.deepEqual(actual, expected);
}

export function assertEquivalentTool(baseline, candidate) {
  assert.deepEqual({ ...candidate, inputSchema: dereferenceContract(candidate.inputSchema) },
    { ...baseline, inputSchema: dereferenceContract(baseline.inputSchema) });
}
