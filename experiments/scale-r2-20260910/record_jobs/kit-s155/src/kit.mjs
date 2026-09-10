/**
 * S155 source-record job kit orchestrator.
 * ONE journey: clean-install / example / change-output / partial / refusal
 * over Heavy 01..04 (S154) + native 05..07 (+ kit as 08 packaging layer).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUILTIN_JOB_IDS,
  DRY_RUN_NOTE,
  ERROR_CODES,
  FORBIDDEN_FIELDS,
  HEAVY_JOB_IDS,
  HEAVY_PIN_BRANCH,
  HEAVY_PIN_REPO,
  HEAVY_PIN_SHA,
  INPUT_SCHEMA,
  JOB_STATUS,
  JOURNEY_SCHEMA,
  KIT_STATUS,
  MANIFEST_SCHEMA,
  MUTATION_BOUNDARY,
  NATIVE_JOB_IDS,
  SCHEMA,
  CSV_WRAPPER_NOTE,
} from "./constants.mjs";
import { probeCsvS154Semantics, runCsvDriftCli } from "./csv-wrapper.mjs";
import {
  defaultHeavyFixtureArgs,
  partialHeavyFixtureArgs,
  resolveHeavyRoot,
  spawnHeavyJob,
} from "./heavy-invoke.mjs";
import { partialNativeFixture, resolveNativeRoot, runNativeJob } from "./native-invoke.mjs";

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

function kitError(code, message, details = null) {
  const err = new Error(message);
  err.code = code;
  err.details = details;
  return err;
}

function loadJsonFile(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadJobCatalog(catalogDir = CATALOG_DIR) {
  const catalog = new Map();
  if (!existsSync(catalogDir)) return catalog;
  for (const name of readdirSync(catalogDir).sort()) {
    if (!name.endsWith(".json")) continue;
    const job = loadJsonFile(join(catalogDir, name));
    if (!job?.id || typeof job.id !== "string") {
      throw kitError(ERROR_CODES.INVALID_INPUT, `Catalog file ${name} missing string id`, {
        file: name,
      });
    }
    catalog.set(job.id, { ...job, _sourceFile: name });
  }
  return catalog;
}

export function buildKitManifest(options = {}) {
  const catalog = options.catalog || loadJobCatalog(options.catalogDir || CATALOG_DIR);
  const heavy = resolveHeavyRoot(options);
  const jobs = [];
  for (const id of BUILTIN_JOB_IDS) {
    const j = catalog.get(id);
    if (!j) {
      jobs.push({
        id,
        status: JOB_STATUS.UNKNOWN,
        note: "Builtin id declared but catalog JSON missing",
      });
      continue;
    }
    jobs.push({
      id: j.id,
      title: j.title || j.id,
      status: j.status,
      jobRef: j.jobRef || null,
      packageSlot: j.packageSlot || null,
      ownedBy: j.ownedBy || null,
      module: j.module || null,
      note: j.note || null,
    });
  }
  return {
    schema: MANIFEST_SCHEMA,
    generatedAt: (options.clock || (() => Date.now()))(),
    heavyPin: {
      repo: HEAVY_PIN_REPO,
      sha: HEAVY_PIN_SHA,
      branch: HEAVY_PIN_BRANCH,
      root: heavy.root,
      found: heavy.found,
      source: heavy.source,
    },
    dryRunNote: DRY_RUN_NOTE,
    csvWrapperNote: CSV_WRAPPER_NOTE,
    mutationBoundary: MUTATION_BOUNDARY,
    jobs,
    summary: {
      readyCount: jobs.filter((x) => x.status === JOB_STATUS.READY).length,
      metaCount: jobs.filter((x) => x.status === JOB_STATUS.META).length,
      unknownCount: jobs.filter((x) => x.status === JOB_STATUS.UNKNOWN).length,
      heavyJobCount: HEAVY_JOB_IDS.length,
      nativeJobCount: NATIVE_JOB_IDS.length,
    },
  };
}

export function validateKitRequest(raw) {
  if (!isPlainObject(raw)) {
    throw kitError(ERROR_CODES.INVALID_INPUT, "Request must be a plain object");
  }
  const forbidden = hasForbiddenField(raw);
  if (forbidden) {
    throw kitError(ERROR_CODES.FORBIDDEN_CLAIM, `Forbidden field present: ${forbidden}`, {
      field: forbidden,
    });
  }
  const jobIds = raw.jobIds;
  if (!Array.isArray(jobIds) || jobIds.length === 0) {
    throw kitError(ERROR_CODES.INVALID_INPUT, "jobIds must be a non-empty string array");
  }
  for (const id of jobIds) {
    if (typeof id !== "string" || !id.trim()) {
      throw kitError(ERROR_CODES.INVALID_INPUT, "Each jobId must be a non-empty string");
    }
  }
  return {
    schema: raw.schema || INPUT_SCHEMA,
    requestId: typeof raw.requestId === "string" ? raw.requestId : "anonymous",
    jobIds: [...jobIds],
    note: typeof raw.note === "string" ? raw.note : null,
  };
}

export async function runKitJob(jobId, options = {}) {
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

  if (jobId === "source-record-kit") {
    return {
      jobId,
      title: job.title,
      status: JOB_STATUS.META,
      note: job.note || "This kit package is the 08 packaging / journey layer.",
      output: {
        role: "packaging_layer",
        kitPackage: "kit-s155",
        includes: [...HEAVY_JOB_IDS, ...NATIVE_JOB_IDS],
      },
    };
  }

  if (HEAVY_JOB_IDS.includes(jobId)) {
    if (jobId === "csv-drift" && options.csvViaWrapper) {
      return runCsvDriftCli(options);
    }
    const argv =
      options.heavyArgv?.[jobId] ||
      (options.usePartialFixtures
        ? partialHeavyFixtureArgs(jobId, resolveHeavyRoot(options).root)
        : null);
    return spawnHeavyJob(jobId, argv, options);
  }

  if (NATIVE_JOB_IDS.includes(jobId)) {
    const inputPath =
      options.nativeInputPaths?.[jobId] ||
      (options.usePartialFixtures
        ? (() => {
            const sib = resolveNativeRoot(jobId, options);
            return sib.found ? partialNativeFixture(jobId, sib.root) : null;
          })()
        : null);
    return runNativeJob(jobId, inputPath, options);
  }

  return {
    jobId,
    status: JOB_STATUS.UNKNOWN,
    error: { code: ERROR_CODES.UNKNOWN_JOB, message: `No runner for ${jobId}` },
    output: null,
  };
}

export async function runKitRequest(rawRequest, options = {}) {
  const clock = options.clock || (() => Date.now());
  const catalog = options.catalog || loadJobCatalog(options.catalogDir || CATALOG_DIR);
  const manifest = buildKitManifest({ ...options, catalog, clock });

  let request;
  try {
    request = validateKitRequest(rawRequest);
  } catch (err) {
    return {
      schema: SCHEMA,
      status: KIT_STATUS.REJECTED,
      generatedAt: clock(),
      requestId: isPlainObject(rawRequest) ? rawRequest.requestId || null : null,
      error: {
        code: err.code || ERROR_CODES.INVALID_INPUT,
        message: err.message,
        details: err.details || null,
      },
      jobs: [],
      dryRunNote: DRY_RUN_NOTE,
      mutationBoundary: MUTATION_BOUNDARY,
      hasInvestmentRecommendation: false,
    };
  }

  const slots = [];
  let readyCount = 0;
  let partialCount = 0;
  let unavailableCount = 0;
  let rejectedCount = 0;
  let metaCount = 0;
  let unknownCount = 0;

  for (const id of request.jobIds) {
    const slot = await runKitJob(id, { ...options, catalog, clock });
    slots.push(slot);
    if (slot.status === JOB_STATUS.READY) readyCount += 1;
    else if (slot.status === JOB_STATUS.PARTIAL_INPUT) partialCount += 1;
    else if (
      slot.status === JOB_STATUS.UNAVAILABLE_HEAVY ||
      slot.status === JOB_STATUS.UNAVAILABLE_NATIVE
    ) {
      unavailableCount += 1;
    } else if (slot.status === JOB_STATUS.REJECTED) rejectedCount += 1;
    else if (slot.status === JOB_STATUS.META) metaCount += 1;
    else if (slot.status === JOB_STATUS.UNKNOWN) unknownCount += 1;
  }

  let status;
  const actionable = request.jobIds.length - metaCount;
  if (rejectedCount === request.jobIds.length || (readyCount === 0 && partialCount === 0 && unavailableCount === 0 && metaCount === 0)) {
    status = KIT_STATUS.REJECTED;
  } else if (readyCount + metaCount === request.jobIds.length) {
    status = KIT_STATUS.READY;
  } else if (readyCount > 0 || partialCount > 0 || unavailableCount > 0 || metaCount > 0) {
    status = KIT_STATUS.PARTIAL;
  } else {
    status = KIT_STATUS.REJECTED;
  }

  // All-unknown / all-rejected without ready → rejected
  if (readyCount === 0 && metaCount === 0 && (unknownCount > 0 || rejectedCount > 0) && partialCount === 0 && unavailableCount === 0) {
    status = KIT_STATUS.REJECTED;
  }

  return {
    schema: SCHEMA,
    status,
    generatedAt: clock(),
    requestId: request.requestId,
    requestedJobIds: request.jobIds,
    jobs: slots,
    manifestSummary: manifest.summary,
    summary: {
      readyCount,
      partialCount,
      unavailableCount,
      rejectedCount,
      metaCount,
      unknownCount,
      actionable,
      note: "Factual kit slot counts only. No investment recommendation. Parsers not reimplemented.",
    },
    dryRunNote: DRY_RUN_NOTE,
    csvWrapperNote: CSV_WRAPPER_NOTE,
    mutationBoundary: MUTATION_BOUNDARY,
    hasInvestmentRecommendation: false,
  };
}

/**
 * Clean-install check: package.json present + documented zero-dep kit run.
 */
