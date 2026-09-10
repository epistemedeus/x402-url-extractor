/**
 * Immutable prior + correction for S127 upgrade-impact packets.
 *
 * Reuses S122 / SameDayDesk patterns: payload sha256 via sorted JSON,
 * sequenced artifacts, refuse overwrite of existing prior bytes.
 *
 * A new version is not itself a break. Unused export change is not a
 * caller defect. Those rules belong to binders; this module only snapshots.
 * Missing/conflicting/partial source stays unknown and does not replace
 * the prior. Clock is never invented.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const PRIOR_SCHEMA = "s127.upgrade-impact.prior.v1";
export const CORRECTION_SCHEMA = "s127.upgrade-impact.correction.v1";
export const PACKET_SCHEMA = "s127.upgrade-impact.packet.v1";
export const RECIPE_ID = "s127-upgrade-impact";

export const CORRECTION_KINDS = Object.freeze(["return", "update", "unknown"]);

/** Decision-relevant packet fields hashed into a prior payload. Envelope (clock, prior, limitations) is excluded. */
export const PRIOR_PAYLOAD_KEYS = Object.freeze([
  "caller",
  "dependency",
  "provenance",
  "usage",
  "exportDiff",
  "bindings",
  "summary",
]);

const SOURCE_UNKNOWN_REASONS = new Set([
  "partial_source",
  "missing_source",
  "conflicting_source",
  "lockfile_disagreement",
  "missing_content_sha256",
  "alias_unresolved",
  "workspace_disagreement",
]);

export function sha256Hex(value) {
  const input = typeof value === "string" || Buffer.isBuffer(value) ? value : stableStringify(value);
  return createHash("sha256").update(input).digest("hex");
}

export function stableStringify(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
    return out;
  }
  return value;
}

export function documentBytes(value) {
  return Buffer.from(`${stableStringify(value)}\n`);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
  } else {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return Object.freeze(value);
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function fail(code, message, extra = {}) {
  return { ok: false, code, message, ...extra };
}

export function unwrapPrior(value) {
  if (isPlainObject(value) && value.ok === true && isPlainObject(value.prior)) return value.prior;
  return value;
}

function unwrapEvidence(value) {
  if (!isPlainObject(value)) return value;
  if (value.ok === true && isPlainObject(value.prior)) return value.prior;
  if (value.ok === true && isPlainObject(value.packet)) return value.packet;
  return value;
}

function canonicalizeProvenance(prov) {
  if (prov == null) return undefined;
  const list = Array.isArray(prov) ? prov : [prov];
  return list.map((entry) => {
    if (!isPlainObject(entry)) return entry;
    return {
      locator: entry.url || entry.path || entry.locator || null,
      url: entry.url ?? null,
      path: entry.path ?? null,
      contentSha256: entry.contentSha256 ?? null,
      coverage: entry.coverage ?? null,
      label: entry.label ?? null,
    };
  });
}

export function canonicalPayload(input) {
  if (!isPlainObject(input)) return null;
  const src =
    isPlainObject(input.payload) && !isPlainObject(input.dependency) && !isPlainObject(input.caller)
      ? input.payload
      : input;
  const out = {};
  for (const key of PRIOR_PAYLOAD_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(src, key) || src[key] === undefined) continue;
    if (key === "provenance") {
      const proven = canonicalizeProvenance(src.provenance);
      if (proven !== undefined) out.provenance = proven;
      continue;
    }
    out[key] = src[key];
  }
  try {
    return JSON.parse(stableStringify(out));
  } catch {
    return null;
  }
}

function labelFrom(input) {
  if (!isPlainObject(input)) return null;
  const labels = [];
  if (typeof input.label === "string") labels.push(input.label);
  const prov = Array.isArray(input.provenance)
    ? input.provenance
    : Array.isArray(input.payload?.provenance)
      ? input.payload.provenance
      : [];
  for (const row of prov) {
    if (typeof row?.label === "string") labels.push(row.label);
  }
  const unique = [...new Set(labels)];
  // Provenance label is independent of caller.evidenceClass.
  // Prefer live-capture when mixed so a fixture run cannot hide live bytes.
  if (unique.includes("live-capture")) return "live-capture";
  if (unique.includes("synthetic")) return "synthetic";
  if (unique.includes("fixture")) return "fixture";
  if (unique.includes("owner-qa")) return "owner-qa";
  return unique[0] ?? null;
}

