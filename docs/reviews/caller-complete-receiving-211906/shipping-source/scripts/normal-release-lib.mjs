/**
 * Decisions for the normal release bootstrap.
 *
 * Reuse an enrolled Node 22 prefix and an enrolled Hermes checkout first.
 * Materialize a missing official Node tarball only into a cache this uid owns.
 * A directory is owned only when this process created it or its regular OWNER
 * file already names this uid. Symlinks are not followed and a missing marker
 * is not replaced. Downloads are partial until their checksum matches, and
 * curl always has a total time bound. A declared Hermes tree that does not
 * match its pin is left in place. A cache checkout that already matches the
 * pin, with a usable interpreter, is reused. A cache that exists and does
 * not match is not replaced.
 */
import { closeSync, constants, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";

export const NODE_VERSION = "22.23.3";
export const PYTHON_VERSION = "3.14";
export const CURL_MAX_TIME_SECONDS = 180;
export const SUMS_MAX_TIME_SECONDS = 60;

const NODE_TARGETS = {
  "linux-x64": "linux-x64",
  "linux-arm64": "linux-arm64",
  "darwin-x64": "darwin-x64",
  "darwin-arm64": "darwin-arm64",
};

export function nodeTarget(platform, arch) {
  return NODE_TARGETS[`${platform}-${arch}`] || "";
}

export function compatibleNode({ version = "", nodePath = "", npmPath = "", npxPath = "" } = {}) {
  if (!/^v22\.\d+\.\d+$/.test(version)) return null;
  if (!nodePath || !npmPath || !npxPath) return null;
  const bin = nodePath.slice(0, nodePath.lastIndexOf("/"));
  if (!bin || npmPath.slice(0, npmPath.lastIndexOf("/")) !== bin || npxPath.slice(0, npxPath.lastIndexOf("/")) !== bin) {
    return null;
  }
  return { version, node: nodePath, npm: npmPath, npx: npxPath, bin, reused: true };
}

export function parseArgs(argv) {
  const out = { inputsOnly: false, prefix: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--inputs-only") {
      out.inputsOnly = true;
      continue;
    }
    if (arg === "--prefix") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        const error = new Error("--prefix requires a relative path");
        error.code = "invalid_option";
        throw error;
      }
      i += 1;
      if (value.startsWith("/") || value.split("/").includes("..") || value.split("/").includes(".")) {
        const error = new Error("--prefix must stay inside the repository");
        error.code = "invalid_option";
        throw error;
      }
      out.prefix = value;
      continue;
    }
    const error = new Error(`unknown option ${arg}`);
    error.code = "invalid_option";
    throw error;
  }
  return out;
}

export function curlArgs(url, destination, { maxTime = CURL_MAX_TIME_SECONDS } = {}) {
  if (!Number.isInteger(maxTime) || maxTime < 1 || maxTime > 300) {
    const error = new Error("curl max-time must be an integer from 1 to 300");
    error.code = "invalid_option";
    throw error;
  }
  if (!destination.endsWith(".partial")) {
    const error = new Error("download destination must be a partial path");
    error.code = "invalid_option";
    throw error;
  }
  return [
    "-fsSL",
    "--retry",
    "2",
    "--retry-delay",
    "1",
    "--retry-all-errors",
    "--connect-timeout",
    "15",
    "--max-time",
    String(maxTime),
    "-o",
    destination,
    url,
  ];
}

export function prefixInsideCache(prefix, cacheRoot) {
  const rel = relative(cacheRoot, prefix);
  return Boolean(rel) && !rel.startsWith("..") && !isAbsolute(rel);
}

function cacheError(message) {
  const error = new Error(message);
  error.code = "cache_not_owned";
  return error;
}

function assertOwnedDirectory(cacheRoot, uid, stat) {
  if (!stat || stat.isSymbolicLink || !stat.isDirectory) {
    throw cacheError(`cache ${cacheRoot} is not a directory`);
  }
  if (stat.uid !== undefined && String(stat.uid) !== String(uid)) {
    throw cacheError(`cache ${cacheRoot} is owned by uid ${stat.uid}`);
  }
}

