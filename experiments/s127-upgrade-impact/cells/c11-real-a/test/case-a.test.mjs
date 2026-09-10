import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { PATHS } from "../lib/paths.mjs";
import { sha1File, sha256File } from "../lib/hash.mjs";
import { bindUsageToDiff } from "../lib/bind.mjs";
import { diffNamedExports } from "../lib/export-diff.mjs";
import {
  buildPacket,
  FROZEN_CLOCK,
  inventoryPair,
  loadOfficialPair,
  NEW_VERSION,
  OLD_VERSION,
  PACKAGE_NAME,
  SCHEMA,
  SIGNATURE_EVIDENCE,
} from "../lib/packet.mjs";

const provenance = JSON.parse(readFileSync(PATHS.provenance, "utf8"));
const expected = JSON.parse(
  readFileSync(path.join(PATHS.inventories, "expected-exports.json"), "utf8"),
);

describe("c11-real-a provenance", () => {
  it("stores official tarballs whose sha1 matches npm dist.shasum", () => {
    const oldDoc = JSON.parse(readFileSync(PATHS.oldVersionDoc, "utf8"));
    const newDoc = JSON.parse(readFileSync(PATHS.newVersionDoc, "utf8"));
    assert.equal(sha1File(PATHS.oldTarball), oldDoc.dist.shasum);
    assert.equal(sha1File(PATHS.newTarball), newDoc.dist.shasum);
    assert.equal(oldDoc.dist.shasum, provenance.artifacts.oldTarball.distShasum);
    assert.equal(newDoc.dist.shasum, provenance.artifacts.newTarball.distShasum);
  });

  it("matches frozen sha256 for live-captured bytes", () => {
    assert.equal(
      sha256File(PATHS.oldTarball),
      provenance.artifacts.oldTarball.contentSha256,
    );
    assert.equal(
      sha256File(PATHS.newTarball),
      provenance.artifacts.newTarball.contentSha256,
    );
    assert.equal(
      sha256File(PATHS.oldVersionDoc),
      provenance.artifacts.oldVersionDoc.contentSha256,
    );
    assert.equal(
      sha256File(PATHS.newVersionDoc),
      provenance.artifacts.newVersionDoc.contentSha256,
    );
    assert.equal(
      sha256File(PATHS.packumentSlim),
      provenance.artifacts.packumentSlim.contentSha256,
    );
  });

  it("extracted entries match tarball listing and were not npm-installed", () => {
    const listing = execFileSync(
      "tar",
      ["-tzf", PATHS.oldTarball],
      { encoding: "utf8" },
    );
    assert.match(listing, /package\/dist\/index\.js/);
    assert.equal(existsSync(path.join(PATHS.oldExtractRoot, "node_modules")), false);
    assert.equal(existsSync(path.join(PATHS.newExtractRoot, "node_modules")), false);
    const oldPkg = JSON.parse(
      readFileSync(path.join(PATHS.oldExtractRoot, "package.json"), "utf8"),
    );
    const newPkg = JSON.parse(
      readFileSync(path.join(PATHS.newExtractRoot, "package.json"), "utf8"),
    );
    assert.ok(oldPkg.scripts.prepare, "old tarball declares prepare; must not run it");
    assert.ok(newPkg.scripts.prepare, "new tarball declares prepare; must not run it");
    assert.equal(oldPkg.license, "MIT");
    assert.equal(newPkg.license, "MIT");
    assert.equal(oldPkg.version, OLD_VERSION);
    assert.equal(newPkg.version, NEW_VERSION);
  });

  it("labels fixture vs live-capture vs synthetic", () => {
    assert.equal(provenance.artifacts.oldTarball.label, "live-capture");
    assert.equal(provenance.artifacts.oldTarball.replayLabel, "fixture");
    assert.equal(provenance.caller.label, "synthetic");
  });
});

