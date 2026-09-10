import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { bindUsageToDiff } from "../lib/bind.mjs";
import { sha256File } from "../lib/hash.mjs";
import { buildCaseCPacket, loadProvenance, PACKAGE_NAME } from "../lib/packet.mjs";
import { describePackaging } from "../lib/packaging.mjs";
import { scanJsExports } from "../lib/scan-exports.mjs";
import { FIXTURES, REQUIRED_PACKET_FIELDS } from "./helpers.mjs";

const EXPECTED = JSON.parse(readFileSync(join(FIXTURES, "expected-exports.json"), "utf8"));
const CASE = JSON.parse(readFileSync(join(FIXTURES, "case.json"), "utf8"));

function binding(packet, symbol) {
  return packet.bindings.find((b) => b.symbol === symbol);
}

test("provenance sha256 matches stored tarballs and extracted entrypoints", () => {
  const prov = loadProvenance();
  assert.equal(prov.package, "ms");
  assert.equal(prov.paidDemand, false);
  assert.equal(prov.priceInvoked, false);
  const byId = Object.fromEntries(prov.artifacts.map((a) => [a.id, a]));
  assert.equal(byId["tarball-old"].label, "live-capture");
  assert.equal(byId["tarball-new"].label, "live-capture");
  assert.equal(byId["extracted-old-js"].label, "fixture");
  assert.equal(byId["extracted-new-esm"].label, "fixture");
  assert.equal(sha256File(join(FIXTURES, "tarballs/ms-2.1.3.tgz")), byId["tarball-old"].contentSha256);
  assert.equal(sha256File(join(FIXTURES, "tarballs/ms-3.0.0-beta.2.tgz")), byId["tarball-new"].contentSha256);
  assert.equal(
    sha256File(join(FIXTURES, "extracted/ms-2.1.3/package/index.js")),
    byId["extracted-old-js"].contentSha256,
  );
  assert.equal(
    sha256File(join(FIXTURES, "extracted/ms-3.0.0-beta.2/package/lib/index.mjs")),
    byId["extracted-new-esm"].contentSha256,
  );
  assert.equal(
    sha256File(join(FIXTURES, "extracted/ms-3.0.0-beta.2/package/lib/index.cjs")),
    byId["extracted-new-cjs"].contentSha256,
  );
});

test("extracted JS matches tar -xOf of the live-capture tarball (no npm install)", () => {
  const pairs = [
    ["2.1.3", "package/index.js", "extracted/ms-2.1.3/package/index.js"],
    ["3.0.0-beta.2", "package/lib/index.mjs", "extracted/ms-3.0.0-beta.2/package/lib/index.mjs"],
    ["3.0.0-beta.2", "package/lib/index.cjs", "extracted/ms-3.0.0-beta.2/package/lib/index.cjs"],
  ];
  for (const [ver, member, frozenRel] of pairs) {
    const tarball = join(FIXTURES, "tarballs", `ms-${ver}.tgz`);
    const extracted = execFileSync("tar", ["--force-local", "-xOf", tarball, member]);
    const frozen = readFileSync(join(FIXTURES, frozenRel));
    assert.equal(extracted.equals(frozen), true);
  }
});

test("packaging on the new side is dual CJS/ESM, not string exports", () => {
  const oldPkg = JSON.parse(readFileSync(join(FIXTURES, "extracted/ms-2.1.3/package/package.json"), "utf8"));
  const newPkg = JSON.parse(readFileSync(join(FIXTURES, "extracted/ms-3.0.0-beta.2/package/package.json"), "utf8"));
  const oldP = describePackaging(oldPkg);
  const newP = describePackaging(newPkg);
  assert.equal(oldP.moduleType, "cjs-or-unspecified");
  assert.equal(oldP.hasExports, false);
  assert.equal(oldP.dualCjsEsm, false);
  assert.equal(oldP.exportsShape, "absent");
  assert.equal(newP.moduleType, "esm");
  assert.equal(newP.hasExports, true);
  assert.equal(newP.dualCjsEsm, true);
  assert.equal(newP.exportsShape, "top-level-import-require");
  assert.notEqual(newP.exportsShape, "string");
  assert.deepEqual(newP.subpaths, []);
});

