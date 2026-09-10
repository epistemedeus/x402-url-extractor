import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  STANDARD_CONDITION_SETS,
  classifyCondition,
  classifyExportsShape,
  diffExportsMap,
  diffPackageDirs,
  flattenExports,
  normalizeExports,
  readManifest,
  resolveExport,
  run,
  toExportDiffOverlay,
  EXPORT_ENTRY_CAP,
} from "../src/exports-map.mjs";
import { isolationSelfCheck } from "../src/isolation-check.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CELL = join(HERE, "..");
const SYN = join(CELL, "fixtures", "synthetic");
const LIVE = join(CELL, "fixtures", "live-capture");
const CASES = join(SYN, "cases");

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function pkg(...parts) {
  return join(SYN, "packages", ...parts);
}

function getExpect(obj, dotted) {
  return dotted.split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

describe("isolation", () => {
  it("lives only under cells/c17-exports-map", () => {
    const result = isolationSelfCheck();
    assert.equal(result.ok, true, result.reasons.join(", "));
    assert.equal(result.cell, "c17-exports-map");
    assert.equal(result.packSrcUntouchedByThisCell, true);
    assert.equal(result.s124s125Untouched, true);
    assert.ok(result.ownedFiles.includes("src/exports-map.mjs"));
  });
});

describe("flatten / normalize", () => {
  it("treats string exports as { \".\": string }", () => {
    const n = normalizeExports("./index.js");
    assert.equal(n.ok, true);
    assert.deepEqual(n.map, { ".": "./index.js" });
    const flat = flattenExports("./index.js");
    assert.equal(flat.coverage, "full");
    assert.equal(flat.entries.length, 1);
    assert.equal(flat.entries[0].symbol, "exports:.");
    assert.equal(flat.entries[0].target, "./index.js");
  });

  it("treats top-level condition maps as the \".\" subpath", () => {
    const flat = flattenExports({
      import: { types: "./lexer.d.mts", default: "./dist/lexer.mjs" },
      default: "./lexer.js",
    });
    assert.equal(flat.coverage, "full");
    const symbols = flat.entries.map((e) => e.symbol).sort();
    assert.deepEqual(symbols, [
      "exports:.:default",
      "exports:.:import>default",
      "exports:.:import>types",
    ]);
  });

  it("rejects mixed subpath and condition keys", () => {
    const shape = classifyExportsShape({ ".": "./index.js", import: "./esm.js" });
    assert.equal(shape.shape, "invalid");
    const flat = flattenExports({ ".": "./index.js", import: "./esm.js" });
    assert.equal(flat.coverage, "unknown");
    assert.ok(flat.unknownReasons.includes("invalid_exports_map"));
  });

  it("marks wildcards as partial coverage", () => {
    const flat = flattenExports({ ".": "./index.js", "./features/*": "./features/*.js" });
    assert.equal(flat.coverage, "partial");
    assert.ok(flat.unknownReasons.includes("exports_wildcard_subpath"));
  });

  it("caps oversize maps as partial", () => {
    const big = {};
    for (let i = 0; i < EXPORT_ENTRY_CAP + 5; i += 1) {
      big[`./k${i}`] = `./k${i}.js`;
    }
    const flat = flattenExports(big);
    assert.equal(flat.coverage, "partial");
    assert.equal(flat.stats.truncated, true);
    assert.ok(flat.unknownReasons.includes("exports_map_oversize"));
  });

  it("records null targets as blocked", () => {
    const flat = flattenExports({ ".": "./index.js", "./secret": null });
    const secret = flat.entries.find((e) => e.subpath === "./secret");
    assert.equal(secret.blocked, true);
    assert.equal(secret.target, null);
  });
});

describe("resolveExport (Node key-order)", () => {
  it("matches first matching condition, with default last-resort", () => {
    const exportsField = {
      ".": {
        node: "./node.js",
        browser: "./browser.js",
        default: "./index.js",
      },
    };
    const node = resolveExport(exportsField, ".", new Set(["node", "import"]));
    const browser = resolveExport(exportsField, ".", new Set(["browser", "import"]));
    const other = resolveExport(exportsField, ".", new Set(["deno", "import"]));
    assert.equal(node.target, "./node.js");
    assert.equal(browser.target, "./browser.js");
    assert.equal(other.target, "./index.js");
  });

  it("uses fallback arrays in order (first string wins for any request)", () => {
    const exportsField = {
      ".": ["./cjs.js", { import: "./esm.js" }],
    };
    const nodeImport = resolveExport(exportsField, ".", new Set(["node", "import"]));
    assert.equal(nodeImport.ok, true);
    assert.equal(nodeImport.target, "./cjs.js");
  });

  it("does not expand wildcard subpaths", () => {
    const result = resolveExport({ "./features/*": "./features/*.js" }, "./features/a", new Set(["import"]));
    assert.equal(result.ok, false);
    assert.equal(result.reason, "exports_wildcard_subpath");
  });
});

describe("classifyCondition", () => {
  it("labels types / browser / custom as environment-dependent", () => {
    assert.equal(classifyCondition("default").environmentDependent, false);
    assert.equal(classifyCondition("types").reason, "typescript_types_condition");
    assert.equal(classifyCondition("browser").reason, "runtime_environment_dependent");
    assert.equal(classifyCondition("module").reason, "bundler_module_condition");
    assert.equal(classifyCondition("my-bundler").reason, "custom_exports_condition");
  });
});

describe("synthetic case files", () => {
  const ids = loadJson(join(CASES, "index.json")).ids;
  for (const id of ids) {
    it(id, () => {
      const spec = loadJson(join(CASES, `${id}.json`));
      assert.equal(spec.label, "synthetic");
      const diff = diffPackageDirs(join(SYN, spec.old), join(SYN, spec.new));
      assert.equal(diff.ok, true);
      assert.notEqual(diff.decisionHint, "action");
      const expect = spec.expect;
      for (const [key, value] of Object.entries(expect)) {
        if (key === "unknownReasonsIncludes") {
          for (const reason of value) {
            assert.ok(
              diff.unknownReasons.includes(reason),
              `${id} missing unknownReason ${reason}; have ${diff.unknownReasons.join(",")}`,
            );
          }
          continue;
        }
        if (key === "addedCount") {
          assert.equal(diff.added.length, value, `${id} addedCount`);
          continue;
        }
        if (key === "removedCount") {
          assert.equal(diff.removed.length, value, `${id} removedCount`);
          continue;
        }
        if (key === "signatureChangedCount") {
          assert.equal(diff.signatureChanged.length, value, `${id} signatureChangedCount`);
          continue;
        }
        const actual = getExpect(diff, key);
        assert.deepEqual(actual, value, `${id} ${key}`);
      }
      const overlay = toExportDiffOverlay(diff);
      assert.deepEqual(overlay.summary.actionableChanges, []);
      assert.notEqual(overlay.summary.nextAction, "action");
      assert.equal(overlay.exportDiff.exportsMap.cell, "c17-exports-map");
    });
  }
});

describe("main vs exports flags", () => {
  it("exports-changed-main-stable lists extra subpath and diverging import/require", () => {
    const diff = diffPackageDirs(
      pkg("dual-surface", "1.0.0"),
      pkg("dual-surface", "2.0.0-exports-changed-main-stable"),
    );
    assert.equal(diff.mainStableExportsChanged, true);
    assert.ok(diff.subpaths.added.includes("./extra"));
    assert.equal(diff.resolved.old["node-import"]["."].target, "./index.js");
    assert.equal(diff.resolved.new["node-import"]["."].target, "./esm.js");
    assert.equal(diff.resolved.new["node-require"]["."].target, "./cjs.cjs");
    assert.equal(diff.legacy.old.main, "./index.js");
    assert.equal(diff.legacy.new.main, "./index.js");
  });

  it("main-changed-exports-stable keeps Node runtime resolution on ./index.js", () => {
    const diff = diffPackageDirs(
      pkg("dual-surface", "1.0.0"),
      pkg("dual-surface", "2.0.0-main-changed-exports-stable"),
    );
    assert.equal(diff.exportsStableMainChanged, true);
    assert.equal(diff.resolved.old["node-import"]["."].target, "./index.js");
    assert.equal(diff.resolved.new["node-import"]["."].target, "./index.js");
    assert.equal(diff.legacy.old.main, "./index.js");
    assert.equal(diff.legacy.new.main, "./dist/index.js");
    const mainSig = diff.signatureChanged.find((row) => row.symbol === "legacy:main");
    assert.ok(mainSig);
    assert.equal(mainSig.from, "./index.js");
    assert.equal(mainSig.to, "./dist/index.js");
  });

  it("types-only does not change node-import / node-require targets", () => {
    const diff = diffPackageDirs(
      pkg("typed-surface", "1.0.0"),
      pkg("typed-surface", "2.0.0-types-only"),
    );
    assert.equal(diff.runtimeResolutionChanged, false);
    assert.equal(diff.resolved.old["node-import"]["."].target, "./index.js");
    assert.equal(diff.resolved.new["node-import"]["."].target, "./index.js");
    const typesSig = diff.signatureChanged.find(
      (row) => row.symbol === "exports:.:types" || row.symbol === "resolve:types-import:.",
    );
    assert.ok(typesSig, JSON.stringify(diff.signatureChanged.map((r) => r.symbol)));
  });
});

describe("run() overlay", () => {
  it("accepts manifests and never emits action", () => {
    const oldManifest = loadJson(join(pkg("dual-surface", "1.0.0"), "package.json"));
    const newManifest = loadJson(
      join(pkg("dual-surface", "2.0.0-exports-changed-main-stable"), "package.json"),
    );
    const result = run({ oldManifest, newManifest });
    assert.equal(result.overlay.summary.nextAction, "unknown");
    assert.deepEqual(result.overlay.summary.actionableChanges, []);
    assert.equal(result.diff.mainStableExportsChanged, true);
  });

  it("missing manifests stay unknown", () => {
    const result = run({});
    assert.equal(result.overlay.exportDiff.coverage, "unknown");
    assert.equal(result.overlay.summary.nextAction, "unknown");
  });
});

describe("readManifest", () => {
  it("reads synthetic package.json without executing scripts", () => {
    const row = readManifest(pkg("dual-surface", "1.0.0"));
    assert.equal(row.ok, true);
    assert.equal(row.manifest.name, "dual-surface");
  });

  it("missing package.json is unknown", () => {
    const row = readManifest(join(SYN, "packages", "does-not-exist"));
    assert.equal(row.ok, false);
    assert.ok(row.unknownReasons.includes("missing_package_json"));
  });
});

describe("live-capture excerpts (derived from c13 packuments; not a new fetch)", () => {
  it("yaml node vs default diverge; main is the node target", () => {
    const manifest = loadJson(join(LIVE, "yaml@2.9.0.exports.json"));
    assert.equal(manifest.provenance.label, "live-capture");
    assert.equal(manifest.provenance.paidDemand, false);
    const flat = flattenExports(manifest.exports);
    assert.equal(flat.coverage, "full");
    const node = resolveExport(manifest.exports, ".", new Set(["node", "import"]));
    const browser = resolveExport(manifest.exports, ".", new Set(["browser", "import"]));
    assert.equal(node.target, "./dist/index.js");
    assert.equal(browser.target, "./browser/index.js");
    const diff = diffExportsMap(manifest, manifest);
    assert.equal(diff.decisionHint, "no_action");
    assert.equal(diff.environmentDependent, true);
    assert.ok(diff.unknownReasons.includes("runtime_environment_dependent"));
  });

  it("acorn fallback array: import vs default", () => {
    const manifest = loadJson(join(LIVE, "acorn@8.18.0.exports.json"));
    const nodeImport = resolveExport(manifest.exports, ".", new Set(["node", "import"]));
    const nodeRequire = resolveExport(manifest.exports, ".", new Set(["node", "require"]));
    assert.equal(nodeImport.target, "./dist/acorn.mjs");
    assert.equal(nodeRequire.target, "./dist/acorn.js");
  });

  it("cjs-module-lexer sugar: no \".\" key, import vs default", () => {
    const manifest = loadJson(join(LIVE, "cjs-module-lexer@2.2.1.exports.json"));
    assert.equal(classifyExportsShape(manifest.exports).shape, "condition_map");
    const nodeImport = resolveExport(manifest.exports, ".", new Set(["node", "import"]));
    const nodeRequire = resolveExport(manifest.exports, ".", new Set(["node", "require"]));
    assert.equal(nodeImport.target, "./dist/lexer.mjs");
    assert.equal(nodeRequire.target, "./lexer.js");
  });

  it("es-module-lexer subpaths and bundler module condition", () => {
    const manifest = loadJson(join(LIVE, "es-module-lexer@3.0.2.exports.json"));
    const flat = flattenExports(manifest.exports);
    const subpaths = [...new Set(flat.entries.map((e) => e.subpath))].sort();
    assert.deepEqual(subpaths, [".", "./js", "./minimal", "./minimal/js"]);
    assert.ok(flat.entries.some((e) => e.conditionPath.includes("module")));
    const js = resolveExport(manifest.exports, "./js", new Set(["import"]));
    assert.equal(js.target, "./dist/lexer.asm.js");
  });

  it("espree nested types.import vs runtime import", () => {
    const manifest = loadJson(join(LIVE, "espree@11.2.0.exports.json"));
    const typesImport = resolveExport(manifest.exports, ".", new Set(["types", "import"]));
    const nodeImport = resolveExport(manifest.exports, ".", new Set(["node", "import"]));
    assert.equal(typesImport.target, "./dist/espree.d.ts");
    assert.equal(nodeImport.target, "./espree.js");
  });

  it("every live-capture excerpt is labeled and unpaid", () => {
    const files = readdirSync(LIVE).filter((name) => name.endsWith(".exports.json"));
    assert.ok(files.length >= 5);
    for (const name of files) {
      const body = loadJson(join(LIVE, name));
      assert.equal(body.provenance.label, "live-capture");
      assert.equal(body.provenance.paidDemand, false);
      assert.ok(body.provenance.url);
      assert.ok(body.provenance.retrievedAt);
      assert.ok(body.provenance.packumentContentSha256);
    }
  });
});

describe("contract rules", () => {
  it("identical maps including version bump are no_action", () => {
    const a = { name: "x", version: "1.0.0", main: "./i.js", exports: { ".": "./i.js" } };
    const b = { name: "x", version: "9.9.9", main: "./i.js", exports: { ".": "./i.js" } };
    const diff = diffExportsMap(a, b);
    assert.equal(diff.decisionHint, "no_action");
    assert.equal(diff.mapStructureChanged, false);
  });

  it("does not guess renamed subpaths", () => {
    const oldM = { exports: { ".": "./i.js", "./a": "./a.js" } };
    const newM = { exports: { ".": "./i.js", "./b": "./b.js" } };
    const diff = diffExportsMap(oldM, newM);
    assert.deepEqual(diff.renamed, []);
    assert.ok(diff.subpaths.removed.includes("./a"));
    assert.ok(diff.subpaths.added.includes("./b"));
    assert.notEqual(diff.decisionHint, "action");
  });

  it("STANDARD_CONDITION_SETS is a closed probe list, not a caller claim", () => {
    assert.ok("node-import" in STANDARD_CONDITION_SETS);
    assert.ok("browser-import" in STANDARD_CONDITION_SETS);
    assert.ok(!STANDARD_CONDITION_SETS["node-import"].includes("default"));
  });

  it("typesVersions presence stays unknown", () => {
    const oldM = { main: "./i.js", exports: { ".": "./i.js" } };
    const newM = { main: "./i.js", exports: { ".": "./i.js" }, typesVersions: { ">=4.0": { "*": ["*"] } } };
    const diff = diffExportsMap(oldM, newM);
    assert.equal(diff.decisionHint, "unknown");
    assert.ok(diff.unknownReasons.includes("typesVersions_unexpanded"));
  });
});
