import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  AcquireError,
  COVERAGE,
  DEFAULT_FIXTURE_ROOT,
  LABEL,
  SCHEMA,
  acquire,
  acquirePair,
  extractTarball,
  isAllowedSourceUrl,
  readCatalog,
  listTarballMembers,
  registryTarballUrl,
  sha256Hex,
  versionDocumentUrl,
} from "../../src/acquire.mjs";
import { CELL_FIXTURE_ROOT } from "./index.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const CLOCK = "2026-09-10T12:00:00.000Z";

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "c04-acquire-"));
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
  assert.equal(DEFAULT_FIXTURE_ROOT, CELL_FIXTURE_ROOT);
});

test("catalog tarballSha256 matches committed tarball bytes", () => {
  const { catalog } = readCatalog(CELL_FIXTURE_ROOT);
  assert.ok(catalog);
  for (const [key, entry] of Object.entries(catalog.packs)) {
    if (!entry.tarball || !entry.tarballSha256) continue;
    const bytes = readFileSync(join(CELL_FIXTURE_ROOT, entry.tarball));
    assert.equal(sha256Hex(bytes), entry.tarballSha256, key);
  }
});

test("fixture acquire returns package root and provenance for 1.0.0", async () => {
  const result = await acquire({
    name: "s127-demo-lib",
    version: "1.0.0",
    mode: "fixture",
    clock: CLOCK,
  });
  assert.equal(result.schema, SCHEMA);
  assert.equal(result.ok, true);
  assert.ok(result.rootDir);
  const manifest = JSON.parse(readFileSync(join(result.rootDir, "package.json"), "utf8"));
  assert.equal(manifest.name, "s127-demo-lib");
  assert.equal(manifest.version, "1.0.0");
  assert.equal(result.provenance.label, LABEL.FIXTURE);
  assert.equal(result.provenance.coverage, COVERAGE.FULL_TARBALL);
  assert.equal(result.provenance.retrievedAt, CLOCK);
  assert.equal(result.provenance.lifecycleScriptsRun, false);
  assert.equal(result.provenance.npmInstallRun, false);
  assert.equal(result.provenance.sha256, result.provenance.contentSha256);
  assert.match(result.provenance.sha256, /^[0-9a-f]{64}$/);
  assert.equal(result.provenance.sha256Of, "tarball");
  assert.equal(existsSync(join(result.rootDir, "LIFECYCLE_RAN.txt")), false);
  assert.equal(existsSync(join(result.rootDir, "index.js")), true);
  assert.equal(existsSync(join(result.rootDir, "unused.js")), true);
});

test("fixture acquire of 2.0.0 has a different tarball hash and no unused export path file", async () => {
  const oldResult = await acquire({ name: "s127-demo-lib", version: "1.0.0", mode: "fixture", clock: CLOCK });
  const newResult = await acquire({ name: "s127-demo-lib", version: "2.0.0", mode: "fixture", clock: CLOCK });
  assert.equal(newResult.ok, true);
  assert.notEqual(oldResult.provenance.sha256, newResult.provenance.sha256);
  assert.equal(existsSync(join(newResult.rootDir, "unused.js")), false);
  const src = readFileSync(join(newResult.rootDir, "index.js"), "utf8");
  assert.match(src, /farewell/);
});

test("acquirePair returns old and new roots without classifying the upgrade", async () => {
  const pair = await acquirePair({
    name: "s127-demo-lib",
    oldVersion: "1.0.0",
    newVersion: "2.0.0",
    mode: "fixture",
    clock: CLOCK,
  });
  assert.equal(pair.old.ok, true);
  assert.equal(pair.new.ok, true);
  assert.notEqual(pair.old.rootDir, pair.new.rootDir);
  assert.equal(pair.old.provenance.coverage, COVERAGE.FULL_TARBALL);
  assert.equal(pair.new.provenance.coverage, COVERAGE.FULL_TARBALL);
});

test("scoped fixture pack resolves packs/@scope/name paths", async () => {
  const result = await acquire({ name: "@s127/tiny", version: "1.0.0", mode: "fixture", clock: CLOCK });
  assert.equal(result.ok, true);
  const manifest = JSON.parse(readFileSync(join(result.rootDir, "package.json"), "utf8"));
  assert.equal(manifest.name, "@s127/tiny");
});

