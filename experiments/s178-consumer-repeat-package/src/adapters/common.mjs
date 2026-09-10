import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { createHash } from "node:crypto";
import { createRepeatInput, createResult, normalizeDecision } from "../contract.mjs";

export const CLOCK_ISO =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function isIsoClock(value) {
  return typeof value === "string" && CLOCK_ISO.test(value);
}

export function sha256Bytes(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

export function sourceEntry(path) {
  if (!path || !existsSync(path)) return null;
  const st = statSync(path);
  return {
    path,
    bytes: st.isFile() ? st.size : null,
    kind: st.isDirectory() ? "directory" : "file",
  };
}

export function readJsonFile(path) {
  const text = readFileSync(path, "utf8");
  try {
    return { ok: true, value: JSON.parse(text), text };
  } catch (err) {
    const error = new Error(`Invalid JSON at ${path}: ${err.message}`);
    error.code = "invalid_json";
    return { ok: false, error, text };
  }
}

export function isDir(path) {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function isFile(path) {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

export function walkFiles(dir, acc = [], relBase = "") {
  if (!isDir(dir)) return acc;
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    const rel = relBase ? `${relBase}/${name}` : name;
    const st = statSync(abs);
    if (st.isDirectory()) walkFiles(abs, acc, rel);
    else if (st.isFile()) acc.push({ abs, rel, name });
  }
  return acc;
}

export function packetOf(native) {
  if (!native || typeof native !== "object") return native;
  if (native.brief && typeof native.brief === "object" && native.brief.decision) return native.brief;
  if (native.packet && typeof native.packet === "object" && native.packet.decision) {
    return native.packet;
  }
  return native;
}

export function decisionOf(native) {
  const p = packetOf(native);
  return p?.decision ?? native?.status ?? native?.packageStatus ?? null;
}

export function findingsOf(native) {
  const p = packetOf(native);
  if (Array.isArray(p?.findings) && p.findings.length) return p.findings;
  if (Array.isArray(native?.findings)) return native.findings;
  if (Array.isArray(native?.comparisons)) return native.comparisons;
  if (Array.isArray(native?.recipes)) return native.recipes;
  return [];
}

export function limitationsOf(native) {
  const p = packetOf(native);
  const list = [];
  if (Array.isArray(p?.limitations)) list.push(...p.limitations);
  else if (Array.isArray(native?.limitations)) list.push(...native.limitations);
  if (Array.isArray(native?.notes)) list.push(...native.notes);
  else if (typeof native?.notes === "string") list.push(native.notes);
  return list;
}

export function missingFromFindings(findings) {
  const missing = [];
  for (const f of findings || []) {
    const msg = String(f.message || f.id || "");
    if (
      f.kind === "partial" ||
      f.kind === "negative" ||
      /missing|absent|incomplete|undocumented|unreach|invalid|mismatch|conflict/i.test(msg)
    ) {
      missing.push(f.id || msg.slice(0, 120));
    }
  }
  return [...new Set(missing)].slice(0, 16);
}

export function repeatFor(job, decision, inputPath, native) {
  if (decision === "pass") return null;
  const findings = findingsOf(native);
  const missing = missingFromFindings(findings);
  const suggested = [];
  if (job?.examples?.positive) suggested.push(join(job.fixtureRoot, job.examples.positive));
  const base = {
    jobId: job.jobId,
    artifactId: job.artifactId,
    priorDecision: decision,
    suggestedPaths: [inputPath, ...suggested].filter(Boolean),
    missing: missing.length ? missing : undefined,
  };
  if (decision === "partial") {
    return createRepeatInput({
      ...base,
      reason: "partial_coverage",
      missing: missing.length ? missing : ["fields_or_sources_cited_in_findings"],
      nextActions: [
        "Inspect findings[] for exact uncovered rows/fields",
        "Supply the missing cited fragment and re-run",
        "Do not invent sources or paid outcomes",
      ],
    });
  }
  if (decision === "conflict") {
    return createRepeatInput({
      ...base,
      reason: "conflicting_sources",
      missing: missing.length ? missing : ["authoritative_resolution_input"],
      nextActions: [
        "Keep both cited identities; pick the authoritative source",
        "Re-run with reconciled bytes — do not silently merge",
      ],
    });
  }
  if (decision === "invalid") {
    return createRepeatInput({
      ...base,
      reason: "invalid_input",
      missing: missing.length ? missing : ["shape_valid_input"],
      nextActions: [
        "Compare against the positive example for this job",
        "Fix schema/shape issues in error.issues / findings",
      ],
    });
  }
  if (decision === "fail") {
    return createRepeatInput({
      ...base,
      reason: "negative_outcome",
      missing: missing.length ? missing : ["valid_positive_evidence"],
      nextActions: [
        "This is a genuine negative: do not treat ok:true as pass",
        "See findings[] for the rejected claim",
      ],
    });
  }
  if (decision === "unsupported") {
    return createRepeatInput({
      ...base,
      reason: "unsupported_input_or_dependency",
      nextActions: ["Run list and pick a ready job", "Read FIRST-USE.md"],
    });
  }
  return createRepeatInput({
    ...base,
    reason: "unknown_outcome",
    nextActions: ["Inspect native payload and limitations"],
  });
}

export function finish({
  job,
  clock,
  mode,
  inputPath,
  native,
  decision,
  schemaRejected = false,
  schemaError = null,
  ok = true,
  error = null,
  artifact = null,
  extraLimitations = [],
}) {
  const mapped = normalizeDecision(decision, { schemaRejected });
  const findings = findingsOf(native);
  const limitations = [...limitationsOf(native), ...extraLimitations];
  const packet = packetOf(native);
  return createResult({
    jobId: job.jobId,
    artifactId: job.artifactId,
    clock,
    mode,
    ok,
    decision: mapped,
    schemaRejected,
    sources: [sourceEntry(inputPath)].filter(Boolean),
    findings,
    limitations,
    native,
    artifact: artifact ?? extractArtifact(job.artifactId, packet, native),
    freshness: packet?.freshness ?? native?.freshness ?? null,
    error,
    repeatInput: repeatFor(job, mapped, inputPath, native),
  });
}

export function extractArtifact(artifactId, packet, native) {
  if (!packet && !native) return null;
  const p = packet || native;
  if (artifactId === "migration-checklist") {
    return {
      checklist: p.checklist || p.artifact?.checklist || null,
      coverage: p.coverage ?? p.artifact?.coverage ?? null,
      citations: p.citations || [],
    };
  }
  if (artifactId === "release-brief") {
    const brief = p.brief || p;
    return {
      announced: brief.announced || null,
      shipped: brief.shipped || null,
      tested: brief.tested || null,
      alignment: brief.alignment || null,
    };
  }
  if (artifactId === "table-reconcile") {
    return {
      groups: p.groups || [],
      join: p.join || null,
      inventTotals: p.inventTotals === true,
    };
  }
  if (artifactId === "link-index") {
    return {
      links: p.links || [],
      coverage: p.coverage || null,
      unreachable: p.unreachable || [],
      duplicates: p.duplicates || [],
    };
  }
  if (artifactId === "replay-pack") {
    return {
      examples: p.examples || [],
      summary: p.summary || null,
      online: p.online || null,
    };
  }
  if (artifactId === "freshness-receipt") {
    return {
      datasets: p.datasets || [],
      horizonMs: p.horizonMs ?? null,
    };
  }
  if (artifactId === "procurement-brief") {
    return {
      status: native?.status || null,
      comparisons: native?.comparisons || [],
      priceState: native?.priceState || native?.contracts?.[0]?.priceState || null,
    };
  }
  if (artifactId === "customer-result-package") {
    return {
      status: native?.status || native?.packageStatus || null,
      recipes: native?.recipes || [],
    };
  }
  if (artifactId === "acquisition-status") {
    return {
      packageStatus: native?.packageStatus || null,
      acquisitionOk: native?.acquisitionOk ?? null,
      recipes: native?.recipes || [],
      source: native?.source || null,
    };
  }
  return { keys: Object.keys(p || {}) };
}

export function caseIdFromPath(path) {
  if (!path) return null;
  const base = basename(path);
  if (base.endsWith(".json")) return base.replace(/\.json$/i, "");
  return basename(path);
}

export { createResult, normalizeDecision, createRepeatInput };
