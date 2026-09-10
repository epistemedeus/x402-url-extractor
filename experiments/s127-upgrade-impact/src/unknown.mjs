/**
 * S127 unknown/partial taxonomy (c07).
 *
 * Packet decisions are `action | unknown | no_action`. This module does not
 * invent export diffs or usage; it constrains candidate bindings so missing,
 * conflicting, or partial evidence cannot become a caller-defect claim.
 *
 * Schema: s127.upgrade-impact.unknown.v1
 * Offline. No network, no lifecycle scripts, no payment fields.
 */

export const SCHEMA = "s127.upgrade-impact.unknown.v1";

export const PACKET_DECISIONS = Object.freeze(["action", "unknown", "no_action"]);

export const POLICIES = Object.freeze({
  FORCE_UNKNOWN: "force_unknown",
  ALLOW_PARTIAL: "allow_partial",
});

export const REASON_CODES = Object.freeze([
  "missing_source",
  "partial_coverage",
  "lockfile_conflict",
  "dynamic_import",
  "unsupported_language",
  "parser_limit",
  "prerelease_range_ambiguous",
  "hostile_input",
]);

const REASON_SET = new Set(REASON_CODES);

export const EVIDENCE_CLASSES = Object.freeze(["fixture", "live-capture", "synthetic"]);

export const HOSTILE_SIGNAL_CODES = Object.freeze([
  "path_escape",
  "symlink_escape",
  "symlink_cycle",
  "absolute_path",
  "oversized",
  "binary_nul",
  "prototype_pollution_key",
  "lifecycle_scripts",
  "invalid_utf8",
]);

export const BASELINE_LIMITATIONS = Object.freeze([
  "No full TypeScript program analysis (TS/TSX constructs are parser_limit / unknown).",
  "No runtime execution of package modules or lifecycle scripts.",
  "A new version is not itself a break.",
  "An unused export change is not a caller defect.",
]);

const MAX_STRING = 4096;
const MAX_LIST = 128;
const MAX_DEPTH = 6;

/**
 * Catalog policy per reason.
 *
 * force_unknown: presence forbids `action` on every binding and forces packet
 * nextAction to `unknown`. `no_action` is left in place (unused ≠ defect).
 *
 * allow_partial: named covered surfaces may keep action/no_action; named
 * uncovered (or not-covered) surfaces are unknown; unnamed scope escalates
 * to force_unknown because coverage cannot be proven.
 */
export const TAXONOMY = freezeDeep({
  missing_source: {
    code: "missing_source",
    policy: POLICIES.FORCE_UNKNOWN,
    defaultScope: "packet",
    contractRule: 3,
    unnamedEscalates: false,
    summary:
      "Old and/or new package source artifact is absent. Cannot bind usage to export changes.",
    limitation:
      "Missing package source artifact: cannot bind usage to export changes; decision is unknown, not action.",
  },
  partial_coverage: {
    code: "partial_coverage",
    policy: POLICIES.ALLOW_PARTIAL,
    defaultScope: "surface",
    contractRule: 3,
    unnamedEscalates: true,
    summary:
      "Artifact exists but coverage is incomplete. Covered used symbols may bind; the rest stay unknown.",
    limitation:
      "Source coverage is incomplete. Covered used symbols may bind with flags; uncovered surfaces stay unknown.",
  },
  lockfile_conflict: {
    code: "lockfile_conflict",
    policy: POLICIES.FORCE_UNKNOWN,
    defaultScope: "packet",
    contractRule: 5,
    unnamedEscalates: false,
    summary:
      "Alias, workspace, or lockfile identity disagrees. Version identity is untrusted until resolved.",
    limitation:
      "Alias/workspace/lockfile disagreement: identity is unknown until resolved or reported; not action.",
  },
  dynamic_import: {
    code: "dynamic_import",
    policy: POLICIES.ALLOW_PARTIAL,
    defaultScope: "surface",
    contractRule: 4,
    unnamedEscalates: true,
    summary:
      "Dynamic import() of a package. That surface is unknown; static imports of other surfaces may still bind.",
    limitation:
      "Dynamic import of a package is an unknown contribution for that surface (packet contract rule 4).",
  },
  unsupported_language: {
    code: "unsupported_language",
    policy: POLICIES.ALLOW_PARTIAL,
    defaultScope: "artifact",
    contractRule: null,
    unnamedEscalates: true,
    summary:
      "Caller or package file is in a language with no parser in this pack. Named files unknown; other languages may bind.",
    limitation:
      "Unsupported language: no static import/export analysis for that file; decision is unknown for that surface.",
  },
  parser_limit: {
    code: "parser_limit",
    policy: POLICIES.ALLOW_PARTIAL,
    defaultScope: "artifact",
    contractRule: null,
    unnamedEscalates: true,
    summary:
      "Parser could not fully handle a construct (TypeScript, type-only imports, SFC, etc.). Named files/symbols unknown.",
    limitation:
      "Parser limit: TS/dynamic/unhandled syntax is unknown. This pack does not claim full TypeScript analysis.",
  },
  prerelease_range_ambiguous: {
    code: "prerelease_range_ambiguous",
    policy: POLICIES.FORCE_UNKNOWN,
    defaultScope: "packet",
    contractRule: null,
    unnamedEscalates: false,
    summary:
      "Declared version is a range, dist-tag, or unpinned prerelease; resolved identity is not exact.",
    limitation:
      "Prerelease or range identity is ambiguous without exact resolvedOld/resolvedNew; not action.",
  },
  hostile_input: {
    code: "hostile_input",
    policy: POLICIES.FORCE_UNKNOWN,
    defaultScope: "packet",
    contractRule: null,
    unnamedEscalates: false,
    summary:
      "Caller classified the input as hostile. Refuse action; do not execute; do not invent bindings.",
    limitation:
      "Hostile input: no action claim, no lifecycle execution, no path follow. Keep the packet unknown.",
  },
});

