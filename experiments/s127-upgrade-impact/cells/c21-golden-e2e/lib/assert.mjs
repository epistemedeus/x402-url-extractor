/**
 * Integrator assertion helper for the c21 golden packet.
 * Does not import or spawn the pack CLI. Compare a producer packet to the
 * golden using required PACKET-CONTRACT fields and the three must-hold
 * binding triples.
 */

import { existsSync, readFileSync } from "node:fs";
import {
  ASSERTIONS_SCHEMA,
  BASE_LIMITATIONS,
  CHANGE_KINDS,
  DECISIONS,
  EVIDENCE_LABELS,
  GOLDEN_BINDINGS,
  PACKET_SCHEMA,
  REQUIRED_BINDING_FIELDS,
  REQUIRED_CALLER_FIELDS,
  REQUIRED_DEPENDENCY_FIELDS,
  REQUIRED_PACKET_FIELDS,
  REQUIRED_PROVENANCE_FIELDS,
  REQUIRED_SUMMARY_FIELDS,
  UNKNOWN_REASON_NEEDLES,
  asSymbolList,
  isPlainObject,
  nextActionMatches,
  symbolOf,
} from "./contract.mjs";
import { sha256File } from "./hash.mjs";
import {
  GOLDEN_ASSERTIONS_PATH,
  GOLDEN_PACKET_PATH,
  PACK_ROOT,
  resolvePackRel,
} from "./paths.mjs";

export function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadGoldenPacket(path = GOLDEN_PACKET_PATH) {
  return loadJson(path);
}

export function loadGoldenAssertions(path = GOLDEN_ASSERTIONS_PATH) {
  return loadJson(path);
}

function failList() {
  return { ok: true, errors: [], warnings: [] };
}

function pushError(out, message) {
  out.ok = false;
  out.errors.push(message);
}

function pushWarn(out, message) {
  out.warnings.push(message);
}

function locatorOf(row) {
  if (!isPlainObject(row)) return null;
  return row.url || row.path || row.locator || null;
}

function bindingMap(bindings) {
  const map = new Map();
  for (const row of Array.isArray(bindings) ? bindings : []) {
    const symbol = symbolOf(row);
    if (symbol) map.set(symbol, row);
  }
  return map;
}

function reasonsText(list) {
  return (Array.isArray(list) ? list : []).map((row) => String(row).toLowerCase());
}

function hasUnknownNeedle(unknownReasons) {
  const texts = reasonsText(unknownReasons);
  return UNKNOWN_REASON_NEEDLES.some((needle) =>
    texts.some((text) => text.includes(String(needle).toLowerCase())),
  );
}

