import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  SCHEMA,
  REASON_CODES,
  TAXONOMY,
  POLICIES,
  PACKET_DECISIONS,
  BASELINE_LIMITATIONS,
  UnknownReasonCodeError,
  allowsPartialBindings,
  applyUnknownPolicy,
  appliesToBinding,
  catalogPolicy,
  classifyDynamicImport,
  classifyHostileInput,
  classifyLanguage,
  classifyLockfileConflict,
  classifyMissingSource,
  classifyParserLimit,
  classifyPartialCoverage,
  classifyPrereleaseRange,
  classifyUnsupportedLanguage,
  collectReasonsFromDraft,
  constrainDecision,
  coverageIsComplete,
  createReason,
  effectivePolicy,
  evaluateUnknown,
  isForceUnknownCode,
  isReasonCode,
  limitationsFromReasons,
  summarizeUnknown,
  versionIdentityKind,
} from "../../src/unknown.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "fixtures/taxonomy.synthetic.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

const ACTION_BINDING = {
  symbol: "alpha",
  used: true,
  changeKind: "removed",
  decision: "action",
  rationale: "candidate from binder",
  specifier: "demo-widget",
  file: "src/app.js",
};

function actionBinding(overrides = {}) {
  return { ...ACTION_BINDING, ...overrides };
}

describe("taxonomy catalog", () => {
  test("exports the eight contracted reason codes in stable order", () => {
    assert.deepEqual(REASON_CODES, [
      "missing_source",
      "partial_coverage",
      "lockfile_conflict",
      "dynamic_import",
      "unsupported_language",
      "parser_limit",
      "prerelease_range_ambiguous",
      "hostile_input",
    ]);
    assert.equal(REASON_CODES.length, 8);
    assert.equal(new Set(REASON_CODES).size, 8);
  });

  test("synthetic fixture matches the catalog (label: synthetic)", () => {
    assert.equal(fixture.label, "synthetic");
    assert.equal(fixture.schema, SCHEMA);
    assert.deepEqual(fixture.reasonCodes, REASON_CODES);
    for (const code of REASON_CODES) {
      assert.equal(fixture.catalogPolicy[code], catalogPolicy(code));
      assert.equal(TAXONOMY[code].policy, catalogPolicy(code));
    }
  });

  test("schema and decision vocabulary match the packet contract", () => {
    assert.equal(SCHEMA, "s127.upgrade-impact.unknown.v1");
    assert.deepEqual(PACKET_DECISIONS, ["action", "unknown", "no_action"]);
  });

  test("unknown reason codes throw rather than pass through", () => {
    assert.equal(isReasonCode("not_a_reason"), false);
    assert.throws(() => createReason("stale_baseline"), UnknownReasonCodeError);
    assert.throws(() => applyUnknownPolicy({ reasons: ["invented"] }), UnknownReasonCodeError);
  });

  test("does not invent paid demand or execution fields", () => {
    const result = applyUnknownPolicy({
      bindings: [actionBinding()],
      reasons: ["missing_source"],
    });
    assert.equal("payment" in result, false);
    assert.equal("cost" in result, false);
    assert.equal("execute" in result, false);
    assert.equal("posted" in result, false);
  });
});

describe("missing_source", () => {
  const code = "missing_source";

  test("catalog: force_unknown, packet scope", () => {
    assert.equal(catalogPolicy(code), POLICIES.FORCE_UNKNOWN);
    assert.equal(isForceUnknownCode(code), true);
    assert.equal(allowsPartialBindings(code), false);
    assert.equal(TAXONOMY[code].defaultScope, "packet");
    assert.equal(TAXONOMY[code].contractRule, 3);
  });

  test("classifier fires only on explicit absence, not on omitted fields", () => {
    assert.equal(classifyMissingSource({}), null);
    const reason = classifyMissingSource({
      oldArtifact: null,
      evidenceClass: "synthetic",
    });
    assert.equal(reason.code, code);
    assert.deepEqual(reason.artifacts, ["old"]);
    assert.equal(reason.evidenceClass, "synthetic");
    assert.equal(reason.policy, POLICIES.FORCE_UNKNOWN);
  });

  test("downgrades action bindings and forces packet unknown", () => {
    const result = applyUnknownPolicy({
      bindings: [
        actionBinding(),
        {
          symbol: "gamma",
          used: false,
          changeKind: "removed",
          decision: "no_action",
        },
      ],
      reasons: [classifyMissingSource({ newMissing: true, evidenceClass: "synthetic" })],
    });
    assert.equal(result.summary.nextAction, "unknown");
    assert.deepEqual(result.summary.unknownReasons, [code]);
    assert.deepEqual(result.summary.actionableChanges, []);
    assert.deepEqual(result.summary.unusedChanges, ["gamma"]);
    assert.equal(result.bindings[0].decision, "unknown");
    assert.equal(result.bindings[1].decision, "no_action");
    assert.equal(result.flags.forceUnknown, true);
  });
});

