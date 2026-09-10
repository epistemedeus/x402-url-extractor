/**
 * Acquire old/new npm package source without running lifecycle scripts.
 *
 * acquire({ name, version, mode: "fixture" | "live" }) → { rootDir, provenance }
 *
 * Fixture mode reads the local stub catalog (default: cells/c04-source-acq/fixtures).
 * Live mode optionally GETs a free registry version document + tarball over HTTPS,
 * then tar-extracts with --no-same-owner. Never npm install. Never run scripts.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export const SCHEMA = "s127.upgrade-impact.acquire-result.v1";
export const CATALOG_SCHEMA = "s127.upgrade-impact.fixture-catalog.v1";
export const USER_AGENT =
  "s127-upgrade-impact-acquire/0.1 (tarball-download-only; no npm install; no lifecycle)";

export const DEFAULT_REGISTRY = "https://registry.npmjs.org";
export const DEFAULT_FIXTURE_ROOT = join(HERE, "../cells/c04-source-acq/fixtures");
export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
export const DEFAULT_MAX_JSON_BYTES = 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 15_000;
export const MAX_TARBALL_MEMBERS = 2_000;
export const MAX_URL_LENGTH = 4_096;

export const COVERAGE = Object.freeze({
  FULL_TARBALL: "full tarball",
  PARTIAL_PAGE: "partial page",
  MISSING: "missing",
});

export const LABEL = Object.freeze({
  FIXTURE: "fixture",
  LIVE_CAPTURE: "live-capture",
  SYNTHETIC: "synthetic",
});

const COVERAGE_VALUES = new Set(Object.values(COVERAGE));
const LABEL_VALUES = new Set(Object.values(LABEL));

export class AcquireError extends Error {
  constructor(message, code = "invalid_input") {
    super(message);
    this.name = "AcquireError";
    this.code = code;
  }
}

export function sha256Hex(value) {
  const input = typeof value === "string" || Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return createHash("sha256").update(input).digest("hex");
}

export function fixtureTarballFileName(name, version) {
  const safe = String(name).replace(/^@/, "").replace(/\//g, "-");
  return `${safe}-${version}.tgz`;
}

export function unscopedName(name) {
  return name.includes("/") ? name.slice(name.lastIndexOf("/") + 1) : name;
}

export function encodePackageNameForRegistryPath(name) {
  if (name.startsWith("@")) {
    const slash = name.indexOf("/");
    if (slash === -1) {
      throw new AcquireError(`scoped package name is missing a slash: ${name}`);
    }
    return `${name.slice(0, slash)}%2f${encodeURIComponent(name.slice(slash + 1))}`;
  }
  return encodeURIComponent(name);
}

export function stripTrailingSlash(url) {
  return String(url).replace(/\/+$/, "");
}

export function versionDocumentUrl(registry, name, version) {
  const base = stripTrailingSlash(registry);
  return `${base}/${encodePackageNameForRegistryPath(name)}/${encodeURIComponent(version)}`;
}

export function registryTarballUrl(registry, name, version) {
  const base = stripTrailingSlash(registry);
  return `${base}/${name}/-/${unscopedName(name)}-${version}.tgz`;
}

export function assertSafePackageName(name) {
  if (typeof name !== "string" || !name.trim() || name !== name.trim()) {
    throw new AcquireError("name must be a non-empty trimmed npm package name");
  }
  if (name.length > 214 || name.includes("\\") || name.includes("..") || name.includes("\0")) {
    throw new AcquireError(`refusing package name: ${name}`);
  }
  if (!/^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/.test(name)) {
    throw new AcquireError(`refusing package name: ${name}`);
  }
  return name;
}

export function assertExactVersion(version) {
  if (typeof version !== "string" || !version.trim() || version !== version.trim()) {
    throw new AcquireError("version must be a non-empty trimmed exact version");
  }
  if (/[\s\\]/.test(version) || version.includes("\0") || version.includes("..")) {
    throw new AcquireError(`refusing version: ${version}`);
  }
  if (/^[~^<>*=]|x|X|\|\||latest|next|^v/i.test(version)) {
    throw new AcquireError(`version ranges and tags are not acquired: ${version}`);
  }
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new AcquireError(`version is not an exact semver: ${version}`);
  }
  return version;
}

function assertMode(mode) {
  if (mode == null) return "fixture";
  if (mode !== "fixture" && mode !== "live") {
    throw new AcquireError(`mode must be "fixture" or "live", got ${JSON.stringify(mode)}`);
  }
  return mode;
}

export function parseRegistryOrigin(registry, { allowHttpLocalhost = true } = {}) {
  let url;
  try {
    url = new URL(registry);
  } catch {
    throw new AcquireError(`registry is not a URL: ${registry}`);
  }
  if (url.username || url.password) {
    throw new AcquireError("registry URL must not include credentials");
  }
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol === "https:") {
    // ok
  } else if (url.protocol === "http:" && allowHttpLocalhost && local) {
    // test / mounted origin only
  } else {
    throw new AcquireError(`registry must be https (http only for localhost): ${registry}`);
  }
  return url.origin;
}

export function isAllowedSourceUrl(candidate, registry = DEFAULT_REGISTRY) {
  if (typeof candidate !== "string" || !candidate || candidate.length > MAX_URL_LENGTH) return false;
  if (/[\s\\]/.test(candidate) || candidate.includes("\0")) return false;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash) return false;
  if (!["http:", "https:"].includes(url.protocol)) return false;
  let origin;
  try {
    origin = parseRegistryOrigin(registry);
  } catch {
    return false;
  }
  return url.origin === origin;
}

export function hashUnpackedTree(rootDir) {
  const files = listFiles(rootDir);
  const hash = createHash("sha256");
  for (const rel of files) {
    hash.update(rel);
    hash.update("\0");
    hash.update(readFileSync(join(rootDir, rel)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function listFiles(rootDir) {
  const out = [];
  function walk(dir, rel) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "." || entry.name === "..") continue;
      const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(full, nextRel);
      else if (entry.isFile()) out.push(nextRel);
    }
  }
  walk(rootDir, "");
  return out.sort();
}

export function resolvePackageRoot(extractDir) {
  if (!extractDir || !existsSync(extractDir)) return null;
  const direct = join(extractDir, "package.json");
  if (isRegularFile(direct)) return extractDir;
  const nested = join(extractDir, "package", "package.json");
  if (isRegularFile(nested)) return join(extractDir, "package");
  let entries = [];
  try {
    entries = readdirSync(extractDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith("."));
  if (dirs.length === 1) {
    const candidate = join(extractDir, dirs[0].name);
    if (isRegularFile(join(candidate, "package.json"))) return candidate;
  }
  return null;
}

function isRegularFile(path) {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

export function readCatalog(fixtureRoot = DEFAULT_FIXTURE_ROOT) {
  const path = join(fixtureRoot, "catalog.json");
  if (!existsSync(path)) return { path, catalog: null };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new AcquireError(`fixture catalog is not JSON: ${error.message}`, "invalid_catalog");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AcquireError("fixture catalog must be an object", "invalid_catalog");
  }
  if (parsed.schema !== CATALOG_SCHEMA) {
    throw new AcquireError(`fixture catalog schema mismatch: ${parsed.schema}`, "invalid_catalog");
  }
  return { path, catalog: parsed };
}

export function catalogKey(name, version) {
  return `${name}@${version}`;
}

function provenanceBase({
  name,
  version,
  mode,
  label,
  url = null,
  path = null,
  retrievedAt,
  sha256 = null,
  sha256Of = null,
  coverage,
  tarballPath = null,
  extracted = false,
  notes = null,
  error = null,
  extract = null,
}) {
  const record = {
    name,
    version,
    mode,
    label,
    url,
    path,
    retrievedAt,
    sha256,
    contentSha256: sha256,
    sha256Of,
    coverage,
    tarballPath,
    extracted,
    lifecycleScriptsRun: false,
    npmInstallRun: false,
    notes,
    error,
    extract,
  };
  if (!COVERAGE_VALUES.has(record.coverage)) {
    throw new AcquireError(`internal: invalid coverage ${record.coverage}`);
  }
  if (!LABEL_VALUES.has(record.label)) {
    throw new AcquireError(`internal: invalid label ${record.label}`);
  }
  return record;
}

function freezeResult({ ok, rootDir, provenance }) {
  if (provenance?.error) Object.freeze(provenance.error);
  if (provenance?.extract) {
    if (Array.isArray(provenance.extract.flags)) Object.freeze(provenance.extract.flags);
    Object.freeze(provenance.extract);
  }
  return Object.freeze({
    schema: SCHEMA,
    ok: Boolean(ok),
    rootDir: rootDir ?? null,
    provenance: Object.freeze(provenance),
  });
}

function failResult({ name, version, mode, label, retrievedAt, coverage, error, url = null, path = null, sha256 = null, sha256Of = null, notes = null, tarballPath = null }) {
  return freezeResult({
    ok: false,
    rootDir: null,
    provenance: provenanceBase({
      name,
      version,
      mode,
      label,
      url,
      path,
      retrievedAt,
      sha256,
      sha256Of,
      coverage,
      tarballPath,
      extracted: false,
      notes,
      error,
    }),
  });
}

function uniqueDestDir(destDir, name, version) {
  const base = destDir ? resolve(destDir) : join(tmpdir(), "s127-acquire");
  mkdirSync(base, { recursive: true });
  const safe = name.replace(/^@/, "").replace(/\//g, "-");
  const stamp = `${Date.now().toString(36)}-${process.pid.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = join(base, `${safe}-${version}-${stamp}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const TAR_EXTRACT_FLAGS = Object.freeze(["--no-same-owner", "--no-same-permissions"]);

export function listTarballMembers(tarballPath) {
  const result = spawnSync(
    "tar",
    ["--force-local", "-t", "-z", "-f", tarballPath],
    { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
  );
  if (result.error) {
    throw new AcquireError(`tar not available: ${result.error.message}`, "tar_failed");
  }
  if (result.status !== 0) {
    throw new AcquireError(`tar list failed: ${(result.stderr || result.stdout || "").trim()}`, "tar_failed");
  }
  const members = String(result.stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (members.length > MAX_TARBALL_MEMBERS) {
    throw new AcquireError(`tarball has ${members.length} members (max ${MAX_TARBALL_MEMBERS})`, "unsafe_tarball");
  }
  for (const member of members) {
    const normalized = member.replace(/\\/g, "/");
    if (isAbsolute(normalized) || normalized.startsWith("/") || normalized.includes("://")) {
      throw new AcquireError(`tarball member has an absolute path: ${member}`, "unsafe_tarball");
    }
    const parts = normalized.split("/").filter(Boolean);
    if (parts.includes("..")) {
      throw new AcquireError(`tarball member escapes extract dir: ${member}`, "unsafe_tarball");
    }
  }
  return members;
}

export function assertNoSymlinks(rootDir) {
  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        throw new AcquireError(`refusing symlink in acquired tree: ${full}`, "unsafe_tarball");
      }
      if (entry.isDirectory()) stack.push(full);
    }
  }
}

export function extractTarball(tarballPath, destDir) {
  if (!existsSync(tarballPath)) {
    throw new AcquireError(`tarball not found: ${tarballPath}`, "tar_failed");
  }
  mkdirSync(destDir, { recursive: true });
  const members = listTarballMembers(tarballPath);
  const result = spawnSync(
    "tar",
    [
      "--force-local",
      "--no-same-owner",
      "--no-same-permissions",
      "--delay-directory-restore",
      "-x",
      "-z",
      "-f",
      tarballPath,
      "-C",
      destDir,
    ],
    { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
  );
  if (result.error) {
    throw new AcquireError(`tar not available: ${result.error.message}`, "tar_failed");
  }
  if (result.status !== 0) {
    throw new AcquireError(`tar extract failed: ${(result.stderr || result.stdout || "").trim()}`, "extract_failed");
  }
  const rootDir = resolvePackageRoot(destDir);
  if (!rootDir) {
    throw new AcquireError("extracted tarball has no package.json root", "missing_package_root");
  }
  if (!isRegularFile(join(rootDir, "package.json"))) {
    throw new AcquireError("package.json is not a regular file after extract", "unsafe_tarball");
  }
  assertNoSymlinks(destDir);
  return {
    rootDir,
    members,
    extract: Object.freeze({
      tool: "tar",
      flags: TAR_EXTRACT_FLAGS,
    }),
  };
}

function verifyNpmIntegrity(bytes, integrity) {
  if (typeof integrity !== "string" || !integrity.trim()) {
    return { ok: true, skipped: true };
  }
  const match = /^(sha(?:256|512))-([A-Za-z0-9+/]+=*)$/.exec(integrity.trim());
  if (!match) {
    return { ok: false, code: "integrity_mismatch", message: `unsupported integrity specifier: ${integrity}` };
  }
  const algo = match[1];
  const actual = createHash(algo).update(bytes).digest("base64");
  if (actual !== match[2]) {
    return { ok: false, code: "integrity_mismatch", message: `${algo} digest does not match dist.integrity` };
  }
  return { ok: true, skipped: false, algo };
}

async function downloadBytes(url, {
  fetchImpl,
  timeoutMs,
  maxBytes,
  accept,
  redirect = "manual",
}) {
  if (typeof fetchImpl !== "function") {
    return { ok: false, code: "fetch_unavailable", message: "fetch implementation is not available" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let reader;
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect,
      signal: controller.signal,
      headers: {
        accept,
        "user-agent": USER_AGENT,
      },
    });
    const status = response.status;
    if (status >= 300 && status < 400) {
      return { ok: false, code: "redirect_refused", message: `redirect refused status ${status}`, status };
    }
    if (status === 404) {
      return { ok: false, code: "not_found", message: `HTTP 404 for ${url}`, status };
    }
    if (status !== 200) {
      return {
        ok: false,
        code: "http_error",
        message: `HTTP ${status} for ${url}`,
        status,
        retryable: status >= 500 || status === 429,
      };
    }
    const declared = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      return { ok: false, code: "oversize", message: `content-length ${declared} exceeds ${maxBytes} bytes`, status };
    }
    if (response.body?.getReader) {
      reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel().catch(() => {});
          return { ok: false, code: "oversize", message: `body exceeds ${maxBytes} bytes`, status };
        }
        chunks.push(Buffer.from(value));
      }
      return { ok: true, bytes: Buffer.concat(chunks, size), status, url };
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      return { ok: false, code: "oversize", message: `body exceeds ${maxBytes} bytes`, status };
    }
    return { ok: true, bytes: buffer, status, url };
  } catch (error) {
    const aborted = error?.name === "AbortError" || controller.signal.aborted;
    return {
      ok: false,
      code: aborted ? "timed_out" : "fetch_error",
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (reader) await reader.cancel().catch(() => {});
  }
}

function copyFileBounded(src, dest, maxBytes) {
  const stat = lstatSync(src);
  if (!stat.isFile()) {
    throw new AcquireError(`not a regular file: ${src}`);
  }
  if (stat.size > maxBytes) {
    throw new AcquireError(`file exceeds ${maxBytes} bytes: ${src}`, "oversize");
  }
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, readFileSync(src));
}

function labelForMode(mode, catalogLabel) {
  if (catalogLabel && LABEL_VALUES.has(catalogLabel)) return catalogLabel;
  return mode === "live" ? LABEL.LIVE_CAPTURE : LABEL.FIXTURE;
}

function clockNow(clock) {
  if (clock == null) return new Date().toISOString();
  if (typeof clock !== "string" || !clock.trim()) {
    throw new AcquireError("clock must be an ISO-8601 string when provided");
  }
  return clock;
}

function fixturePaths(fixtureRoot, name, version) {
  return {
    unpacked: join(fixtureRoot, "packs", name, version, "package"),
    tarball: join(fixtureRoot, "tarballs", fixtureTarballFileName(name, version)),
    versionDocument: join(fixtureRoot, "packs", name, version, "version-document.json"),
  };
}

function readPackEntry(catalog, name, version) {
  const packs = catalog?.packs && typeof catalog.packs === "object" ? catalog.packs : {};
  const key = catalogKey(name, version);
  const entry = packs[key];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  return { key, entry };
}

function resolveFixtureFile(fixtureRoot, maybeRel) {
  if (!maybeRel || typeof maybeRel !== "string") return null;
  const resolved = isAbsolute(maybeRel) ? maybeRel : join(fixtureRoot, maybeRel);
  const root = resolve(fixtureRoot);
  const full = resolve(resolved);
  const rel = relative(root, full);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new AcquireError(`catalog path escapes fixture root: ${maybeRel}`, "invalid_catalog");
  }
  return full;
}

function acquireFixture({ name, version, fixtureRoot, destDir, clock, maxBytes, catalogRetrievedAt }) {
  const mode = "fixture";
  const { path: catalogPath, catalog } = readCatalog(fixtureRoot);
  const pack = readPackEntry(catalog, name, version);
  const paths = fixturePaths(fixtureRoot, name, version);
  const retrievedAt = clock ?? catalog?.capturedAt ?? catalogRetrievedAt ?? clockNow(clock);

  if (pack?.entry?.coverage === COVERAGE.MISSING) {
    return failResult({
      name,
      version,
      mode,
      label: labelForMode(mode, pack.entry.label),
      retrievedAt,
      coverage: COVERAGE.MISSING,
      path: catalogPath,
      notes: pack.entry.notes || "catalog marks this name@version as missing",
      error: { code: "not_found", message: `${name}@${version} is missing in the fixture catalog` },
    });
  }

  const unpackedRel = pack?.entry?.unpacked;
  const tarballRel = pack?.entry?.tarball;
  const pageRel = pack?.entry?.versionDocument;
  const unpackedDir = resolveFixtureFile(fixtureRoot, unpackedRel) || (existsSync(join(paths.unpacked, "package.json")) ? paths.unpacked : null);
  const tarballPath = resolveFixtureFile(fixtureRoot, tarballRel) || (existsSync(paths.tarball) ? paths.tarball : null);
  const pagePath = resolveFixtureFile(fixtureRoot, pageRel) || (existsSync(paths.versionDocument) ? paths.versionDocument : null);
  const declaredCoverage = pack?.entry?.coverage;
  const label = labelForMode(mode, pack?.entry?.label);

  if (declaredCoverage === COVERAGE.PARTIAL_PAGE || (!unpackedDir && !tarballPath && pagePath)) {
    const bytes = pagePath && existsSync(pagePath) ? readFileSync(pagePath) : null;
    const sha = bytes ? sha256Hex(bytes) : null;
    return failResult({
      name,
      version,
      mode,
      label,
      retrievedAt,
      coverage: COVERAGE.PARTIAL_PAGE,
      path: pagePath || catalogPath,
      sha256: sha,
      sha256Of: bytes ? "version-document" : null,
      notes: pack?.entry?.notes || "registry/version page only; no package tarball or unpacked tree",
      error: {
        code: "partial_page",
        message: `${name}@${version} has partial page coverage (no extractable source tree)`,
      },
    });
  }

  if (!unpackedDir && !tarballPath) {
    return failResult({
      name,
      version,
      mode,
      label,
      retrievedAt,
      coverage: COVERAGE.MISSING,
      path: catalogPath,
      notes: "name@version is not in the fixture catalog and no unpacked tree or tarball was found",
      error: { code: "not_found", message: `${name}@${version} is not present in fixture root ${fixtureRoot}` },
    });
  }

  let rootDir = null;
  let extracted = false;
  let extract = null;
  let usedTarball = null;
  let notes = pack?.entry?.notes || null;

  if (unpackedDir && isRegularFile(join(unpackedDir, "package.json"))) {
    try {
      assertNoSymlinks(unpackedDir);
    } catch (error) {
      const code = error instanceof AcquireError ? error.code : "unsafe_tarball";
      return failResult({
        name,
        version,
        mode,
        label,
        retrievedAt,
        coverage: COVERAGE.MISSING,
        path: unpackedDir,
        notes: "unpacked fixture tree contains a symlink; refusing",
        error: { code, message: error instanceof Error ? error.message : String(error) },
      });
    }
    rootDir = unpackedDir;
  } else if (tarballPath) {
    const dest = uniqueDestDir(destDir, name, version);
    const tarballDest = join(dest, fixtureTarballFileName(name, version));
    copyFileBounded(tarballPath, tarballDest, maxBytes);
    try {
      const extractedResult = extractTarball(tarballDest, join(dest, "extract"));
      rootDir = extractedResult.rootDir;
      extract = extractedResult.extract;
      extracted = true;
      usedTarball = tarballDest;
    } catch (error) {
      const code = error instanceof AcquireError ? error.code : "extract_failed";
      return failResult({
        name,
        version,
        mode,
        label,
        retrievedAt,
        coverage: COVERAGE.MISSING,
        path: tarballPath,
        tarballPath,
        sha256: sha256Hex(readFileSync(tarballPath)),
        sha256Of: "tarball",
        notes: "fixture tarball refused or failed to extract",
        error: { code, message: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  if (!rootDir) {
    return failResult({
      name,
      version,
      mode,
      label,
      retrievedAt,
      coverage: COVERAGE.MISSING,
      path: unpackedDir || tarballPath,
      notes: "fixture files exist but no package.json root could be resolved",
      error: { code: "missing_package_root", message: `${name}@${version} has no package.json root` },
    });
  }

  const identity = readPackageIdentity(rootDir);
  if (identity.ok === false) {
    return failResult({
      name,
      version,
      mode,
      label,
      retrievedAt,
      coverage: COVERAGE.PARTIAL_PAGE,
      path: rootDir,
      notes: "package.json unreadable",
      error: identity.error,
    });
  }
  if (identity.name !== name || identity.version !== version) {
    return failResult({
      name,
      version,
      mode,
      label,
      retrievedAt,
      coverage: COVERAGE.PARTIAL_PAGE,
      path: rootDir,
      notes: `package.json identity ${identity.name}@${identity.version} does not match requested ${name}@${version}`,
      error: {
        code: "identity_mismatch",
        message: `package.json is ${identity.name}@${identity.version}, requested ${name}@${version}`,
      },
    });
  }

  let sha256;
  let sha256Of;
  if (tarballPath && existsSync(tarballPath)) {
    sha256 = pack?.entry?.tarballSha256 || sha256Hex(readFileSync(tarballPath));
    sha256Of = "tarball";
    usedTarball = usedTarball || tarballPath;
    if (pack?.entry?.tarballSha256 && sha256Hex(readFileSync(tarballPath)) !== pack.entry.tarballSha256) {
      return failResult({
        name,
        version,
        mode,
        label,
        retrievedAt,
        coverage: COVERAGE.MISSING,
        path: tarballPath,
        tarballPath,
        sha256: sha256Hex(readFileSync(tarballPath)),
        sha256Of: "tarball",
        notes: "fixture tarball sha256 does not match catalog",
        error: { code: "integrity_mismatch", message: "fixture tarball sha256 does not match catalog.tarballSha256" },
      });
    }
  } else {
    sha256 = hashUnpackedTree(rootDir);
    sha256Of = "unpacked-tree";
    notes = [notes, "unpacked fixture directory; no tarball bytes in catalog"].filter(Boolean).join("; ");
  }

  if (existsSync(join(rootDir, "LIFECYCLE_RAN.txt")) || (usedTarball && existsSync(join(dirname(rootDir), "LIFECYCLE_RAN.txt")))) {
    return failResult({
      name,
      version,
      mode,
      label,
      retrievedAt,
      coverage: COVERAGE.MISSING,
      path: rootDir,
      sha256,
      sha256Of,
      tarballPath: usedTarball,
      notes: "lifecycle marker present; refusing to treat as inert source",
      error: { code: "lifecycle_detected", message: "LIFECYCLE_RAN.txt present after acquire" },
    });
  }

  return freezeResult({
    ok: true,
    rootDir,
    provenance: provenanceBase({
      name,
      version,
      mode,
      label,
      url: null,
      path: rootDir,
      retrievedAt,
      sha256,
      sha256Of,
      coverage: COVERAGE.FULL_TARBALL,
      tarballPath: usedTarball || tarballPath || null,
      extracted,
      notes,
      extract,
    }),
  });
}

function readPackageIdentity(rootDir) {
  const manifestPath = join(rootDir, "package.json");
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (!parsed || typeof parsed !== "object") {
      return { ok: false, error: { code: "invalid_json", message: "package.json is not an object" } };
    }
    return { ok: true, name: parsed.name, version: parsed.version, manifestPath };
  } catch (error) {
    return {
      ok: false,
      error: { code: "invalid_json", message: error instanceof Error ? error.message : String(error) },
    };
  }
}

async function acquireLive(input) {
  const {
    name,
    version,
    destDir,
    clock,
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    maxJsonBytes = DEFAULT_MAX_JSON_BYTES,
    registry = DEFAULT_REGISTRY,
    expectedTarballSha256 = null,
  } = input;
  const mode = "live";
  const label = LABEL.LIVE_CAPTURE;
  const retrievedAt = clockNow(clock);
  try {
    parseRegistryOrigin(registry);
  } catch (error) {
    return failResult({
      name,
      version,
      mode,
      label,
      retrievedAt,
      coverage: COVERAGE.MISSING,
      url: typeof registry === "string" ? registry : null,
      error: {
        code: error instanceof AcquireError ? error.code : "url_not_allowlisted",
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }

  const docUrl = versionDocumentUrl(registry, name, version);
  if (!isAllowedSourceUrl(docUrl, registry)) {
    return failResult({
      name,
      version,
      mode,
      label,
      retrievedAt,
      coverage: COVERAGE.MISSING,
      url: docUrl,
      error: { code: "url_not_allowlisted", message: `version document URL refused: ${docUrl}` },
    });
  }

  const doc = await downloadBytes(docUrl, {
    fetchImpl,
    timeoutMs,
    maxBytes: maxJsonBytes,
    accept: "application/json",
  });
  if (!doc.ok) {
    return failResult({
      name,
      version,
      mode,
      label,
      retrievedAt,
      coverage: COVERAGE.MISSING,
      url: docUrl,
      notes: "live version document was not retrieved",
      error: { code: doc.code, message: doc.message },
    });
  }

  let body;
  try {
    body = JSON.parse(doc.bytes.toString("utf8"));
  } catch {
    return failResult({
      name,
      version,
      mode,
      label,
      retrievedAt,
      coverage: COVERAGE.PARTIAL_PAGE,
      url: docUrl,
      sha256: sha256Hex(doc.bytes),
      sha256Of: "version-document",
      notes: "live version document is not JSON",
      error: { code: "invalid_json", message: "live version document is not JSON" },
    });
  }

  const pageSha = sha256Hex(doc.bytes);
  const docName = typeof body?.name === "string" ? body.name : null;
  const docVersion = typeof body?.version === "string" ? body.version : null;
  if (docName && docName !== name) {
    return failResult({
      name,
      version,
      mode,
      label,
      retrievedAt,
      coverage: COVERAGE.PARTIAL_PAGE,
      url: docUrl,
      sha256: pageSha,
      sha256Of: "version-document",
      notes: "version document name does not match the request",
      error: { code: "identity_mismatch", message: `document name ${docName} !== ${name}` },
    });
  }
  if (docVersion && docVersion !== version) {
    return failResult({
      name,
      version,
      mode,
      label,
      retrievedAt,
      coverage: COVERAGE.PARTIAL_PAGE,
      url: docUrl,
      sha256: pageSha,
      sha256Of: "version-document",
      notes: "version document version does not match the request",
      error: { code: "identity_mismatch", message: `document version ${docVersion} !== ${version}` },
    });
  }

  const tarballUrl = typeof body?.dist?.tarball === "string" ? body.dist.tarball : registryTarballUrl(registry, name, version);
  if (!isAllowedSourceUrl(tarballUrl, registry)) {
    return failResult({
      name,
      version,
      mode,
      label,
      retrievedAt,
      coverage: COVERAGE.PARTIAL_PAGE,
      url: docUrl,
      sha256: pageSha,
      sha256Of: "version-document",
      notes: `tarball host is not allowlisted: ${tarballUrl}`,
      error: { code: "url_not_allowlisted", message: `tarball URL refused: ${tarballUrl}` },
    });
  }

  const tarball = await downloadBytes(tarballUrl, {
    fetchImpl,
    timeoutMs,
    maxBytes,
    accept: "application/octet-stream",
  });
  if (!tarball.ok) {
    return failResult({
      name,
      version,
      mode,
      label,
      retrievedAt,
      coverage: COVERAGE.PARTIAL_PAGE,
      url: tarballUrl,
      sha256: pageSha,
      sha256Of: "version-document",
      notes: "version document retrieved; tarball was not",
      error: { code: tarball.code, message: tarball.message },
    });
  }

  const tarballSha = sha256Hex(tarball.bytes);
  if (expectedTarballSha256 && expectedTarballSha256 !== tarballSha) {
    return failResult({
      name,
      version,
      mode,
      label,
      retrievedAt,
      coverage: COVERAGE.MISSING,
      url: tarballUrl,
      sha256: tarballSha,
      sha256Of: "tarball",
      notes: "downloaded tarball sha256 does not match expectedTarballSha256",
      error: { code: "integrity_mismatch", message: "tarball sha256 does not match expectedTarballSha256" },
    });
  }
  const integrity = verifyNpmIntegrity(tarball.bytes, body?.dist?.integrity);
  if (!integrity.ok) {
    return failResult({
      name,
      version,
      mode,
      label,
      retrievedAt,
      coverage: COVERAGE.MISSING,
      url: tarballUrl,
      sha256: tarballSha,
      sha256Of: "tarball",
      notes: "tarball failed dist.integrity check; not extracted",
      error: { code: integrity.code, message: integrity.message },
    });
  }

  const dest = uniqueDestDir(destDir, name, version);
  const tarballPath = join(dest, fixtureTarballFileName(name, version));
  writeFileSync(tarballPath, tarball.bytes);

  let extracted;
  try {
    extracted = extractTarball(tarballPath, join(dest, "extract"));
  } catch (error) {
    const code = error instanceof AcquireError ? error.code : "extract_failed";
    return failResult({
      name,
      version,
      mode,
      label,
      retrievedAt,
      coverage: COVERAGE.MISSING,
      url: tarballUrl,
      path: tarballPath,
      tarballPath,
      sha256: tarballSha,
      sha256Of: "tarball",
      notes: "live tarball saved but extract refused",
      error: { code, message: error instanceof Error ? error.message : String(error) },
    });
  }

  const identity = readPackageIdentity(extracted.rootDir);
  if (identity.ok === false || identity.name !== name || identity.version !== version) {
    return failResult({
      name,
      version,
      mode,
      label,
      retrievedAt,
      coverage: COVERAGE.PARTIAL_PAGE,
      url: tarballUrl,
      path: extracted.rootDir,
      tarballPath,
      sha256: tarballSha,
      sha256Of: "tarball",
      notes: "extracted package.json identity does not match the request",
      error: {
        code: "identity_mismatch",
        message: identity.ok === false
          ? identity.error.message
          : `extracted ${identity.name}@${identity.version}, requested ${name}@${version}`,
      },
    });
  }

  return freezeResult({
    ok: true,
    rootDir: extracted.rootDir,
    provenance: provenanceBase({
      name,
      version,
      mode,
      label,
      url: tarballUrl,
      path: extracted.rootDir,
      retrievedAt,
      sha256: tarballSha,
      sha256Of: "tarball",
      coverage: COVERAGE.FULL_TARBALL,
      tarballPath,
      extracted: true,
      notes: "live-capture from free registry tarball; scripts were not run",
      extract: extracted.extract,
    }),
  });
}

/**
 * @param {{
 *   name: string,
 *   version: string,
 *   mode?: "fixture"|"live",
 *   fixtureRoot?: string,
 *   destDir?: string,
 *   clock?: string,
 *   fetchImpl?: typeof fetch,
 *   timeoutMs?: number,
 *   maxBytes?: number,
 *   registry?: string,
 *   expectedTarballSha256?: string|null,
 * }} input
 * @returns {Promise<{ schema: string, ok: boolean, rootDir: string|null, provenance: object }>}
 */
