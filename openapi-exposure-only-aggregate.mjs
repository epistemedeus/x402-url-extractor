import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { types as utilTypes } from "node:util";

const LIMITS = Object.freeze({
  maxRoutes: 32,
  maxHours: 336,
  maxObservationsPerHour: 1_000,
  maxResponseBytes: 1_048_576,
  maxAuthorityBytes: 4_194_304,
  maxEvidenceBytes: 8_388_608,
  maxAuthorities: 11_000,
});
const HEX64 = /^[0-9a-f]{64}$/;
const HEX40 = /^[0-9a-f]{40}$/;
const ID = /^[A-Za-z0-9._:-]{1,96}$/;
const EXPERIMENT_ID = /^exp-[a-z0-9][a-z0-9-]{7,31}$/;
const WINDOW_ID = /^win-[a-z0-9][a-z0-9-]{7,31}$/;
const SURFACE_ID = /^surface-[a-z0-9][a-z0-9-]{2,31}$/;
const OPERATION_ID = /^op-[a-z0-9][a-z0-9_]{2,47}$/;
const COLLECTOR_ID = /^collector-[a-z0-9][a-z0-9-]{2,31}$/;
const POLICY_ID = /^policy-[a-z0-9][a-z0-9-]{2,31}$/;
const HOUR = /^\d{4}-\d{2}-\d{2}T\d{2}$/;
const UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const FIXED6 = /^(?:0|[1-9][0-9]*)\.[0-9]{6}$/;
const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const FORBIDDEN = /(?:^|_)(?:actor|actorid|did|decentralizedidentifier|ip|ipaddress|useragent|ua|referrer|credential|wallet|payer|payment|prompt|requestbody|query)(?:$|_)/i;
const ROLES = ["route_manifest", "document_bytes", "collector_source", "coverage_policy", "raw_hour"];
const ENVELOPE_KEYS = ["schemaVersion", "authorityId", "role", "availability", "locator", "sha256", "bytes", "sourceCommit", "sourceTree", "unavailableReason"];
const REQUEST_KEYS = ["schemaVersion", "rootPath", "expectedManifestSha256", "manifestAuthority", "authorities"];
const LIMIT_KEYS = ["maxRoutes", "maxHours", "maxObservationsPerHour", "maxResponseBytes", "maxAuthorityBytes", "maxEvidenceBytes", "maxAuthorities"];
const MANIFEST_KEYS = ["schemaVersion", "experimentId", "windowId", "phase", "origin", "windowStartUtc", "windowEndUtc", "collectorSourceAuthorityId", "collectorSourceSha256", "coveragePolicyAuthorityId", "coveragePolicySha256", "routes", "routeHours", "limits"];
const ROUTE_KEYS = ["routeKey", "surfaceId", "method", "path", "canonicalUrl", "operationId", "documentAuthorityId", "documentSha256", "windowStartOrdinal", "windowStartLedgerSha256"];
const ROUTE_HOUR_KEYS = ["routeKey", "hourId", "rawHourAuthorityId"];
const COLLECTOR_KEYS = ["schemaVersion", "collectorId", "closeAlgorithm", "closePublicKeySpkiBase64"];
const POLICY_KEYS = ["schemaVersion", "policyId", "ceilingMode", "hourBoundary", "missingMeans"];
const OBS_KEYS = ["schemaVersion", "experimentId", "windowId", "hourId", "routeKey", "sourceOrdinal", "surfaceId", "method", "path", "canonicalUrl", "httpStatus", "contentTypeClass", "responseBytes", "responseSha256", "collectorSourceSha256"];
const RAW_KEYS = ["schemaVersion", "experimentId", "windowId", "hourId", "routeKey", "rawHourAuthorityId", "sourceStartOrdinal", "sourceEndOrdinal", "declaredHighWaterExclusive", "previousSourceLedgerSha256", "sourceLedgerSha256", "observationSetSha256", "collectorSourceSha256", "coveragePolicySha256", "observations", "closeSealBase64"];
const AGG_KEYS = ["schemaVersion", "manifestSha256", "experimentId", "windowId", "hourId", "routeKey", "availability", "coverageBasis", "exposureCount", "validDocumentCount", "invalidDocumentCount", "rawHourAuthoritySha256", "rawHourByteCount", "observationSetSha256", "sourceLedgerSha256", "evidenceSha256"];
const SUMMARY_KEYS = ["schemaVersion", "manifestSha256", "experimentId", "windowId", "availability", "coverageBasis", "derivedRouteHourCount", "totalExposureCount", "validDocumentCount", "invalidDocumentCount", "minimumExposurePerRouteHour", "maximumExposurePerRouteHour", "meanExposurePerRouteHour", "validDocumentShare", "authoritySetSha256", "derivedAggregateSetSha256", "unavailableReason", "evidenceSha256"];
const RESULT_KEYS = ["schemaVersion", "availability", "summary", "aggregates"];
const UNAVAILABLE_REASONS = new Set([
  "request_invalid", "authority_absent", "authority_missing", "authority_unreadable",
  "authority_non_regular", "authority_symlink", "authority_oversize",
  "authority_byte_count_mismatch", "authority_hash_mismatch", "authority_conflict",
  "authority_unsupported", "authority_payload_invalid", "inventory_incomplete",
  "raw_hour_invalid", "close_invalid", "ordinal_gap", "ledger_gap", "response_invalid",
]);

class DataFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function byteCompare(a, b) {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

function validUnicode(value) {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function safeSnapshot(value) {
  const seen = new WeakSet();
  let nodes = 0;
  function visit(current, depth) {
    nodes += 1;
    if (nodes > 300_000) throw new Error("node_cap");
    if (depth > 18) throw new Error("depth_cap");
    if (typeof current === "string") {
      if (!validUnicode(current) || Buffer.byteLength(current, "utf8") > LIMITS.maxEvidenceBytes) throw new Error("string_invalid");
      return current;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current) || Object.is(current, -0)) throw new Error("number_invalid");
      return current;
    }
    if (typeof current === "boolean" || current === null) return current;
    if (typeof current !== "object" || utilTypes.isProxy(current)) throw new Error("exotic_value");
    if (seen.has(current)) throw new Error("alias_or_cycle");
    seen.add(current);
    const proto = Object.getPrototypeOf(current);
    if (Array.isArray(current)) {
      if (proto !== Array.prototype || current.length > 12_000) throw new Error("array_shape");
      const keys = Reflect.ownKeys(current);
      const expected = [...Array(current.length).keys()].map(String).concat("length");
      if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) throw new Error("array_sparse_or_extra");
      const out = [];
      for (let index = 0; index < current.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new Error("descriptor");
        out.push(visit(descriptor.value, depth + 1));
      }
      return out;
    }
    if (!(proto === Object.prototype || proto === null)) throw new Error("custom_prototype");
    const keys = Reflect.ownKeys(current);
    if (keys.length > 12_000 || keys.some((key) => typeof key !== "string")) throw new Error("object_shape");
    const out = Object.create(null);
    for (const key of keys) {
      if (!validUnicode(key) || Buffer.byteLength(key, "utf8") > LIMITS.maxEvidenceBytes) throw new Error("key_invalid");
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new Error("descriptor");
      out[key] = visit(descriptor.value, depth + 1);
    }
    return out;
  }
  return visit(value, 0);
}

function canonical(value) {
  const snapshot = safeSnapshot(value);
  function encode(current) {
    if (current === null || typeof current !== "object") return JSON.stringify(current);
    if (Array.isArray(current)) return `[${current.map(encode).join(",")}]`;
    const keys = Object.keys(current).sort(byteCompare);
    return `{${keys.map((key) => `${JSON.stringify(key)}:${encode(current[key])}`).join(",")}}`;
  }
  return encode(snapshot);
}

function parseJsonNoDuplicates(source) {
  let i = 0;
  const skip = () => { while (/[\x20\x09\x0a\x0d]/.test(source[i] ?? "")) i += 1; };
  function string() {
    if (source[i] !== '"') throw new Error("json_string");
    const start = i;
    i += 1;
    while (i < source.length) {
      if (source.charCodeAt(i) <= 0x1f) throw new Error("json_control");
      if (source[i] === "\\") { i += 2; continue; }
      if (source[i] === '"') { i += 1; return JSON.parse(source.slice(start, i)); }
      i += 1;
    }
    throw new Error("json_eof");
  }
  function value() {
    skip();
    if (source[i] === '"') return string();
    if (source[i] === "{") {
      i += 1;
      const out = Object.create(null);
      const names = new Set();
      skip();
      if (source[i] === "}") { i += 1; return out; }
      while (true) {
        skip();
        const name = string();
        if (names.has(name)) throw new Error("duplicate_json_key");
        names.add(name);
        skip();
        if (source[i] !== ":") throw new Error("json_colon");
        i += 1;
        out[name] = value();
        skip();
        if (source[i] === "}") { i += 1; return out; }
        if (source[i] !== ",") throw new Error("json_comma");
        i += 1;
      }
    }
    if (source[i] === "[") {
      i += 1;
      const out = [];
      skip();
      if (source[i] === "]") { i += 1; return out; }
      while (true) {
        out.push(value());
        skip();
        if (source[i] === "]") { i += 1; return out; }
        if (source[i] !== ",") throw new Error("json_comma");
        i += 1;
      }
    }
    for (const [token, parsed] of [["true", true], ["false", false], ["null", null]]) {
      if (source.startsWith(token, i)) { i += token.length; return parsed; }
    }
    const match = source.slice(i).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
    if (!match) throw new Error("json_value");
    i += match[0].length;
    const number = Number(match[0]);
    if (!Number.isFinite(number) || Object.is(number, -0)) throw new Error("json_number");
    return number;
  }
  const out = value();
  skip();
  if (i !== source.length) throw new Error("json_trailing");
  return out;
}

