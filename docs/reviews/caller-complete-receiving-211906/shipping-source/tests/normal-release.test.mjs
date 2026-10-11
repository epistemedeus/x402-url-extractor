import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { resolveHermesEnrollment } from "../experiments/integrated-delivery-100397/hermes-enrollment.mjs";
import {
  compatibleNode,
  curlArgs,
  ensureNode,
  nodeCacheIo,
  nodeTarget,
  openOwnedCache,
  parseArgs,
  planHermes,
  removeOwnedPrefix,
} from "../scripts/normal-release-lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cache = "/tmp/neomorphic-normal-test-cache";

function ioWith(marker, options = {}) {
  const state = {
    rootExists: options.rootExists !== false,
    rootLink: Boolean(options.rootLink),
    markerLink: Boolean(options.markerLink),
    rootUid: options.rootUid ?? 1000,
    markerUid: options.markerUid ?? 1000,
  };
  const files = new Map(marker === undefined ? [] : [["/tmp/cache/OWNER", marker]]);
  return {
    files,
    lstat(path) {
      if (path === "/tmp/cache") {
        if (!state.rootExists) return null;
        return { isSymbolicLink: state.rootLink, isDirectory: !state.rootLink, isFile: false, uid: state.rootUid };
      }
      if (path === "/tmp/cache/OWNER") {
        if (!files.has(path)) return null;
        return { isSymbolicLink: state.markerLink, isDirectory: false, isFile: !state.markerLink, uid: state.markerUid };
      }
      return null;
    },
    mkdir() {
      if (state.rootExists) {
        const error = new Error("exists");
        error.code = "EEXIST";
        throw error;
      }
      state.rootExists = true;
    },
    read(path) {
      if (!files.has(path)) throw new Error("missing");
      return files.get(path);
    },
    write(path, text) {
      files.set(path, text);
    },
  };
}

test("bootstrap options accept the two supported flags and refuse the rest", () => {
  assert.deepEqual(parseArgs([]), { inputsOnly: false, prefix: "" });
  assert.deepEqual(parseArgs(["--inputs-only", "--prefix", "services/correspondence"]), {
    inputsOnly: true,
    prefix: "services/correspondence",
  });
  for (const argv of [["--prefix"], ["--prefix", "--inputs-only"], ["--prefix", "../outside"], ["--prefix", "/tmp/x"], ["--other"]]) {
    assert.throws(() => parseArgs(argv), (error) => error.code === "invalid_option");
  }
});

test("curl downloads are partial and carry a total time bound", () => {
  const args = curlArgs("https://nodejs.org/dist/v22.23.3/SHASUMS256.txt", "/cache/SHASUMS256.txt.partial", { maxTime: 60 });
  assert.equal(args.at(-1), "https://nodejs.org/dist/v22.23.3/SHASUMS256.txt");
  assert.equal(args.at(-2), "/cache/SHASUMS256.txt.partial");
  assert.equal(args[args.indexOf("--max-time") + 1], "60");
  assert.equal(args.includes("--connect-timeout"), true);
  assert.throws(() => curlArgs("https://example.invalid/a", "/cache/a", { maxTime: 60 }), (error) => error.code === "invalid_option");
  assert.throws(() => curlArgs("https://example.invalid/a", "/cache/a.partial", { maxTime: 0 }), (error) => error.code === "invalid_option");
});

test("an enrolled Node 22 prefix is reused on any host", () => {
  const reused = compatibleNode({
    version: "v22.23.3",
    nodePath: "/opt/node/bin/node",
    npmPath: "/opt/node/bin/npm",
    npxPath: "/opt/node/bin/npx",
  });
  assert.equal(reused.reused, true);
  assert.equal(reused.bin, "/opt/node/bin");
  assert.equal(compatibleNode({ version: "v20.0.0", nodePath: "/opt/node/bin/node", npmPath: "/opt/node/bin/npm", npxPath: "/opt/node/bin/npx" }), null);
  assert.equal(compatibleNode({ version: "v22.1.0", nodePath: "/opt/node/bin/node", npmPath: "/usr/bin/npm", npxPath: "/opt/node/bin/npx" }), null);
  assert.equal(nodeTarget("linux", "x64"), "linux-x64");
  assert.equal(nodeTarget("darwin", "arm64"), "darwin-arm64");
  assert.equal(nodeTarget("freebsd", "x64"), "");
});

