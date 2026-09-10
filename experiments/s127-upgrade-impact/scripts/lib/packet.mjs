import { PACKET_SCHEMA } from "./contract.mjs";

export const DECISIONS = Object.freeze(["action", "unknown", "no_action"]);
export const EVIDENCE_LABELS = Object.freeze(["fixture", "live-capture", "synthetic"]);
export const CHANGE_KINDS = Object.freeze([
  "added",
  "removed",
  "renamed",
  "signatureChanged",
  "unchanged",
  "unknown",
  "none",
]);

const STATIC_LIMITATIONS = Object.freeze([
  "no full TypeScript analysis; TS and type-only surfaces stay unknown",
  "no runtime execution of untrusted packages or lifecycle scripts",
  "offline default: registry/network not contacted by this CLI",
  "a newer version alone is not a break",
  "unused export change is not a caller defect",
]);

export function createBasePacket({ command, input, modulesStatus = {} }) {
  const evidenceClass = deriveEvidenceClass(input);
  return {
    schema: PACKET_SCHEMA,
    createdAt: input.clock,
    clock: input.clock,
    command,
    ok: true,
    offline: input.liveCapture !== true,
    execute: false,
    posted: false,
    payment: { attempted: false },
    cost: {
      assignmentSpendUsd: 0,
      note: "offline compare; no purchase; do not invent paid demand",
    },
    caller: {
      manifestPath: input.manifestPath || null,
      lockfilePath: input.lockfilePath || null,
      sourceRoots: Array.isArray(input.sourceRoots) ? [...input.sourceRoots] : [],
      evidenceClass,
    },
    dependency: {
      name: input.dep || null,
      oldVersion: input.old || null,
      newVersion: input.new || null,
      resolvedOld: null,
      resolvedNew: null,
    },
    provenance: [],
    usage: {
      items: [],
      dynamicImport: false,
      coverage: "unknown",
    },
    exportDiff: {
      added: [],
      removed: [],
      renamed: [],
      signatureChanged: [],
      coverage: "unknown",
    },
    bindings: [],
    summary: {
      nextAction: "unknown",
      unknownReasons: [],
      unusedChanges: [],
      actionableChanges: [],
    },
    prior: {
      path: input.priorPath || null,
      sha256: null,
      sequence: 0,
      immutable: true,
      correction: null,
    },
    limitations: [...STATIC_LIMITATIONS],
    pipeline: {
      command,
      srcRoot: input.srcRoot || null,
      offline: input.liveCapture !== true,
      liveCaptureRequested: input.liveCapture === true,
      modules: modulesStatus,
    },
  };
}

export function deriveEvidenceClass(input) {
  if (input.evidenceClass && EVIDENCE_LABELS.includes(input.evidenceClass)) {
    return input.evidenceClass;
  }
  if (
    input.fixtureOld ||
    input.fixtureNew ||
    input.manifestPath ||
    input.lockfilePath ||
    (Array.isArray(input.sourceRoots) && input.sourceRoots.length > 0)
  ) {
    return "fixture";
  }
  return "synthetic";
}