test("compiled default exports match the fixture oracle; no named removals", () => {
  const oldJs = readFileSync(join(FIXTURES, "extracted/ms-2.1.3/package/index.js"), "utf8");
  const newEsm = readFileSync(join(FIXTURES, "extracted/ms-3.0.0-beta.2/package/lib/index.mjs"), "utf8");
  const newCjs = readFileSync(join(FIXTURES, "extracted/ms-3.0.0-beta.2/package/lib/index.cjs"), "utf8");
  const oldScan = scanJsExports(oldJs, { formatHint: "cjs" });
  const esmScan = scanJsExports(newEsm, { formatHint: "esm" });
  const cjsScan = scanJsExports(newCjs, { formatHint: "cjs" });
  assert.equal(oldScan.default, EXPECTED.runtime["2.1.3"].cjs.default);
  assert.deepEqual(oldScan.named, EXPECTED.runtime["2.1.3"].cjs.named);
  assert.equal(esmScan.default, EXPECTED.runtime["3.0.0-beta.2"].esm.default);
  assert.deepEqual(esmScan.named, EXPECTED.runtime["3.0.0-beta.2"].esm.named);
  assert.equal(cjsScan.default, EXPECTED.runtime["3.0.0-beta.2"].cjs.default);
  assert.deepEqual(cjsScan.named, EXPECTED.runtime["3.0.0-beta.2"].cjs.named);
});

test("primary caller: used default is no_action; newer version is not a break", () => {
  const packet = buildCaseCPacket();
  for (const field of REQUIRED_PACKET_FIELDS) assert.ok(field in packet, field);
  assert.equal(packet.schema, "s127.upgrade-impact.packet.v1");
  assert.equal(packet.dependency.name, PACKAGE_NAME);
  assert.equal(packet.dependency.oldVersion, "2.1.3");
  assert.equal(packet.dependency.newVersion, "3.0.0-beta.2");
  assert.notEqual(packet.dependency.name, "path-to-regexp");
  assert.notEqual(packet.dependency.name, "cookie");
  assert.equal(packet.caller.evidenceClass, "fixture");
  assert.equal(packet.usage.dynamicImport, false);
  assert.equal(packet.usage.runtimeDefault, true);
  assert.deepEqual(packet.exportDiff.removed, CASE.expect["exportDiff.removed"]);
  assert.deepEqual(packet.exportDiff.added, CASE.expect["exportDiff.added"]);
  assert.deepEqual(packet.exportDiff.kept, CASE.expect["exportDiff.kept"]);
  assert.equal(packet.summary.nextAction, "no_action");
  assert.deepEqual(packet.summary.actionableChanges, []);
  const def = binding(packet, "default");
  assert.equal(def.used, true);
  assert.equal(def.changeKind, "unchanged");
  assert.equal(def.decision, "no_action");
  assert.equal(packet.commercial.paidDemand, false);
  assert.equal(packet.packaging.dualCjsEsmGained, true);
});

test("CJS require caller is also no_action (dual require condition)", () => {
  const packet = buildCaseCPacket({ callerRel: "caller/src/delay.cjs" });
  assert.equal(packet.summary.nextAction, "no_action");
  const def = binding(packet, "default");
  assert.equal(def.used, true);
  assert.equal(def.decision, "no_action");
});

test("dynamic import caller is unknown for that surface", () => {
  const packet = buildCaseCPacket({ callerRel: "caller/src/dynamic-import.mjs" });
  assert.equal(packet.usage.dynamicImport, true);
  assert.equal(packet.summary.nextAction, "unknown");
  const dyn = binding(packet, "<dynamic>");
  assert.equal(dyn.decision, "unknown");
});

test("same-version no_action; missing source unknown; unused added is no_action", () => {
  const same = buildCaseCPacket({ sameVersion: true });
  assert.equal(same.summary.nextAction, "no_action");
  const missing = buildCaseCPacket({ missingSource: true });
  assert.equal(missing.summary.nextAction, "unknown");
  const unused = bindUsageToDiff({
    usage: { symbols: [], runtimeNamed: [], runtimeDefault: false, dynamicImport: false },
    exportDiff: { added: ["parse"], removed: [], renamed: [], signatureChanged: [], kept: ["default"] },
  });
  assert.equal(unused.summary.nextAction, "no_action");
  assert.equal(unused.bindings.find((b) => b.symbol === "parse").decision, "no_action");
});
