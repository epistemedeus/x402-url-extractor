import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { bindUsageToDiff } from "../lib/bind.mjs";
import { sha256File } from "../lib/hash.mjs";
import { buildCaseBPacket, loadProvenance } from "../lib/packet.mjs";
import { describePackaging } from "../lib/packaging.mjs";
import { scanJsNamedExports, scanDtsDeclareFunctions } from "../lib/scan-exports.mjs";
import { EVIDENCE, FIXTURES, REQUIRED_PACKET_FIELDS } from "./helpers.mjs";

const S122_PACKAGES = new Set(["vercel", "@anthropic-ai/claude-code"]);
const EXPECTED = JSON.parse(readFileSync(join(FIXTURES, "expected-exports.json"), "utf8"));

function binding(packet, symbol) {
  return packet.bindings.find((b) => b.symbol === symbol);
}

test("provenance sha256 matches evidence tarballs and extracted entrypoints", () => {
  const prov = loadProvenance();
  assert.equal(prov.package, "cookie");
  assert.equal(prov.paidDemand, false);
  const byId = Object.fromEntries(prov.artifacts.map((a) => [a.id, a]));
  assert.equal(byId["tarball-old"].label, "live-capture");
  assert.equal(byId["tarball-new"].label, "live-capture");
  assert.equal(byId["extracted-old-js"].label, "fixture");
  assert.equal(sha256File(join(EVIDENCE, "cookie-1.1.1.tgz")), byId["tarball-old"].contentSha256);
  assert.equal(sha256File(join(EVIDENCE, "cookie-2.0.1.tgz")), byId["tarball-new"].contentSha256);
  assert.equal(
    sha256File(join(FIXTURES, "extracted/cookie-1.1.1/dist/index.js")),
    byId["extracted-old-js"].contentSha256,
  );
  assert.equal(
    sha256File(join(FIXTURES, "extracted/cookie-2.0.1/dist/index.js")),
    byId["extracted-new-js"].contentSha256,
  );
});

test("extracted JS matches tar -xOf of the live-capture tarball (no npm install)", () => {
  for (const ver of ["1.1.1", "2.0.1"]) {
    const tarball = join(EVIDENCE, `cookie-${ver}.tgz`);
    const extracted = execFileSync("tar", ["-xOf", tarball, "package/dist/index.js"]);
    const frozen = readFileSync(join(FIXTURES, "extracted", `cookie-${ver}`, "dist/index.js"));
    assert.equal(extracted.equals(frozen), true);
  }
});

test("packaging on the new side is ESM exports, not single main CJS", () => {
  const oldPkg = JSON.parse(readFileSync(join(FIXTURES, "extracted/cookie-1.1.1/package.json"), "utf8"));
  const newPkg = JSON.parse(readFileSync(join(FIXTURES, "extracted/cookie-2.0.1/package.json"), "utf8"));
  const oldP = describePackaging(oldPkg);
  const newP = describePackaging(newPkg);
  assert.equal(oldP.moduleType, "cjs-or-unspecified");
  assert.equal(oldP.hasMain, true);
  assert.equal(oldP.hasExports, false);
  assert.equal(oldP.hasTypesField, true);
  assert.equal(newP.moduleType, "esm");
  assert.equal(newP.hasExports, true);
  assert.equal(newP.exportsShape, "string");
  assert.equal(newP.hasMain, false);
  assert.notEqual(newP.exportsShape, "absent");
});

test("compiled named exports match the fixture oracle", () => {
  const oldJs = readFileSync(join(FIXTURES, "extracted/cookie-1.1.1/dist/index.js"), "utf8");
  const newJs = readFileSync(join(FIXTURES, "extracted/cookie-2.0.1/dist/index.js"), "utf8");
  const oldDts = readFileSync(join(FIXTURES, "extracted/cookie-1.1.1/dist/index.d.ts"), "utf8");
  const newDts = readFileSync(join(FIXTURES, "extracted/cookie-2.0.1/dist/index.d.ts"), "utf8");
  assert.deepEqual(scanJsNamedExports(oldJs, { formatHint: "cjs" }).names, EXPECTED.runtimeNamed["1.1.1"]);
  assert.deepEqual(scanJsNamedExports(newJs, { formatHint: "esm" }).names, EXPECTED.runtimeNamed["2.0.1"]);
  assert.deepEqual(scanDtsDeclareFunctions(oldDts).overloadCounts, EXPECTED.dtsDeclareFunctionOverloads["1.1.1"]);
  assert.deepEqual(scanDtsDeclareFunctions(newDts).overloadCounts, EXPECTED.dtsDeclareFunctionOverloads["2.0.1"]);
});