describe("partial_coverage", () => {
  const code = "partial_coverage";

  test("catalog: allow_partial, unnamed escalates", () => {
    assert.equal(catalogPolicy(code), POLICIES.ALLOW_PARTIAL);
    assert.equal(allowsPartialBindings(code), true);
    assert.equal(TAXONOMY[code].unnamedEscalates, true);
    const unnamed = createReason(code);
    assert.equal(unnamed.escalated, true);
    assert.equal(unnamed.policy, POLICIES.FORCE_UNKNOWN);
    assert.equal(unnamed.escalateReason, "unnamed_scope");
  });

  test("complete coverage is not a reason", () => {
    assert.equal(coverageIsComplete("full"), true);
    assert.equal(coverageIsComplete(1), true);
    assert.equal(classifyPartialCoverage({ coverage: "full" }), null);
    assert.equal(classifyPartialCoverage({ filesAnalyzed: 2, filesTotal: 2 }), null);
  });

  test("named coveredSymbols allow action on covered used symbols only", () => {
    const reason = classifyPartialCoverage({
      coverage: 0.5,
      coveredSymbols: ["alpha"],
      filesAnalyzed: 1,
      filesTotal: 2,
      evidenceClass: "synthetic",
    });
    assert.equal(reason.code, code);
    assert.equal(reason.policy, POLICIES.ALLOW_PARTIAL);
    assert.equal(reason.escalated, false);

    const covered = actionBinding({ symbol: "alpha" });
    const uncovered = actionBinding({ symbol: "beta", specifier: "demo-widget" });
    assert.equal(appliesToBinding(reason, covered), false);
    assert.equal(appliesToBinding(reason, uncovered), true);

    const result = applyUnknownPolicy({
      bindings: [covered, uncovered],
      reasons: [reason],
    });
    assert.equal(result.summary.nextAction, "action");
    assert.deepEqual(result.summary.unknownReasons, [code]);
    assert.deepEqual(result.summary.actionableChanges, ["alpha"]);
    assert.equal(result.bindings[0].decision, "action");
    assert.equal(result.bindings[0].flags.partialPacket, true);
    assert.equal(result.bindings[1].decision, "unknown");
    assert.ok(result.bindings[1].unknownReasons.includes(code));
  });

  test("unnamed partial coverage cannot claim action", () => {
    const result = applyUnknownPolicy({
      bindings: [actionBinding()],
      reasons: [classifyPartialCoverage({ coverage: "partial", evidenceClass: "synthetic" })],
    });
    assert.equal(result.reasons[0].escalated, true);
    assert.equal(result.summary.nextAction, "unknown");
    assert.equal(result.bindings[0].decision, "unknown");
    assert.deepEqual(result.summary.actionableChanges, []);
  });
});

