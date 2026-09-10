import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  COVERAGE,
  DEFAULT_FIXTURE_ROOT,
  KIND,
  LABEL,
  MODE,
  SCHEMA,
  encodePackageNameForRegistryPath,
  loadPackument,
  packumentUrl,
  parsePackumentDocument,
  readPackumentFile,
  selectPair,
  sha256Hex,
} from "../packument.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const CELL = join(here, "..");
const FIXTURES = join(CELL, "fixtures");
const CLOCK = "2026-09-10T12:00:00.000Z";
const SCRIPT_MARKER = join(FIXTURES, "synthetic", "SCRIPT_RAN.marker");

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "c28-packument-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function listen(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  );
  return `http://127.0.0.1:${server.address().port}`;
}

test("default fixture root is the cell fixtures directory", () => {
  assert.equal(DEFAULT_FIXTURE_ROOT, FIXTURES);
});

test("missing clock fails and does not invent Date.now()", async () => {
  const result = await loadPackument({ name: "s127-demo-lib" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "missing_clock");
  assert.equal(result.provenance.retrievedAt, null);
  assert.equal(result.execute, false);
  assert.equal(result.paidDemand, false);
});

test("mode defaults to fixture and never calls fetchImpl", async () => {
  let called = 0;
  const result = await loadPackument({
    name: "s127-demo-lib",
    clock: CLOCK,
    fetchImpl: async () => {
      called += 1;
      throw new Error("should not fetch");
    },
  });
  assert.equal(called, 0);
  assert.equal(result.ok, true);
  assert.equal(result.provenance.mode, MODE.FIXTURE);
  assert.equal(result.provenance.label, LABEL.SYNTHETIC);
  assert.equal(result.kind, KIND.PACKUMENT);
});

test("catalog load extracts versions, dist.tarball, deprecated, and scripts without running them", async () => {
  const result = await loadPackument({
    name: "s127-demo-lib",
    clock: CLOCK,
    oldVersion: "1.0.0",
    newVersion: "2.0.0",
  });
  assert.equal(result.ok, true);
  assert.equal(result.schema, SCHEMA);
  assert.equal(result.provenance.coverage, COVERAGE.FULL_PACKUMENT);
  assert.equal(result.provenance.lifecycleScriptsRun, false);
  assert.equal(result.provenance.npmInstallRun, false);
  assert.equal(result.provenance.tarballExtracted, false);
  assert.equal(existsSync(SCRIPT_MARKER), false);

  assert.equal(result.versions["0.8.0"].deprecated, "use 1.x; this line is metadata only");
  assert.equal(result.versions["0.8.0"].deprecatedPresent, true);
  assert.equal(result.versions["0.9.0"].deprecated, true);
  assert.equal(result.versions["1.0.0"].deprecatedPresent, false);
  assert.equal(
    result.versions["1.0.0"].dist.tarball,
    "https://registry.npmjs.org/s127-demo-lib/-/s127-demo-lib-1.0.0.tgz",
  );
  assert.deepEqual(result.versions["1.0.0"].lifecycleScripts, ["preinstall", "install", "postinstall"]);
  assert.equal(result.versions["1.0.0"].hasInstallScript, true);
  assert.equal(result.versions["1.0.0"].lifecycleCommands[0].command.includes("SCRIPT_RAN.marker"), true);

  assert.equal(result.selection.ok, true);
  assert.equal(result.selection.oldVersion, "1.0.0");
  assert.equal(result.selection.newVersion, "2.0.0");
  assert.equal(result.selection.newerVersionAloneIsNotBreak, true);
  assert.equal(result.selection.distTagLatest, "3.0.0");
  assert.equal(result.selection.distTagLatestIsNotObservationVersion, true);
  assert.equal(result.distTags.latest, "3.0.0");
  assert.ok(result.limitations.some((row) => /not itself a break/i.test(row)));
  assert.equal(existsSync(SCRIPT_MARKER), false);
});

test("a newer dist-tags.latest is present and is not treated as the observation version", async () => {
  const result = await loadPackument({
    name: "s127-demo-lib",
    clock: CLOCK,
    oldVersion: "1.0.0",
    newVersion: "2.0.0",
  });
  assert.notEqual(result.distTags.latest, result.selection.newVersion);
  assert.ok(result.versions["3.0.0"]);
  assert.equal(result.selection.ok, true);
  assert.equal(result.paidDemand, false);
});

test("same-version pair is selectable; classification is not action", async () => {
  const result = await loadPackument({
    name: "s127-demo-lib",
    clock: CLOCK,
    oldVersion: "1.0.0",
    newVersion: "1.0.0",
  });
  assert.equal(result.ok, true);
  assert.equal(result.selection.ok, true);
  assert.equal(result.selection.sameVersion, true);
  assert.equal(result.selection.old.dist.tarball, result.selection.new.dist.tarball);
});

test("missing requested version is unknown, not action", async () => {
  const result = await loadPackument({
    name: "s127-demo-lib",
    clock: CLOCK,
    oldVersion: "1.0.0",
    newVersion: "9.9.9",
  });
  assert.equal(result.ok, true);
  assert.equal(result.selection.ok, false);
  assert.deepEqual(result.selection.missing, ["9.9.9"]);
  assert.equal(result.selection.coverage, "partial");
  assert.equal(result.unknownReasons[0].code, "missing_version");
});

test("refuses version tags such as latest as selected versions", async () => {
  const result = await loadPackument({
    name: "s127-demo-lib",
    clock: CLOCK,
    oldVersion: "1.0.0",
    newVersion: "latest",
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid_version");
});

test("scoped catalog name and registry path encoding", async () => {
  const result = await loadPackument({ name: "@s127/tiny", clock: CLOCK });
  assert.equal(result.ok, true);
  assert.equal(result.name, "@s127/tiny");
  assert.equal(
    result.versions["1.0.0"].dist.tarball,
    "https://registry.npmjs.org/@s127/tiny/-/tiny-1.0.0.tgz",
  );
  assert.equal(encodePackageNameForRegistryPath("@s127/tiny"), "@s127%2ftiny");
  assert.equal(packumentUrl("https://registry.npmjs.org", "@s127/tiny"), "https://registry.npmjs.org/@s127%2ftiny");
});

test("cookie slim fixture (label=fixture, not live this session) yields tarball URLs", async () => {
  const result = await loadPackument({
    name: "cookie",
    clock: CLOCK,
    oldVersion: "1.1.1",
    newVersion: "2.0.1",
  });
  assert.equal(result.ok, true);
  assert.equal(result.provenance.label, LABEL.FIXTURE);
  assert.equal(result.provenance.coverage, COVERAGE.SLIM_PACKUMENT);
  assert.equal(result.provenance.mode, MODE.FIXTURE);
  assert.equal(result.provenance.contentSha256, "bdddc87359d8b3067385f1a98e73279e6dec547a923d8daf6c337e4122335e2f");
  assert.equal(result.provenance.url, "https://registry.npmjs.org/cookie");
  assert.match(result.provenance.notes, /copied from prior capture/);
  assert.equal(result.selection.ok, true);
  assert.equal(
    result.selection.old.dist.tarball,
    "https://registry.npmjs.org/cookie/-/cookie-1.1.1.tgz",
  );
  assert.equal(
    result.selection.new.dist.tarball,
    "https://registry.npmjs.org/cookie/-/cookie-2.0.1.tgz",
  );
  assert.equal(result.selection.old.dist.integrity.startsWith("sha512-"), true);
});

test("path-to-regexp slim fixture records prepare from scripts array and does not run it", async () => {
  const result = await loadPackument({
    name: "path-to-regexp",
    clock: CLOCK,
    oldVersion: "6.3.0",
    newVersion: "8.4.2",
  });
  assert.equal(result.ok, true);
  assert.equal(result.provenance.label, LABEL.FIXTURE);
  assert.equal(result.provenance.coverage, COVERAGE.SLIM_PACKUMENT);
  assert.equal(result.provenance.contentSha256, "6d2991ed04ad6eb497efbda99feb2e6fe5cfd80b9dd448ef5eec8e8f340180c8");
  assert.equal(result.versions["6.3.0"].hasPrepareScript, true);
  assert.deepEqual(result.versions["6.3.0"].lifecycleScripts, ["prepare"]);
  assert.equal(result.versions["6.3.0"].hasInstallScript, false);
  assert.equal(result.provenance.lifecycleScriptsRun, false);
  assert.equal(result.selection.ok, true);
});

test("version document (no versions map) is kind version-document", async () => {
  const path = join(FIXTURES, "synthetic", "version-document-0.9.0.json");
  const result = await loadPackument({ path, clock: CLOCK, name: "s127-demo-lib" });
  assert.equal(result.ok, true);
  assert.equal(result.kind, KIND.VERSION_DOCUMENT);
  assert.equal(result.provenance.coverage, COVERAGE.VERSION_DOCUMENT);
  assert.equal(result.versions["0.9.0"].dist.tarball.includes("s127-demo-lib-0.9.0.tgz"), true);
});

test("missing tarball on a requested version is unknown coverage", async () => {
  const result = await loadPackument({
    name: "s127-partial-lib",
    clock: CLOCK,
    oldVersion: "1.0.0",
    newVersion: "2.0.0",
  });
  assert.equal(result.ok, true);
  assert.equal(result.provenance.coverage, COVERAGE.SLIM_PACKUMENT);
  assert.equal(result.selection.ok, false);
  assert.deepEqual(result.selection.missingTarball, ["2.0.0"]);
  assert.equal(result.unknownReasons[0].code, "missing_tarball");
});

test("empty versions map is partial page", async () => {
  const result = await loadPackument({ name: "s127-empty", clock: CLOCK });
  assert.equal(result.ok, true);
  assert.equal(result.kind, KIND.UNKNOWN);
  assert.equal(result.provenance.coverage, COVERAGE.PARTIAL_PAGE);
  assert.equal(result.versionCount, 0);
});

test("abbreviated hasInstallScript and deprecated string without scripts object", async () => {
  const result = await loadPackument({ name: "s127-abbrev", clock: CLOCK });
  assert.equal(result.ok, true);
  assert.equal(result.versions["1.2.3"].hasInstallScript, true);
  assert.equal(result.versions["1.2.3"].deprecated, "moved to s127-abbrev-next");
  assert.deepEqual(result.versions["1.2.3"].lifecycleScripts, []);
});

test("invalid JSON is partial page with contentSha256", async () => {
  const path = join(FIXTURES, "synthetic", "not-json.txt");
  const result = await loadPackument({ path, clock: CLOCK });
  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid_json");
  assert.equal(result.provenance.coverage, COVERAGE.PARTIAL_PAGE);
  assert.match(result.provenance.contentSha256, /^[0-9a-f]{64}$/);
});

test("unknown catalog name does not fetch", async () => {
  let called = 0;
  const result = await loadPackument({
    name: "definitely-not-in-catalog",
    clock: CLOCK,
    fetchImpl: async () => {
      called += 1;
      throw new Error("no");
    },
  });
  assert.equal(called, 0);
  assert.equal(result.ok, false);
  assert.equal(result.code, "not_found");
  assert.match(result.provenance.notes, /live fetch was not attempted/);
});

test("path traversal is refused when confined to fixture root", async () => {
  const result = await loadPackument({
    path: "../catalog.json",
    clock: CLOCK,
    confineToFixtureRoot: true,
    fixtureRoot: join(FIXTURES, "synthetic"),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "path_escape");
});

test("symlink fixture is refused", async () => {
  const dir = tempDir(t);
  const target = join(dir, "real.json");
  const link = join(dir, "link.json");
  writeFileSync(target, JSON.stringify({ name: "x", version: "1.0.0", dist: { tarball: "https://registry.npmjs.org/x/-/x-1.0.0.tgz" } }));
  symlinkSync(target, link);
  const result = await loadPackument({ path: link, clock: CLOCK });
  assert.equal(result.ok, false);
  assert.equal(result.code, "symlink_refused");
});

test("contentSha256 matches file bytes", async () => {
  const path = join(FIXTURES, "synthetic", "s127-tiny.packument.json");
  const result = readPackumentFile(path, { clock: CLOCK, label: LABEL.SYNTHETIC });
  const { readFileSync } = await import("node:fs");
  assert.equal(result.ok, true);
  assert.equal(result.provenance.contentSha256, sha256Hex(readFileSync(path)));
});

test("identity mismatch when requested name disagrees", async () => {
  const result = await loadPackument({
    name: "cookie",
    path: join(FIXTURES, "synthetic", "s127-demo-lib.packument.json"),
    clock: CLOCK,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "identity_mismatch");
});

test("live flag with local registry returns live-capture provenance", async () => {
  const body = {
    name: "s127-live-stub",
    "dist-tags": { latest: "1.0.0" },
    versions: {
      "1.0.0": {
        version: "1.0.0",
        dist: { tarball: "http://127.0.0.1/s127-live-stub/-/s127-live-stub-1.0.0.tgz" },
      },
    },
  };
  const origin = await listen(t, (req, res) => {
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.end();
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(body));
  });
  const result = await loadPackument({
    name: "s127-live-stub",
    live: true,
    clock: CLOCK,
    registry: origin,
    oldVersion: "1.0.0",
    newVersion: "1.0.0",
  });
  assert.equal(result.ok, true);
  assert.equal(result.provenance.mode, MODE.LIVE);
  assert.equal(result.provenance.label, LABEL.LIVE_CAPTURE);
  assert.equal(result.provenance.url, `${origin}/s127-live-stub`);
  assert.equal(result.provenance.tarballExtracted, false);
  assert.equal(result.selection.ok, true);
  assert.match(result.provenance.notes, /no tarball downloaded/);
});

test("fixture mode does not hit a live server even when one is passed as registry", async () => {
  let hits = 0;
  const origin = await listen(t, (_req, res) => {
    hits += 1;
    res.statusCode = 500;
    res.end("no");
  });
  const result = await loadPackument({
    name: "s127-demo-lib",
    clock: CLOCK,
    registry: origin,
    fetchImpl: globalThis.fetch,
  });
  assert.equal(hits, 0);
  assert.equal(result.ok, true);
  assert.equal(result.provenance.mode, MODE.FIXTURE);
});

test("live without name fails before fetch", async () => {
  let called = 0;
  const result = await loadPackument({
    live: true,
    clock: CLOCK,
    fetchImpl: async () => {
      called += 1;
      throw new Error("no");
    },
  });
  assert.equal(called, 0);
  assert.equal(result.ok, false);
  assert.equal(result.code, "missing_name");
});

test("live missing clock fails before fetch", async () => {
  let called = 0;
  const result = await loadPackument({
    live: true,
    name: "cookie",
    fetchImpl: async () => {
      called += 1;
      throw new Error("no");
    },
  });
  assert.equal(called, 0);
  assert.equal(result.code, "missing_clock");
});

test("live redirect is refused", async () => {
  const origin = await listen(t, (_req, res) => {
    res.statusCode = 302;
    res.setHeader("location", "https://example.invalid/x");
    res.end();
  });
  const result = await loadPackument({
    name: "s127-live-stub",
    mode: "live",
    clock: CLOCK,
    registry: origin,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "redirect_refused");
  assert.equal(result.provenance.label, LABEL.LIVE_CAPTURE);
});

test("live oversize is refused", async () => {
  const origin = await listen(t, (_req, res) => {
    res.setHeader("content-length", "999999");
    res.end(Buffer.alloc(200, 0x7b));
  });
  const result = await loadPackument({
    name: "s127-live-stub",
    live: true,
    clock: CLOCK,
    registry: origin,
    maxBytes: 50,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "oversize");
});

test("live registry with credentials is refused", async () => {
  const result = await loadPackument({
    name: "cookie",
    live: true,
    clock: CLOCK,
    registry: "https://user:pass@registry.npmjs.org",
    fetchImpl: async () => {
      throw new Error("should not fetch");
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "url_not_allowlisted");
});

test("parsePackumentDocument ignores __proto__ version keys", () => {
  const parsed = parsePackumentDocument({
    name: "x",
    versions: {
      "1.0.0": { version: "1.0.0", dist: { tarball: "https://registry.npmjs.org/x/-/x-1.0.0.tgz" } },
      __proto__: { version: "hacked", dist: { tarball: "http://evil.example/x.tgz" } },
    },
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.versions["1.0.0"].version, "1.0.0");
  assert.equal(Object.prototype.hasOwnProperty.call(parsed.versions, "__proto__"), false);
});

test("selectPair does not treat latest as a break", () => {
  const parsed = parsePackumentDocument({
    name: "x",
    "dist-tags": { latest: "9.0.0" },
    versions: {
      "1.0.0": { version: "1.0.0", dist: { tarball: "https://registry.npmjs.org/x/-/x-1.0.0.tgz" } },
      "2.0.0": { version: "2.0.0", dist: { tarball: "https://registry.npmjs.org/x/-/x-2.0.0.tgz" } },
      "9.0.0": { version: "9.0.0", dist: { tarball: "https://registry.npmjs.org/x/-/x-9.0.0.tgz" } },
    },
  });
  const pair = selectPair(parsed, "1.0.0", "2.0.0");
  assert.equal(pair.ok, true);
  assert.equal(pair.distTagLatest, "9.0.0");
  assert.equal(pair.newerVersionAloneIsNotBreak, true);
  assert.equal(pair.distTagLatestIsNotObservationVersion, true);
});
