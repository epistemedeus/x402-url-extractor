import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { nodeEngineSatisfies } from "../machine-acquisition.mjs";

export const ARTIFACT_SCHEMA = "samedaydesk.public-acquisition.receiving-artifact.v1";
export const CURRENT_DOCUMENT_SCHEMA = "samedaydesk.public-acquisition.current.v1";
export const ROUTE_CHOICE_SCHEMA = "samedaydesk.public-acquisition.route-choice.v1";
export const EVIDENCE_SCHEMA = "samedaydesk.public-acquisition.receiving-evidence.v1";
export const PUBLIC_ACQUISITION_CURRENT_PATH = "/.well-known/public-acquisition/current.json";
export const PUBLIC_RECEIVING_ORIGIN = "https://agents.samedaydesk.com";
export const ASSET_URL_PREFIX = "/.well-known/public-acquisition/assets/";
export const RECEIVING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const RECEIVING_FUTURE_SKEW_MS = 5 * 60 * 1000;
export const MAX_ARTIFACT_BYTES = 1_048_576;
export const MAX_ASSET_BYTES = 1_048_576;
export const MAX_REQUEST_MS = 20_000;
export const MAX_RUN_MS = 180_000;
export const ACQUISITION_ROUTES = Object.freeze([
  "configured-public-origin",
  "primary-origin",
  "withhold",
]);

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ARTIFACT_PATH = join(MODULE_DIR, "receiving", "artifact.json");
export const DEFAULT_COMMANDS_PATH = join(MODULE_DIR, "cold-commands.json");
export const DEFAULT_PINS_PATH = join(MODULE_DIR, "..", "machine-acquisition", "pins.json");
const ROLES = new Set(["archive", "provenance", "source-notice", "license"]);
const PRODUCER_ACQUISITION = new Set(["match", "mismatch", "missing", "redirect", "error"]);
const COVERAGE = new Set(["complete", "partial", "failed", "not-run"]);
const TIME_TEXT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SHA_TEXT = /^[0-9a-f]{64}$/;
const ID_TEXT = /^[a-z0-9][a-z0-9._-]*$/;
const FILE_TEXT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export class ReceivingError extends Error {
  constructor(message, code = "invalid_observation") {
    super(message);
    this.name = "ReceivingError";
    this.code = code;
    this.receivingCode = code;
  }
}

function fail(message, code = "invalid_observation") {
  throw new ReceivingError(message, code);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function commandDefinitionSha256(command) {
  return sha256(Buffer.from(canonicalJson({
    id: command.id,
    version: command.version,
    filename: command.filename,
    cwd: command.cwd,
    steps: (command.steps || []).map((step) => ({
      argv: step.argv,
      stdoutIncludes: Array.isArray(step.stdoutIncludes) ? step.stdoutIncludes : [],
    })),
  })));
}

function readRegularBounded(path, maxBytes) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if (error.code === "ELOOP") fail(`symlink is not a receiving artifact: ${path}`, "symlink");
    if (error.code === "ENOENT") {
      const missing = new ReceivingError(`missing file: ${path}`, "absent");
      missing.causeCode = "ENOENT";
      throw missing;
    }
    fail(`cannot open without following symlinks: ${path}: ${error.message}`, "unsafe_path");
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) fail(`not a regular file: ${path}`, "unsafe_path");
    if (st.size > maxBytes) fail(`file exceeds ${maxBytes} bytes: ${path}`, "bounds");
    // One extra byte detects growth; allocation and every read remain bounded.
    const bytes = Buffer.alloc(st.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, null);
      if (count === 0) break;
      offset += count;
    }
    const after = fstatSync(fd);
    if (offset !== st.size || after.size !== st.size || after.mtimeMs !== st.mtimeMs) {
      fail(`file changed during receiving: ${path}`, "concurrent_modification");
    }
    return bytes.subarray(0, offset);
  } finally {
    closeSync(fd);
  }
}