function parseClosed(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > LIMITS.maxAuthorityBytes) throw new Error("payload_size");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return safeSnapshot(parseJsonNoDuplicates(text));
}

function exactKeys(value, keys) {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
}

function safeInt(value, min = 0, max = MAX_SAFE) {
  assert.ok(Number.isSafeInteger(value) && value >= min && value <= max);
}

function id(value) { assert.match(value, ID); }
function experimentId(value) { assert.match(value, EXPERIMENT_ID); }
function windowId(value) { assert.match(value, WINDOW_ID); }
function surfaceId(value) { assert.match(value, SURFACE_ID); }
function operationId(value) { assert.match(value, OPERATION_ID); }
function collectorId(value) { assert.match(value, COLLECTOR_ID); }
function policyId(value) { assert.match(value, POLICY_ID); }
function hash(value) { assert.match(value, HEX64); }
function hour(value) {
  assert.match(value, HOUR);
  assert.equal(new Date(`${value}:00:00.000Z`).toISOString(), `${value}:00:00.000Z`);
}
function utc(value) {
  assert.match(value, UTC_MS);
  assert.equal(new Date(value).toISOString(), value);
}

function assertNoForbidden(value) {
  function walk(current) {
    if (current === null || typeof current !== "object") return;
    if (Array.isArray(current)) { current.forEach(walk); return; }
    for (const [key, child] of Object.entries(current)) {
      if (FORBIDDEN.test(key.replaceAll("-", ""))) throw new Error(`forbidden:${key}`);
      walk(child);
    }
  }
  walk(value);
}

