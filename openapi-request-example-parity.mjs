/**
 * Deterministic projection of the authoritative Bazaar discovery-contract
 * request examples into the generated OpenAPI documents, plus strict
 * generated-surface gates.
 *
 * Amendments 1-2 established canonical example authority, the Circle gateway
 * alias, fail-closed boolean/missing schemas, and bounded URL privacy
 * inspection. Amendments 6-8 replace the schema authority end to end:
 *
 * - One runtime validator authority: @hyperjump/json-schema 1.17.8, imported
 *   only through its three exported subpaths (`formats` side effect plus the
 *   `openapi-3-0` and `openapi-3-1` engines). No private keyword/subschema
 *   tables, no semantic walker, no second validator, no vendored meta-schema,
 *   and no permissive fallback exist anymore.
 * - Exact dialect policy: document `3.0.x` selects the OAS 3.0 dialect and
 *   rejects every nested `$schema`; document `3.1.x` selects the OAS 3.1 base
 *   engine with the frozen three-row compatibility table for schema
 *   `$schema`. Everything else fails closed before compilation.
 * - Descriptor-first, bounded, cycle-safe materialization in front of every
 *   authority, digest, policy pass, and privacy scan. No accessor, Proxy
 *   trap, coercion hook, or user code ever executes during inspection.
 * - Same-origin retrieval policy: before registration one policy pass rejects
 *   `$id`, anchors, dynamic/recursive refs, obsolete `additionalItems`, and
 *   every `$ref` not beginning exactly `#/`. Local pointer resolution stays
 *   with Hyperjump; compilation performs no network/filesystem retrieval.
 * - Canonical identities (C, H, D_source/D_prepared/D_published, D_schema,
 *   D_auth, D_cache, D_boot) with the frozen primitive vectors, one
 *   process-local compiled-validator cache keyed by D_auth (128-entry budget,
 *   boot-local staging, transactional bind), and synthetic URN lifecycle with
 *   an always-empty parity registry.
 * - One continuously instrumented two-document startup transaction
 *     MATERIALIZING -> POLICY_SCAN -> META_VALIDATE -> COMPILING
 *       -> PROJECTION -> TERMINAL_AUDIT -> INVENTORY_GATE
 *       -> OPERATION_ID_GATE -> CACHE_BIND -> PUBLISHED
 *   with off-side clones, staged cache, one synchronous in-memory publish,
 *   and non-destructive ABORTED_ROLLBACK.
 *
 * Single source of truth: examples are taken exclusively from
 * `getDiscoveryRequestContract` through the injected resolver. This module
 * never authors or stores a second example table.
 */

import "@hyperjump/json-schema/formats";
import "@hyperjump/json-schema/openapi-3-0";
import {
  InvalidSchemaError,
  getAllRegisteredSchemaUris,
  hasSchema,
  registerSchema,
  unregisterSchema,
  validate,
} from "@hyperjump/json-schema/openapi-3-1";
import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";

const OPENAPI_OPERATION_METHODS = ["get", "post"];
const JSON_SCHEMA_2020_12 = "2020-12";

const PROTOTYPE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
// Same sensitivity classes as discovery-contract.mjs so a projected example can
// never surface a credential-like input name onto the generated surface. The
// bare key `signature` is NOT globally exempt: see
// PUBLIC_SOLANA_SIGNATURE_QUERY for the single scoped exception.
const SENSITIVE_KEY = /(?:^|[-_.])(auth|authorization|bearer|cookie|credential|jwt|otp|pass(?:word)?|secret|session|signature|token)(?:$|[-_.])/i;
const SENSITIVE_KEY_COLLAPSED = /(?:api|access|auth|authorization|bearer|client|cookie|credential|private|session)?(?:jwt|key|otp|pass|password|secret|signature|token)$/i;
const UNRESOLVED_TEMPLATE = /\{[^{}]*\}/;
const REDACTED_KEY = "[redacted-key]";

// ---------------------------------------------------------------------------
// Amendment 6-8 constants: runtime authority, dialects, modes, closed codes.
// ---------------------------------------------------------------------------

/** Runtime validator authority version (PV). Frozen constant "1.17.8". */
export const PARITY_RUNTIME_VERSION = "1.17.8";

/** Compile-context dialect for OAS 3.0 Schema Objects. */
const RUNTIME_DIALECT_OAS30 = "https://spec.openapis.org/oas/3.0/dialect";
/** Compile-context dialect for OAS 3.1 Schema Objects. */
const RUNTIME_DIALECT_OAS31 = "https://spec.openapis.org/oas/3.1/dialect/base";

/**
 * Exact dialect identity strings. Only these three may become
 * `exactDialect` inside a digest.
 */
export const DIALECT_IDENTITIES = Object.freeze({
  OAS30: "https://spec.openapis.org/oas/3.0/schema",
  OAS31_BASE: "https://spec.openapis.org/oas/3.1/dialect/base",
  DRAFT_2020_12: "https://json-schema.org/draft/2020-12/schema",
});

/** Exact boot-mode vocabulary M (amendment 6 section 6). */
export const BOOT_MODES = Object.freeze(["circle_enabled", "circle_disabled"]);

const OPENAPI_30_VERSION = /^3\.0\.[0-9]+$/;
const OPENAPI_31_VERSION = /^3\.1\.[0-9]+$/;

/**
 * The closed failure-code enum (amendment 6 section 12). Only these codes
 * cross the parity/startup boundary.
 */
export const FAILURE_CODES = Object.freeze([
  "UNSUPPORTED_OAS_VERSION", "DIALECT_REJECTED", "NESTED_DIALECT_REJECTED",
  "POLICY_KEYWORD_REJECTED", "MISSING_SCHEMA", "INVALID_SCHEMA_TYPE",
  "META_VALIDATION_FAILED", "INSTANCE_VALIDATION_FAILED", "SCHEMA_COMPILE_FAILED",
  "DEPENDENCY_AUTHORITY_DRIFT", "VERSION_AUTHORITY_DRIFT", "ZERO_IO_TRIPWIRE",
  "TRIPWIRE_NOT_SENSITIVE", "REGISTRY_IDENTITY_COLLISION", "REGISTRY_NOT_EMPTY",
  "CACHE_IDENTITY_MISMATCH", "CACHE_BUDGET_EXCEEDED", "CACHE_TRANSACTION_ABORTED",
  "PROXY_REJECTED", "ACCESSOR_REJECTED", "NON_ENUMERABLE_PROPERTY",
  "TOJSON_REJECTED", "COERCION_HOOK_REJECTED", "CYCLE_REJECTED",
  "ALIAS_REJECTED", "PROTOTYPE_KEY_REJECTED", "SYMBOL_KEY_REJECTED",
  "SPARSE_ARRAY_REJECTED", "NON_CANONICAL_ARRAY_PROPERTY",
  "UNSUPPORTED_PROTOTYPE", "UNSUPPORTED_VALUE", "INVALID_UNICODE",
  "MUTATION_DURING_MATERIALIZATION", "DEPTH_EXCEEDED", "NODE_BUDGET_EXCEEDED",
  "KEY_BUDGET_EXCEEDED", "STRING_BUDGET_EXCEEDED", "DOCUMENT_BUDGET_EXCEEDED",
  "CANONICALIZATION_FAILED", "DIGEST_MISMATCH", "FINDING_CAP_REACHED",
  "CREDENTIAL_LIKE_VALUE", "CREDENTIAL_LIKE_KEY", "MALFORMED_PERCENT",
  "PERCENT_DECODE_LIMIT", "USERINFO_CREDENTIALS", "FRAGMENT_CHANNEL",
  "UNRESOLVED_TEMPLATE", "INVENTORY_DRIFT", "OPERATION_ID_DRIFT",
  "TEST_MANIFEST_DRIFT", "ORIGINAL_MUTATED", "STARTUP_ABORTED",
]);
const FAILURE_CODE_SET = new Set(FAILURE_CODES);

/** Controlled parity failure carrying one closed-enum public code. */
export class ParityError extends Error {
  constructor(code, detail) {
    if (!FAILURE_CODE_SET.has(code)) throw new Error(`UNCLASSIFIED_FAILURE_CODE:${code}`);
    super(`${code}${detail ? `: ${detail}` : ""}`);
    this.name = "ParityError";
    this.code = code;
    // The detail is bounded public text only; raw untrusted material never
    // reaches this constructor from the scanning paths below.
    this.detail = detail ?? null;
  }
}

// ---------------------------------------------------------------------------
// Canonical identities: C(x), H(tag, fields...), and digest equations.
// ---------------------------------------------------------------------------

const sha256 = (bytes) => createHash("sha256").update(bytes).digest();
const hexOf = (buf) => Buffer.from(buf).toString("hex");
const utf8 = (s) => Buffer.from(s, "utf8");

// Code-point order, not UTF-16 order: UTF-8 byte order equals code-point
// order, so compare by code point (the V_C vector distinguishes the two).
const compareCodePoints = (a, b) => {
  const ia = [...a];
  const ib = [...b];
  const n = Math.min(ia.length, ib.length);
  for (let i = 0; i < n; i += 1) {
    const ca = ia[i].codePointAt(0);
    const cb = ib[i].codePointAt(0);
    if (ca !== cb) return ca < cb ? -1 : 1;
  }
  return ia.length - ib.length;
};

/**
 * Canonical JSON bytes C(x) over an already safe-materialized tree:
 * code-point-sorted object keys, numeric array order, minimal valid JSON
 * escapes, finite ECMAScript shortest-round-trip number spelling, `-0` as 0.
 */
