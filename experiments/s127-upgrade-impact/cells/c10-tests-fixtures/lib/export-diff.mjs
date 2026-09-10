import { readFileSync } from "node:fs";
import { acquirePackageTree } from "./acquire.mjs";
import { uniqueStrings } from "./hash.mjs";
import { scanModuleSource } from "./scan-source.mjs";

function asAcquire(input, label) {
  if (!input) {
    return acquirePackageTree({ path: null, label });
  }
  if (typeof input === "string") {
    return acquirePackageTree({ path: input, label });
  }
  if (input.files && input.coverage) return input;
  return acquirePackageTree({ ...input, label: input.label || label });
}

function scanEntry(acq) {
  if (!acq?.entryPath) {
    return { exports: [], limitations: acq?.limitations || ["missing_entry"], coverage: acq?.coverage || "unknown" };
  }
  const source = readFileSync(acq.entryPath, "utf8");
  const scanned = scanModuleSource(source, { filename: acq.entryPath });
  return {
    exports: scanned.exports,
    limitations: scanned.limitations,
    coverage: acq.coverage === "full" ? "full" : acq.coverage,
  };
}

function indexByName(rows) {
  const map = new Map();
  for (const row of rows) map.set(row.name, row);
  return map;
}

function detectRenames(removed, added, oldMap, newMap) {
  const renamed = [];
  const usedRemoved = new Set();
  const usedAdded = new Set();
  if (removed.length === 1 && added.length === 1) {
    const from = removed[0];
    const to = added[0];
    const oldRow = oldMap.get(from);
    const newRow = newMap.get(to);
    if ((oldRow?.arity ?? null) === (newRow?.arity ?? null) || oldRow?.arity == null || newRow?.arity == null) {
      renamed.push({ from, to });
      usedRemoved.add(from);
      usedAdded.add(to);
      return { renamed, usedRemoved, usedAdded };
    }
  }

  for (const from of removed) {
    const oldRow = oldMap.get(from);
    const matches = added.filter((to) => {
      if (usedAdded.has(to)) return false;
      const newRow = newMap.get(to);
      return oldRow?.kind === newRow?.kind && oldRow?.arity != null && oldRow.arity === newRow?.arity;
    });
    if (matches.length === 1) {
      renamed.push({ from, to: matches[0] });
      usedRemoved.add(from);
      usedAdded.add(matches[0]);
    }
  }
  renamed.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  return { renamed, usedRemoved, usedAdded };
}

export function diffExports(oldTree, newTree) {
  const oldAcq = asAcquire(oldTree, "synthetic");
  const newAcq = asAcquire(newTree, "synthetic");
  const limitations = [...(oldAcq.limitations || []), ...(newAcq.limitations || [])];

  const oldScan = scanEntry(oldAcq);
  const newScan = scanEntry(newAcq);
  limitations.push(...oldScan.limitations, ...newScan.limitations);

  let coverage = "full";
  if (oldAcq.coverage !== "full" || newAcq.coverage !== "full") {
    coverage = oldAcq.coverage === "unknown" || newAcq.coverage === "unknown" ? "unknown" : "partial";
  }
  if (!oldAcq.entryPath || !newAcq.entryPath) {
    coverage = coverage === "unknown" ? "unknown" : "partial";
  }

  const oldMap = indexByName(oldScan.exports);
  const newMap = indexByName(newScan.exports);
  const oldNames = [...oldMap.keys()].sort();
  const newNames = [...newMap.keys()].sort();

  const added = newNames.filter((name) => !oldMap.has(name));
  const removed = oldNames.filter((name) => !newMap.has(name));
  const { renamed, usedRemoved, usedAdded } = detectRenames(removed, added, oldMap, newMap);

  const addedOut = added.filter((name) => !usedAdded.has(name));
  const removedOut = removed.filter((name) => !usedRemoved.has(name));

  const signatureChanged = [];
  for (const name of oldNames) {
    if (!newMap.has(name)) continue;
    const oldRow = oldMap.get(name);
    const newRow = newMap.get(name);
    if (oldRow.arity != null && newRow.arity != null && oldRow.arity !== newRow.arity) {
      signatureChanged.push(name);
    }
  }

  if (coverage !== "full") {
    limitations.push("partial or missing package source; export diff coverage is not full");
  }
  limitations.push("arity is a coarse signature; TypeScript types are unknown");

  return {
    added: addedOut,
    removed: removedOut,
    renamed,
    signatureChanged,
    coverage,
    limitations: uniqueStrings(limitations),
    oldExports: oldNames,
    newExports: newNames,
    oldAcquire: oldAcq,
    newAcquire: newAcq,
  };
}
