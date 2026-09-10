import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ARTIFACT_KIND,
  CASE_KINDS,
  CASE_SCHEMA,
  INPUT_SCHEMA,
  JOB_ID,
  OUTPUT_SCHEMA,
  POLICIES,
  SOURCE_TABLE_SCHEMA,
  classifyJoin,
  createOutputPacket,
  exampleCases,
  findDeclaredConversion,
  grainsCompatible,
  keyTuple,
  makeCitation,
  makeFinding,
  normalizeJoin,
  normalizeUnit,
  parseGrain,
  parseInstant,
  parseTimeWindow,
  schemaCatalog,
  selfCheck,
  sha256Hex,
  unitsCompatible,
  validateCase,
  validateInput,
  validateOutput,
  validateSourceTable,
  windowContainsInstant,
  windowsOverlap,
} from "../../src/table-reconcile/schema.mjs";

const CLOCK = "2026-09-10T00:00:00Z";

test("catalog names keys, units, and time windows", () => {
  const catalog = schemaCatalog();
  assert.equal(catalog.jobId, JOB_ID);
  assert.equal(catalog.inputSchema, INPUT_SCHEMA);
  assert.equal(catalog.outputSchema, OUTPUT_SCHEMA);
  assert.equal(catalog.keys.field, "join.keys");
  assert.equal(catalog.units.field, "join.units");
  assert.deepEqual(catalog.timeWindows.fields, ["join.timeWindow", "tables[].timeWindow"]);
  assert.deepEqual(catalog.caseKinds, CASE_KINDS);
  assert.equal(catalog.policies.neverInventTotals, true);
});

test("positive: aligned keys, units, and windows validate", () => {
  const { positive } = exampleCases(CLOCK);
  const input = validateInput(positive.input);
  assert.equal(input.ok, true);
  assert.equal(input.caseKind, "positive");
  assert.equal(input.value.join.keys[0], "entity");
  assert.equal(input.value.join.units.items, "count");
  assert.equal(input.value.join.windowStatus, "specified");
  const output = validateOutput(positive.output);
  assert.equal(output.ok, true);
  assert.equal(positive.output.totals.computed, false);
  assert.equal(positive.output.artifactKind, ARTIFACT_KIND);
});

test("negative: empty tables and missing join keys are invalid", () => {
  const { negative } = exampleCases(CLOCK);
  const input = validateInput(negative.input);
  assert.equal(input.ok, false);
  assert.equal(input.caseKind, "negative");
  const codes = input.issues.map((issue) => issue.code);
  assert.ok(codes.includes("minItems"));
  const output = validateOutput(negative.output);
  assert.equal(output.ok, true);
  assert.equal(negative.output.decision, "fail");
});

test("partial: open-ended time window is structurally valid and partial", () => {
  const { partial } = exampleCases(CLOCK);
  const input = validateInput(partial.input);
  assert.equal(input.ok, true);
  assert.equal(input.caseKind, "partial");
  assert.equal(input.value.join.windowStatus, "partial");
  const output = validateOutput(partial.output);
  assert.equal(output.ok, true);
  assert.equal(partial.output.decision, "partial");
});

test("conflict: incompatible units without conversion stay valid input", () => {
  const { conflict } = exampleCases(CLOCK);
  const input = validateInput(conflict.input);
  assert.equal(input.ok, true);
  assert.equal(input.caseKind, "conflict");
  const output = validateOutput(conflict.output);
  assert.equal(output.ok, true);
  assert.equal(conflict.output.decision, "conflict");
  const finding = conflict.output.findings[0];
  assert.equal(finding.kind, "unit-conflict");
  assert.ok(finding.citationIds.length >= 1);
});

test("self-check covers all four case kinds", () => {
  const result = selfCheck(CLOCK);
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.results).sort(), ["conflict", "negative", "partial", "positive"]);
});

test("operator clock is required and now is refused", () => {
  assert.equal(parseInstant("now").ok, false);
  assert.equal(parseInstant("now").issues[0].code, "invented_clock");
  assert.throws(() => createOutputPacket({}), /clock required/);
});

test("time windows: overlap, disjoint, unspecified, date-only midnight", () => {
  const jan = parseTimeWindow({
    start: "2026-01-01T00:00:00Z",
    end: "2026-02-01T00:00:00Z",
  });
  const mid = parseTimeWindow({
    start: "2026-01-15T00:00:00Z",
    end: "2026-01-20T00:00:00Z",
  });
  const mar = parseTimeWindow({
    start: "2026-03-01T00:00:00Z",
    end: "2026-04-01T00:00:00Z",
  });
  assert.equal(jan.status, "specified");
  assert.equal(windowsOverlap(jan.window, mid.window).status, "overlap");
  assert.equal(windowsOverlap(jan.window, mar.window).status, "disjoint");
  assert.equal(windowsOverlap(jan.window, parseTimeWindow(null).window).status, "unknown");

  const dateOnly = parseInstant("2026-01-01");
  assert.equal(dateOnly.ok, true);
  assert.equal(dateOnly.iso, "2026-01-01T00:00:00.000Z");

  const containsStart = windowContainsInstant(jan.window, "2026-01-01T00:00:00Z");
  const containsEnd = windowContainsInstant(jan.window, "2026-02-01T00:00:00Z");
  assert.equal(containsStart.contained, true);
  assert.equal(containsEnd.contained, false);

  const inverted = parseTimeWindow({
    start: "2026-02-01T00:00:00Z",
    end: "2026-01-01T00:00:00Z",
  });
  assert.equal(inverted.ok, false);
  assert.equal(inverted.status, "invalid");
});