test("primary caller: used parse is action; unused serialize is no_action", () => {
  const packet = buildCaseBPacket();
  assert.equal(packet.schema, "s127.upgrade-impact.packet.v1");
  assert.equal(packet.dependency.name, "cookie");
  assert.equal(packet.dependency.oldVersion, "1.1.1");
  assert.equal(packet.dependency.newVersion, "2.0.1");
  assert.ok(!S122_PACKAGES.has(packet.dependency.name));
  assert.notEqual(packet.dependency.name, "path-to-regexp");
  assert.deepEqual(packet.exportDiff.removed, ["parse", "serialize"]);
  assert.deepEqual(packet.exportDiff.added, []);
  assert.equal(packet.usage.dynamicImport, false);
  assert.deepEqual(packet.usage.runtimeNamed, ["parse"]);

  const parse = binding(packet, "parse");
  const serialize = binding(packet, "serialize");
  const stringifySetCookie = binding(packet, "stringifySetCookie");
  assert.equal(parse.used, true);
  assert.equal(parse.changeKind, "removed");
  assert.equal(parse.decision, "action");
  assert.equal(serialize.used, false);
  assert.equal(serialize.changeKind, "removed");
  assert.equal(serialize.decision, "no_action");
  assert.equal(stringifySetCookie.used, false);
  assert.equal(stringifySetCookie.changeKind, "signatureChanged");
  assert.equal(stringifySetCookie.decision, "no_action");
  assert.equal(packet.summary.nextAction, "action");
  assert.deepEqual(packet.summary.actionableChanges, ["parse"]);
  assert.equal(packet.commercial.paidDemand, false);
  assert.equal(packet.commercial.priceInvoked, false);
});

test("packet has required contract fields", () => {
  const packet = buildCaseBPacket();
  for (const field of REQUIRED_PACKET_FIELDS) {
    assert.ok(field in packet, `missing ${field}`);
  }
  assert.ok(Array.isArray(packet.provenance));
  assert.ok(packet.provenance.length >= 6);
  assert.ok(packet.caller.manifestPath.endsWith("caller/package.json"));
  assert.equal(packet.caller.evidenceClass, "fixture");
  assert.equal(packet.prior.ref, null);
  assert.ok(packet.limitations.length >= 5);
  assert.ok(packet.packaging.differsFromSingleMainCjs);
});

test("parseCookie-only caller: newer version alone is not a named-export break", () => {
  const packet = buildCaseBPacket({ callerRel: "caller/src/parse-cookie-only.mjs" });
  assert.deepEqual(packet.usage.runtimeNamed, ["parseCookie"]);
  const used = binding(packet, "parseCookie");
  assert.equal(used.used, true);
  assert.equal(used.changeKind, "unchanged");
  assert.equal(used.decision, "no_action");
  const unusedParse = binding(packet, "parse");
  assert.equal(unusedParse.used, false);
  assert.equal(unusedParse.decision, "no_action");
  assert.equal(packet.summary.nextAction, "no_action");
  assert.deepEqual(packet.summary.actionableChanges, []);
});

test("dynamic import of the package is unknown for that surface", () => {
  const packet = buildCaseBPacket({ callerRel: "caller/src/dynamic-import.mjs" });
  assert.equal(packet.usage.dynamicImport, true);
  assert.equal(packet.summary.nextAction, "unknown");
  assert.ok(packet.summary.unknownReasons.includes("dynamic_import_of_package"));
  for (const b of packet.bindings.filter((row) => row.used)) {
    assert.equal(b.decision, "unknown");
  }
});

test("same-version compare is no_action", () => {
  const packet = buildCaseBPacket({ sameVersion: true, newVersion: "2.0.1" });
  assert.equal(packet.dependency.oldVersion, "2.0.1");
  assert.equal(packet.dependency.newVersion, "2.0.1");
  assert.equal(packet.summary.nextAction, "no_action");
  assert.deepEqual(packet.summary.actionableChanges, []);
});

test("missing extracted source is unknown, not action", () => {
  const packet = buildCaseBPacket({
    oldDir: join(FIXTURES, "extracted", "cookie-missing"),
    missingSource: false,
  });
  assert.equal(packet.summary.nextAction, "unknown");
  assert.ok(packet.summary.unknownReasons.includes("missing_or_partial_source"));
  assert.deepEqual(packet.summary.actionableChanges, []);
});

test("bind helper: unused removal is never a caller defect", () => {
  const result = bindUsageToDiff({
    usage: { runtimeNamed: ["parseCookie"], dynamicImport: false, symbols: [] },
    exportDiff: { added: [], removed: ["serialize"], renamed: [], signatureChanged: [] },
  });
  const serialize = result.bindings.find((b) => b.symbol === "serialize");
  assert.equal(serialize.used, false);
  assert.equal(serialize.decision, "no_action");
  assert.equal(result.summary.nextAction, "no_action");
});

test("evidence files exist and GitHub changelog is corroboration only", () => {
  assert.equal(existsSync(join(EVIDENCE, "NOTES.md")), true);
  assert.equal(existsSync(join(EVIDENCE, "CAPTURED_AT_UTC.txt")), true);
  const releases = JSON.parse(readFileSync(join(FIXTURES, "github/releases-slim.json"), "utf8"));
  const v2 = releases.releases.find((r) => r.tag_name === "v2.0.0");
  assert.match(v2.body, /parseCookie/);
  assert.match(v2.body, /stringify/);
  const packet = buildCaseBPacket();
  assert.ok(packet.exportDiff.removed.includes("serialize"));
  assert.ok(!packet.exportDiff.removed.includes("stringify"));
});
