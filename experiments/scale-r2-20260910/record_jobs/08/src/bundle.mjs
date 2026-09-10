/**
 * Recurring job bundle: declare native 05..07 jobs + Heavy 01..04 stubs,
 * wire real public/synthetic fixtures, and produce reproducible outputs by
 * dynamically importing sibling job libraries when available.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  BUNDLE_STATUS,
  BUILTIN_JOB_IDS,
  DEFAULT_SIBLING_ROOTS,
  DRY_RUN_NOTE,
  ERROR_CODES,
  FORBIDDEN_FIELDS,
  HEAVY_STUB_NOTE,
  INPUT_SCHEMA,
  JOB_STATUS,
  MANIFEST_SCHEMA,
  MUTATION_BOUNDARY,
  NATIVE_JOB_IDS,
  RELATIVE_SIBLING_DIRS,
  SCHEMA,
  SIBLING_BOUNDARY_NOTE,
} from "./constants.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = join(__dirname, "..");
export const CATALOG_DIR = join(PACKAGE_ROOT, "catalog");
export const FIXTURES_DIR = join(PACKAGE_ROOT, "fixtures");
export const DEMO_OUT_DIR = join(PACKAGE_ROOT, "demo-out");

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function hasForbiddenField(obj, path = "") {
  if (!isPlainObject(obj) && !Array.isArray(obj)) return null;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const hit = hasForbiddenField(obj[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  for (const key of Object.keys(obj)) {
    if (FORBIDDEN_FIELDS.includes(key)) {
      return path ? `${path}.${key}` : key;
    }
    const hit = hasForbiddenField(obj[key], path ? `${path}.${key}` : key);
    if (hit) return hit;
  }
  return null;
}

function bundleError(code, message, details = null) {
  const err = new Error(message);
  err.code = code;
  err.details = details;
  return err;
}

function loadJsonFile(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Load all job catalog JSON files from catalog/.
 * @returns {Map<string, object>}
 */
export function loadJobCatalog(catalogDir = CATALOG_DIR) {
  const catalog = new Map();
  if (!existsSync(catalogDir)) return catalog;
  for (const name of readdirSync(catalogDir).sort()) {
    if (!name.endsWith(".json")) continue;
    const job = loadJsonFile(join(catalogDir, name));
    if (!job?.id || typeof job.id !== "string") {
      throw bundleError(
        ERROR_CODES.INVALID_INPUT,
        `Catalog file ${name} missing string id`,
        { file: name },
      );
    }
    catalog.set(job.id, { ...job, _sourceFile: name });
  }
  return catalog;
}

/**
 * Build the recurring job manifest (native ready slots + Heavy stubs).
 */
export function buildJobManifest(options = {}) {
  const catalog = options.catalog || loadJobCatalog(options.catalogDir || CATALOG_DIR);
  const jobs = [];
  for (const id of BUILTIN_JOB_IDS) {
    const j = catalog.get(id);
    if (!j) {
      jobs.push({
        id,
        status: JOB_STATUS.UNKNOWN,
        note: "Builtin id declared but catalog JSON missing from catalog/",
      });
      continue;
    }
    jobs.push({
      id: j.id,
      title: j.title || j.id,
      status: j.status,
      jobRef: j.jobRef || null,
      packageSlot: j.packageSlot || null,
      schema: j.schema || null,
      inputSchema: j.inputSchema || null,
      buildExport: j.buildExport || null,
      defaultFixture: j.defaultFixture || null,
      ownedBy: j.ownedBy || null,
      note: j.note || null,
    });
  }
  for (const [id, j] of catalog) {
    if (BUILTIN_JOB_IDS.includes(id)) continue;
    jobs.push({
      id: j.id,
      title: j.title || j.id,
      status: j.status,
      jobRef: j.jobRef || null,
      packageSlot: j.packageSlot || null,
      schema: j.schema || null,
      inputSchema: j.inputSchema || null,
      buildExport: j.buildExport || null,
      defaultFixture: j.defaultFixture || null,
      ownedBy: j.ownedBy || null,
      note: j.note || null,
    });
  }
  return {
    schema: MANIFEST_SCHEMA,
    generatedAt: (options.clock || (() => Date.now()))(),
    dryRunNote: DRY_RUN_NOTE,
    heavyStubNote: HEAVY_STUB_NOTE,
    siblingBoundaryNote: SIBLING_BOUNDARY_NOTE,
    jobs,
    summary: {
      readyCount: jobs.filter((x) => x.status === JOB_STATUS.READY).length,
      ownedByHeavyCount: jobs.filter((x) => x.status === JOB_STATUS.OWNED_BY_HEAVY)
        .length,
      unknownCount: jobs.filter((x) => x.status === JOB_STATUS.UNKNOWN).length,
    },
  };
}