export const LIMITATION_TEXT = freezeDeep(
  Object.fromEntries(REASON_CODES.map((code) => [code, TAXONOMY[code].limitation])),
);

const JS_EXTS = Object.freeze([".js", ".mjs", ".cjs", ".jsx"]);
const TS_EXTS = Object.freeze([".ts", ".tsx", ".mts", ".cts"]);
const PARSER_LIMIT_EXTS = Object.freeze([".vue", ".svelte", ".mdx"]);
const UNSUPPORTED_EXTS = Object.freeze([
  ".py",
  ".rs",
  ".go",
  ".java",
  ".rb",
  ".php",
  ".cs",
  ".kt",
  ".swift",
  ".c",
  ".cc",
  ".cpp",
  ".h",
  ".hpp",
  ".m",
  ".mm",
  ".scala",
  ".hs",
  ".ex",
  ".exs",
  ".erl",
  ".lua",
  ".r",
  ".jl",
  ".zig",
  ".nim",
]);

const DIST_TAGS = Object.freeze([
  "latest",
  "next",
  "canary",
  "beta",
  "rc",
  "alpha",
  "dev",
  "nightly",
  "unreleased",
]);

const PROTOCOL_PREFIX = /^(workspace:|file:|link:|npm:|github:|gist:|bitbucket:|git\+|git:|http:|https:|ssh:)/i;

export class UnknownReasonCodeError extends Error {
  constructor(offered) {
    super(`reason code is not in s127 unknown taxonomy: ${stringifyOffered(offered)}`);
    this.name = "UnknownReasonCodeError";
    this.errorCode = "invalid_reason_code";
    this.offered = offered;
  }
}

export function isReasonCode(code) {
  return typeof code === "string" && REASON_SET.has(code);
}

export function catalogPolicy(code) {
  assertCode(code);
  return TAXONOMY[code].policy;
}

export function isForceUnknownCode(code) {
  return catalogPolicy(code) === POLICIES.FORCE_UNKNOWN;
}

export function allowsPartialBindings(code) {
  return catalogPolicy(code) === POLICIES.ALLOW_PARTIAL;
}