test("partial page fixture has no rootDir", async () => {
  const result = await acquire({ name: "s127-demo-lib", version: "0.9.0", mode: "fixture", clock: CLOCK });
  assert.equal(result.ok, false);
  assert.equal(result.rootDir, null);
  assert.equal(result.provenance.coverage, COVERAGE.PARTIAL_PAGE);
  assert.equal(result.provenance.label, LABEL.FIXTURE);
  assert.equal(result.provenance.sha256Of, "version-document");
  assert.equal(result.provenance.error.code, "partial_page");
});

test("missing fixture is coverage missing, not a throw", async () => {
  const catalogued = await acquire({ name: "s127-demo-lib", version: "9.9.9", mode: "fixture", clock: CLOCK });
  assert.equal(catalogued.ok, false);
  assert.equal(catalogued.provenance.coverage, COVERAGE.MISSING);
  const absent = await acquire({ name: "s127-demo-lib", version: "3.0.0", mode: "fixture", clock: CLOCK });
  assert.equal(absent.ok, false);
  assert.equal(absent.provenance.coverage, COVERAGE.MISSING);
});

test("fixture mode never calls fetchImpl", async () => {
  let called = 0;
  await acquire({
    name: "s127-demo-lib",
    version: "1.0.0",
    mode: "fixture",
    clock: CLOCK,
    fetchImpl: async () => {
      called += 1;
      throw new Error("should not fetch");
    },
  });
  assert.equal(called, 0);
});

test("mode defaults to fixture (offline-first)", async () => {
  const result = await acquire({ name: "s127-demo-lib", version: "1.0.0", clock: CLOCK });
  assert.equal(result.provenance.mode, "fixture");
  assert.equal(result.ok, true);
});

test("invalid name, version range, and mode throw AcquireError", async () => {
  await assert.rejects(() => acquire({ name: "../evil", version: "1.0.0" }), AcquireError);
  await assert.rejects(() => acquire({ name: "s127-demo-lib", version: "^1.0.0" }), AcquireError);
  await assert.rejects(() => acquire({ name: "s127-demo-lib", version: "latest" }), AcquireError);
  await assert.rejects(() => acquire({ name: "s127-demo-lib", version: "1.0.0", mode: "npm-install" }), AcquireError);
});

test("tarball-only fixture root extracts with tar --no-same-owner and does not run scripts", async (t) => {
  const dest = tempDir(t);
  const fixtureRoot = tempDir(t);
  mkdirSync(join(fixtureRoot, "tarballs"), { recursive: true });
  const srcTgz = join(CELL_FIXTURE_ROOT, "tarballs/s127-demo-lib-1.0.0.tgz");
  const copied = readFileSync(srcTgz);
  writeFileSync(join(fixtureRoot, "tarballs/s127-demo-lib-1.0.0.tgz"), copied);
  writeFileSync(
    join(fixtureRoot, "catalog.json"),
    `${JSON.stringify({
      schema: "s127.upgrade-impact.fixture-catalog.v1",
      capturedAt: CLOCK,
      packs: {
        "s127-demo-lib@1.0.0": {
          tarball: "tarballs/s127-demo-lib-1.0.0.tgz",
          tarballSha256: sha256Hex(copied),
          label: "fixture",
          coverage: "full tarball",
        },
      },
    })}\n`,
  );

  const result = await acquire({
    name: "s127-demo-lib",
    version: "1.0.0",
    mode: "fixture",
    fixtureRoot,
    destDir: dest,
    clock: CLOCK,
  });
  assert.equal(result.ok, true);
  assert.equal(result.provenance.extracted, true);
  assert.deepEqual(result.provenance.extract.flags, ["--no-same-owner", "--no-same-permissions"]);
  assert.equal(existsSync(join(result.rootDir, "LIFECYCLE_RAN.txt")), false);
  assert.equal(existsSync(join(dirname(result.rootDir), "LIFECYCLE_RAN.txt")), false);
});

test("extractTarball refuses symlink members after extract", async (t) => {
  const dir = tempDir(t);
  const src = join(dir, "src/package");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "package.json"), JSON.stringify({ name: "s127-demo-lib", version: "1.0.0" }));
  const { symlinkSync } = await import("node:fs");
  symlinkSync("/tmp/s127-does-not-matter", join(src, "link"));
  const tgz = join(dir, "sym.tgz");
  const { spawnSync } = await import("node:child_process");
  const tar = spawnSync("tar", ["--force-local", "-czf", tgz, "-C", join(dir, "src"), "package"], { encoding: "utf8" });
  assert.equal(tar.status, 0, tar.stderr);
  assert.throws(() => extractTarball(tgz, join(dir, "out")), /symlink/);
});

