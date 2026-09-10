import { isTrivialShape, nameProximity } from "./signature.mjs";

const COMPARABLE = new Set(["bounded", "alias"]);

/**
 * Diff two scanned surfaces. Version identity is ignored here — callers
 * decide versionBumpOnly from package.json + tree hashes.
 */
export function classifyExportDiff(oldSurface, newSurface) {
  const oldSyms = indexSymbols(oldSurface?.symbols || []);
  const newSyms = indexSymbols(newSurface?.symbols || []);

  const added = [];
  const removed = [];
  const signatureChanged = [];

  for (const [key, neu] of newSyms) {
    if (!oldSyms.has(key)) added.push(toChange(neu, "added"));
  }
  for (const [key, old] of oldSyms) {
    if (!newSyms.has(key)) removed.push(toChange(old, "removed"));
  }

  for (const [key, old] of oldSyms) {
    const neu = newSyms.get(key);
    if (!neu) continue;
    if (old.kind === "entry" || neu.kind === "entry") continue;
    const sig = compareSignatures(old, neu);
    if (sig) signatureChanged.push(sig);
  }

  const renamed = heuristicRenames(removed, added);
  const renamedOld = new Set(renamed.map((r) => keyOf(r.entry, r.from)));
  const renamedNew = new Set(renamed.map((r) => keyOf(r.entry, r.to)));
  const addedOut = added.filter((s) => !renamedNew.has(keyOf(s.entry, s.name)));
  const removedOut = removed.filter((s) => !renamedOld.has(keyOf(s.entry, s.name)));

  const coverages = [oldSurface?.coverage, newSurface?.coverage].filter(Boolean);
  let coverage = "full";
  if (coverages.includes("unknown") && coverages.every((c) => c === "unknown")) coverage = "unknown";
  else if (coverages.includes("unknown") || coverages.includes("partial")) coverage = "partial";

  const unknownReasons = unique([...(oldSurface?.unknownReasons || []), ...(newSurface?.unknownReasons || [])]);
  const limitations = unique([...(oldSurface?.limitations || []), ...(newSurface?.limitations || [])]);

  sortChanges(addedOut);
  sortChanges(removedOut);
  renamed.sort((a, b) => cmp(`${a.entry}\0${a.from}`, `${b.entry}\0${b.from}`));
  signatureChanged.sort((a, b) => cmp(`${a.entry}\0${a.name}`, `${b.entry}\0${b.name}`));

  return {
    added: addedOut,
    removed: removedOut,
    renamed,
    signatureChanged,
    coverage,
    unknownReasons,
    limitations,
  };
}

function heuristicRenames(removed, added) {
  const out = [];
  const usedRemoved = new Set();
  const usedAdded = new Set();
  const candidates = [];

  for (const r of removed) {
    if (r.kind === "entry") continue;
    if (!r.shape || isTrivialShape(r.shape)) continue;
    if (!COMPARABLE.has(r.signatureCoverage)) continue;
    for (const a of added) {
      if (a.kind === "entry") continue;
      if (a.entry !== r.entry) continue;
      if (Boolean(a.typeOnly) !== Boolean(r.typeOnly)) continue;
      if (a.kind !== r.kind && !(a.kind === "named" && r.kind === "named")) continue;
      if (a.shape !== r.shape) continue;
      if (!COMPARABLE.has(a.signatureCoverage)) continue;
      const prox = nameProximity(r.name, a.name);
      if (!prox.ok) continue;
      candidates.push({ r, a, distance: prox.distance, reason: prox.reason });
    }
  }

  candidates.sort((x, y) => x.distance - y.distance || cmp(x.r.name, y.r.name));

  for (const c of candidates) {
    const rk = keyOf(c.r.entry, c.r.name);
    const ak = keyOf(c.a.entry, c.a.name);
    if (usedRemoved.has(rk) || usedAdded.has(ak)) continue;
    const rMatches = candidates.filter((x) => x.r === c.r && !usedAdded.has(keyOf(x.a.entry, x.a.name)));
    const aMatches = candidates.filter((x) => x.a === c.a && !usedRemoved.has(keyOf(x.r.entry, x.r.name)));
    if (rMatches.length !== 1 || aMatches.length !== 1) continue;
    usedRemoved.add(rk);
    usedAdded.add(ak);
    out.push({
      entry: c.r.entry,
      from: c.r.name,
      to: c.a.name,
      name: c.a.name,
      symbol: c.a.name,
      kind: c.r.kind,
      typeOnly: Boolean(c.r.typeOnly),
      signature: c.a.signature || c.r.signature,
      heuristic: true,
      evidence: {
        reason: `same-signature+${c.reason}`,
        distance: c.distance,
        shape: c.r.shape,
        oldFile: c.r.file,
        newFile: c.a.file,
      },
    });
  }
  return out;
}

function compareSignatures(old, neu) {
  if (old.kind === "entry") return null;
  const typeOnlyFlip = Boolean(old.typeOnly) !== Boolean(neu.typeOnly);
  const oldOk = COMPARABLE.has(old.signatureCoverage) && old.signature;
  const neuOk = COMPARABLE.has(neu.signatureCoverage) && neu.signature;
  if (oldOk && neuOk) {
    if (old.signature !== neu.signature || old.shape !== neu.shape || typeOnlyFlip) {
      return {
        entry: old.entry,
        name: old.name,
        symbol: old.name,
        kind: neu.kind,
        typeOnly: Boolean(neu.typeOnly),
        before: old.signature,
        after: neu.signature,
        coverage: "bounded",
        evidence: {
          oldShape: old.shape,
          newShape: neu.shape,
          typeOnlyChanged: typeOnlyFlip,
          oldFile: old.file,
          newFile: neu.file,
        },
      };
    }
    return null;
  }
  if (typeOnlyFlip) {
    return {
      entry: old.entry,
      name: old.name,
      symbol: old.name,
      kind: neu.kind,
      typeOnly: Boolean(neu.typeOnly),
      before: old.signature,
      after: neu.signature,
      coverage: "unknown",
      evidence: { typeOnlyChanged: true, oldFile: old.file, newFile: neu.file },
    };
  }
  return null;
}

function indexSymbols(symbols) {
  const map = new Map();
  for (const s of symbols) {
    const key = keyOf(s.entry, s.name);
    if (!map.has(key)) map.set(key, s);
  }
  return map;
}

function keyOf(entry, name) {
  return `${entry ?? ""}\0${name ?? ""}`;
}

function toChange(sym, changeKind) {
  return {
    entry: sym.entry,
    name: sym.name,
    symbol: sym.symbol || sym.name,
    kind: sym.kind,
    typeOnly: Boolean(sym.typeOnly),
    signature: sym.signature ?? null,
    shape: sym.shape ?? null,
    signatureCoverage: sym.signatureCoverage ?? "none",
    source: sym.source ?? null,
    file: sym.file ?? null,
    changeKind,
  };
}

function sortChanges(arr) {
  arr.sort((a, b) => cmp(`${a.entry}\0${a.name}`, `${b.entry}\0${b.name}`));
}

function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function unique(arr) {
  return [...new Set(arr.filter(Boolean))];
}