export function createReason(codeOrFields, extra = {}) {
  const fromObject = codeOrFields != null && typeof codeOrFields === "object";
  const code = fromObject ? codeOrFields.code : codeOrFields;
  assertCode(code);
  const rest = fromObject ? { ...codeOrFields, ...extra } : extra;
  const catalog = TAXONOMY[code];

  const symbols = stringList(rest.symbols);
  const surfaces = stringList(rest.surfaces);
  const files = stringList(rest.files);
  const modules = stringList(rest.modules);
  const coveredSymbols = stringList(rest.coveredSymbols);
  const coveredSurfaces = stringList(rest.coveredSurfaces);
  const coveredFiles = stringList(rest.coveredFiles);
  const coveredModules = stringList(rest.coveredModules);
  const artifacts = stringList(rest.artifacts);
  const signals = stringList(rest.signals);
  const named = hasNamedScope({
    symbols,
    surfaces,
    files,
    modules,
    coveredSymbols,
    coveredSurfaces,
    coveredFiles,
    coveredModules,
  });
  const escalated = catalog.unnamedEscalates && !named;
  const policy = escalated ? POLICIES.FORCE_UNKNOWN : catalog.policy;

  const reason = {
    code,
    policy,
    catalogPolicy: catalog.policy,
    scope: scopeValue(rest.scope) || catalog.defaultScope,
    escalated,
    escalateReason: escalated ? "unnamed_scope" : null,
    symbols,
    surfaces,
    files,
    modules,
    coveredSymbols,
    coveredSurfaces,
    coveredFiles,
    coveredModules,
    artifacts,
    signals,
    coverage: sanitizeCoverageValue(rest.coverage),
    detail: sanitizeValue(rest.detail),
    evidenceClass: evidenceClassValue(rest.evidenceClass),
    summary: catalog.summary,
  };
  return reason;
}

export function effectivePolicy(reason) {
  const normalized = normalizeReason(reason);
  return normalized.policy;
}

export function hasNamedScope(reason) {
  return (
    nonempty(reason?.symbols) ||
    nonempty(reason?.surfaces) ||
    nonempty(reason?.files) ||
    nonempty(reason?.modules) ||
    nonempty(reason?.coveredSymbols) ||
    nonempty(reason?.coveredSurfaces) ||
    nonempty(reason?.coveredFiles) ||
    nonempty(reason?.coveredModules)
  );
}

export function appliesToBinding(reason, binding) {
  const normalized = normalizeReason(reason);
  if (normalized.policy === POLICIES.FORCE_UNKNOWN) return true;

  const keys = bindingKeys(binding);
  const uncovered = [
    ...normalized.symbols,
    ...normalized.surfaces,
    ...normalized.files,
    ...normalized.modules,
  ];
  const covered = [
    ...normalized.coveredSymbols,
    ...normalized.coveredSurfaces,
    ...normalized.coveredFiles,
    ...normalized.coveredModules,
  ];

  if (uncovered.length) {
    if (uncovered.some((item) => keys.has(item))) return true;
    if (covered.length) return !covered.some((item) => keys.has(item));
    return false;
  }
  if (covered.length) return !covered.some((item) => keys.has(item));
  return true;
}

export function constrainDecision(decision, reasons, binding) {
  const current = PACKET_DECISIONS.includes(decision) ? decision : "unknown";
  if (current !== "action") return current;
  for (const reason of normalizeReasonList(reasons)) {
    if (appliesToBinding(reason, binding)) return "unknown";
  }
  return current;
}

export function applyUnknownPolicy({ bindings = [], reasons = [] } = {}) {
  const normalizedReasons = normalizeReasonList(reasons);
  const incoming = asArray(bindings).map(normalizeBinding).filter(Boolean);
  const applied = incoming.map((binding) => applyReasonsToBinding(binding, normalizedReasons));
  const forceUnknown = normalizedReasons.some((reason) => reason.policy === POLICIES.FORCE_UNKNOWN);
  const allowPartialPresent = normalizedReasons.some(
    (reason) => reason.catalogPolicy === POLICIES.ALLOW_PARTIAL,
  );

  const bindingsOut = applied.map((binding) => {
    if (forceUnknown && binding.decision === "action") {
      return flagBinding(binding, {
        decision: "unknown",
        addedReasons: normalizedReasons.filter((reason) => reason.policy === POLICIES.FORCE_UNKNOWN),
        note: "packet-level force_unknown forbids action",
      });
    }
    if (allowPartialPresent && binding.decision === "action") {
      return {
        ...binding,
        flags: { ...binding.flags, partialPacket: true },
      };
    }
    return binding;
  });

  const summary = summarizeUnknown({ bindings: bindingsOut, reasons: normalizedReasons });
  return {
    schema: SCHEMA,
    reasons: normalizedReasons,
    bindings: bindingsOut,
    summary,
    limitations: limitationsFromReasons(normalizedReasons),
    flags: {
      forceUnknown,
      partial: allowPartialPresent,
      hostile: normalizedReasons.some((reason) => reason.code === "hostile_input"),
    },
  };
}

export const evaluateUnknown = applyUnknownPolicy;

