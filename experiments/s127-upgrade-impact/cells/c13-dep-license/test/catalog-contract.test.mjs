import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { auditCatalog, loadCatalog } from "../catalog.mjs";
import { evaluateEntry, parseSpdx, SHIPPABLE_DECISIONS } from "../policy.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const catalog = loadCatalog();
const audit = auditCatalog(catalog);

test("catalog audit passes in isolation", () => {
  assert.equal(audit.ok, true, JSON.stringify({
    failures: audit.gate.failures,
    mismatches: audit.liveCaptureMismatches,
    minimal: audit.minimal,
    labelsOk: audit.labelsOk,
  }, null, 2));
});

test("minimal integrator set is recommend", () => {
  assert.deepEqual(audit.minimal.missing, []);
  for (const id of catalog.minimalIntegratorIds) {
    const entry = catalog.entries.find((e) => e.id === id);
    assert.ok(entry, id);
    assert.equal(entry.decision, "recommend");
    const ev = evaluateEntry(entry);
    assert.equal(ev.ok, true, id);
    assert.equal(ev.licenseClass, "allowed");
  }
});

test("no GPL/AGPL/LGPL in recommend or optional", () => {
  for (const entry of catalog.entries) {
    if (!SHIPPABLE_DECISIONS.includes(entry.decision)) continue;
    const ev = evaluateEntry(entry);
    assert.equal(ev.licenseClass, "allowed", entry.id);
    const expr = entry.effectiveSpdx ?? entry.licenseSpdx;
    const parsed = parseSpdx(expr);
    for (const id of parsed.identifiers) {
      assert.equal(
        /^(AGPL|GPL|LGPL)(-|$)/i.test(id) && ev.chosenLicense !== "MIT" && !parsed.reasons.includes("dual-license-choose-permissive"),
        false,
        `${entry.id} leaked ${id}`,
      );
    }
    if (ev.chosenLicense) {
      assert.match(ev.chosenLicense, /^(MIT|MIT-0|Apache-2.0|ISC|BSD-2-Clause|BSD-3-Clause|0BSD|Unlicense|CC0-1.0|BlueOak-1.0.0)$/);
    }
  }
});

test("synthetic GPL fixtures are do_not_add", () => {
  const gpl = catalog.entries.find((e) => e.id === "synthetic-gpl-parser");
  const and = catalog.entries.find((e) => e.id === "synthetic-agpl-and-mit");
  const tiny = catalog.entries.find((e) => e.id === "tinymce");
  assert.equal(gpl.decision, "do_not_add");
  assert.equal(evaluateEntry(gpl).licenseClass, "denied");
  assert.equal(and.decision, "do_not_add");
  assert.equal(evaluateEntry(and).licenseClass, "denied");
  assert.equal(tiny.decision, "do_not_add");
  assert.equal(evaluateEntry(tiny).licenseClass, "denied");
});

test("regex-as-full-TS is not recommended", () => {
  const entry = catalog.entries.find((e) => e.id === "synthetic-regex-full-ts");
  assert.equal(entry.decision, "do_not_add");
  assert.equal(entry.claimsFullTsViaRegex, true);
  assert.equal(evaluateEntry(entry).ok, true);
});

test("es-module-lexer is the JS import parser to reuse", () => {
  const entry = catalog.entries.find((e) => e.id === "es-module-lexer");
  assert.equal(entry.decision, "recommend");
  assert.equal(entry.licenseSpdx, "MIT");
  assert.equal(entry.dependencyCount, 0);
  assert.match(entry.whyBetterThanRegex, /false-positives/);
  assert.match(entry.tsLimits, /unknown/i);
});

test("live-capture LICENSE files exist for vendored recommend/optional parsers", () => {
  const keep = [
    "es-module-lexer.LICENSE",
    "cjs-module-lexer.LICENSE",
    "acorn.LICENSE",
    "meriyah.LICENSE.md",
    "semver.LICENSE",
    "yaml.LICENSE",
    "jsonc-parser.LICENSE.md",
  ];
  const licDir = join(HERE, "../fixtures/live-capture/licenses");
  for (const file of keep) {
    const text = readFileSync(join(licDir, file), "utf8");
    assert.ok(/MIT|ISC|Permission to use/i.test(text), file);
    assert.equal(/GNU GENERAL PUBLIC LICENSE/i.test(text), false, file);
  }
});

test("tinymce captured license file is GPL-or-commercial, not shipped as reuse", () => {
  const text = readFileSync(
    join(HERE, "../fixtures/live-capture/licenses/tinymce.LICENSE.md"),
    "utf8",
  );
  assert.match(text, /GNU General Public License Version 2 or later/);
  const entry = catalog.entries.find((e) => e.id === "tinymce");
  assert.equal(entry.decision, "do_not_add");
});

test("gifsicle demonstrates MIT field + postinstall is still rejected", () => {
  const entry = catalog.entries.find((e) => e.id === "gifsicle");
  assert.equal(entry.licenseSpdx, "MIT");
  assert.equal(entry.hasInstallScript, true);
  assert.equal(entry.decision, "do_not_add");
  assert.equal(evaluateEntry(entry).ok, true);
});

test("typescript and oxc are allowed licenses but do_not_add", () => {
  for (const id of ["typescript", "oxc-parser"]) {
    const entry = catalog.entries.find((e) => e.id === id);
    assert.equal(evaluateEntry(entry).licenseClass, "allowed");
    assert.equal(entry.decision, "do_not_add");
    assert.equal(entry.nativeBindingsFarm, true);
  }
});

test("every entry has a provenance label fixture|live-capture|synthetic", () => {
  for (const entry of catalog.entries) {
    assert.ok(["fixture", "live-capture", "synthetic"].includes(entry.provenance.label), entry.id);
  }
});

test("pick-one AST: acorn and meriyah are optional, neither required", () => {
  const acorn = catalog.entries.find((e) => e.id === "acorn");
  const meriyah = catalog.entries.find((e) => e.id === "meriyah");
  assert.equal(acorn.decision, "optional");
  assert.equal(meriyah.decision, "optional");
  assert.ok(catalog.pickOneAst.includes("acorn"));
  assert.ok(catalog.pickOneAst.includes("meriyah"));
});