export function runCleanInstallCheck(options = {}) {
  const root = options.packageRoot || PACKAGE_ROOT;
  const pkgPath = join(root, "package.json");
  const cliPath = join(root, "src", "cli.mjs");
  const checks = [];
  checks.push({ name: "package.json", pass: existsSync(pkgPath), path: pkgPath });
  checks.push({ name: "cli.mjs", pass: existsSync(cliPath), path: cliPath });
  let pkg = null;
  if (existsSync(pkgPath)) {
    pkg = loadJsonFile(pkgPath);
    checks.push({
      name: "zero_runtime_deps",
      pass: !pkg.dependencies || Object.keys(pkg.dependencies).length === 0,
      note: "Kit itself is zero-dep; Heavy deps live under HEAVY_S134_ROOT",
    });
    checks.push({
      name: "type_module",
      pass: pkg.type === "module",
    });
    checks.push({
      name: "engines_node20",
      pass: Boolean(pkg.engines?.node),
    });
  }
  const heavy = resolveHeavyRoot(options);
  checks.push({
    name: "heavy_s134_root",
    pass: heavy.found,
    path: heavy.root,
    source: heavy.source,
  });
  for (const id of NATIVE_JOB_IDS) {
    const sib = resolveNativeRoot(id, options);
    checks.push({
      name: `native_${id}`,
      pass: sib.found,
      path: sib.root,
      mode: sib.mode,
    });
  }
  return {
    ok: checks.every((c) => c.pass),
    checks,
    packageName: pkg?.name || null,
  };
}