/**
 * Resolve sibling package root for a native job id.
 * Prefers options.siblingRoots override, then absolute DEFAULT_SIBLING_ROOTS,
 * then relative ../05|06|07 beside this package.
 */
export function resolveSiblingRoot(jobId, options = {}) {
  const overrides = options.siblingRoots || {};
  const candidates = [];
  // When an explicit siblingRoots entry is provided for this job, use ONLY that
  // path (tests/demo can force missing siblings without falling through).
  if (Object.prototype.hasOwnProperty.call(overrides, jobId)) {
    if (typeof overrides[jobId] === "string") {
      candidates.push({ mode: "override", root: resolve(overrides[jobId]) });
    }
    // null/undefined override ⇒ treat as intentionally missing
  } else {
    if (DEFAULT_SIBLING_ROOTS[jobId]) {
      candidates.push({ mode: "absolute_worktree", root: DEFAULT_SIBLING_ROOTS[jobId] });
    }
    const rel = RELATIVE_SIBLING_DIRS[jobId];
    if (rel) {
      candidates.push({
        mode: "relative",
        root: resolve(options.packageRoot || PACKAGE_ROOT, rel),
      });
    }
  }
  const searched = [];
  for (const c of candidates) {
    const indexPath = join(c.root, "src", "index.mjs");
    searched.push(indexPath);
    if (existsSync(indexPath)) {
      return { found: true, mode: c.mode, root: c.root, indexPath, searched };
    }
  }
  return { found: false, mode: "missing", root: null, indexPath: null, searched };
}

/**
 * Resolve fixture path for a job run: explicit path, else catalog default under fixtures/.
 */
export function resolveJobFixture(job, requestJob, options = {}) {
  const packageRoot = options.packageRoot || PACKAGE_ROOT;
  const fixturesDir = options.fixturesDir || FIXTURES_DIR;
  const tried = [];

  if (requestJob?.inputPath && typeof requestJob.inputPath === "string") {
    const abs = resolve(packageRoot, requestJob.inputPath);
    tried.push(abs);
    if (existsSync(abs)) return { path: abs, source: "request", tried };
  }

  if (job?.defaultFixture && typeof job.defaultFixture === "string") {
    const abs = resolve(fixturesDir, job.defaultFixture);
    tried.push(abs);
    if (existsSync(abs)) return { path: abs, source: "embedded_default", tried };
    const fromRoot = resolve(packageRoot, job.defaultFixture);
    tried.push(fromRoot);
    if (existsSync(fromRoot)) return { path: fromRoot, source: "embedded_default", tried };
  }

  return { path: null, source: "missing", tried };
}

/**
 * Schema-shape check for embedded fixture when sibling is unavailable.
 * Does not invent job results — only confirms fixture is a plain object with schema/id-ish fields.
 */
export function validateEmbeddedFixtureShape(raw, job) {
  if (!isPlainObject(raw)) {
    return { ok: false, message: "Fixture must be a plain object" };
  }
  const forbidden = hasForbiddenField(raw);
  if (forbidden) {
    return { ok: false, message: `Forbidden field present: ${forbidden}`, field: forbidden };
  }
  if (job?.inputSchema && raw.schema && raw.schema !== job.inputSchema) {
    return {
      ok: false,
      message: `Fixture schema ${raw.schema} does not match expected ${job.inputSchema}`,
    };
  }
  return { ok: true };
}

/**
 * Dynamically import sibling and invoke its build export.
 */
