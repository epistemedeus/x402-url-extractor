#!/usr/bin/env node
/**
 * Normal release test runner.
 *
 * Reuses a Node 22 prefix that already has npm and npx beside it, and reuses
 * an enrolled Hermes checkout. A missing official Node tarball is materialized
 * into a uid-owned cache with a bounded curl and a checksum. A declared Hermes
 * tree that does not match its pin is not replaced. Product pins stay as
 * declared. This process does not edit the operator shell.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveHermesEnrollment } from "../experiments/integrated-delivery-100397/hermes-enrollment.mjs";
import {
  CURL_MAX_TIME_SECONDS,
  NODE_VERSION,
  PYTHON_VERSION,
  SUMS_MAX_TIME_SECONDS,
  compatibleNode,
  curlArgs,
  ensureNode,
  nodeCacheIo,
  openOwnedCache,
  parseArgs,
  planHermes,
  prefixInsideCache,
  removeOwnedPrefix,
} from "./normal-release-lib.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const cacheRoot = join(tmpdir(), "neomorphic-normal", String(userInfo().uid));

const CHAIN = [
  "npm run test:task-memory-contract",
  "npm run test:work-board",
  "npm run test:town-square",
  "npm run test:capability-market",
  "npm run test:scale-compose",
  "npm run test:shared-task",
  "node --test --test-concurrency=1 tests/*.test.mjs",
  "npm run test:regression-corpus",
].join(" && ");

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repo,
    env: options.env || process.env,
    encoding: "utf8",
    stdio: options.stdio || "inherit",
    timeout: options.timeout,
  });
  if (result.error) fail(`${command} ${args.join(" ")} failed: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = options.stdio === "pipe" ? `\n${result.stderr || ""}${result.stdout || ""}` : "";
    fail(`${command} ${args.join(" ")} exited ${result.status}${detail}`);
  }
  return result.stdout || "";
}

function capture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: "utf8",
    timeout: options.timeout || 30000,
  });
  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error ? result.error.message : "",
  };
}

function cacheIo() {
  return nodeCacheIo();
}

function download(url, partial, { maxTime }) {
  rmSync(partial, { force: true });
  const args = curlArgs(url, partial, { maxTime });
  const result = spawnSync("curl", args, { encoding: "utf8", timeout: (maxTime + 15) * 1000 });
  if (result.error || result.status !== 0) {
    rmSync(partial, { force: true });
    const error = new Error(`download ${url} failed: ${result.error ? result.error.message : `exit ${result.status}`}`);
    error.code = "download_failed";
    throw error;
  }
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function enrolledNode() {
  const node = process.execPath;
  const bin = dirname(node);
  const npm = join(bin, "npm");
  const npx = join(bin, "npx");
  if (!existsSync(npm) || !existsSync(npx)) return null;
  const version = capture(node, ["-v"], { timeout: 10000 }).stdout.trim();
  return compatibleNode({ version, nodePath: node, npmPath: npm, npxPath: npx });
}

function existingPrefix(prefix) {
  const node = join(prefix, "bin", "node");
  const npm = join(prefix, "bin", "npm");
  const npx = join(prefix, "bin", "npx");
  if (!existsSync(node) || !existsSync(npm) || !existsSync(npx)) return null;
  const version = capture(node, ["-v"], { timeout: 10000 }).stdout.trim();
  if (version !== `v${NODE_VERSION}`) return null;
  return { version, node, npm, npx, bin: join(prefix, "bin"), reused: true };
}

function removePrefix(prefix) {
  removeOwnedPrefix(prefix, cacheRoot);
  rmSync(prefix, { recursive: true, force: true });
}

function declaration() {
  const inputs = JSON.parse(readFileSync(join(repo, "experiments/integrated-delivery-100397/receiving-inputs.json"), "utf8"));
  const hermes = inputs.hermes;
  if (!hermes || hermes.synthesized === true || hermes.module !== "tools.skills_guard" || !hermes.pin || !hermes.repository) {
    fail("hermes declaration is missing the pinned source", 2);
  }
  return {
    pin: hermes.pin,
    repository: hermes.repository,
    sourceRoot: hermes.candidates?.[0] || "",
    python: hermes.interpreters?.[0] || "",
  };
}

function probeSource(sourceRoot, pin) {
  if (!sourceRoot || !existsSync(join(sourceRoot, "tools/skills_guard.py"))) return { exists: false, head: "", blobMatches: false };
  const head = capture("git", ["-C", sourceRoot, "rev-parse", "HEAD"], { timeout: 10000 });
  const committed = capture("git", ["-C", sourceRoot, "rev-parse", `HEAD:tools/skills_guard.py`], { timeout: 10000 });
  const worktree = capture("git", ["-C", sourceRoot, "hash-object", "--", "tools/skills_guard.py"], { timeout: 10000 });
  return {
    exists: true,
    head: head.stdout.trim(),
    blobMatches: head.status === 0 && head.stdout.trim() === pin && committed.status === 0 && committed.stdout.trim() === worktree.stdout.trim(),
  };
}

function probePython(python, sourceRoot) {
  if (!python || !existsSync(python)) return { exists: false, usable: false };
  const cli = join(dirname(python), "hermes");
  if (!existsSync(cli) || !existsSync(join(sourceRoot, "tools/skills_guard.py"))) return { exists: true, usable: false };
  const imported = capture(python, ["-c", "import sys; print(sys.version.split()[0])"], { timeout: 30000 });
  return { exists: true, usable: imported.status === 0 && imported.stdout.startsWith(`${PYTHON_VERSION}.`) };
}

function materializeSource(sourceRoot, pin, repository) {
  if (!prefixInsideCache(sourceRoot, cacheRoot)) fail(`refusing to materialize Hermes outside ${cacheRoot}`);
  if (existsSync(join(sourceRoot, ".git"))) {
    const probe = probeSource(sourceRoot, pin);
    if (probe.head === pin && probe.blobMatches) return;
    fail(`Hermes cache ${sourceRoot} is not pin ${pin}; refusing to replace it`);
  }
  mkdirSync(dirname(sourceRoot), { recursive: true });
  run("git", ["init", sourceRoot], { timeout: 30000 });
  run("git", ["-C", sourceRoot, "remote", "add", "origin", repository], { timeout: 30000 });
  run("git", ["-C", sourceRoot, "fetch", "--depth", "1", "origin", pin], { timeout: 180000 });
  run("git", ["-C", sourceRoot, "checkout", "--detach", "FETCH_HEAD"], { timeout: 60000 });
  const checked = capture("git", ["-C", sourceRoot, "rev-parse", "HEAD"], { timeout: 10000 }).stdout.trim();
  if (checked !== pin) fail(`Hermes checkout ${checked || "missing"} is not ${pin}`);
}

function commandOnPath(name) {
  return capture("sh", ["-c", "command -v \"$1\"", "sh", name], { timeout: 10000 }).stdout.trim();
}

function materializePython(python, sourceRoot) {
  const venv = dirname(dirname(python));
  if (!prefixInsideCache(venv, cacheRoot)) fail(`refusing to materialize the Hermes interpreter outside ${cacheRoot}`);
  if (existsSync(python)) fail(`Hermes interpreter ${python} already exists; refusing to replace it`);
  const systemPython = commandOnPath(`python${PYTHON_VERSION}`);
  if (systemPython) {
    const version = capture(systemPython, ["-c", "import sys; print(sys.version.split()[0])"], { timeout: 30000 });
    if (version.status !== 0 || !version.stdout.startsWith(`${PYTHON_VERSION}.`)) {
      fail(`python${PYTHON_VERSION} at ${systemPython} is ${version.stdout.trim() || "unusable"}`);
    }
    run(systemPython, ["-m", "venv", venv], { timeout: 120000 });
    run(python, ["-m", "pip", "install", "-e", sourceRoot], { timeout: 600000 });
    return;
  }
  const uv = commandOnPath("uv");
  if (!uv) {
    fail(
      `Python ${PYTHON_VERSION} Hermes interpreter is not enrolled. Attempted the declared interpreter, python${PYTHON_VERSION} on PATH, and uv on PATH. No installer was downloaded.`,
    );
  }
  const uvEnv = {
    ...process.env,
    UV_PYTHON_INSTALL_DIR: join(cacheRoot, "python"),
    UV_PYTHON_BIN_DIR: join(cacheRoot, "python-bin"),
    UV_CACHE_DIR: join(cacheRoot, "uv-cache"),
    UV_NO_MODIFY_PATH: "1",
  };
  mkdirSync(uvEnv.UV_PYTHON_INSTALL_DIR, { recursive: true });
  run(uv, ["python", "install", PYTHON_VERSION], { env: uvEnv, timeout: 180000 });
  run(uv, ["venv", "--python", PYTHON_VERSION, venv], { env: uvEnv, timeout: 120000 });
  run(uv, ["pip", "install", "--python", python, "-e", sourceRoot], { env: uvEnv, timeout: 600000 });
}

function ensureHermes() {
  if (process.env.HERMES_SOURCE_ROOT || process.env.HERMES_PYTHON) {
    try {
      return resolveHermesEnrollment(repo, process.env);
    } catch (error) {
      fail(`explicit Hermes enrollment failed: ${error.code} ${JSON.stringify(error.failures || [])}`);
    }
  }
  try {
    return resolveHermesEnrollment(repo, {});
  } catch (error) {
    const reasons = new Set((error.failures || []).map((row) => row.reason));
    if (reasons.has("pin_mismatch") || reasons.has("tracked_module_modified")) {
      fail(`declared Hermes source failed enrollment (${[...reasons].join(",")}); refusing to replace it`);
    }
  }
  const declared = declaration();
  const probe = probeSource(declared.sourceRoot, declared.pin);
  const pythonProbe = probePython(declared.python, declared.sourceRoot);
  const cacheSource = join(cacheRoot, "hermes-source");
  const cachePython = join(cacheRoot, "hermes-venv", "bin", "python");
  const cacheProbe = probeSource(cacheSource, declared.pin);
  const cachePythonProbe = probePython(cachePython, probe.exists ? declared.sourceRoot : cacheSource);
  let plan;
  try {
    openOwnedCache(cacheRoot, userInfo().uid, cacheIo());
    plan = planHermes({
      declaredRoot: declared.sourceRoot,
      declaredPython: declared.python,
      pin: declared.pin,
      probe,
      pythonProbe,
      cacheRoot,
      cacheProbe,
      cachePythonProbe,
    });
  } catch (error) {
    fail(error.message, error.code === "invalid_option" ? 2 : 1);
  }
  if (plan.action === "reuse") {
    return resolveHermesEnrollment(repo, { HERMES_SOURCE_ROOT: plan.sourceRoot, HERMES_PYTHON: plan.python });
  }
  if (plan.materializeSource) materializeSource(plan.sourceRoot, plan.pin, declared.repository);
  if (plan.materializePython) materializePython(plan.python, plan.sourceRoot);
  try {
    return resolveHermesEnrollment(repo, { HERMES_SOURCE_ROOT: plan.sourceRoot, HERMES_PYTHON: plan.python });
  } catch (error) {
    fail(`hermes enrollment refused the materialized inputs: ${error.code} ${JSON.stringify(error.failures || [])}`);
  }
  return null;
}

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (error) {
  fail(error.message, 2);
}

let nodeBin;
try {
  nodeBin = ensureNode({
    enrolled: enrolledNode,
    platform: process.platform,
    arch: process.arch,
    cacheRoot,
    uid: userInfo().uid,
    ...cacheIo(),
    download: (url, partial, options) => download(url, partial, options),
    remove: (path) => rmSync(path, { force: true }),
    rename: (from, to) => renameSync(from, to),
    sha256: sha256File,
    existingPrefix,
    removePrefix,
    extract: (tar, destination) => {
      const result = spawnSync("tar", ["-xJf", tar, "-C", destination], { encoding: "utf8", timeout: 180000 });
      if (result.error || result.status !== 0) {
        const error = new Error(`tar extract failed: ${result.error ? result.error.message : `exit ${result.status}`}`);
        error.code = "incomplete_prefix";
        throw error;
      }
    },
  });
} catch (error) {
  fail(error.message, error.code === "invalid_option" ? 2 : 1);
}

const officialEnv = { ...process.env, PATH: `${nodeBin.bin}${process.env.PATH ? `:${process.env.PATH}` : ""}` };

if (args.prefix) {
  const abs = join(repo, args.prefix);
  if (!existsSync(join(abs, "package-lock.json"))) fail(`${args.prefix} has no package-lock.json`, 2);
  run(nodeBin.npm, ["ci", "--prefix", abs], { env: officialEnv, timeout: 300000 });
  const prefixed = spawnSync(nodeBin.npm, ["test", "--prefix", abs], { cwd: repo, env: officialEnv, stdio: "inherit" });
  if (prefixed.error) fail(prefixed.error.message);
  process.exit(prefixed.status ?? 1);
}

const enrolled = ensureHermes();
const env = {
  ...officialEnv,
  HERMES_SOURCE_ROOT: enrolled.sourceRoot,
  HERMES_PYTHON: enrolled.interpreter,
};

const npmPath = capture("sh", ["-c", "command -v npm"], { env }).stdout.trim();
const npxPath = capture("sh", ["-c", "command -v npx"], { env }).stdout.trim();
const nodePath = capture("sh", ["-c", "command -v node"], { env }).stdout.trim();
if (dirname(nodePath) !== nodeBin.bin || dirname(npmPath) !== nodeBin.bin || dirname(npxPath) !== nodeBin.bin) {
  fail(`node/npm/npx resolved outside the selected prefix: ${nodePath} ${npmPath} ${npxPath}`);
}

const receipt = {
  node: nodeBin.version,
  nodeReused: Boolean(nodeBin.reused),
  nodePath,
  npmPath,
  npxPath,
  hermesPin: enrolled.pin,
  hermesSource: enrolled.sourceRoot,
  hermesPython: enrolled.interpreter,
  pythonVersion: enrolled.pythonVersion,
  scannerVersion: enrolled.scannerVersion,
  moduleFile: enrolled.moduleFile,
  curlMaxTimeSeconds: CURL_MAX_TIME_SECONDS,
  sumsMaxTimeSeconds: SUMS_MAX_TIME_SECONDS,
};
process.stdout.write(`NORMAL_INPUTS ${JSON.stringify(receipt)}\n`);

if (args.inputsOnly) process.exit(0);

const chain = spawnSync("sh", ["-c", CHAIN], { cwd: repo, env, stdio: "inherit" });
if (chain.error) fail(chain.error.message);
process.exit(chain.status ?? 1);