test("units: catalog equality, mismatch, unknown, declared conversion only", () => {
  assert.equal(normalizeUnit("USD").id, "usd");
  assert.equal(normalizeUnit("items").id, "count");
  assert.equal(unitsCompatible("count", "items").compatible, true);
  assert.equal(unitsCompatible("count", "usd").compatible, false);
  assert.equal(unitsCompatible("percent", "ratio").compatible, false);
  assert.equal(unitsCompatible("widgets", "widgets").status, "unknown_equal");
  assert.equal(unitsCompatible("widgets", "sprockets").status, "unknown");

  const identity = findDeclaredConversion("count", "items", []);
  assert.equal(identity.ok, true);
  assert.equal(identity.identity, true);

  const missing = findDeclaredConversion("percent", "ratio", []);
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "no_declared_conversion");

  const declared = findDeclaredConversion("percent", "ratio", [{ from: "percent", to: "ratio", factor: 0.01 }]);
  assert.equal(declared.ok, true);
  assert.equal(declared.factor, 0.01);
});

test("key tuple hashes stable scalars and refuses missing or compound values", () => {
  const keys = ["entity", "region"];
  const a = keyTuple({ entity: "a", region: "us", items: 1 }, keys);
  const b = keyTuple({ items: 9, region: "us", entity: "a" }, keys);
  assert.equal(a.ok, true);
  assert.equal(a.id, b.id);
  assert.equal(keyTuple({ entity: "a" }, keys).code, "unkeyed");
  assert.equal(keyTuple({ entity: { nested: true }, region: "us" }, keys).code, "compound_key_value");
});

test("findings require citationIds that resolve in citations[]", () => {
  const bare = makeFinding({
    id: "x",
    kind: "positive",
    code: "ok",
    message: "n",
    citationIds: [],
  });
  assert.equal(bare.ok, false);

  const citation = makeCitation({
    id: "c1",
    path: "synthetic://c1",
    body: "hello",
    evidenceClass: "synthetic",
  });
  assert.equal(citation.ok, true);
  assert.equal(citation.citation.contentSha256, sha256Hex("hello"));

  const packet = createOutputPacket({
    clock: CLOCK,
    citations: [citation.citation],
    findings: [
      makeFinding({
        id: "f1",
        kind: "positive",
        code: "ok",
        message: "cited",
        citationIds: ["missing"],
      }).finding,
    ],
  });
  const result = validateOutput(packet);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === "unresolved_citation"));
});

test("invented totals are rejected", () => {
  const { positive } = exampleCases(CLOCK);
  const withNumber = { ...positive.output, totals: { computed: true, invented: false, value: 12 } };
  const a = validateOutput(withNumber);
  assert.equal(a.ok, false);
  assert.ok(a.issues.some((issue) => issue.code === "invented_total"));

  const guessed = { ...positive.output, guessedSum: 99 };
  const b = validateOutput(guessed);
  assert.equal(b.ok, false);

  const groupTotal = {
    ...positive.output,
    groups: [{ key: { entity: "a" }, outcome: "agree", total: 6 }],
  };
  const c = validateOutput(groupTotal);
  assert.equal(c.ok, false);
});

test("hostile keys and non-objects are negative/invalid", () => {
  const proto = JSON.parse('{"schema":"s137.table-reconcile.input.v1","clock":"2026-09-10T00:00:00Z","join":{"keys":["entity"],"units":{"items":"count"}},"tables":[{"id":"t","columns":[{"name":"entity","role":"key"}],"rows":[{"__proto__":{"polluted":true},"entity":"a"}]}]}');
  const result = validateInput(proto);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === "hostile_key"));
  assert.equal(validateInput(null).caseKind, "negative");
});

test("classifyJoin stays partial when a key column is missing", () => {
  const input = validateInput({
    schema: INPUT_SCHEMA,
    clock: CLOCK,
    evidenceClass: "fixture",
    join: {
      keys: ["entity"],
      units: { items: "count" },
      timeWindow: { start: "2026-01-01T00:00:00Z", end: "2026-02-01T00:00:00Z" },
    },
    tables: [
      {
        id: "only-keys",
        source: { path: "synthetic://only-keys" },
        columns: [{ name: "entity", role: "key" }],
        rows: [{ entity: "a" }],
        timeWindow: { start: "2026-01-01T00:00:00Z", end: "2026-02-01T00:00:00Z" },
      },
    ],
  });
  assert.equal(input.ok, true);
  assert.equal(input.caseKind, "partial");
  assert.equal(classifyJoin(input.value), "partial");
});