export async function runNativeJob(jobId, inputPath, options = {}) {
  const catalog = options.catalog || loadJobCatalog(options.catalogDir || CATALOG_DIR);
  const job = catalog.get(jobId);
  if (!job) {
    return {
      jobId,
      status: JOB_STATUS.UNKNOWN,
      error: { code: ERROR_CODES.UNKNOWN_JOB, message: `Unknown job id: ${jobId}` },
      output: null,
    };
  }
  if (job.status === JOB_STATUS.OWNED_BY_HEAVY) {
    return {
      jobId,
      title: job.title || jobId,
      status: JOB_STATUS.OWNED_BY_HEAVY,
      jobRef: job.jobRef || null,
      note: job.note || HEAVY_STUB_NOTE,
      output: null,
    };
  }
  if (job.status !== JOB_STATUS.READY) {
    return {
      jobId,
      title: job.title || jobId,
      status: job.status,
      note: job.note || "Job not marked ready in catalog",
      output: null,
    };
  }

  const fixture = resolveJobFixture(job, { inputPath }, options);
  if (!fixture.path) {
    return {
      jobId,
      title: job.title || jobId,
      status: JOB_STATUS.REJECTED,
      error: {
        code: ERROR_CODES.MISSING_FIXTURE,
        message: `No fixture found for job ${jobId}`,
        tried: fixture.tried,
      },
      output: null,
    };
  }

  let raw;
  try {
    raw = loadJsonFile(fixture.path);
  } catch (e) {
    return {
      jobId,
      title: job.title || jobId,
      status: JOB_STATUS.REJECTED,
      error: {
        code: ERROR_CODES.INVALID_INPUT,
        message: `Failed to parse fixture: ${e.message}`,
        path: fixture.path,
      },
      output: null,
    };
  }

  const sibling = resolveSiblingRoot(jobId, options);
  if (!sibling.found) {
    const shape = validateEmbeddedFixtureShape(raw, job);
    if (!shape.ok) {
      return {
        jobId,
        title: job.title || jobId,
        status: JOB_STATUS.REJECTED,
        dependencyMode: "missing",
        fixturePath: fixture.path,
        fixtureSource: fixture.source,
        error: {
          code: shape.field ? ERROR_CODES.FORBIDDEN_CLAIM : ERROR_CODES.INVALID_INPUT,
          message: shape.message,
          field: shape.field || null,
        },
        output: null,
        searched: sibling.searched,
      };
    }
    // Partial: fixture present + schema ok, but sibling library missing — do not invent.
    return {
      jobId,
      title: job.title || jobId,
      status: JOB_STATUS.UNAVAILABLE_SIBLING,
      jobRef: job.jobRef || null,
      packageSlot: job.packageSlot || null,
      dependencyMode: "missing",
      fixturePath: fixture.path,
      fixtureSource: fixture.source,
      fixtureSchema: raw.schema || null,
      note: "Sibling package missing; embedded fixture validated for shape only. No invented job output.",
      error: {
        code: ERROR_CODES.MISSING_SIBLING,
        message: `Sibling index.mjs not found for ${jobId}`,
        searched: sibling.searched,
      },
      output: null,
      searched: sibling.searched,
    };
  }

  let mod;
  try {
    mod = await import(pathToFileURL(sibling.indexPath).href);
  } catch (e) {
    return {
      jobId,
      title: job.title || jobId,
      status: JOB_STATUS.UNAVAILABLE_SIBLING,
      dependencyMode: sibling.mode,
      siblingRoot: sibling.root,
      fixturePath: fixture.path,
      error: {
        code: ERROR_CODES.MISSING_SIBLING,
        message: `Failed to import sibling: ${e.message}`,
        indexPath: sibling.indexPath,
      },
      output: null,
    };
  }

  const exportName = job.buildExport;
  const buildFn = exportName && typeof mod[exportName] === "function" ? mod[exportName] : null;
  if (!buildFn) {
    return {
      jobId,
      title: job.title || jobId,
      status: JOB_STATUS.UNAVAILABLE_SIBLING,
      dependencyMode: sibling.mode,
      siblingRoot: sibling.root,
      fixturePath: fixture.path,
      error: {
        code: ERROR_CODES.MISSING_SIBLING,
        message: `Sibling missing build export ${exportName}`,
        indexPath: sibling.indexPath,
      },
      output: null,
    };
  }

  const clock = options.clock || (() => Date.now());
  let output;
  try {
    output = buildFn(raw, { clock });
  } catch (e) {
    return {
      jobId,
      title: job.title || jobId,
      status: JOB_STATUS.REJECTED,
      dependencyMode: sibling.mode,
      siblingRoot: sibling.root,
      fixturePath: fixture.path,
      fixtureSource: fixture.source,
      error: {
        code: e.code || ERROR_CODES.INVALID_INPUT,
        message: e.message,
        details: e.details || null,
      },
      output: null,
    };
  }

  const nestedStatus = output?.status;
  let status = JOB_STATUS.READY;
  if (nestedStatus === "rejected") status = JOB_STATUS.REJECTED;
  else if (nestedStatus === "partial_input") status = JOB_STATUS.PARTIAL_INPUT;
  else if (nestedStatus === "ready") status = JOB_STATUS.READY;
  else status = JOB_STATUS.READY;

  return {
    jobId,
    title: job.title || jobId,
    status,
    jobRef: job.jobRef || null,
    packageSlot: job.packageSlot || null,
    dependencyMode: sibling.mode,
    siblingRoot: sibling.root,
    fixturePath: fixture.path,
    fixtureSource: fixture.source,
    output,
  };
}