export function summarizeUnknown({ bindings = [], reasons = [] } = {}) {
  const normalizedReasons = normalizeReasonList(reasons);
  const list = asArray(bindings).map(normalizeBinding).filter(Boolean);
  const unknownReasons = unique(normalizedReasons.map((reason) => reason.code));
  const unusedChanges = unique(
    list
      .filter((binding) => binding.used === false && isConcreteChange(binding.changeKind))
      .map((binding) => binding.symbol)
      .filter(Boolean),
  );
  const actionableChanges = unique(
    list.filter((binding) => binding.decision === "action").map((binding) => binding.symbol).filter(Boolean),
  );

  const forceUnknown = normalizedReasons.some((reason) => reason.policy === POLICIES.FORCE_UNKNOWN);
  const hasAction = list.some((binding) => binding.decision === "action");
  const hasUnknownBinding = list.some((binding) => binding.decision === "unknown");
  const unaccounted = normalizedReasons.some((reason) => !reasonAccountedAsUnused(reason, list));

  let nextAction;
  if (forceUnknown) nextAction = "unknown";
  else if (hasAction) nextAction = "action";
  else if (hasUnknownBinding || (normalizedReasons.length > 0 && unaccounted)) nextAction = "unknown";
  else nextAction = "no_action";

  return {
    nextAction,
    unknownReasons,
    unusedChanges,
    actionableChanges,
  };
}

export function limitationsFromReasons(reasons = []) {
  const extra = normalizeReasonList(reasons).map((reason) => TAXONOMY[reason.code].limitation);
  return unique([...BASELINE_LIMITATIONS, ...extra]);
}

export function classifyMissingSource(input = {}) {
  const missing = [];
  if (explicitMissing(input, "oldArtifact") || input.oldPresent === false || input.oldMissing === true) {
    missing.push("old");
  }
  if (explicitMissing(input, "newArtifact") || input.newPresent === false || input.newMissing === true) {
    missing.push("new");
  }
  if (Array.isArray(input.missingArtifacts)) {
    for (const item of input.missingArtifacts) {
      if (typeof item === "string" && item) missing.push(item);
    }
  }
  if (missing.length === 0) return null;
  return createReason("missing_source", {
    artifacts: unique(missing),
    evidenceClass: input.evidenceClass,
    detail: input.detail,
  });
}

export function coverageIsComplete(coverage) {
  if (coverage === "full" || coverage === true) return true;
  if (typeof coverage === "number") return coverage >= 1;
  if (coverage && typeof coverage === "object") {
    if (coverage.complete === true || coverage.coverage === "full") return true;
    if (typeof coverage.coverage === "number") return coverage.coverage >= 1;
    if (
      Number.isFinite(coverage.filesAnalyzed) &&
      Number.isFinite(coverage.filesTotal) &&
      coverage.filesTotal > 0 &&
      coverage.filesAnalyzed >= coverage.filesTotal
    ) {
      return true;
    }
  }
  return false;
}

export function classifyPartialCoverage(input = {}) {
  if (input == null || input === "full" || input === 1 || input === true) return null;
  const record = typeof input === "object" && !Array.isArray(input) ? input : { coverage: input };
  if (coverageIsComplete(record.coverage ?? record)) return null;
  if (record.complete === true && record.coverage == null && record.filesTotal == null) return null;

  const filesAnalyzed = finiteNumber(record.filesAnalyzed);
  const filesTotal = finiteNumber(record.filesTotal);
  let coverage = record.coverage;
  if (coverage == null && filesAnalyzed != null && filesTotal != null && filesTotal > 0) {
    coverage = filesAnalyzed / filesTotal;
  }
  if (coverageIsComplete(coverage)) return null;

  const named = hasNamedScope(record);
  const hasSignal =
    named ||
    coverage === "partial" ||
    coverage === "none" ||
    coverage === "unknown" ||
    coverage === 0 ||
    (typeof coverage === "number" && coverage < 1) ||
    record.partial === true ||
    (filesTotal != null && filesAnalyzed != null && filesAnalyzed < filesTotal);

  if (!hasSignal) return null;

  return createReason("partial_coverage", {
    coverage,
    symbols: record.symbols,
    surfaces: record.surfaces,
    files: record.files,
    modules: record.modules,
    coveredSymbols: record.coveredSymbols,
    coveredSurfaces: record.coveredSurfaces,
    coveredFiles: record.coveredFiles,
    coveredModules: record.coveredModules,
    evidenceClass: record.evidenceClass,
    detail: {
      filesAnalyzed,
      filesTotal,
      note: record.detail,
    },
  });
}