export function canonicalBytes(value) {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ParityError("UNSUPPORTED_VALUE", "non-finite number");
    return JSON.stringify(value); // shortest round trip; -0 -> "0"
  }
  if (typeof value === "string") return JSON.stringify(value); // minimal escapes
  if (typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalBytes).join(",")}]`;
  const keys = Object.keys(value).sort(compareCodePoints);
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalBytes(value[k])}`).join(",")}}`;
}

/**
 * H(tag, fields...) = SHA-256(UTF8(tag) || for each field (0x00 || UTF8(field))).
 * Zero fields append no separator; an empty-string field appends exactly one
 * 0x00; embedded digests are lowercase hexadecimal.
 */
export function taggedDigest(tag, ...fields) {
  const hash = createHash("sha256").update(utf8(tag));
  for (const field of fields) hash.update(Buffer.from([0])).update(utf8(field));
  return hash.digest("hex");
}

const canonicalSha256 = (tree) => hexOf(sha256(utf8(canonicalBytes(tree))));

/**
 * Frozen primitive digest vectors (amendment 6 section 6). Constants only:
 * they may never be produced by the implementation under test as oracles.
 */
export const DIGEST_VECTORS = Object.freeze({
  V_C_BYTES: "7b2261223a302c22617272223a5b31652b32312c31652d372c6e756c6c2c747275655d2c22ee8080223a225c62222c22f09f9880223a22c3a9227d",
  V_C_SHA256: "831cc0f0a3b0d71ddc523a8f32fa29ae7496130c73a65d7fde248661d7502c55",
  H_ZERO_FIELD: "45b754492b659e42ee4fb8aa2bdb41946be3f2bdf68f9e8e047f855e2d517d70",
  H_EMPTY_ALPHA_00: "b70863e46d5bb0932a19246a149d1b4be20358d4aaec78f703e3f83db752f9cc",
  D_SCHEMA_STRING: "00404e686415370f1711c4d7acfa2905444d3cf23cef2e10c47d445ebe690f96",
  D_SCHEMA_NUMBER: "33527092b4d7b347b5d568868d198441ac482767578c40660b0cda9ea16f5b3a",
  D_AUTH_OAS30: "3ba06a60fb5b33189e6b01fcc310e3a7c465dfb58820c3718174fb2d48d879d8",
  D_AUTH_OAS31: "b570d235a268343f969633a12c157534587da49bb7ccb92e197a23f40eb26b02",
  D_CACHE_EMPTY: "a083652f08b9006c87946867fd650306b09f038d175ff2be1e21d5089b895bc3",
  D_CACHE_TWO: "3133f53d3fbb28ed3ef83edca3d9ee21b4718da58e6f8cba47f7b8c603f97684",
  D_BOOT_CIRCLE_ENABLED: "4a5d392e89c5a03657662e075e78d731fad5a9f2fb82a51e61eb67c4807eccf1",
});

/** The frozen V_C vector object (a: -0, arr: [1e21, 1e-7, null, true], U+E000 -> "\b", U+1F600 -> U+00E9). */
export const V_C_VECTOR = (() => {
  const v = { a: -0, arr: [1e21, 1e-7, null, true] };
  v["\uE000"] = "\b";
  v["😀"] = "é";
  return Object.freeze(v);
})();

/** D_schema(s) = SHA-256(C(materializeSchema(s))). */
const D_schemaOf = (materializedSchema) => canonicalSha256(materializedSchema);

/** D_auth(s) = H("x402-parity/auth/v1", PV, exactDialect, hex(D_schema(s))). */
const D_authOf = (materializedSchema, exactDialect) => taggedDigest(
  "x402-parity/auth/v1", PARITY_RUNTIME_VERSION, exactDialect, D_schemaOf(materializedSchema),
);

// ---------------------------------------------------------------------------
// Safe materialization (amendment 6 section 5).
// ---------------------------------------------------------------------------

/**
 * Materialization budgets. Ceilings are inclusive: `>` fails. Root depth is
 * zero and each distinct container consumes one node before descent.
 */
export const MATERIALIZE_PROFILES = Object.freeze({
  example: Object.freeze({ maxDepth: 32, maxContainers: 4096, maxKeysPerContainer: 2048, maxStringBytes: 65536, maxTreeBytes: 524288 }),
  schema: Object.freeze({ maxDepth: 64, maxContainers: 16384, maxKeysPerContainer: 2048, maxStringBytes: 65536, maxTreeBytes: 1048576 }),
  document: Object.freeze({ maxDepth: 128, maxContainers: 65536, maxKeysPerContainer: 4096, maxStringBytes: 262144, maxTreeBytes: 4194304 }),
});

const UNPAIRED_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const CANONICAL_INDEX = /^(?:0|[1-9][0-9]*)$/;
const COERCION_KEYS = new Set(["valueOf", "toString"]);
// `Symbol.toPrimitive` own symbol key; matched by typeof symbol keys below.

function classifyPrimitive(value) {
  if (value === null) return { ok: true, value };
  if (value === undefined) throw new ParityError("UNSUPPORTED_VALUE", "undefined is not a JSON value");
  const kind = typeof value;
  if (kind === "string") {
    if (UNPAIRED_SURROGATE.test(value)) throw new ParityError("INVALID_UNICODE", "unpaired surrogate");
    return { ok: true, value };
  }
  if (kind === "number") {
    if (!Number.isFinite(value)) throw new ParityError("UNSUPPORTED_VALUE", "non-finite number");
    return { ok: true, value };
  }
  if (kind === "boolean") return { ok: true, value };
  return { ok: false };
}

function checkStringBudget(string, budget, state) {
  const bytes = Buffer.byteLength(string, "utf8");
  if (bytes > budget.maxStringBytes) throw new ParityError("STRING_BUDGET_EXCEEDED", `string ${bytes}B`);
  state.treeBytes += bytes;
  if (state.treeBytes > budget.maxTreeBytes) throw new ParityError("DOCUMENT_BUDGET_EXCEEDED", `${state.treeBytes}B`);
}

function validateAndSortOwnKeys(rawKeys, isArray) {
  const keys = [...rawKeys];
  const stringKeys = [];
  for (const key of keys) {
    if (typeof key === "symbol") throw new ParityError("SYMBOL_KEY_REJECTED", "symbol own key");
    stringKeys.push(key);
  }
  stringKeys.sort(compareCodePoints);
  return stringKeys;
}

function arrayIndexKeys(stringKeys, length) {
  const indexKeys = [];
  const extra = [];
  for (const key of stringKeys) {
    if (key === "length") continue; // validated separately as the native descriptor
    if (CANONICAL_INDEX.test(key)) {
      const index = Number(key);
      if (index < length) indexKeys.push(key);
      else extra.push(key);
    } else {
      extra.push(key);
    }
  }
  return { indexKeys, extra };
}

function assertDescriptorShape(name, descriptor, expectAccessor) {
  if (descriptor.get !== undefined || descriptor.set !== undefined) {
    if (!expectAccessor) throw new ParityError("ACCESSOR_REJECTED", `accessor ${name === null ? "key" : "index"}`);
    return;
  }
  if (!descriptor.enumerable) throw new ParityError("NON_ENUMERABLE_PROPERTY", `non-enumerable ${name ?? "value"}`);
  if (!descriptor.configurable || !descriptor.writable) {
    throw new ParityError("NON_ENUMERABLE_PROPERTY", `locked data descriptor ${name ?? "value"}`);
  }
}

/**
 * Descriptor-first bounded materializer. Steps in the exact frozen order per
 * container: primitive classification, isProxy, Array.isArray, exact
 * Object.getPrototypeOf, Reflect.ownKeys + key budget, one
 * Object.getOwnPropertyDescriptors call, descriptor validation,
 * deterministic traversal, and one post-traversal descriptor recheck. No
 * instance property get, coercion hook, accessor body, or Proxy trap may run.
 */
export function materializeSafe(value, profileName = "example", hostileHooks = null) {
  const budget = MATERIALIZE_PROFILES[profileName];
  if (!budget) throw new Error(`unknown materialization profile: ${profileName}`);
  const state = { depth: 0, containers: 0, treeBytes: 0 };
  const active = new WeakSet();
  const seen = new WeakSet();

  const consumeNode = () => {
    state.containers += 1;
    if (state.containers > budget.maxContainers) throw new ParityError("NODE_BUDGET_EXCEEDED", `${state.containers} containers`);
  };

  // Whole-document profile: the server's own freshly built document graph may
  // legitimately reference one shared subschema object from several places.
  // That reuse is invisible in the JSON data the digests describe, so a
  // non-active repeat coalesces to the same materialized value instead of
  // rejecting. The example and schema profiles (untrusted surfaces) keep the
  // strict ALIAS_REJECTED behavior; cycles reject in every profile.
  const coalesceAliases = profileName === "document";
  const memo = new Map();

  const descend = (node, depth) => {
    const primitive = classifyPrimitive(node);
    if (primitive.ok) {
      if (typeof primitive.value === "string") checkStringBudget(primitive.value, budget, state);
      return primitive.value;
    }
    // Depth budgets distinct containers; root depth is zero and each
    // container consumes one node before descent.
    if (depth > budget.maxDepth) throw new ParityError("DEPTH_EXCEEDED", `depth ${depth}`);
    // Container candidate: proxy detection before any other reflection.
    if (isProxy(node)) throw new ParityError("PROXY_REJECTED", "proxy container");
    const isArray = Array.isArray(node);
    const prototype = Object.getPrototypeOf(node);
    const allowed = isArray ? [Array.prototype] : [Object.prototype, null];
    if (!allowed.includes(prototype)) throw new ParityError("UNSUPPORTED_PROTOTYPE", "custom prototype");
    if (active.has(node)) throw new ParityError("CYCLE_REJECTED", "active cycle");
    if (seen.has(node)) {
      if (coalesceAliases && memo.has(node)) return memo.get(node);
      throw new ParityError("ALIAS_REJECTED", "repeated alias");
    }
    consumeNode();
    active.add(node);
    seen.add(node);

    const rawKeys = Reflect.ownKeys(node);
    // An own Symbol.toPrimitive key is a coercion hook before it is a symbol
    // key: reject it with the coercion code.
    if (rawKeys.includes(Symbol.toPrimitive)) throw new ParityError("COERCION_HOOK_REJECTED", "own Symbol.toPrimitive");
    const stringKeys = validateAndSortOwnKeys(rawKeys, isArray);
    if (isArray) {
      // All raw own keys other than the native `length` count before rejection.
      const applicationKeys = stringKeys.filter((k) => k !== "length");
      if (applicationKeys.length > budget.maxKeysPerContainer) {
        throw new ParityError("KEY_BUDGET_EXCEEDED", `${applicationKeys.length} array keys`);
      }
    } else if (stringKeys.length > budget.maxKeysPerContainer) {
      throw new ParityError("KEY_BUDGET_EXCEEDED", `${stringKeys.length} keys`);
    }

    // Exactly one descriptors call per container.
    const descriptors = Object.getOwnPropertyDescriptors(node);
    // Hostile-injection seam (harness only): mutate the live object after its
    // descriptor snapshot is captured so the post-traversal recheck observes
    // real drift. Production callers never pass hooks.
    if (hostileHooks?.afterDescriptorsCaptured) hostileHooks.afterDescriptorsCaptured(node);
    const recheck = () => {
      const after = Object.getOwnPropertyDescriptors(node);
      const afterKeys = validateAndSortOwnKeys(Reflect.ownKeys(node), isArray);
      const beforeKeys = stringKeys;
      if (afterKeys.length !== beforeKeys.length || afterKeys.some((k, i) => k !== beforeKeys[i])) {
        throw new ParityError("MUTATION_DURING_MATERIALIZATION", "key set drift");
      }
      for (const key of beforeKeys) {
        const d1 = descriptors[key];
        const d2 = after[key];
        if (!d2 || (d1.get !== undefined || d1.set !== undefined) !== (d2.get !== undefined || d2.set !== undefined)
          || d1.enumerable !== d2.enumerable || d1.configurable !== d2.configurable
          || d1.writable !== d2.writable) {
          throw new ParityError("MUTATION_DURING_MATERIALIZATION", "descriptor drift");
        }
        if (d1.get === undefined && d1.set === undefined && d1.value !== d2.value) {
          throw new ParityError("MUTATION_DURING_MATERIALIZATION", "value identity drift");
        }
      }
    };

    try {
      for (const key of stringKeys) {
        if (PROTOTYPE_KEYS.has(key)) throw new ParityError("PROTOTYPE_KEY_REJECTED", `prototype name key`);
        if (key === "toJSON") throw new ParityError("TOJSON_REJECTED", "own toJSON");
        if (COERCION_KEYS.has(key)) throw new ParityError("COERCION_HOOK_REJECTED", `own ${key}`);
        if (typeof key === "string" && UNPAIRED_SURROGATE.test(key)) throw new ParityError("INVALID_UNICODE", "unpaired surrogate key");
        checkStringBudget(key, budget, state);
      }
      let result;
      if (isArray) {
        const lengthDescriptor = descriptors.length;
        if (!lengthDescriptor || lengthDescriptor.get !== undefined || lengthDescriptor.set !== undefined
          || lengthDescriptor.enumerable !== false || lengthDescriptor.configurable !== false
          || lengthDescriptor.writable !== true) {
          throw new ParityError("NON_CANONICAL_ARRAY_PROPERTY", "non-native length descriptor");
        }
        const length = node.length;
        const { indexKeys, extra } = arrayIndexKeys(stringKeys, length);
        if (extra.length > 0) {
          const first = extra[0];
          throw new ParityError("NON_CANONICAL_ARRAY_PROPERTY", CANONICAL_INDEX.test(first) ? "out-of-range index" : "extra string key");
        }
        if (indexKeys.length !== length) throw new ParityError("SPARSE_ARRAY_REJECTED", "sparse hole");
        const items = [];
        for (let i = 0; i < length; i += 1) {
          const key = String(i);
          const descriptor = descriptors[key];
          if (!descriptor || descriptor.get !== undefined || descriptor.set !== undefined) {
            throw new ParityError("ACCESSOR_REJECTED", `array index ${i}`);
          }
          if (!descriptor.enumerable) throw new ParityError("NON_ENUMERABLE_PROPERTY", `array index ${i}`);
          items.push(descend(descriptor.value, depth + 1));
        }
        result = items;
      } else {
        const output = {};
        for (const key of stringKeys) {
          const descriptor = descriptors[key];
          if (descriptor === undefined) throw new ParityError("MUTATION_DURING_MATERIALIZATION", "vanished key");
          if (descriptor.get !== undefined || descriptor.set !== undefined) {
            throw new ParityError("ACCESSOR_REJECTED", "accessor body would run");
          }
          if (!descriptor.enumerable) throw new ParityError("NON_ENUMERABLE_PROPERTY", "hidden data property");
          const valueAt = descriptor.value;
          if (valueAt !== null && (typeof valueAt === "function" || typeof valueAt === "symbol" || typeof valueAt === "bigint" || typeof valueAt === "undefined")) {
            throw new ParityError("UNSUPPORTED_VALUE", "non-JSON value");
          }
          output[key] = descend(valueAt, depth + 1);
        }
        result = output;
      }
      recheck();
      active.delete(node);
      if (coalesceAliases) memo.set(node, result);
      return result;
    } catch (error) {
      active.delete(node);
      throw error;
    }
  };

  const materialized = descend(value, 0);
  if (Buffer.byteLength(canonicalBytes(materialized), "utf8") > budget.maxTreeBytes) {
    throw new ParityError("DOCUMENT_BUDGET_EXCEEDED", "canonical tree bytes");
  }
  return materialized;
}

// ---------------------------------------------------------------------------
// Stage-aware percent policy (amendment 6 section 8).
// ---------------------------------------------------------------------------

const VALID_PERCENT_RUN = /%[0-9A-Fa-f]{2}/;
const COMPLETE_ENVELOPE = /^(?:%[0-9A-Fa-f]{2})+$/;
const MAX_DECODED_STAGES = 2;

/** Test-only fixture transforms: P1 uppercases every UTF-8 byte, P2 = P1(P1). */
export function percentEncode1(text) {
  return [...utf8(text)].map((b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`).join("");
}
export function percentEncode2(text) {
  return percentEncode1(percentEncode1(text));
}
export function percentEncode3(text) {
  return percentEncode1(percentEncode1(percentEncode1(text)));
}

const strictUtf8Decode = (bytes) => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ParityError("MALFORMED_PERCENT", "invalid UTF-8 in percent run");
  }
};

const decodeValidatedRuns = (stage) => {
  const bytes = [];
  for (let i = 0; i < stage.length;) {
    const ch = stage[i];
    if (ch !== "%") {
      bytes.push(...utf8(ch));
      i += 1;
      continue;
    }
    const hexPair = stage.slice(i + 1, i + 3);
    if (!/^[0-9A-Fa-f]{2}$/.test(hexPair)) throw new ParityError("MALFORMED_PERCENT", "invalid escape");
    bytes.push(Number.parseInt(hexPair, 16));
    i += 3;
  }
  return strictUtf8Decode(Buffer.from(bytes));
};

/**
 * Strict URI-component decode state machine. Preserves the raw spelling and
 * returns every inspected stage: raw plus at most two decoded stages. Each
 * stage's escapes must all be valid before that stage decodes further; in a
 * decoded stage with no valid run, `%` followed by one or two ASCII
 * alphanumerics, `%`, or `u/U` is a malformed attempted escape while prose
 * percents stay literal. A further valid run after two decoded stages is
 * PERCENT_DECODE_LIMIT.
 */
export function decodeUriStages(rawComponent) {
  if (typeof rawComponent !== "string") return { stages: [], outcome: "clean" };
  const stages = [rawComponent];
  let current = rawComponent;
  for (let stageIndex = 0; stageIndex <= MAX_DECODED_STAGES; stageIndex += 1) {
    const hasValidRun = VALID_PERCENT_RUN.test(current);
    if (!hasValidRun) {
      // Prose scanner: % followed by whitespace/punctuation-other/EOS is
      // literal; % followed by alphanumerics, %, or u/U is a malformed
      // attempted escape. (A valid %HH pair cannot exist here: hasValidRun
      // already scanned the whole stage.)
      for (let i = 0; i < current.length; i += 1) {
        if (current[i] !== "%") continue;
        const next = current[i + 1];
        if (next === undefined) break; // end of string: literal prose
        if (/[A-Za-z0-9%]/.test(next)) {
          throw new ParityError("MALFORMED_PERCENT", "attempted escape");
        }
        // whitespace or other punctuation: literal prose, keep scanning
      }
      return { stages, outcome: "clean" };
    }
    if (stageIndex === MAX_DECODED_STAGES) {
      throw new ParityError("PERCENT_DECODE_LIMIT", "valid run after two decoded stages");
    }
    current = decodeValidatedRuns(current);
    stages.push(current);
  }
  return { stages, outcome: "clean" };
}

/**
 * Plain JSON/text channel: decode only when the entire string is a complete
 * `%HH` envelope (either hex case). One full envelope is stage 1, two nested
 * envelopes stage 2; a third is PERCENT_DECODE_LIMIT. Never partially decodes
 * and never rejects literal prose percents.
 */
