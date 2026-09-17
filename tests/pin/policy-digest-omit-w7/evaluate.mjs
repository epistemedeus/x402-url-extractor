import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SCHEMAS, evaluateResponseContract } from "agent-payment-policy";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PIN_DIR = HERE;
export const REPO_ROOT = join(HERE, "..", "..", "..");
export const PINS_PATH = join(HERE, "pins.json");
export const SEEDED_OMIT_PATH = join(HERE, "fixtures", "reject", "omit-buyer-schemaDigest.json");

export const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
export const FORBIDDEN_FLAGS = Object.freeze([
  "--live",
  "--pay",
  "--payment",
  "--publish",
  "--neo",
  "--checkout",
]);

export function loadPins(path = PINS_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function fail(code, extra = {}) {
  return Object.freeze({
    ok: false,
    code,
    paid: false,
    paymentSent: false,
    schemaDigest: null,
    ...extra,
  });
}

function pass(code, extra = {}) {
  return Object.freeze({
    ok: true,
    code,
    paid: false,
    paymentSent: false,
    ...extra,
  });
}

export function forbiddenFlag(argv = []) {
  return argv.find((arg) => {
    const raw = String(arg || "");
    const flag = raw.split("=")[0];
    if (FORBIDDEN_FLAGS.includes(flag)) return true;
    if (/neomorphic/i.test(raw)) return true;
    return false;
  }) || null;
}

/**
 * Wave-7 pin: buyer.schemaDigest must be present as sha256:<64 hex>.
 * Omitting the field, or supplying null/empty, fails closed.
 * output.schemaDigest is not a substitute.
 */
export function evaluateBuyerPin(fixture, pins = loadPins()) {
  if (!isPlainObject(fixture)) {
    return fail("buyer_pin_malformed", { error: "fixture must be a JSON object" });
  }
  const buyer = fixture.buyer;
  if (!isPlainObject(buyer)) {
    return fail("buyer_object_missing", {
      error: "buyer object is required",
      label: fixture.id ?? null,
    });
  }
  if (!Object.prototype.hasOwnProperty.call(buyer, "schemaDigest")) {
    return fail(pins.omitCode || "buyer_schema_digest_omitted", {
      error: "buyer.schemaDigest is omitted",
      label: fixture.id ?? null,
      path: "buyer.schemaDigest",
    });
  }
  const digest = buyer.schemaDigest;
  if (digest == null || digest === "") {
    return fail(pins.omitCode || "buyer_schema_digest_omitted", {
      error: "buyer.schemaDigest is omitted",
      label: fixture.id ?? null,
      path: "buyer.schemaDigest",
      actual: digest === undefined ? null : digest,
    });
  }
  if (typeof digest !== "string" || !DIGEST_RE.test(digest)) {
    return fail("buyer_schema_digest_invalid", {
      error: "buyer.schemaDigest must match sha256:<64 lowercase hex>",
      label: fixture.id ?? null,
      path: "buyer.schemaDigest",
      actual: digest,
    });
  }
  return pass("buyer_schema_digest_pinned", {
    label: fixture.id ?? null,
    schemaDigest: digest,
    path: "buyer.schemaDigest",
  });
}

export function inspectPinnedBuyerSchema(pins = loadPins(), repoRoot = REPO_ROOT) {
  const spec = pins.buyerSchema;
  const schema = readJson(join(repoRoot, spec.path));
  const report = evaluateResponseContract({
    schemaVersion: SCHEMAS.responseContractObservation,
    source: "buyer_owned_schema",
    request: spec.request,
    response: {
      status: 200,
      mediaType: "application/json",
      schema,
      example: spec.example,
    },
  }, { now: Date.parse("2026-01-01T00:00:00.000Z") });
  return Object.freeze({
    decision: report.decision,
    schemaDigest: report.schemaDigest ?? null,
    requiredFields: report.requiredFields ?? [],
    requiredPaths: report.requiredPaths ?? [],
    exampleStatus: report.exampleStatus ?? null,
    schemaPath: spec.path,
    expectedDigest: spec.schemaDigest,
  });
}

export function evaluateRepoPins(pins = loadPins(), repoRoot = REPO_ROOT) {
  const pkg = readJson(join(repoRoot, "package.json"));
  const declared = pkg?.dependencies?.["agent-payment-policy"];
  if (declared !== pins.agentPaymentPolicy) {
    return fail("agent-payment-policy-drift", {
      expected: pins.agentPaymentPolicy,
      actual: declared ?? null,
      surface: "package.json.dependencies.agent-payment-policy",
    });
  }
  const inspected = inspectPinnedBuyerSchema(pins, repoRoot);
  if (inspected.decision !== "admissible") {
    return fail("buyer_schema_not_admissible", {
      decision: inspected.decision,
      schemaPath: inspected.schemaPath,
      schemaDigest: inspected.schemaDigest,
    });
  }
  if (inspected.schemaDigest !== pins.buyerSchema.schemaDigest) {
    return fail("buyer_schema_digest_drift", {
      expected: pins.buyerSchema.schemaDigest,
      actual: inspected.schemaDigest,
      schemaPath: inspected.schemaPath,
    });
  }
  const bound = evaluateBuyerPin({
    id: pins.buyerSchema.id,
    buyer: {
      schemaDigest: inspected.schemaDigest,
      requiredFields: inspected.requiredFields,
    },
  }, pins);
  if (!bound.ok) return bound;
  return pass("buyer_schema_digest_pinned", {
    mode: "cold",
    wave: pins.wave,
    schemaDigest: inspected.schemaDigest,
    schemaPath: inspected.schemaPath,
    decision: inspected.decision,
    agentPaymentPolicy: declared,
    label: pins.buyerSchema.id,
  });
}

export function evaluateFixture(fixture, pins = loadPins()) {
  return evaluateBuyerPin(fixture, pins);
}
