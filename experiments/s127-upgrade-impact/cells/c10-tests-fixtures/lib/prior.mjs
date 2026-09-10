import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PRIOR_SCHEMA } from "./constants.mjs";
import { sha256Hex, stableStringify } from "./hash.mjs";
import { tryReadJson } from "./fs-utils.mjs";

export function loadPrior(path) {
  const loaded = tryReadJson(path);
  if (!loaded.ok) {
    return {
      ok: false,
      code: loaded.code === "missing_path" ? "missing_prior" : loaded.code,
      message: loaded.code === "missing_path" ? "prior artifact is required at this path" : loaded.message,
      path,
    };
  }
  const doc = loaded.body;
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return { ok: false, code: "invalid_prior_shape", message: "prior artifact must be an object", path };
  }
  const payload = doc.payload ?? null;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, code: "invalid_prior_payload", message: "prior.payload object is required", path };
  }
  const sha256 = typeof doc.sha256 === "string" ? doc.sha256 : sha256Hex(payload);
  return {
    ok: true,
    path,
    prior: {
      schema: doc.schema || PRIOR_SCHEMA,
      createdAt: doc.createdAt ?? null,
      sequence: Number.isInteger(doc.sequence) ? doc.sequence : 1,
      sha256,
      payload,
      immutable: doc.immutable !== false,
      correction: doc.correction ?? null,
    },
  };
}

export function attachPrior(packet, priorLoad) {
  const next = { ...(packet || {}) };
  if (!priorLoad) {
    next.prior = { ref: null, sequence: 0, immutable: true, correction: null };
    return next;
  }
  if (!priorLoad.ok) {
    next.prior = { ref: priorLoad.path ?? null, sequence: 0, immutable: true, correction: null };
    next.limitations = [...(next.limitations || []), `prior_unreadable:${priorLoad.code}`];
    return next;
  }
  const prior = priorLoad.prior;
  next.prior = {
    ref: priorLoad.path,
    sha256: prior.sha256,
    sequence: prior.sequence,
    immutable: prior.immutable !== false,
    correction: prior.correction ?? null,
  };
  return next;
}

export function applyCorrection(packet, correction = {}) {
  const next = { ...(packet || {}) };
  const current = next.prior && typeof next.prior === "object" ? { ...next.prior } : { ref: null, sequence: 0, immutable: true };
  const sequence = Number.isInteger(current.sequence) ? current.sequence + 1 : 1;
  next.prior = {
    ...current,
    immutable: true,
    correction: {
      sequence,
      reason: correction.reason || "operator_correction",
      replacesRef: current.ref ?? null,
      replacesSha256: current.sha256 ?? null,
    },
  };
  return next;
}

export function assertImmutable(path, nextBytes) {
  if (!path || !existsSync(path)) return { ok: true };
  const existing = readFileSync(path);
  const nextBuf = Buffer.isBuffer(nextBytes) ? nextBytes : Buffer.from(nextBytes);
  if (Buffer.compare(existing, nextBuf) === 0) return { ok: true };
  return {
    ok: false,
    code: "prior_immutable",
    message: "refusing to overwrite an immutable prior artifact; write a new sequenced artifact instead",
  };
}

export function writeSequencedArtifact(dir, stem, sequence, body) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${stem}.seq-${sequence}.json`);
  if (existsSync(path)) {
    return {
      ok: false,
      code: "artifact_exists",
      message: "sequenced artifact already exists; priors stay immutable",
      path,
    };
  }
  const text = `${stableStringify(body)}\n`;
  const blocked = assertImmutable(path, text);
  if (!blocked.ok) return { ...blocked, path };
  writeFileSync(path, text);
  return { ok: true, path, sha256: sha256Hex(text.trimEnd()), bytes: Buffer.byteLength(text) };
}

export function priorDirOf(filePath) {
  return dirname(filePath);
}

export function buildPriorDocument({ createdAt, sequence = 1, payload, correction = null }) {
  return {
    schema: PRIOR_SCHEMA,
    createdAt,
    sequence,
    immutable: true,
    sha256: sha256Hex(payload),
    payload,
    correction,
  };
}