export function classifyLockfileConflict(input = {}) {
  const requestedName = typeof input.requestedName === "string" ? input.requestedName : null;
  const resolvedName = typeof input.resolvedName === "string" ? input.resolvedName : null;
  const nameMismatch = Boolean(requestedName && resolvedName && requestedName !== resolvedName);
  const twoLockfiles =
    typeof input.lockfileA === "string" &&
    typeof input.lockfileB === "string" &&
    input.lockfileA.length > 0 &&
    input.lockfileB.length > 0 &&
    input.lockfileA !== input.lockfileB;
  const disagreement =
    input.disagreement === true ||
    input.aliasMismatch === true ||
    input.workspaceDisagreement === true ||
    nameMismatch ||
    twoLockfiles;
  if (!disagreement) return null;
  return createReason("lockfile_conflict", {
    evidenceClass: input.evidenceClass,
    detail: {
      requestedName,
      resolvedName,
      aliasMismatch: input.aliasMismatch === true,
      workspaceDisagreement: input.workspaceDisagreement === true,
      twoLockfiles,
      note: input.detail,
    },
  });
}

export function classifyDynamicImport(usage = {}) {
  if (!usage || usage.dynamicImport !== true) return null;
  return createReason("dynamic_import", {
    surfaces: firstStrings(usage.specifier, usage.surface, usage.module, usage.from),
    symbols: usage.symbols,
    files: firstStrings(usage.file, usage.path),
    evidenceClass: usage.evidenceClass,
    detail: usage.detail,
  });
}

export function languageKindFromPath(filePath) {
  if (typeof filePath !== "string" || !filePath) return null;
  const base = filePath.toLowerCase();
  const ext = extensionOf(base);
  if (!ext) return null;
  if (JS_EXTS.includes(ext)) return "supported";
  if (TS_EXTS.includes(ext) || PARSER_LIMIT_EXTS.includes(ext)) return "parser_limit";
  if (UNSUPPORTED_EXTS.includes(ext)) return "unsupported_language";
  return null;
}

export function classifyLanguage(input = {}) {
  const file = typeof input.file === "string" ? input.file : typeof input.path === "string" ? input.path : null;
  const language = typeof input.language === "string" ? input.language.toLowerCase() : null;
  let kind = null;
  if (language) {
    if (["js", "javascript", "mjs", "cjs", "jsx"].includes(language)) kind = "supported";
    else if (["ts", "typescript", "tsx", "vue", "svelte", "mdx"].includes(language)) kind = "parser_limit";
    else kind = "unsupported_language";
  }
  if (!kind && file) kind = languageKindFromPath(file);
  if (input.construct && TS_CONSTRUCTS.has(input.construct)) kind = "parser_limit";
  if (kind === "supported" || kind == null) return null;
  return createReason(kind, {
    files: file ? [file] : [],
    symbols: input.symbols,
    surfaces: input.surfaces,
    modules: input.modules,
    evidenceClass: input.evidenceClass,
    detail: { language, construct: input.construct, note: input.detail },
  });
}

export function classifyParserLimit(input = {}) {
  if (input.parserLimit === true || input.limit === true) {
    return createReason("parser_limit", {
      files: firstStrings(input.file, input.path),
      symbols: input.symbols,
      surfaces: input.surfaces,
      modules: input.modules,
      evidenceClass: input.evidenceClass,
      detail: { construct: input.construct, note: input.detail },
    });
  }
  const reason = classifyLanguage(input);
  return reason?.code === "parser_limit" ? reason : null;
}

export function classifyUnsupportedLanguage(input = {}) {
  if (input.unsupported === true) {
    return createReason("unsupported_language", {
      files: firstStrings(input.file, input.path),
      symbols: input.symbols,
      surfaces: input.surfaces,
      modules: input.modules,
      evidenceClass: input.evidenceClass,
      detail: { language: input.language, note: input.detail },
    });
  }
  const reason = classifyLanguage(input);
  return reason?.code === "unsupported_language" ? reason : null;
}

const TS_CONSTRUCTS = new Set([
  "import_type",
  "export_type",
  "enum",
  "namespace",
  "decorators",
  "satisfies",
  "const_enum",
  "parameter_properties",
]);

