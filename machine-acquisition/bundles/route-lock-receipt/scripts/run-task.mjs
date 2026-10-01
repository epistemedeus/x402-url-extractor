#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { captureChallenge, readBoundedBody } from "./http-boundary.mjs";
import {
  mapDocumentedChallenge,
  projection,
  withChangedRecipient,
  withStaleObservation,
} from "./map-challenge.mjs";
import { acquireExecutableTree, matchArchiveTree } from "./package-cache.mjs";
import { attachObservation } from "./receipt.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PINS_PATH = join(ROOT, "references", "pins.json");
const MAX_LISTING_BYTES = 65536;
const FETCH_MS = 30000;
const RECEIPT_SCHEMA = "neomorphic.route-release-decision.receipt.v1";

const REFUSAL_FLAGS = ["pay", "settle", "publish", "sign", "reserve", "register", "deploy"];
const MUTATIONS = new Set(["none", "changed-recipient", "stale", "402-alone"]);

export function digest(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function assertPin(buffer, spec) {
  if (buffer.length !== spec.bytes) {
    const error = new Error(`byte length ${buffer.length} does not match pin ${spec.bytes}`);
    error.code = "pin_mismatch";
    throw error;
  }
  const got = digest(buffer);
  if (got !== spec.sha256) {
    const error = new Error("sha256 does not match the pin");
    error.code = "pin_mismatch";
    throw error;
  }
  return got;
}

export function assertArchiveMembers(names) {
  const kept = [];
  for (const name of names) {
    if (!name) continue;
    if (name.startsWith("/") || name.split("/").includes("..") || !name.startsWith("package/")) {
      const error = new Error(`refusing archive member ${name}`);
      error.code = "unsafe_archive";
      throw error;
    }
    kept.push(name);
  }
  if (kept.length === 0) {
    const error = new Error("archive has no package members");
    error.code = "unsafe_archive";
    throw error;
  }
  return kept;
}

export function refuseListing(document) {
  if (!document || document.kind !== "generic-directory-listing") {
    const error = new Error("listing-only requires kind generic-directory-listing");
    error.code = "unsupported_acquisition";
    throw error;
  }
  const error = new Error(
    "A directory listing is not an install. Run the pinned archive through its own CLI after the skill is installed.",
  );
  error.code = "unsupported_acquisition";
  throw error;
}

export function assertPinnedVersion(pins, packageName, version) {
  const pinned = pins.packages[packageName];
  if (!pinned) {
    const error = new Error(`no pin for ${packageName}`);
    error.code = "unpinned_version";
    throw error;
  }
  if (version !== pinned.version) {
    const error = new Error(`${packageName} ${version} is not the pinned public version ${pinned.version}`);
    error.code = "unpinned_version";
    throw error;
  }
  return pinned;
}

function refusal(code, message, extra = {}) {
  return {
    schema: RECEIPT_SCHEMA,
    ok: false,
    refusal: { code, message },
    fundsReserved: false,
    ownerPayment: false,
    paidServiceLaunch: false,
    downloaded: false,
    challengeFetched: false,
    ...extra,
  };
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      out._.push(token);
      continue;
    }
    const name = token.slice(2);
    if (REFUSAL_FLAGS.includes(name)) {
      const error = new Error(`refusing --${name}`);
      error.code = "refused_flag";
      throw error;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      out[name] = true;
      continue;
    }
    out[name] = value;
    i += 1;
  }
  return out;
}

async function readJsonLimited(path, maxBytes) {
  const buffer = await readFile(path);
  if (buffer.length > maxBytes) {
    const error = new Error(`file exceeds ${maxBytes} bytes`);
    error.code = "oversized_input";
    throw error;
  }
  return JSON.parse(buffer.toString("utf8"));
}

export async function loadPins(path = PINS_PATH) {
  return readJsonLimited(path, MAX_LISTING_BYTES);
}

async function readRegular(path) {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (info.isSymbolicLink() || !info.isFile()) {
    const error = new Error("refusing a non-regular cached artifact");
    error.code = "cache_symlink";
    throw error;
  }
  return readFile(path);
}

function assertPlainHttps(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    const error = new Error("refusing artifact URL that is not a plain https URL");
    error.code = "refused_url";
    throw error;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    const error = new Error("refusing artifact URL that is not a plain https URL");
    error.code = "refused_url";
    throw error;
  }
  return parsed;
}

