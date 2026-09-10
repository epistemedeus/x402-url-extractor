import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { naiveNamedImports } from "../fixtures/naive-import-regex.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(
  join(HERE, "../fixtures/regex-false-positives.source.txt"),
  "utf8",
);

test("naive import regex over-matches comments and string literals", () => {
  const hits = naiveNamedImports(SOURCE);
  const froms = hits.map((h) => h.from).sort();
  assert.deepEqual(froms, ["quoted-dep", "real-dep", "secret-dep", "types-dep"].sort());
});

test("grammar-aware expectation labels comment/string/dynamic/TS as unknown", () => {
  const expected = [
    { from: "secret-dep", kind: "comment", decision: "unknown" },
    { from: "quoted-dep", kind: "string-literal", decision: "unknown" },
    { from: "real-dep", kind: "static-esm", decision: "action-or-bind" },
    { from: "types-dep", kind: "ts-type-only", decision: "unknown" },
    { from: "variableName", kind: "dynamic-nonliteral", decision: "unknown" },
  ];
  const bindable = expected.filter((e) => e.decision !== "unknown");
  assert.deepEqual(bindable.map((e) => e.from), ["real-dep"]);
  assert.ok(
    SOURCE.includes("import { used } from \"real-dep\""),
    "fixture still contains the one real static import",
  );
});