function exact(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} is not an object`);
  const present = Object.keys(value);
  const extra = present.filter((key) => !keys.includes(key));
  if (extra.length > 0) fail(`${label} has unexpected field ${extra[0]}`, "unexpected_field");
  const missing = keys.filter((key) => !Object.hasOwn(value, key));
  if (missing.length > 0) fail(`${label} is missing ${missing[0]}`);
  return value;
}

function shaField(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== "string" || !SHA_TEXT.test(value)) fail(`${label} is not a sha256`);
}

function intField(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER, nullable = false } = {}) {
  if (nullable && value === null) return;
  if (!Number.isInteger(value) || value < min || value > max) fail(`${label} is not a bounded integer`);
}

function textField(value, label, pattern, max = 512) {
  if (typeof value !== "string" || value.length === 0 || value.length > max || !pattern.test(value)) {
    fail(`${label} is not an allowlisted string`);
  }
}

function originField(value, label) {
  if (typeof value !== "string" || value.length > 256) fail(`${label} is not an origin`, "wrong_origin");
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${label} is not an origin`, "wrong_origin");
  }
  if (value !== url.origin || url.username || url.password) fail(`${label} is not an origin`, "wrong_origin");
  return url.origin;
}

function timeField(value, label) {
  if (typeof value !== "string" || !TIME_TEXT.test(value)) fail(`${label} is not UTC milliseconds`);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) fail(`${label} is not a time`);
  return ms;
}

function stringList(value, label, maxItems, maxLen) {
  if (!Array.isArray(value) || value.length > maxItems) fail(`${label} is not a bounded list`);
  for (const item of value) {
    if (typeof item !== "string" || item.length > maxLen) fail(`${label} entry is not a bounded string`);
  }
}

function parseInventory(value, label) {
  if (value === null) return null;
  exact(value, ["path", "fileSha256", "memberCount"], label);
  textField(value.path, `${label} path`, /^inventories\/[A-Za-z0-9][A-Za-z0-9._-]*\.json$/, 180);
  shaField(value.fileSha256, `${label} sha256`);
  intField(value.memberCount, `${label} count`, { min: 0, max: 2_000 });
  return value;
}

function parseHttpSide(value, label, { head = false } = {}) {
  const keys = head
    ? ["url", "status", "bodyBytes", "contentLength", "elapsedMs", "redirect"]
    : ["url", "status", "bodyBytes", "bodySha256", "contentType", "elapsedMs", "redirect"];
  exact(value, keys, label);
  if (typeof value.url !== "string" || value.url.length > 512) fail(`${label} url is not bounded`);
  let url;
  try {
    url = new URL(value.url);
  } catch {
    fail(`${label} url is not a URL`, "wrong_origin");
  }
  if (url.username || url.password || url.search || url.hash) fail(`${label} url is not a bare asset URL`, "wrong_origin");
  intField(value.status, `${label} status`, { min: 0, max: 599 });
  intField(value.bodyBytes, `${label} body`, { min: 0, max: MAX_ASSET_BYTES });
  intField(value.elapsedMs, `${label} elapsed`, { min: 0, max: MAX_REQUEST_MS });
  if (value.redirect !== "refused") fail(`${label} did not refuse redirects`, "redirect");
  if (head) intField(value.contentLength, `${label} length`, { min: 0, max: MAX_ASSET_BYTES, nullable: true });
  else {
    shaField(value.bodySha256, `${label} sha256`, { nullable: true });
    if (value.bodySha256 === null && value.bodyBytes !== 0) fail(`${label} body has no sha256`);
    if (!(value.contentType === null || (typeof value.contentType === "string" && value.contentType.length <= 128))) {
      fail(`${label} content type is not bounded`);
    }
  }
  return value;
}