export function decodePlainStages(value) {
  if (typeof value !== "string" || !COMPLETE_ENVELOPE.test(value)) return { stages: [value], outcome: "clean" };
  const stages = [value];
  let current = value;
  for (let pass = 0; pass < MAX_DECODED_STAGES + 1; pass += 1) {
    if (!COMPLETE_ENVELOPE.test(current)) return { stages, outcome: "clean" };
    if (pass === MAX_DECODED_STAGES) throw new ParityError("PERCENT_DECODE_LIMIT", "third envelope");
    const bytes = [];
    for (let i = 0; i < current.length; i += 3) bytes.push(Number.parseInt(current.slice(i + 1, i + 3), 16));
    current = strictUtf8Decode(Buffer.from(bytes));
    stages.push(current);
  }
  return { stages, outcome: "clean" };
}

// ---------------------------------------------------------------------------
// Credential/privacy classification with bounded, no-echo findings.
// ---------------------------------------------------------------------------

const CREDENTIAL_VALUE_PATTERNS = [
  /^(?:bearer|basic|token)[ \t\n\r\f\v]+\S+/i,
  /^sk-[A-Za-z0-9_-]+$/,
  /eyJ[A-Za-z0-9_-]{0,4093}\.[A-Za-z0-9_-]{2,4096}(?:\.[A-Za-z0-9_-]{2,4096})?/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];
const SPLIT_TOKEN_DELIMITERS = "/?=&:@";