export function versionIdentityKind(version) {
  if (version == null) return "missing";
  if (typeof version !== "string") return "unknown";
  const v = version.trim();
  if (!v) return "missing";
  if (DIST_TAGS.includes(v)) return "range";
  if (PROTOCOL_PREFIX.test(v)) return "range";
  if (v === "*" || v === "x" || v === "X") return "range";
  if (/^(?:[\^~]|>=|<=|>|<|=)/.test(v)) return "range";
  if (/\|\||\s-\s/.test(v)) return "range";
  const unv = v.replace(/^v/i, "");
  if (/(?:^|[.])(?:x|X|\*)(?:$|[.])/.test(unv)) return "range";
  if (/^\d+\.\d+\.\d+(?:\+[0-9A-Za-z.-]+)?$/.test(unv)) return "exact";
  if (/^\d+\.\d+\.\d+-[0-9A-Za-z.-]+(?:\+[0-9A-Za-z.-]+)?$/.test(unv)) return "prerelease_exact";
  return "unknown";
}

export function classifyPrereleaseRange(dependency = {}) {
  if (!hasAnyVersion(dependency)) return null;
  const oldKind = pinKind(dependency.oldVersion, dependency.resolvedOld);
  const newKind = pinKind(dependency.newVersion, dependency.resolvedNew);
  const pinned = (kind) => kind === "exact" || kind === "prerelease_exact";
  if (pinned(oldKind) && pinned(newKind)) return null;
  return createReason("prerelease_range_ambiguous", {
    evidenceClass: dependency.evidenceClass,
    detail: {
      oldKind,
      newKind,
      oldVersion: clipString(dependency.oldVersion),
      newVersion: clipString(dependency.newVersion),
      resolvedOld: clipString(dependency.resolvedOld),
      resolvedNew: clipString(dependency.resolvedNew),
    },
  });
}

export function classifyHostileInput(input = {}) {
  const flagged = input.hostile === true || input.hostileInput === true;
  const signals = stringList(input.signals || input.hostileSignals);
  if (!flagged && signals.length === 0) return null;
  return createReason("hostile_input", {
    signals,
    evidenceClass: input.evidenceClass,
    detail: input.detail,
  });
}

export function collectReasonsFromDraft(draft = {}) {
  if (draft == null || typeof draft !== "object") return [];
  const out = [];

  for (const item of asArray(draft.reasons)) out.push(normalizeReason(item));
  for (const code of asArray(draft.unknownReasons)) {
    if (typeof code === "string") out.push(createReason(code));
  }

  const missing = classifyMissingSource(draft.missingSource || draft.source || draft);
  if (draft.missingSource === true) out.push(createReason("missing_source"));
  else if (missing) out.push(missing);

  const coverageSource = draft.partialCoverage || draft.exportDiff || draft.coverage || draft.provenance;
  if (Array.isArray(coverageSource)) {
    for (const entry of coverageSource) {
      const partial = classifyPartialCoverage(entry);
      if (partial) out.push(partial);
    }
  } else {
    const partial = classifyPartialCoverage(coverageSource);
    if (partial) out.push(partial);
  }

  const lock = classifyLockfileConflict(draft.lockfile || draft.lockfileConflict || {});
  if (draft.lockfileConflict === true) out.push(createReason("lockfile_conflict"));
  else if (lock) out.push(lock);

  const usageEntries = usageList(draft.usage);
  for (const entry of usageEntries) {
    const dynamic = classifyDynamicImport(entry);
    if (dynamic) out.push(dynamic);
    const lang = classifyLanguage(entry);
    if (lang) out.push(lang);
  }

  const prerelease = classifyPrereleaseRange(draft.dependency || {});
  if (prerelease) out.push(prerelease);

  let hostile = null;
  if (draft.hostile && typeof draft.hostile === "object") hostile = classifyHostileInput(draft.hostile);
  else if (draft.hostile === true || draft.hostileInput === true) hostile = classifyHostileInput(draft);
  else if (draft.signals || draft.hostileSignals) hostile = classifyHostileInput(draft);
  if (hostile) out.push(hostile);

  return dedupeReasons(out);
}

function applyReasonsToBinding(binding, reasons) {
  let next = repairUnusedAction(binding);
  const matched = [];
  for (const reason of reasons) {
    if (!appliesToBinding(reason, next)) continue;
    matched.push(reason);
    if (next.decision === "action") {
      next = flagBinding(next, {
        decision: "unknown",
        addedReasons: [reason],
        note: `${reason.code} forbids action on this surface`,
      });
    } else {
      next = flagBinding(next, { addedReasons: [reason] });
    }
  }
  if (matched.length === 0) return next;
  return next;
}