export function parseReceivingArtifact(value) {
  exact(value, [
    "schema",
    "kind",
    "proofClass",
    "complete",
    "configuredPublicOrigin",
    "observedAt",
    "manifest",
    "inventories",
    "runtime",
    "bounds",
    "assets",
    "coldCommands",
    "qualifications",
    "remoteIndex",
  ], "receiving artifact");
  if (value.schema !== ARTIFACT_SCHEMA) fail("receiving artifact schema is not recognized", "schema");
  if (value.kind !== "deployment-readback") fail("receiving artifact is not a deployment readback", "schema");
  if (value.proofClass !== "public-origin") fail("receiving artifact is not public-origin evidence", "proof_class");
  if (typeof value.complete !== "boolean") fail("receiving artifact complete flag is not boolean");
  originField(value.configuredPublicOrigin, "configured public origin");
  timeField(value.observedAt, "observedAt");
  exact(value.manifest, ["schema", "sha256", "assetCount"], "manifest identity");
  if (value.manifest.schema !== "samedaydesk.public-acquisition.receiving.v1") fail("manifest schema is not the frozen receiving manifest");
  shaField(value.manifest.sha256, "manifest sha256");
  intField(value.manifest.assetCount, "manifest asset count", { min: 1, max: 64 });
  if (!Array.isArray(value.inventories) || value.inventories.length > 16) fail("inventories are not a bounded list");
  const inventoryPaths = new Set();
  for (const inventory of value.inventories) {
    parseInventory(inventory, "inventory");
    if (inventoryPaths.has(inventory.path)) fail(`duplicate inventory ${inventory.path}`);
    inventoryPaths.add(inventory.path);
  }
  exact(value.runtime, ["name", "version", "range", "satisfied"], "runtime");
  if (value.runtime.name !== "node") fail("runtime is not node", "runtime");
  textField(value.runtime.version, "runtime version", /^v\d+\.\d+\.\d+$/, 32);
  textField(value.runtime.range, "runtime range", /^>=\d+\.\d+\.\d+$/, 32);
  if (typeof value.runtime.satisfied !== "boolean") fail("runtime satisfaction is not boolean", "runtime");
  let satisfies = false;
  try {
    satisfies = nodeEngineSatisfies(value.runtime.version, value.runtime.range);
  } catch {
    fail("runtime range is not a supported pin", "runtime");
  }
  if (value.runtime.satisfied !== satisfies) fail("runtime satisfaction does not match the declared range", "runtime");
  exact(value.bounds, ["redirects", "maxAssetBytes", "maxRequestMs", "maxRunMs"], "bounds");
  if (value.bounds.redirects !== "refused") fail("bounds do not refuse redirects", "bounds");
  if (value.bounds.maxAssetBytes !== MAX_ASSET_BYTES || value.bounds.maxRequestMs !== MAX_REQUEST_MS || value.bounds.maxRunMs !== MAX_RUN_MS) {
    fail("bounds are not the receiving limits", "bounds");
  }
  if (!Array.isArray(value.assets) || value.assets.length === 0 || value.assets.length > 64) fail("assets are not a bounded list");
  const seen = new Set();
  for (const asset of value.assets) {
    exact(asset, [
      "id", "version", "role", "filename", "relativePath", "sha256", "bytes", "inventory", "acquisition", "get", "head",
    ], "asset");
    textField(asset.id, "asset id", ID_TEXT, 80);
    textField(asset.version, "asset version", ID_TEXT, 40);
    if (!ROLES.has(asset.role)) fail(`asset role is not allowlisted: ${asset.role}`);
    textField(asset.filename, "asset filename", FILE_TEXT, 120);
    const expectedRel = `${asset.id}/${asset.version}/${asset.filename}`;
    if (asset.relativePath !== expectedRel) fail(`asset path is not the id/version/filename triple: ${asset.relativePath}`, "unsafe_path");
    if (seen.has(expectedRel)) fail(`duplicate asset ${expectedRel}`);
    seen.add(expectedRel);
    shaField(asset.sha256, "asset sha256");
    intField(asset.bytes, "asset bytes", { min: 0, max: MAX_ASSET_BYTES });
    if (asset.role === "archive") {
      if (!asset.inventory) fail(`archive is missing inventory: ${expectedRel}`);
      parseInventory(asset.inventory, "asset inventory");
    } else if (asset.inventory !== null) fail(`non-archive carries an inventory: ${expectedRel}`);
    if (!PRODUCER_ACQUISITION.has(asset.acquisition)) fail(`asset acquisition is not qualified: ${expectedRel}`);
    parseHttpSide(asset.get, "GET");
    parseHttpSide(asset.head, "HEAD", { head: true });
  }
  if (!Array.isArray(value.coldCommands) || value.coldCommands.length > 16) fail("cold commands are not a bounded list");
  const commandIds = new Set();
  for (const command of value.coldCommands) {
    exact(command, ["id", "version", "filename", "definitionSha256", "coverage", "steps"], "cold command");
    textField(command.id, "command id", ID_TEXT, 80);
    textField(command.version, "command version", ID_TEXT, 40);
    textField(command.filename, "command filename", FILE_TEXT, 120);
    shaField(command.definitionSha256, "command definition");
    if (!COVERAGE.has(command.coverage)) fail("cold command coverage is not qualified");
    const key = `${command.id}@${command.version}`;
    if (commandIds.has(key)) fail(`duplicate cold command ${key}`);
    commandIds.add(key);
    if (!Array.isArray(command.steps) || command.steps.length > 16) fail("cold command steps are not a bounded list");
    for (const step of command.steps) {
      exact(step, ["argv", "exitCode", "matched", "missing", "stdoutSha256", "stdoutBytes"], "cold command step");
      stringList(step.argv, "argv", 24, 512);
      if (step.argv.length === 0) fail("cold command argv is empty");
      intField(step.exitCode, "exit code", { min: -1, max: 255, nullable: true });
      if (typeof step.matched !== "boolean") fail("cold command match flag is not boolean");
      stringList(step.missing, "missing needles", 8, 200);
      shaField(step.stdoutSha256, "stdout sha256");
      intField(step.stdoutBytes, "stdout bytes", { min: 0, max: MAX_ARTIFACT_BYTES });
    }
  }
  exact(value.qualifications, [
    "sourceQualification",
    "privateGit",
    "independentAdoption",
    "paidLaunch",
    "measuredSavings",
    "purchaseAuthorization",
  ], "qualifications");
  if (value.qualifications.sourceQualification !== "unknown") fail("source qualification must stay unknown", "unearned_claim");
  if (value.qualifications.privateGit !== "unavailable") fail("private Git availability is not established", "unearned_claim");
  if (value.qualifications.independentAdoption !== false) fail("independent adoption is not evidenced", "unearned_claim");
  if (value.qualifications.paidLaunch !== false || value.qualifications.measuredSavings !== false) {
    fail("readback must not claim launch or savings", "unearned_claim");
  }
  if (value.qualifications.purchaseAuthorization !== false) fail("readback is not purchase authorization", "unearned_claim");
  exact(value.remoteIndex, [
    "url", "status", "bytes", "sha256", "draft", "productionHosted", "hostedAcquisitionVerified", "assetCount",
  ], "remote index");
  if (typeof value.remoteIndex.url !== "string" || value.remoteIndex.url.length > 512) fail("remote index url is not bounded");
  intField(value.remoteIndex.status, "remote index status", { min: 0, max: 599 });
  intField(value.remoteIndex.bytes, "remote index bytes", { min: 0, max: MAX_ARTIFACT_BYTES });
  shaField(value.remoteIndex.sha256, "remote index sha256", { nullable: true });
  if (typeof value.remoteIndex.draft !== "boolean" || typeof value.remoteIndex.productionHosted !== "boolean" || typeof value.remoteIndex.hostedAcquisitionVerified !== "boolean") {
    fail("remote index claims are not booleans");
  }
  intField(value.remoteIndex.assetCount, "remote index asset count", { min: 0, max: 64, nullable: true });
  return value;
}