test("a shared cache is not owned by writing a marker or following a symlink", () => {
  const root = mkdtempSync(join(tmpdir(), "normal-cache-"));
  const uid = userInfo().uid;
  const io = nodeCacheIo();
  try {
    const shared = join(root, "shared");
    io.mkdir(shared);
    assert.throws(() => openOwnedCache(shared, uid, io), (error) => error.code === "cache_not_owned");
    assert.equal(existsSync(join(shared, "OWNER")), false);

    const outside = join(root, "outside.txt");
    writeFileSync(outside, `${uid}\n`);
    const linked = join(root, "linked");
    io.mkdir(linked);
    symlinkSync(outside, join(linked, "OWNER"));
    assert.throws(() => openOwnedCache(linked, uid, io), (error) => error.code === "cache_not_owned");
    assert.equal(readFileSync(outside, "utf8"), `${uid}\n`);

    writeFileSync(outside, "");
    const emptyLink = join(root, "empty-link");
    io.mkdir(emptyLink);
    symlinkSync(outside, join(emptyLink, "OWNER"));
    assert.throws(() => openOwnedCache(emptyLink, uid, io), (error) => error.code === "cache_not_owned");
    assert.equal(readFileSync(outside, "utf8"), "");

    const target = join(root, "target");
    io.mkdir(target);
    const via = join(root, "via");
    symlinkSync(target, via);
    assert.throws(() => openOwnedCache(via, uid, io), (error) => error.code === "cache_not_owned");
    assert.equal(existsSync(join(target, "OWNER")), false);

    const fresh = join(root, "fresh");
    const created = openOwnedCache(fresh, uid, io);
    assert.equal(created.created, true);
    assert.equal(readFileSync(join(fresh, "OWNER"), "utf8").trim(), String(uid));
    const reused = openOwnedCache(fresh, uid, io);
    assert.equal(reused.created, false);
    assert.throws(() => openOwnedCache(fresh, uid + 1, io), (error) => error.code === "cache_not_owned");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a foreign cache and a prefix outside it are refused before download", () => {
  assert.throws(() => openOwnedCache("/tmp/cache", 1000, ioWith("2000\n")), (error) => error.code === "cache_not_owned");
  assert.throws(() => removeOwnedPrefix("/tmp/other/node", "/tmp/cache"), (error) => error.code === "cache_not_owned");
  const calls = [];
  assert.throws(() => ensureNode({
    enrolled: () => null,
    platform: "linux",
    arch: "x64",
    cacheRoot: "/tmp/cache",
    uid: 1000,
    ...ioWith("2000\n"),
    download() { calls.push("download"); },
    existingPrefix() { return null; },
    remove() {},
    rename() {},
    sha256() { return ""; },
    removePrefix() {},
    extract() {},
  }), (error) => error.code === "cache_not_owned");
  assert.deepEqual(calls, []);
});

test("an unsupported host refuses Node materialization without a download", () => {
  const calls = [];
  assert.throws(() => ensureNode({
    enrolled: () => null,
    platform: "freebsd",
    arch: "x64",
    cacheRoot: cache,
    uid: 1000,
    ...ioWith(""),
    download() { calls.push("download"); },
    existingPrefix() { return null; },
    remove() {},
    rename() {},
    sha256() { return ""; },
    removePrefix() {},
    extract() {},
  }), (error) => error.code === "unsupported_capability");
  assert.deepEqual(calls, []);
});

test("an already enrolled Node prefix skips the official tarball", () => {
  const calls = [];
  const node = ensureNode({
    enrolled: () => ({ version: "v22.23.3", node: "/opt/node/bin/node", npm: "/opt/node/bin/npm", npx: "/opt/node/bin/npx", bin: "/opt/node/bin", reused: true }),
    platform: "linux",
    arch: "x64",
    cacheRoot: cache,
    uid: 1000,
    ...ioWith(""),
    download() { calls.push("download"); },
    existingPrefix() { calls.push("prefix"); return null; },
    remove() {},
    rename() {},
    sha256() { return ""; },
    removePrefix() { calls.push("remove"); },
    extract() { calls.push("extract"); },
  });
  assert.equal(node.reused, true);
  assert.equal(node.bin, "/opt/node/bin");
  assert.deepEqual(calls, []);
});

test("a checksum mismatch removes the partial tarball and does not extract", () => {
  const removed = [];
  const files = new Map();
  assert.throws(() => ensureNode({
    enrolled: () => null,
    platform: "linux",
    arch: "x64",
    cacheRoot: "/tmp/cache",
    uid: 1000,
    lstat(path) {
      if (path === "/tmp/cache") return { isSymbolicLink: false, isDirectory: true, isFile: false, uid: 1000 };
      if (String(path).endsWith("OWNER")) return { isSymbolicLink: false, isDirectory: false, isFile: true, uid: 1000 };
      return null;
    },
    mkdir() {
      const error = new Error("exists");
      error.code = "EEXIST";
      throw error;
    },
    read(path) {
      if (path.endsWith("OWNER")) return "1000\n";
      if (path.endsWith("SHASUMS256.txt.partial")) return "deadbeef  node-v22.23.3-linux-x64.tar.xz\n";
      throw new Error(path);
    },
    write(path, text) { files.set(path, text); },
    download(_url, partial) { files.set(partial, "bytes"); },
    remove(path) { removed.push(path); files.delete(path); },
    rename(from, to) { files.set(to, files.get(from)); files.delete(from); },
    sha256() { return "not-the-sum"; },
    existingPrefix() { return null; },
    removePrefix() { removed.push("prefix"); },
    extract() { throw new Error("extract should not run"); },
  }), (error) => error.code === "checksum_mismatch");
  assert.equal(removed.includes("/tmp/cache/node-v22.23.3-linux-x64.tar.xz.partial"), true);
  assert.equal(removed.includes("prefix"), false);
});

test("Hermes reuse, refusal, and cold materialization stay inside the owned cache", () => {
  const pin = "2f80ae0a6a91932b1808a53f9c55f8b3f313d6cc";
  const reused = planHermes({
    declaredRoot: "/declared/hermes",
    declaredPython: "/declared/venv/bin/python",
    pin,
    probe: { exists: true, head: pin, blobMatches: true },
    pythonProbe: { exists: true, usable: true },
    cacheRoot: "/tmp/cache",
  });
  assert.equal(reused.action, "reuse");
  assert.equal(reused.sourceRoot, "/declared/hermes");
  assert.throws(() => planHermes({
    declaredRoot: "/declared/hermes",
    declaredPython: "/declared/venv/bin/python",
    pin,
    probe: { exists: true, head: "other", blobMatches: false },
    pythonProbe: { exists: true, usable: true },
    cacheRoot: "/tmp/cache",
  }), (error) => error.code === "refuse_replace");
  assert.throws(() => planHermes({
    declaredRoot: "/declared/hermes",
    declaredPython: "/declared/venv/bin/python",
    pin,
    probe: { exists: true, head: pin, blobMatches: true },
    pythonProbe: { exists: true, usable: false },
    cacheRoot: "/tmp/cache",
  }), (error) => error.code === "refuse_replace");
  const cold = planHermes({
    declaredRoot: "/declared/hermes",
    declaredPython: "/declared/venv/bin/python",
    pin,
    probe: { exists: false, head: "", blobMatches: false },
    pythonProbe: { exists: false, usable: false },
    cacheRoot: "/tmp/cache",
  });
  assert.equal(cold.action, "materialize");
  assert.equal(cold.sourceRoot, "/tmp/cache/hermes-source");
  assert.equal(cold.python, "/tmp/cache/hermes-venv/bin/python");
  assert.equal(cold.materializeSource, true);
  assert.equal(cold.materializePython, true);
  const secondRun = planHermes({
    declaredRoot: "/declared/hermes",
    declaredPython: "/declared/venv/bin/python",
    pin,
    probe: { exists: false, head: "", blobMatches: false },
    pythonProbe: { exists: false, usable: false },
    cacheRoot: "/tmp/cache",
    cacheProbe: { exists: true, head: pin, blobMatches: true },
    cachePythonProbe: { exists: true, usable: true },
  });
  assert.equal(secondRun.action, "reuse");
  assert.equal(secondRun.sourceRoot, "/tmp/cache/hermes-source");
  assert.equal(secondRun.python, "/tmp/cache/hermes-venv/bin/python");
  assert.throws(() => planHermes({
    declaredRoot: "/declared/hermes",
    declaredPython: "/declared/venv/bin/python",
    pin,
    probe: { exists: false, head: "", blobMatches: false },
    pythonProbe: { exists: false, usable: false },
    cacheRoot: "/tmp/cache",
    cacheProbe: { exists: true, head: "other", blobMatches: false },
    cachePythonProbe: { exists: true, usable: true },
  }), (error) => error.code === "refuse_replace");
  assert.throws(() => planHermes({
    declaredRoot: "/declared/hermes",
    declaredPython: "/declared/venv/bin/python",
    pin,
    probe: { exists: false, head: "", blobMatches: false },
    pythonProbe: { exists: false, usable: false },
    cacheRoot: "/tmp/cache",
    cacheProbe: { exists: true, head: pin, blobMatches: true },
    cachePythonProbe: { exists: true, usable: false },
  }), (error) => error.code === "refuse_replace");
  const pythonMissing = planHermes({
    declaredRoot: "/declared/hermes",
    declaredPython: "/declared/venv/bin/python",
    pin,
    probe: { exists: false, head: "", blobMatches: false },
    pythonProbe: { exists: false, usable: false },
    cacheRoot: "/tmp/cache",
    cacheProbe: { exists: true, head: pin, blobMatches: true },
    cachePythonProbe: { exists: false, usable: false },
  });
  assert.equal(pythonMissing.action, "materialize");
  assert.equal(pythonMissing.materializeSource, false);
  assert.equal(pythonMissing.materializePython, true);
  assert.throws(() => planHermes({
    declaredRoot: "",
    declaredPython: "/declared/venv/bin/python",
    pin,
    probe: { exists: false },
    pythonProbe: { exists: false, usable: false },
    cacheRoot: "/tmp/cache",
  }), (error) => error.code === "hermes_undeclared");
});

test("the live Node 22 prefix and declared Hermes enrollment are the normal runtime", () => {
  const version = execFileSync(process.execPath, ["-v"], { encoding: "utf8", timeout: 10000 }).trim();
  const bin = dirname(process.execPath);
  const live = compatibleNode({
    version,
    nodePath: process.execPath,
    npmPath: join(bin, "npm"),
    npxPath: join(bin, "npx"),
  });
  assert.equal(live.reused, true);
  assert.equal(existsSync(live.npm), true);
  assert.equal(existsSync(live.npx), true);
  const enrolled = resolveHermesEnrollment(root, process.env);
  assert.equal(enrolled.pin, "2f80ae0a6a91932b1808a53f9c55f8b3f313d6cc");
  assert.equal(existsSync(join(enrolled.sourceRoot, "tools/skills_guard.py")), true);
  assert.equal(existsSync(enrolled.cli), true);
});

test("the actual filesystem adapter survives missing-runtime materialization", () => {
  const owned = mkdtempSync(join(tmpdir(), "normal-materialization-"));
  const cacheRoot = join(owned, "cache");
  const uid = userInfo().uid;
  let downloads = 0;
  try {
    assert.throws(() => ensureNode({
      enrolled: () => null,
      platform: "linux",
      arch: "x64",
      cacheRoot,
      uid,
      ...nodeCacheIo(),
      existingPrefix: () => null,
      download() {
        downloads += 1;
        const error = new Error("fixture download boundary");
        error.code = "fixture_download_boundary";
        throw error;
      },
      remove() {},
      rename() {},
      sha256() { return ""; },
      removePrefix() { assert.fail("must not remove a prefix before download"); },
      extract() { assert.fail("must not extract before download"); },
    }), (error) => error.code === "fixture_download_boundary");
    assert.equal(downloads, 1);
    assert.equal(readFileSync(join(cacheRoot, "OWNER"), "utf8").trim(), String(uid));
    assert.equal(openOwnedCache(cacheRoot, uid, nodeCacheIo()).created, false);
  } finally {
    rmSync(owned, { recursive: true, force: true });
  }
});