export function mergeOverlay(packet, overlay) {
  if (overlay == null) return packet;
  if (typeof overlay !== "object" || Array.isArray(overlay)) return packet;
  if (overlay.packet && typeof overlay.packet === "object") {
    return mergeOverlay(packet, overlay.packet);
  }
  const src = overlay.overlay && typeof overlay.overlay === "object" ? overlay.overlay : overlay;
  const next = { ...packet };

  if (src.fatal === true || src.error?.code === "input_file_error") next.ok = false;
  if (src.offline === false) next.offline = false;

  if (src.caller && typeof src.caller === "object") {
    next.caller = { ...next.caller, ...src.caller };
    if (Array.isArray(src.caller.sourceRoots)) next.caller.sourceRoots = [...src.caller.sourceRoots];
  }
  if (src.dependency && typeof src.dependency === "object") {
    next.dependency = { ...next.dependency, ...src.dependency };
  }
  if (src.usage !== undefined) next.usage = normalizeUsage(src.usage, next.usage);
  if (src.exportDiff !== undefined) next.exportDiff = normalizeExportDiff(src.exportDiff, next.exportDiff);
  if (Array.isArray(src.bindings)) next.bindings = [...src.bindings];
  if (Array.isArray(src.provenance)) next.provenance = mergeByKey(next.provenance, src.provenance, provenanceKey);
  if (src.summary && typeof src.summary === "object") {
    next.summary = {
      ...next.summary,
      ...src.summary,
      unknownReasons: dedupe([
        ...(next.summary.unknownReasons || []),
        ...(src.summary.unknownReasons || []),
      ]),
      unusedChanges: dedupe([
        ...(next.summary.unusedChanges || []),
        ...(src.summary.unusedChanges || []),
      ]),
      actionableChanges: dedupe([
        ...(next.summary.actionableChanges || []),
        ...(src.summary.actionableChanges || []),
      ]),
    };
  }
  if (src.prior && typeof src.prior === "object") {
    next.prior = { ...next.prior, ...src.prior };
  }
  if (Array.isArray(src.limitations)) {
    next.limitations = dedupe([...(next.limitations || []), ...src.limitations]);
  }
  if (Array.isArray(src.unknownReasons)) {
    next.summary = {
      ...next.summary,
      unknownReasons: dedupe([...(next.summary.unknownReasons || []), ...src.unknownReasons]),
    };
  }
  if (src.lockfile && typeof src.lockfile === "object") {
    next.lockfile = { ...(next.lockfile || {}), ...src.lockfile };
  }
  if (src.acquired && typeof src.acquired === "object") {
    next.pipeline = { ...(next.pipeline || {}), acquired: src.acquired };
  }
  if (src.error && typeof src.error === "object") {
    next.error = src.error;
    if (src.fatal === true) next.ok = false;
  }
  return next;
}

function provenanceKey(row) {
  return row?.url || row?.path || JSON.stringify(row);
}