/**
 * Validate a bundle request.
 */
export function validateBundleRequest(raw) {
  if (!isPlainObject(raw)) {
    throw bundleError(ERROR_CODES.INVALID_INPUT, "Request must be a plain object");
  }
  const forbidden = hasForbiddenField(raw);
  if (forbidden) {
    throw bundleError(
      ERROR_CODES.FORBIDDEN_CLAIM,
      `Forbidden field present: ${forbidden}`,
      { field: forbidden },
    );
  }
  const jobs = raw.jobs;
  if (!Array.isArray(jobs) || jobs.length === 0) {
    throw bundleError(
      ERROR_CODES.INVALID_INPUT,
      "jobs must be a non-empty array of { id, inputPath? }",
    );
  }
  const normalizedJobs = [];
  for (const entry of jobs) {
    if (typeof entry === "string") {
      if (!entry.trim()) {
        throw bundleError(ERROR_CODES.INVALID_INPUT, "Each job id must be a non-empty string");
      }
      normalizedJobs.push({ id: entry, inputPath: null });
      continue;
    }
    if (!isPlainObject(entry) || typeof entry.id !== "string" || !entry.id.trim()) {
      throw bundleError(
        ERROR_CODES.INVALID_INPUT,
        "Each jobs[] entry must be a string id or { id, inputPath? }",
      );
    }
    normalizedJobs.push({
      id: entry.id,
      inputPath: typeof entry.inputPath === "string" ? entry.inputPath : null,
    });
  }
  return {
    schema: raw.schema || INPUT_SCHEMA,
    requestId: typeof raw.requestId === "string" ? raw.requestId : "anonymous",
    jobs: normalizedJobs,
    note: typeof raw.note === "string" ? raw.note : null,
  };
}

/**
 * Run the recurring job bundle for the requested job ids.
 */
export async function runBundle(rawRequest, options = {}) {
  const clock = options.clock || (() => Date.now());
  const catalog = options.catalog || loadJobCatalog(options.catalogDir || CATALOG_DIR);
  const manifest = buildJobManifest({ ...options, catalog, clock });

  let request;
  try {
    request = validateBundleRequest(rawRequest);
  } catch (err) {
    return {
      schema: SCHEMA,
      status: BUNDLE_STATUS.REJECTED,
      generatedAt: clock(),
      requestId: isPlainObject(rawRequest) ? rawRequest.requestId || null : null,
      error: {
        code: err.code || ERROR_CODES.INVALID_INPUT,
        message: err.message,
        details: err.details || null,
      },
      jobs: [],
      dryRunNote: DRY_RUN_NOTE,
      heavyStubNote: HEAVY_STUB_NOTE,
      mutationBoundary: MUTATION_BOUNDARY,
      siblingBoundaryNote: SIBLING_BOUNDARY_NOTE,
      hasInvestmentRecommendation: false,
    };
  }

  const slots = [];
  let readyCount = 0;
  let partialInputCount = 0;
  let unavailableSiblingCount = 0;
  let ownedByHeavyCount = 0;
  let unknownCount = 0;
  let rejectedCount = 0;

  for (const reqJob of request.jobs) {
    const slot = await runNativeJob(reqJob.id, reqJob.inputPath, {
      ...options,
      catalog,
      clock,
    });
    // Attach requested inputPath for clarity
    slot.requestedInputPath = reqJob.inputPath;
    slots.push(slot);

    if (slot.status === JOB_STATUS.READY) readyCount += 1;
    else if (slot.status === JOB_STATUS.PARTIAL_INPUT) partialInputCount += 1;
    else if (slot.status === JOB_STATUS.UNAVAILABLE_SIBLING) unavailableSiblingCount += 1;
    else if (slot.status === JOB_STATUS.OWNED_BY_HEAVY) ownedByHeavyCount += 1;
    else if (slot.status === JOB_STATUS.UNKNOWN) unknownCount += 1;
    else if (slot.status === JOB_STATUS.REJECTED) rejectedCount += 1;
  }

  // Bundle status:
  // - ready: every requested slot is READY
  // - partial: any unavailable_sibling / owned_by_heavy / partial_input / mix
  // - rejected: every slot is REJECTED or UNKNOWN (or request-level reject above)
  let status;
  if (readyCount === request.jobs.length) {
    status = BUNDLE_STATUS.READY;
  } else if (
    readyCount > 0 ||
    partialInputCount > 0 ||
    unavailableSiblingCount > 0 ||
    ownedByHeavyCount > 0
  ) {
    status = BUNDLE_STATUS.PARTIAL;
  } else {
    status = BUNDLE_STATUS.REJECTED;
  }

  return {
    schema: SCHEMA,
    status,
    generatedAt: clock(),
    requestId: request.requestId,
    requestedJobIds: request.jobs.map((j) => j.id),
    jobs: slots,
    manifestSummary: manifest.summary,
    summary: {
      readyCount,
      partialInputCount,
      unavailableSiblingCount,
      ownedByHeavyCount,
      unknownCount,
      rejectedCount,
      note: "Factual job slot counts only. No investment recommendation. Heavy 01..04 not reimplemented.",
    },
    dryRunNote: DRY_RUN_NOTE,
    heavyStubNote: HEAVY_STUB_NOTE,
    mutationBoundary: MUTATION_BOUNDARY,
    siblingBoundaryNote: SIBLING_BOUNDARY_NOTE,
    hasInvestmentRecommendation: false,
  };
}