test("extractTarball refuses path-escaping members", async (t) => {
  const dir = tempDir(t);
  const evil = join(dir, "evil.tgz");
  const packed = join(dir, "src");
  mkdirSync(packed, { recursive: true });
  writeFileSync(join(packed, "x.txt"), "nope");
  const { spawnSync } = await import("node:child_process");
  const tar = spawnSync(
    "tar",
    ["--force-local", "-czf", evil, "-C", packed, "--transform=s,x.txt,../outside.txt,", "x.txt"],
    { encoding: "utf8" },
  );
  if (tar.status !== 0) {
    t.skip("gnu tar --transform unavailable");
    return;
  }
  assert.throws(() => listTarballMembers(evil), /escapes extract dir/);
  assert.throws(() => extractTarball(evil, join(dir, "out")), /escapes extract dir/);
});

test("live allowlist rejects non-registry hosts without fetching", async () => {
  assert.equal(isAllowedSourceUrl("https://example.com/pkg.tgz"), false);
  assert.equal(isAllowedSourceUrl("https://registry.npmjs.org/left-pad/1.3.0"), true);
  let called = 0;
  const result = await acquire({
    name: "s127-demo-lib",
    version: "1.0.0",
    mode: "live",
    registry: "http://evil.example",
    clock: CLOCK,
    fetchImpl: async () => {
      called += 1;
      throw new Error("should not fetch");
    },
  });
  assert.equal(called, 0);
  assert.equal(result.ok, false);
  assert.equal(result.provenance.coverage, COVERAGE.MISSING);
  assert.equal(result.provenance.error.code, "invalid_input");

  const offHost = await acquire({
    name: "s127-demo-lib",
    version: "1.0.0",
    mode: "live",
    clock: CLOCK,
    fetchImpl: async () => {
      called += 1;
      return {
        status: 200,
        headers: { get: () => null },
        arrayBuffer: async () =>
          Buffer.from(
            JSON.stringify({
              name: "s127-demo-lib",
              version: "1.0.0",
              dist: { tarball: "https://example.com/s127-demo-lib-1.0.0.tgz" },
            }),
          ),
      };
    },
  });
  assert.equal(offHost.ok, false);
  assert.equal(offHost.provenance.coverage, COVERAGE.PARTIAL_PAGE);
  assert.equal(offHost.provenance.error.code, "url_not_allowlisted");
});

