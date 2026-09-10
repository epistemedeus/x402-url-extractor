import {
  CHANGE_KINDS,
  DECISIONS,
  EVIDENCE_LABELS,
  EXPORT_DIFF_COVERAGE,
  PACKET_SCHEMA,
  REQUIRED_PACKET_FIELDS,
} from "./constants.mjs";

export function validatePacket(packet) {
  const errors = [];
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    return { ok: false, errors: ["packet must be an object"] };
  }
  for (const key of REQUIRED_PACKET_FIELDS) {
    if (!(key in packet)) errors.push(`missing field: ${key}`);
  }
  if (packet.schema !== PACKET_SCHEMA) errors.push(`unexpected schema: ${packet.schema}`);
  if (typeof packet.clock !== "string" || !packet.clock) errors.push("clock required");
  if (typeof packet.createdAt !== "string" || !packet.createdAt) errors.push("createdAt required");

  const caller = packet.caller;
  if (!caller || typeof caller !== "object") errors.push("caller object required");
  else {
    if (!caller.manifestPath) errors.push("caller.manifestPath required");
    if (!Array.isArray(caller.sourceRoots)) errors.push("caller.sourceRoots array required");
    if (!EVIDENCE_LABELS.includes(caller.evidenceClass)) {
      errors.push(`caller.evidenceClass must be fixture|live-capture|synthetic`);
    }
  }

  const dep = packet.dependency;
  if (!dep || typeof dep !== "object") errors.push("dependency object required");
  else {
    for (const key of ["name", "oldVersion", "newVersion", "resolvedOld", "resolvedNew"]) {
      if (!(key in dep)) errors.push(`dependency.${key} required`);
    }
  }

  if (!Array.isArray(packet.provenance)) errors.push("provenance array required");
  else {
    packet.provenance.forEach((row, i) => {
      if (!row || typeof row !== "object") {
        errors.push(`provenance[${i}] must be an object`);
        return;
      }
      if (!row.url && !row.path) errors.push(`provenance[${i}] needs url or path`);
      if (!row.retrievedAt) errors.push(`provenance[${i}].retrievedAt required`);
      if (!("contentSha256" in row)) errors.push(`provenance[${i}].contentSha256 required`);
      if (!row.coverage) errors.push(`provenance[${i}].coverage required`);
      if (!EVIDENCE_LABELS.includes(row.label)) errors.push(`provenance[${i}].label invalid`);
    });
  }

  if (!Array.isArray(packet.usage)) errors.push("usage array required");
  else {
    packet.usage.forEach((row, i) => {
      if (row?.dynamicImport === true && row.decision === "action") {
        errors.push(`usage[${i}] dynamicImport cannot claim action`);
      }
    });
  }

  const diff = packet.exportDiff;
  if (!diff || typeof diff !== "object") errors.push("exportDiff object required");
  else {
    if (!Array.isArray(diff.added)) errors.push("exportDiff.added array required");
    if (!Array.isArray(diff.removed)) errors.push("exportDiff.removed array required");
    if (diff.renamed && !Array.isArray(diff.renamed)) errors.push("exportDiff.renamed must be an array");
    if (diff.signatureChanged && !Array.isArray(diff.signatureChanged)) {
      errors.push("exportDiff.signatureChanged must be an array");
    }
    if (!EXPORT_DIFF_COVERAGE.includes(diff.coverage)) errors.push("exportDiff.coverage invalid");
  }

  if (!Array.isArray(packet.bindings)) errors.push("bindings array required");
  else {
    packet.bindings.forEach((row, i) => {
      if (typeof row.symbol !== "string") errors.push(`bindings[${i}].symbol required`);
      if (typeof row.used !== "boolean") errors.push(`bindings[${i}].used boolean required`);
      if (!CHANGE_KINDS.includes(row.changeKind)) errors.push(`bindings[${i}].changeKind invalid`);
      if (!DECISIONS.includes(row.decision)) errors.push(`bindings[${i}].decision invalid`);
      if (!row.rationale) errors.push(`bindings[${i}].rationale required`);
    });
  }

  const summary = packet.summary;
  if (!summary || typeof summary !== "object") errors.push("summary object required");
  else {
    if (!DECISIONS.includes(summary.nextAction)) errors.push("summary.nextAction invalid");
    if (!Array.isArray(summary.unknownReasons)) errors.push("summary.unknownReasons array required");
    if (!Array.isArray(summary.unusedChanges)) errors.push("summary.unusedChanges array required");
    if (!Array.isArray(summary.actionableChanges)) errors.push("summary.actionableChanges array required");
  }

  if (!packet.prior || typeof packet.prior !== "object") errors.push("prior object required");
  if (!Array.isArray(packet.limitations)) errors.push("limitations array required");

  if (dep && String(dep.oldVersion) === String(dep.newVersion) && summary?.nextAction === "action") {
    errors.push("same-version packet must not claim action");
  }
  if (summary?.nextAction === "action" && (summary.actionableChanges || []).length === 0) {
    errors.push("action requires actionableChanges");
  }
  if (diff?.coverage && diff.coverage !== "full" && summary?.nextAction === "action") {
    errors.push("partial/unknown exportDiff coverage cannot claim action");
  }

  return { ok: errors.length === 0, errors };
}

export function assertPacket(packet) {
  const check = validatePacket(packet);
  if (!check.ok) throw new Error(`invalid packet: ${check.errors.join("; ")}`);
  return packet;
}