function locator(value) {
  assert.equal(typeof value, "string");
  assert.ok(Buffer.byteLength(value, "utf8") >= 1 && Buffer.byteLength(value, "utf8") <= 240);
  assert.equal(path.isAbsolute(value), false);
  assert.equal(/[\\?#%\0-\x1f\x7f]/.test(value), false);
  assert.ok(value.split("/").every((part) => part && part !== "." && part !== ".."));
}

function validateEnvelope(envelope, expectedRole = null) {
  exactKeys(envelope, ENVELOPE_KEYS);
  assert.equal(envelope.schemaVersion, "samedaydesk.exposure-authority.r11.v1");
  id(envelope.authorityId);
  assert.ok(ROLES.includes(envelope.role));
  if (expectedRole) assert.equal(envelope.role, expectedRole);
  assert.ok(["available", "unavailable"].includes(envelope.availability));
  locator(envelope.locator);
  if (envelope.availability === "available") {
    hash(envelope.sha256);
    safeInt(envelope.bytes, 1, LIMITS.maxAuthorityBytes);
    assert.equal(envelope.unavailableReason, null);
    if (envelope.sourceCommit === null || envelope.sourceTree === null) {
      assert.equal(envelope.sourceCommit, null);
      assert.equal(envelope.sourceTree, null);
    } else {
      assert.match(envelope.sourceCommit, HEX40);
      assert.match(envelope.sourceTree, HEX40);
    }
  } else {
    assert.equal(envelope.sha256, null);
    assert.equal(envelope.bytes, null);
    assert.equal(envelope.sourceCommit, null);
    assert.equal(envelope.sourceTree, null);
    assert.ok(["missing", "unreadable", "hash_mismatch", "byte_count_mismatch", "conflict", "unsupported"].includes(envelope.unavailableReason));
  }
  return envelope;
}

function failureCodeForUnavailable(envelope) {
  return {
    missing: "authority_missing",
    unreadable: "authority_unreadable",
    hash_mismatch: "authority_hash_mismatch",
    byte_count_mismatch: "authority_byte_count_mismatch",
    conflict: "authority_conflict",
    unsupported: "authority_unsupported",
  }[envelope.unavailableReason];
}

function readAuthority(root, envelope) {
  validateEnvelope(envelope);
  if (envelope.availability !== "available") throw new DataFailure(failureCodeForUnavailable(envelope));
  let rootReal;
  try { rootReal = fs.realpathSync(root); }
  catch { throw new DataFailure("authority_unreadable"); }
  const candidate = path.resolve(rootReal, envelope.locator);
  const relative = path.relative(rootReal, candidate);
  if (relative === "" || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new DataFailure("authority_unreadable");
  }
  let cursor = rootReal;
  for (const segment of envelope.locator.split("/")) {
    cursor = path.join(cursor, segment);
    let component;
    try { component = fs.lstatSync(cursor); }
    catch (error) {
      if (error?.code === "ENOENT") throw new DataFailure("authority_missing");
      throw new DataFailure("authority_unreadable");
    }
    if (component.isSymbolicLink()) throw new DataFailure("authority_symlink");
  }
  let before;
  try { before = fs.lstatSync(candidate); }
  catch (error) {
    if (error?.code === "ENOENT") throw new DataFailure("authority_missing");
    throw new DataFailure("authority_unreadable");
  }
  if (before.isSymbolicLink()) throw new DataFailure("authority_symlink");
  if (!before.isFile()) throw new DataFailure("authority_non_regular");
  if (before.size > LIMITS.maxAuthorityBytes) throw new DataFailure("authority_oversize");
  let descriptor;
  let bytes;
  try {
    descriptor = fs.openSync(candidate, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const openedBefore = fs.fstatSync(descriptor);
    if (!openedBefore.isFile()) throw new DataFailure("authority_non_regular");
    if (openedBefore.dev !== before.dev || openedBefore.ino !== before.ino) throw new DataFailure("authority_conflict");
    if (process.platform === "linux") {
      const openedReal = fs.realpathSync(`/proc/self/fd/${descriptor}`);
      const openedRelative = path.relative(rootReal, openedReal);
      if (openedRelative === "" || path.isAbsolute(openedRelative) || openedRelative === ".." || openedRelative.startsWith(`..${path.sep}`)) {
        throw new DataFailure("authority_symlink");
      }
      if (openedReal !== candidate) throw new DataFailure("authority_symlink");
    }
    const chunks = [];
    let total = 0;
    while (total <= LIMITS.maxAuthorityBytes) {
      const remaining = LIMITS.maxAuthorityBytes + 1 - total;
      const chunk = Buffer.allocUnsafe(Math.min(65_536, remaining));
      const count = fs.readSync(descriptor, chunk, 0, chunk.length, null);
      if (count === 0) break;
      chunks.push(chunk.subarray(0, count));
      total += count;
    }
    bytes = Buffer.concat(chunks, total);
    const openedAfter = fs.fstatSync(descriptor);
    if (!openedAfter.isFile() || openedAfter.dev !== openedBefore.dev || openedAfter.ino !== openedBefore.ino) {
      throw new DataFailure("authority_conflict");
    }
  } catch (error) {
    if (error instanceof DataFailure) throw error;
    if (error?.code === "ELOOP") throw new DataFailure("authority_symlink");
    throw new DataFailure("authority_unreadable");
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  if (bytes.length > LIMITS.maxAuthorityBytes) throw new DataFailure("authority_oversize");
  if (bytes.length !== envelope.bytes) throw new DataFailure("authority_byte_count_mismatch");
  if (sha256(bytes) !== envelope.sha256) throw new DataFailure("authority_hash_mismatch");
  return bytes;
}

function routeKey(method, url) {
  return sha256(Buffer.concat([Buffer.from(method), Buffer.from([0]), Buffer.from(url)]));
}

function boundedHourCount(start, end) {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  assert.ok(Number.isFinite(startMs) && Number.isFinite(endMs));
  const deltaMs = endMs - startMs;
  assert.ok(Number.isSafeInteger(deltaMs) && deltaMs > 0 && deltaMs % 3_600_000 === 0);
  const count = deltaMs / 3_600_000;
  assert.ok(Number.isSafeInteger(count) && count >= 1 && count <= LIMITS.maxHours);
  return count;
}

function hoursBetween(start, end) {
  const count = boundedHourCount(start, end);
  const startMs = Date.parse(start);
  return Array.from({ length: count }, (_, index) => new Date(startMs + index * 3_600_000).toISOString().slice(0, 13));
}

function validateRoute(route, origin) {
  exactKeys(route, ROUTE_KEYS);
  hash(route.routeKey);
  surfaceId(route.surfaceId);
  assert.equal(route.method, "GET");
  assert.match(route.path, /^\/[A-Za-z0-9._~/-]+$/);
  assert.equal(route.path.includes("//"), false);
  assert.equal(route.path.includes("%"), false);
  assert.ok(route.path.split("/").slice(1).every((part) => part && part !== "." && part !== ".."));
  assert.equal(route.canonicalUrl, `${origin}${route.path}`);
  const parsed = new URL(route.canonicalUrl);
  assert.equal(parsed.origin, origin);
  assert.equal(parsed.search, "");
  assert.equal(parsed.hash, "");
  assert.equal(route.routeKey, routeKey("GET", route.canonicalUrl));
  operationId(route.operationId);
  id(route.documentAuthorityId);
  hash(route.documentSha256);
  safeInt(route.windowStartOrdinal);
  hash(route.windowStartLedgerSha256);
}

function validateManifest(manifest) {
  exactKeys(manifest, MANIFEST_KEYS);
  assertNoForbidden(manifest);
  assert.equal(manifest.schemaVersion, "samedaydesk.openapi-exposure-only.r11.manifest.v1");
  experimentId(manifest.experimentId);
  windowId(manifest.windowId);
  assert.ok(["baseline", "treatment", "monitoring"].includes(manifest.phase));
  const origin = new URL(manifest.origin);
  assert.equal(origin.protocol, "https:");
  assert.equal(origin.origin, manifest.origin);
  assert.equal(origin.pathname, "/");
  assert.equal(origin.search, "");
  assert.equal(origin.hash, "");
  utc(manifest.windowStartUtc);
  utc(manifest.windowEndUtc);
  assert.equal(manifest.windowStartUtc.endsWith("00:00.000Z"), true);
  assert.equal(manifest.windowEndUtc.endsWith("00:00.000Z"), true);
  const expectedHours = hoursBetween(manifest.windowStartUtc, manifest.windowEndUtc);
  assert.ok(expectedHours.length >= 1 && expectedHours.length <= LIMITS.maxHours);
  id(manifest.collectorSourceAuthorityId);
  hash(manifest.collectorSourceSha256);
  id(manifest.coveragePolicyAuthorityId);
  hash(manifest.coveragePolicySha256);
  exactKeys(manifest.limits, LIMIT_KEYS);
  assert.equal(canonical(manifest.limits), canonical(LIMITS));
  assert.ok(Array.isArray(manifest.routes) && manifest.routes.length >= 1 && manifest.routes.length <= LIMITS.maxRoutes);
  manifest.routes.forEach((route) => validateRoute(route, manifest.origin));
  const routeKeys = manifest.routes.map((route) => route.routeKey);
  assert.deepEqual(routeKeys, [...new Set(routeKeys)].sort(byteCompare));
  assert.ok(Array.isArray(manifest.routeHours));
  const actualPairs = [];
  for (const binding of manifest.routeHours) {
    exactKeys(binding, ROUTE_HOUR_KEYS);
    hash(binding.routeKey);
    hour(binding.hourId);
    id(binding.rawHourAuthorityId);
    actualPairs.push(`${binding.routeKey}\0${binding.hourId}`);
  }
  const expectedPairs = routeKeys.flatMap((key) => expectedHours.map((hourId) => `${key}\0${hourId}`));
  assert.deepEqual(actualPairs, expectedPairs);
  assert.equal(new Set(manifest.routeHours.map((item) => item.rawHourAuthorityId)).size, manifest.routeHours.length);
  return expectedHours;
}

function ledgerPayload(fields) {
  const payload = {
    manifestSha256: fields.manifestSha256,
    experimentId: fields.experimentId,
    windowId: fields.windowId,
    hourId: fields.hourId,
    routeKey: fields.routeKey,
    rawHourAuthorityId: fields.rawHourAuthorityId,
    sourceStartOrdinal: fields.sourceStartOrdinal,
    sourceEndOrdinal: fields.sourceEndOrdinal,
    declaredHighWaterExclusive: fields.declaredHighWaterExclusive,
    previousSourceLedgerSha256: fields.previousSourceLedgerSha256,
    observationSetSha256: fields.observationSetSha256,
    collectorSourceSha256: fields.collectorSourceSha256,
    coveragePolicySha256: fields.coveragePolicySha256,
  };
  return Buffer.concat([Buffer.from("samedaydesk-exposure-ledger/r11"), Buffer.from([0]), Buffer.from(canonical(payload))]);
}

function closePayload(fields) {
  const payload = {
    manifestSha256: fields.manifestSha256,
    experimentId: fields.experimentId,
    windowId: fields.windowId,
    hourId: fields.hourId,
    routeKey: fields.routeKey,
    rawHourAuthorityId: fields.rawHourAuthorityId,
    sourceStartOrdinal: fields.sourceStartOrdinal,
    sourceEndOrdinal: fields.sourceEndOrdinal,
    declaredHighWaterExclusive: fields.declaredHighWaterExclusive,
    previousSourceLedgerSha256: fields.previousSourceLedgerSha256,
    sourceLedgerSha256: fields.sourceLedgerSha256,
    observationSetSha256: fields.observationSetSha256,
    collectorSourceSha256: fields.collectorSourceSha256,
    coveragePolicySha256: fields.coveragePolicySha256,
  };
  return Buffer.concat([Buffer.from("samedaydesk-exposure-close/r11"), Buffer.from([0]), Buffer.from(canonical(payload))]);
}

function validateObservation(observation, context) {
  exactKeys(observation, OBS_KEYS);
  assertNoForbidden(observation);
  assert.equal(observation.schemaVersion, 1);
  for (const key of ["experimentId", "windowId", "hourId", "routeKey"]) assert.equal(observation[key], context[key]);
  safeInt(observation.sourceOrdinal, context.startOrdinal, context.endOrdinal - 1);
  for (const key of ["surfaceId", "method", "path", "canonicalUrl"]) assert.equal(observation[key], context.route[key]);
  safeInt(observation.httpStatus, observation.contentTypeClass === "no_response" ? 0 : 100, observation.contentTypeClass === "no_response" ? 0 : 599);
  assert.ok(["valid_json", "invalid_json", "not_json", "no_response"].includes(observation.contentTypeClass));
  safeInt(observation.responseBytes, 0, LIMITS.maxResponseBytes);
  assert.equal(observation.collectorSourceSha256, context.collectorSourceSha256);
  if (observation.contentTypeClass === "no_response") {
    if (observation.httpStatus !== 0 || observation.responseBytes !== 0 || observation.responseSha256 !== null) {
      throw new DataFailure("response_invalid");
    }
  } else if (observation.responseBytes === 0) {
    if (observation.responseSha256 !== null) throw new DataFailure("response_invalid");
  } else {
    try { hash(observation.responseSha256); }
    catch { throw new DataFailure("response_invalid"); }
  }
  if (observation.contentTypeClass === "valid_json") {
    if (observation.httpStatus !== 200 || observation.responseSha256 !== context.documentSha256 || observation.responseBytes !== context.documentBytes) {
      throw new DataFailure("response_invalid");
    }
  }
}

function result(summary, aggregates) {
  const out = {
    schemaVersion: "samedaydesk.openapi-exposure-only.r11.derivation-result.v1",
    availability: summary.availability,
    summary,
    aggregates,
  };
  exactKeys(out, RESULT_KEYS);
  if (out.availability === "available") assert.ok(Array.isArray(out.aggregates));
  else assert.equal(out.aggregates, null);
  return out;
}

function unavailableResult(expectedManifestSha256, code, context = {}) {
  assert.ok(UNAVAILABLE_REASONS.has(code));
  const summary = {
    schemaVersion: "samedaydesk.exposure-summary.r11.v1",
    manifestSha256: HEX64.test(expectedManifestSha256 ?? "") ? expectedManifestSha256 : null,
    experimentId: context.experimentId ?? null,
    windowId: context.windowId ?? null,
    availability: "unavailable",
    coverageBasis: null,
    derivedRouteHourCount: null,
    totalExposureCount: null,
    validDocumentCount: null,
    invalidDocumentCount: null,
    minimumExposurePerRouteHour: null,
    maximumExposurePerRouteHour: null,
    meanExposurePerRouteHour: null,
    validDocumentShare: null,
    authoritySetSha256: context.authoritySetSha256 ?? null,
    derivedAggregateSetSha256: null,
    unavailableReason: code,
    evidenceSha256: null,
  };
  summary.evidenceSha256 = evidenceHash(summary);
  exactKeys(summary, SUMMARY_KEYS);
  return result(summary, null);
}

function evidenceHash(object) {
  const copy = { ...object };
  delete copy.evidenceSha256;
  return sha256(Buffer.from(canonical(copy)));
}

function derive(liveRequest) {
  let expected = null;
  let context = {};
  let request;
  try {
    request = safeSnapshot(liveRequest);
    exactKeys(request, REQUEST_KEYS);
    assert.equal(request.schemaVersion, "samedaydesk.openapi-exposure-only.r11.derivation-request.v1");
    assert.equal(typeof request.rootPath, "string");
    hash(request.expectedManifestSha256);
    expected = request.expectedManifestSha256;
    validateEnvelope(request.manifestAuthority);
    assert.ok(Array.isArray(request.authorities) && request.authorities.length <= LIMITS.maxAuthorities);
  } catch {
    return unavailableResult(expected, "request_invalid");
  }
  try {
    if (request.manifestAuthority.availability !== "available") throw new DataFailure(failureCodeForUnavailable(request.manifestAuthority));
    if (request.manifestAuthority.role !== "route_manifest") throw new DataFailure("authority_conflict");
    if (request.manifestAuthority.sha256 !== expected) throw new DataFailure("authority_conflict");
    const manifestBytes = readAuthority(request.rootPath, request.manifestAuthority);
    let manifest;
    try { manifest = parseClosed(manifestBytes); validateManifest(manifest); }
    catch { throw new DataFailure("authority_payload_invalid"); }
    context = { experimentId: manifest.experimentId, windowId: manifest.windowId };

    const envelopes = [];
    const ids = new Set();
    for (const envelope of request.authorities) {
      try { validateEnvelope(envelope); } catch { throw new DataFailure("authority_payload_invalid"); }
      if (ids.has(envelope.authorityId)) throw new DataFailure("authority_conflict");
      ids.add(envelope.authorityId);
      envelopes.push(envelope);
    }
    if (ids.has(request.manifestAuthority.authorityId)) throw new DataFailure("authority_conflict");
    const sorted = [...envelopes].sort((a, b) => byteCompare(a.authorityId, b.authorityId));
    if (canonical(sorted) !== canonical(envelopes)) throw new DataFailure("authority_conflict");
    const byId = new Map(envelopes.map((envelope) => [envelope.authorityId, envelope]));
    const expectedAuthorityIds = [
      manifest.collectorSourceAuthorityId,
      manifest.coveragePolicyAuthorityId,
      ...manifest.routes.map((route) => route.documentAuthorityId),
      ...manifest.routeHours.map((binding) => binding.rawHourAuthorityId),
    ].sort(byteCompare);
    if (new Set(expectedAuthorityIds).size !== expectedAuthorityIds.length || canonical(envelopes.map((entry) => entry.authorityId)) !== canonical(expectedAuthorityIds)) {
      throw new DataFailure("inventory_incomplete");
    }
    context.authoritySetSha256 = sha256(Buffer.from(canonical([request.manifestAuthority, ...envelopes])));
    const need = (authorityId, role, expectedHash = null) => {
      const envelope = byId.get(authorityId);
      if (!envelope) throw new DataFailure("authority_absent");
      if (envelope.availability !== "available") throw new DataFailure(failureCodeForUnavailable(envelope));
      if (envelope.role !== role) throw new DataFailure("authority_conflict");
      if (expectedHash && envelope.sha256 !== expectedHash) throw new DataFailure("authority_conflict");
      return envelope;
    };

    const collectorEnvelope = need(manifest.collectorSourceAuthorityId, "collector_source", manifest.collectorSourceSha256);
    const policyEnvelope = need(manifest.coveragePolicyAuthorityId, "coverage_policy", manifest.coveragePolicySha256);
    let collector;
    let policy;
    try {
      collector = parseClosed(readAuthority(request.rootPath, collectorEnvelope));
      policy = parseClosed(readAuthority(request.rootPath, policyEnvelope));
      exactKeys(collector, COLLECTOR_KEYS);
      exactKeys(policy, POLICY_KEYS);
      assertNoForbidden(collector);
      assertNoForbidden(policy);
      assert.equal(collector.schemaVersion, "samedaydesk.exposure-collector-source.r11.v1");
      collectorId(collector.collectorId);
      assert.equal(collector.closeAlgorithm, "ed25519");
      assert.equal(policy.schemaVersion, "samedaydesk.exposure-coverage-policy.r11.v1");
      policyId(policy.policyId);
      assert.equal(policy.ceilingMode, "collector_declared_ordinal_ceiling_v1");
      assert.equal(policy.hourBoundary, "utc");
      assert.equal(policy.missingMeans, "unavailable");
    } catch (error) {
      if (error instanceof DataFailure) throw error;
      throw new DataFailure("authority_payload_invalid");
    }
    let publicKey;
    try {
      const der = Buffer.from(collector.closePublicKeySpkiBase64, "base64");
      assert.equal(der.toString("base64"), collector.closePublicKeySpkiBase64);
      publicKey = crypto.createPublicKey({ key: der, type: "spki", format: "der" });
      assert.equal(publicKey.asymmetricKeyType, "ed25519");
    } catch { throw new DataFailure("authority_payload_invalid"); }

    const documents = new Map();
    for (const route of manifest.routes) {
      const envelope = need(route.documentAuthorityId, "document_bytes", route.documentSha256);
      const bytes = readAuthority(request.rootPath, envelope);
      documents.set(route.routeKey, { sha256: sha256(bytes), bytes: bytes.length });
    }

    const aggregateRows = [];
    const hourBindings = new Map(manifest.routeHours.map((item) => [`${item.routeKey}\0${item.hourId}`, item]));
    for (const route of manifest.routes) {
      let expectedOrdinal = route.windowStartOrdinal;
      let expectedLedger = route.windowStartLedgerSha256;
      const routeHours = hoursBetween(manifest.windowStartUtc, manifest.windowEndUtc);
      for (const hourId of routeHours) {
        const binding = hourBindings.get(`${route.routeKey}\0${hourId}`);
        if (!binding) throw new DataFailure("inventory_incomplete");
        const envelope = need(binding.rawHourAuthorityId, "raw_hour");
        const rawBytes = readAuthority(request.rootPath, envelope);
        let raw;
        try { raw = parseClosed(rawBytes); exactKeys(raw, RAW_KEYS); assertNoForbidden(raw); }
        catch { throw new DataFailure("raw_hour_invalid"); }
        try {
          assert.equal(raw.schemaVersion, "samedaydesk.exposure-raw-hour.r11.v1");
          assert.equal(raw.experimentId, manifest.experimentId);
          assert.equal(raw.windowId, manifest.windowId);
          assert.equal(raw.hourId, hourId);
          assert.equal(raw.routeKey, route.routeKey);
          assert.equal(raw.rawHourAuthorityId, binding.rawHourAuthorityId);
          safeInt(raw.sourceStartOrdinal);
          safeInt(raw.sourceEndOrdinal);
          safeInt(raw.declaredHighWaterExclusive);
          if (raw.sourceStartOrdinal !== expectedOrdinal) throw new DataFailure("ordinal_gap");
          if (raw.previousSourceLedgerSha256 !== expectedLedger) throw new DataFailure("ledger_gap");
          if (raw.sourceEndOrdinal < raw.sourceStartOrdinal || raw.declaredHighWaterExclusive !== raw.sourceEndOrdinal) throw new DataFailure("ordinal_gap");
          if (!Array.isArray(raw.observations) || raw.observations.length > LIMITS.maxObservationsPerHour) throw new DataFailure("raw_hour_invalid");
          if (raw.sourceEndOrdinal - raw.sourceStartOrdinal !== raw.observations.length) throw new DataFailure("ordinal_gap");
          assert.equal(raw.collectorSourceSha256, manifest.collectorSourceSha256);
          assert.equal(raw.coveragePolicySha256, manifest.coveragePolicySha256);
          const doc = documents.get(route.routeKey);
          for (let i = 0; i < raw.observations.length; i += 1) {
            const observation = raw.observations[i];
            validateObservation(observation, {
              experimentId: manifest.experimentId,
              windowId: manifest.windowId,
              hourId,
              routeKey: route.routeKey,
              route,
              startOrdinal: raw.sourceStartOrdinal,
              endOrdinal: raw.sourceEndOrdinal,
              collectorSourceSha256: manifest.collectorSourceSha256,
              documentSha256: doc.sha256,
              documentBytes: doc.bytes,
            });
            if (observation.sourceOrdinal !== raw.sourceStartOrdinal + i) throw new DataFailure("ordinal_gap");
          }
          const observationsDigest = sha256(Buffer.from(canonical(raw.observations)));
          assert.equal(raw.observationSetSha256, observationsDigest);
          const fields = { ...raw, manifestSha256: expected };
          const derivedLedger = sha256(ledgerPayload(fields));
          if (raw.sourceLedgerSha256 !== derivedLedger) throw new DataFailure("ledger_gap");
          let seal;
          try {
            seal = Buffer.from(raw.closeSealBase64, "base64");
            assert.equal(seal.toString("base64"), raw.closeSealBase64);
          } catch { throw new DataFailure("close_invalid"); }
          if (!crypto.verify(null, closePayload(fields), publicKey, seal)) throw new DataFailure("close_invalid");
        } catch (error) {
          if (error instanceof DataFailure) throw error;
          throw new DataFailure("raw_hour_invalid");
        }
        const valid = raw.observations.filter((item) => item.contentTypeClass === "valid_json").length;
        const aggregate = {
          schemaVersion: "samedaydesk.exposure-hour-aggregate.r11.v1",
          manifestSha256: expected,
          experimentId: manifest.experimentId,
          windowId: manifest.windowId,
          hourId,
          routeKey: route.routeKey,
          availability: "available",
          coverageBasis: "collector_declared_ceiling",
          exposureCount: raw.observations.length,
          validDocumentCount: valid,
          invalidDocumentCount: raw.observations.length - valid,
          rawHourAuthoritySha256: sha256(rawBytes),
          rawHourByteCount: rawBytes.length,
          observationSetSha256: raw.observationSetSha256,
          sourceLedgerSha256: raw.sourceLedgerSha256,
          evidenceSha256: null,
        };
        aggregate.evidenceSha256 = evidenceHash(aggregate);
        exactKeys(aggregate, AGG_KEYS);
        aggregateRows.push(aggregate);
        expectedOrdinal = raw.sourceEndOrdinal;
        expectedLedger = raw.sourceLedgerSha256;
      }
    }
    if (aggregateRows.length !== manifest.routes.length * hoursBetween(manifest.windowStartUtc, manifest.windowEndUtc).length) throw new DataFailure("inventory_incomplete");
    const exposures = aggregateRows.map((row) => row.exposureCount);
    const total = exposures.reduce((a, b) => a + b, 0);
    const valid = aggregateRows.reduce((sum, row) => sum + row.validDocumentCount, 0);
    const invalid = aggregateRows.reduce((sum, row) => sum + row.invalidDocumentCount, 0);
    for (const number of [total, valid, invalid]) safeInt(number);
    const fixed = (number) => {
      if (!Number.isFinite(number)) throw new DataFailure("raw_hour_invalid");
      const value = number.toFixed(6);
      assert.match(value, FIXED6);
      return value;
    };
    const summary = {
      schemaVersion: "samedaydesk.exposure-summary.r11.v1",
      manifestSha256: expected,
      experimentId: manifest.experimentId,
      windowId: manifest.windowId,
      availability: "available",
      coverageBasis: "collector_declared_ceiling",
      derivedRouteHourCount: aggregateRows.length,
      totalExposureCount: total,
      validDocumentCount: valid,
      invalidDocumentCount: invalid,
      minimumExposurePerRouteHour: Math.min(...exposures),
      maximumExposurePerRouteHour: Math.max(...exposures),
      meanExposurePerRouteHour: fixed(total / aggregateRows.length),
      validDocumentShare: fixed(total === 0 ? 0 : valid / total),
      authoritySetSha256: context.authoritySetSha256,
      derivedAggregateSetSha256: sha256(Buffer.from(canonical(aggregateRows))),
      unavailableReason: null,
      evidenceSha256: null,
    };
    summary.evidenceSha256 = evidenceHash(summary);
    exactKeys(summary, SUMMARY_KEYS);
    return result(summary, aggregateRows);
  } catch (error) {
    if (error instanceof DataFailure) return unavailableResult(expected, error.code, context);
    throw error;
  }
}

export const OPENAPI_EXPOSURE_ONLY_LIMITS_R11 = LIMITS;
export function deriveOpenApiExposureOnlyAggregateR11(liveRequest) { return derive(liveRequest); }