describe("lockfile_conflict", () => {
  const code = "lockfile_conflict";

  test("catalog: force_unknown (contract rule 5)", () => {
    assert.equal(catalogPolicy(code), POLICIES.FORCE_UNKNOWN);
    assert.equal(TAXONOMY[code].contractRule, 5);
  });

  test("does not treat omitted lockfile data as conflict; requires explicit disagreement", () => {
    assert.equal(classifyLockfileConflict({}), null);
    assert.equal(
      classifyLockfileConflict({
        manifestVersion: "^1.0.0",
        lockfileVersion: "1.0.0",
      }),
      null,
    );
    const reason = classifyLockfileConflict({
      disagreement: true,
      requestedName: "demo-widget",
      resolvedName: "demo-widget-fork",
      evidenceClass: "synthetic",
    });
    assert.equal(reason.code, code);
    assert.equal(reason.policy, POLICIES.FORCE_UNKNOWN);
  });

  test("alias/name mismatch and two disagreeing lockfile snapshots force unknown", () => {
    assert.equal(
      classifyLockfileConflict({ requestedName: "demo-widget", resolvedName: "other" }).code,
      code,
    );
    assert.equal(
      classifyLockfileConflict({ lockfileA: "sha-a", lockfileB: "sha-b" }).code,
      code,
    );
    const result = applyUnknownPolicy({
      bindings: [actionBinding()],
      reasons: ["lockfile_conflict"],
    });
    assert.equal(result.summary.nextAction, "unknown");
    assert.equal(result.bindings[0].decision, "unknown");
  });
});

describe("dynamic_import", () => {
  const code = "dynamic_import";

  test("catalog: allow_partial (contract rule 4)", () => {
    assert.equal(catalogPolicy(code), POLICIES.ALLOW_PARTIAL);
    assert.equal(TAXONOMY[code].contractRule, 4);
  });

  test("classifier requires dynamicImport: true", () => {
    assert.equal(classifyDynamicImport({ specifier: "demo-widget" }), null);
    const reason = classifyDynamicImport({
      dynamicImport: true,
      specifier: "demo-widget",
      file: "src/app.js",
      evidenceClass: "synthetic",
    });
    assert.equal(reason.code, code);
    assert.deepEqual(reason.surfaces, ["demo-widget"]);
    assert.equal(reason.policy, POLICIES.ALLOW_PARTIAL);
  });

  test("unknown only for the dynamic surface; static other package may stay action", () => {
    const reason = classifyDynamicImport({
      dynamicImport: true,
      specifier: "demo-widget",
    });
    const result = applyUnknownPolicy({
      bindings: [
        actionBinding({ symbol: "alpha", specifier: "demo-widget", surface: "demo-widget" }),
        actionBinding({
          symbol: "run",
          specifier: "other-lib",
          surface: "other-lib",
          changeKind: "removed",
        }),
      ],
      reasons: [reason],
    });
    assert.equal(result.bindings[0].decision, "unknown");
    assert.equal(result.bindings[1].decision, "action");
    assert.equal(result.summary.nextAction, "action");
    assert.deepEqual(result.summary.unknownReasons, [code]);
    assert.deepEqual(result.summary.actionableChanges, ["run"]);
  });

  test("dynamic import without a named surface escalates (cannot prove other surfaces)", () => {
    const reason = classifyDynamicImport({ dynamicImport: true });
    assert.equal(reason.escalated, true);
    assert.equal(effectivePolicy(reason), POLICIES.FORCE_UNKNOWN);
    assert.equal(constrainDecision("action", [reason], actionBinding()), "unknown");
  });
});

describe("unsupported_language", () => {
  const code = "unsupported_language";

  test("catalog: allow_partial with unnamed escalation", () => {
    assert.equal(catalogPolicy(code), POLICIES.ALLOW_PARTIAL);
    assert.equal(TAXONOMY[code].unnamedEscalates, true);
  });

  test("python/rust/go files classify; js does not", () => {
    assert.equal(classifyUnsupportedLanguage({ file: "src/app.js" }), null);
    const py = classifyUnsupportedLanguage({
      file: "src/main.py",
      language: "python",
      evidenceClass: "synthetic",
    });
    assert.equal(py.code, code);
    assert.deepEqual(py.files, ["src/main.py"]);
    assert.equal(classifyLanguage({ file: "pkg/lib.rs" }).code, code);
    assert.equal(classifyLanguage({ language: "go", file: "main.go" }).code, code);
  });

  test("named unsupported file is unknown; js binding may stay action", () => {
    const reason = classifyUnsupportedLanguage({ file: "src/main.py" });
    const result = applyUnknownPolicy({
      bindings: [
        actionBinding({ symbol: "helper", file: "src/main.py" }),
        actionBinding({ symbol: "alpha", file: "src/app.js" }),
      ],
      reasons: [reason],
    });
    assert.equal(result.bindings[0].decision, "unknown");
    assert.equal(result.bindings[1].decision, "action");
    assert.equal(result.summary.nextAction, "action");
  });
});