export function loadReceivingFile(path = DEFAULT_ARTIFACT_PATH) {
  let bytes;
  try {
    bytes = readRegularBounded(path, MAX_ARTIFACT_BYTES);
  } catch (error) {
    if (error instanceof ReceivingError && (error.code === "absent" || error.causeCode === "ENOENT")) {
      return { kind: "candidate" };
    }
    return {
      kind: "rejected",
      code: error.receivingCode || error.code || "invalid_observation",
      message: "receiving artifact could not be safely loaded",
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    return { kind: "rejected", code: "invalid_observation", message: "receiving artifact is not valid JSON" };
  }
  try {
    return { kind: "loaded", value: parseReceivingArtifact(parsed), sha256: sha256(bytes) };
  } catch (error) {
    return {
      kind: "rejected",
      code: error.receivingCode || "invalid_observation",
      message: "receiving artifact does not match its schema",
    };
  }
}

export function loadColdCommandSet(path = DEFAULT_COMMANDS_PATH) {
  const bytes = readRegularBounded(path, MAX_ARTIFACT_BYTES);
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail(`cold commands are not JSON: ${error.message}`);
  }
  if (!parsed || parsed.schema !== "samedaydesk.public-acquisition.cold-commands.v1" || !Array.isArray(parsed.commands)) {
    fail("cold command schema is not recognized");
  }
  const commands = parsed.commands.map((command) => {
    if (!command || !Array.isArray(command.steps)) fail("cold command steps are missing");
    return {
      id: command.id,
      version: command.version,
      filename: command.filename,
      cwd: command.cwd,
      steps: command.steps.map((step) => ({ argv: step.argv, stdoutIncludes: step.stdoutIncludes || [] })),
      definitionSha256: commandDefinitionSha256(command),
    };
  });
  return { sha256: sha256(bytes), commands };
}