function assertOwnedMarker(cacheRoot, uid, stat) {
  if (!stat || stat.isSymbolicLink || !stat.isFile) {
    throw cacheError(`cache ${cacheRoot} owner marker is not a regular file`);
  }
  if (stat.uid !== undefined && String(stat.uid) !== String(uid)) {
    throw cacheError(`cache ${cacheRoot} owner marker is owned by uid ${stat.uid}`);
  }
}

export function nodeCacheIo() {
  return {
    lstat(path) {
      try {
        const stat = lstatSync(path);
        return {
          isSymbolicLink: stat.isSymbolicLink(),
          isDirectory: stat.isDirectory(),
          isFile: stat.isFile(),
          uid: stat.uid,
        };
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    },
    mkdir(path) {
      mkdirSync(dirname(path), { recursive: true });
      mkdirSync(path);
    },
    read(path) {
      const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        return readFileSync(fd, "utf8");
      } finally {
        closeSync(fd);
      }
    },
    write(path, text) {
      const partial = `${path}.partial`;
      const partialStat = this.lstat(partial);
      if (partialStat?.isSymbolicLink) throw cacheError(`refusing to write through symlink ${partial}`);
      if (partialStat) rmSync(partial);
      if (this.lstat(path)?.isSymbolicLink) throw cacheError(`refusing to replace symlink ${path}`);
      const fd = openSync(partial, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        writeFileSync(fd, text);
      } finally {
        closeSync(fd);
      }
      renameSync(partial, path);
    },
  };
}