describe("parser_limit", () => {
  const code = "parser_limit";

  test("catalog: allow_partial; TS is parser_limit not unsupported", () => {
    assert.equal(catalogPolicy(code), POLICIES.ALLOW_PARTIAL);
    const ts = classifyParserLimit({
      file: "src/types.ts",
      construct: "import_type",
      evidenceClass: "synthetic",
    });
    assert.equal(ts.code, code);
    assert.equal(classifyLanguage({ file: "src/widget.tsx" }).code, code);
    assert.equal(classifyLanguage({ file: "src/app.vue" }).code, code);
    assert.equal(classifyUnsupportedLanguage({ file: "src/types.ts" }), null);
  });

  test("type-only TS file unknown; parsed JS used removal may stay action", () => {
    const reason = classifyParserLimit({
      file: "src/types.ts",
      construct: "import_type",
    });
    const result = applyUnknownPolicy({
      bindings: [
        actionBinding({ symbol: "Alpha", file: "src/types.ts", changeKind: "removed" }),
        actionBinding({ symbol: "alpha", file: "src/app.js", changeKind: "removed" }),
      ],
      reasons: [reason],
    });
    assert.equal(result.bindings[0].decision, "unknown");
    assert.equal(result.bindings[1].decision, "action");
    assert.equal(result.summary.nextAction, "action");
    assert.ok(result.limitations.some((row) => /TypeScript/i.test(row)));
  });

  test("explicit parserLimit flag without a file escalates", () => {
    const reason = classifyParserLimit({ parserLimit: true });
    assert.equal(reason.escalated, true);
    assert.equal(reason.policy, POLICIES.FORCE_UNKNOWN);
  });
});

describe("prerelease_range_ambiguous", () => {
  const code = "prerelease_range_ambiguous";

  test("catalog: force_unknown", () => {
    assert.equal(catalogPolicy(code), POLICIES.FORCE_UNKNOWN);
  });

  test("version identity kinds", () => {
    assert.equal(versionIdentityKind("1.0.0"), "exact");
    assert.equal(versionIdentityKind("2.0.0-beta.1"), "prerelease_exact");
    assert.equal(versionIdentityKind("^2.0.0-beta.1"), "range");
    assert.equal(versionIdentityKind("latest"), "range");
    assert.equal(versionIdentityKind("workspace:*"), "range");
    assert.equal(versionIdentityKind("1.2.x"), "range");
    assert.equal(versionIdentityKind(""), "missing");
  });

  test("unpinned range/prerelease is a reason; exact resolved pins are not", () => {
    const ambiguous = classifyPrereleaseRange({
      oldVersion: "^1.0.0",
      newVersion: "^2.0.0-beta.1",
      evidenceClass: "synthetic",
    });
    assert.equal(ambiguous.code, code);
    assert.equal(
      classifyPrereleaseRange({
        oldVersion: "^1.0.0",
        newVersion: "^2.0.0-beta.1",
        resolvedOld: "1.0.0",
        resolvedNew: "2.0.0-beta.1",
      }),
      null,
    );
    assert.equal(
      classifyPrereleaseRange({
        oldVersion: "1.0.0",
        newVersion: "2.0.0-beta.1",
      }),
      null,
    );
    assert.equal(classifyPrereleaseRange({}), null);
  });

  test("ambiguous identity forbids action even when binder claimed a removal", () => {
    const result = applyUnknownPolicy({
      bindings: [actionBinding()],
      reasons: [classifyPrereleaseRange({ oldVersion: "latest", newVersion: "next" })],
    });
    assert.equal(result.summary.nextAction, "unknown");
    assert.equal(result.bindings[0].decision, "unknown");
    assert.deepEqual(result.summary.unknownReasons, [code]);
  });
});