export function declaredRuntimeRange(path = DEFAULT_PINS_PATH) {
  const bytes = readRegularBounded(path, 65_536);
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail(`runtime pin is not JSON: ${error.message}`, "runtime");
  }
  if (!parsed || typeof parsed.enginesNode !== "string") fail("runtime pin is missing", "runtime");
  return parsed.enginesNode;
}

function qualificationsView() {
  return {
    sourceQualification: "unknown",
    privateSource: "uninspected",
    independentAdoption: "not-evidenced",
    paidLaunch: "not-evidenced",
    measuredSavings: "not-evidenced",
    purchaseAuthorization: false,
  };
}

function frozenView(published) {
  const document = published.document;
  return {
    schema: "samedaydesk.public-acquisition.document.v1",
    path: "/.well-known/public-acquisition/index.json",
    draft: document.draft,
    productionHosted: document.productionHosted,
    hostedAcquisitionVerified: document.hostedAcquisitionVerified,
    deploymentReadback: document.deploymentReadback,
    sourceQualification: document.sourceQualification,
    privateGit: document.privateGit,
    paidLaunch: document.paidLaunch,
    measuredSavings: document.measuredSavings,
    independentDemand: document.independentDemand,
    primaryOrigin: document.primaryOrigin,
    primaryRouteRemainsAvailable: document.primaryRouteRemainsAvailable === true,
    historical: true,
  };
}

function publicAssetUrl(origin, relativePath) {
  if (!origin) return null;
  return `${origin}${ASSET_URL_PREFIX}${relativePath}`;
}

function sameInventory(left, right) {
  return Boolean(left) && Boolean(right)
    && left.path === right.path
    && left.fileSha256 === right.fileSha256
    && left.memberCount === right.memberCount;
}

function expectedInventories(published) {
  const list = [];
  for (const rel of published.order) {
    const asset = published.files.get(rel).asset;
    if (asset.role === "archive" && asset.inventory) {
      list.push({
        path: asset.inventory.path,
        fileSha256: asset.inventory.fileSha256,
        memberCount: asset.inventory.memberCount,
      });
    }
  }
  return list;
}

function httpAgrees(asset, origin) {
  const pathname = `${ASSET_URL_PREFIX}${asset.relativePath}`;
  const sideAgrees = (side, head) => {
    let url;
    try {
      url = new URL(side.url);
    } catch {
      return "mismatch";
    }
    if (url.origin !== origin || url.pathname !== pathname) return "mismatch";
    if (side.status >= 300 && side.status < 400) return "redirect";
    if (side.status === 404) return "missing";
    if (side.status !== 200) return "mismatch";
    if (head) {
      if (side.bodyBytes !== 0 || side.contentLength !== asset.bytes) return "mismatch";
      return "ok";
    }
    if (side.bodyBytes !== asset.bytes || side.bodySha256 !== asset.sha256) return "changed";
    return "ok";
  };
  const getResult = sideAgrees(asset.get, false);
  const headResult = sideAgrees(asset.head, true);
  if (getResult === "redirect" || headResult === "redirect") return "redirect";
  if (getResult === "missing" || headResult === "missing") return "missing";
  if (getResult === "changed" || headResult === "changed") return "changed";
  if (getResult !== "ok" || headResult !== "ok") return "mismatch";
  return "ok";
}

function evaluateAsset(asset, record, inventoryList, origin) {
  const base = {
    id: asset.id,
    version: asset.version,
    role: asset.role,
    filename: asset.filename,
    sha256: asset.sha256,
    bytes: asset.bytes,
    relativePath: asset.relativePath,
    primaryUrl: asset.originalUrl,
    ...qualificationsView(),
  };
  if (!record) {
    return { ...base, acquisition: "missing", usefulCommand: asset.role === "archive" ? "unobserved" : "not-applicable", inventory: asset.role === "archive" ? "unobserved" : "not-applicable", redirect: false };
  }
  if (record.sha256 !== asset.sha256 || record.bytes !== asset.bytes || record.role !== asset.role) {
    return { ...base, acquisition: "changed", usefulCommand: asset.role === "archive" ? "invalidated" : "not-applicable", inventory: asset.role === "archive" ? "invalidated" : "not-applicable", redirect: false };
  }
  let inventory = "not-applicable";
  if (asset.role === "archive") {
    const expected = {
      path: asset.inventory.path,
      fileSha256: asset.inventory.fileSha256,
      memberCount: asset.inventory.memberCount,
    };
    const listed = inventoryList.find((item) => item.path === expected.path);
    if (!record.inventory || !listed) inventory = "unobserved";
    else if (!sameInventory(record.inventory, expected) || !sameInventory(listed, expected)) inventory = "invalidated";
    else inventory = "matched";
  }
  const http = httpAgrees(record, origin);
  let acquisition = "mismatched";
  if (http === "ok") acquisition = "acquired";
  else if (http === "missing") acquisition = "missing";
  else if (http === "changed") acquisition = "changed";
  else if (http === "redirect") acquisition = "mismatched";
  return {
    ...base,
    acquisition,
    usefulCommand: asset.role === "archive" ? "unobserved" : "not-applicable",
    inventory,
    redirect: http === "redirect",
  };
}