describe("c11-real-a official export surface", () => {
  it("lists CJS named exports from official dist/index.js", () => {
    const pair = loadOfficialPair();
    const inv = inventoryPair(pair);
    assert.deepEqual(inv.oldExports.names, expected.oldNames);
    assert.deepEqual(inv.newExports.names, expected.newNames);
    assert.deepEqual(inv.diff.removed, expected.removed);
    assert.deepEqual(inv.diff.added, expected.added);
    assert.deepEqual(inv.diff.signatureChanged, expected.signatureChangedJsEvident);
    assert.deepEqual(inv.diff.renamed, []);
    assert.equal(inv.quoteFailures.length, 0);
  });

  it("quotes load-bearing JS heads from official files, not changelog text", () => {
    const pair = loadOfficialPair();
    for (const row of SIGNATURE_EVIDENCE) {
      assert.ok(pair.oldSource.includes(row.oldHead), row.oldHead);
      assert.ok(pair.newSource.includes(row.newHead), row.newHead);
      assert.ok(pair.oldSource.includes(row.oldReturnQuote), row.oldReturnQuote);
      assert.ok(pair.newSource.includes(row.newReturnQuote), row.newReturnQuote);
    }
    assert.equal(invParamCount(pair.oldSource, "pathToRegexp"), 3);
    assert.equal(invParamCount(pair.newSource, "pathToRegexp"), 2);
    assert.match(pair.oldDts, /export declare function tokensToFunction/);
    assert.equal(pair.newDts.includes("export declare function tokensToFunction"), false);
    assert.match(pair.oldDts, /export declare function regexpToFunction/);
    assert.equal(pair.newDts.includes("export declare function regexpToFunction"), false);
    assert.match(pair.newDts, /export declare function stringify/);
  });

  it("v8 keeps an internal tokensToFunction that is not exported", () => {
    const pair = loadOfficialPair();
    const inv = inventoryPair(pair);
    assert.ok(inv.newHeads.tokensToFunctionInternal);
    assert.equal(inv.newExports.names.includes("tokensToFunction"), false);
    assert.match(pair.oldSource, /exports\.tokensToFunction = tokensToFunction/);
    assert.equal(/exports\.tokensToFunction\s*=/.test(pair.newSource), false);
  });

  it("new README does not document tokensToFunction; old README does", () => {
    const oldReadme = readFileSync(
      path.join(PATHS.oldExtractRoot, "Readme.md"),
      "utf8",
    );
    const newReadme = readFileSync(
      path.join(PATHS.newExtractRoot, "Readme.md"),
      "utf8",
    );
    assert.match(oldReadme, /tokensToFunction/);
    assert.equal(newReadme.includes("tokensToFunction"), false);
    assert.equal(newReadme.includes("regexpToFunction"), false);
  });
});