describe("hostile_input", () => {
  const code = "hostile_input";

  test("catalog: force_unknown", () => {
    assert.equal(catalogPolicy(code), POLICIES.FORCE_UNKNOWN);
  });

  test("classifier uses pre-classified signals only (does not scan payloads)", () => {
    assert.equal(classifyHostileInput({}), null);
    const reason = classifyHostileInput({
      hostile: true,
      signals: ["path_escape", "lifecycle_scripts"],
      evidenceClass: "synthetic",
    });
    assert.equal(reason.code, code);
    assert.deepEqual(reason.signals, ["path_escape", "lifecycle_scripts"]);
  });

  test("hostile input forces unknown, sets hostile flag, and strips actionableChanges", () => {
    const result = applyUnknownPolicy({
      bindings: [actionBinding()],
      reasons: [classifyHostileInput({ signals: ["prototype_pollution_key"] })],
    });
    assert.equal(result.summary.nextAction, "unknown");
    assert.equal(result.flags.hostile, true);
    assert.equal(result.flags.forceUnknown, true);
    assert.deepEqual(result.summary.actionableChanges, []);
    assert.equal(result.bindings[0].decision, "unknown");
  });
});

describe("packet reduction and invariants", () => {
  test("evaluateUnknown is applyUnknownPolicy", () => {
    assert.equal(evaluateUnknown, applyUnknownPolicy);
  });

  test("empty bindings and no reasons is no_action (a new version is not itself a break)", () => {
    const result = applyUnknownPolicy({ bindings: [], reasons: [] });
    assert.equal(result.summary.nextAction, "no_action");
    assert.deepEqual(result.summary.unknownReasons, []);
    assert.deepEqual(result.summary.actionableChanges, []);
  });

  test("unused action is repaired to no_action even without unknown reasons", () => {
    const result = applyUnknownPolicy({
      bindings: [
        {
          symbol: "gamma",
          used: false,
          changeKind: "removed",
          decision: "action",
          rationale: "binder mistake",
        },
      ],
      reasons: [],
    });
    assert.equal(result.bindings[0].decision, "no_action");
    assert.equal(result.bindings[0].flags.invariantRepaired, true);
    assert.equal(result.summary.nextAction, "no_action");
    assert.deepEqual(result.summary.unusedChanges, ["gamma"]);
    assert.deepEqual(result.summary.actionableChanges, []);
  });

  test("force_unknown wins over allow_partial when both are present", () => {
    const result = applyUnknownPolicy({
      bindings: [
        actionBinding({ symbol: "alpha" }),
        actionBinding({ symbol: "beta", specifier: "other-lib", surface: "other-lib" }),
      ],
      reasons: [
        classifyDynamicImport({ dynamicImport: true, specifier: "demo-widget" }),
        classifyMissingSource({ oldMissing: true }),
      ],
    });
    assert.equal(result.summary.nextAction, "unknown");
    assert.ok(result.summary.unknownReasons.includes("missing_source"));
    assert.ok(result.summary.unknownReasons.includes("dynamic_import"));
    assert.equal(result.bindings.every((row) => row.decision === "unknown"), true);
    assert.deepEqual(result.summary.actionableChanges, []);
  });

  test("allow_partial reason accounted as unused does not block no_action", () => {
    const reason = classifyDynamicImport({
      dynamicImport: true,
      specifier: "optional-plugin",
    });
    const result = applyUnknownPolicy({
      bindings: [
        {
          symbol: "optional-plugin",
          used: false,
          specifier: "optional-plugin",
          surface: "optional-plugin",
          changeKind: "removed",
          decision: "no_action",
        },
      ],
      reasons: [reason],
    });
    assert.equal(result.summary.nextAction, "no_action");
    assert.deepEqual(result.summary.unknownReasons, ["dynamic_import"]);
    assert.equal(result.bindings[0].decision, "no_action");
  });

  test("limitations always include baseline pack limits plus matched reasons", () => {
    const rows = limitationsFromReasons(["hostile_input"]);
    for (const line of BASELINE_LIMITATIONS) assert.ok(rows.includes(line));
    assert.ok(rows.includes(TAXONOMY.hostile_input.limitation));
  });

  test("constrainDecision leaves no_action and unknown intact", () => {
    assert.equal(constrainDecision("no_action", ["missing_source"], actionBinding()), "no_action");
    assert.equal(constrainDecision("unknown", ["missing_source"], actionBinding()), "unknown");
    assert.equal(constrainDecision("action", ["missing_source"], actionBinding()), "unknown");
    assert.equal(constrainDecision("not-a-decision", [], actionBinding()), "unknown");
  });

  test("summarizeUnknown matches applyUnknownPolicy.summary", () => {
    const bindings = [actionBinding()];
    const reasons = [createReason("lockfile_conflict")];
    const applied = applyUnknownPolicy({ bindings, reasons });
    const summary = summarizeUnknown({ bindings: applied.bindings, reasons: applied.reasons });
    assert.deepEqual(summary, applied.summary);
  });
});