export function validatePacket(packet) {
  const out = failList();
  if (!isPlainObject(packet)) {
    pushError(out, "packet must be a plain object");
    return out;
  }

  for (const field of REQUIRED_PACKET_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(packet, field) || packet[field] === undefined) {
      pushError(out, `missing required field: ${field}`);
    }
  }

  if (packet.schema !== PACKET_SCHEMA) {
    pushError(out, `schema must be ${PACKET_SCHEMA}, got ${JSON.stringify(packet.schema)}`);
  }
  if (!packet.clock) pushError(out, "clock is required; producers must not invent Date.now()");
  if (!packet.createdAt) pushError(out, "createdAt is required");

  if (!isPlainObject(packet.caller)) {
    pushError(out, "caller must be an object");
  } else {
    for (const field of REQUIRED_CALLER_FIELDS) {
      if (packet.caller[field] == null) pushError(out, `caller.${field} is required`);
    }
    if (!Array.isArray(packet.caller.sourceRoots) || packet.caller.sourceRoots.length === 0) {
      pushError(out, "caller.sourceRoots must be a non-empty array");
    }
    if (packet.caller.evidenceClass && !EVIDENCE_LABELS.includes(packet.caller.evidenceClass)) {
      pushError(out, `caller.evidenceClass must be one of ${EVIDENCE_LABELS.join("|")}`);
    }
  }

  if (!isPlainObject(packet.dependency)) {
    pushError(out, "dependency must be an object");
  } else {
    for (const field of REQUIRED_DEPENDENCY_FIELDS) {
      if (packet.dependency[field] == null || packet.dependency[field] === "") {
        pushError(out, `dependency.${field} is required`);
      }
    }
  }

  if (!Array.isArray(packet.provenance) || packet.provenance.length === 0) {
    pushError(out, "provenance must be a non-empty array");
  } else {
    packet.provenance.forEach((row, i) => {
      if (!isPlainObject(row)) {
        pushError(out, `provenance[${i}] must be an object`);
        return;
      }
      if (!locatorOf(row)) pushError(out, `provenance[${i}] needs url|path|locator`);
      for (const field of REQUIRED_PROVENANCE_FIELDS) {
        if (row[field] == null || row[field] === "") {
          pushError(out, `provenance[${i}].${field} is required`);
        }
      }
      if (row.label && !EVIDENCE_LABELS.includes(row.label)) {
        pushError(out, `provenance[${i}].label must be fixture|live-capture|synthetic`);
      }
    });
  }

  if (!isPlainObject(packet.usage)) pushError(out, "usage must be an object");
  if (!isPlainObject(packet.exportDiff)) {
    pushError(out, "exportDiff must be an object");
  } else {
    for (const key of ["added", "removed"]) {
      if (!Array.isArray(packet.exportDiff[key])) {
        pushError(out, `exportDiff.${key} must be an array`);
      }
    }
    if (!packet.exportDiff.coverage) pushError(out, "exportDiff.coverage is required");
  }

  if (!Array.isArray(packet.bindings)) {
    pushError(out, "bindings must be an array");
  } else {
    packet.bindings.forEach((row, i) => {
      if (!isPlainObject(row)) {
        pushError(out, `bindings[${i}] must be an object`);
        return;
      }
      for (const field of REQUIRED_BINDING_FIELDS) {
        if (row[field] == null || row[field] === "") {
          pushError(out, `bindings[${i}].${field} is required`);
        }
      }
      if (typeof row.used !== "boolean") pushError(out, `bindings[${i}].used must be boolean`);
      if (row.decision && !DECISIONS.includes(row.decision)) {
        pushError(out, `bindings[${i}].decision must be action|unknown|no_action`);
      }
      if (row.changeKind && !CHANGE_KINDS.includes(row.changeKind)) {
        pushError(out, `bindings[${i}].changeKind is not a known kind`);
      }
    });
  }

  if (!isPlainObject(packet.summary)) {
    pushError(out, "summary must be an object");
  } else {
    for (const field of REQUIRED_SUMMARY_FIELDS) {
      if (packet.summary[field] == null) pushError(out, `summary.${field} is required`);
    }
    for (const field of ["unknownReasons", "unusedChanges", "actionableChanges"]) {
      if (!Array.isArray(packet.summary[field])) {
        pushError(out, `summary.${field} must be an array`);
      }
    }
  }

  if (!Array.isArray(packet.limitations) || packet.limitations.length === 0) {
    pushError(out, "limitations must be a non-empty array");
  }

  if (packet.prior === undefined) pushError(out, "prior is required (null ref is allowed)");
  return out;
}

export function assertGoldenDecisions(packet) {
  const out = failList();
  if (!isPlainObject(packet)) {
    pushError(out, "packet must be a plain object");
    return out;
  }
  const bySymbol = bindingMap(packet.bindings);
  for (const expected of GOLDEN_BINDINGS) {
    const actual = bySymbol.get(expected.symbol);
    if (!actual) {
      pushError(out, `missing binding for ${expected.symbol}`);
      continue;
    }
    if (Boolean(actual.used) !== expected.used) {
      pushError(
        out,
        `binding ${expected.symbol}.used expected ${expected.used}, got ${actual.used}`,
      );
    }
    if (actual.changeKind !== expected.changeKind) {
      pushError(
        out,
        `binding ${expected.symbol}.changeKind expected ${expected.changeKind}, got ${actual.changeKind}`,
      );
    }
    if (actual.decision !== expected.decision) {
      pushError(
        out,
        `binding ${expected.symbol}.decision expected ${expected.decision}, got ${actual.decision}`,
      );
    }
    if (expected.dynamicImport === true && actual.dynamicImport === false) {
      pushError(out, `binding ${expected.symbol} must be marked dynamicImport: true`);
    }
  }

  if (!nextActionMatches(packet.summary?.nextAction, "action")) {
    pushError(
      out,
      `summary.nextAction expected action (alias review_breakages allowed), got ${JSON.stringify(packet.summary?.nextAction)}`,
    );
  }

  const actionable = asSymbolList(packet.summary?.actionableChanges);
  if (!actionable.includes("usedRemoved")) {
    pushError(out, "summary.actionableChanges must include usedRemoved");
  }
  if (actionable.includes("unusedRemoved")) {
    pushError(out, "summary.actionableChanges must not include unusedRemoved");
  }
  if (actionable.includes("dynamicRemoved")) {
    pushError(out, "summary.actionableChanges must not include dynamicRemoved");
  }

  const unused = asSymbolList(packet.summary?.unusedChanges);
  if (!unused.includes("unusedRemoved")) {
    pushError(out, "summary.unusedChanges must include unusedRemoved");
  }
  if (unused.includes("usedRemoved")) {
    pushError(out, "summary.unusedChanges must not include usedRemoved");
  }

  if (!hasUnknownNeedle(packet.summary?.unknownReasons)) {
    pushError(
      out,
      `summary.unknownReasons must mention dynamic import; got ${JSON.stringify(packet.summary?.unknownReasons)}`,
    );
  }

  const removed = asSymbolList(packet.exportDiff?.removed);
  for (const symbol of ["usedRemoved", "unusedRemoved", "dynamicRemoved"]) {
    if (!removed.includes(symbol)) {
      pushError(out, `exportDiff.removed must include ${symbol}`);
    }
  }

  const dep = packet.dependency || {};
  if (dep.oldVersion && dep.newVersion && String(dep.oldVersion) === String(dep.newVersion)) {
    pushError(out, "this golden is a version change; same-version/no-op is a different case");
  }

  return out;
}