function evidenceClassFrom(input) {
  if (!isPlainObject(input)) return "unlabeled";
  return (
    input.caller?.evidenceClass ||
    input.evidenceClass ||
    labelFrom(input) ||
    "unlabeled"
  );
}

function conflictingProvenance(list) {
  const byLoc = new Map();
  const conflicts = [];
  for (const row of list || []) {
    if (!isPlainObject(row)) continue;
    const loc = row.url || row.path || row.locator;
    if (!loc || !row.contentSha256) continue;
    if (byLoc.has(loc) && byLoc.get(loc) !== row.contentSha256) conflicts.push(loc);
    else byLoc.set(loc, row.contentSha256);
  }
  return [...new Set(conflicts)];
}

function coverageReasons(payload) {
  const reasons = [];
  if (!payload) {
    reasons.push("missing_payload");
    return reasons;
  }
  if (!isPlainObject(payload.dependency)) reasons.push("missing_dependency");
  else if (!payload.dependency.name) reasons.push("missing_dependency_name");
  if (!isPlainObject(payload.caller)) reasons.push("missing_caller");

  if (payload.provenance !== undefined) {
    const list = Array.isArray(payload.provenance) ? payload.provenance : [];
    if (list.length === 0) reasons.push("empty_provenance");
    list.forEach((row, i) => {
      if (!isPlainObject(row)) {
        reasons.push(`provenance[${i}].invalid`);
        return;
      }
      if (row.coverage === "partial" || row.coverage === "unknown") {
        reasons.push(`provenance[${i}].coverage=${row.coverage}`);
      }
      if (!row.contentSha256) reasons.push(`provenance[${i}].missing_contentSha256`);
      if (!row.label) reasons.push(`provenance[${i}].unlabeled`);
      if (!row.url && !row.path && !row.locator) reasons.push(`provenance[${i}].missing_locator`);
    });
    for (const loc of conflictingProvenance(list)) reasons.push(`provenance_conflict:${loc}`);
  }

  const exportCov = payload.exportDiff?.coverage;
  if (exportCov === "partial" || exportCov === "unknown") {
    reasons.push(`exportDiff.coverage=${exportCov}`);
  }

  for (const reason of payload.summary?.unknownReasons || []) {
    const text = String(reason);
    if (
      SOURCE_UNKNOWN_REASONS.has(text) ||
      /partial|conflict|missing|unresolved|disagreement/i.test(text)
    ) {
      reasons.push(`summary.unknownReasons:${text}`);
    }
  }
  return reasons;
}

function changedKeys(before, after) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const changed = [];
  for (const key of [...keys].sort()) {
    if (stableStringify(before?.[key] ?? null) !== stableStringify(after?.[key] ?? null)) {
      changed.push(key);
    }
  }
  return changed;
}

function asBytes(value) {
  if (value == null) return null;
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === "string") return Buffer.from(value);
  if (typeof value === "object") return documentBytes(value);
  return Buffer.from(String(value));
}

export function verifyPriorHash(priorLike) {
  const prior = unwrapPrior(priorLike);
  if (!isPlainObject(prior)) return fail("invalid_prior_shape", "prior artifact must be an object");
  if (!isPlainObject(prior.payload)) return fail("invalid_prior_payload", "prior.payload object is required");
  let digest;
  try {
    digest = sha256Hex(prior.payload);
  } catch (error) {
    return fail("unhashable_payload", error instanceof Error ? error.message : String(error));
  }
  if (typeof prior.sha256 === "string" && prior.sha256 !== digest) {
    return fail("prior_digest_mismatch", "prior.sha256 does not match payload digest", {
      expected: digest,
      actual: prior.sha256,
    });
  }
  return { ok: true, sha256: digest };
}

export function priorRef(priorLike) {
  const prior = unwrapPrior(priorLike);
  if (!isPlainObject(prior)) return null;
  return {
    schema: prior.schema || PRIOR_SCHEMA,
    sha256: prior.sha256,
    sequence: Number.isInteger(prior.sequence) ? prior.sequence : 1,
    createdAt: prior.createdAt ?? null,
    immutable: true,
  };
}