describe("collectReasonsFromDraft", () => {
  test("gathers every reason family from a synthetic packet draft", () => {
    const reasons = collectReasonsFromDraft({
      evidenceClass: "synthetic",
      missingSource: { newMissing: true, evidenceClass: "synthetic" },
      exportDiff: {
        coverage: 0.5,
        coveredSymbols: ["alpha"],
        evidenceClass: "synthetic",
      },
      lockfile: { disagreement: true, evidenceClass: "synthetic" },
      usage: [
        { dynamicImport: true, specifier: "demo-widget", evidenceClass: "synthetic" },
        { file: "src/types.ts", construct: "import_type", evidenceClass: "synthetic" },
        { file: "src/main.py", language: "python", evidenceClass: "synthetic" },
      ],
      dependency: { oldVersion: "^1.0.0", newVersion: "latest", evidenceClass: "synthetic" },
      hostile: { signals: ["oversized"], evidenceClass: "synthetic" },
    });
    const codes = reasons.map((row) => row.code).sort();
    assert.deepEqual(codes, [...REASON_CODES].sort());
  });

  test("empty draft emits no reasons", () => {
    assert.deepEqual(collectReasonsFromDraft({}), []);
  });

  test("strips prototype-pollution keys from reason detail", () => {
    const reason = createReason("hostile_input", {
      signals: ["prototype_pollution_key"],
      detail: JSON.parse('{"ok":true,"__proto__":{"polluted":true}}'),
    });
    assert.equal(Object.prototype.hasOwnProperty.call(reason.detail, "__proto__"), false);
    assert.equal(reason.detail.ok, true);
    assert.equal(reason.detail.polluted, undefined);
  });
});

describe("each reason code: policy application matrix", () => {
  const matrix = [
    ["missing_source", POLICIES.FORCE_UNKNOWN],
    ["partial_coverage", POLICIES.ALLOW_PARTIAL],
    ["lockfile_conflict", POLICIES.FORCE_UNKNOWN],
    ["dynamic_import", POLICIES.ALLOW_PARTIAL],
    ["unsupported_language", POLICIES.ALLOW_PARTIAL],
    ["parser_limit", POLICIES.ALLOW_PARTIAL],
    ["prerelease_range_ambiguous", POLICIES.FORCE_UNKNOWN],
    ["hostile_input", POLICIES.FORCE_UNKNOWN],
  ];

  for (const [code, policy] of matrix) {
    test(`${code}: unnamed createReason + one action binding`, () => {
      assert.equal(catalogPolicy(code), policy);
      const result = applyUnknownPolicy({
        bindings: [actionBinding({ symbol: code })],
        reasons: [createReason(code, { evidenceClass: "synthetic" })],
      });
      assert.ok(result.summary.unknownReasons.includes(code));
      assert.ok(result.limitations.includes(TAXONOMY[code].limitation));
      if (policy === POLICIES.FORCE_UNKNOWN || TAXONOMY[code].unnamedEscalates) {
        assert.equal(result.summary.nextAction, "unknown");
        assert.equal(result.bindings[0].decision, "unknown");
        assert.deepEqual(result.summary.actionableChanges, []);
      }
    });
  }
});