test("live 404 version document is coverage missing", async () => {
  const result = await acquire({
    name: "s127-demo-lib",
    version: "1.0.0",
    mode: "live",
    clock: CLOCK,
    fetchImpl: async () => ({
      status: 404,
      ok: false,
      headers: { get: () => null },
      body: null,
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.provenance.coverage, COVERAGE.MISSING);
  assert.equal(result.provenance.label, LABEL.LIVE_CAPTURE);
  assert.equal(result.provenance.error.code, "not_found");
});

test("live redirect is refused and the target is not contacted", async () => {
  let targetHits = 0;
  const result = await acquire({
    name: "s127-demo-lib",
    version: "1.0.0",
    mode: "live",
    clock: CLOCK,
    fetchImpl: async (url, init) => {
      assert.equal(init.method, "GET");
      assert.equal(init.redirect, "manual");
      if (String(url).includes("target")) {
        targetHits += 1;
        return { status: 200, ok: true, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) };
      }
      return {
        status: 302,
        ok: false,
        headers: { get: (name) => (String(name).toLowerCase() === "location" ? "https://registry.npmjs.org/target" : null) },
        body: null,
      };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.provenance.error.code, "redirect_refused");
  assert.equal(targetHits, 0);
});

test("live mock registry downloads tarball, extracts, and never writes LIFECYCLE_RAN", async (t) => {
  const tarballPath = join(CELL_FIXTURE_ROOT, "tarballs/s127-demo-lib-1.0.0.tgz");
  const tarballBytes = readFileSync(tarballPath);
  const integrity = `sha512-${createHash("sha512").update(tarballBytes).digest("base64")}`;
  const dest = tempDir(t);

  const origin = await listen(t, (req, res) => {
    if (req.method !== "GET") {
      res.writeHead(405);
      res.end();
      return;
    }
    if (req.url === "/s127-demo-lib/1.0.0") {
      const body = JSON.stringify({
        name: "s127-demo-lib",
        version: "1.0.0",
        dist: {
          tarball: `${origin}/s127-demo-lib/-/s127-demo-lib-1.0.0.tgz`,
          integrity,
        },
      });
      res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
      res.end(body);
      return;
    }
    if (req.url === "/s127-demo-lib/-/s127-demo-lib-1.0.0.tgz") {
      res.writeHead(200, { "content-type": "application/octet-stream", "content-length": tarballBytes.length });
      res.end(tarballBytes);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const result = await acquire({
    name: "s127-demo-lib",
    version: "1.0.0",
    mode: "live",
    registry: origin,
    destDir: dest,
    clock: CLOCK,
    expectedTarballSha256: sha256Hex(tarballBytes),
  });
  assert.equal(result.ok, true);
  assert.equal(result.provenance.label, LABEL.LIVE_CAPTURE);
  assert.equal(result.provenance.coverage, COVERAGE.FULL_TARBALL);
  assert.equal(result.provenance.extracted, true);
  assert.equal(result.provenance.sha256, sha256Hex(tarballBytes));
  assert.match(result.provenance.url, /s127-demo-lib-1\.0\.0\.tgz$/);
  assert.equal(existsSync(join(result.rootDir, "LIFECYCLE_RAN.txt")), false);
  const manifest = JSON.parse(readFileSync(join(result.rootDir, "package.json"), "utf8"));
  assert.equal(manifest.version, "1.0.0");
});

test("live tarball failure after version document is partial page", async () => {
  const doc = Buffer.from(
    JSON.stringify({
      name: "s127-demo-lib",
      version: "1.0.0",
      dist: { tarball: "https://registry.npmjs.org/s127-demo-lib/-/s127-demo-lib-1.0.0.tgz" },
    }),
  );
  let n = 0;
  const result = await acquire({
    name: "s127-demo-lib",
    version: "1.0.0",
    mode: "live",
    clock: CLOCK,
    fetchImpl: async () => {
      n += 1;
      if (n === 1) {
        return {
          status: 200,
          headers: { get: () => String(doc.length) },
          arrayBuffer: async () => doc.buffer.slice(doc.byteOffset, doc.byteOffset + doc.byteLength),
        };
      }
      return { status: 404, headers: { get: () => null }, body: null };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.provenance.coverage, COVERAGE.PARTIAL_PAGE);
  assert.equal(result.provenance.sha256Of, "version-document");
});

test("live oversize tarball is not extracted", async () => {
  const doc = Buffer.from(
    JSON.stringify({
      name: "s127-demo-lib",
      version: "1.0.0",
      dist: { tarball: "https://registry.npmjs.org/s127-demo-lib/-/s127-demo-lib-1.0.0.tgz" },
    }),
  );
  let n = 0;
  const result = await acquire({
    name: "s127-demo-lib",
    version: "1.0.0",
    mode: "live",
    clock: CLOCK,
    maxBytes: 16,
    fetchImpl: async () => {
      n += 1;
      if (n === 1) {
        return {
          status: 200,
          headers: { get: () => null },
          arrayBuffer: async () => doc.buffer.slice(doc.byteOffset, doc.byteOffset + doc.byteLength),
        };
      }
      return {
        status: 200,
        headers: { get: (h) => (String(h).toLowerCase() === "content-length" ? "1000000" : null) },
        body: null,
      };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.provenance.coverage, COVERAGE.PARTIAL_PAGE);
  assert.equal(result.provenance.error.code, "oversize");
});

test("registry URL helpers encode scoped names", () => {
  assert.equal(
    versionDocumentUrl("https://registry.npmjs.org", "@s127/tiny", "1.0.0"),
    "https://registry.npmjs.org/@s127%2ftiny/1.0.0",
  );
  assert.equal(
    registryTarballUrl("https://registry.npmjs.org", "@s127/tiny", "1.0.0"),
    "https://registry.npmjs.org/@s127/tiny/-/tiny-1.0.0.tgz",
  );
});

test("acquire.mjs does not spawn npm", () => {
  const src = readFileSync(join(here, "../../src/acquire.mjs"), "utf8");
  assert.equal(/spawnSync\(\s*["']npm["']/.test(src), false);
  assert.equal(/execFileSync\(\s*["']npm["']/.test(src), false);
  assert.match(src, /no npm install/);
});