function mergeByKey(existing, incoming, keyFn) {
  const out = [...(existing || [])];
  const seen = new Set(out.map(keyFn));
  for (const row of incoming || []) {
    const key = keyFn(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function normalizeUsage(incoming, fallback) {
  if (Array.isArray(incoming)) {
    const items = incoming;
    return {
      items,
      dynamicImport: items.some((row) => row && row.dynamicImport === true),
      coverage: fallback?.coverage || "unknown",
    };
  }
  if (incoming && typeof incoming === "object") {
    const items = Array.isArray(incoming.items) ? incoming.items : [];
    const dynamicImport =
      incoming.dynamicImport === true || items.some((row) => row && row.dynamicImport === true);
    return {
      ...fallback,
      ...incoming,
      items,
      dynamicImport,
      coverage: incoming.coverage || fallback?.coverage || "unknown",
    };
  }
  return fallback;
}

function normalizeExportDiff(incoming, fallback) {
  if (!incoming || typeof incoming !== "object") return fallback;
  return {
    added: asArray(incoming.added, fallback?.added),
    removed: asArray(incoming.removed, fallback?.removed),
    renamed: asArray(incoming.renamed, fallback?.renamed),
    signatureChanged: asArray(incoming.signatureChanged, fallback?.signatureChanged),
    coverage: incoming.coverage || fallback?.coverage || "unknown",
    ...pickUnknown(incoming, ["added", "removed", "renamed", "signatureChanged", "coverage"]),
  };
}

function pickUnknown(obj, known) {
  const extra = {};
  for (const key of Object.keys(obj)) {
    if (!known.includes(key)) extra[key] = obj[key];
  }
  return extra;
}

function asArray(value, fallback) {
  if (Array.isArray(value)) return value;
  return Array.isArray(fallback) ? fallback : [];
}

export function finalizePacket(packet) {
  const next = {
    ...packet,
    usage: normalizeUsage(packet.usage, { items: [], dynamicImport: false, coverage: "unknown" }),
    exportDiff: normalizeExportDiff(packet.exportDiff, {
      added: [],
      removed: [],
      renamed: [],
      signatureChanged: [],
      coverage: "unknown",
    }),
    bindings: Array.isArray(packet.bindings) ? packet.bindings.map((row) => ({ ...row })) : [],
    limitations: dedupe(packet.limitations || []),
    provenance: Array.isArray(packet.provenance) ? [...packet.provenance] : [],
  };

  const unknownReasons = [...(next.summary?.unknownReasons || [])];
  const unusedChanges = [];
  const actionableChanges = [];
  const disagreement = hasLockfileDisagreement(next);
  const sameVersion = isSameDeclaredVersion(next.dependency);
  const packageDynamicImport = next.usage?.dynamicImport === true;
  const analysisCoverageUnknown =
    next.usage?.coverage === "unknown" || next.exportDiff?.coverage === "unknown";

  for (const binding of next.bindings) {
    if (!DECISIONS.includes(binding.decision)) binding.decision = "unknown";
    const changed = isChangedKind(binding.changeKind);
    const dynamic = binding.dynamicImport === true || packageDynamicImport;

    if (!binding.used && changed) {
      unusedChanges.push(symbolOf(binding));
      if (binding.decision === "action") {
        binding.decision = "no_action";
        binding.rationale = appendRationale(
          binding.rationale,
          "unused export change is not a caller defect",
        );
      }
    }

    if (binding.used && dynamic && binding.decision === "action") {
      binding.decision = "unknown";
      binding.rationale = appendRationale(
        binding.rationale,
        "dynamic import of package ⇒ unknown for that surface",
      );
    }

    if (sameVersion && !disagreement && binding.decision === "action") {
      binding.decision = "no_action";
      binding.rationale = appendRationale(
        binding.rationale,
        "same-version/no-op is not an upgrade impact",
      );
    }

    if (binding.used && binding.decision === "action" && changed) {
      actionableChanges.push(symbolOf(binding));
    }
    if (binding.decision === "unknown" || (binding.used && dynamic)) {
      unknownReasons.push(
        binding.used && dynamic
          ? `dynamic_import:${symbolOf(binding)}`
          : `binding_unknown:${symbolOf(binding)}`,
      );
    }
  }

  if (disagreement) {
    unknownReasons.push("lockfile_alias_or_workspace_disagreement");
    next.limitations = dedupe([
      ...next.limitations,
      "alias/workspace/lockfile disagreement ⇒ unknown until resolved",
    ]);
  }

  if (analysisCoverageUnknown && actionableChanges.length === 0) {
    unknownReasons.push("partial_or_missing_source_or_analysis");
  }

  if (packageDynamicImport) {
    unknownReasons.push("dynamic_import_unknown_surface");
  }

  const incomingAction = packet.summary?.nextAction;
  let nextAction;
  if (disagreement) {
    nextAction = "unknown";
  } else if (sameVersion) {
    nextAction = "no_action";
  } else if (actionableChanges.length > 0) {
    nextAction = "action";
  } else if (unusedChanges.length > 0 && unknownReasonsAreOnlyUnused(unknownReasons, next)) {
    nextAction = "no_action";
  } else if (dedupe(unknownReasons).length > 0) {
    nextAction = "unknown";
  } else {
    nextAction = "no_action";
  }

  // Non-negotiable: never treat a version bump with no used-export binding as action.
  if (nextAction === "action" && actionableChanges.length === 0) {
    nextAction = unknownReasons.length > 0 ? "unknown" : "no_action";
    unknownReasons.push("refused_action_without_used_export_binding");
  }

  next.summary = {
    ...(next.summary || {}),
    nextAction,
    unknownReasons: dedupe(unknownReasons),
    unusedChanges: dedupe(unusedChanges),
    actionableChanges: dedupe(actionableChanges),
  };
  if (incomingAction === "review_breakages" || incomingAction === "upgrade_with_edits") {
    next.summary.suggestedAction = incomingAction;
  }

  if (next.caller && !EVIDENCE_LABELS.includes(next.caller.evidenceClass)) {
    next.caller.evidenceClass = "synthetic";
    next.limitations = dedupe([
      ...next.limitations,
      "caller.evidenceClass was not fixture|live-capture|synthetic; labeled synthetic",
    ]);
  }

  for (const row of next.provenance) {
    if (row && !EVIDENCE_LABELS.includes(row.label)) {
      row.label = next.caller.evidenceClass || "synthetic";
    }
  }

  return next;
}

function unknownReasonsAreOnlyUnused(unknownReasons, packet) {
  const coverageKnown =
    packet.usage?.coverage &&
    packet.usage.coverage !== "unknown" &&
    packet.exportDiff?.coverage &&
    packet.exportDiff.coverage !== "unknown";
  const leftover = dedupe(unknownReasons).filter((reason) => {
    if (reason.startsWith("binding_unknown:")) return false;
    if (reason.startsWith("missing_module:")) return !coverageKnown;
    if (reason === "partial_or_missing_source_or_analysis") return !coverageKnown;
    if (reason.startsWith("dynamic_import")) return true;
    if (reason === "lockfile_alias_or_workspace_disagreement") return true;
    if (reason.startsWith("module_error:") || reason.startsWith("module_threw:")) return true;
    if (reason === "live_capture_requested_without_acquire_module") return !coverageKnown;
    if (reason === "input_file_error") return true;
    return !coverageKnown;
  });
  return leftover.length === 0;
}

export function isSameDeclaredVersion(dependency = {}) {
  if (dependency.oldVersion == null || dependency.newVersion == null) return false;
  return String(dependency.oldVersion) === String(dependency.newVersion);
}

export function hasLockfileDisagreement(packet) {
  const dep = packet.dependency || {};
  const lock = packet.lockfile || {};
  if (dep.lockfileDisagreement === true || dep.aliasDisagreement === true) return true;
  if (lock.disagreement === true || lock.conflicts === true) return true;
  if (Array.isArray(lock.conflicts) && lock.conflicts.length > 0) return true;
  if (Array.isArray(lock.disagreements) && lock.disagreements.length > 0) return true;
  const resolvedClash =
    dep.resolvedOld &&
    dep.resolvedNew &&
    dep.oldVersion &&
    dep.newVersion &&
    String(dep.oldVersion) === String(dep.newVersion) &&
    String(dep.resolvedOld) !== String(dep.resolvedNew);
  if (resolvedClash) return true;
  return (packet.summary?.unknownReasons || []).includes("lockfile_alias_or_workspace_disagreement");
}

function isChangedKind(kind) {
  if (!kind || kind === "unchanged" || kind === "none") return false;
  return true;
}

function symbolOf(binding) {
  return binding.symbol || binding.name || binding.export || "(unnamed)";
}

function appendRationale(existing, extra) {
  const text = typeof existing === "string" ? existing.trim() : "";
  if (!text) return extra;
  if (text.includes(extra)) return text;
  return `${text}; ${extra}`;
}

export function dedupe(values) {
  const out = [];
  const seen = new Set();
  for (const value of values || []) {
    if (value == null || value === "") continue;
    const key = typeof value === "string" ? value : JSON.stringify(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export function requiredPacketFields() {
  return [
    "schema",
    "createdAt",
    "clock",
    "caller",
    "dependency",
    "provenance",
    "usage",
    "exportDiff",
    "bindings",
    "summary",
    "prior",
    "limitations",
  ];
}