function repairUnusedAction(binding) {
  if (binding.used === false && binding.decision === "action") {
    return {
      ...binding,
      decision: "no_action",
      rationale: joinRationale(
        binding.rationale,
        "unused export change is not a caller defect",
      ),
      flags: { ...binding.flags, invariantRepaired: true },
    };
  }
  return binding;
}

function flagBinding(binding, { decision, addedReasons = [], note } = {}) {
  const codes = unique([...(binding.unknownReasons || []), ...addedReasons.map((reason) => reason.code)]);
  const flags = {
    ...binding.flags,
    unknownReasons: codes,
    partial: addedReasons.some((reason) => reason.catalogPolicy === POLICIES.ALLOW_PARTIAL) || binding.flags.partial === true,
    forceUnknown: addedReasons.some((reason) => reason.policy === POLICIES.FORCE_UNKNOWN) || binding.flags.forceUnknown === true,
  };
  return {
    ...binding,
    decision: decision || binding.decision,
    unknownReasons: codes,
    rationale: joinRationale(binding.rationale, note, ...addedReasons.map(reasonRationale)),
    flags,
  };
}

function reasonRationale(reason) {
  const tag = reason.escalated ? `${reason.code} (escalated to force_unknown: unnamed_scope)` : reason.code;
  return `[s127.unknown] ${tag}: ${reason.policy}`;
}

function reasonAccountedAsUnused(reason, bindings) {
  if (reason.policy === POLICIES.FORCE_UNKNOWN) return false;
  const scopes = [
    ...reason.symbols,
    ...reason.surfaces,
    ...reason.files,
    ...reason.modules,
  ];
  if (scopes.length === 0) {
    const covered = [
      ...reason.coveredSymbols,
      ...reason.coveredSurfaces,
      ...reason.coveredFiles,
      ...reason.coveredModules,
    ];
    if (covered.length === 0) return false;
    return bindings.filter((binding) => binding.used === true).every((binding) => {
      const keys = bindingKeys(binding);
      return covered.some((item) => keys.has(item));
    });
  }
  return scopes.every((scope) => {
    const hit = bindings.find((binding) => bindingKeys(binding).has(scope));
    return hit && hit.used === false;
  });
}

function normalizeBinding(binding) {
  if (binding == null || typeof binding !== "object") return null;
  const symbol = typeof binding.symbol === "string" ? clipString(binding.symbol) : "";
  const used = binding.used === true;
  const changeKind = typeof binding.changeKind === "string" ? clipString(binding.changeKind) : "unknown";
  let decision = binding.decision;
  if (!PACKET_DECISIONS.includes(decision)) decision = "unknown";
  const rationale = typeof binding.rationale === "string" ? clipString(binding.rationale) : "";
  const flags = sanitizeValue(binding.flags && typeof binding.flags === "object" ? binding.flags : {}) || {};
  return {
    symbol,
    used,
    changeKind,
    decision,
    rationale,
    surface: clipString(binding.surface),
    specifier: clipString(binding.specifier),
    module: clipString(binding.module),
    from: clipString(binding.from),
    file: clipString(binding.file),
    path: clipString(binding.path),
    unknownReasons: stringList(binding.unknownReasons),
    flags,
  };
}

function bindingKeys(binding) {
  const keys = new Set();
  for (const value of [
    binding?.symbol,
    binding?.surface,
    binding?.specifier,
    binding?.module,
    binding?.from,
    binding?.file,
    binding?.path,
  ]) {
    if (typeof value === "string" && value.length > 0) keys.add(value);
  }
  return keys;
}

function normalizeReason(input) {
  if (typeof input === "string") return createReason(input);
  if (input && typeof input === "object" && typeof input.code === "string") {
    return createReason(input);
  }
  throw new UnknownReasonCodeError(input);
}

function normalizeReasonList(reasons) {
  return dedupeReasons(asArray(reasons).map(normalizeReason));
}

function dedupeReasons(reasons) {
  const seen = new Set();
  const out = [];
  for (const reason of reasons) {
    const key = reasonKey(reason);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(reason);
  }
  return out;
}

