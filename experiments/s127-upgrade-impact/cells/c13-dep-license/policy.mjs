/**
 * SPDX allow/deny and reuse-gate for S127 upgrade-impact.
 * Permissive licenses only. GPL/AGPL/LGPL never enter recommend/optional.
 */

export const SCHEMA_ID = "s127.c13.dep-license.policy.v1";

export const ALLOWED_SPDX = Object.freeze([
  "MIT",
  "MIT-0",
  "Apache-2.0",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "Unlicense",
  "CC0-1.0",
  "BlueOak-1.0.0",
]);

export const DENIED_SPDX = Object.freeze([
  "GPL-2.0",
  "GPL-2.0-only",
  "GPL-2.0-or-later",
  "GPL-3.0",
  "GPL-3.0-only",
  "GPL-3.0-or-later",
  "AGPL-3.0",
  "AGPL-3.0-only",
  "AGPL-3.0-or-later",
  "LGPL-2.0",
  "LGPL-2.0-only",
  "LGPL-2.0-or-later",
  "LGPL-2.1",
  "LGPL-2.1-only",
  "LGPL-2.1-or-later",
  "LGPL-3.0",
  "LGPL-3.0-only",
  "LGPL-3.0-or-later",
  "SSPL-1.0",
  "BUSL-1.1",
  "Commons-Clause",
  "CC-BY-NC-4.0",
  "UNLICENSED",
]);

const ALLOWED = new Set(ALLOWED_SPDX);
const DENIED = new Set(DENIED_SPDX);

export const SHIPPABLE_DECISIONS = Object.freeze(["recommend", "optional"]);
export const ALL_DECISIONS = Object.freeze([
  "recommend",
  "optional",
  "do_not_add",
  "unknown",
]);

export const PROVENANCE_LABELS = Object.freeze([
  "fixture",
  "live-capture",
  "synthetic",
]);

const COPYLEFT_ID = /^(AGPL|GPL|LGPL)(-|$)/i;
const PROPRIETARY_HINT = /proprietary|commercial license|self-hosted license/i;

export function normalizeSpdxId(id) {
  if (typeof id !== "string") return "";
  return id.trim();
}

export function classifyIdentifier(id) {
  const ident = normalizeSpdxId(id);
  if (!ident) return "unknown";
  if (ALLOWED.has(ident)) return "allowed";
  if (DENIED.has(ident)) return "denied";
  if (COPYLEFT_ID.test(ident)) return "denied";
  if (/^SSPL/i.test(ident) || /^BUSL/i.test(ident)) return "denied";
  return "unknown";
}

/**
 * Parse a restricted SPDX expression: identifiers, AND, OR, wrapping parens.
 * Does not implement WITH exceptions or user-defined licenses.
 */
export function parseSpdx(expr) {
  if (expr == null || expr === "") {
    return {
      class: "unknown",
      identifiers: [],
      chosen: null,
      reasons: ["missing-license"],
    };
  }
  const trimmed = String(expr).trim();
  if (/^SEE LICENSE IN\b/i.test(trimmed)) {
    return {
      class: "unknown",
      identifiers: [],
      chosen: null,
      reasons: ["see-license-in-file"],
      raw: trimmed,
    };
  }

  let tokens;
  try {
    tokens = tokenizeSpdx(trimmed);
  } catch (err) {
    return {
      class: "unknown",
      identifiers: [],
      chosen: null,
      reasons: ["unparsed-spdx", err.message],
      raw: trimmed,
    };
  }

  const parsed = parseOr(tokens);
  if (tokens.length) {
    return {
      class: "unknown",
      identifiers: collectIds(parsed),
      chosen: null,
      reasons: ["trailing-spdx-tokens"],
      raw: trimmed,
    };
  }
  return reduceExpr(parsed);
}

function tokenizeSpdx(src) {
  const out = [];
  const re = /\s+|\(|\)|AND|OR|[A-Za-z0-9.+-]+/g;
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    if (m.index !== last) {
      throw new Error(`unexpected-spdx-at-${last}`);
    }
    last = m.index + m[0].length;
    const t = m[0];
    if (/^\s+$/.test(t)) continue;
    out.push(t);
  }
  if (last !== src.length) throw new Error("unparsed-spdx-tail");
  return out;
}

function parseOr(tokens) {
  let left = parseAnd(tokens);
  while (tokens[0] === "OR") {
    tokens.shift();
    left = { op: "OR", left, right: parseAnd(tokens) };
  }
  return left;
}

