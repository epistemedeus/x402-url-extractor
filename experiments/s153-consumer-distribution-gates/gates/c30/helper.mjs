/**
 * c30 S6 helper: load PIN, reuse S137 synthetic cases, JSON-clone packets.
 * Does not reimplement link-index transform/schema.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCase } from "../../../s137-consumer-evidence-jobs/fixtures/synthetic/link-index/catalog.mjs";
import { INPUT_SCHEMA, sha256Hex } from "../../../s137-consumer-evidence-jobs/src/link-index/schema.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ID_SAFE = /[^A-Za-z0-9._:-]+/g;

export const GATE_DIR = HERE;
export const PIN_PATH = join(HERE, "PIN.json");
export const REPO_ROOT = resolve(HERE, "../../../..");

export function loadPin() {
  return JSON.parse(readFileSync(PIN_PATH, "utf8"));
}

export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sha256File(absPath) {
  return sha256Bytes(readFileSync(absPath));
}

export function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeId(prefix, hint, used) {
  let core = String(hint || "x")
    .replace(ID_SAFE, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  if (!/^[A-Za-z]/.test(core)) core = `x${core}`;
  if (!core) core = "x";
  let id = `${prefix}-${core}`.slice(0, 128);
  let n = 2;
  while (used.has(id)) {
    const suffix = `-${n}`;
    id = `${prefix}-${core}`.slice(0, 128 - suffix.length) + suffix;
    n += 1;
  }
  used.add(id);
  return id;
}

/**
 * Build s137.link-index.input.v1 from a synthetic case id (same shape as
 * src/link-index/transform.mjs loadFixtureCase).
 */
export function fixtureInput(caseId) {
  const loaded = loadCase(caseId);
  const { expected, entrySource, dir } = loaded;
  const documents = [
    {
      id: "doc-entry",
      kind: expected.format === "html" ? "html" : "markdown",
      path: expected.entry,
      body: entrySource,
      contentSha256: sha256Hex(entrySource),
      mediaType: expected.format === "html" ? "text/html" : "text/markdown",
    },
  ];
  const artifacts = [];
  const used = new Set(["doc-entry"]);
  for (const cite of expected.citations || []) {
    if (!cite.path || cite.path === expected.entry) continue;
    const body = readFileSync(join(dir, cite.path), "utf8");
    artifacts.push({
      id: makeId("art", cite.path, used),
      path: cite.path,
      exists: true,
      contentSha256: sha256Hex(body),
      body,
    });
  }
  return {
    expected,
    input: {
      schema: INPUT_SCHEMA,
      clock: expected.clock,
      evidenceClass: "synthetic",
      caseKind: expected.kind === "conflict" ? "conflict" : expected.kind,
      documents,
      artifacts,
    },
  };
}

export function packetFields(packet) {
  return jsonClone({
    schema: packet.schema,
    packetSchema: packet.packetSchema,
    jobId: packet.jobId,
    artifactKind: packet.artifactKind,
    clock: packet.clock,
    evidenceClass: packet.evidenceClass,
    decision: packet.decision,
    offline: packet.offline,
    payment: packet.payment,
    claims: packet.claims,
    coverage: packet.coverage,
    bounds: packet.bounds,
    documents: packet.documents,
    links: packet.links,
    anchors: packet.anchors,
    targets: packet.targets,
    duplicates: packet.duplicates,
    unreachable: packet.unreachable,
    conflicts: packet.conflicts,
    findings: packet.findings,
    citations: packet.citations,
  });
}
