import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  deriveOpenApiExposureOnlyAggregateR11 as derive,
  OPENAPI_EXPOSURE_ONLY_LIMITS_R11 as LIMITS,
} from "./openapi-exposure-only-aggregate.mjs";
function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function byteCompare(a, b) {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}
function safeSnapshot(value) { return structuredClone(value); }
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
function routeKey(method, url) {
  return sha256(Buffer.concat([Buffer.from(method), Buffer.from([0]), Buffer.from(url)]));
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

function envelope(authorityId, role, locatorPath, bytes) {
  return {
    schemaVersion: "samedaydesk.exposure-authority.r11.v1",
    authorityId,
    role,
    availability: "available",
    locator: locatorPath,
    sha256: sha256(bytes),
    bytes: bytes.length,
    sourceCommit: null,
    sourceTree: null,
    unavailableReason: null,
  };
}

function jsonBytes(value) { return Buffer.from(canonical(value)); }

function buildFixture({ noncanonicalManifestNumber = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-exposure-r11-"));
  fs.mkdirSync(path.join(root, "authority"));
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicDer = publicKey.export({ type: "spki", format: "der" });
  const collector = {
    schemaVersion: "samedaydesk.exposure-collector-source.r11.v1",
    collectorId: "collector-main",
    closeAlgorithm: "ed25519",
    closePublicKeySpkiBase64: publicDer.toString("base64"),
  };
  const policy = {
    schemaVersion: "samedaydesk.exposure-coverage-policy.r11.v1",
    policyId: "policy-declared-ceiling",
    ceilingMode: "collector_declared_ordinal_ceiling_v1",
    hourBoundary: "utc",
    missingMeans: "unavailable",
  };
  const document = Buffer.from('{"openapi":"3.1.0"}\n');
  const collectorBytes = jsonBytes(collector);
  const policyBytes = jsonBytes(policy);
  fs.writeFileSync(path.join(root, "authority/collector.json"), collectorBytes);
  fs.writeFileSync(path.join(root, "authority/policy.json"), policyBytes);
  fs.writeFileSync(path.join(root, "authority/openapi.json"), document);
  const origin = "https://example.test";
  const canonicalUrl = `${origin}/openapi.json`;
  const key = routeKey("GET", canonicalUrl);
  const hourIds = ["2026-08-22T10", "2026-08-22T11"];
  const route = {
    routeKey: key,
    surfaceId: "surface-openapi",
    method: "GET",
    path: "/openapi.json",
    canonicalUrl,
    operationId: "op-get_openapi",
    documentAuthorityId: "document-main",
    documentSha256: sha256(document),
    windowStartOrdinal: 41,
    windowStartLedgerSha256: "0".repeat(64),
  };
  const manifest = {
    schemaVersion: "samedaydesk.openapi-exposure-only.r11.manifest.v1",
    experimentId: "exp-r11fixture",
    windowId: "win-r11fixture",
    phase: "monitoring",
    origin,
    windowStartUtc: "2026-08-22T10:00:00.000Z",
    windowEndUtc: "2026-08-22T12:00:00.000Z",
    collectorSourceAuthorityId: "collector-main",
    collectorSourceSha256: sha256(collectorBytes),
    coveragePolicyAuthorityId: "policy-main",
    coveragePolicySha256: sha256(policyBytes),
    routes: [route],
    routeHours: hourIds.map((hourId, index) => ({ routeKey: key, hourId, rawHourAuthorityId: `raw-${index}` })),
    limits: { ...LIMITS },
  };
  const canonicalManifestText = canonical(manifest);
  const physicalManifestText = noncanonicalManifestNumber
    ? canonicalManifestText.replace('"maxRoutes":32', '"maxRoutes":32.0')
    : canonicalManifestText;
  if (noncanonicalManifestNumber) assert.notEqual(physicalManifestText, canonicalManifestText);
  const manifestBytes = Buffer.from(physicalManifestText);
  const manifestSha = sha256(manifestBytes);
  fs.writeFileSync(path.join(root, "authority/manifest.json"), manifestBytes);

  const raws = [];
  let start = 41;
  let previousLedger = route.windowStartLedgerSha256;
  for (let index = 0; index < hourIds.length; index += 1) {
    const observations = index === 0 ? [{
      schemaVersion: 1,
      experimentId: manifest.experimentId,
      windowId: manifest.windowId,
      hourId: hourIds[index],
      routeKey: key,
      sourceOrdinal: start,
      surfaceId: route.surfaceId,
      method: route.method,
      path: route.path,
      canonicalUrl: route.canonicalUrl,
      httpStatus: 200,
      contentTypeClass: "valid_json",
      responseBytes: document.length,
      responseSha256: sha256(document),
      collectorSourceSha256: sha256(collectorBytes),
    }] : [];
    const end = start + observations.length;
    const raw = {
      schemaVersion: "samedaydesk.exposure-raw-hour.r11.v1",
      experimentId: manifest.experimentId,
      windowId: manifest.windowId,
      hourId: hourIds[index],
      routeKey: key,
      rawHourAuthorityId: `raw-${index}`,
      sourceStartOrdinal: start,
      sourceEndOrdinal: end,
      declaredHighWaterExclusive: end,
      previousSourceLedgerSha256: previousLedger,
      sourceLedgerSha256: null,
      observationSetSha256: sha256(Buffer.from(canonical(observations))),
      collectorSourceSha256: sha256(collectorBytes),
      coveragePolicySha256: sha256(policyBytes),
      observations,
      closeSealBase64: null,
    };
    const fields = { ...raw, manifestSha256: manifestSha };
    raw.sourceLedgerSha256 = sha256(ledgerPayload(fields));
    raw.closeSealBase64 = crypto.sign(null, closePayload({ ...raw, manifestSha256: manifestSha }), privateKey).toString("base64");
    const bytes = jsonBytes(raw);
    const locatorPath = `authority/raw-${index}.json`;
    fs.writeFileSync(path.join(root, locatorPath), bytes);
    raws.push({ raw, bytes, locatorPath, envelope: envelope(`raw-${index}`, "raw_hour", locatorPath, bytes) });
    start = end;
    previousLedger = raw.sourceLedgerSha256;
  }
  const authorities = [
    envelope("collector-main", "collector_source", "authority/collector.json", collectorBytes),
    envelope("document-main", "document_bytes", "authority/openapi.json", document),
    envelope("policy-main", "coverage_policy", "authority/policy.json", policyBytes),
    ...raws.map((entry) => entry.envelope),
  ].sort((a, b) => byteCompare(a.authorityId, b.authorityId));
  const request = {
    schemaVersion: "samedaydesk.openapi-exposure-only.r11.derivation-request.v1",
    rootPath: root,
    expectedManifestSha256: manifestSha,
    manifestAuthority: envelope("manifest-main", "route_manifest", "authority/manifest.json", manifestBytes),
    authorities,
  };
  return { root, privateKey, manifest, manifestSha, document, raws, request };
}

function clone(value) { return structuredClone(value); }

function rewriteManifestEnvelope(fixture, mutate) {
  const manifest = clone(fixture.manifest);
  mutate(manifest);
  const bytes = jsonBytes(manifest);
  fs.writeFileSync(path.join(fixture.root, "authority/manifest.json"), bytes);
  fixture.request.expectedManifestSha256 = sha256(bytes);
  fixture.request.manifestAuthority = envelope("manifest-main", "route_manifest", "authority/manifest.json", bytes);
}

function rewriteRaw(fixture, index, mutate, signer = fixture.privateKey) {
  const raw = clone(fixture.raws[index].raw);
  mutate(raw);
  raw.observationSetSha256 = sha256(Buffer.from(canonical(raw.observations)));
  raw.sourceLedgerSha256 = sha256(ledgerPayload({ ...raw, manifestSha256: fixture.manifestSha }));
  raw.closeSealBase64 = crypto.sign(null, closePayload({ ...raw, manifestSha256: fixture.manifestSha }), signer).toString("base64");
  const bytes = jsonBytes(raw);
  fs.writeFileSync(path.join(fixture.root, fixture.raws[index].locatorPath), bytes);
  const envelopeIndex = fixture.request.authorities.findIndex((item) => item.authorityId === `raw-${index}`);
  fixture.request.authorities[envelopeIndex] = envelope(`raw-${index}`, "raw_hour", fixture.raws[index].locatorPath, bytes);
  fixture.request.authorities.sort((a, b) => byteCompare(a.authorityId, b.authorityId));
  fixture.raws[index] = { raw, bytes, locatorPath: fixture.raws[index].locatorPath, envelope: fixture.request.authorities[envelopeIndex] };
}


function reason(value) { return value.summary.unavailableReason; }
function removeFixture(fixture) { fs.rmSync(fixture.root, { recursive: true, force: true }); }

test("R11 derives one exact exposure and one collector-declared zero", () => {
  const fixture = buildFixture();
  try {
    const value = derive(fixture.request);
    assert.equal(value.availability, "available");
    assert.deepEqual(Object.keys(value).sort(), ["aggregates", "availability", "schemaVersion", "summary"]);
    assert.equal(value.summary.totalExposureCount, 1);
    assert.equal(value.summary.validDocumentCount, 1);
    assert.equal(value.aggregates[1].exposureCount, 0);
    assert.equal(value.aggregates[1].coverageBasis, "collector_declared_ceiling");
  } finally { removeFixture(fixture); }
});

test("R11 snapshots descriptors without invoking a hostile getter", () => {
  const fixture = buildFixture();
  try {
    let reads = 0;
    const authorities = fixture.request.authorities;
    Object.defineProperty(fixture.request, "authorities", { enumerable: true, get() { reads += 1; return authorities; } });
    assert.equal(reason(derive(fixture.request)), "request_invalid");
    assert.equal(reads, 0);
  } finally { removeFixture(fixture); }
});

test("R11 rejects hidden, symbol, semantic-ID, aggregate, and summary inputs", () => {
  for (const mutate of [
    (f) => Object.defineProperty(f.request, "claimedSummary", { value: {}, enumerable: false }),
    (f) => { f.request[Symbol("hidden")] = 1; },
    (f) => { f.request.claimedAggregates = []; },
    (f) => { f.request.claimedSummary = {}; },
  ]) {
    const fixture = buildFixture();
    try { mutate(fixture); assert.equal(reason(derive(fixture.request)), "request_invalid"); }
    finally { removeFixture(fixture); }
  }
  const semantic = buildFixture();
  try { rewriteManifestEnvelope(semantic, (manifest) => { manifest.experimentId = "did:example:alice"; }); assert.equal(reason(derive(semantic.request)), "authority_payload_invalid"); }
  finally { removeFixture(semantic); }
});

test("R11 maps unavailable before an allowed but wrong role for every authority", () => {
  const targets = [
    [(f) => f.request.manifestAuthority, "document_bytes"],
    [(f) => f.request.authorities.find((e) => e.authorityId === "collector-main"), "coverage_policy"],
    [(f) => f.request.authorities.find((e) => e.authorityId === "policy-main"), "collector_source"],
    [(f) => f.request.authorities.find((e) => e.authorityId === "document-main"), "raw_hour"],
    [(f) => f.request.authorities.find((e) => e.authorityId === "raw-0"), "document_bytes"],
  ];
  const reasons = new Map([
    ["missing", "authority_missing"], ["unreadable", "authority_unreadable"],
    ["hash_mismatch", "authority_hash_mismatch"], ["byte_count_mismatch", "authority_byte_count_mismatch"],
    ["conflict", "authority_conflict"], ["unsupported", "authority_unsupported"],
  ]);
  for (const [get, wrongRole] of targets) for (const [unavailableReason, expected] of reasons) {
    const fixture = buildFixture();
    try {
      Object.assign(get(fixture), { role: wrongRole, availability: "unavailable", sha256: null, bytes: null, sourceCommit: null, sourceTree: null, unavailableReason });
      assert.equal(reason(derive(fixture.request)), expected);
    } finally { removeFixture(fixture); }
  }
});

test("R11 keeps every available wrong-role envelope conflicting", () => {
  const targets = [
    [(f) => f.request.manifestAuthority, "document_bytes"],
    [(f) => f.request.authorities.find((e) => e.authorityId === "collector-main"), "coverage_policy"],
    [(f) => f.request.authorities.find((e) => e.authorityId === "policy-main"), "collector_source"],
    [(f) => f.request.authorities.find((e) => e.authorityId === "document-main"), "raw_hour"],
    [(f) => f.request.authorities.find((e) => e.authorityId === "raw-0"), "document_bytes"],
  ];
  for (const [get, wrongRole] of targets) {
    const fixture = buildFixture();
    try { get(fixture).role = wrongRole; assert.equal(reason(derive(fixture.request)), "authority_conflict"); }
    finally { removeFixture(fixture); }
  }
});

test("R11 rejects manifest authority ID collisions with every inventory role", () => {
  for (const authorityId of ["collector-main", "policy-main", "document-main", "raw-0"]) {
    const fixture = buildFixture();
    try { fixture.request.manifestAuthority.authorityId = authorityId; assert.equal(reason(derive(fixture.request)), "authority_conflict"); }
    finally { removeFixture(fixture); }
  }
});

test("R11 binds exact response digest and byte count to physical document bytes", () => {
  for (const mutate of [
    (raw) => { raw.observations[0].responseSha256 = "a".repeat(64); },
    (raw) => { raw.observations[0].responseBytes += 1; },
  ]) {
    const fixture = buildFixture();
    try { rewriteRaw(fixture, 0, mutate); assert.equal(reason(derive(fixture.request)), "response_invalid"); }
    finally { removeFixture(fixture); }
  }
});

test("R11 rejects physical absence, mutation, ordinal gaps, and ledger gaps without zero", () => {
  const rows = [
    ["authority_missing", (f) => fs.unlinkSync(path.join(f.root, "authority/raw-1.json"))],
    ["authority_hash_mismatch", (f) => { const file = path.join(f.root, "authority/openapi.json"); const bytes = fs.readFileSync(file); bytes[0] ^= 1; fs.writeFileSync(file, bytes); }],
    ["ordinal_gap", (f) => rewriteRaw(f, 0, (raw) => { raw.sourceStartOrdinal += 1; raw.sourceEndOrdinal += 1; raw.declaredHighWaterExclusive += 1; raw.observations[0].sourceOrdinal += 1; })],
    ["ledger_gap", (f) => rewriteRaw(f, 1, (raw) => { raw.previousSourceLedgerSha256 = "f".repeat(64); })],
  ];
  for (const [expected, mutate] of rows) {
    const fixture = buildFixture();
    try { mutate(fixture); const value = derive(fixture.request); assert.equal(reason(value), expected); assert.equal(value.aggregates, null); }
    finally { removeFixture(fixture); }
  }
});

test("R11 admits non-shortest physical JSON while derived output remains canonical", () => {
  const fixture = buildFixture({ noncanonicalManifestNumber: true });
  try { assert(fs.readFileSync(path.join(fixture.root, "authority/manifest.json"), "utf8").includes('"maxRoutes":32.0')); assert.equal(derive(fixture.request).availability, "available"); assert.equal(canonical({ value: 1 }), '{"value":1}'); }
  finally { removeFixture(fixture); }
});

test("R11 rejects 11,001 authorities and preserves exact resource limits", () => {
  assert.deepEqual(LIMITS, { maxRoutes: 32, maxHours: 336, maxObservationsPerHour: 1000, maxResponseBytes: 1048576, maxAuthorityBytes: 4194304, maxEvidenceBytes: 8388608, maxAuthorities: 11000 });
  const fixture = buildFixture();
  try { const base = fixture.request.authorities[0]; fixture.request.authorities = Array.from({ length: 11001 }, (_, index) => ({ ...base, authorityId: `authority-${index}` })); assert.equal(reason(derive(fixture.request)), "request_invalid"); }
  finally { removeFixture(fixture); }
});

test("R11 supports trusted root slash without relaxing containment", { skip: process.platform !== "linux" }, () => {
  const fixture = buildFixture();
  try { const prefix = fixture.root.slice(1); fixture.request.rootPath = "/"; fixture.request.manifestAuthority.locator = `${prefix}/${fixture.request.manifestAuthority.locator}`; for (const item of fixture.request.authorities) item.locator = `${prefix}/${item.locator}`; assert.equal(derive(fixture.request).availability, "available"); }
  finally { removeFixture(fixture); }
});

test("R11 independently rejects counterfeit collector close", () => {
  const fixture = buildFixture();
  try { const attacker = crypto.generateKeyPairSync("ed25519"); rewriteRaw(fixture, 1, () => {}, attacker.privateKey); assert.equal(reason(derive(fixture.request)), "close_invalid"); }
  finally { removeFixture(fixture); }
});