function parseAnd(tokens) {
  let left = parsePrimary(tokens);
  while (tokens[0] === "AND") {
    tokens.shift();
    left = { op: "AND", left, right: parsePrimary(tokens) };
  }
  return left;
}

function parsePrimary(tokens) {
  if (tokens[0] === "(") {
    tokens.shift();
    const inner = parseOr(tokens);
    if (tokens.shift() !== ")") throw new Error("missing-close-paren");
    return inner;
  }
  const id = tokens.shift();
  if (!id || id === "AND" || id === "OR" || id === ")") {
    throw new Error("expected-spdx-id");
  }
  return { op: "ID", id };
}

function collectIds(node, acc = []) {
  if (!node) return acc;
  if (node.op === "ID") {
    acc.push(node.id);
    return acc;
  }
  collectIds(node.left, acc);
  collectIds(node.right, acc);
  return acc;
}

function reduceExpr(node) {
  if (node.op === "ID") {
    const cls = classifyIdentifier(node.id);
    return {
      class: cls,
      identifiers: [node.id],
      chosen: cls === "allowed" ? node.id : null,
      reasons: cls === "denied" ? [`denied:${node.id}`] : cls === "unknown" ? [`unknown:${node.id}`] : [],
    };
  }

  const left = reduceExpr(node.left);
  const right = reduceExpr(node.right);
  const identifiers = [...left.identifiers, ...right.identifiers];

  if (node.op === "OR") {
    if (left.class === "allowed") {
      return {
        class: "allowed",
        identifiers,
        chosen: left.chosen,
        reasons: uniq([
          ...left.reasons.filter((r) => r.startsWith("dual-")),
          ...right.reasons.filter((r) => r.startsWith("denied:")),
          right.class === "denied" ? "dual-license-choose-permissive" : null,
        ]),
      };
    }
    if (right.class === "allowed") {
      return {
        class: "allowed",
        identifiers,
        chosen: right.chosen,
        reasons: uniq([
          ...right.reasons.filter((r) => r.startsWith("dual-")),
          ...left.reasons.filter((r) => r.startsWith("denied:")),
          left.class === "denied" ? "dual-license-choose-permissive" : null,
        ]),
      };
    }
    if (left.class === "denied" && right.class === "denied") {
      return {
        class: "denied",
        identifiers,
        chosen: null,
        reasons: uniq([...left.reasons, ...right.reasons]),
      };
    }
    return {
      class: "unknown",
      identifiers,
      chosen: null,
      reasons: uniq([...left.reasons, ...right.reasons, "or-unresolved"]),
    };
  }

  // AND: every conjunct must be allowed.
  if (left.class === "denied" || right.class === "denied") {
    return {
      class: "denied",
      identifiers,
      chosen: null,
      reasons: uniq([...left.reasons, ...right.reasons, "and-contains-denied"]),
    };
  }
  if (left.class === "unknown" || right.class === "unknown") {
    return {
      class: "unknown",
      identifiers,
      chosen: null,
      reasons: uniq([...left.reasons, ...right.reasons, "and-contains-unknown"]),
    };
  }
  return {
    class: "allowed",
    identifiers,
    chosen: left.chosen,
    reasons: uniq([...left.reasons, ...right.reasons]),
  };
}

function uniq(items) {
  return [...new Set(items.filter(Boolean))];
}

export function effectiveLicenseExpr(entry) {
  if (entry.effectiveSpdx) return entry.effectiveSpdx;
  if (entry.licenseFileSpdx) return entry.licenseFileSpdx;
  return entry.licenseSpdx ?? null;
}

/**
 * Gate a catalog entry. Curated `decision` must be consistent with SPDX,
 * install scripts, native farms, and "regex as full TS" claims.
 */