describe("c11-real-a caller binding", () => {
  it("builds a contract packet with used removal + unused removal", () => {
    const packet = buildPacket({ clock: FROZEN_CLOCK, createdAt: FROZEN_CLOCK });
    assert.equal(packet.schema, SCHEMA);
    assert.equal(packet.dependency.name, PACKAGE_NAME);
    assert.equal(packet.dependency.oldVersion, OLD_VERSION);
    assert.equal(packet.dependency.newVersion, NEW_VERSION);
    assert.equal(packet.caller.lockfilePath, null);
    assert.equal(packet.usage.dynamicImport, false);
    assert.equal(packet.paidDemand.invented, false);

    const bySymbol = Object.fromEntries(packet.bindings.map((b) => [b.symbol, b]));
    assert.equal(bySymbol.tokensToFunction.used, true);
    assert.equal(bySymbol.tokensToFunction.changeKind, "removed");
    assert.equal(bySymbol.tokensToFunction.decision, "action");

    assert.equal(bySymbol.pathToRegexp.used, true);
    assert.equal(bySymbol.pathToRegexp.changeKind, "signatureChanged");
    assert.equal(bySymbol.pathToRegexp.decision, "action");

    assert.equal(bySymbol.regexpToFunction.imported, true);
    assert.equal(bySymbol.regexpToFunction.used, false);
    assert.equal(bySymbol.regexpToFunction.changeKind, "removed");
    assert.equal(bySymbol.regexpToFunction.decision, "no_action");

    assert.equal(bySymbol.tokensToRegexp.used, false);
    assert.equal(bySymbol.tokensToRegexp.decision, "no_action");

    assert.equal(bySymbol.stringify.changeKind, "added");
    assert.equal(bySymbol.stringify.used, false);
    assert.equal(bySymbol.stringify.decision, "no_action");

    assert.equal(bySymbol.parse.used, false);
    assert.equal(bySymbol.parse.changeKind, "signatureChanged");
    assert.equal(bySymbol.parse.decision, "no_action");

    assert.equal(packet.summary.nextAction, "action");
    assert.deepEqual(packet.summary.actionableChanges.sort(), [
      "pathToRegexp",
      "tokensToFunction",
    ]);
    assert.ok(packet.summary.unusedChanges.includes("regexpToFunction"));
    assert.ok(packet.summary.unusedChanges.includes("stringify"));
    assert.equal(packet.summary.s122Contrast.registryChangelogStyle, "review_changelog");
    assert.equal(packet.summary.s122Contrast.decisionChangedRelativeToChangelog, true);
    assert.equal(
      packet.provenance.oldTarball.contentSha256,
      provenance.artifacts.oldTarball.contentSha256,
    );
    assert.equal(
      packet.provenance.newTarball.contentSha256,
      provenance.artifacts.newTarball.contentSha256,
    );
  });

  it("frozen packet.json matches the builder at the frozen clock", () => {
    const frozen = JSON.parse(readFileSync(PATHS.packetOut, "utf8"));
    const live = buildPacket({ clock: FROZEN_CLOCK, createdAt: FROZEN_CLOCK });
    assert.equal(frozen.schema, SCHEMA);
    assert.equal(frozen.summary.nextAction, live.summary.nextAction);
    assert.deepEqual(frozen.summary.actionableChanges, live.summary.actionableChanges);
    assert.deepEqual(frozen.summary.unusedChanges, live.summary.unusedChanges);
    assert.deepEqual(frozen.bindings, live.bindings);
    assert.deepEqual(frozen.exportDiff.removed, live.exportDiff.removed);
  });

  it("a newer version with only unused export changes is no_action", () => {
    const diff = diffNamedExports({
      oldNames: ["keep"],
      newNames: ["keep", "added"],
      signatureChanged: [],
    });
    const bound = bindUsageToDiff({
      usage: { imports: [{ imported: "keep", local: "keep", specifier: "x", used: true }] },
      diff,
    });
    assert.equal(bound.summary.nextAction, "no_action");
    assert.deepEqual(bound.summary.actionableChanges, []);
    assert.ok(bound.summary.unusedChanges.includes("added"));
  });

  it("same-version is no_action even if names look different in a buggy diff", () => {
    const diff = diffNamedExports({
      oldNames: ["foo"],
      newNames: [],
      signatureChanged: [],
    });
    const bound = bindUsageToDiff({
      usage: { imports: [{ imported: "foo", local: "foo", specifier: "x", used: true }] },
      diff,
      sameVersion: true,
    });
    assert.equal(bound.summary.nextAction, "no_action");
  });

  it("dynamic import of a used changed symbol is unknown, not action", () => {
    const diff = diffNamedExports({
      oldNames: ["foo"],
      newNames: [],
      signatureChanged: [],
    });
    const bound = bindUsageToDiff({
      usage: { imports: [{ imported: "foo", local: "foo", specifier: "x", used: true }] },
      diff,
      dynamicImport: true,
    });
    assert.equal(bound.summary.nextAction, "unknown");
    assert.ok(bound.summary.unknownReasons.includes("dynamic-import"));
  });
});

function invParamCount(source, name) {
  const m = source.match(new RegExp(String.raw`function\s+${name}\s*\(([^)]*)\)`));
  assert.ok(m, `function ${name} head`);
  return m[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean).length;
}