test("join.unit singular alias and sha256 citation alias match c13/c14 pins", () => {
  const join = normalizeJoin({
    keys: ["metric", "windowStart"],
    unit: "count",
    valueField: "value",
    timeWindow: {
      start: "2026-08-03T00:00:00.000Z",
      end: "2026-08-17T00:00:00.000Z",
      grain: "P7D",
    },
  });
  assert.equal(join.valueField, "value");
  assert.equal(join.units.value, "count");
  assert.equal(join.grain, "P7D");
  assert.equal(join.windowStatus, "specified");

  const none = normalizeJoin({
    keys: ["metric"],
    unit: null,
    timeWindow: { start: "2026-08-03T00:00:00.000Z", end: "2026-08-10T00:00:00.000Z" },
  });
  assert.equal(none.sharedUnit, null);

  const hash = sha256Hex("body");
  const citation = makeCitation({
    id: "src:lab-a",
    path: "sources/positive-agree/lab-a.json",
    url: "experiments/s137-consumer-evidence-jobs/fixtures/synthetic/table-reconcile/sources/positive-agree/lab-a.json",
    sha256: hash,
  });
  assert.equal(citation.ok, true);
  assert.equal(citation.citation.contentSha256, hash);
});

test("grain aliases: day vs P7D is a mismatch, not a rollup", () => {
  assert.equal(parseGrain("day").iso, "P1D");
  assert.equal(parseGrain("P7D").iso, "P7D");
  assert.equal(grainsCompatible("P7D", "P1D").status, "mismatch");
  assert.equal(grainsCompatible("week", "P7D").compatible, true);
});

test("validateSourceTable accepts keyed tables and rejects bare arrays", () => {
  const table = {
    schema: SOURCE_TABLE_SCHEMA,
    id: "lab-a",
    evidenceClass: "synthetic",
    keys: ["metric", "windowStart"],
    unit: "count",
    timeWindow: {
      start: "2026-08-03T00:00:00.000Z",
      end: "2026-08-17T00:00:00.000Z",
      grain: "P7D",
    },
    columns: [
      { name: "metric", role: "key" },
      { name: "windowStart", role: "key" },
      { name: "windowEnd", role: "bound" },
      { name: "value", role: "measure", unit: "count" },
    ],
    rows: [
      {
        metric: "synthetic.page_extracts",
        windowStart: "2026-08-03T00:00:00.000Z",
        windowEnd: "2026-08-10T00:00:00.000Z",
        value: 4,
      },
    ],
  };
  const ok = validateSourceTable(table);
  assert.equal(ok.ok, true);
  const bare = validateSourceTable([{ metric: "x", value: 1 }]);
  assert.equal(bare.ok, false);
  assert.equal(bare.issues[0].code, "missing-keys");
});

test("validateCase accepts path-referenced tables and fixture finding kinds", () => {
  const hashA = sha256Hex("a");
  const hashB = sha256Hex("b");
  const result = validateCase({
    schema: CASE_SCHEMA,
    id: "positive-agree",
    jobId: JOB_ID,
    kind: "positive",
    evidenceClass: "synthetic",
    clock: "2026-09-10T12:00:00.000Z",
    join: {
      keys: ["metric", "windowStart"],
      unit: "count",
      timeWindow: {
        start: "2026-08-03T00:00:00.000Z",
        end: "2026-08-17T00:00:00.000Z",
        grain: "P7D",
      },
    },
    tables: [
      { id: "lab-a", path: "sources/positive-agree/lab-a.json" },
      { id: "lab-b", path: "sources/positive-agree/lab-b.json" },
    ],
    expect: {
      decision: "pass",
      inventTotals: false,
      findings: [
        {
          id: "agree:row",
          kind: "agree",
          keys: { metric: "synthetic.page_extracts" },
          citationIds: ["src:a", "src:b"],
        },
      ],
    },
    citations: [
      { id: "src:a", path: "sources/positive-agree/lab-a.json", sha256: hashA },
      { id: "src:b", path: "sources/positive-agree/lab-b.json", sha256: hashB },
    ],
  });
  assert.equal(result.ok, true, result.issues.map((i) => i.message).join("; "));
  assert.equal(result.caseKind, "positive");
  assert.equal(result.value.join.units.value, "count");
});

test("count vs count_per_day is a unit conflict without declared conversion", () => {
  assert.equal(unitsCompatible("count", "count_per_day").compatible, false);
  assert.equal(findDeclaredConversion("count", "count_per_day", []).ok, false);
});