function applyCommands(assets, artifactCommands, commandSet) {
  if (!commandSet) {
    for (const asset of assets) {
      if (asset.role === "archive") asset.usefulCommand = "unobserved";
    }
    return { unexpected: false };
  }
  const byKey = new Map((artifactCommands || []).map((command) => [`${command.id}@${command.version}`, command]));
  const definitions = new Map(commandSet.commands.map((command) => [`${command.id}@${command.version}`, command]));
  const seen = new Set();
  for (const asset of assets) {
    if (asset.role !== "archive") continue;
    const key = `${asset.id}@${asset.version}`;
    const definition = definitions.get(key);
    const observed = byKey.get(key);
    if (!definition) {
      asset.usefulCommand = "unobserved";
      continue;
    }
    seen.add(key);
    if (!observed) {
      asset.usefulCommand = "unobserved";
      continue;
    }
    if (observed.filename !== definition.filename || observed.definitionSha256 !== definition.definitionSha256) {
      asset.usefulCommand = "invalidated";
      continue;
    }
    if (asset.acquisition === "changed" || asset.acquisition === "mismatched") {
      asset.usefulCommand = "invalidated";
      continue;
    }
    if (asset.acquisition !== "acquired") {
      asset.usefulCommand = observed.coverage === "not-run" ? "unobserved" : "failed";
      continue;
    }
    const stepsOk = definition.steps.length === observed.steps.length && observed.steps.every((step, index) => {
      const declared = definition.steps[index].argv;
      return step.exitCode === 0 && step.matched === true && step.missing.length === 0
        && step.argv.length === declared.length && step.argv.every((part, partIndex) => part === declared[partIndex]);
    });
    if (observed.coverage === "complete" && stepsOk) asset.usefulCommand = "matched";
    else if (observed.coverage === "partial") asset.usefulCommand = "partial";
    else if (observed.coverage === "not-run") asset.usefulCommand = "unobserved";
    else asset.usefulCommand = "failed";
  }
  for (const key of byKey.keys()) {
    if (!seen.has(key) && !definitions.has(key)) return { unexpected: true };
  }
  for (const definition of definitions.values()) {
    if (!assets.some((asset) => asset.role === "archive" && asset.id === definition.id && asset.version === definition.version)) {
      return { unexpected: true };
    }
  }
  return { unexpected: false };
}

function revokeObservation(assets) {
  for (const asset of assets) {
    if (asset.acquisition === "acquired" || asset.acquisition === "changed" || asset.acquisition === "mismatched" || asset.acquisition === "missing") {
      asset.acquisition = "revoked";
    }
    if (asset.usefulCommand === "matched" || asset.usefulCommand === "partial" || asset.usefulCommand === "failed" || asset.usefulCommand === "invalidated") {
      asset.usefulCommand = "revoked";
    }
    if (asset.inventory === "matched" || asset.inventory === "invalidated") asset.inventory = "revoked";
  }
}

