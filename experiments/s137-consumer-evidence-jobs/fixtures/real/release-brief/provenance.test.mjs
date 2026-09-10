import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_CLASSES = Object.freeze(["synthetic", "fixture", "live-capture"]);
const SHA_RE = /^[0-9a-f]{40}$/i;
const TEST_KEY_RE = /test|ci|coverage|check_run|workflow/i;

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function loadJson(name) {
  return JSON.parse(readFileSync(join(dir, name), "utf8"));
}

function requireProvenance(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("provenance required");
  }
  if (typeof record.retrievedAt !== "string" || record.retrievedAt.length === 0) {
    throw new Error("retrievedAt required");
  }
  const url = record.url || record.artifacts?.[0]?.url;
  if (typeof url !== "string" || url.length === 0) {
    throw new Error("url required");
  }
  const hash = record.sha256 || record.artifacts?.[0]?.sha256;
  if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) {
    throw new Error("sha256 required");
  }
  if (!record.license || typeof record.license.note !== "string" || record.license.note.length === 0) {
    throw new Error("license note required");
  }
  if (record.evidenceClass && !EVIDENCE_CLASSES.includes(record.evidenceClass)) {
    throw new Error(`evidenceClass must be one of ${EVIDENCE_CLASSES.join("|")}`);
  }
  if (!Array.isArray(record.citations) || record.citations.length === 0) {
    throw new Error("citations required");
  }
  for (const c of record.citations) {
    if (!c?.id) throw new Error("citation.id required");
    if (!c?.url && !c?.path) throw new Error("citation url or path required");
    if (c.sha256 && !/^[0-9a-f]{64}$/.test(c.sha256)) throw new Error("citation sha256 malformed");
  }
  return record;
}

function headerValue(headersText, name) {
  const needle = name.toLowerCase() + ":";
  for (const line of headersText.split(/\r?\n/)) {
    if (line.toLowerCase().startsWith(needle)) {
      return line.slice(line.indexOf(":") + 1).trim();
    }
  }
  return null;
}