export function openOwnedCache(cacheRoot, uid, io) {
  const owner = String(uid);
  let rootStat = io.lstat(cacheRoot);
  if (rootStat?.isSymbolicLink) throw cacheError(`cache ${cacheRoot} is a symlink`);
  let created = false;
  if (!rootStat) {
    try {
      io.mkdir(cacheRoot);
      created = true;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    rootStat = io.lstat(cacheRoot);
  }
  assertOwnedDirectory(cacheRoot, owner, rootStat);
  const marker = join(cacheRoot, "OWNER");
  let markerStat = io.lstat(marker);
  if (!markerStat) {
    if (!created) throw cacheError(`cache ${cacheRoot} has no owner marker`);
    io.write(marker, `${owner}\n`);
    markerStat = io.lstat(marker);
    assertOwnedMarker(cacheRoot, owner, markerStat);
    if (String(io.read(marker)).trim() !== owner) {
      throw cacheError(`cache ${cacheRoot} owner marker does not match uid ${owner}`);
    }
    return { cacheRoot, uid: owner, created: true };
  }
  if (created) throw cacheError(`cache ${cacheRoot} appeared with an owner marker during create`);
  assertOwnedMarker(cacheRoot, owner, markerStat);
  const current = String(io.read(marker)).trim();
  if (current !== owner) throw cacheError(`cache ${cacheRoot} is owned by uid ${current}`);
  return { cacheRoot, uid: owner, created: false };
}

export function removeOwnedPrefix(prefix, cacheRoot) {
  if (!prefixInsideCache(prefix, cacheRoot)) {
    const error = new Error(`refusing to remove ${prefix} outside ${cacheRoot}`);
    error.code = "cache_not_owned";
    throw error;
  }
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function ensureNode(deps) {
  const enrolled = deps.enrolled();
  if (enrolled) return enrolled;
  const target = nodeTarget(deps.platform, deps.arch);
  if (!target) {
    throw fail(
      "unsupported_capability",
      `official Node ${NODE_VERSION} has no tarball target for ${deps.platform}/${deps.arch}`,
    );
  }
  openOwnedCache(deps.cacheRoot, deps.uid, deps);
  const prefix = join(deps.cacheRoot, `node-v${NODE_VERSION}-${target}`);
  removeOwnedPrefix(prefix, deps.cacheRoot);
  const existing = deps.existingPrefix(prefix);
  if (existing) return { ...existing, reused: true };
  const tarName = `node-v${NODE_VERSION}-${target}.tar.xz`;
  const dist = `https://nodejs.org/dist/v${NODE_VERSION}`;
  const sumsPartial = join(deps.cacheRoot, "SHASUMS256.txt.partial");
  try {
    deps.download(`${dist}/SHASUMS256.txt`, sumsPartial, { maxTime: SUMS_MAX_TIME_SECONDS });
    const sums = String(deps.read(sumsPartial));
    const line = sums.split("\n").find((row) => row.endsWith(tarName));
    if (!line) {
      deps.remove(sumsPartial);
      throw fail("checksum_missing", `SHASUMS256.txt has no ${tarName}`);
    }
    deps.rename(sumsPartial, join(deps.cacheRoot, "SHASUMS256.txt"));
    const expected = line.split(/\s+/)[0];
    const tarFinal = join(deps.cacheRoot, tarName);
    const tarPartial = `${tarFinal}.partial`;
    deps.download(`${dist}/${tarName}`, tarPartial, { maxTime: CURL_MAX_TIME_SECONDS });
    const actual = deps.sha256(tarPartial);
    if (actual !== expected) {
      deps.remove(tarPartial);
      throw fail("checksum_mismatch", `Node tarball sha256 ${actual} != ${expected}`);
    }
    deps.rename(tarPartial, tarFinal);
    try {
      deps.removePrefix(prefix);
      deps.extract(tarFinal, deps.cacheRoot);
    } catch (extractError) {
      deps.removePrefix(prefix);
      throw extractError;
    }
  } catch (error) {
    deps.remove(sumsPartial);
    deps.remove(`${join(deps.cacheRoot, tarName)}.partial`);
    throw error;
  }
  const verified = deps.existingPrefix(prefix);
  if (!verified) {
    deps.removePrefix(prefix);
    throw fail("incomplete_prefix", `extracted node prefix ${prefix} is not usable`);
  }
  return { ...verified, reused: false };
}

export function planHermes({
  declaredRoot,
  declaredPython,
  pin,
  probe,
  pythonProbe,
  cacheRoot,
  cacheProbe = null,
  cachePythonProbe = null,
}) {
  if (!declaredRoot || !pin || !declaredPython) {
    throw fail("hermes_undeclared", "hermes declaration is missing the pinned source or interpreter");
  }
  if (probe.exists && !(probe.head === pin && probe.blobMatches)) {
    throw fail(
      "refuse_replace",
      `declared Hermes source ${declaredRoot} is not pin ${pin}; refusing to replace it`,
    );
  }
  if (pythonProbe.exists && !pythonProbe.usable) {
    throw fail(
      "refuse_replace",
      `declared Hermes interpreter ${declaredPython} is not a usable Python ${PYTHON_VERSION} Hermes CLI; refusing to replace it`,
    );
  }
  if (probe.exists && pythonProbe.usable) {
    return { action: "reuse", sourceRoot: declaredRoot, python: declaredPython, pin };
  }
  const cacheSource = join(cacheRoot, "hermes-source");
  const cachePython = join(cacheRoot, "hermes-venv", "bin", "python");
  const cacheSourceReady = cacheProbe?.exists === true && cacheProbe.head === pin && cacheProbe.blobMatches === true;
  if (!probe.exists && cacheProbe?.exists === true && !cacheSourceReady) {
    throw fail("refuse_replace", `Hermes cache ${cacheSource} is not pin ${pin}; refusing to replace it`);
  }
  const cachePythonReady = cachePythonProbe?.usable === true;
  if (!pythonProbe.usable && cachePythonProbe?.exists === true && !cachePythonReady && (probe.exists || cacheSourceReady)) {
    throw fail(
      "refuse_replace",
      `Hermes interpreter ${cachePython} is not a usable Python ${PYTHON_VERSION} Hermes CLI; refusing to replace it`,
    );
  }
  const sourceRoot = probe.exists ? declaredRoot : cacheSource;
  const python = pythonProbe.usable ? declaredPython : cachePython;
  const sourceReady = probe.exists || cacheSourceReady;
  const pythonReady = pythonProbe.usable || cachePythonReady;
  if (sourceReady && pythonReady) {
    return { action: "reuse", sourceRoot, python, pin };
  }
  if (!prefixInsideCache(sourceRoot, cacheRoot) && sourceRoot !== declaredRoot) {
    throw fail("cache_not_owned", `refusing to materialize Hermes outside ${cacheRoot}`);
  }
  if (!pythonReady && !prefixInsideCache(python, cacheRoot)) {
    throw fail("cache_not_owned", `refusing to materialize the Hermes interpreter outside ${cacheRoot}`);
  }
  return {
    action: "materialize",
    sourceRoot,
    python,
    pin,
    materializeSource: !sourceReady,
    materializePython: !pythonReady,
  };
}
