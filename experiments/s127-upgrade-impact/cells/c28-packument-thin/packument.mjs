/**
 * Offline-first thin reader for npm packument JSON.
 *
 * Default mode is fixture (saved JSON). Live GET is opt-in (`mode: "live"` or
 * `live: true`). Extracts versions, dist.tarball, deprecated. Records lifecycle
 * script names and never executes them. Does not download or extract tarballs.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CATALOG_SCHEMA,
  CELL_ID,
  COVERAGE,
  DEFAULT_FIXTURE_ROOT,
  DEFAULT_LIMITATIONS,
  DEFAULT_MAX_JSON_BYTES,
  DEFAULT_REGISTRY,
  DEFAULT_TIMEOUT_MS,
  INSTALL_SCRIPTS,
  KIND,
  LABEL,
  LIFECYCLE_SCRIPTS,
  MODE,
  PACKUMENT_ACCEPT,
  SCHEMA,
  USER_AGENT,
} from "./constants.mjs";
import { downloadJson, liveTargetUrl } from "./live.mjs";
import {
  assertExactVersion,
  assertSafePackageName,
  inspectRegularFile,
  isAllowedSourceUrl,
  PackumentError,
  resolveFixturePath,
} from "./paths.mjs";

export {
  CATALOG_SCHEMA,
  CELL_ID,
  COVERAGE,
  DEFAULT_FIXTURE_ROOT,
  DEFAULT_LIMITATIONS,
  DEFAULT_MAX_JSON_BYTES,
  DEFAULT_REGISTRY,
  DEFAULT_TIMEOUT_MS,
  INSTALL_SCRIPTS,
  KIND,
  LABEL,
  LIFECYCLE_SCRIPTS,
  MODE,
  PACKUMENT_ACCEPT,
  SCHEMA,
  USER_AGENT,
} from "./constants.mjs";

export {
  assertExactVersion,
  assertSafePackageName,
  encodePackageNameForRegistryPath,
  isAllowedSourceUrl,
  packumentUrl,
  parseRegistryOrigin,
  PackumentError,
  versionDocumentUrl,
} from "./paths.mjs";

const LIFECYCLE_SET = new Set(LIFECYCLE_SCRIPTS);
const INSTALL_SET = new Set(INSTALL_SCRIPTS);

export function sha256Hex(value) {
  const input = typeof value === "string" || Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return createHash("sha256").update(input).digest("hex");
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function ownKeys(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return [];
  return Object.keys(obj).filter((key) => key !== "__proto__" && key !== "constructor" && key !== "prototype");
}

function requireClock(clock) {
  if (clock == null || clock === "") {
    return {
      ok: false,
      code: "missing_clock",
      message: "operator clock is required; this cell does not invent Date.now()",
    };
  }
  if (typeof clock !== "string" || !clock.trim() || clock !== clock.trim()) {
    return { ok: false, code: "invalid_clock", message: "clock must be a trimmed ISO-8601 string" };
  }
  return { ok: true, clock };
}

function assertMode(mode, liveFlag) {
  if (liveFlag === true && (mode == null || mode === MODE.LIVE)) return MODE.LIVE;
  if (liveFlag === true && mode === MODE.FIXTURE) {
    throw new PackumentError('live: true conflicts with mode: "fixture"', "invalid_mode");
  }
  if (mode == null) return MODE.FIXTURE;
  if (mode !== MODE.FIXTURE && mode !== MODE.LIVE) {
    throw new PackumentError(`mode must be "fixture" or "live", got ${JSON.stringify(mode)}`, "invalid_mode");
  }
  return mode;
}

function parseJsonBytes(buffer) {
  let text = buffer.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return JSON.parse(text);
}

export function listLifecycleScripts(entry) {
  const present = [];
  const seen = new Set();
  const scripts = entry?.scripts;
  if (Array.isArray(scripts)) {
    for (const name of scripts) {
      if (typeof name === "string" && LIFECYCLE_SET.has(name) && !seen.has(name)) {
        seen.add(name);
        present.push({ name, command: null });
      }
    }
  } else if (scripts && typeof scripts === "object") {
    for (const name of LIFECYCLE_SCRIPTS) {
      if (Object.prototype.hasOwnProperty.call(scripts, name) && typeof scripts[name] === "string") {
        seen.add(name);
        present.push({ name, command: scripts[name] });
      }
    }
  }
  return present;
}

export function hasInstallScript(entry) {
  if (entry && entry.hasInstallScript === true) return true;
  const names = new Set(listLifecycleScripts(entry).map((row) => row.name));
  for (const name of INSTALL_SET) {
    if (names.has(name)) return true;
  }
  return false;
}

function readDeprecated(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return { present: false, value: null };
  }
  if (!Object.prototype.hasOwnProperty.call(entry, "deprecated")) {
    return { present: false, value: null };
  }
  const value = entry.deprecated;
  if (value === false || value == null) return { present: true, value: null };
  if (value === true) return { present: true, value: true };
  if (typeof value === "string") return { present: true, value };
  return { present: true, value: String(value) };
}

function readDist(entry, registry = null) {
  const dist = entry?.dist;
  if (!dist || typeof dist !== "object" || Array.isArray(dist)) {
    return {
      tarball: null,
      integrity: null,
      shasum: null,
      unpackedSize: null,
      fileCount: null,
      tarballHostTrusted: null,
    };
  }
  const tarball = typeof dist.tarball === "string" && dist.tarball.trim() ? dist.tarball.trim() : null;
  let tarballHostTrusted = null;
  if (tarball && registry) {
    tarballHostTrusted = isAllowedSourceUrl(tarball, registry);
  } else if (tarball) {
    tarballHostTrusted = isAllowedSourceUrl(tarball, DEFAULT_REGISTRY);
  }
  return {
    tarball,
    integrity: typeof dist.integrity === "string" ? dist.integrity : null,
    shasum: typeof dist.shasum === "string" ? dist.shasum : null,
    unpackedSize: Number.isFinite(dist.unpackedSize) ? dist.unpackedSize : null,
    fileCount: Number.isFinite(dist.fileCount) ? dist.fileCount : null,
    tarballHostTrusted,
  };
}

function classifyKind(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return KIND.UNKNOWN;
  const versions = doc.versions;
  if (versions && typeof versions === "object" && !Array.isArray(versions) && ownKeys(versions).length > 0) {
    return KIND.PACKUMENT;
  }
  if (typeof doc.version === "string" && doc.version.trim()) return KIND.VERSION_DOCUMENT;
  return KIND.UNKNOWN;
}

function slimHint(doc) {
  if (!doc || typeof doc !== "object") return false;
  if (typeof doc._note === "string" && /slim/i.test(doc._note)) return true;
  if (typeof doc.coverage === "string" && /slim/i.test(doc.coverage)) return true;
  return false;
}

function classifyDocumentCoverage(kind, versionRows, { slim = false } = {}) {
  if (kind === KIND.UNKNOWN) return COVERAGE.PARTIAL_PAGE;
  if (kind === KIND.VERSION_DOCUMENT) {
    const row = versionRows[0];
    if (row?.dist?.tarball) return COVERAGE.VERSION_DOCUMENT;
    return COVERAGE.PARTIAL_PAGE;
  }
  if (!versionRows.length) return COVERAGE.PARTIAL_PAGE;
  const withTarball = versionRows.filter((row) => row.dist?.tarball).length;
  if (slim || withTarball < versionRows.length) return COVERAGE.SLIM_PACKUMENT;
  return COVERAGE.FULL_PACKUMENT;
}

function normalizeVersionEntry(version, entry, { time = null, registry = null } = {}) {
  const deprecated = readDeprecated(entry);
  const dist = readDist(entry, registry);
  const lifecycle = listLifecycleScripts(entry);
  const explicitHasInstall = entry && entry.hasInstallScript === true;
  return Object.freeze({
    version,
    deprecated: deprecated.value,
    deprecatedPresent: deprecated.present,
    dist: Object.freeze(dist),
    time: typeof time === "string" ? time : null,
    lifecycleScripts: Object.freeze(lifecycle.map((row) => row.name)),
    lifecycleCommands: Object.freeze(lifecycle),
    hasInstallScript: explicitHasInstall || hasInstallScript(entry),
    hasPrepareScript: lifecycle.some((row) => row.name === "prepare" || row.name === "preprepare" || row.name === "postprepare"),
  });
}

function readDistTags(doc) {
  const tags = doc?.["dist-tags"];
  if (!tags || typeof tags !== "object" || Array.isArray(tags)) return null;
  const out = {};
  for (const key of ownKeys(tags)) {
    if (typeof tags[key] === "string" && tags[key].trim()) out[key] = tags[key].trim();
  }
  return Object.keys(out).length ? Object.freeze(out) : null;
}

function readTimeMap(doc) {
  const time = doc?.time;
  if (!time || typeof time !== "object" || Array.isArray(time)) return { map: {}, modified: null, created: null };
  const map = {};
  for (const key of ownKeys(time)) {
    if (typeof time[key] === "string") map[key] = time[key];
  }
  return {
    map,
    modified: typeof time.modified === "string" ? time.modified : null,
    created: typeof time.created === "string" ? time.created : null,
  };
}

export function parsePackumentDocument(doc, options = {}) {
  if (doc == null) {
    return { ok: false, code: "missing_document", message: "packument document is required" };
  }
  if (typeof doc !== "object" || Array.isArray(doc)) {
    return { ok: false, code: "invalid_document", message: "packument must be a JSON object" };
  }

  const requestedName = options.name ? assertSafePackageName(options.name) : null;
  const kind = classifyKind(doc);
  const pkgName = firstString(doc.name, requestedName);
  const distTags = readDistTags(doc);
  const time = readTimeMap(doc);
  const registry = options.registry || DEFAULT_REGISTRY;
  const versions = {};

  if (kind === KIND.PACKUMENT) {
    for (const version of ownKeys(doc.versions)) {
      const entry = doc.versions[version];
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const ver = firstString(entry.version, version);
      if (!ver) continue;
      versions[ver] = normalizeVersionEntry(ver, entry, {
        time: time.map[ver] || null,
        registry,
      });
    }
  } else if (kind === KIND.VERSION_DOCUMENT) {
    const ver = firstString(doc.version);
    versions[ver] = normalizeVersionEntry(ver, doc, {
      time: firstString(doc.published_at, doc.publishedAt, time.map[ver]),
      registry,
    });
  }

  const versionRows = Object.values(versions);
  const coverage = classifyDocumentCoverage(kind, versionRows, {
    slim: slimHint(doc) || options.coverageHint === COVERAGE.SLIM_PACKUMENT,
  });

  if (requestedName && pkgName && requestedName !== pkgName) {
    return {
      ok: false,
      code: "identity_mismatch",
      message: `document name ${pkgName} !== ${requestedName}`,
      kind,
      name: pkgName,
      distTags,
      versions,
      coverage,
    };
  }

  return {
    ok: true,
    kind,
    name: pkgName,
    distTags,
    timeModified: time.modified,
    timeCreated: time.created,
    versions,
    versionCount: versionRows.length,
    coverage,
    slim: slimHint(doc),
  };
}

export function selectPair(parsed, oldVersion, newVersion) {
  const oldV = assertExactVersion(oldVersion);
  const newV = assertExactVersion(newVersion);
  const old = parsed?.versions?.[oldV] ?? null;
  const next = parsed?.versions?.[newV] ?? null;
  const missing = [];
  const missingTarball = [];
  if (!old) missing.push(oldV);
  else if (!old.dist?.tarball) missingTarball.push(oldV);
  if (!next) missing.push(newV);
  else if (!next.dist?.tarball) missingTarball.push(newV);

  const complete = missing.length === 0 && missingTarball.length === 0;
  let coverage = "complete";
  if (missing.length === 2) coverage = "missing";
  else if (missing.length || missingTarball.length) coverage = "partial";

  const unknownReasons = [];
  if (missing.length) {
    unknownReasons.push({ code: "missing_version", versions: missing.slice() });
  }
  if (missingTarball.length) {
    unknownReasons.push({ code: "missing_tarball", versions: missingTarball.slice() });
  }

  return Object.freeze({
    ok: complete,
    oldVersion: oldV,
    newVersion: newV,
    old,
    new: next,
    missing: Object.freeze(missing),
    missingTarball: Object.freeze(missingTarball),
    sameVersion: oldV === newV,
    newerVersionAloneIsNotBreak: true,
    distTagLatest: parsed?.distTags?.latest ?? null,
    distTagLatestIsNotObservationVersion: true,
    coverage,
    unknownReasons: Object.freeze(unknownReasons),
    limitations: DEFAULT_LIMITATIONS,
  });
}

export function listVersions(parsed) {
  return Object.keys(parsed?.versions || {}).sort();
}

function provenanceRecord({
  url = null,
  path = null,
  retrievedAt,
  contentSha256 = null,
  coverage,
  label,
  bytes = null,
  mode,
  sha256Of = "packument-json",
  notes = null,
  accept = null,
  catalogPath = null,
}) {
  if (!Object.values(COVERAGE).includes(coverage)) {
    throw new PackumentError(`internal: invalid coverage ${coverage}`);
  }
  if (!Object.values(LABEL).includes(label)) {
    throw new PackumentError(`internal: invalid label ${label}`);
  }
  return Object.freeze({
    url,
    path,
    retrievedAt,
    contentSha256,
    coverage,
    label,
    bytes,
    mode,
    sha256Of,
    notes,
    accept,
    catalogPath,
    lifecycleScriptsRun: false,
    npmInstallRun: false,
    tarballExtracted: false,
  });
}

function failResult({
  code,
  message,
  clock = null,
  mode = MODE.FIXTURE,
  label = LABEL.FIXTURE,
  coverage = COVERAGE.MISSING,
  url = null,
  path = null,
  contentSha256 = null,
  bytes = null,
  notes = null,
  accept = null,
  catalogPath = null,
  name = null,
  extra = null,
}) {
  const retrievedAt = typeof clock === "string" ? clock : null;
  return Object.freeze({
    schema: SCHEMA,
    ok: false,
    code,
    message,
    kind: KIND.UNKNOWN,
    name,
    distTags: null,
    versions: Object.freeze({}),
    versionCount: 0,
    selection: null,
    unknownReasons: Object.freeze([{ code, message }]),
    limitations: DEFAULT_LIMITATIONS,
    provenance: provenanceRecord({
      url,
      path,
      retrievedAt,
      contentSha256,
      coverage,
      label,
      bytes,
      mode,
      notes,
      accept,
      catalogPath,
    }),
    execute: false,
    executed: false,
    paidDemand: false,
    ...(extra || {}),
  });
}

function freezeVersions(versions) {
  const out = {};
  for (const key of Object.keys(versions || {})) out[key] = versions[key];
  return Object.freeze(out);
}

function okResult({
  parsed,
  clock,
  mode,
  label,
  url,
  path,
  contentSha256,
  bytes,
  notes,
  accept = null,
  catalogPath = null,
  oldVersion = null,
  newVersion = null,
  versionsRequested = null,
}) {
  let selection = null;
  const unknownReasons = [];
  if (oldVersion != null && newVersion != null) {
    selection = selectPair(parsed, oldVersion, newVersion);
    for (const reason of selection.unknownReasons) unknownReasons.push(reason);
  } else if (Array.isArray(versionsRequested) && versionsRequested.length) {
    const missing = [];
    const missingTarball = [];
    for (const ver of versionsRequested) {
      const exact = assertExactVersion(ver);
      const row = parsed.versions[exact];
      if (!row) missing.push(exact);
      else if (!row.dist?.tarball) missingTarball.push(exact);
    }
    selection = Object.freeze({
      ok: missing.length === 0 && missingTarball.length === 0,
      versionsRequested: Object.freeze(versionsRequested.slice()),
      missing: Object.freeze(missing),
      missingTarball: Object.freeze(missingTarball),
      newerVersionAloneIsNotBreak: true,
      distTagLatest: parsed.distTags?.latest ?? null,
      distTagLatestIsNotObservationVersion: true,
      coverage: missing.length === versionsRequested.length ? "missing" : missing.length || missingTarball.length ? "partial" : "complete",
    });
    if (missing.length) unknownReasons.push({ code: "missing_version", versions: missing });
    if (missingTarball.length) unknownReasons.push({ code: "missing_tarball", versions: missingTarball });
  }

  return Object.freeze({
    schema: SCHEMA,
    ok: true,
    code: null,
    message: null,
    kind: parsed.kind,
    name: parsed.name,
    distTags: parsed.distTags,
    versions: freezeVersions(parsed.versions),
    versionCount: parsed.versionCount,
    timeModified: parsed.timeModified ?? null,
    timeCreated: parsed.timeCreated ?? null,
    selection,
    unknownReasons: Object.freeze(unknownReasons),
    limitations: DEFAULT_LIMITATIONS,
    provenance: provenanceRecord({
      url,
      path,
      retrievedAt: clock,
      contentSha256,
      coverage: parsed.coverage,
      label,
      bytes,
      mode,
      notes,
      accept,
      catalogPath,
    }),
    execute: false,
    executed: false,
    paidDemand: false,
  });
}

export function readCatalog(fixtureRoot = DEFAULT_FIXTURE_ROOT) {
  const path = join(fixtureRoot, "catalog.json");
  if (!existsSync(path)) return { path, catalog: null };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new PackumentError(`fixture catalog is not JSON: ${error.message}`, "invalid_catalog");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PackumentError("fixture catalog must be an object", "invalid_catalog");
  }
  if (parsed.schema !== CATALOG_SCHEMA) {
    throw new PackumentError(`fixture catalog schema mismatch: ${parsed.schema}`, "invalid_catalog");
  }
  return { path, catalog: parsed };
}

export function lookupCatalog(name, fixtureRoot = DEFAULT_FIXTURE_ROOT) {
  const { path, catalog } = readCatalog(fixtureRoot);
  if (!catalog) return { ok: false, code: "not_found", message: "fixture catalog missing", catalogPath: path };
  const packs = catalog.packs && typeof catalog.packs === "object" ? catalog.packs : {};
  const entry = packs[name];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return { ok: false, code: "not_found", message: `${name} is not in the packument fixture catalog`, catalogPath: path };
  }
  const confined = resolveFixturePath(entry.path, fixtureRoot);
  if (!confined.ok) return { ...confined, catalogPath: path };
  return {
    ok: true,
    path: confined.path,
    coverageHint: entry.coverage || null,
    originalUrl: entry.originalUrl || null,
    originalRetrievedAt: entry.originalRetrievedAt || null,
    catalogPath: path,
    entry,
  };
}

function labelFromCatalog(entryLabel, fallback = LABEL.FIXTURE) {
  if (typeof entryLabel === "string" && Object.values(LABEL).includes(entryLabel)) return entryLabel;
  return fallback;
}

export function readPackumentFile(path, options = {}) {
  const clock = options.clock;
  const clockCheck = requireClock(clock);
  if (!clockCheck.ok) {
    return failResult({
      code: clockCheck.code,
      message: clockCheck.message,
      mode: MODE.FIXTURE,
      path,
    });
  }
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_JSON_BYTES;
  const inspected = inspectRegularFile(path);
  if (!inspected.ok) {
    return failResult({
      code: inspected.code,
      message: inspected.message,
      clock: clockCheck.clock,
      mode: MODE.FIXTURE,
      label: options.label || LABEL.FIXTURE,
      path,
    });
  }
  if (inspected.size > maxBytes) {
    return failResult({
      code: "oversize",
      message: `file exceeds ${maxBytes} byte budget: ${path}`,
      clock: clockCheck.clock,
      mode: MODE.FIXTURE,
      label: options.label || LABEL.FIXTURE,
      path,
      bytes: inspected.size,
    });
  }
  const buffer = readFileSync(path);
  const contentSha256 = sha256Hex(buffer);
  let doc;
  try {
    doc = parseJsonBytes(buffer);
  } catch (error) {
    return failResult({
      code: "invalid_json",
      message: error instanceof Error ? error.message : String(error),
      clock: clockCheck.clock,
      mode: MODE.FIXTURE,
      label: options.label || LABEL.FIXTURE,
      coverage: COVERAGE.PARTIAL_PAGE,
      path,
      contentSha256,
      bytes: buffer.length,
      notes: "saved bytes are not JSON",
    });
  }

  const parsed = parsePackumentDocument(doc, {
    name: options.name,
    coverageHint: options.coverageHint,
    registry: options.registry,
  });
  if (!parsed.ok) {
    return failResult({
      code: parsed.code,
      message: parsed.message,
      clock: clockCheck.clock,
      mode: MODE.FIXTURE,
      label: options.label || LABEL.FIXTURE,
      coverage: parsed.coverage || COVERAGE.PARTIAL_PAGE,
      path,
      contentSha256,
      bytes: buffer.length,
      name: parsed.name || options.name || null,
    });
  }

  const notes = [
    options.notes,
    parsed.slim ? "slim extract: not the full registry packument" : null,
    options.originalUrl ? `copied from prior capture ${options.originalUrl}` : null,
    options.originalRetrievedAt ? `originalRetrievedAt=${options.originalRetrievedAt}` : null,
  ]
    .filter(Boolean)
    .join("; ") || null;

  try {
    return okResult({
      parsed,
      clock: clockCheck.clock,
      mode: MODE.FIXTURE,
      label: options.label || LABEL.FIXTURE,
      url: options.originalUrl || null,
      path,
      contentSha256,
      bytes: buffer.length,
      notes,
      catalogPath: options.catalogPath || null,
      oldVersion: options.oldVersion,
      newVersion: options.newVersion,
      versionsRequested: options.versions,
    });
  } catch (error) {
    const code = error instanceof PackumentError ? error.code : "invalid_input";
    return failResult({
      code,
      message: error instanceof Error ? error.message : String(error),
      clock: clockCheck.clock,
      mode: MODE.FIXTURE,
      label: options.label || LABEL.FIXTURE,
      path,
      contentSha256,
      bytes: buffer.length,
      name: parsed.name,
    });
  }
}

async function loadLive(input, clock) {
  const mode = MODE.LIVE;
  const label = LABEL.LIVE_CAPTURE;
  let name;
  try {
    name = assertSafePackageName(input.name);
  } catch (error) {
    return failResult({
      code: error instanceof PackumentError ? error.code : "invalid_name",
      message: error instanceof Error ? error.message : String(error),
      clock,
      mode,
      label,
    });
  }

  let target;
  try {
    target = liveTargetUrl({ ...input, name });
  } catch (error) {
    return failResult({
      code: error instanceof PackumentError ? error.code : "url_not_allowlisted",
      message: error instanceof Error ? error.message : String(error),
      clock,
      mode,
      label,
      name,
      url: typeof input.registry === "string" ? input.registry : DEFAULT_REGISTRY,
    });
  }

  const fetched = await downloadJson(target.url, {
    fetchImpl: input.fetchImpl ?? globalThis.fetch,
    timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBytes: input.maxBytes ?? DEFAULT_MAX_JSON_BYTES,
    accept: input.accept ?? PACKUMENT_ACCEPT,
  });
  if (!fetched.ok) {
    return failResult({
      code: fetched.code,
      message: fetched.message,
      clock,
      mode,
      label,
      name,
      url: target.url,
      notes: "live packument was not retrieved; no tarball was requested",
      accept: input.accept ?? PACKUMENT_ACCEPT,
    });
  }

  const contentSha256 = sha256Hex(fetched.bytes);
  let doc;
  try {
    doc = parseJsonBytes(fetched.bytes);
  } catch (error) {
    return failResult({
      code: "invalid_json",
      message: error instanceof Error ? error.message : String(error),
      clock,
      mode,
      label,
      coverage: COVERAGE.PARTIAL_PAGE,
      name,
      url: target.url,
      contentSha256,
      bytes: fetched.bytes.length,
      notes: "live body is not JSON",
      accept: input.accept ?? PACKUMENT_ACCEPT,
    });
  }

  const parsed = parsePackumentDocument(doc, {
    name,
    registry: target.registry,
  });
  if (!parsed.ok) {
    return failResult({
      code: parsed.code,
      message: parsed.message,
      clock,
      mode,
      label,
      coverage: parsed.coverage || COVERAGE.PARTIAL_PAGE,
      name: parsed.name || name,
      url: target.url,
      contentSha256,
      bytes: fetched.bytes.length,
      accept: input.accept ?? PACKUMENT_ACCEPT,
    });
  }

  try {
    return okResult({
      parsed,
      clock,
      mode,
      label,
      url: target.url,
      path: null,
      contentSha256,
      bytes: fetched.bytes.length,
      notes: `live-capture JSON GET; Accept=${input.accept ?? PACKUMENT_ACCEPT}; no tarball downloaded; no install scripts`,
      accept: input.accept ?? PACKUMENT_ACCEPT,
      oldVersion: input.oldVersion,
      newVersion: input.newVersion,
      versionsRequested: input.versions,
    });
  } catch (error) {
    const code = error instanceof PackumentError ? error.code : "invalid_input";
    return failResult({
      code,
      message: error instanceof Error ? error.message : String(error),
      clock,
      mode,
      label,
      name,
      url: target.url,
      contentSha256,
      bytes: fetched.bytes.length,
    });
  }
}

/**
 * Load a packument. Default `mode` is `"fixture"` (offline).
 * Live fetch requires `mode: "live"` or `live: true`.
 */