export function isCredentialLikeValue(value) {
  if (typeof value !== "string") return false;
  return CREDENTIAL_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * Dot-preserving token scan: split only on `/ ? = & : @`, never on `.`, while
 * retaining `.` inside the candidate comparison (amendment 6 section 8).
 */
export function isCredentialLikeInText(text) {
  if (typeof text !== "string") return false;
  if (isCredentialLikeValue(text)) return true;
  return text.split(/[/?=&:@]/).some((segment) => segment.length > 0 && isCredentialLikeValue(segment));
}

export function isSensitiveExampleName(name, { allowPublicSolanaSignatureField = false } = {}) {
  if (typeof name !== "string") return false;
  if (PROTOTYPE_KEYS.has(name)) return true;
  if (allowPublicSolanaSignatureField && name === PUBLIC_SOLANA_SIGNATURE_QUERY.field) return false;
  return SENSITIVE_KEY.test(name)
    || SENSITIVE_KEY_COLLAPSED.test(name.replaceAll(/[-_.]/g, ""));
}

const safeKey = (name, options) => (
  typeof name === "string" && !isSensitiveExampleName(name, options) && !PROTOTYPE_KEYS.has(name) && !isCredentialLikeInText(name)
    ? name
    : REDACTED_KEY
);

/**
 * Privacy finding: a closed-enum code plus bounded safe context. No raw key,
 * value, URL component, validator message, exception text, Proxy/accessor
 * payload, or encoded variant ever crosses this boundary.
 */
function finding(code, message, context = {}) {
  return { code, message, ...context };
}

export const MAX_FINDINGS = 128;

function findingsSink() {
  const items = [];
  const sink = {
    items,
    truncated: false,
    add(entry) {
      if (items.length >= MAX_FINDINGS) {
        sink.truncated = true;
        return { truncated: true, code: "FINDING_CAP_REACHED" };
      }
      items.push(entry);
      return null;
    },
  };
  return sink;
}

/**
 * Bounded findings report for one example tree: at most MAX_FINDINGS public
 * findings, a `truncated` flag, and the primary code FINDING_CAP_REACHED
 * exposed separately from the bounded list when the cap was reached.
 */
export function exampleFindingsReport(value, path = "$") {
  const sink = findingsSink();
  const visit = (node, at, nameContext = false) => {
    if (Array.isArray(node)) {
      node.forEach((entry, index) => visit(entry, `${at}[${index}]`, nameContext));
      return;
    }
    if (node !== null && typeof node === "object") {
      for (const [name, entry] of Object.entries(node)) {
        const safeName = safeKey(name, {});
        if (PROTOTYPE_KEYS.has(name)) {
          sink.add(finding("PROTOTYPE_KEY_REJECTED", `${at}.${REDACTED_KEY}: prototype name in example`));
        } else {
          let stages;
          try {
            stages = decodePlainStages(name).stages;
          } catch (error) {
            if (error instanceof ParityError) {
              sink.add(finding(error.code, `${at}.${REDACTED_KEY}: ${error.code === "MALFORMED_PERCENT" ? "malformed percent envelope" : "percent decode limit"}`));
              stages = [];
            } else throw error;
          }
          if (stages.some((stage) => isSensitiveExampleName(stage) || isCredentialLikeInText(stage))) {
            sink.add(finding("CREDENTIAL_LIKE_KEY", `${at}.${REDACTED_KEY}: credential-like example key`));
          }
        }
        visit(entry, `${at}.${safeName}`, name === "required");
      }
      return;
    }
    if (typeof node === "string") {
      if (UNRESOLVED_TEMPLATE.test(node)) sink.add(finding("UNRESOLVED_TEMPLATE", `${at}: unresolved template in example value`));
      let stages;
      try {
        stages = decodePlainStages(node).stages;
      } catch (error) {
        if (error instanceof ParityError) {
          sink.add(finding(error.code, `${at}: ${error.code === "MALFORMED_PERCENT" ? "malformed percent envelope" : "percent decode limit"}`));
          stages = [];
        } else throw error;
      }
      if (stages.some((stage) => isCredentialLikeValue(stage))) {
        sink.add(finding("CREDENTIAL_LIKE_VALUE", `${at}: credential-like example value`));
      }
      if (nameContext && stages.some((stage) => isSensitiveExampleName(stage) || isCredentialLikeInText(stage))) {
        sink.add(finding("CREDENTIAL_LIKE_KEY", `${at}: credential-like required member name`));
      }
      for (const f of credentialBearingUrlFindings(node, at)) sink.add(f);
    }
  };
  visit(value, path);
  return {
    findings: sink.items,
    truncated: sink.truncated,
    primaryCode: sink.truncated ? "FINDING_CAP_REACHED" : (sink.items[0]?.code ?? null),
  };
}

function credentialVariantsFromStages(stages, uriChannel) {
  return stages.some((stage) => (
    isCredentialLikeInText(stage)
    || (uriChannel && stage.split(SPLIT_TOKEN_DELIMITERS).some((s) => isCredentialLikeValue(s)))
  ));
}

function sensitiveNameFromStages(stages, options) {
  return stages.some((stage) => isSensitiveExampleName(stage, options) || isCredentialLikeInText(stage));
}

/**
 * Reject credential-bearing URL examples while keeping ordinary public URLs
 * valid. URI channels preserve their raw component spelling and decode
 * through the strict bounded state machine; malformed encodings are
 * controlled findings, never a thrown URIError, and no component value is
 * echoed into any finding.
 */
export function credentialBearingUrlFindings(value, path = "$") {
  const sink = findingsSink();
  const findings = sink.items;
  if (typeof value !== "string" || !/^https?:\/\//i.test(value.trim())) return findings;
  let url = null;
  try {
    url = new URL(value.trim());
  } catch {
    url = null;
  }
  const reportMalformed = (channel) => findings.push(finding("MALFORMED_PERCENT", `${path}: URL example ${channel} carries malformed percent encoding`, { channel }));
  const scanComponent = (channel, raw, { credentialCode = "CREDENTIAL_LIKE_VALUE", keyOptions = null } = {}) => {
    let stages;
    try {
      stages = decodeUriStages(raw).stages;
    } catch (error) {
      if (error instanceof ParityError && (error.code === "MALFORMED_PERCENT" || error.code === "PERCENT_DECODE_LIMIT")) {
        findings.push(finding(error.code, `${path}: URL example ${channel} ${error.code === "MALFORMED_PERCENT" ? "carries malformed percent encoding" : "exceeds the decode limit"}`, { channel }));
        return;
      }
      throw error;
    }
    if (keyOptions !== null) {
      if (sensitiveNameFromStages(stages, keyOptions)) {
        findings.push(finding("CREDENTIAL_LIKE_KEY", `${path}: URL example ${channel} key is credential-like`, { channel }));
      }
      return;
    }
    if (credentialVariantsFromStages(stages, true)) {
      findings.push(finding(credentialCode, `${path}: URL example ${channel} carries credential-like material`, { channel }));
    }
  };

  if (url === null) {
    // Even an unparseable URL-shaped value gets the bounded whole-value
    // percent scan before the controlled unparseable finding.
    scanComponent("value", value.trim());
    if (findings.length === 0) {
      findings.push(finding("UNRESOLVED_TEMPLATE", `${path}: example looks like a URL but does not parse`));
    }
    return findings;
  }
  if (url.username || url.password) {
    findings.push(finding("USERINFO_CREDENTIALS", `${path}: URL example embeds userinfo credentials`, { channel: "userinfo" }));
    scanComponent("userinfo username", url.username);
    if (url.password) scanComponent("userinfo password", url.password);
  }
  if (url.hash) findings.push(finding("FRAGMENT_CHANNEL", `${path}: URL example carries a fragment channel`, { channel: "fragment" }));
  scanComponent("value", value.trim());
  scanComponent("host", url.hostname);
  scanComponent("path", url.pathname);
  scanComponent("query", url.search);
  // Raw query spelling before URL normalization: split the raw search string
  // manually so keys and values keep their exact percent-encoded bytes; the
  // WHATWG searchParams view would decode them too early.
  for (const pair of url.search.replace(/^\?/, "").split("&")) {
    if (pair === "") continue;
    const separator = pair.indexOf("=");
    const key = separator === -1 ? pair : pair.slice(0, separator);
    const entry = separator === -1 ? "" : pair.slice(separator + 1);
    // Amendment 9 section 9: query keys are never interpolated. The frozen
    // `query key` channel identity carries the caller path only; the
    // credential-like key code is decided by the key scan below.
    scanComponent("query key", key, { keyOptions: {} });
    scanComponent("query value", entry);
    // Nested URL inspection of the decoded query value: userinfo and fragment
    // channels plus the frozen nested host/path identities. No query key is
    // ever interpolated (amendment 9 section 9).
    let entryStages;
    try {
      entryStages = decodeUriStages(entry).stages;
    } catch (error) {
      if (!(error instanceof ParityError && (error.code === "MALFORMED_PERCENT" || error.code === "PERCENT_DECODE_LIMIT"))) throw error;
      continue;
    }
    for (const stage of entryStages) {
      if (typeof stage !== "string" || !/^https?:\/\//i.test(stage.trim())) continue;
      let nested;
      try {
        nested = new URL(stage.trim());
      } catch {
        continue;
      }
      if (nested.username || nested.password) {
        findings.push(finding("USERINFO_CREDENTIALS", `${path}: URL example embeds userinfo credentials in a decoded query value`, { channel: "userinfo" }));
      }
      if (nested.hash) {
        findings.push(finding("FRAGMENT_CHANNEL", `${path}: URL example carries a fragment channel in a decoded query value`, { channel: "fragment" }));
      }
      scanComponent("nested URL host", nested.hostname);
      scanComponent("nested URL path", nested.pathname);
    }
  }
  return findings;
}

/**
 * Recursively reject credential-like keys or values, unresolved templates,
 * prototype names, and credential-bearing URLs anywhere inside an example
 * tree. Plain JSON/text channels decode only through complete envelopes.
 */
export function unsafeExampleFindings(value, path = "$") {
  const sink = findingsSink();
  const visit = (node, at, nameContext = false) => {
    if (Array.isArray(node)) {
      node.forEach((entry, index) => visit(entry, `${at}[${index}]`, nameContext));
      return;
    }
    if (node !== null && typeof node === "object") {
      for (const [name, entry] of Object.entries(node)) {
        const safeName = safeKey(name, {});
        if (PROTOTYPE_KEYS.has(name)) {
          sink.add(finding("PROTOTYPE_KEY_REJECTED", `${at}.${REDACTED_KEY}: prototype name in example`));
        } else {
          let stages;
          try {
            stages = decodePlainStages(name).stages;
          } catch (error) {
            if (error instanceof ParityError) {
              sink.add(finding(error.code, `${at}.${REDACTED_KEY}: ${error.code === "MALFORMED_PERCENT" ? "malformed percent envelope" : "percent decode limit"}`));
              stages = [];
            } else throw error;
          }
          if (stages.some((stage) => isSensitiveExampleName(stage) || isCredentialLikeInText(stage))) {
            sink.add(finding("CREDENTIAL_LIKE_KEY", `${at}.${REDACTED_KEY}: credential-like example key`));
          }
        }
        // Strings under a `required` member are property NAMES, not values.
        visit(entry, `${at}.${safeName}`, name === "required");
      }
      return;
    }
    if (typeof node === "string") {
      if (UNRESOLVED_TEMPLATE.test(node)) sink.add(finding("UNRESOLVED_TEMPLATE", `${at}: unresolved template in example value`));
      let stages;
      try {
        stages = decodePlainStages(node).stages;
      } catch (error) {
        if (error instanceof ParityError) {
          sink.add(finding(error.code, `${at}: ${error.code === "MALFORMED_PERCENT" ? "malformed percent envelope" : "percent decode limit"}`));
          stages = [];
        } else throw error;
      }
      if (stages.some((stage) => isCredentialLikeValue(stage))) {
        sink.add(finding("CREDENTIAL_LIKE_VALUE", `${at}: credential-like example value`));
      }
      if (nameContext && stages.some((stage) => isSensitiveExampleName(stage) || isCredentialLikeInText(stage))) {
        sink.add(finding("CREDENTIAL_LIKE_KEY", `${at}: credential-like required member name`));
      }
      for (const f of credentialBearingUrlFindings(node, at)) sink.add(f);
    }
  };
  visit(value, path);
  return sink.items;
}

export function hasUnresolvedTemplate(value) {
  return typeof value === "string" && UNRESOLVED_TEMPLATE.test(value);
}

export function isScalarQueryValue(value) {
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "boolean";
}

// ---------------------------------------------------------------------------
// Dialect, format, and retrieval policy (amendment 6 section 4).
// ---------------------------------------------------------------------------

/**
 * Engine selection from the enclosing document's exact `openapi` version plus
 * the frozen three-row 3.1 compatibility table. Returns the exact dialect
 * identity for digests and the runtime compile context.
 */
export function selectDialectAuthority({ documentOpenApiVersion, documentJsonSchemaDialect, schemaDialect } = {}) {
  if (typeof documentOpenApiVersion !== "string" || !OPENAPI_30_VERSION.test(documentOpenApiVersion) && !OPENAPI_31_VERSION.test(documentOpenApiVersion)) {
    throw new ParityError("UNSUPPORTED_OAS_VERSION", "missing, malformed, or unsupported openapi version");
  }
  if (OPENAPI_30_VERSION.test(documentOpenApiVersion)) {
    if (schemaDialect !== undefined) throw new ParityError("NESTED_DIALECT_REJECTED", "3.0 document cannot gain 3.1 semantics");
    // `jsonSchemaDialect` is a 3.1 document concept; a 3.0 document carrying
    // one is anomalous and fails closed.
    if (documentJsonSchemaDialect !== undefined) throw new ParityError("DIALECT_REJECTED", "3.0 document cannot declare jsonSchemaDialect");
    return { engine: "openapi-3-0", exactDialect: DIALECT_IDENTITIES.OAS30, runtimeDialect: RUNTIME_DIALECT_OAS30 };
  }
  if (documentJsonSchemaDialect !== undefined && documentJsonSchemaDialect !== DIALECT_IDENTITIES.OAS31_BASE) {
    throw new ParityError("DIALECT_REJECTED", "unsupported document jsonSchemaDialect");
  }
  if (schemaDialect === undefined || schemaDialect === DIALECT_IDENTITIES.OAS31_BASE) {
    return { engine: "openapi-3-1", exactDialect: DIALECT_IDENTITIES.OAS31_BASE, runtimeDialect: RUNTIME_DIALECT_OAS31 };
  }
  if (schemaDialect === DIALECT_IDENTITIES.DRAFT_2020_12) {
    return { engine: "openapi-3-1", exactDialect: DIALECT_IDENTITIES.DRAFT_2020_12, runtimeDialect: RUNTIME_DIALECT_OAS31 };
  }
  throw new ParityError("DIALECT_REJECTED", "unsupported schema $schema");
}

const POLICY_KEYWORDS = new Set(["$id", "$anchor", "$dynamicAnchor", "$dynamicRef", "$recursiveAnchor", "$recursiveRef", "additionalItems"]);
const isLocalJsonPointerRef = (value) => typeof value === "string" && value.startsWith("#/") && value.length >= 2;

function visitMaterializedSchema(node, visitNode) {
  if (node === null || typeof node !== "object") return;
  visitNode(node);
  for (const [, entry] of Object.entries(node)) {
    if (entry !== null && typeof entry === "object") visitMaterializedSchema(entry, visitNode);
  }
}

/**
 * One policy pass over already safe-materialized schema data before any
 * Hyperjump registration: reject every own `$id`, `$anchor`, `$dynamic*`,
 * `$recursive*`, obsolete `additionalItems`, and every `$ref` not beginning
 * exactly `#/`. Examines member-name presence only; decides no keyword shape
 * or assertion semantics, which remain Hyperjump authority.
 */
export function schemaPolicyFindings(materializedSchema) {
  const findings = [];
  visitMaterializedSchema(materializedSchema, (node) => {
    for (const key of Object.keys(node)) {
      if (POLICY_KEYWORDS.has(key)) findings.push(finding("POLICY_KEYWORD_REJECTED", `schema policy keyword ${key} is rejected`));
    }
    const ref = node.$ref;
    if (ref !== undefined && !isLocalJsonPointerRef(ref)) {
      findings.push(finding("POLICY_KEYWORD_REJECTED", "non-local $ref is rejected (same-origin policy)"));
    }
  });
  return findings;
}

// ---------------------------------------------------------------------------
// Registry, cache lifecycle, and sync/async validation boundary.
// ---------------------------------------------------------------------------

const PARITY_URN_PREFIX = "urn:x402-parity:";

/**
 * R_parity: every registered schema URI beginning with the parity prefix.
 * Package meta-schemas are excluded and never unregistered by this module.
 */
export function parityRegistryUris() {
  return getAllRegisteredSchemaUris().filter((uri) => typeof uri === "string" && uri.startsWith(PARITY_URN_PREFIX)).sort();
}

function assertParityRegistryEmpty(boundary) {
  const uris = parityRegistryUris();
  if (uris.length > 0) throw new ParityError("REGISTRY_NOT_EMPTY", `at ${boundary}`);
}

const syntheticUrnFor = (dAuth, runNonce) => (
  `${PARITY_URN_PREFIX}${dAuth}:${hexOf(sha256(utf8(runNonce)))}`
);

/**
 * The one process-local compiled-validator cache, shared across boot
 * generations and keyed by D_auth. Boot-local staging keeps new compiled
 * entries invisible until the CACHE_BIND stage commits them atomically.
 */
const processValidatorCache = new Map(); // D_auth -> { validator, exactDialect, pv }
const stagedValidatorCache = new Map(); // D_auth -> { validator, exactDialect, pv }
const pendingAuthority = new Map(); // D_auth -> { materializedSchema, exactDialect, runtimeDialect }
const rejectedAuthority = new Map(); // D_auth -> bounded rejection code from a real compile attempt
let collectingAuthority = false;
// Amendment 9 section 6.1 / amendment 10 section 6: one active transaction
// owner at a time. The owner context is installed synchronously after
// argument validation and snapshots, before MATERIALIZING, and cleared
// exactly once after successful publication or rollback measurement.
let transactionActive = false;
let activeOwner = null;

/** Exact live cache-identity comparison used by both the second-call gate
 * and the post-rollback measurement (A9 6.4 step 5). */
function liveCacheMatches(live, snapshot) {
  if (live.size !== snapshot.size) return false;
  for (const [k, v] of snapshot) {
    if (live.get(k) !== v) return false;
  }
  for (const k of live.keys()) {
    if (!snapshot.has(k)) return false;
  }
  return true;
}

export const CACHE_BUDGET = 128;

/**
 * Cache manifest entry: hex(D_auth) + 0x00 + exactDialect + 0x00 + PV,
 * bytewise sorted, LF joined; D_cache = H("x402-parity/cache-manifest/v1", joined).
 */
export function cacheManifestEntry(dAuth, exactDialect) {
  return `${dAuth}\0${exactDialect}\0${PARITY_RUNTIME_VERSION}`;
}

export function computeCacheManifestDigest(entries) {
  const joined = [...entries].sort().join("\n");
  return taggedDigest("x402-parity/cache-manifest/v1", joined);
}

export function cacheManifestSnapshot() {
  const entries = [];
  for (const [dAuth, entry] of processValidatorCache) entries.push(cacheManifestEntry(dAuth, entry.exactDialect));
  for (const [dAuth, entry] of stagedValidatorCache) {
    if (!processValidatorCache.has(dAuth)) entries.push(cacheManifestEntry(dAuth, entry.exactDialect));
  }
  return computeCacheManifestDigest(entries);
}

function lookupValidator(dAuth) {
  const staged = stagedValidatorCache.get(dAuth);
  if (staged !== undefined) return staged;
  return processValidatorCache.get(dAuth);
}

/**
 * Compile one schema at its synthetic URN under the exact runtime dialect.
 * Register, compile (meta-validate), and unregister in one bounded
 * try/finally; retain only the immutable compiled validator and its binding.
 */
async function compileSchemaAuthority(materializedSchema, runtimeDialect, dAuth, runNonce) {
  const urn = syntheticUrnFor(dAuth, `${runNonce}:${dAuth}`);
  if (hasSchema(urn)) throw new ParityError("REGISTRY_IDENTITY_COLLISION", "synthetic URN already registered");
  registerSchema(materializedSchema, urn, runtimeDialect);
  let validator;
  try {
    validator = await validate(urn); // compiled; synchronous from here
  } catch (error) {
    const metaFailure = error instanceof InvalidSchemaError;
    const code = metaFailure ? "META_VALIDATION_FAILED" : "SCHEMA_COMPILE_FAILED";
    // Record the bounded rejection so later (audit-time) lookups of the same
    // identity report why the authority does not exist instead of a generic
    // unprepared mismatch.
    if (!rejectedAuthority.has(dAuth)) rejectedAuthority.set(dAuth, code);
    throw new ParityError(code, metaFailure ? "schema rejected by its dialect meta-schema" : "schema failed to compile");
  } finally {
    unregisterSchema(urn);
  }
  // Retain only the immutable compiled validator and its binding: the
  // synthetic URN is gone and R_parity must be empty after every miss
  // compilation.
  assertParityRegistryEmpty("after miss compilation");
  return { validator, urn };
}

/**
 * Authority identity for one schema: safe-materialize, select the exact
 * dialect, compute D_auth. Returns bounded rejection codes on failure.
 */
function schemaAuthorityIdentity(schema, { documentOpenApiVersion, documentJsonSchemaDialect } = {}) {
  if (schema === undefined || schema === null) throw new ParityError("MISSING_SCHEMA", "request schema is missing");
  if (schema === false || schema === true) {
    const authority = selectDialectAuthority({ documentOpenApiVersion, documentJsonSchemaDialect, schemaDialect: undefined });
    return { booleanSchema: schema, exactDialect: authority.exactDialect, materialized: schema };
  }
  if (Array.isArray(schema)) throw new ParityError("INVALID_SCHEMA_TYPE", "request schema must be a boolean or object");
  const materialized = materializeSafe(schema, "schema");
  // OpenAPI `example`/`examples` on a schema are pure annotations: they never
  // assert. Stripping them from the materialized authority keeps the D_auth
  // identity identical whether or not an authored example annotation is still
  // attached to the (possibly shared) schema object at projection time.
  delete materialized.example;
  delete materialized.examples;
  const schemaDialect = materialized.$schema;
  const authority = selectDialectAuthority({ documentOpenApiVersion, documentJsonSchemaDialect, schemaDialect });
  const dAuth = D_authOf(materialized, authority.exactDialect);
  return { materialized, exactDialect: authority.exactDialect, runtimeDialect: authority.runtimeDialect, dAuth };
}

/**
 * Standards-complete example conformance backed by the prepared Hyperjump
 * authority. Compilation is asynchronous and happens once per unique schema
 * identity during preparation; this synchronous path either finds the
 * compiled validator (process or staged cache) or fails closed. It never
 * falls back to a second validator or a permissive empty result.
 */
export function validateExampleAgainstSchema(value, schema, path = "$", { documentOpenApiVersion = "3.1.0", documentJsonSchemaDialect } = {}) {
  const stringSafety = () => {
    if (typeof value !== "string") return [];
    const findings = [];
    let stages = [];
    try {
      stages = decodePlainStages(value).stages;
    } catch (error) {
      if (error instanceof ParityError) {
        // Amendment 9 section 5 / amendment 10 section 4: exactly one
        // value-free finding from the frozen percent identities, then no
        // later stage inspection at all. unsafeExampleFindings already
        // emitted that single finding for this top-level string (it is in
        // the caller's `unsafe` list), so stringSafety adds no second copy.
        stages = [];
        return findings;
      }
      throw error;
    }
    if (stages.some((stage) => isCredentialLikeValue(stage))) {
      findings.push({ code: "CREDENTIAL_LIKE_VALUE", message: `${path}: credential-like example value` });
    }
    for (const f of credentialBearingUrlFindings(value, path)) findings.push(f);
    return findings;
  };
  let instance;
  try {
    instance = materializeSafe(value, "example");
  } catch (error) {
    if (error instanceof ParityError) return [{ code: error.code, message: `${path}: ${error.message}` }];
    throw error;
  }
  const unsafe = unsafeExampleFindings(instance, path);
  let identity;
  try {
    identity = schemaAuthorityIdentity(schema, { documentOpenApiVersion, documentJsonSchemaDialect });
  } catch (error) {
    if (error instanceof ParityError) return [...unsafe, { code: error.code, message: `${path}: ${error.message}` }];
    throw error;
  }
  const policy = schemaPolicyFindings(identity.materialized);
  if (policy.length > 0) {
    return [...unsafe, ...policy.map((f) => ({ code: f.code, message: `${path}: ${f.message}` }))];
  }
  if (identity.booleanSchema === false) {
    return [...unsafe, { code: "INSTANCE_VALIDATION_FAILED", message: `${path}: boolean schema false rejects every instance (fail closed)` }];
  }
  if (identity.booleanSchema === true) return [...unsafe, ...stringSafety()];
  const cached = lookupValidator(identity.dAuth);
  if (cached === undefined) {
    const rejected = rejectedAuthority.get(identity.dAuth);
    if (rejected !== undefined) {
      return [...unsafe, { code: rejected, message: `${path}: schema authority was rejected (${rejected})` }];
    }
    if (collectingAuthority) {
      pendingAuthority.set(identity.dAuth, {
        materializedSchema: identity.materialized,
        exactDialect: identity.exactDialect,
        runtimeDialect: identity.runtimeDialect,
      });
      return [...unsafe, ...stringSafety()]; // deferred: the preparation transaction decides
    }
    return [...unsafe, { code: "CACHE_IDENTITY_MISMATCH", message: `${path}: unprepared schema authority (fail closed)` }];
  }
  const output = cached.validator(instance);
  if (output.valid !== true) {
    return [...unsafe, { code: "INSTANCE_VALIDATION_FAILED", message: `${path}: example violates its compiled schema` }];
  }
  return [...unsafe, ...stringSafety()];
}

/**
 * Harness-only: compile (meta-validate) one schema authority and bind it
 * into the process cache using the exact synthetic-URN lifecycle of the boot
 * transaction. Acceptance harnesses use this for fixture schemas whose
 * natural instances are neither scalar query inputs nor plain-object bodies.
 */
export async function prepareSchemaAuthority(schema, { documentOpenApiVersion = "3.1.0", documentJsonSchemaDialect } = {}) {
  const identity = schemaAuthorityIdentity(schema, { documentOpenApiVersion, documentJsonSchemaDialect });
  if (identity.booleanSchema !== undefined) return { dAuth: null, booleanSchema: identity.booleanSchema };
  if (schemaPolicyFindings(identity.materialized).length > 0) {
    throw new ParityError("POLICY_KEYWORD_REJECTED", "schema policy keyword rejected");
  }
  if (processValidatorCache.has(identity.dAuth) || stagedValidatorCache.has(identity.dAuth)) {
    return { dAuth: identity.dAuth, cached: true };
  }
  // No registry-empty boundary asserts here: hostile harness probes (for
  // example the duplicate-registration collision) legitimately run with a
  // pre-registered synthetic URN. The boot transaction keeps every boundary.
  const { validator } = await compileSchemaAuthority(identity.materialized, identity.runtimeDialect, identity.dAuth, `harness:${identity.dAuth}`);
  processValidatorCache.set(identity.dAuth, { validator, exactDialect: identity.exactDialect, pv: PARITY_RUNTIME_VERSION });
  return { dAuth: identity.dAuth, cached: false };
}

// ---------------------------------------------------------------------------
// Frozen paid inventories and projection (inherited surface).
// ---------------------------------------------------------------------------

// The single public `signature` exception: a Solana transaction signature is
// public ledger data (same class as an EVM transactionHash), carried only by
// this exact method-route and query field, under this exact canonical public
// base58 schema. Every other occurrence of the key is rejected.
export const PUBLIC_SOLANA_SIGNATURE_QUERY = Object.freeze({
  method: "GET",
  route: "/chain/solana-transaction-receipt",
  field: "signature",
  schemaPattern: "^[1-9A-HJ-NP-Za-km-z]{80,90}$",
});

// Explicit alias mapping from generated access paths onto their canonical
// discovery request contracts. The Circle gateway GET path serves the same
// canonical payment-offer-preflight GET request contract.
export const REQUEST_CONTRACT_ALIASES = Object.freeze({
  "GET /gateway/commerce/payment-offer-preflight": "GET /commerce/payment-offer-preflight",
});

// Exact canonical paid surface inventory. The AgentCash profile additionally
// exposes the Circle gateway GET alias when the gateway is enabled.
const CANONICAL_PAID_GET_ROUTES = Object.freeze([
  "/chain/solana-transaction-receipt",
  "/chain/transaction-receipt",
  "/commerce/contract-qualified-search",
  "/commerce/payment-offer-preflight",
  "/commerce/seller-integrity-audit",
  "/commerce/settlement-proof",
  "/deep-audit",
  "/defi/morpho-market-underwrite",
  "/defi/morpho-position",
  "/defi/morpho-preliquidation-replay",
  "/defi/morpho-protection",
  "/distribution/agent-discoverability-audit",
  "/distribution/agent-surface-budget-audit",
  "/enrich",
  "/extract",
  "/read",
  "/scan",
  "/schemaforge",
  "/wallet-enrich",
  "/work/opportunity-preflight",
]);
const CANONICAL_PAID_POST_ROUTES = Object.freeze([
  "/commerce/payment-offer-preflight",
  "/security/stateful-wallet-policy-conformance",
  "/security/wallet-policy-conformance",
  "/work/opportunity-preflight",
]);
export const EXPECTED_PAID_METHOD_ROUTE_COUNTS = Object.freeze({
  agentcash: 25,
  mpp: 24,
});

// Expected surface counts derived from the actually enabled mounted surfaces,
// never the unconditional default total: AgentCash mounts its 24 canonical
// method-routes plus the optional Circle gateway GET alias exactly when the
// gateway is enabled; MPP always mounts 24.
export const EXPECTED_ENABLED_SURFACE_COUNTS = Object.freeze({
  agentcashCircleEnabled: 25,
  agentcashCircleDisabled: 24,
  mpp: 24,
});

function expectedEnabledSurfaceCount(profile, circleGatewayEnabled) {
  if (profile === "mpp") return EXPECTED_ENABLED_SURFACE_COUNTS.mpp;
  return circleGatewayEnabled
    ? EXPECTED_ENABLED_SURFACE_COUNTS.agentcashCircleEnabled
    : EXPECTED_ENABLED_SURFACE_COUNTS.agentcashCircleDisabled;
}

export function expectedPaidMethodRoutes({ profile, circleGatewayEnabled = false } = {}) {
  const routes = [
    ...CANONICAL_PAID_GET_ROUTES.map((route) => `GET ${route}`),
    ...CANONICAL_PAID_POST_ROUTES.map((route) => `POST ${route}`),
  ];
  if (circleGatewayEnabled && profile !== "mpp") routes.push("GET /gateway/commerce/payment-offer-preflight");
  return routes.sort();
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Structural semantic equality: objects compare independently of key order,
 * arrays compare element-wise in order. Never JSON.stringify order equality.
 */
export function valuesCanonicallyEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((entry, index) => valuesCanonicallyEqual(entry, right[index]));
  }
  if (isPlainObject(left) || isPlainObject(right)) {
    if (!isPlainObject(left) || !isPlainObject(right)) return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (leftKeys.length !== rightKeys.length) return false;
    if (!leftKeys.every((key, index) => key === rightKeys[index])) return false;
    return leftKeys.every((key) => valuesCanonicallyEqual(left[key], right[key]));
  }
  return false;
}

function singletonExampleValue(examples) {
  if (!isPlainObject(examples) || Object.keys(examples).length !== 1) return undefined;
  const [only] = Object.values(examples);
  return isPlainObject(only) && "value" in only ? only.value : undefined;
}

export function parameterExampleValue(parameter) {
  if (!isPlainObject(parameter)) return undefined;
  if (parameter.example !== undefined) return parameter.example;
  const fromExamples = singletonExampleValue(parameter.examples);
  if (fromExamples !== undefined) return fromExamples;
  if (isPlainObject(parameter.schema)) {
    if (parameter.schema.example !== undefined) return parameter.schema.example;
    return singletonExampleValue(parameter.schema.examples);
  }
  return undefined;
}

function clearAuthoredParameterExample(parameter) {
  delete parameter.examples;
  if (isPlainObject(parameter.schema)) {
    // Copy-on-write: never mutate a shared discovery-contract schema object.
    // The top-level authored example moves off a private clone, so every
    // deterministic rebuild sees the identical schema bytes and the D_auth
    // cache identity stays stable across boots and request-time rebuilds.
    const clone = { ...parameter.schema };
    delete clone.example;
    delete clone.examples;
    parameter.schema = clone;
  }
}

function publicSignatureExceptionApplies(label) {
  return label === `${PUBLIC_SOLANA_SIGNATURE_QUERY.method} ${PUBLIC_SOLANA_SIGNATURE_QUERY.route}`;
}

/**
 * Canonical examples are authoritative: safety and fail-closed schema
 * conformance of the canonical value are enforced before any overwrite is
 * considered. The scoped public Solana signature exception is honored only on
 * its exact method-route and query field, and only under the canonical public
 * base58 schema.
 */
function enforceCanonicalQueryInputSafety(label, schema, name, value, documentOpenApiVersion) {
  const exceptionApplies = publicSignatureExceptionApplies(label);
  if (isSensitiveExampleName(name, { allowPublicSolanaSignatureField: exceptionApplies })) {
    throw new ParityError("CREDENTIAL_LIKE_KEY", `Discovery contract ${label} carries an unsafe accepted example for required query input ${name}`);
  }
  if (exceptionApplies && name === PUBLIC_SOLANA_SIGNATURE_QUERY.field) {
    if (schema?.type !== "string" || schema.pattern !== PUBLIC_SOLANA_SIGNATURE_QUERY.schemaPattern) {
      throw new ParityError("INVENTORY_DRIFT", `Discovery contract ${label} query input ${name} must carry the canonical public Solana base58 schema (${PUBLIC_SOLANA_SIGNATURE_QUERY.schemaPattern})`);
    }
  }
  if (hasUnresolvedTemplate(value)) {
    throw new ParityError("UNRESOLVED_TEMPLATE", `Discovery contract ${label} carries an unresolved template example for required query input ${name}`);
  }
  let stages;
  try {
    stages = decodePlainStages(value).stages;
  } catch (error) {
    if (error instanceof ParityError) {
      throw new ParityError(error.code, `Discovery contract ${label} carries a hostile percent envelope for required query input ${name}`);
    }
    throw error;
  }
  if (stages.some((stage) => isCredentialLikeValue(stage))) {
    throw new ParityError("CREDENTIAL_LIKE_VALUE", `Discovery contract ${label} carries a credential-like accepted example for required query input ${name}`);
  }
  for (const f of credentialBearingUrlFindings(value)) {
    throw new ParityError(f.code, `Discovery contract ${label} carries a credential-bearing URL example for required query input ${name}`);
  }
  for (const error of validateExampleAgainstSchema(value, schema, `$.${name}`, { documentOpenApiVersion })) {
    throw new ParityError(error.code, `Discovery contract ${label} accepted example for required query input ${name} violates its schema (${error.code})`);
  }
}

function applyQueryExamples(operation, label, contract, documentOpenApiVersion) {
  const required = contract.schema?.properties?.queryParams?.required;
  if (!Array.isArray(required) || required.length === 0) {
    throw new ParityError("INVENTORY_DRIFT", `Discovery contract ${label} declares no required query keys`);
  }
  const queryParams = contract.example?.queryParams;
  let applied = 0;
  let verified = 0;
  let overwritten = 0;
  for (const name of required) {
    if (typeof name !== "string") throw new ParityError("INVALID_SCHEMA_TYPE", `Discovery contract ${label} has a non-string required query key`);
    const parameters = Array.isArray(operation.parameters) ? operation.parameters : [];
    const parameter = parameters.find((entry) => isPlainObject(entry) && entry.in === "query" && entry.name === name);
    if (!parameter) {
      throw new ParityError("INVENTORY_DRIFT", `OpenAPI ${label} declares no query parameter for required discovery input ${name}`);
    }
    const value = isPlainObject(queryParams) ? queryParams[name] : undefined;
    if (!isScalarQueryValue(value)) {
      throw new ParityError("INVALID_SCHEMA_TYPE", `Discovery contract ${label} lacks a scalar accepted example for required query input ${name}`);
    }
    enforceCanonicalQueryInputSafety(label, parameter.schema, name, value, documentOpenApiVersion);
    const current = parameterExampleValue(parameter);
    if (current !== undefined && valuesCanonicallyEqual(current, value)) {
      verified += 1;
      continue;
    }
    clearAuthoredParameterExample(parameter);
    parameter.example = structuredClone(value);
    if (current === undefined) applied += 1;
    else overwritten += 1;
  }
  return { applied, verified, overwritten };
}

function applyBodyExample(operation, label, contract, documentOpenApiVersion) {
  const mediaType = operation.requestBody?.content?.["application/json"];
  if (!isPlainObject(mediaType)) {
    throw new ParityError("INVENTORY_DRIFT", `OpenAPI ${label} lacks an application/json request body for its declared JSON contract`);
  }
  const body = contract.example?.body;
  if (!isPlainObject(body)) {
    throw new ParityError("INVALID_SCHEMA_TYPE", `Discovery contract ${label} lacks a JSON body example`);
  }
  const unsafe = unsafeExampleFindings(body);
  if (unsafe.length) {
    throw new ParityError(unsafe[0].code, `Discovery contract ${label} carries an unsafe body example (${unsafe.map((f) => f.code).join("; ")})`);
  }
  if (!isPlainObject(mediaType.schema)) {
    throw new ParityError("MISSING_SCHEMA", `OpenAPI ${label} JSON request body lacks a schema`);
  }
  const schemaErrors = validateExampleAgainstSchema(body, mediaType.schema, "$", { documentOpenApiVersion });
  if (schemaErrors.length) {
    throw new ParityError(schemaErrors[0].code, `Discovery contract ${label} accepted body example violates its schema (${schemaErrors.map((f) => f.code).join("; ")})`);
  }
  const current = mediaType.example !== undefined
    ? mediaType.example
    : singletonExampleValue(mediaType.examples);
  if (current !== undefined && valuesCanonicallyEqual(current, body)) {
    return { applied: 0, verified: 1, overwritten: 0 };
  }
  delete mediaType.examples;
  mediaType.example = structuredClone(body);
  if (current === undefined) return { applied: 1, verified: 0, overwritten: 0 };
  return { applied: 0, verified: 0, overwritten: 1 };
}

/**
 * Resolve the canonical request contract for a generated operation label,
 * following the explicit alias map (e.g. the Circle gateway GET path onto its
 * canonical GET request contract) when the label itself is undeclared.
 */
function resolveCanonicalRequestContract(label, resolveRequestContract) {
  const direct = resolveRequestContract(label);
  if (direct) return direct;
  const canonicalRouteKey = REQUEST_CONTRACT_ALIASES[label];
  return canonicalRouteKey ? resolveRequestContract(canonicalRouteKey) : null;
}

/**
 * Project discovery-contract request examples into every paid OpenAPI
 * operation with canonical authority: an existing authored example must be
 * canonically equal to the canonical value or the canonical value overwrites
 * deterministically. Undeclared contracts are skipped so the pre-listener
 * startup build (which runs before payment-middleware registration declares
 * them) stays a pure no-op; the post-registration generation gate audits the
 * complete paid surface so nothing example-less can be served.
 */
export function applyDiscoveryRequestExamples(document, resolveRequestContract) {
  if (!isPlainObject(document?.paths)) throw new Error("OpenAPI document is missing paths");
  if (typeof resolveRequestContract !== "function") throw new Error("resolveRequestContract is required");
  const documentOpenApiVersion = document.openapi;
  let queryApplied = 0;
  let queryVerified = 0;
  let queryOverwritten = 0;
  let bodyApplied = 0;
  let bodyVerified = 0;
  let bodyOverwritten = 0;
  for (const [pathname, pathItem] of Object.entries(document.paths)) {
    if (!isPlainObject(pathItem)) continue;
    for (const method of OPENAPI_OPERATION_METHODS) {
      const operation = pathItem[method];
      if (!isPlainObject(operation) || !operation["x-payment-info"]) continue;
      const label = `${method.toUpperCase()} ${pathname}`;
      const contract = resolveCanonicalRequestContract(label, resolveRequestContract);
      if (!contract) continue;
      if (method === "get") {
        const receipt = applyQueryExamples(operation, label, contract, documentOpenApiVersion);
        queryApplied += receipt.applied;
        queryVerified += receipt.verified;
        queryOverwritten += receipt.overwritten;
      } else {
        const receipt = applyBodyExample(operation, label, contract, documentOpenApiVersion);
        bodyApplied += receipt.applied;
        bodyVerified += receipt.verified;
        bodyOverwritten += receipt.overwritten;
      }
    }
  }
  return {
    ok: true,
    queryExamples: queryApplied,
    bodyExamples: bodyApplied,
    queryVerified,
    queryOverwritten,
    bodyVerified,
    bodyOverwritten,
  };
}

// ---------------------------------------------------------------------------
// Frozen operation and paid-route manifests (amendment 6 section 7).
// ---------------------------------------------------------------------------

export const OPERATION_ID_MANIFEST_TAG = "x402-parity/operation-id-manifest/v1";
export const PAID_ROUTE_MANIFEST_TAG = "x402-parity/paid-route-manifest/v1";

function operationsOf(document) {
  const rows = [];
  for (const [pathname, pathItem] of Object.entries(document?.paths ?? {})) {
    if (!isPlainObject(pathItem)) continue;
    for (const method of OPENAPI_OPERATION_METHODS) {
      const operation = pathItem[method];
      if (!isPlainObject(operation)) continue;
      rows.push({ method: method.toUpperCase(), pathname, operation, paid: operation["x-payment-info"] !== undefined });
    }
  }
  return rows;
}

const manifestDigest = (tag, records) => hexOf(sha256(Buffer.concat([utf8(tag), Buffer.from([0]), utf8(records.join("\n"))])));

/** Every actual operation: METHOD + SP + pathname + 0x00 + operationId, bytewise sorted, LF joined. */
export function operationIdManifest(document) {
  const rows = operationsOf(document);
  const seen = new Set();
  const records = rows.map(({ method, pathname, operation }) => {
    if (typeof operation.operationId !== "string" || !/^[A-Za-z][A-Za-z0-9]*$/.test(operation.operationId)) {
      throw new ParityError("OPERATION_ID_DRIFT", "operation missing a stable operationId");
    }
    if (seen.has(operation.operationId)) throw new ParityError("OPERATION_ID_DRIFT", "duplicate operationId");
    seen.add(operation.operationId);
    return `${method} ${pathname}\0${operation.operationId}`;
  }).sort();
  return { count: records.length, uniqueOperationIds: seen.size, digest: manifestDigest(OPERATION_ID_MANIFEST_TAG, records), records };
}

/** Every operation with x-payment-info: METHOD + SP + pathname, bytewise sorted, LF joined. */
export function paidRouteManifest(document) {
  const records = operationsOf(document).filter((row) => row.paid)
    .map(({ method, pathname }) => `${method} ${pathname}`).sort();
  return { count: records.length, digest: manifestDigest(PAID_ROUTE_MANIFEST_TAG, records), records };
}

// ---------------------------------------------------------------------------
// Terminal audit of the generated surface.
// ---------------------------------------------------------------------------

function auditPaidOperation(findings, method, route, operation, documentOpenApiVersion) {
  const label = `${method} ${route}`;
  const successSchema = operation.responses?.["200"]?.content?.["application/json"]?.schema;
  if (!isPlainObject(successSchema)) {
    findings.push({ code: "INVENTORY_DRIFT", message: `${label}: paid operation lost its formal 200 JSON response schema` });
  }
  if (method === "GET") {
    const exceptionApplies = publicSignatureExceptionApplies(label);
    const parameters = Array.isArray(operation.parameters) ? operation.parameters : [];
    for (const parameter of parameters.filter((entry) => isPlainObject(entry) && entry.in === "query" && entry.required === true)) {
      const name = String(parameter.name);
      if (isSensitiveExampleName(name, { allowPublicSolanaSignatureField: exceptionApplies })) {
        findings.push({ code: "CREDENTIAL_LIKE_KEY", message: `${label}: required query input ${safeKey(name, {})} is credential-like` });
      }
      if (exceptionApplies && name === PUBLIC_SOLANA_SIGNATURE_QUERY.field) {
        if (parameter.schema?.type !== "string" || parameter.schema.pattern !== PUBLIC_SOLANA_SIGNATURE_QUERY.schemaPattern) {
          findings.push({ code: "INVENTORY_DRIFT", message: `${label}: required query input ${name} must carry the canonical public Solana base58 schema` });
        }
      }
      const example = parameterExampleValue(parameter);
      if (example === undefined) {
        findings.push({ code: "INVENTORY_DRIFT", message: `${label}: required query input ${name} lost its accepted request example` });
      } else if (!isScalarQueryValue(example)) {
        findings.push({ code: "INVALID_SCHEMA_TYPE", message: `${label}: required query input ${name} example is not a non-empty scalar` });
      } else {
        if (hasUnresolvedTemplate(example)) findings.push({ code: "UNRESOLVED_TEMPLATE", message: `${label}: required query input ${name} example contains an unresolved template` });
        if (decodePlainStages(example).stages.some((stage) => isCredentialLikeValue(stage))) {
          findings.push({ code: "CREDENTIAL_LIKE_VALUE", message: `${label}: required query input ${name} example is credential-like` });
        }
        for (const f of credentialBearingUrlFindings(example, label)) findings.push(f);
      }
      for (const error of validateExampleAgainstSchema(example, parameter.schema, `$.${name}`, { documentOpenApiVersion })) {
        findings.push({ code: error.code, message: `${label}: required query input ${name}: ${error.message}` });
      }
    }
    return;
  }
  const mediaType = operation.requestBody?.content?.["application/json"];
  if (!isPlainObject(mediaType)) {
    findings.push({ code: "INVENTORY_DRIFT", message: `${label}: paid JSON-body POST lacks an application/json request body` });
    return;
  }
  if (!isPlainObject(mediaType.schema)) {
    findings.push({ code: "MISSING_SCHEMA", message: `${label}: JSON request body lacks a schema` });
  }
  const example = mediaType.example !== undefined
    ? mediaType.example
    : singletonExampleValue(mediaType.examples);
  if (example === undefined) {
    findings.push({ code: "INVENTORY_DRIFT", message: `${label}: JSON request body lost its accepted construction example` });
    return;
  }
  if (!isPlainObject(example)) {
    findings.push({ code: "INVALID_SCHEMA_TYPE", message: `${label}: JSON request body example is not an object` });
    return;
  }
  for (const unsafe of unsafeExampleFindings(example, label)) findings.push(unsafe);
  for (const error of validateExampleAgainstSchema(example, mediaType.schema, "$", { documentOpenApiVersion })) {
    findings.push({ code: error.code, message: `${label}: ${error.message}` });
  }
}

function paidMethodRoutesOf(document) {
  return operationsOf(document).filter((row) => row.paid)
    .map(({ method, pathname }) => `${method} ${pathname}`).sort();
}

/**
 * Generated-surface parity gate over EVERY generated paid operation. Returns
 * structured findings with closed-enum codes; an empty list means the surface
 * is fully example-, schema-, and safety-parity clean.
 */
export function collectOpenApiRequestExampleFindings({ document, actions, expectedPaidMethodRoutes: expectedRoutes } = {}) {
  if (!isPlainObject(document?.paths)) throw new Error("OpenAPI document is missing paths");
  const findings = [];
  const paidRoutes = paidMethodRoutesOf(document);
  for (const label of paidRoutes) {
    const [method, ...rest] = label.split(" ");
    const pathname = rest.join(" ");
    const operation = document.paths[pathname][method.toLowerCase()];
    auditPaidOperation(findings, method, pathname, operation, document.openapi);
  }
  if (expectedRoutes !== undefined) {
    const expected = [...expectedRoutes].sort();
    if (paidRoutes.length !== expected.length || paidRoutes.some((route, index) => route !== expected[index])) {
      findings.push({ code: "INVENTORY_DRIFT", message: `paid inventory drift: document has ${paidRoutes.length} method-routes but expected ${expected.length}` });
    }
  }
  if (actions !== undefined) {
    if (!Array.isArray(actions) || actions.length === 0) throw new Error("canonical paid actions are required");
    for (const action of actions) {
      const method = String(action?.method || "GET").toUpperCase();
      const route = typeof action?.route === "string" ? action.route : "";
      if (!paidRoutes.includes(`${method} ${route}`)) {
        findings.push({ code: "INVENTORY_DRIFT", message: `${method} ${route}: canonical catalog action missing from the generated paid surface` });
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// One continuous startup transaction (amendments 6-8, sections 9-10).
// ---------------------------------------------------------------------------

export const STARTUP_STAGES = Object.freeze([
  "MATERIALIZING", "POLICY_SCAN", "META_VALIDATE", "COMPILING",
  "PROJECTION", "TERMINAL_AUDIT", "INVENTORY_GATE",
  "OPERATION_ID_GATE", "CACHE_BIND", "PUBLISHED",
]);

const INJECTION_STAGES = new Map([
  ["materializing", "MATERIALIZING"], ["policy-scan", "POLICY_SCAN"], ["meta-validate", "META_VALIDATE"],
  ["compiling", "COMPILING"], ["projection", "PROJECTION"], ["terminal-audit", "TERMINAL_AUDIT"],
  ["inventory-gate", "INVENTORY_GATE"], ["operation-id-gate", "OPERATION_ID_GATE"], ["cache-bind", "CACHE_BIND"],
  // Not a G-class member: injected after the CACHE_BIND mutation, before
  // enter("PUBLISHED") and before any published pointer swap.
  ["after-cache-bind", "AFTER_CACHE_BIND"],
]);

const ROLLBACK_FAULTS = new Set(["unregister", "cache-restore"]);

/** Published startup state: replaced only by the one synchronous publish swap. */
let publishedStartup = null;

export function publishedStartupReceipt() {
  return publishedStartup === null ? null : {
    mode: publishedStartup.mode,
    profiles: Object.keys(publishedStartup.documents),
    dBoot: publishedStartup.dBoot,
    dCache: publishedStartup.dCache,
    prepared: { ...publishedStartup.dPrepared },
    published: { ...publishedStartup.dPublished },
    source: { ...publishedStartup.dSource },
    operationManifests: { ...publishedStartup.operationManifests },
    paidRouteManifests: { ...publishedStartup.paidRouteManifests },
    cacheEntries: publishedStartup.cacheEntries,
  };
}

const documentProfileOf = (profile) => (profile === "mpp" ? "mpp" : "agentcash");

/**
 * Run the complete two-document startup transaction:
 *
 *   MATERIALIZING -> POLICY_SCAN -> META_VALIDATE -> COMPILING
 *     -> PROJECTION -> TERMINAL_AUDIT -> INVENTORY_GATE
 *     -> OPERATION_ID_GATE -> CACHE_BIND -> PUBLISHED
 *
 * Both profiles finish each stage before either advances. Work happens on
 * off-side clones and a boot-local staged cache; PUBLISHED is exactly one
 * synchronous in-memory pointer swap of both prepared documents, authority
 * bindings, cache entries, and D_boot. Any failure enters ABORTED_ROLLBACK
 * with instrumentation still active: originals, the process cache, the empty
 * parity registry, and the prior published pointer all remain unchanged.
 *
 * The source documents are built by the injected builder (off-side clones are
 * made here); during collection the builder's synchronous projection defers
 * schema validation, recording every required authority instead. Compilation
 * is the async boundary; after CACHE_BIND the synchronous projection path
 * resolves every validator from the process cache.
 */
export async function prepareOpenApiParityStartup({
  buildDocument,
  documents: sourceDocuments,
  resolveRequestContract,
  circleGatewayEnabled = false,
  mode = circleGatewayEnabled ? "circle_enabled" : "circle_disabled",
  runNonce = `boot:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`,
  dependencyVersionReceipts,
  injectFailureAt,
  injectRollbackFault,
  injectTransactionBarrier,
  profiles = ["agentcash", "mpp"],
  expectedPaidRouteCounts,
} = {}) {
  if (!BOOT_MODES.includes(mode)) throw new Error(`unknown boot mode: ${mode}`);
  if (typeof resolveRequestContract !== "function") throw new Error("resolveRequestContract is required");
  if (injectFailureAt !== undefined && !INJECTION_STAGES.has(injectFailureAt)) throw new Error(`unknown injection stage: ${injectFailureAt}`);
  if (injectRollbackFault !== undefined && !ROLLBACK_FAULTS.has(injectRollbackFault)) throw new Error(`unknown rollback fault: ${injectRollbackFault}`);
  if (injectTransactionBarrier !== undefined && typeof injectTransactionBarrier !== "function") throw new Error("injectTransactionBarrier must be a function");
  const stageOf = (name) => {
    if (injectFailureAt === "after-cache-bind" && name === "AFTER_CACHE_BIND") {
      throw new ParityError("CACHE_TRANSACTION_ABORTED", "hostile injection after cache bind");
    }
    if (injectFailureAt !== undefined && INJECTION_STAGES.get(injectFailureAt) === name) {
      throw new ParityError(name === "CACHE_BIND" ? "CACHE_TRANSACTION_ABORTED" : "STARTUP_ABORTED", `hostile injection at ${name}`);
    }
  };
  const bootMode = mode;
  const trace = [];
  const enter = (stage) => {
    trace.push(stage);
    stageOf(stage);
  };

  // Amendment 9 section 6.1 / amendment 10 section 6: one exact transaction.
  // Snapshots preserve binding object identity, never clone validators. The
  // active-owner context is installed synchronously before MATERIALIZING so a
  // second call observes it without taking its own snapshot or writing state.
  if (transactionActive) {
    return {
      ok: false,
      aborted: true,
      stage: null,
      primaryCode: "CACHE_TRANSACTION_ABORTED",
      stages: [],
      rollback: {
        stagedDiscarded: 0,
        processCacheUnchanged: liveCacheMatches(processValidatorCache, activeOwner.cacheSnapshot),
        sourceDigestsReproduced: true,
        parityRegistryEmpty: parityRegistryUris().length === 0,
        publishedPointerUnchanged: publishedStartup === activeOwner.publishedBefore,
      },
    };
  }
  const cacheSnapshot = new Map(processValidatorCache);
  const registrySnapshot = Object.freeze([...parityRegistryUris()]);
  const publishedBefore = publishedStartup;
  transactionActive = true;
  activeOwner = { cacheSnapshot, registrySnapshot, publishedBefore };
  let sources;
  const dSource = {};

  try {
    if (parityRegistryUris().length > 0) throw new ParityError("REGISTRY_NOT_EMPTY", "boot entry");
    // MATERIALIZING: build/source both documents (off-side clones) and
    // safe-materialize them. During the collection pass the synchronous
    // projection defers schema validation, recording every required
    // authority instead.
    enter("MATERIALIZING");
    sources = {};
    if (sourceDocuments !== undefined) {
      for (const profile of profiles) {
        const key = documentProfileOf(profile);
        if (!isPlainObject(sourceDocuments[key]?.paths)) throw new Error(`source document missing paths: ${key}`);
        sources[key] = structuredClone(sourceDocuments[key]);
      }
      collectingAuthority = true;
      try {
        for (const profile of profiles) collectOpenApiRequestExampleFindings({ document: sources[documentProfileOf(profile)] });
      } finally {
        collectingAuthority = false;
      }
    } else {
      if (typeof buildDocument !== "function") throw new Error("buildDocument or documents is required");
      collectingAuthority = true;
      try {
        for (const profile of profiles) {
          const key = documentProfileOf(profile);
          sources[key] = buildDocument(key);
          if (!isPlainObject(sources[key]?.paths)) throw new Error(`buildDocument(${key}) returned a document without paths`);
        }
      } finally {
        collectingAuthority = false;
      }
    }
    const materializedSources = {};
    for (const profile of profiles) {
      const key = documentProfileOf(profile);
      const materialized = materializeSafe(sources[key], "document");
      materializedSources[key] = materialized;
      dSource[key] = taggedDigest("x402-parity/source-doc/v1", bootMode, key, canonicalSha256(materialized));
    }

    // POLICY_SCAN: keyword policy + privacy scan over materialized documents.
    // Amendment 9 section 10: the walk visits EVERY materialized object and
    // array (not only nodes already carrying $schema/$id/$ref), applying the
    // complete frozen policy-keyword set, cycle-safe via a WeakSet.
    enter("POLICY_SCAN");
    const policyFindings = [];
    const seenNodes = new WeakSet();
    const scanSchemaTrees = (node, at) => {
      if (node === null || typeof node !== "object") return;
      if (seenNodes.has(node)) return;
      seenNodes.add(node);
      if (isPlainObject(node)) {
        // A9 section 10: no subtree re-materialization during POLICY_SCAN.
        for (const f of schemaPolicyFindings(node)) policyFindings.push({ at, code: f.code });
      }
      for (const [key, entry] of Object.entries(node)) {
        if (entry !== null && typeof entry === "object") scanSchemaTrees(entry, `${at}.${key}`);
      }
    };
    for (const profile of profiles) scanSchemaTrees(materializedSources[documentProfileOf(profile)], documentProfileOf(profile));
    if (policyFindings.length > 0) throw new ParityError("POLICY_KEYWORD_REJECTED", "policy scan rejected a document keyword");

    // Version authority receipts (no Phase-C I/O: receipts are passed in).
    if (dependencyVersionReceipts !== undefined) {
      const expected = { manifest: PARITY_RUNTIME_VERSION, lock: PARITY_RUNTIME_VERSION, resolved: PARITY_RUNTIME_VERSION, ...dependencyVersionReceipts };
      if (expected.manifest !== PARITY_RUNTIME_VERSION || expected.lock !== PARITY_RUNTIME_VERSION || expected.resolved !== PARITY_RUNTIME_VERSION) {
        throw new ParityError("VERSION_AUTHORITY_DRIFT", "installed validator version differs from PV");
      }
    }

    // META_VALIDATE + COMPILING: the async Hyperjump boundary. Compilation
    // meta-validates every required schema under its exact dialect; only the
    // immutable compiled validators and bindings are retained.
    enter("META_VALIDATE");
    const missing = [...pendingAuthority.entries()].filter(([dAuth]) => !processValidatorCache.has(dAuth) && !stagedValidatorCache.has(dAuth));
    const unionSize = new Set([...processValidatorCache.keys(), ...stagedValidatorCache.keys(), ...missing.map(([dAuth]) => dAuth)]).size;
    if (unionSize > CACHE_BUDGET) throw new ParityError("CACHE_BUDGET_EXCEEDED", `union ${unionSize} exceeds ${CACHE_BUDGET}`);
    if (injectTransactionBarrier !== undefined) await injectTransactionBarrier();
    const compiled = [];
    for (const [dAuth, spec] of missing) {
      const { validator } = await compileSchemaAuthority(spec.materializedSchema, spec.runtimeDialect, dAuth, runNonce);
      compiled.push({ dAuth, spec, validator });
      assertParityRegistryEmpty("after miss compilation");
    }
    enter("COMPILING");
    for (const { dAuth, spec, validator } of compiled) {
      stagedValidatorCache.set(dAuth, { validator, exactDialect: spec.exactDialect, pv: PARITY_RUNTIME_VERSION });
    }

    // PROJECTION: produce the prepared documents. For builder-driven boots
    // the builder re-runs its synchronous projection with every schema
    // authority resolving from the staged cache; for direct documents the
    // off-side clones above are already the prepared side.
    enter("PROJECTION");
    let preparedDocuments;
    if (sourceDocuments !== undefined) {
      preparedDocuments = sources;
    } else {
      preparedDocuments = {};
      for (const profile of profiles) preparedDocuments[documentProfileOf(profile)] = buildDocument(documentProfileOf(profile));
    }

    // TERMINAL_AUDIT: read-only audit of the prepared documents.
    enter("TERMINAL_AUDIT");
    const audit = {};
    for (const profile of profiles) {
      const key = documentProfileOf(profile);
      const findings = collectOpenApiRequestExampleFindings({ document: preparedDocuments[key] });
      if (findings.length > 0) audit[key] = findings;
    }
    if (Object.keys(audit).length > 0) throw new ParityError("INSTANCE_VALIDATION_FAILED", "terminal audit findings");
    const dPrepared = {};
    for (const profile of profiles) {
      const key = documentProfileOf(profile);
      dPrepared[key] = taggedDigest("x402-parity/prepared-doc/v1", bootMode, key, canonicalSha256(materializeSafe(preparedDocuments[key], "document")));
    }

    // INVENTORY_GATE: exact enabled paid-route inventory per profile.
    enter("INVENTORY_GATE");
    const paidRouteManifests = {};
    for (const profile of profiles) {
      const key = documentProfileOf(profile);
      const manifest = paidRouteManifest(preparedDocuments[key]);
      const expectedCount = expectedPaidRouteCounts !== undefined && Object.hasOwn(expectedPaidRouteCounts, key)
        ? expectedPaidRouteCounts[key]
        : expectedEnabledSurfaceCount(key, circleGatewayEnabled);
      if (manifest.count !== expectedCount) {
        throw new ParityError("INVENTORY_DRIFT", `${key}: ${manifest.count} paid routes but expected ${expectedCount}`);
      }
      paidRouteManifests[key] = manifest;
    }

    // OPERATION_ID_GATE: unique stable operation IDs per document.
    enter("OPERATION_ID_GATE");
    const operationManifests = {};
    for (const profile of profiles) {
      const key = documentProfileOf(profile);
      operationManifests[key] = operationIdManifest(preparedDocuments[key]);
    }

    // CACHE_BIND: commit the staged cache into the process cache. New
    // bindings are frozen ordinary records; existing bindings are never
    // overwritten or mutated in place.
    enter("CACHE_BIND");
    for (const [dAuth, entry] of stagedValidatorCache) {
      if (!processValidatorCache.has(dAuth)) processValidatorCache.set(dAuth, Object.freeze({ validator: entry.validator, exactDialect: entry.exactDialect, pv: PARITY_RUNTIME_VERSION }));
    }
    stagedValidatorCache.clear();
    pendingAuthority.clear();
    const dCache = cacheManifestSnapshot();
    const dBoot = taggedDigest(
      "x402-parity/boot/v1", bootMode, PARITY_RUNTIME_VERSION,
      dPrepared.agentcash ?? hexOf(sha256(Buffer.alloc(32))), dPrepared.mpp ?? hexOf(sha256(Buffer.alloc(32))), dCache,
      operationManifests.agentcash?.digest ?? "", operationManifests.mpp?.digest ?? "",
      paidRouteManifests.agentcash?.digest ?? "", paidRouteManifests.mpp?.digest ?? "",
    );

    // After-cache-bind hostile injection point (A9 6.7): not a G-class
    // member; throws after the bind mutation, before PUBLISHED and before
    // any published pointer swap.
    stageOf("AFTER_CACHE_BIND");

    // The R_parity assert moves inside the transactional try (A9 section 6):
    // a leftover owned URI after the bind is an aborted receipt with last
    // stage CACHE_BIND, never an uncaught throw.
    if (parityRegistryUris().length > 0) throw new ParityError("REGISTRY_NOT_EMPTY", "after cache bind");

    // PUBLISHED: exactly one synchronous in-memory pointer swap.
    enter("PUBLISHED");
    const publishedDocuments = Object.freeze({ ...preparedDocuments });
    const cacheEntries = Object.freeze([...processValidatorCache.keys()].sort());
    publishedStartup = {
      mode: bootMode,
      documents: publishedDocuments,
      dSource,
      dPrepared,
      dPublished: { ...dPrepared },
      dCache,
      dBoot,
      operationManifests,
      paidRouteManifests,
      cacheEntries,
      publishedAt: Date.now(),
    };
    transactionActive = false;
    activeOwner = null;
    return {
      ok: true,
      mode: bootMode,
      stages: trace,
      compiledNew: compiled.length,
      receipts: publishedStartupReceipt(),
      registryEmpty: true
    };
  } catch (error) {
    const rollbackReceipt = runAbortedRollback({
      error,
      cacheSnapshot,
      registrySnapshot,
      publishedBefore,
      trace,
      sourcesRef: () => sources,
      dSource,
      bootMode,
      profiles,
      injectRollbackFault,
    });
    return rollbackReceipt;
  }
}

/**
 * Amendment 9 sections 6.3-6.5 / amendment 10 section 5 exact restore and
 * measurement algorithm. Total: never throws out of the catch path. The
 * original stage failure always determines primaryCode; the five public
 * rollback flags are live measurements taken after the restore attempts.
 */
function runAbortedRollback({ error, cacheSnapshot, registrySnapshot, publishedBefore, trace, sourcesRef, dSource, bootMode, profiles, injectRollbackFault }) {
  try {
    collectingAuthority = false;

    // Staged/pending discard.
    let stagedDiscarded = stagedValidatorCache.size;
    stagedValidatorCache.clear();
    pendingAuthority.clear();

    // Cache restore toward the snapshot. With injectRollbackFault
    // "cache-restore", the harness fault throws exactly once after the first
    // successful real mutation (delete or set); remaining restoration is not
    // retried and does not continue.
    let restoreFaultInjected = false;
    const injectedRestoreThrow = () => {
      if (injectRollbackFault !== "cache-restore" || restoreFaultInjected) return;
      restoreFaultInjected = true;
      throw new Error("injected rollback cache-restore fault");
    };
    try {
      for (const key of [...processValidatorCache.keys()]) {
        if (!cacheSnapshot.has(key)) {
          processValidatorCache.delete(key);
          injectedRestoreThrow();
        }
      }
      for (const [k, v] of cacheSnapshot) {
        if (processValidatorCache.get(k) !== v) {
          processValidatorCache.set(k, v);
          injectedRestoreThrow();
        }
      }
    } catch (restoreError) {
      if (!(injectRollbackFault === "cache-restore" && restoreError.message === "injected rollback cache-restore fault")) throw restoreError;
      // Harness fault consumed: do not retry, do not continue restoration.
    }

    // Registry ownership: unregister only URIs absent from the snapshot that
    // begin the parity prefix. Each unregister is individually best-effort;
    // with injectRollbackFault "unregister" the first throws once and the
    // loop continues.
    const owned = parityRegistryUris().filter((uri) => !registrySnapshot.includes(uri));
    let unregisterFaultInjected = false;
    let unregistered = 0;
    for (const uri of owned.slice(0, 128)) {
      try {
        if (injectRollbackFault === "unregister" && !unregisterFaultInjected) {
          unregisterFaultInjected = true;
          throw new Error("injected rollback unregister fault");
        }
        unregisterSchema(uri);
        unregistered += 1;
      } catch {
        // Continue on failure; leftover owned URIs remain and are measured.
      }
    }

    // Independent source reproduction measurement.
    let sourceDigestsReproduced = true;
    const sources = sourcesRef();
    if (sources !== undefined) {
      for (const profile of profiles) {
        const key = documentProfileOf(profile);
        try {
          const again = taggedDigest("x402-parity/source-doc/v1", bootMode, key, canonicalSha256(materializeSafe(sources[key], "document")));
          if (dSource[key] !== undefined && again !== dSource[key]) sourceDigestsReproduced = false;
        } catch {
          sourceDigestsReproduced = false;
        }
      }
    }

    // Live measurements after all restore attempts.
    const processCacheUnchanged = liveCacheMatches(processValidatorCache, cacheSnapshot);
    const parityRegistryEmpty = parityRegistryUris().length === 0;
    const publishedPointerUnchanged = publishedStartup === publishedBefore;
    const primaryCode = error instanceof ParityError ? error.code : "STARTUP_ABORTED";
    void unregistered;
    return {
      ok: false,
      aborted: true,
      stage: trace[trace.length - 1] ?? null,
      primaryCode,
      stages: trace,
      rollback: {
        stagedDiscarded,
        processCacheUnchanged,
        sourceDigestsReproduced,
        parityRegistryEmpty,
        publishedPointerUnchanged,
      },
    };
  } finally {
    transactionActive = false;
    activeOwner = null;
  }
}

/** Test-only: drop the process cache and published pointer (restores a pristine child/process).
 * Amendment 10 section 6: a test reset must never clear in-flight state — it
 * rejects while an owner is active. */
export function resetParityAuthorityForTests() {
  if (transactionActive || activeOwner !== null) {
    throw new Error("parity transaction in flight: resetParityAuthorityForTests refused");
  }
  processValidatorCache.clear();
  stagedValidatorCache.clear();
  pendingAuthority.clear();
  rejectedAuthority.clear();
  publishedStartup = null;
}

/** Test-only: the current parity registry snapshot (R_parity). */
export function parityRegistrySnapshot() {
  return parityRegistryUris();
}

// Amendment 9 section 6.6 / amendment 10 section 5-7 harness-only readers.
// Production server.js must not call these.
export function processCacheEntry(dAuth) {
  return processValidatorCache.get(dAuth);
}
export function processCacheKeys() {
  return [...processValidatorCache.keys()].sort();
}

/**
 * Strict post-discovery-registration, pre-listen generation gate. Both public
 * documents are audited against the exact paid inventories derived from the
 * actually enabled mounted surfaces (25 AgentCash method-routes with the
 * Circle gateway enabled, 24 with it disabled; 24 MPP). Requires the startup
 * preparation to have published authority bindings: without them every schema
 * validation fails closed. Any drift fails startup instead of serving a
 * drifted document.
 */
export function assertGeneratedOpenApiSurfaceGate({ documents, circleGatewayEnabled = false, resolveRequestContract } = {}) {
  if (!isPlainObject(documents)) throw new Error("generated OpenAPI documents are required");
  if (typeof resolveRequestContract !== "function") throw new Error("resolveRequestContract is required");
  const problems = [];
  for (const profile of ["agentcash", "mpp"]) {
    const document = documents[profile];
    if (!isPlainObject(document?.paths)) {
      problems.push(`${profile}: OpenAPI document is missing paths`);
      continue;
    }
    const expected = expectedPaidMethodRoutes({ profile, circleGatewayEnabled });
    const expectedCount = expectedEnabledSurfaceCount(profile, circleGatewayEnabled);
    if (expected.length !== expectedCount) {
      problems.push(`${profile}: canonical expected inventory is ${expectedCount} method-routes but resolved to ${expected.length}`);
    }
    for (const label of expected) {
      if (!resolveCanonicalRequestContract(label, resolveRequestContract)) {
        problems.push(`${profile}: ${label}: missing canonical request contract`);
      }
    }
    for (const f of collectOpenApiRequestExampleFindings({ document, expectedPaidMethodRoutes: expected })) {
      problems.push(`${profile}: ${f.code}: ${f.message}`);
    }
  }
  if (problems.length) {
    throw new Error(`generated OpenAPI surface generation gate failed:\n- ${problems.join("\n- ")}`);
  }
  return {
    ok: true,
    circleGatewayEnabled,
    agentcash: expectedEnabledSurfaceCount("agentcash", circleGatewayEnabled),
    mpp: expectedEnabledSurfaceCount("mpp", circleGatewayEnabled),
  };
}

// ---------------------------------------------------------------------------
// Stable hostile-probe manifest and exhaustive primary mapping (sections 11-12).
// ---------------------------------------------------------------------------

const crossProduct = (...lists) => lists.reduce((acc, list) => acc.flatMap((a) => list.map((b) => [...a, b])), [[]]);

export const HOSTILE_PROBE_CLASSES = Object.freeze({
  A: crossProduct(
    "properties-array,prefixItems-object,additionalProperties-number,defs-array,minLength-string,required-string,enum-string,dependentRequired-array,multipleOf-string,minItems-negative".split(","),
    "get-query,post-json".split(","),
    "projection,terminal".split(","),
  ),
  B: crossProduct(
    "properties-array,required-string,nullable-string,items-array,prefixItems-array,type-array".split(","),
    "get-query,post-json".split(","),
    "projection,terminal".split(","),
  ),
  C: crossProduct("oas30-nested-oas31-schema,oas31-nullable-semantics,unsupported-jsonSchemaDialect".split(","), "projection,terminal".split(",")),
  D: crossProduct(
    "url-query-key,url-query-value,object-root-key,object-root-value,object-nested-key,object-nested-value,array-value,schema-property-key,schema-required-value,schema-const-value,schema-enum-value,userinfo,host,path,fragment,nested-url,validator-instance,proxy-error,accessor-error".split(","),
    "raw,percent1,percent2".split(","),
  ),
  E: "depth-at,depth-over,nodes-at,nodes-over,keys-at,keys-over,string-at,string-over,sparse-hole,array-noncanonical-index,array-extra-string-key,symbol-key,nonenumerable-data,direct-cycle,mutual-cycle,repeated-alias,ordinary-proxy,revoked-proxy,getter-uncalled,setter-uncalled,trap-ownKeys-zero,trap-getOwnPropertyDescriptor-zero,trap-get-zero,trap-getPrototypeOf-zero,custom-prototype,own-toJSON,own-valueOf,own-toString,own-symbolToPrimitive,mutation-during-walk,nan-rejected,infinity-rejected".split(","),
  F: "direct-dependency,lock-integrity,packed-import-oas30,packed-import-oas31,packed-import-formats,old-validator-parity-unreachable,private-walker-absent,hostile-ref-zero-fetch,synthetic-registry-empty,package-metas-preserved,tarball-exclusions,version-authority".split(","),
  G: "materializing,policy-scan,meta-validate,compiling,projection,terminal-audit,inventory-gate,operation-id-gate,cache-bind".split(","),
  H: "schema-mutation-mismatch,canonical-key-order-equal,package-version-diff,boot-cache-hit-no-urn,duplicate-registration-collision,cache-budget-128,cache-budget-129-reject,synthetic-registry-empty".split(","),
  I: "default-agentcash,default-mpp,circle-disabled-agentcash,circle-disabled-mpp".split(","),
  J: "raw-path-percent25-clean,raw-query-percent25-clean,raw-malformed-ZZ,raw-truncated-2,raw-invalid-utf8-80,raw-double-percent,raw-percent-u,transport1-percent25-clean,transport2-percent25-clean,decoded-prose-bare-percent-clean,transport1-encoded-malformed,transport2-encoded-malformed".split(","),
  K: "default-25-of-25,circle-disabled-24-of-24".split(","),
  L: "finding-cap-128,deterministic-order".split(","),
  M: "oas30-nested-schema,oas31-draft07,oas31-draft2019,oas31-custom,malformed-openapi-version,unsupported-jsonSchemaDialect,ref-key-inside-const-enum".split(","),
  N: [...crossProduct("oas30,oas31".split(","), "ipv4,uri,date-time".split(","), "positive,negative".split(",")), ...crossProduct("oas30,oas31".split(","), ["unknown-format"])],
  O: crossProduct("fetch,http-request,https-request,dns-lookup,fs-read,net-connect,process-env,credential-sentinel".split(","), "sensitivity,target-zero".split(",")),
  P: "source-digest-stable-on-failure,prepared-digest-changes-on-projection,published-digest-equals-prepared,original-digest-unchanged,cache-manifest-exact,boot-digest-default,boot-digest-circle-disabled,second-boot-cache-hit,cache-transaction-rollback,digest-stage-order-acyclic".split(","),
});

/** The 255 stable hostile-probe IDs, bytewise sorted. */
export function hostileProbeIds() {
  const ids = [];
  for (const [cls, members] of Object.entries(HOSTILE_PROBE_CLASSES)) {
    for (const member of members) ids.push(`R5.${cls}.${[].concat(member).join(".")}`);
  }
  ids.sort();
  return ids;
}

export const HOSTILE_PROBE_MANIFEST_DIGEST = "a81eea07513c5d7f91a380a7a8576414cd9ccf741f3263658ea2a2a80b106e39";

/** manifestDigest = SHA-256(tag + 0x00 + sorted IDs joined by LF). */
export function hostileProbeManifestDigest(ids) {
  return hexOf(sha256(Buffer.concat([utf8("x402-parity/hostile-probe-manifest/v2"), Buffer.from([0]), utf8([...ids].sort().join("\n"))])));
}

const MAP_D_KEY = new Set(["url-query-key", "object-root-key", "object-nested-key", "schema-property-key", "schema-required-value"]);
const MAP_D_VALUE = new Set(["url-query-value", "object-root-value", "object-nested-value", "array-value", "schema-const-value", "schema-enum-value", "host", "path", "nested-url", "validator-instance"]);
const MAP_E_PROXY = new Set(["ordinary-proxy", "revoked-proxy", "trap-ownKeys-zero", "trap-getOwnPropertyDescriptor-zero", "trap-get-zero", "trap-getPrototypeOf-zero"]);
const MAP_J_MALFORMED = new Set(["raw-malformed-ZZ", "raw-truncated-2", "raw-invalid-utf8-80", "raw-double-percent", "raw-percent-u", "transport1-encoded-malformed", "transport2-encoded-malformed"]);

/** The exhaustive expectedPrimaryCode mapping: one closed-enum code or literal null per ID. */
export function expectedPrimaryCode(id) {
  const tail = id.slice(3);
  const dot = tail.indexOf(".");
  const cls = tail.slice(0, dot);
  const member = tail.slice(dot + 1);
  if (cls === "A" || cls === "B") return "META_VALIDATION_FAILED";
  if (cls === "C") {
    if (member.startsWith("oas30-nested-oas31-schema")) return "NESTED_DIALECT_REJECTED";
    if (member.startsWith("oas31-nullable-semantics")) return "INSTANCE_VALIDATION_FAILED";
    return "DIALECT_REJECTED";
  }
  if (cls === "D") {
    const lastDot = member.lastIndexOf(".");
    const surface = member.slice(0, lastDot);
    if (MAP_D_KEY.has(surface)) return "CREDENTIAL_LIKE_KEY";
    if (MAP_D_VALUE.has(surface)) return "CREDENTIAL_LIKE_VALUE";
    if (surface === "userinfo") return "USERINFO_CREDENTIALS";
    if (surface === "fragment") return "FRAGMENT_CHANNEL";
    if (surface === "proxy-error") return "PROXY_REJECTED";
    if (surface === "accessor-error") return "ACCESSOR_REJECTED";
  }
  if (cls === "E") {
    if (member === "depth-at" || member === "nodes-at" || member === "keys-at" || member === "string-at") return null;
    if (member === "depth-over") return "DEPTH_EXCEEDED";
    if (member === "nodes-over") return "NODE_BUDGET_EXCEEDED";
    if (member === "keys-over") return "KEY_BUDGET_EXCEEDED";
    if (member === "string-over") return "STRING_BUDGET_EXCEEDED";
    if (member === "sparse-hole") return "SPARSE_ARRAY_REJECTED";
    if (member === "array-noncanonical-index" || member === "array-extra-string-key") return "NON_CANONICAL_ARRAY_PROPERTY";
    if (member === "symbol-key") return "SYMBOL_KEY_REJECTED";
    if (member === "nonenumerable-data") return "NON_ENUMERABLE_PROPERTY";
    if (member === "direct-cycle" || member === "mutual-cycle") return "CYCLE_REJECTED";
    if (member === "repeated-alias") return "ALIAS_REJECTED";
    if (MAP_E_PROXY.has(member)) return "PROXY_REJECTED";
    if (member === "getter-uncalled" || member === "setter-uncalled") return "ACCESSOR_REJECTED";
    if (member === "custom-prototype") return "UNSUPPORTED_PROTOTYPE";
    if (member === "own-toJSON") return "TOJSON_REJECTED";
    if (member === "own-valueOf" || member === "own-toString" || member === "own-symbolToPrimitive") return "COERCION_HOOK_REJECTED";
    if (member === "mutation-during-walk") return "MUTATION_DURING_MATERIALIZATION";
    if (member === "nan-rejected" || member === "infinity-rejected") return "UNSUPPORTED_VALUE";
  }
  if (cls === "F") return member === "hostile-ref-zero-fetch" ? "POLICY_KEYWORD_REJECTED" : null;
  if (cls === "G") return member === "cache-bind" ? "CACHE_TRANSACTION_ABORTED" : "STARTUP_ABORTED";
  if (cls === "H") {
    if (member === "schema-mutation-mismatch") return "CACHE_IDENTITY_MISMATCH";
    if (member === "package-version-diff") return "VERSION_AUTHORITY_DRIFT";
    if (member === "duplicate-registration-collision") return "REGISTRY_IDENTITY_COLLISION";
    if (member === "cache-budget-129-reject") return "CACHE_BUDGET_EXCEEDED";
    return null;
  }
  if (cls === "I" || cls === "K" || cls === "O") return null;
  if (cls === "J") return MAP_J_MALFORMED.has(member) ? "MALFORMED_PERCENT" : null;
  if (cls === "L") return member === "finding-cap-128" ? "FINDING_CAP_REACHED" : null;
  if (cls === "M") {
    if (member === "oas30-nested-schema") return "NESTED_DIALECT_REJECTED";
    if (member === "malformed-openapi-version") return "UNSUPPORTED_OAS_VERSION";
    if (member === "ref-key-inside-const-enum") return "POLICY_KEYWORD_REJECTED";
    return "DIALECT_REJECTED";
  }
  if (cls === "N") return member.startsWith("oas30.") && member.endsWith(".negative") ? "INSTANCE_VALIDATION_FAILED" : null;
  if (cls === "P") {
    if (member === "source-digest-stable-on-failure") return "STARTUP_ABORTED";
    if (member === "cache-transaction-rollback") return "CACHE_TRANSACTION_ABORTED";
    return null;
  }
  throw new Error(`UNMAPPED_HOSTILE_ID:${id}`);
}

export const HOSTILE_PRIMARY_MAP_DIGEST = "23e3eef7b8af70525fa3b670fc87ce4f4161df0a035f7f6069ba29f9a7278df3";

/** Sorted records ID + 0x00 + (code or "null"), LF joined, tagged SHA-256. */
export function hostilePrimaryMapDigest(ids) {
  const records = [...ids].sort().map((id) => `${id}\0${expectedPrimaryCode(id) ?? "null"}`);
  return hexOf(sha256(Buffer.concat([utf8("x402-parity/hostile-primary-code-map/v1"), Buffer.from([0]), utf8(records.join("\n"))])));
}

// Shared hostile-probe receipt: every stable ID recorded exactly once. A
// skipped, duplicate, vacuous, or unexecuted branch is TEST_MANIFEST_DRIFT.
const hostileReceipt = new Map();

export function recordHostileProbe(id, { expected, actual, evidence } = {}) {
  if (hostileReceipt.has(id)) throw new ParityError("TEST_MANIFEST_DRIFT", `duplicate hostile probe ${id}`);
  hostileReceipt.set(id, { expected: expected ?? null, actual: actual ?? null, evidence: evidence ?? null });
}

export function hostileProbeReceiptSnapshot() {
  return { ids: [...hostileReceipt.keys()].sort(), count: hostileReceipt.size };
}

/** Raw registered schema URI list (package meta-schemas included). */
export function allRegisteredSchemaUris() {
  return [...getAllRegisteredSchemaUris()].sort();
}

export { JSON_SCHEMA_2020_12 };