export function summarizePrior(priorLike) {
  const prior = unwrapPrior(priorLike);
  if (!isPlainObject(prior)) return null;
  return {
    schema: prior.schema || PRIOR_SCHEMA,
    sha256: prior.sha256,
    sequence: Number.isInteger(prior.sequence) ? prior.sequence : 1,
    createdAt: prior.createdAt ?? null,
    clock: prior.clock ?? null,
    immutable: prior.immutable !== false,
    recipeId: prior.recipeId ?? RECIPE_ID,
    parentSha256: prior.parentSha256 ?? null,
  };
}

/**
 * Snapshot a packet into an immutable prior. Same canonical packet ⇒ same payload sha256.
 * Does not mutate `packet`. Does not invent clock.
 */
export function createPrior(packet, options = {}) {
  if (!isPlainObject(packet)) {
    return fail("invalid_packet", "packet must be a plain object");
  }
  const clock = options.clock || packet.clock || null;
  if (!clock) {
    return fail("missing_clock", "operator clock is required; the pack does not invent it");
  }
  const payload = canonicalPayload(packet);
  if (!payload) return fail("invalid_packet_payload", "packet could not be canonicalized");

  let sha256;
  try {
    sha256 = sha256Hex(payload);
  } catch (error) {
    return fail("unhashable_payload", error instanceof Error ? error.message : String(error));
  }

  const sequence = Number.isInteger(options.sequence)
    ? options.sequence
    : Number.isInteger(packet.sequence)
      ? packet.sequence
      : 1;

  const prior = {
    schema: PRIOR_SCHEMA,
    recipeId: options.recipeId || RECIPE_ID,
    createdAt: options.createdAt || packet.createdAt || clock,
    clock,
    sequence,
    immutable: true,
    sha256,
    payload,
    payment: { attempted: false },
    evidenceClass: evidenceClassFrom(packet),
    label: labelFrom(packet) || "unlabeled",
    caller: payload.caller ?? null,
    dependency: payload.dependency ?? null,
  };
  if (options.parentSha256) prior.parentSha256 = options.parentSha256;

  const frozen = deepFreeze(cloneJson(prior));
  return {
    ok: true,
    prior: frozen,
    sha256,
    bytes: documentBytes(frozen),
  };
}

/**
 * Refuse to overwrite an immutable prior.
 * - string target: filesystem path (S122 semantics). Missing path is ok.
 *   Identical nextBytes is ok; different bytes ⇒ prior_immutable.
 * - object target: verify payload digest; optional nextBytes compared to canonical document bytes.
 */
export function assertImmutable(target, nextBytes) {
  if (target == null || target === "") {
    return fail("missing_target", "assertImmutable requires a path or prior object");
  }

  if (typeof target === "string") {
    if (!existsSync(target)) return { ok: true };
    const existing = readFileSync(target);
    if (nextBytes == null) return { ok: true, path: target, bytes: existing.length };
    const next = asBytes(nextBytes);
    if (Buffer.compare(existing, next) === 0) return { ok: true, path: target };
    return fail(
      "prior_immutable",
      "refusing to overwrite an immutable prior artifact; write a new sequenced artifact instead",
      { path: target },
    );
  }

  if (isPlainObject(target)) {
    const prior = unwrapPrior(target);
    if (prior.immutable === false) {
      return fail("prior_not_immutable", "prior.immutable is false; refusing to treat it as a prior");
    }
    const verified = verifyPriorHash(prior);
    if (!verified.ok) return verified;
    if (nextBytes != null) {
      const existing = documentBytes(prior);
      if (Buffer.compare(existing, asBytes(nextBytes)) === 0) return { ok: true, sha256: verified.sha256 };
      return fail(
        "prior_immutable",
        "refusing to overwrite an immutable prior artifact; write a new sequenced artifact instead",
      );
    }
    return { ok: true, sha256: verified.sha256 };
  }

  return fail("invalid_target", "assertImmutable target must be a path string or prior object");
}

