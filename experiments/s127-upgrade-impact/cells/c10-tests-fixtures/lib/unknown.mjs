import { uniqueStrings } from "./hash.mjs";
import { parseSemver } from "./lockfile.mjs";

function cloneBindings(bindings) {
  return (bindings || []).map((row) => ({ ...row }));
}

function demoteAction(bindings, rationale, extra = {}) {
  for (const row of bindings) {
    if (row.decision === "action") {
      row.decision = "unknown";
      row.rationale = rationale;
      Object.assign(row, extra);
    }
  }
}

export function applyUnknownRules(ctx = {}) {
  const bindings = cloneBindings(ctx.bindings);
  const limitations = [...(ctx.limitations || [])];
  const unknownReasons = [...(ctx.unknownReasons || [])];

  const coverage = ctx.exportDiff?.coverage;
  if (coverage && coverage !== "full") {
    unknownReasons.push("partial_source");
    limitations.push("partial or missing package source; export diff coverage is not full");
    demoteAction(bindings, "missing/partial source; cannot claim action");
  }

  const disagreements = ctx.lockfile?.disagreements || [];
  if (disagreements.length) {
    for (const row of disagreements) {
      unknownReasons.push(row.kind);
    }
    demoteAction(bindings, "lockfile/alias/workspace disagreement; cannot claim action");
  }

  for (const reason of ctx.lockfile?.unknownReasons || []) {
    unknownReasons.push(reason);
  }

  const usage = Array.isArray(ctx.usage) ? ctx.usage : ctx.usage?.usage || [];
  const dynamic = usage.some((row) => row.dynamicImport) || bindings.some((row) => row.dynamicImport);
  if (dynamic) {
    unknownReasons.push("dynamic_import");
    limitations.push("dynamic import of package; contribution is unknown");
    for (const row of bindings) {
      if (row.dynamicImport && row.decision === "action") {
        row.decision = "unknown";
        row.rationale = "dynamic import of package; contribution is unknown";
      }
    }
    const onlyDynamicUse = usage.length > 0 && usage.every((row) => row.dynamicImport || row.typeOnly);
    if (onlyDynamicUse) {
      demoteAction(bindings, "dynamic import of package; contribution is unknown");
    }
  }

  const oldV = ctx.dependency?.oldVersion;
  const newV = ctx.dependency?.newVersion;
  const sameVersion = oldV != null && String(oldV) === String(newV);
  const oldHash = ctx.acquire?.old?.treeSha256;
  const newHash = ctx.acquire?.new?.treeSha256;
  const hashesEqual = Boolean(oldHash && newHash && oldHash === newHash);

  if (sameVersion && hashesEqual) {
    for (const row of bindings) {
      row.decision = "no_action";
      row.rationale = "same-version no-op";
    }
    const keep = unknownReasons.filter((reason) => reason !== "partial_source" && reason !== "dynamic_import");
    unknownReasons.length = 0;
    unknownReasons.push(...keep.filter((reason) => reason.startsWith("missing_")));
  } else if (sameVersion && oldHash && newHash && !hashesEqual) {
    unknownReasons.push("conflicting_source_same_version");
    limitations.push("same version string but package trees differ; treating source as conflicting");
    demoteAction(bindings, "conflicting source at the same version; cannot claim action");
  }

  const newParsed = parseSemver(newV);
  if (newParsed?.prerelease?.length) {
    limitations.push(`prerelease newVersion ${newV}; a newer version alone is not a break`);
    limitations.push("prerelease");
  }

  if (ctx.acquire?.old?.coverage && ctx.acquire.old.coverage !== "full") {
    unknownReasons.push("partial_source");
  }
  if (ctx.acquire?.new?.coverage && ctx.acquire.new.coverage !== "full") {
    unknownReasons.push("partial_source");
  }

  return {
    bindings,
    unknownReasons: uniqueStrings(unknownReasons),
    limitations: uniqueStrings(limitations),
  };
}

export function summarizeBindings(bindings, unknownReasons = []) {
  const actionableChanges = [];
  const unusedChanges = [];
  for (const row of bindings || []) {
    if (row.decision === "action") {
      actionableChanges.push({ symbol: row.symbol, changeKind: row.changeKind });
    } else if (row.used === false && row.changeKind !== "unchanged") {
      unusedChanges.push({ symbol: row.symbol, changeKind: row.changeKind });
    }
  }
  const reasons = uniqueStrings(unknownReasons);
  let nextAction = "no_action";
  if (actionableChanges.length) nextAction = "action";
  else if (reasons.length || (bindings || []).some((row) => row.decision === "unknown")) nextAction = "unknown";
  return {
    nextAction,
    unknownReasons: reasons,
    unusedChanges,
    actionableChanges,
  };
}