export async function loadPackument(input = {}) {
  const clockCheck = requireClock(input.clock);
  if (!clockCheck.ok) {
    return failResult({
      code: clockCheck.code,
      message: clockCheck.message,
      mode: MODE.FIXTURE,
      name: typeof input.name === "string" ? input.name : null,
      path: typeof input.path === "string" ? input.path : null,
    });
  }

  let mode;
  try {
    mode = assertMode(input.mode, input.live);
  } catch (error) {
    return failResult({
      code: error instanceof PackumentError ? error.code : "invalid_mode",
      message: error instanceof Error ? error.message : String(error),
      clock: clockCheck.clock,
    });
  }

  if (mode === MODE.LIVE) {
    if (!input.name) {
      return failResult({
        code: "missing_name",
        message: "live mode requires a package name",
        clock: clockCheck.clock,
        mode,
        label: LABEL.LIVE_CAPTURE,
      });
    }
    return loadLive(input, clockCheck.clock);
  }

  // Fixture / offline. Never call fetchImpl.
  const fixtureRoot = input.fixtureRoot || DEFAULT_FIXTURE_ROOT;
  let filePath = input.path || null;
  let label = input.label || LABEL.FIXTURE;
  let coverageHint = input.coverageHint || null;
  let originalUrl = input.originalUrl || null;
  let originalRetrievedAt = input.originalRetrievedAt || null;
  let catalogPath = null;
  let notes = input.notes || null;

  if (!filePath) {
    if (!input.name) {
      return failResult({
        code: "missing_path",
        message: "fixture mode requires path or catalog name",
        clock: clockCheck.clock,
        mode,
      });
    }
    let name;
    try {
      name = assertSafePackageName(input.name);
    } catch (error) {
      return failResult({
        code: error instanceof PackumentError ? error.code : "invalid_name",
        message: error instanceof Error ? error.message : String(error),
        clock: clockCheck.clock,
        mode,
      });
    }
    let looked;
    try {
      looked = lookupCatalog(name, fixtureRoot);
    } catch (error) {
      return failResult({
        code: error instanceof PackumentError ? error.code : "invalid_catalog",
        message: error instanceof Error ? error.message : String(error),
        clock: clockCheck.clock,
        mode,
        name,
      });
    }
    if (!looked.ok) {
      return failResult({
        code: looked.code,
        message: looked.message,
        clock: clockCheck.clock,
        mode,
        name,
        catalogPath: looked.catalogPath || null,
        notes: "offline default: not in fixture catalog; live fetch was not attempted",
      });
    }
    filePath = looked.path;
    label = labelFromCatalog(looked.entry?.label, LABEL.FIXTURE);
    coverageHint = looked.coverageHint;
    originalUrl = looked.originalUrl;
    originalRetrievedAt = looked.originalRetrievedAt;
    catalogPath = looked.catalogPath;
    notes = looked.entry?.notes || notes;
  } else {
    const confineRoot = input.confineRoot || (input.confineToFixtureRoot === true ? fixtureRoot : null);
    if (confineRoot) {
      const confined = resolveFixturePath(filePath, confineRoot);
      if (!confined.ok) {
        return failResult({
          code: confined.code,
          message: confined.message,
          clock: clockCheck.clock,
          mode,
          path: filePath,
        });
      }
      if (confined.external && input.allowExternalPath !== true) {
        return failResult({
          code: "path_escape",
          message: `path escapes confine root: ${filePath}`,
          clock: clockCheck.clock,
          mode,
          path: confined.path,
        });
      }
      filePath = confined.path;
    } else {
      const resolved = resolveFixturePath(filePath, fixtureRoot);
      if (!resolved.ok) {
        return failResult({
          code: resolved.code,
          message: resolved.message,
          clock: clockCheck.clock,
          mode,
          path: filePath,
        });
      }
      filePath = resolved.path;
    }
  }

  return readPackumentFile(filePath, {
    clock: clockCheck.clock,
    name: input.name,
    label,
    coverageHint,
    originalUrl,
    originalRetrievedAt,
    catalogPath,
    notes,
    oldVersion: input.oldVersion,
    newVersion: input.newVersion,
    versions: input.versions,
    maxBytes: input.maxBytes,
    registry: input.registry,
  });
}