export function loadPrior(path) {
  if (!path) return fail("missing_prior", "immutable prior artifact is required");
  if (!existsSync(path)) return fail("missing_prior", "immutable prior artifact is required", { path });
  let raw;
  try {
    raw = readFileSync(path);
  } catch {
    return fail("unreadable_prior", "cannot read prior artifact", { path });
  }
  let doc;
  try {
    doc = JSON.parse(raw.toString("utf8"));
  } catch {
    return fail("invalid_prior_json", "prior artifact is not JSON", { path });
  }
  if (!isPlainObject(doc)) return fail("invalid_prior_shape", "prior artifact must be an object", { path });
  if (!isPlainObject(doc.payload)) return fail("invalid_prior_payload", "prior.payload object is required", { path });
  const sha256 = typeof doc.sha256 === "string" ? doc.sha256 : sha256Hex(doc.payload);
  const prior = {
    schema: doc.schema || PRIOR_SCHEMA,
    recipeId: doc.recipeId ?? RECIPE_ID,
    createdAt: doc.createdAt ?? null,
    clock: doc.clock ?? null,
    sequence: Number.isInteger(doc.sequence) ? doc.sequence : 1,
    immutable: doc.immutable !== false,
    sha256,
    payload: doc.payload,
    payment: isPlainObject(doc.payment) ? doc.payment : { attempted: false },
    evidenceClass: doc.evidenceClass ?? "unlabeled",
    label: doc.label ?? null,
    caller: isPlainObject(doc.caller) ? doc.caller : doc.payload.caller ?? null,
    dependency: isPlainObject(doc.dependency) ? doc.dependency : doc.payload.dependency ?? null,
  };
  if (doc.parentSha256) prior.parentSha256 = doc.parentSha256;
  const verified = verifyPriorHash(prior);
  if (!verified.ok) return { ...verified, path };
  return {
    ok: true,
    path,
    prior: deepFreeze(cloneJson(prior)),
    bytes: raw,
  };
}

