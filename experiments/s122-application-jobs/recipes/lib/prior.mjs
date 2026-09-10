import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sha256Hex, stableStringify } from "./hash.mjs";
import { tryReadJsonFile } from "./io.mjs";

export const PRIOR_SCHEMA = "samedaydesk.recurring-job-prior.v1";

export function loadPrior(path) {
  const loaded = tryReadJsonFile(path);
  if (!loaded.ok) {
    return {
      ok: false,
      code: loaded.code === "missing_path" ? "missing_prior" : loaded.code,
      message: loaded.code === "missing_path" ? "immutable prior artifact is required" : loaded.message,
    };
  }
  const doc = loaded.body;
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return { ok: false, code: "invalid_prior_shape", message: "prior artifact must be an object" };
  }
  const payload = doc.payload ?? null;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, code: "invalid_prior_payload", message: "prior.payload object is required" };
  }
  const sha256 = typeof doc.sha256 === "string" ? doc.sha256 : sha256Hex(payload);
  return {
    ok: true,
    path,
    prior: {
      schema: doc.schema || PRIOR_SCHEMA,
      recipeId: doc.recipeId ?? null,
      createdAt: doc.createdAt ?? null,
      sequence: Number.isInteger(doc.sequence) ? doc.sequence : 1,
      sha256,
      payload,
      payment: doc.payment && typeof doc.payment === "object" ? doc.payment : { attempted: false },
      immutable: doc.immutable !== false,
    },
    bytes: loaded.bytes,
  };
}

export function assertImmutable(priorPath, nextBytes) {
  if (!priorPath || !existsSync(priorPath)) return { ok: true };
  const existing = readFileSync(priorPath);
  if (Buffer.compare(existing, Buffer.from(nextBytes)) === 0) return { ok: true };
  return {
    ok: false,
    code: "prior_immutable",
    message: "refusing to overwrite an immutable prior artifact; write a new sequenced artifact instead",
  };
}

export function writeSequencedArtifact(dir, recipeId, sequence, body) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${recipeId}.seq-${sequence}.json`);
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

export function summarizePrior(priorLoad) {
  return {
    path: priorLoad.path,
    sha256: priorLoad.prior.sha256,
    sequence: priorLoad.prior.sequence,
    createdAt: priorLoad.prior.createdAt,
    immutable: priorLoad.prior.immutable,
    recipeId: priorLoad.prior.recipeId,
  };
}
