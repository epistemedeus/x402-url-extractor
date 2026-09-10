#!/usr/bin/env node
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256Hex, stableStringify } from "../recipes/lib/hash.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const pack = join(here, "..");
const evidence = join(pack, "evidence", "snapshots");
const capturedAt = readFileSync(join(evidence, "CAPTURED_AT_UTC.txt"), "utf8").trim();

function readEvidence(name) {
  return JSON.parse(readFileSync(join(evidence, name), "utf8"));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writePrior({ path, recipeId, createdAt, sequence, payload }) {
  const sha256 = sha256Hex(payload);
  writeJson(path, {
    schema: "samedaydesk.recurring-job-prior.v1",
    recipeId,
    createdAt,
    sequence,
    immutable: true,
    sha256,
    payload,
    payment: { attempted: false },
  });
}

const vercelPriorSlim = readEvidence("npm-vercel-prior-slim.json");
const vercelCurrentSlim = readEvidence("npm-vercel-current-slim.json");
const vercelLatest = readEvidence("npm-vercel-latest.json");
const claudePriorSlim = readEvidence("npm-claude-code-prior-slim.json");
const claudeCurrentSlim = readEvidence("npm-claude-code-current-slim.json");
const claudeLatest = readEvidence("npm-claude-code-latest.json");
const eolPriorSlim = readEvidence("eol-nodejs-prior-slim.json");
const eolCurrentSlim = readEvidence("eol-nodejs-current-slim.json");
const eolFull = readEvidence("eol-nodejs.json");

copyFileSync(join(evidence, "npm-vercel-prior-slim.json"), join(pack, "fixtures/npm-vercel/source-prior-slim.json"));
copyFileSync(join(evidence, "npm-vercel-current-slim.json"), join(pack, "fixtures/npm-vercel/current.json"));
copyFileSync(join(evidence, "npm-vercel-latest.json"), join(pack, "fixtures/npm-vercel/second-snapshot-version-doc.json"));
copyFileSync(join(evidence, "npm-claude-code-prior-slim.json"), join(pack, "fixtures/npm-claude-code/source-prior-slim.json"));
copyFileSync(join(evidence, "npm-claude-code-current-slim.json"), join(pack, "fixtures/npm-claude-code/current.json"));
copyFileSync(join(evidence, "npm-claude-code-latest.json"), join(pack, "fixtures/npm-claude-code/second-snapshot-version-doc.json"));
copyFileSync(join(evidence, "eol-nodejs-prior-slim.json"), join(pack, "fixtures/eol-nodejs/source-prior-slim.json"));
copyFileSync(join(evidence, "eol-nodejs-current-slim.json"), join(pack, "fixtures/eol-nodejs/current.json"));
copyFileSync(join(evidence, "eol-nodejs.json"), join(pack, "fixtures/eol-nodejs/second-snapshot-full-api.json"));

writeJson(join(pack, "fixtures/npm-vercel/unchanged.json"), { ...vercelPriorSlim, label: "unchanged-replay" });
writeJson(join(pack, "fixtures/npm-vercel/partial-missing-version.json"), {
  ...vercelCurrentSlim,
  label: "partial-missing-version",
  version: null,
});
writeJson(join(pack, "fixtures/npm-claude-code/unchanged.json"), { ...claudePriorSlim, label: "unchanged-replay" });
writeJson(join(pack, "fixtures/npm-claude-code/partial-missing-version.json"), {
  ...claudeCurrentSlim,
  label: "partial-missing-version",
  version: null,
});
writeJson(join(pack, "fixtures/eol-nodejs/unchanged.json"), { ...eolPriorSlim, label: "unchanged-replay" });
writeJson(join(pack, "fixtures/eol-nodejs/partial-missing-eol.json"), {
  ...eolCurrentSlim,
  label: "partial-missing-eol",
  cycles: eolCurrentSlim.cycles.map((row) => (row.cycle === "20" ? { ...row, eol: null } : row)),
});

writeJson(join(pack, "fixtures/npm-vercel/operator.json"), {
  pin: { package: "vercel", version: "59.9.1" },
  agentToolNotes: {
    lastReviewedVersion: "59.9.1",
    flagSensitive: false,
    note: "Agent tool notes still describe vercel 59.9 CLI flags.",
  },
  policy: {
    changelogOnMinorOrMajor: true,
    ignorePatch: false,
    preferNotesRefreshOnPatch: false,
  },
  evidenceClass: "fixture",
});

writeJson(join(pack, "fixtures/npm-vercel/operator-notes-refreshed.json"), {
  pin: { package: "vercel", version: "59.15.1" },
  agentToolNotes: {
    lastReviewedVersion: "59.15.1",
    flagSensitive: false,
    note: "Notes refreshed after changelog review of 59.15.1.",
  },
  policy: {
    changelogOnMinorOrMajor: true,
    ignorePatch: false,
    preferNotesRefreshOnPatch: false,
  },
  evidenceClass: "owner-qa",
});

writeJson(join(pack, "fixtures/npm-claude-code/operator.json"), {
  pin: { package: "@anthropic-ai/claude-code", version: "2.1.260" },
  agentToolNotes: {
    lastReviewedVersion: "2.1.260",
    flagSensitive: true,
    note: "Runbook lists claude CLI flags from 2.1.260.",
  },
  policy: {
    changelogOnMinorOrMajor: true,
    ignorePatch: false,
    preferNotesRefreshOnPatch: true,
  },
  evidenceClass: "fixture",
});

writeJson(join(pack, "fixtures/npm-claude-code/operator-ignore-patch.json"), {
  pin: { package: "@anthropic-ai/claude-code", version: "2.1.260" },
  agentToolNotes: {
    lastReviewedVersion: "2.1.260",
    flagSensitive: true,
    note: "Operator chose to ignore patch-level CLI churn.",
  },
  policy: {
    changelogOnMinorOrMajor: true,
    ignorePatch: true,
    preferNotesRefreshOnPatch: true,
  },
  evidenceClass: "fixture",
});

writeJson(join(pack, "fixtures/eol-nodejs/operator.json"), {
  watchCycles: ["20", "22", "24"],
  horizonDays: 90,
  urgentDays: 14,
  pinnedRuntime: "20",
  evidenceClass: "fixture",
});

writeJson(join(pack, "fixtures/eol-nodejs/operator-node24-only.json"), {
  watchCycles: ["24"],
  horizonDays: 90,
  urgentDays: 14,
  pinnedRuntime: "24",
  evidenceClass: "fixture",
});

writePrior({
  path: join(pack, "fixtures/npm-vercel/prior.seq-1.json"),
  recipeId: "npm-cli-release-followup",
  createdAt: vercelPriorSlim.published_at,
  sequence: 1,
  payload: {
    package: "vercel",
    version: vercelPriorSlim.version,
    publishedAt: vercelPriorSlim.published_at,
    published_at: vercelPriorSlim.published_at,
    deprecated: vercelPriorSlim.deprecated,
    engines: vercelPriorSlim.engines,
    source: vercelPriorSlim.source,
    label: "prior",
    captured_from_live_registry: true,
    capturedAt,
    evidenceClass: "fixture",
  },
});

writePrior({
  path: join(pack, "fixtures/npm-vercel/prior.seq-2-after-review.json"),
  recipeId: "npm-cli-release-followup",
  createdAt: vercelCurrentSlim.published_at,
  sequence: 2,
  payload: {
    package: "vercel",
    version: vercelCurrentSlim.version,
    publishedAt: vercelCurrentSlim.published_at,
    published_at: vercelCurrentSlim.published_at,
    deprecated: vercelCurrentSlim.deprecated,
    engines: vercelCurrentSlim.engines,
    source: vercelCurrentSlim.source,
    label: "seq-2-after-review",
    captured_from_live_registry: true,
    capturedAt,
    evidenceClass: "owner-qa",
  },
});

writePrior({
  path: join(pack, "fixtures/npm-claude-code/prior.seq-1.json"),
  recipeId: "agent-cli-release-followup",
  createdAt: claudePriorSlim.published_at,
  sequence: 1,
  payload: {
    package: "@anthropic-ai/claude-code",
    version: claudePriorSlim.version,
    publishedAt: claudePriorSlim.published_at,
    published_at: claudePriorSlim.published_at,
    deprecated: claudePriorSlim.deprecated,
    bin: claudePriorSlim.bin,
    source: claudePriorSlim.source,
    label: "prior",
    captured_from_live_registry: true,
    capturedAt,
    evidenceClass: "fixture",
  },
});

writePrior({
  path: join(pack, "fixtures/eol-nodejs/prior.seq-1.json"),
  recipeId: "runtime-eol-watch",
  createdAt: eolPriorSlim.as_of_clock,
  sequence: 1,
  payload: {
    source: eolPriorSlim.source,
    label: "prior",
    asOfClock: eolPriorSlim.as_of_clock,
    as_of_clock: eolPriorSlim.as_of_clock,
    watchCycles: eolPriorSlim.watch_cycles,
    watch_cycles: eolPriorSlim.watch_cycles,
    cycles: eolPriorSlim.cycles,
    captured_from_live_api: true,
    capturedAt,
    evidenceClass: "fixture",
    pinnedRuntime: "20",
  },
});

writeJson(join(pack, "fixtures/PROVENANCE.json"), {
  capturedAtUtc: capturedAt,
  evidenceClassDefault: "fixture",
  originalUrls: {
    vercel: "https://registry.npmjs.org/vercel",
    claudeCode: "https://registry.npmjs.org/@anthropic-ai/claude-code",
    nodejsEol: "https://endoflife.date/api/nodejs.json",
  },
  snapshots: {
    "npm-vercel/current.json": {
      evidenceClass: "fixture",
      capturedFromLive: true,
      source: "https://registry.npmjs.org/vercel",
      notes: "Slim extract of vercel 59.15.1 published 2026-09-10T01:12:17.696Z",
    },
    "npm-vercel/second-snapshot-version-doc.json": {
      evidenceClass: "fixture",
      capturedFromLive: true,
      source: "npm version document for vercel@59.15.1",
      notes: "Independently sourced second snapshot: version document without published_at (partial coverage).",
    },
    "npm-vercel/unchanged.json": {
      evidenceClass: "fixture",
      notes: "Unchanged replay: prior slim used as current.",
    },
    "npm-claude-code/current.json": {
      evidenceClass: "fixture",
      capturedFromLive: true,
      source: "https://registry.npmjs.org/@anthropic-ai/claude-code",
      notes: "Slim extract of 2.1.267 published 2026-09-09T18:25:42.820Z",
    },
    "eol-nodejs/current.json": {
      evidenceClass: "fixture",
      capturedFromLive: true,
      source: "https://endoflife.date/api/nodejs.json",
      notes: "Slim watch cycles 20/22/24 at operator clock 2026-09-10T09:54:59Z",
    },
    "eol-nodejs/second-snapshot-full-api.json": {
      evidenceClass: "fixture",
      capturedFromLive: true,
      source: "https://endoflife.date/api/nodejs.json",
      notes: "Independently sourced second snapshot: full API array including unwatched cycles.",
    },
  },
  rejectedRawSnapshots: {
    "evidence/snapshots/crates-serde.json": "generic crate version dump; duplicate of npm follow-up without a distinct next-action policy",
    "evidence/snapshots/pypi-httpx.json": "generic PyPI version dump; duplicate of npm follow-up",
    "evidence/snapshots/github-vercel-releases.json": "monorepo GitHub releases do not identify npm latest CLI 59.15.1",
    "evidence/snapshots/github-x402-releases.json": "empty array; no independently checkable change",
  },
  latestVersionDocuments: {
    vercel: { name: vercelLatest.name, version: vercelLatest.version },
    claudeCode: { name: claudeLatest.name, version: claudeLatest.version },
  },
  eolFullCycleCount: Array.isArray(eolFull) ? eolFull.length : null,
});

writeJson(join(pack, "fixtures/npm-vercel/stale-current.json"), {
  ...vercelCurrentSlim,
  label: "stale-current",
  captured_at: "2026-08-01T00:00:00.000Z",
  capturedAt: "2026-08-01T00:00:00.000Z",
});

process.stdout.write("materialized fixtures\n");