export function writeSequencedPrior(dir, priorLike, { id = RECIPE_ID } = {}) {
  if (!dir) return fail("missing_dir", "sequenced prior directory is required");
  const prior = unwrapPrior(priorLike);
  if (!isPlainObject(prior)) return fail("invalid_prior_shape", "prior artifact must be an object");
  const verified = verifyPriorHash(prior);
  if (!verified.ok) return verified;
  const sequence = Number.isInteger(prior.sequence) ? prior.sequence : 1;
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${id}.seq-${sequence}.json`);
  if (existsSync(path)) {
    return fail("artifact_exists", "sequenced artifact already exists; priors stay immutable", { path });
  }
  const text = `${stableStringify(prior)}\n`;
  const blocked = assertImmutable(path, text);
  if (!blocked.ok) return { ...blocked, path };
  writeFileSync(path, text);
  return { ok: true, path, sha256: prior.sha256, bytes: Buffer.byteLength(text) };
}

export function priorDirOf(filePath) {
  return dirname(filePath);
}

function classifyCorrection(oldPayload, newPayload) {
  const oldSha = sha256Hex(oldPayload);
  const newSha = sha256Hex(newPayload);
  if (oldSha === newSha) return { kind: "return", reasons: [] };
  const reasons = coverageReasons(newPayload);
  if (reasons.length) return { kind: "unknown", reasons };
  return { kind: "update", reasons: [] };
}

function notesFor(kind) {
  if (kind === "return") {
    return "second snapshot matches immutable prior payload; keep prior; do not overwrite bytes";
  }
  if (kind === "unknown") {
    return "new evidence is missing, conflicting, or partial; keep prior; do not claim action";
  }
  return "new evidence differs; write a sequenced next prior; do not overwrite old prior bytes";
}

/**
 * Build a correction record from an immutable prior and new evidence.
 * Never mutates `oldPrior` or its nested objects. Same inputs ⇒ stable correction.sha256
 * (clock lives on the envelope, not the hashed correction payload).
 */
export function correctPrior(oldPriorLike, newEvidenceLike, options = {}) {
  const oldPrior = unwrapPrior(oldPriorLike);
  if (!isPlainObject(oldPrior)) return fail("invalid_prior_shape", "oldPrior must be an object");
  const oldBytes = documentBytes(oldPrior);
  const oldBytesHex = sha256Hex(oldBytes);

  const verified = verifyPriorHash(oldPrior);
  if (!verified.ok) return verified;
  const frozenCheck = assertImmutable(oldPrior);
  if (!frozenCheck.ok) return frozenCheck;

  const evidence = unwrapEvidence(newEvidenceLike);
  if (!isPlainObject(evidence)) return fail("invalid_evidence", "newEvidence must be a plain object");

  const clock = options.clock || evidence.clock || evidence.createdAt || null;
  if (!clock) {
    return fail("missing_clock", "operator clock is required; the pack does not invent it");
  }

  const oldPayload = canonicalPayload(oldPrior.payload) || cloneJson(oldPrior.payload);
  const newPayload = canonicalPayload(evidence);
  if (!newPayload) return fail("invalid_evidence_payload", "newEvidence could not be canonicalized");

  const { kind, reasons } = classifyCorrection(oldPayload, newPayload);
  const evidenceSha256 = sha256Hex(newPayload);
  const keys = changedKeys(oldPayload, newPayload);
  const evidenceClass = evidenceClassFrom(evidence);
  const label = labelFrom(evidence) || "unlabeled";

  let nextPrior = null;
  if (kind === "update") {
    const created = createPrior(evidence, {
      clock,
      createdAt: options.createdAt || evidence.createdAt || clock,
      sequence: (Number.isInteger(oldPrior.sequence) ? oldPrior.sequence : 1) + 1,
      parentSha256: oldPrior.sha256,
      recipeId: oldPrior.recipeId || RECIPE_ID,
    });
    if (!created.ok) return created;
    nextPrior = created.prior;
  }

  const correctionPayload = {
    kind,
    priorSha256: oldPrior.sha256,
    evidenceSha256,
    evidenceClass,
    label,
    coverageReasons: reasons,
    changedKeys: keys,
    notes: notesFor(kind),
  };

  const correction = deepFreeze(
    cloneJson({
      schema: CORRECTION_SCHEMA,
      createdAt: options.createdAt || evidence.createdAt || clock,
      clock,
      kind,
      immutable: true,
      sha256: sha256Hex(correctionPayload),
      payload: correctionPayload,
      priorRef: priorRef(oldPrior),
      nextPriorRef: nextPrior ? priorRef(nextPrior) : null,
      payment: { attempted: false },
    }),
  );

  const afterBytes = documentBytes(oldPrior);
  if (Buffer.compare(oldBytes, afterBytes) !== 0) {
    return fail("prior_mutated", "correctPrior mutated old prior bytes; this is a defect");
  }

  return {
    ok: true,
    kind,
    correction,
    nextPrior,
    oldPriorRef: priorRef(oldPrior),
    oldPriorUnchanged: true,
    oldPriorSha256: oldPrior.sha256,
    oldPriorBytesSha256: oldBytesHex,
    payment: { attempted: false },
  };
}

function isStageCtx(value) {
  return (
    isPlainObject(value) &&
    isPlainObject(value.packet) &&
    (isPlainObject(value.input) || typeof value.command === "string" || value.priorDoc !== undefined)
  );
}

function resolveOldPrior(priorDoc, priorPath) {
  if (typeof priorPath === "string" && priorPath) {
    const loaded = loadPrior(priorPath);
    if (loaded.ok) return loaded;
    if (loaded.code !== "invalid_prior_payload") return loaded;
  }
  const doc = priorDoc?.document || priorDoc?.prior || priorDoc;
  if (!isPlainObject(doc)) return fail("missing_prior", "no immutable prior supplied");
  if (isPlainObject(doc.payload) && (doc.schema === PRIOR_SCHEMA || doc.immutable || doc.sha256)) {
    const verified = verifyPriorHash(doc);
    if (!verified.ok) return verified;
    return { ok: true, prior: doc, path: priorDoc?.path || priorPath || null };
  }
  if (doc.schema === PACKET_SCHEMA || isPlainObject(doc.dependency) || isPlainObject(doc.caller)) {
    const created = createPrior(doc, { clock: doc.clock, createdAt: doc.createdAt });
    if (!created.ok) return created;
    return { ok: true, prior: created.prior, path: priorDoc?.path || priorPath || null, derivedFromPacket: true };
  }
  return fail("invalid_prior_shape", "prior artifact must be an object with payload or packet fields");
}

function priorField(refPrior, { path = null, correction = null, nextPrior = null } = {}) {
  const ref = priorRef(refPrior);
  return {
    path,
    sha256: ref?.sha256 ?? null,
    sequence: ref?.sequence ?? 0,
    immutable: true,
    ref,
    correction,
    nextPrior,
  };
}

/**
 * CLI/pipeline overlay. Never mutates ctx.packet. Does not invent clock.
 * `correct` / `replay` / first `analyze` all go through the same snapshot+compare rules.
 */
export function overlayFromCtx(ctx) {
  if (!isStageCtx(ctx)) return fail("invalid_ctx", "stage ctx with packet is required");
  const packet = ctx.packet;
  const input = ctx.input || {};
  const command = ctx.command || input.command || "analyze";
  const clock = input.clock || packet.clock || packet.createdAt || null;
  const priorPath = input.priorPath || packet.prior?.path || null;
  const old = resolveOldPrior(ctx.priorDoc, priorPath);

  if (command === "correct" || command === "replay") {
    if (!old.ok) {
      return {
        limitations: [`prior: ${old.message}`],
        unknownReasons: [old.code || "missing_prior"],
        prior: {
          path: priorPath,
          sha256: null,
          sequence: 0,
          immutable: true,
          ref: null,
          correction: { kind: "unknown", error: { code: old.code, message: old.message } },
          nextPrior: null,
        },
      };
    }
    const compared = correctPrior(old.prior, packet, { clock });
    if (!compared.ok) {
      return {
        limitations: [`prior: ${compared.message}`],
        unknownReasons: [compared.code],
        prior: priorField(old.prior, {
          path: old.path || priorPath,
          correction: { kind: "unknown", error: { code: compared.code, message: compared.message } },
        }),
      };
    }
    return {
      prior: priorField(old.prior, {
        path: old.path || priorPath,
        correction: compared.correction,
        nextPrior: compared.nextPrior,
      }),
    };
  }

  if (old.ok) {
    const compared = correctPrior(old.prior, packet, { clock });
    return {
      prior: priorField(old.prior, {
        path: old.path || priorPath,
        correction: compared.ok
          ? compared.correction
          : { kind: "unknown", error: { code: compared.code, message: compared.message } },
        nextPrior: compared.ok ? compared.nextPrior : null,
      }),
    };
  }

  if (priorPath) {
    return {
      limitations: [`prior: ${old.message}`],
      unknownReasons: [old.code || "missing_prior"],
      prior: {
        path: priorPath,
        sha256: null,
        sequence: 0,
        immutable: true,
        ref: null,
        correction: { kind: "unknown", error: { code: old.code, message: old.message } },
        nextPrior: null,
      },
    };
  }

  const created = createPrior(packet, { clock });
  if (!created.ok) {
    return {
      limitations: [`prior: ${created.message}`],
      unknownReasons: [created.code],
    };
  }
  return {
    prior: priorField(created.prior, { path: null, correction: null, nextPrior: null }),
  };
}

export function run(ctx) {
  return overlayFromCtx(ctx);
}

export function replay(ctx) {
  return overlayFromCtx({ ...ctx, command: "replay" });
}

export function correct(ctx) {
  return overlayFromCtx({ ...ctx, command: "correct" });
}

/**
 * Dual entry:
 * - CLI/pipeline: attachPrior(ctx) or attachPrior(packet, priorDoc, ctx) → packet overlay
 * - Helper: attachPrior(packet, prior, correction) → { ok, packet } without mutating input
 */
export function attachPrior(packetOrCtx, priorLike, correction = null) {
  if (isStageCtx(packetOrCtx)) return overlayFromCtx(packetOrCtx);
  if (isStageCtx(correction)) {
    return overlayFromCtx({
      ...correction,
      packet: packetOrCtx,
      priorDoc: priorLike ?? correction.priorDoc,
    });
  }
  if (!isPlainObject(packetOrCtx)) return fail("invalid_packet", "packet must be a plain object");
  const prior = unwrapPrior(priorLike);
  if (!isPlainObject(prior)) return fail("invalid_prior_shape", "prior must be an object");
  const clone = cloneJson(packetOrCtx);
  clone.prior = {
    ref: priorRef(prior),
    correction: correction ? cloneJson(correction) : null,
  };
  return { ok: true, packet: clone };
}