function routeFor(asset, availability) {
  const publicUrl = publicAssetUrl(asset.publicOrigin || null, asset.relativePath);
  const facts = {
    id: asset.id,
    version: asset.version,
    role: asset.role,
    filename: asset.filename,
    sha256: asset.sha256,
    bytes: asset.bytes,
    primaryUrl: asset.primaryUrl,
    publicUrl,
  };
  const select = (route, because) => ({
    ...facts,
    route,
    url: route === "withhold" ? null : route === "primary-origin" ? asset.primaryUrl : publicUrl,
    because,
  });
  if (availability === "candidate") return select("primary-origin", "no-current-readback");
  if (availability === "rejected") return select("primary-origin", "readback-rejected");
  if (availability === "revoked" || asset.acquisition === "revoked") return select("primary-origin", "readback-revoked");
  if (asset.acquisition === "acquired" && (asset.usefulCommand === "matched" || asset.usefulCommand === "not-applicable")) {
    return select("configured-public-origin", "public-bytes-acquired");
  }
  if (asset.acquisition === "acquired") return select("configured-public-origin", "public-bytes-acquired-command-incomplete");
  if (asset.acquisition === "missing" || asset.acquisition === "unobserved") return select("primary-origin", "public-asset-missing");
  if (asset.acquisition === "changed") return select("withhold", "public-bytes-changed");
  if (asset.redirect) return select("withhold", "redirect-refused");
  return select("withhold", "public-observation-mismatch");
}

function blankAssets(published, origin) {
  return published.order.map((rel) => {
    const asset = published.files.get(rel).asset;
    return {
      id: asset.id,
      version: asset.version,
      role: asset.role,
      filename: asset.filename,
      sha256: asset.sha256,
      bytes: asset.bytes,
      relativePath: asset.relativePath,
      primaryUrl: asset.originalUrl,
      publicOrigin: origin,
      acquisition: "unobserved",
      usefulCommand: asset.role === "archive" ? "unobserved" : "not-applicable",
      inventory: asset.role === "archive" ? "unobserved" : "not-applicable",
      redirect: false,
      ...qualificationsView(),
    };
  });
}

function envelope({ published, availability, rejection, artifact, artifactSha, ageMs, fresh, manifest, runtime, assets, origin }) {
  const frozen = frozenView(published);
  const choiceAssets = assets.map((asset) => routeFor(asset, availability));
  const remote = artifact?.remoteIndex || null;
  return {
    schema: CURRENT_DOCUMENT_SCHEMA,
    kind: "delivery-envelope",
    separateFromFrozenProvenance: true,
    freshness: {
      policy: "local-artifact-age",
      maxAgeMs: RECEIVING_MAX_AGE_MS,
      maxFutureSkewMs: RECEIVING_FUTURE_SKEW_MS,
      unit: "milliseconds",
      fresh,
      ageMs,
      refresh: "Replace public-acquisition/receiving/artifact.json with the public proof written by public-acquisition/receive.mjs. The next current document request reads that file. Do not edit product code.",
    },
    frozenProvenance: frozen,
    receiving: {
      availability,
      rejection,
      proofClass: artifact?.proofClass || null,
      configuredPublicOrigin: artifact?.configuredPublicOrigin || null,
      observedAt: artifact?.observedAt || null,
      ageMs,
      artifactSha256: artifactSha,
      complete: availability === "received",
      manifest,
      runtime,
      sourceQualification: "unknown",
      privateSource: "uninspected",
      independentAdoption: "not-evidenced",
      paidLaunch: "not-evidenced",
      measuredSavings: "not-evidenced",
      purchaseAuthorization: false,
      remoteIndexUsedForDecision: false,
      remoteIndexClaims: remote ? {
        draft: remote.draft,
        productionHosted: remote.productionHosted,
        hostedAcquisitionVerified: remote.hostedAcquisitionVerified,
      } : null,
    },
    assets: assets.map((asset) => ({
      id: asset.id,
      version: asset.version,
      role: asset.role,
      filename: asset.filename,
      sha256: asset.sha256,
      bytes: asset.bytes,
      acquisition: asset.acquisition,
      usefulCommand: asset.usefulCommand,
      inventory: asset.inventory,
      sourceQualification: "unknown",
      privateSource: "uninspected",
      independentAdoption: "not-evidenced",
      paidLaunch: "not-evidenced",
    })),
    choice: {
      schema: ROUTE_CHOICE_SCHEMA,
      use: "route",
      disposition: availability,
      assets: choiceAssets,
    },
  };
}

export function acquisitionTarget(entry) {
  if (!entry || !ACQUISITION_ROUTES.includes(entry.route) || entry.route === "withhold" || typeof entry.url !== "string" || entry.url.length === 0) {
    return { fetch: false, url: null, because: entry?.because || "unrecognized-route", sha256: entry?.sha256 || null };
  }
  return { fetch: true, url: entry.url, because: entry.because, sha256: entry.sha256, route: entry.route };
}