async function writeRegular(dest, buffer) {
  await mkdir(dirname(dest), { recursive: true });
  const temporary = `${dest}.${process.pid}.${digest(buffer).slice(0, 8)}.partial`;
  try {
    await writeFile(temporary, buffer, { flag: "wx" });
    try {
      await rename(temporary, dest);
    } catch (error) {
      const existing = await readRegular(dest);
      if (!existing || !existing.equals(buffer)) throw error;
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

async function fetchPinned(spec, dest, supplied) {
  assertPlainHttps(spec.url);
  if (supplied != null) {
    const buffer = Buffer.isBuffer(supplied) ? supplied : Buffer.from(supplied);
    assertPin(buffer, spec);
    const existing = await readRegular(dest);
    if (!existing) await writeRegular(dest, buffer);
    else assertPin(existing, spec);
    return { downloaded: false, bytes: buffer.length, sha256: spec.sha256 };
  }
  const cached = await readRegular(dest);
  if (cached) {
    assertPin(cached, spec);
    return { downloaded: false, bytes: cached.length, sha256: spec.sha256 };
  }
  const response = await fetch(spec.url, { redirect: "manual", signal: AbortSignal.timeout(FETCH_MS) });
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel?.().catch(() => {});
    const error = new Error("refusing a redirect while downloading a pinned artifact");
    error.code = "redirect_rejected";
    throw error;
  }
  if (!response.ok) {
    await response.body?.cancel?.().catch(() => {});
    const error = new Error(`GET failed with status ${response.status}`);
    error.code = "download_failed";
    throw error;
  }
  const buffer = await readBoundedBody(response, spec.bytes);
  assertPin(buffer, spec);
  await writeRegular(dest, buffer);
  return { downloaded: true, bytes: buffer.length, sha256: spec.sha256 };
}

function tarMembers(archivePath) {
  const listed = spawnSync("tar", ["-tzf", archivePath], { encoding: "utf8" });
  if (listed.status !== 0) {
    const error = new Error("tar could not list the archive");
    error.code = "unsafe_archive";
    throw error;
  }
  return assertArchiveMembers(listed.stdout.split("\n").map((line) => line.trim()).filter(Boolean));
}

function modulesReady(packageDir) {
  try {
    const info = lstatSync(join(packageDir, "node_modules"));
    if (info.isSymbolicLink() || !info.isDirectory()) return false;
    const lockInfo = lstatSync(join(packageDir, "node_modules", ".package-lock.json"));
    return lockInfo.isFile() && !lockInfo.isSymbolicLink();
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function installModules(packageDir, lockPath) {
  writeFileSync(join(packageDir, "package-lock.json"), readFileSync(lockPath));
  const installed = spawnSync("npm", ["ci", "--ignore-scripts"], {
    cwd: packageDir,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_ignore_scripts: "true",
      npm_config_fund: "false",
      npm_config_audit: "false",
      npm_config_update_notifier: "false",
    },
  });
  if (installed.status !== 0) {
    const error = new Error("npm ci --ignore-scripts failed");
    error.code = "install_failed";
    throw error;
  }
}

export async function openPackage(options) {
  const pins = options.pins;
  const packageName = options.packageName;
  const pinned = pins.packages[packageName];
  const cacheDir = options.cache;
  const base = join(cacheDir, packageName, pinned.version);
  const archivePath = join(base, "archive.tgz");
  const lockPath = join(base, "package-lock.json");
  const files = options.files || {};
  const archive = await fetchPinned(pinned.archive, archivePath, files.archive);
  const lock = await fetchPinned(pinned.lock, lockPath, files.lock);
  let provenance = null;
  if (pinned.provenance) provenance = await fetchPinned(pinned.provenance, join(base, "provenance.json"), files.provenance);
  let release = null;
  if (pinned.release) {
    release = await fetchPinned(pinned.release, join(base, "release.json"), files.release);
    const descriptor = JSON.parse((await readRegular(join(base, "release.json"))).toString("utf8"));
    if (descriptor?.source?.commit !== pinned.codeCommit) {
      const error = new Error("release descriptor commit does not match the pin");
      error.code = "pin_mismatch";
      throw error;
    }
    if (descriptor?.artifact?.packSha256 !== pinned.archive.sha256) {
      const error = new Error("release descriptor archive hash does not match the pin");
      error.code = "pin_mismatch";
      throw error;
    }
    if (descriptor?.artifact?.lockfileSha256 !== pinned.lock.sha256) {
      const error = new Error("release descriptor lockfile hash does not match the pin");
      error.code = "pin_mismatch";
      throw error;
    }
  }
  tarMembers(archivePath);
  const executable = acquireExecutableTree(base, archivePath);
  if (!modulesReady(executable.packageDir)) installModules(executable.packageDir, lockPath);
  const reread = matchArchiveTree(executable.root, archivePath);
  if (!reread || reread.cliSha256 !== executable.cliSha256) {
    const error = new Error("executable tree no longer matches the archive");
    error.code = "unsafe_archive";
    throw error;
  }
  let provenanceDocument = null;
  if (pinned.provenance) {
    provenanceDocument = JSON.parse((await readRegular(join(base, "provenance.json"))).toString("utf8"));
  }
  return {
    packageDir: executable.packageDir,
    archivePath,
    lockPath,
    releasePath: pinned.release ? join(base, "release.json") : null,
    downloaded: archive.downloaded || lock.downloaded || Boolean(provenance?.downloaded) || Boolean(release?.downloaded),
    provenance: provenanceProjection(provenanceDocument),
    extraction: executable.extraction,
    treeSha256: executable.treeSha256,
    cliPath: join(executable.packageDir, "src", "cli.mjs"),
    cliSha256: executable.cliSha256,
    markerTrusted: false,
    pin: {
      name: packageName,
      version: pinned.version,
      license: pinned.license,
      archiveSha256: pinned.archive.sha256,
      archiveBytes: pinned.archive.bytes,
      archiveUrl: pinned.archive.url,
      codeCommit: pinned.codeCommit || null,
    },
  };
}

function provenanceProjection(document) {
  if (!document) return null;
  return {
    publicationStatus: document.publicationStatus ?? null,
    hostedAcquisitionVerified: document.hostedAcquisitionVerified ?? null,
    launched: document.launched ?? null,
    npmPublished: document.npmPublished ?? null,
    revoked: document.revoked ?? null,
  };
}

function projectRoute(decision) {
  return {
    schemaVersion: decision.schemaVersion,
    decision: decision.decision,
    code: decision.code,
    reason: decision.reason,
    evidenceFresh: decision.evidence?.fresh ?? null,
    dimensions: Array.isArray(decision.dimensions)
      ? decision.dimensions.map((dimension) => ({
        id: dimension.id,
        status: dimension.status,
        code: dimension.code,
      }))
      : [],
  };
}

function projectRelease(receipt) {
  const surfaces = {};
  for (const surface of receipt.surfaces || []) {
    surfaces[surface.id] = { state: surface.state, acceptance: surface.acceptance };
  }
  return {
    schema: receipt.schema,
    verdict: receipt.verdict,
    code: receipt.code,
    reason: receipt.reason,
    launched: receipt.launched,
    ownerPayment: receipt.ownerPayment,
    paidServiceLaunch: receipt.paidServiceLaunch,
    originStatus: receipt.originProof?.status ?? null,
    liveReadback: receipt.originProof?.liveReadback ?? null,
    observedSha256: receipt.originProof?.observedSha256 ?? null,
    surfaces,
  };
}

function runCli(packageDir, args) {
  const result = spawnSync(process.execPath, args, {
    cwd: packageDir,
    encoding: "utf8",
  });
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    parsed = null;
  }
  return { status: result.status ?? 1, parsed, stderr: (result.stderr || "").slice(0, 500) };
}

function validateSchema(packageDir, requestPath) {
  const script = `
    import { readFileSync } from "node:fs";
    import Ajv2020 from "ajv/dist/2020.js";
    import addFormats from "ajv-formats";
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    const schema = JSON.parse(readFileSync("schema/route-lock.decision-request.schema.json", "utf8"));
    const request = JSON.parse(readFileSync(process.argv[1], "utf8"));
    const validate = ajv.compile(schema);
    const ok = validate(request) === true;
    process.stdout.write(JSON.stringify({ ok, errors: ok ? [] : validate.errors }));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script, requestPath], {
    cwd: packageDir,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const error = new Error("published route-lock schema could not be applied");
    error.code = "schema_unavailable";
    throw error;
  }
  return JSON.parse(result.stdout);
}

function routeReceipt(base, installed, cli, schemaAccepted, extra = {}, facts = {}) {
  if (!cli.parsed) {
    return attachObservation({
      ...refusal("unusable_output", "route-lock did not write a JSON decision", base),
      exitCode: 2,
      pin: installed.pin,
      schemaAccepted,
    }, { ...facts, pin: installed.pin, decision: null });
  }
  const route = projectRoute(cli.parsed);
  return attachObservation({
    ...base,
    ok: true,
    exitCode: cli.status,
    downloaded: installed.downloaded,
    pin: installed.pin,
    provenance: installed.provenance,
    archivePinMatched: true,
    schemaAccepted,
    route,
    lockAccepted: route.decision === "lockable",
    usefulCommand: true,
    fundsReserved: false,
    ownerPayment: false,
    paidServiceLaunch: false,
    ...extra,
  }, { ...facts, pin: installed.pin, decision: cli.parsed });
}

export async function runTask(options) {
  const pins = options.pins || (await loadPins(options.pinsPath || PINS_PATH));
  const task = options.task;
  const base = {
    schema: RECEIPT_SCHEMA,
    task: options.taskId || task,
    kind: task,
    fundsReserved: false,
    ownerPayment: false,
    paidServiceLaunch: false,
    challengeFetched: false,
  };
  try {
    if (task === "listing-only") {
      const document = await readJsonLimited(options.listing, MAX_LISTING_BYTES);
      refuseListing(document);
    }
    if (task === "route-lock-decide") {
      if (!options.version) return { ...refusal("version_required", "route-lock-decide requires --version", base), exitCode: 2 };
      assertPinnedVersion(pins, "route-lock", options.version);
      const installed = await openPackage({
        pins,
        packageName: "route-lock",
        cache: options.cache,
        files: options.files,
      });
      const exampleName = options.example ? options.example : null;
      if (exampleName && (exampleName.includes("/") || exampleName.includes("\\") || !exampleName.endsWith(".json"))) {
        return { ...refusal("unsupported_input", "example name must be a single json file", base), exitCode: 2 };
      }
      const input = options.input || (exampleName ? join(installed.packageDir, "examples", exampleName) : null);
      if (!input) return { ...refusal("input_required", "route-lock-decide requires --input or --example", base), exitCode: 2 };
      const cli = runCli(installed.packageDir, ["src/cli.mjs", "decide", "--input", input]);
      return routeReceipt(base, installed, cli, null, {
        inputName: exampleName || "caller-input",
      }, {
        evaluatedAt: options.evaluatedAt,
        expiry: "unknown",
        observedAtState: "unknown",
        mutation: "none",
      });
    }
    if (task === "release-gate-check") {
      if (options.version) assertPinnedVersion(pins, "release-gate", options.version);
      const routeLock = await openPackage({
        pins,
        packageName: "route-lock",
        cache: options.cache,
        files: options.files,
      });
      const releaseGate = await openPackage({
        pins,
        packageName: "release-gate",
        cache: options.cache,
        files: options.files,
      });
      const generatedAt = options.generatedAt;
      if (!generatedAt) return { ...refusal("clock_required", "release-gate-check requires --generated-at", base), exitCode: 2 };
      const cli = runCli(releaseGate.packageDir, [
        "src/cli.mjs",
        "check",
        "--release",
        routeLock.releasePath,
        "--package",
        routeLock.packageDir,
        "--archive",
        routeLock.archivePath,
        "--sidecar",
        routeLock.lockPath,
        "--live",
        "--generated-at",
        generatedAt,
      ]);
      if (!cli.parsed) {
        return {
          ...refusal("unusable_output", "release-gate did not write a JSON receipt", base),
          exitCode: 2,
          pin: releaseGate.pin,
        };
      }
      const release = projectRelease(cli.parsed);
      return {
        ...base,
        ok: true,
        exitCode: cli.status,
        downloaded: routeLock.downloaded || releaseGate.downloaded,
        ownerPayment: release.ownerPayment === true,
        paidServiceLaunch: release.paidServiceLaunch === true,
        pin: releaseGate.pin,
        subject: routeLock.pin,
        provenance: releaseGate.provenance,
        archivePinMatched: true,
        release,
        releaseAccepted: release.verdict === "accepted" && release.launched === true,
        usefulCommand: true,
        fundsReserved: false,
      };
    }
    if (task === "map-unpaid-challenge") {
      const mutation = options.mutation || "none";
      if (!MUTATIONS.has(mutation)) {
        return { ...refusal("unsupported_mutation", `unsupported mutation ${mutation}`, base), exitCode: 2 };
      }
      if (!options.url) return { ...refusal("url_required", "map-unpaid-challenge requires --url", base), exitCode: 2 };
      const captured = await captureChallenge(options.url, {
        fetchImpl: options.fetchImpl,
        lookup: options.lookup,
      });
      if (captured.redirected) {
        return {
          ...refusal("redirect_rejected", "challenge response redirected; redirects are not followed", base),
          exitCode: 2,
          challengeFetched: true,
          destination: captured.destination,
        };
      }
      const mapped = mapDocumentedChallenge(captured);
      let decisionRequest = mutation === "402-alone" ? mapped.checklist : mapped.request;
      if (mutation === "changed-recipient") {
        decisionRequest = withChangedRecipient(mapped.request, mapped).request;
      }
      if (mutation === "stale") decisionRequest = withStaleObservation(mapped.request);
      if (!decisionRequest) {
        return {
          ...refusal("terms_absent", "the documented response does not contain the terms this mutation needs", base),
          exitCode: 2,
          challengeFetched: true,
          mapping: projection(mapped, null),
        };
      }
      const installed = await openPackage({
        pins,
        packageName: "route-lock",
        cache: options.cache,
        files: options.files,
      });
      const inputPath = join(options.cache, `decision-request-${mutation}.json`);
      await mkdir(options.cache, { recursive: true });
      await writeFile(inputPath, `${JSON.stringify(decisionRequest, null, 2)}\n`);
      const schema = validateSchema(installed.packageDir, inputPath);
      if (!schema.ok) {
        return {
          ...refusal("schema_rejected", "the published route-lock schema rejected the mapped request", base),
          exitCode: 2,
          challengeFetched: true,
          downloaded: installed.downloaded,
          schemaAccepted: false,
          mapping: projection(mapped, null),
        };
      }
      const cli = runCli(installed.packageDir, ["src/cli.mjs", "decide", "--input", inputPath]);
      return routeReceipt(base, installed, cli, true, {
        challengeFetched: true,
        mutation,
        mapping: projection(mapped, cli.parsed),
        inputName: mutation,
      }, {
        evaluatedAt: options.evaluatedAt,
        observedAt: mapped.terms?.observedAt || null,
        observedAtState: mapped.terms?.observedAtState || "unknown",
        expiresAt: mapped.terms?.expiresAt || null,
        expiry: mapped.terms?.expiry || "unknown",
        mutation,
        mapped,
        captured,
      });
    }
    return { ...refusal("unsupported_task", `unsupported task ${task}`, base), exitCode: 2 };
  } catch (error) {
    return {
      ...refusal(error.code || "task_failed", error.message || String(error), base),
      exitCode: 2,
    };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write("node scripts/run-task.mjs --cache <dir> --out <receipt.json> --task <task>\n");
    return;
  }
  if (!args.cache || !args.task || !args.out) {
    process.stderr.write("cache, task, and out are required\n");
    process.exitCode = 2;
    return;
  }
  const receipt = await runTask({
    task: args.task,
    taskId: args["task-id"] || args.task,
    cache: resolve(args.cache),
    listing: args.listing ? resolve(args.listing) : null,
    input: args.input ? resolve(args.input) : null,
    example: typeof args.example === "string" ? args.example : null,
    version: typeof args.version === "string" ? args.version : null,
    generatedAt: typeof args["generated-at"] === "string" ? args["generated-at"] : null,
    url: typeof args.url === "string" ? args.url : null,
    mutation: typeof args.mutation === "string" ? args.mutation : "none",
    evaluatedAt: typeof args["evaluated-at"] === "string" ? args["evaluated-at"] : undefined,
  });
  await mkdir(dirname(resolve(args.out)), { recursive: true });
  await writeFile(resolve(args.out), `${JSON.stringify(receipt, null, 2)}\n`);
  process.exitCode = receipt.exitCode ?? 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message || error}\n`);
    process.exitCode = 2;
  });
}