export function compareToGolden(actual, golden = loadGoldenPacket(), options = {}) {
  const out = failList();
  const ignoreClock = options.ignoreClock !== false;
  const requireProvenanceHash = options.requireProvenanceHash !== false;

  const goldenCheck = validatePacket(golden);
  if (!goldenCheck.ok) {
    for (const err of goldenCheck.errors) pushError(out, `golden invalid: ${err}`);
    return out;
  }

  const actualCheck = validatePacket(actual);
  if (!actualCheck.ok) {
    for (const err of actualCheck.errors) pushError(out, `actual invalid: ${err}`);
  }

  const decisions = assertGoldenDecisions(actual);
  for (const err of decisions.errors) pushError(out, err);
  for (const warn of decisions.warnings) pushWarn(out, warn);

  if (isPlainObject(actual?.caller) && isPlainObject(golden.caller)) {
    if (actual.caller.evidenceClass !== golden.caller.evidenceClass) {
      pushError(
        out,
        `caller.evidenceClass expected ${golden.caller.evidenceClass}, got ${actual.caller.evidenceClass}`,
      );
    }
  }

  if (isPlainObject(actual?.dependency) && isPlainObject(golden.dependency)) {
    for (const field of ["name", "oldVersion", "newVersion"]) {
      if (String(actual.dependency[field]) !== String(golden.dependency[field])) {
        pushError(
          out,
          `dependency.${field} expected ${golden.dependency[field]}, got ${actual.dependency[field]}`,
        );
      }
    }
  }

  if (!ignoreClock && actual?.clock !== golden.clock) {
    pushError(out, `clock expected ${golden.clock}, got ${actual.clock}`);
  }

  if (requireProvenanceHash && Array.isArray(actual?.provenance)) {
    for (const row of actual.provenance) {
      const loc = locatorOf(row);
      const abs = resolvePackRel(loc);
      if (row?.contentSha256 && loc && existsSync(abs)) {
        const digest = sha256File(abs);
        if (digest !== row.contentSha256) {
          pushError(out, `provenance hash mismatch for ${loc}`);
        }
      }
    }
  }

  const live = (actual?.provenance || []).some((row) => row?.label === "live-capture");
  if (live) {
    pushError(out, "this golden is synthetic; do not label it live-capture");
  }

  return out;
}

export function verifyGoldenProvenance(packet = loadGoldenPacket(), packRoot = PACK_ROOT) {
  const out = failList();
  for (const row of packet.provenance || []) {
    const loc = locatorOf(row);
    if (!loc) continue;
    const abs = loc.startsWith("/") ? loc : resolvePackRel(loc);
    if (!existsSync(abs)) {
      pushError(out, `provenance path missing: ${loc}`);
      continue;
    }
    const digest = sha256File(abs);
    if (row.contentSha256 && digest !== row.contentSha256) {
      pushError(out, `contentSha256 mismatch for ${loc}: expected ${row.contentSha256}, got ${digest}`);
    }
    if (row.label === "live-capture") {
      pushError(out, `${loc} labeled live-capture; this cell is synthetic`);
    }
  }
  return out;
}

export function expectedLimitations() {
  return [...BASE_LIMITATIONS];
}

export { ASSERTIONS_SCHEMA, GOLDEN_BINDINGS, PACKET_SCHEMA };