/**
 * Offline demo journey: positive (05+06+07), partial (missing sibling + heavy), negative.
 */
export async function runDemoJourney(options = {}) {
  const outDir = options.demoOutDir || DEMO_OUT_DIR;
  mkdirSync(outDir, { recursive: true });
  const clock = options.clock || (() => Date.parse("2026-09-10T19:00:00.000Z"));
  const fixturesDir = options.fixturesDir || FIXTURES_DIR;

  const positivePath = join(fixturesDir, "positive-bundle.json");
  const partialPath = join(fixturesDir, "partial-missing-sibling.json");
  const negativePath = join(fixturesDir, "negative-forbidden.json");
  const unknownPath = join(fixturesDir, "negative-unknown-job.json");

  const positive = await runBundle(loadJsonFile(positivePath), { ...options, clock });
  const partial = await runBundle(loadJsonFile(partialPath), {
    ...options,
    clock,
    // Force missing siblings for partial demo unless caller overrides
    siblingRoots:
      options.partialSiblingRoots ||
      options.siblingRoots || {
        "route-regression": "/tmp/r2-record-jobs-08-missing-05",
        "deadline-calendar": "/tmp/r2-record-jobs-08-missing-06",
        "dependency-footprint": "/tmp/r2-record-jobs-08-missing-07",
      },
  });
  const negative = await runBundle(loadJsonFile(negativePath), { ...options, clock });
  const unknown = await runBundle(loadJsonFile(unknownPath), { ...options, clock });
  const manifest = buildJobManifest({ ...options, clock });

  const journey = {
    schema: SCHEMA,
    journey: true,
    generatedAt: clock(),
    note: "Offline recurring-job-bundle journey. Synthetic fixtures only; Heavy 01..04 owned_by_heavy stubs.",
    steps: [
      { name: "manifest", result: manifest },
      { name: "positive-bundle", result: positive },
      { name: "partial-missing-sibling", result: partial },
      { name: "negative-forbidden", result: negative },
      { name: "negative-unknown-job", result: unknown },
    ],
    hasInvestmentRecommendation: false,
  };

  writeFileSync(join(outDir, "journey.json"), JSON.stringify(journey, null, 2) + "\n");
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(join(outDir, "positive.json"), JSON.stringify(positive, null, 2) + "\n");
  writeFileSync(join(outDir, "partial.json"), JSON.stringify(partial, null, 2) + "\n");
  writeFileSync(join(outDir, "negative.json"), JSON.stringify(negative, null, 2) + "\n");
  writeFileSync(join(outDir, "unknown.json"), JSON.stringify(unknown, null, 2) + "\n");

  return journey;
}

export {
  isPlainObject,
  hasForbiddenField,
  bundleError,
  loadJsonFile,
};