export async function acquire(input = {}) {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    throw new AcquireError("acquire() requires an object");
  }
  const name = assertSafePackageName(input.name);
  const version = assertExactVersion(input.version);
  const mode = assertMode(input.mode);
  const fixtureRoot = resolve(input.fixtureRoot || DEFAULT_FIXTURE_ROOT);
  const maxBytes = Number.isSafeInteger(input.maxBytes) && input.maxBytes > 0 ? input.maxBytes : DEFAULT_MAX_BYTES;

  if (mode === "fixture") {
    return acquireFixture({
      name,
      version,
      fixtureRoot,
      destDir: input.destDir,
      clock: input.clock,
      maxBytes,
    });
  }

  return acquireLive({
    name,
    version,
    destDir: input.destDir,
    clock: input.clock,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
    maxBytes,
    maxJsonBytes: input.maxJsonBytes,
    registry: input.registry,
    expectedTarballSha256: input.expectedTarballSha256,
  });
}

/**
 * Acquire both sides of an old → new comparison. Failures are returned, not thrown,
 * except for invalid input (same as acquire).
 */
export async function acquirePair(input = {}) {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    throw new AcquireError("acquirePair() requires an object");
  }
  const name = assertSafePackageName(input.name);
  const oldVersion = assertExactVersion(input.oldVersion);
  const newVersion = assertExactVersion(input.newVersion);
  const shared = { ...input, name };
  const [oldResult, newResult] = await Promise.all([
    acquire({ ...shared, version: oldVersion }),
    acquire({ ...shared, version: newVersion }),
  ]);
  return Object.freeze({
    schema: "s127.upgrade-impact.acquire-pair.v1",
    name,
    oldVersion,
    newVersion,
    old: oldResult,
    new: newResult,
  });
}

export function defaultFixtureRoot() {
  return DEFAULT_FIXTURE_ROOT;
}