export function evaluateEntry(entry) {
  const reasons = [];
  const expr = effectiveLicenseExpr(entry);
  const parsed = parseSpdx(expr);
  const decision = entry.decision;
  const chosen = entry.chosenLicense ?? parsed.chosen;

  if (!ALL_DECISIONS.includes(decision)) {
    reasons.push(`invalid-decision:${decision}`);
  }

  if (entry.licenseFileText && PROPRIETARY_HINT.test(entry.licenseFileText) && COPYLEFT_ID.test(entry.licenseFileText)) {
    parsed.class = parsed.class === "allowed" ? parsed.class : "denied";
    if (parsed.class !== "allowed") {
      parsed.class = "denied";
      parsed.reasons = uniq([...parsed.reasons, "gpl-or-proprietary-file"]);
    }
  }

  if (entry.forceDenied) {
    parsed.class = "denied";
    parsed.reasons = uniq([...parsed.reasons, ...entry.forceDenied]);
  }

  if (chosen) {
    const chosenClass = classifyIdentifier(chosen);
    if (chosenClass === "denied") {
      reasons.push(`chosen-license-denied:${chosen}`);
    }
    if (parsed.class === "allowed" && chosenClass === "allowed") {
      if (!parsed.identifiers.includes(chosen) && parsed.identifiers.length) {
        reasons.push(`chosen-license-not-in-expression:${chosen}`);
      }
    }
  }

  if (entry.hasInstallScript) {
    reasons.push("install-script");
  }
  if (entry.nativeBindingsFarm) {
    reasons.push("native-bindings-farm");
  }
  if (entry.claimsFullTsViaRegex) {
    reasons.push("regex-claimed-as-full-ts");
  }
  if (entry.copyleftBinary) {
    reasons.push("copyleft-native-binary");
  }

  const blocking = new Set();
  if (parsed.class === "denied") blocking.add("denied-license");
  if (reasons.includes("install-script")) blocking.add("install-script");
  if (reasons.includes("copyleft-native-binary")) blocking.add("copyleft-native-binary");
  if (reasons.includes("regex-claimed-as-full-ts")) blocking.add("regex-claimed-as-full-ts");
  if (reasons.some((r) => r.startsWith("chosen-license-denied"))) blocking.add("chosen-license-denied");

  let expected;
  if (blocking.size) expected = "do_not_add";
  else if (parsed.class === "unknown" && SHIPPABLE_DECISIONS.includes(decision)) {
    expected = "unknown";
  } else {
    expected = decision;
  }

  const shippable = SHIPPABLE_DECISIONS.includes(decision);
  if (shippable && blocking.size) {
    reasons.push("shippable-blocked");
  }
  if (shippable && parsed.class !== "allowed") {
    reasons.push(`shippable-requires-allowed-license:${parsed.class}`);
  }
  if (shippable && entry.nativeBindingsFarm) {
    reasons.push("shippable-blocked-native-farm");
  }
  if (decision === "recommend" && entry.nativeBindingsFarm) {
    reasons.push("recommend-blocked-native-farm");
  }

  const ok =
    ALL_DECISIONS.includes(decision) &&
    !(shippable && (blocking.size || parsed.class !== "allowed" || entry.nativeBindingsFarm)) &&
    !(blocking.size && decision !== "do_not_add") &&
    !(parsed.class === "denied" && decision !== "do_not_add");

  return {
    id: entry.id,
    ok,
    decision,
    expectedDecisionIfBlocked: blocking.size ? "do_not_add" : expected,
    licenseClass: parsed.class,
    chosenLicense: parsed.class === "allowed" ? chosen ?? parsed.chosen : null,
    parsed,
    blocking: [...blocking],
    reasons: uniq([...parsed.reasons, ...reasons]),
  };
}

export function assertCatalogGate(entries) {
  const failures = [];
  const recommended = [];
  for (const entry of entries) {
    const result = evaluateEntry(entry);
    if (!result.ok) {
      failures.push({
        id: entry.id,
        decision: entry.decision,
        reasons: result.reasons,
        blocking: result.blocking,
        licenseClass: result.licenseClass,
      });
    }
    if (entry.decision === "recommend" || entry.decision === "optional") {
      recommended.push({ entry, result });
      if (result.licenseClass !== "allowed") {
        failures.push({
          id: entry.id,
          decision: entry.decision,
          reasons: ["recommended-without-allowed-license"],
        });
      }
      const ident = result.chosenLicense;
      if (ident && classifyIdentifier(ident) === "denied") {
        failures.push({
          id: entry.id,
          decision: entry.decision,
          reasons: [`gpl-leak:${ident}`],
        });
      }
    }
  }
  return { ok: failures.length === 0, failures, recommendedCount: recommended.length };
}

export function minimalIntegratorSet(entries) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const requiredIds = [
    "node-builtins",
    "s122-semver-local",
    "es-module-lexer",
    "extract-ustar-or-system-tar",
  ];
  const missing = requiredIds.filter((id) => {
    const e = byId.get(id);
    return !e || e.decision !== "recommend";
  });
  return { requiredIds, missing, ok: missing.length === 0 };
}