function reasonKey(reason) {
  return JSON.stringify({
    code: reason.code,
    policy: reason.policy,
    symbols: reason.symbols,
    surfaces: reason.surfaces,
    files: reason.files,
    modules: reason.modules,
    coveredSymbols: reason.coveredSymbols,
    coveredSurfaces: reason.coveredSurfaces,
    coveredFiles: reason.coveredFiles,
    coveredModules: reason.coveredModules,
    artifacts: reason.artifacts,
    signals: reason.signals,
  });
}

function assertCode(code) {
  if (!isReasonCode(code)) throw new UnknownReasonCodeError(code);
}

function pinKind(declared, resolved) {
  const resolvedKind = versionIdentityKind(resolved);
  if (resolvedKind === "exact" || resolvedKind === "prerelease_exact") return resolvedKind;
  const declaredKind = versionIdentityKind(declared);
  if (declaredKind === "exact" || declaredKind === "prerelease_exact") return declaredKind;
  return resolvedKind === "missing" ? declaredKind : resolvedKind;
}

function hasAnyVersion(dependency) {
  return [dependency.oldVersion, dependency.newVersion, dependency.resolvedOld, dependency.resolvedNew].some(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
}

function usageList(usage) {
  if (Array.isArray(usage)) return usage;
  if (usage && typeof usage === "object") {
    if (Array.isArray(usage.entries)) return usage.entries;
    return [usage];
  }
  return [];
}

function explicitMissing(input, key) {
  return Object.prototype.hasOwnProperty.call(input, key) && (input[key] == null || input[key] === false);
}

function isConcreteChange(changeKind) {
  return typeof changeKind === "string" && changeKind !== "none" && changeKind !== "unknown" && changeKind.length > 0;
}

function evidenceClassValue(value) {
  if (typeof value !== "string" || !value) return null;
  if (EVIDENCE_CLASSES.includes(value)) return value;
  return clipString(value);
}

function scopeValue(value) {
  if (value === "packet" || value === "surface" || value === "artifact") return value;
  return null;
}

function sanitizeCoverageValue(coverage) {
  if (coverage == null) return null;
  if (typeof coverage === "number") return Number.isFinite(coverage) ? coverage : null;
  if (typeof coverage === "string") return clipString(coverage);
  if (typeof coverage === "boolean") return coverage;
  return sanitizeValue(coverage);
}

function stringList(value) {
  if (value == null) return [];
  const arr = Array.isArray(value) ? value : [value];
  const out = [];
  for (const item of arr.slice(0, MAX_LIST)) {
    if (typeof item === "string" && item.length > 0) out.push(clipString(item));
  }
  return unique(out);
}

function firstStrings(...values) {
  const out = [];
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) out.push(value);
  }
  return out;
}

function nonempty(value) {
  return Array.isArray(value) && value.length > 0;
}

function unique(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (item == null || item === "") continue;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function clipString(value) {
  if (typeof value !== "string") return value == null ? undefined : undefined;
  if (!value) return value;
  return value.length > MAX_STRING ? value.slice(0, MAX_STRING) : value;
}

function finiteNumber(value) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function joinRationale(...parts) {
  const bits = [];
  for (const part of parts) {
    if (typeof part === "string" && part.length > 0 && !bits.includes(part)) bits.push(part);
  }
  return bits.join("; ");
}

function stringifyOffered(offered) {
  if (typeof offered === "string") return offered;
  try {
    return JSON.stringify(offered);
  } catch {
    return String(offered);
  }
}

function extensionOf(filePath) {
  const slash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  const base = slash >= 0 ? filePath.slice(slash + 1) : filePath;
  if (base.endsWith(".d.ts")) return ".ts";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot);
}

function sanitizeValue(value, depth = 0) {
  if (value == null) return value;
  if (depth > MAX_DEPTH) return "[truncated]";
  const t = typeof value;
  if (t === "string") return clipString(value);
  if (t === "number") return Number.isFinite(value) ? value : null;
  if (t === "boolean") return value;
  if (t !== "object") return String(value);
  if (Array.isArray(value)) return value.slice(0, MAX_LIST).map((item) => sanitizeValue(item, depth + 1));
  const out = {};
  const keys = Object.keys(value)
    .filter((key) => key !== "__proto__" && key !== "constructor" && key !== "prototype")
    .slice(0, MAX_LIST);
  for (const key of keys) out[key] = sanitizeValue(value[key], depth + 1);
  return out;
}

function freezeDeep(value) {
  if (value && typeof value === "object") {
    for (const inner of Object.values(value)) freezeDeep(inner);
    Object.freeze(value);
  }
  return value;
}