function httpDateToIso(httpDate) {
  const ms = Date.parse(httpDate);
  if (Number.isNaN(ms)) throw new Error(`unparseable HTTP Date: ${httpDate}`);
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

const provenance = loadJson("PROVENANCE.json");
const snapshotBuf = readFileSync(join(dir, "github-express-v5.2.1.json"));
const headersBuf = readFileSync(join(dir, "github-express-v5.2.1.headers.txt"));
const snapshot = JSON.parse(snapshotBuf.toString("utf8"));
const headersText = headersBuf.toString("utf8");

test("positive: provenance contract and snapshot hash", () => {
  const p = requireProvenance(provenance);
  assert.equal(p.schema, "s137.consumer-evidence.real-fixture.v1");
  assert.equal(p.evidenceClass, "fixture");
  assert.equal(p.captureLabel, "live-capture");
  assert.equal(p.jobId, "R2-CONSUMER-JOBS-02");
  assert.equal(p.payment.attempted, false);
  assert.equal(p.retrievedAt, "2026-09-10T11:23:59Z");
  assert.equal(
    p.url,
    "https://api.github.com/repos/expressjs/express/releases/tags/v5.2.1",
  );
  assert.equal(sha256(snapshotBuf), p.sha256);
  assert.equal(sha256(snapshotBuf), "0edb4d411bd1cfbafacffe1c690e1467deb5f3f2ed3b7a05541af3034d27fe5f");
  assert.equal(snapshotBuf.byteLength, 2442);
  assert.equal(snapshot.tag_name, "v5.2.1");
  assert.equal(snapshot.id, 266525532);
  assert.equal(snapshot.draft, false);
  assert.equal(snapshot.prerelease, false);
  assert.equal(typeof snapshot.body, "string");
  assert.ok(snapshot.body.length > 0);
  assert.equal(p.claims.inventsFacts, false);
  assert.equal(p.claims.paidEndpoint, false);
  assert.equal(p.claims.legalAttestation, false);
  assert.equal(p.claims.modelAsOracle, false);
  assert.equal(p.capture.offline, true);
  const releaseCite = p.citations.find((c) => c.id === "github-release-express-v5.2.1");
  assert.ok(releaseCite);
  assert.equal(releaseCite.sha256, p.sha256);
  assert.equal(
    releaseCite.path,
    "experiments/s137-consumer-evidence-jobs/fixtures/real/release-brief/github-express-v5.2.1.json",
  );
});

test("positive: headers Date matches retrievedAt", () => {
  assert.equal(sha256(headersBuf), provenance.artifacts[1].sha256);
  const date = headerValue(headersText, "date");
  assert.equal(date, "Thu, 10 Sep 2026 11:23:59 GMT");
  assert.equal(httpDateToIso(date), provenance.retrievedAt);
  assert.match(headersText, /^HTTP\/2 200 /);
});

test("negative: missing provenance fields are rejected", () => {
  assert.throws(() => requireProvenance(null), /provenance required/);
  assert.throws(() => requireProvenance({}), /retrievedAt required/);
  assert.throws(
    () => requireProvenance({ retrievedAt: "2026-09-10T11:23:59Z" }),
    /url required/,
  );
  assert.throws(
    () =>
      requireProvenance({
        retrievedAt: "2026-09-10T11:23:59Z",
        url: "https://example.invalid",
      }),
    /sha256 required/,
  );
  assert.throws(
    () =>
      requireProvenance({
        retrievedAt: "2026-09-10T11:23:59Z",
        url: "https://example.invalid",
        sha256: "0edb4d411bd1cfbafacffe1c690e1467deb5f3f2ed3b7a05541af3034d27fe5f",
      }),
    /license note required/,
  );
  assert.throws(
    () =>
      requireProvenance({
        retrievedAt: "2026-09-10T11:23:59Z",
        url: "https://example.invalid",
        sha256: "0edb4d411bd1cfbafacffe1c690e1467deb5f3f2ed3b7a05541af3034d27fe5f",
        license: { note: "MIT" },
        evidenceClass: "not-a-class",
        citations: [{ id: "x", url: "https://example.invalid" }],
      }),
    /evidenceClass must be one of/,
  );
  assert.throws(
    () =>
      requireProvenance({
        retrievedAt: "2026-09-10T11:23:59Z",
        url: "https://example.invalid",
        sha256: "0edb4d411bd1cfbafacffe1c690e1467deb5f3f2ed3b7a05541af3034d27fe5f",
        license: { note: "MIT" },
        citations: [],
      }),
    /citations required/,
  );
});

test("negative: pretty-print or truncation would fail the pin", () => {
  const pretty = Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`);
  assert.notEqual(sha256(pretty), provenance.sha256);
  assert.notEqual(sha256(snapshotBuf.subarray(0, 100)), provenance.sha256);
});

test("partial: shipped identity and artifacts are incomplete in this JSON", () => {
  assert.equal(snapshot.target_commitish, "master");
  assert.equal(SHA_RE.test(snapshot.target_commitish), false);
  assert.ok(Array.isArray(snapshot.assets));
  assert.equal(snapshot.assets.length, 0);
  assert.equal(typeof snapshot.tarball_url, "string");
  assert.match(snapshot.tarball_url, /tarball\/v5\.2\.1$/);
});

test("partial: tested lane is absent, not failed", () => {
  const keys = Object.keys(snapshot);
  assert.equal(keys.some((k) => TEST_KEY_RE.test(k)), false);
  assert.equal("check_runs_url" in snapshot, false);
  assert.equal("statuses_url" in snapshot, false);
  const body = snapshot.body || "";
  assert.equal(/\b(ci passed|tests passed|coverage)\b/i.test(body), false);
});

test("conflict: source timestamps disagree and must not be collapsed", () => {
  assert.equal(snapshot.created_at, "2025-12-01T20:27:35Z");
  assert.equal(snapshot.published_at, "2025-12-01T20:54:44Z");
  assert.equal(snapshot.updated_at, "2025-12-02T21:02:42Z");
  assert.notEqual(snapshot.created_at, snapshot.published_at);
  assert.notEqual(snapshot.published_at, snapshot.updated_at);
  assert.notEqual(snapshot.created_at, snapshot.updated_at);
});

test("conflict: announced body names v5.2.0 while tag_name is v5.2.1", () => {
  assert.equal(snapshot.tag_name, "v5.2.1");
  assert.equal(snapshot.name, "v5.2.1");
  assert.match(snapshot.body, /5\.2\.0/);
  assert.match(snapshot.body, /CVE-2024-51999/);
  assert.notEqual(snapshot.tag_name, "v5.2.0");
});