/**
 * ONE literal journey: clean-install → example → change-output → partial → refusal.
 */
export async function runKitJourney(options = {}) {
  const outDir = options.demoOutDir || DEMO_OUT_DIR;
  mkdirSync(outDir, { recursive: true });
  const clock = options.clock || (() => Date.parse("2026-09-10T20:00:00.000Z"));
  const catalog = options.catalog || loadJobCatalog(options.catalogDir || CATALOG_DIR);

  // 1) clean-install
  const cleanInstall = runCleanInstallCheck(options);

  // 2) example: Heavy openapi + pricing + csv + feed + native route-regression
  const exampleJobs = [
    "openapi-impact",
    "pricing-table-change",
    "csv-drift",
    "rss-atom-brief",
    "route-regression",
    "source-record-kit",
  ];
  const example = await runKitRequest(
    {
      schema: INPUT_SCHEMA,
      requestId: "s155-example-positive",
      jobIds: exampleJobs,
      note: "Positive example over real Heavy + native fixtures",
    },
    { ...options, catalog, clock },
  );

  // Optional: also exercise deadline + dependency in change-output evidence
  const nativeExtras = await runKitRequest(
    {
      requestId: "s155-native-extras",
      jobIds: ["deadline-calendar", "dependency-footprint"],
    },
    { ...options, catalog, clock },
  );

  // 3) change-output already captured below as written JSON

  // 4) partial: force missing native sibling OR use partial fixtures + missing heavy override
  const partial = await runKitRequest(
    {
      requestId: "s155-partial",
      jobIds: ["openapi-impact", "route-regression", "csv-drift"],
    },
    {
      ...options,
      catalog,
      clock,
      // Force missing native for partial demonstration
      nativeRoots: options.partialNativeRoots || {
        "route-regression": "/tmp/r2-record-kit-s155-missing-05",
      },
      // Optionally force missing heavy
      heavyRoot: options.partialHeavyRoot,
      usePartialFixtures: options.usePartialFixtures === true,
    },
  );

  // If heavy still available and native missing → expect partial with unavailable_native
  // Also run a missing-fixture partial when explicit missing path supplied
  let partialMissingFixture = null;
  if (options.includeMissingFixturePartial !== false) {
    partialMissingFixture = await runKitRequest(
      {
        requestId: "s155-partial-missing-fixture",
        jobIds: ["route-regression"],
      },
      {
        ...options,
        catalog,
        clock,
        nativeInputPaths: {
          "route-regression": "/tmp/r2-record-kit-s155-missing-fixture.json",
        },
      },
    );
  }

  // 5) refusal: forbidden claim + malformed / unknown
  const refusalForbidden = await runKitRequest(
    {
      requestId: "s155-refusal-forbidden",
      jobIds: ["openapi-impact"],
      investmentRecommendation: "buy now",
    },
    { ...options, catalog, clock },
  );
  const refusalUnknown = await runKitRequest(
    {
      requestId: "s155-refusal-unknown",
      jobIds: ["not-a-real-job"],
    },
    { ...options, catalog, clock },
  );
  const refusalMalformed = await runKitRequest("not-an-object", {
    ...options,
    catalog,
    clock,
  });

  const manifest = buildKitManifest({ ...options, catalog, clock });
  const csvProbe = await probeCsvS154Semantics(options);

  const journey = {
    schema: JOURNEY_SCHEMA,
    journey: true,
    generatedAt: clock(),
    note: "ONE S155 source-record kit journey: clean-install / example / change-output / partial / refusal. Heavy pin 65ce1867; CSV included via wrapper.",
    heavyPin: manifest.heavyPin,
    csvWrapperNote: CSV_WRAPPER_NOTE,
    steps: [
      { name: "clean-install", result: cleanInstall },
      { name: "example", result: example },
      { name: "native-extras", result: nativeExtras },
      { name: "partial-missing-native", result: partial },
      { name: "partial-missing-fixture", result: partialMissingFixture },
      { name: "refusal-forbidden", result: refusalForbidden },
      { name: "refusal-unknown", result: refusalUnknown },
      { name: "refusal-malformed", result: refusalMalformed },
      { name: "csv-s154-probe", result: csvProbe },
      { name: "manifest", result: manifest },
    ],
    hasInvestmentRecommendation: false,
  };

  // change-output: write structured JSON
  writeFileSync(join(outDir, "journey.json"), JSON.stringify(journey, null, 2) + "\n");
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(join(outDir, "clean-install.json"), JSON.stringify(cleanInstall, null, 2) + "\n");
  writeFileSync(join(outDir, "example.json"), JSON.stringify(example, null, 2) + "\n");
  writeFileSync(join(outDir, "native-extras.json"), JSON.stringify(nativeExtras, null, 2) + "\n");
  writeFileSync(join(outDir, "partial.json"), JSON.stringify(partial, null, 2) + "\n");
  writeFileSync(
    join(outDir, "partial-missing-fixture.json"),
    JSON.stringify(partialMissingFixture, null, 2) + "\n",
  );
  writeFileSync(
    join(outDir, "refusal-forbidden.json"),
    JSON.stringify(refusalForbidden, null, 2) + "\n",
  );
  writeFileSync(
    join(outDir, "refusal-unknown.json"),
    JSON.stringify(refusalUnknown, null, 2) + "\n",
  );
  writeFileSync(
    join(outDir, "refusal-malformed.json"),
    JSON.stringify(refusalMalformed, null, 2) + "\n",
  );
  writeFileSync(join(outDir, "csv-s154-probe.json"), JSON.stringify(csvProbe, null, 2) + "\n");

  return journey;
}

export {
  isPlainObject,
  hasForbiddenField,
  kitError,
  loadJsonFile,
  defaultHeavyFixtureArgs,
  resolveHeavyRoot,
  resolveNativeRoot,
};