export function projectCurrentDelivery({
  published,
  publicUrl = null,
  artifactState = { kind: "candidate" },
  coldCommands = null,
  runtimeRange = null,
  now = Date.now(),
} = {}) {
  let origin = null;
  if (publicUrl) {
    try {
      origin = new URL(publicUrl).origin;
    } catch {
      origin = null;
    }
  }
  const empty = (availability, rejection, extra = {}) => envelope({
    published,
    availability,
    rejection,
    artifact: null,
    artifactSha: null,
    ageMs: null,
    fresh: null,
    manifest: "unobserved",
    runtime: null,
    assets: blankAssets(published, origin),
    origin,
    ...extra,
  });
  if (!artifactState || artifactState.kind === "candidate") return empty("candidate", null);
  if (artifactState.kind === "rejected") {
    return empty("rejected", { code: artifactState.code || "invalid_observation", message: artifactState.message || "receiving artifact rejected" });
  }
  let artifact = artifactState.value;
  try {
    artifact = parseReceivingArtifact(artifact);
  } catch (error) {
    return empty("rejected", { code: error.receivingCode || "invalid_observation", message: error.message });
  }
  if (origin === null || artifact.configuredPublicOrigin !== origin) {
    return empty("rejected", { code: "wrong_origin", message: "receiving origin does not match the configured public origin" });
  }
  const observedMs = Date.parse(artifact.observedAt);
  if (observedMs > now + RECEIVING_FUTURE_SKEW_MS) {
    return empty("rejected", { code: "invalid_observation", message: "observation is in the future" });
  }
  const ageMs = now - observedMs;
  const stale = ageMs > RECEIVING_MAX_AGE_MS;
  let pin = "unobserved";
  let range = runtimeRange;
  if (!range) {
    try {
      range = declaredRuntimeRange();
    } catch {
      range = null;
    }
  }
  if (range) pin = artifact.runtime.range === range ? "matched" : "differs";
  const runtime = {
    name: artifact.runtime.name,
    version: artifact.runtime.version,
    range: artifact.runtime.range,
    satisfied: artifact.runtime.satisfied,
    pin,
  };
  const manifest = published.manifestSha256 && artifact.manifest.sha256 === published.manifestSha256
    ? "matched"
    : "changed";
  if (manifest === "matched" && artifact.manifest.assetCount !== published.order.length) {
    return empty("rejected", { code: "invalid_observation", message: "manifest asset count does not match the manifest bytes" });
  }
  const expected = expectedInventories(published);
  const expectedPaths = new Set(expected.map((item) => item.path));
  for (const inventory of artifact.inventories) {
    if (!expectedPaths.has(inventory.path)) {
      return empty("rejected", { code: "unexpected_field", message: `unexpected inventory ${inventory.path}` });
    }
  }
  const byRel = new Map(artifact.assets.map((asset) => [asset.relativePath, asset]));
  for (const rel of byRel.keys()) {
    if (!published.files.has(rel)) {
      return empty("rejected", { code: "unexpected_field", message: `unexpected asset ${rel}` });
    }
  }
  const assets = published.order.map((rel) => {
    const evaluated = evaluateAsset(published.files.get(rel).asset, byRel.get(rel) || null, artifact.inventories, artifact.configuredPublicOrigin);
    evaluated.publicOrigin = origin;
    return evaluated;
  });
  const commandBind = applyCommands(assets, artifact.coldCommands, coldCommands);
  if (commandBind.unexpected) {
    return empty("rejected", { code: "unexpected_field", message: "cold command is not in the frozen command set" });
  }
  let availability = "partial";
  if (stale) {
    revokeObservation(assets);
    availability = "revoked";
  } else {
    const archivesReady = assets.every((asset) => asset.acquisition === "acquired"
      && (asset.role !== "archive" || (asset.usefulCommand === "matched" && asset.inventory === "matched"))
      && (asset.role === "archive" || asset.usefulCommand === "not-applicable"));
    const runtimeReady = runtime.satisfied === true && runtime.pin === "matched";
    if (artifact.complete === true && manifest === "matched" && runtimeReady && archivesReady && coldCommands) {
      availability = "received";
    }
  }
  return envelope({
    published,
    availability,
    rejection: null,
    artifact,
    artifactSha: artifactState.sha256 || null,
    ageMs,
    fresh: !stale,
    manifest,
    runtime,
    assets,
    origin,
  });
}
