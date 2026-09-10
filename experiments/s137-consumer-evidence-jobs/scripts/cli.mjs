#!/usr/bin/env node
/**
 * S137 consumer-evidence CLI (R2-CONSUMER-JOBS-01..06).
 * Offline default. Wires sibling src/<artifact>/{schema,transform}.mjs when present.
 * Does not invent facts, fetch, pay, publish, or merge.
 */
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { isIsoClock } from "../src/common/clock.mjs";
import { sha256Hex } from "../src/common/hash.mjs";
import {
  createEnvelope,
  DECISIONS,
  EVIDENCE_CLASSES,
  PACKET_SCHEMA,
  requireCitedFinding,
} from "../src/packet.mjs";

export { DECISIONS, EVIDENCE_CLASSES, PACKET_SCHEMA };

export const PACK_REL = "experiments/s137-consumer-evidence-jobs";
export const PACK_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const USAGE_EXIT = 2;
export const INPUT_EXIT = 1;
export const SRC_ENV = "S137_CONSUMER_EVIDENCE_SRC";
export const EXCLUDED_JOBS = Object.freeze(["R2-CONSUMER-JOBS-07", "R2-CONSUMER-JOBS-08"]);
export const TRANSFORM_EXPORTS = Object.freeze([
  "transform",
  "run",
  "analyze",
  "build",
  "buildReleaseBrief",
  "transformReleaseBrief",
  "transformMigrationChecklist",
  "transformFixtureCase",
  "reconcileTables",
  "transformLinkIndex",
  "buildFreshnessReceipt",
  "packageReplayPack",
  "buildReplayPack",
  "coerceToSchemaInput",
]);
export const SCHEMA_VALIDATE_EXPORTS = Object.freeze([
  "validateInput",
  "validate",
  "assertInput",
  "validateCase",
  "validateReleaseBriefInput",
  "validateReplayPackInput",
  "validateFreshnessInput",
  "validateMigrationInput",
  "validateLinkIndexInput",
  "validateTableReconcileInput",
]);

const MAX_SOURCE_BYTES = 1_048_576;
const MAX_DIR_SOURCES = 32;
const OWNED_JOBS_REL = "docs/OWNED-JOBS-01-06.json";

/**
 * Catalog sourced from docs/OWNED-JOBS-01-06.json + CONCURRENCY-GRAPH.md.
 * Do not add jobs 07/08.
 */
export const ARTIFACTS = Object.freeze([
  {
    id: "migration-checklist",
    jobId: "R2-CONSUMER-JOBS-01",
    title: "Documentation migration checklist",
    dir: "migration-checklist",
    fixtureRel: "fixtures/synthetic/migration",
    realRel: "fixtures/real/migration",
    aliases: Object.freeze(["01", "migration", "docs-migration"]),
  },
  {
    id: "release-brief",
    jobId: "R2-CONSUMER-JOBS-02",
    title: "Release evidence brief",
    dir: "release-brief",
    fixtureRel: "fixtures/synthetic/release-brief",
    realRel: "fixtures/real/release-brief",
    aliases: Object.freeze(["02", "release", "brief"]),
  },
  {
    id: "table-reconcile",
    jobId: "R2-CONSUMER-JOBS-03",
    title: "Research table reconciliation",
    dir: "table-reconcile",
    fixtureRel: "fixtures/synthetic/table-reconcile",
    realRel: "fixtures/real/table-reconcile",
    aliases: Object.freeze(["03", "reconcile", "table"]),
  },
  {
    id: "link-index",
    jobId: "R2-CONSUMER-JOBS-04",
    title: "Link-to-artifact index",
    dir: "link-index",
    fixtureRel: "fixtures/synthetic/link-index",
    realRel: "fixtures/real/link-index",
    aliases: Object.freeze(["04", "links", "index"]),
  },
  {
    id: "replay-pack",
    jobId: "R2-CONSUMER-JOBS-05",
    title: "API example replay pack",
    dir: "replay-pack",
    fixtureRel: "fixtures/synthetic/replay-pack",
    realRel: "fixtures/real/replay-pack",
    aliases: Object.freeze(["05", "replay", "examples"]),
  },
  {
    id: "freshness-receipt",
    jobId: "R2-CONSUMER-JOBS-06",
    title: "Dataset freshness receipt",
    dir: "freshness-receipt",
    fixtureRel: "fixtures/synthetic/freshness",
    realRel: "fixtures/real/freshness",
    aliases: Object.freeze(["06", "freshness", "receipt"]),
  },
]);

const ARTIFACT_BY_TOKEN = buildArtifactIndex();

export function usage() {
  return `S137 consumer-evidence CLI (R2-CONSUMER-JOBS-01..06 only; one-shot; offline default).

Emits ${PACKET_SCHEMA} JSON. Deterministic source-informed transforms only.
Does not invent facts, hit paid endpoints, attest legally, or claim demand.
Does not npm install, fetch, pay, publish, or merge to default.

Subcommands: analyze <artifact> | analyze --all | list | --help

Artifacts:
  migration-checklist  R2-CONSUMER-JOBS-01  Documentation migration checklist
  release-brief        R2-CONSUMER-JOBS-02  Release evidence brief
  table-reconcile      R2-CONSUMER-JOBS-03  Research table reconciliation
  link-index           R2-CONSUMER-JOBS-04  Link-to-artifact index
  replay-pack          R2-CONSUMER-JOBS-05  API example replay pack
  freshness-receipt    R2-CONSUMER-JOBS-06  Dataset freshness receipt

Jobs 07/08 are out of scope (owned elsewhere).

Usage:
  node ${PACK_REL}/scripts/cli.mjs --help
  node ${PACK_REL}/scripts/cli.mjs list
  node ${PACK_REL}/scripts/cli.mjs analyze migration-checklist \\
    --in ${PACK_REL}/fixtures/synthetic/migration \\
    --clock 2026-09-10T12:00:00.000Z [--out packet.json]
  node ${PACK_REL}/scripts/cli.mjs analyze --all --clock 2026-09-10T12:00:00.000Z \\
    --in-root ${PACK_REL}/fixtures/synthetic

Flags:
  --clock            required for analyze (operator ISO-8601; do not invent)
  --in               local file or directory (URLs refused)
  --in-root          with --all, map each artifact to <in-root>/<id or fixture folder>
  --out              write packet JSON (must not equal --in)
  --job              artifact id/alias instead of positional
  --all              run all six analyze subcommands
  --evidence-class   synthetic | fixture | live-capture
  --compact          single-line JSON
  --src-root         override src/ (or env ${SRC_ENV})
  --live-capture     request live acquisition (this CLI still performs no network I/O)

Offline default. Missing sibling schema/transform modules yield a valid packet
with decision unknown|partial and cited limitations — not a crash, not a pass.

Kill condition: if a job never produces cited findings beyond echoing the
input path, record negative evidence and stop packaging as a paid job.`;
}

export function parseCli(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        help: { type: "boolean", default: false },
        job: { type: "string" },
        in: { type: "string" },
        "in-root": { type: "string" },
        clock: { type: "string" },
        out: { type: "string" },
        compact: { type: "boolean", default: false },
        "evidence-class": { type: "string" },
        "live-capture": { type: "boolean", default: false },
        "src-root": { type: "string" },
        all: { type: "boolean", default: false },
      },
    });
  } catch (error) {
    return {
      ok: false,
      exitCode: USAGE_EXIT,
      error: error instanceof Error ? error.message : String(error),
      help: true,
    };
  }

  const { values, positionals } = parsed;
  if (values.help || positionals[0] === "help" || positionals[0] === "--help") {
    return { ok: true, help: true, command: "help", input: null };
  }

  const command = positionals[0] || null;
  if (!command) {
    return {
      ok: false,
      help: true,
      exitCode: USAGE_EXIT,
      error: "subcommand required: analyze <artifact> | analyze --all | list | --help",
    };
  }
  if (command !== "analyze" && command !== "list") {
    return {
      ok: false,
      help: true,
      exitCode: USAGE_EXIT,
      error: `unknown subcommand ${JSON.stringify(command)}; expected analyze | list | --help`,
    };
  }

  const evidenceClass = values["evidence-class"] || null;
  if (evidenceClass && !EVIDENCE_CLASSES.includes(evidenceClass)) {
    return {
      ok: false,
      help: true,
      exitCode: USAGE_EXIT,
      error: `--evidence-class must be ${EVIDENCE_CLASSES.join(" | ")} (got ${JSON.stringify(evidenceClass)})`,
    };
  }

  if (command === "list") {
    return {
      ok: true,
      help: false,
      command: "list",
      input: {
        command: "list",
        clock: values.clock || null,
        compact: values.compact === true,
        srcRoot: resolveSrcRoot(values["src-root"]),
        evidenceClass,
        liveCapture: values["live-capture"] === true,
        outPath: values.out ? resolve(values.out) : null,
      },
    };
  }

  const all = values.all === true;
  const jobToken = values.job || positionals[1] || null;
  if (all && jobToken) {
    return {
      ok: false,
      help: true,
      exitCode: USAGE_EXIT,
      error: "analyze --all does not take an artifact positional (omit --job / artifact name)",
    };
  }
  if (!all && !jobToken) {
    return {
      ok: false,
      help: true,
      exitCode: USAGE_EXIT,
      error: "analyze requires an artifact subcommand (migration-checklist | release-brief | table-reconcile | link-index | replay-pack | freshness-receipt) or --all",
    };
  }

  let artifact = null;
  if (!all) {
    artifact = resolveArtifact(jobToken);
    if (!artifact) {
      if (isExcludedJob(jobToken)) {
        return {
          ok: false,
          help: true,
          exitCode: USAGE_EXIT,
          error: `${JSON.stringify(jobToken)} is out of scope (R2-CONSUMER-JOBS-07/08 owned elsewhere)`,
        };
      }
      return {
        ok: false,
        help: true,
        exitCode: USAGE_EXIT,
        error: `unknown artifact ${JSON.stringify(jobToken)}; expected one of ${ARTIFACTS.map((row) => row.id).join(" | ")}`,
      };
    }
  }

  const clock = values.clock || null;
  if (!clock) {
    return {
      ok: false,
      help: true,
      exitCode: USAGE_EXIT,
      error: "analyze requires --clock (operator-supplied ISO-8601; do not invent)",
    };
  }
  if (!isIsoClock(clock)) {
    return {
      ok: false,
      help: true,
      exitCode: USAGE_EXIT,
      error: "--clock must be operator ISO-8601 (e.g. 2026-09-10T12:00:00.000Z); this CLI does not invent time",
    };
  }

  const inRaw = values.in || null;
  if (inRaw && isRemoteUrl(inRaw)) {
    return {
      ok: false,
      help: false,
      exitCode: INPUT_EXIT,
      error: "--in must be a local path (offline default; URLs refused)",
    };
  }
  const inRootRaw = values["in-root"] || null;
  if (inRootRaw && isRemoteUrl(inRootRaw)) {
    return {
      ok: false,
      help: false,
      exitCode: INPUT_EXIT,
      error: "--in-root must be a local path (offline default; URLs refused)",
    };
  }

  const inputPath = inRaw ? resolve(inRaw) : null;
  const outPath = values.out ? resolve(values.out) : null;
  if (inputPath && outPath && inputPath === outPath) {
    return {
      ok: false,
      help: false,
      exitCode: INPUT_EXIT,
      error: "--out must not equal --in (source inputs are immutable)",
    };
  }

  return {
    ok: true,
    help: false,
    command: "analyze",
    input: {
      command: "analyze",
      all,
      artifact,
      clock,
      inputPath,
      inRoot: inRootRaw ? resolve(inRootRaw) : null,
      outPath,
      compact: values.compact === true,
      evidenceClass,
      liveCapture: values["live-capture"] === true,
      srcRoot: resolveSrcRoot(values["src-root"]),
    },
  };
}

export function resolveArtifact(token) {
  if (token == null) return null;
  return ARTIFACT_BY_TOKEN.get(String(token).trim().toLowerCase()) || null;
}

export function resolveSrcRoot(flagValue) {
  if (flagValue) return resolve(flagValue);
  if (process.env[SRC_ENV]) return resolve(process.env[SRC_ENV]);
  return join(PACK_ROOT, "src");
}

export async function runCommand(command, input) {
  if (command === "list") return runList(input);
  if (input.all) return runAnalyzeAll(input);
  return runAnalyze(input.artifact, input);
}

export async function main(argv = process.argv.slice(2)) {
  const parsed = parseCli(argv);
  if (parsed.help && parsed.ok) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  if (!parsed.ok) {
    if (parsed.error) process.stderr.write(`${parsed.error}\n`);
    if (parsed.help) process.stderr.write(`\n${usage()}\n`);
    return parsed.exitCode ?? USAGE_EXIT;
  }

  let document;
  try {
    document = await runCommand(parsed.command, parsed.input);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return INPUT_EXIT;
  }

  const compact = parsed.input.compact === true;
  if (parsed.input.outPath) {
    const text = stringify(document, compact);
    writeFileSync(parsed.input.outPath, text);
    document.persisted = {
      ok: true,
      path: parsed.input.outPath,
      bytes: Buffer.byteLength(text),
    };
  }

  const missing = collectMissingModuleNotes(document);
  if (missing.length > 0) {
    process.stderr.write(
      `s137 consumer-evidence: ${missing.length} src module(s) missing; stages marked unknown/partial. See packet.modules\n`,
    );
  }

  process.stdout.write(stringify(document, compact));
  if (!compact) process.stdout.write("\n");
  if (document.ok === false) return INPUT_EXIT;
  return 0;
}

function stringify(document, compact) {
  return compact ? JSON.stringify(document) : JSON.stringify(document, null, 2);
}

function runList(input) {
  const owned = readOwnedJobs();
  const citations = [];
  if (owned.citation) citations.push(owned.citation);
  const findings = [];
  const catalogConflict = owned.ok && catalogDisagrees(owned.body);
  if (catalogConflict) {
    findings.push({
      id: "cli.catalog-conflict",
      kind: "conflict",
      message: "CLI ARTIFACTS job ids disagree with docs/OWNED-JOBS-01-06.json ownedJobs[].id",
      citationIds: [owned.citation.id],
    });
  } else if (owned.ok) {
    findings.push({
      id: "cli.catalog-match",
      kind: "positive",
      message: "CLI wires the six ownedJobs ids from docs/OWNED-JOBS-01-06.json; 07/08 excluded",
      citationIds: [owned.citation.id],
    });
  } else {
    findings.push({
      id: "cli.catalog-absent",
      kind: "partial",
      message: `docs/OWNED-JOBS-01-06.json unreadable (${owned.error}); CLI catalog is the in-module table only`,
      citationIds: ["cli:pack-root"],
    });
    citations.push({
      id: "cli:pack-root",
      path: PACK_ROOT,
      sha256: null,
      note: "pack root; owned-jobs file missing",
    });
  }

  const artifacts = ARTIFACTS.map((row) => ({
    id: row.id,
    jobId: row.jobId,
    title: row.title,
    analyze: `analyze ${row.id}`,
    schemaRel: `src/${row.dir}/schema.mjs`,
    transformRel: `src/${row.dir}/transform.mjs`,
    fixtureRel: row.fixtureRel,
    realRel: row.realRel,
    aliases: [...row.aliases],
  }));

  const document = {
    schema: "s137.consumer-evidence.catalog.v1",
    command: "list",
    clock: input.clock,
    evidenceClass: "fixture",
    offline: true,
    execute: false,
    posted: false,
    payment: { attempted: false },
    cost: { assignmentSpendUsd: 0, note: "offline catalog; no purchase; do not invent demand" },
    artifacts,
    excludedJobs: [...EXCLUDED_JOBS],
    findings,
    citations,
    decision: catalogConflict ? "conflict" : owned.ok ? "pass" : "partial",
    limitations: [
      "list is a local catalog; it does not run transforms",
      "jobs 07/08 are not wired",
    ],
    claims: safetyClaims(),
    ok: true,
  };
  return document;
}

async function runAnalyzeAll(input) {
  const packets = [];
  for (const artifact of ARTIFACTS) {
    const childInput = {
      ...input,
      all: false,
      artifact,
      inputPath: resolveAllInputPath(input, artifact),
      outPath: null,
    };
    packets.push(await runAnalyze(artifact, childInput));
  }
  const owned = readOwnedJobs();
  const citations = owned.citation ? [owned.citation] : [];
  const decisions = packets.map((row) => row.decision);
  let decision = "pass";
  if (decisions.includes("conflict")) decision = "conflict";
  else if (decisions.includes("fail")) decision = "fail";
  else if (decisions.includes("partial") || decisions.includes("unknown")) decision = "partial";

  return {
    schema: "s137.consumer-evidence.family.v1",
    command: "analyze",
    all: true,
    clock: input.clock,
    evidenceClass: input.evidenceClass || "synthetic",
    offline: true,
    execute: false,
    posted: false,
    payment: { attempted: false },
    cost: { assignmentSpendUsd: 0, note: "offline transform; no purchase; do not invent demand" },
    packets,
    citations,
    decision,
    limitations: [
      "analyze --all is a family envelope; inspect packets[] per job",
      "this CLI performs no network I/O",
    ],
    claims: safetyClaims(),
    ok: packets.every((row) => row.ok !== false),
    modules: Object.fromEntries(packets.map((row) => [row.artifactKind, row.modules])),
  };
}

async function runAnalyze(artifact, input) {
  const loaded = await loadArtifactModules(input.srcRoot, artifact);
  const owned = readOwnedJobs();
  const sources = [];
  const citations = [];
  const findings = [];
  const limitations = [
    "offline default: this CLI performs no network I/O",
    "operator --clock is required; this CLI does not invent time",
    "uncited transform findings are dropped",
    "jobs 07/08 are not wired",
  ];
  const unknownReasons = [];

  if (owned.citation) citations.push(owned.citation);
  citations.push({
    id: "cli:packet-schema",
    path: join(PACK_ROOT, "src/packet.mjs"),
    sha256: hashFileIfPresent(join(PACK_ROOT, "src/packet.mjs")),
    note: PACKET_SCHEMA,
  });

  let ok = true;
  let error = null;
  let loadedInput = { kind: "none", value: null, text: null, path: null };

  if (input.inputPath) {
    loadedInput = loadInput(input.inputPath);
    if (!loadedInput.ok) {
      ok = false;
      error = { code: loadedInput.code, message: loadedInput.message, path: input.inputPath };
      limitations.push(`input unreadable: ${loadedInput.message}`);
      unknownReasons.push("input_file_error");
      citations.push({
        id: "cli:input",
        path: input.inputPath,
        sha256: null,
        note: loadedInput.code,
      });
    } else {
      sources.push(...loadedInput.sources);
      for (const src of loadedInput.sources) {
        citations.push({
          id: src.id,
          path: src.path,
          sha256: src.sha256,
          bytes: src.bytes,
          role: src.role,
        });
      }
    }
  } else {
    limitations.push("no --in supplied; analyze cannot transform operator documents");
    unknownReasons.push("missing_input");
    findings.push({
      id: "cli.missing-input",
      kind: "partial",
      message: `analyze ${artifact.id}: no --in path; default fixture ${artifact.fixtureRel} was not auto-loaded (operator must supply inputs)`,
      citationIds: owned.citation ? [owned.citation.id] : ["cli:packet-schema"],
    });
  }

  const evidenceClass = deriveEvidenceClass(input, loadedInput);
  const flagConflict = detectFlagConflict(input, evidenceClass);
  if (flagConflict) {
    findings.push(flagConflict.finding);
    if (flagConflict.citation) citations.push(flagConflict.citation);
    limitations.push(flagConflict.limitation);
  }

  if (input.liveCapture === true) {
    limitations.push(
      "--live-capture requested; this CLI still performs no network I/O (no sibling acquire/fetch in this pack)",
    );
    unknownReasons.push("live_capture_requested_without_network");
  }

  if (!loaded.schema.present) {
    limitations.push(`src/${artifact.dir}/schema.mjs not present; schema stage skipped`);
    unknownReasons.push(`missing_module:src/${artifact.dir}/schema.mjs`);
    findings.push({
      id: `cli.missing-schema.${artifact.id}`,
      kind: "partial",
      message: `schema module not present at src/${artifact.dir}/schema.mjs`,
      citationIds: [citeMissingModule(citations, loaded.schema.path, "schema")],
    });
  } else if (loaded.schema.error) {
    limitations.push(`src/${artifact.dir}/schema.mjs unusable (${loaded.schema.error})`);
    unknownReasons.push(`module_error:src/${artifact.dir}/schema.mjs`);
  }

  if (!loaded.transform.present) {
    limitations.push(`src/${artifact.dir}/transform.mjs not present; transform stage skipped`);
    unknownReasons.push(`missing_module:src/${artifact.dir}/transform.mjs`);
    findings.push({
      id: `cli.missing-transform.${artifact.id}`,
      kind: "partial",
      message: `transform module not present at src/${artifact.dir}/transform.mjs`,
      citationIds: [citeMissingModule(citations, loaded.transform.path, "transform")],
    });
  } else if (loaded.transform.error) {
    limitations.push(`src/${artifact.dir}/transform.mjs unusable (${loaded.transform.error})`);
    unknownReasons.push(`module_error:src/${artifact.dir}/transform.mjs`);
  }

  const ctx = {
    command: "analyze",
    jobId: artifact.jobId,
    artifactKind: artifact.id,
    clock: input.clock,
    evidenceClass,
    offline: true,
    liveCaptureRequested: input.liveCapture === true,
    inputPath: loadedInput.ok ? loadedInput.path : input.inputPath,
    inputKind: loadedInput.kind,
    input: loadedInput.value,
    inputText: loadedInput.text,
    sources: sources.map((row) => ({ ...row })),
    packRoot: PACK_ROOT,
    srcRoot: input.srcRoot,
  };

  let schemaResult = null;
  if (loaded.schema.present && typeof loaded.schema.validate === "function" && loadedInput.ok !== false) {
    try {
      const schemaInput = prepareTransformArgument(artifact, loadedInput, ctx);
      schemaResult = await loaded.schema.validate(schemaInput, ctx);
    } catch (err) {
      schemaResult = { ok: false, issues: [err instanceof Error ? err.message : String(err)], threw: true };
      limitations.push(`schema validate threw: ${schemaResult.issues[0]}`);
      unknownReasons.push("schema_threw");
    }
  }

  if (schemaResult && schemaIsRejected(schemaResult)) {
    const issueText = Array.isArray(schemaResult.issues)
      ? schemaResult.issues.map(String).join("; ")
      : "validateInput returned ok:false";
    const citeId = sources[0]?.id || "cli:packet-schema";
    findings.push({
      id: "cli.schema-rejected",
      kind: "negative",
      message: `schema rejected input for ${artifact.id}: ${issueText}`,
      citationIds: [citeId],
    });
  }

  let transformResult = null;
  if (loaded.transform.present && typeof loaded.transform.fn === "function") {
    try {
      const transformArg = prepareTransformArgument(artifact, loadedInput, ctx);
      const caseId = fixtureCaseId(transformArg, loadedInput);
      const mod = loaded.transform.mod || {};
      const inputRoot = loadedInput?.path
        ? (loadedInput.kind === "directory" ? loadedInput.path : dirname(loadedInput.path))
        : null;
      const transformOpts = {
        clock: ctx.clock,
        evidenceClass: ctx.evidenceClass,
        ...(inputRoot ? { root: inputRoot } : {}),
      };
      if (typeof mod.transformFixtureCase === "function" && caseId) {
        try {
          transformResult = await mod.transformFixtureCase(caseId, {
            clock: ctx.clock,
            evidenceClass: ctx.evidenceClass,
          });
        } catch (fixtureErr) {
          // Operator documents may carry caseId metadata without a synthetic case file
          // (kit examples). Fall back to the document transform instead of failing closed.
          const fixtureMsg = fixtureErr instanceof Error ? fixtureErr.message : String(fixtureErr);
          limitations.push(
            `transformFixtureCase(${caseId}) unavailable; using document transform (${fixtureMsg})`,
          );
          if (typeof mod.coerceToSchemaInput === "function" && transformArg && transformArg.datasets) {
            transformResult = await loaded.transform.fn(mod.coerceToSchemaInput(transformArg), transformOpts);
          } else {
            transformResult = await loaded.transform.fn(transformArg, transformOpts);
          }
        }
      } else if (typeof mod.coerceToSchemaInput === "function" && transformArg && transformArg.datasets) {
        transformResult = await loaded.transform.fn(mod.coerceToSchemaInput(transformArg), transformOpts);
      } else {
        transformResult = await loaded.transform.fn(transformArg, transformOpts);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      limitations.push(`transform threw: ${message}`);
      unknownReasons.push("transform_threw");
      findings.push({
        id: "cli.transform-threw",
        kind: "negative",
        message: `src/${artifact.dir}/transform.mjs threw: ${message}`,
        citationIds: [citeMissingModule(citations, loaded.transform.path, "transform")],
      });
    }
  }

  const merged = mergeTransform(transformResult, citations, findings, limitations);
  let decision = pickDecision({
    schemaResult,
    transformDecision: merged.decision,
    flagConflict: Boolean(flagConflict),
    hasTransform: loaded.transform.present && !loaded.transform.error,
    hasInput: Boolean(loadedInput.ok),
    inputError: Boolean(error),
    unknownReasons,
  });

  const envelope = createEnvelope({
    jobId: artifact.jobId,
    artifactKind: artifact.id,
    clock: input.clock,
    evidenceClass,
    sources,
    findings: merged.findings,
    citations: merged.citations,
    decision,
    limitations: merged.limitations,
  });

  const packet = sanitizePacket({
    ...envelope,
    command: "analyze",
    execute: false,
    posted: false,
    ok,
    error,
    artifact: merged.artifact,
    unknownReasons,
    modules: {
      schema: publicModule(loaded.schema),
      transform: publicModule(loaded.transform),
    },
    pipeline: {
      command: "analyze",
      srcRoot: input.srcRoot,
      offline: true,
      liveCaptureRequested: input.liveCapture === true,
      artifactId: artifact.id,
    },
    catalog: {
      title: artifact.title,
      fixtureRel: artifact.fixtureRel,
      realRel: artifact.realRel,
    },
  });

  if (error) packet.ok = false;
  return packet;
}

function pickDecision({
  schemaResult,
  transformDecision,
  flagConflict,
  hasTransform,
  hasInput,
  inputError,
  unknownReasons,
}) {
  if (flagConflict) return "conflict";
  if (inputError) return "fail";
  const schemaRejected = Boolean(schemaResult && schemaIsRejected(schemaResult));
  // Prefer concrete transform outcomes, but schema rejection / missing-required input
  // must never promote to pass. Preserve conflict/partial/fail/unknown as-is.
  if (transformDecision && DECISIONS.includes(transformDecision)) {
    if (schemaRejected && transformDecision === "pass") return "fail";
    return transformDecision;
  }
  if (schemaRejected) return "fail";
  if (!hasTransform && hasInput) return "partial";
  if (!hasTransform && !hasInput) return "unknown";
  if (unknownReasons.length > 0) return "partial";
  return "unknown";
}

function mergeTransform(result, citations, findings, limitations) {
  const citationMap = new Map(citations.map((row) => [row.id, row]));
  const findingList = [...findings];
  let decision = null;
  let artifact = null;
  let dropped = 0;

  if (result && typeof result === "object") {
    const overlay = result.overlay && typeof result.overlay === "object" ? result.overlay : result;
    if (Array.isArray(overlay.citations)) {
      for (const row of overlay.citations) {
        if (!row || typeof row !== "object" || !row.id) continue;
        if (!citationMap.has(row.id)) citationMap.set(row.id, row);
      }
    }
    if (Array.isArray(overlay.findings)) {
      for (const row of overlay.findings) {
        const cids = citationIdsOf(row);
        if (!cids.length) {
          dropped += 1;
          continue;
        }
        findingList.push({ ...row, citationIds: cids });
      }
    }
    if (Array.isArray(overlay.limitations)) {
      for (const line of overlay.limitations) {
        if (line) limitations.push(String(line));
      }
    }
    if (overlay.decision) {
      const mapped = mapDecision(overlay.decision);
      if (mapped) decision = mapped;
    }
    if (overlay.artifact && typeof overlay.artifact === "object") artifact = overlay.artifact;
    else if (overlay.body && typeof overlay.body === "object") artifact = overlay.body;
    else if (overlay.checklist || overlay.brief || overlay.rows || overlay.index || overlay.pack || overlay.receipt) {
      artifact = overlay;
    }
  }

  if (dropped > 0) {
    limitations.push(`dropped ${dropped} uncited transform finding(s)`);
  }

  return {
    citations: [...citationMap.values()],
    findings: findingList,
    limitations,
    decision,
    artifact,
  };
}

function sanitizePacket(packet) {
  packet.offline = true;
  packet.execute = false;
  packet.posted = false;
  packet.payment = { attempted: false };
  packet.cost = {
    assignmentSpendUsd: 0,
    note: "offline transform; no purchase; do not invent demand",
  };
  packet.claims = { ...safetyClaims(), ...(packet.claims || {}) };
  packet.claims.inventsFacts = false;
  packet.claims.paidEndpoint = false;
  packet.claims.legalAttestation = false;
  packet.claims.modelAsOracle = false;
  packet.claims.assertsCustomerDemand = false;
  return packet;
}

function safetyClaims() {
  return {
    inventsFacts: false,
    paidEndpoint: false,
    legalAttestation: false,
    modelAsOracle: false,
    assertsCustomerDemand: false,
  };
}




function schemaIsRejected(result) {
  if (!result || typeof result !== "object") return false;
  if (result.ok === false || result.valid === false) return true;
  if (result.ok === true || result.valid === true) return false;
  if (Array.isArray(result.issues) && result.issues.length > 0) return true;
  if (Array.isArray(result.errors) && result.errors.length > 0) return true;
  return false;
}

function mapDecision(value) {
  if (value == null) return null;
  const raw = String(value).toLowerCase();
  if (DECISIONS.includes(raw)) return raw;
  if (raw === "ok" || raw === "success" || raw === "passed") return "pass";
  if (raw === "failed" || raw === "error" || raw === "invalid") return "fail";
  if (raw === "incomplete" || raw === "partial_pass") return "partial";
  if (raw === "conflicting" || raw === "contradiction") return "conflict";
  return null;
}

function citationIdsOf(finding) {
  if (!finding || typeof finding !== "object") return [];
  if (Array.isArray(finding.citationIds)) return finding.citationIds;
  if (Array.isArray(finding.citations)) {
    return finding.citations.map((c) => (typeof c === "string" ? c : c?.id)).filter(Boolean);
  }
  if (Array.isArray(finding.citationId)) return finding.citationId;
  if (typeof finding.citationId === "string") return [finding.citationId];
  return [];
}

function isSyntheticCaseWrapper(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const nested = value.input;
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) return false;
  const schemaId = String(value.schema || value.$schema || value.schemaId || "");
  const nestedSchema = String(nested.schema || nested.$schema || nested.schemaId || "");
  const wrapperMarked =
    /synthetic-case\.v1$/i.test(schemaId) ||
    /(^|\.)case\.v1$/i.test(schemaId) ||
    value.expect != null ||
    value.caseClass != null ||
    (value.lanes && typeof value.lanes === "object");
  const nestedLooksLikeInput =
    /\.input\.v1$/i.test(nestedSchema) ||
    Array.isArray(nested.sources) ||
    nested.oldDocs != null ||
    nested.newDocs != null;
  // Only unwrap when the outer object is a case envelope, not a schema input that
  // happens to contain an `input` field.
  if (Array.isArray(value.sources)) return false;
  return wrapperMarked && nestedLooksLikeInput;
}

function unwrapSyntheticCaseInput(value, ctx) {
  const nested = { ...value.input };
  if (ctx?.clock) nested.clock = ctx.clock;
  if (ctx?.evidenceClass && nested.evidenceClass == null) {
    nested.evidenceClass = ctx.evidenceClass;
  }
  return nested;
}

function prepareTransformArgument(artifact, loadedInput, ctx) {
  // Prefer the operator document. Transforms expect the evidence input, not the CLI ctx bag.
  if (loadedInput && loadedInput.ok === false) return ctx;
  const value = loadedInput?.value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    // Directory payloads: prefer a canonical case/input JSON when present.
    if (value.directory && Array.isArray(value.files)) {
      const preferred = value.files.find((row) => {
        const path = String(row.path || "");
        return row.json && /(^|\/)(input|case|positive-[^/]+)\.json$/.test(path);
      });
      if (preferred?.json) {
        return isSyntheticCaseWrapper(preferred.json)
          ? unwrapSyntheticCaseInput(preferred.json, ctx)
          : preferred.json;
      }
    }
    // Synthetic case envelopes nest schema-shaped `.input`. Passing the envelope to
    // release-brief previously treated lane path strings as empty agreeing identities
    // and emitted decision=pass beside cli.schema-rejected. Unwrap to the real input.
    if (isSyntheticCaseWrapper(value)) return unwrapSyntheticCaseInput(value, ctx);
    return value;
  }
  if (typeof loadedInput?.text === "string" && loadedInput.text.length > 0) {
    return {
      clock: ctx.clock,
      evidenceClass: ctx.evidenceClass,
      documents: [{ id: "in:0", kind: "text", body: loadedInput.text, path: loadedInput.path }],
      sources: ctx.sources,
    };
  }
  return ctx;
}

function fixtureCaseId(value, loadedInput) {
  if (value && typeof value === "object") {
    // Schema-shaped operator docs (kit examples) often include caseId metadata.
    // Only treat as a synthetic fixture when the payload is wrapper-shaped.
    const schemaId = value.schema || value.$schema || value.schemaId;
    const wrapperShaped =
      value.expect != null ||
      (value.input && typeof value.input === "object" && !schemaId);
    if (wrapperShaped) {
      for (const key of ["caseId", "id", "name"]) {
        if (typeof value[key] === "string" && value[key].trim()) return value[key].trim();
      }
    }
  }
  const path = String(loadedInput?.path || "");
  // Directory loads of cases/<id>.json retain fixture identity via filename.
  if (/\/cases\/[^/]+\.json$/i.test(path) || /\/fixtures\/(synthetic|real)\//i.test(path)) {
    const base = path.split(/[\/]/).pop() || "";
    if (base.endsWith(".json") && base !== "input.json") return base.replace(/\.json$/i, "");
  }
  return null;
}


async function loadArtifactModules(srcRoot, artifact) {
  const dir = join(srcRoot, artifact.dir);
  const schema = await loadModuleFile(join(dir, "schema.mjs"), SCHEMA_VALIDATE_EXPORTS, "validate");
  const transform = await loadModuleFile(join(dir, "transform.mjs"), TRANSFORM_EXPORTS, "fn");
  return { schema, transform, dir };
}

async function loadModuleFile(path, exportNames, fnKey) {
  const base = {
    path,
    present: false,
    exportName: null,
    exportNames: [],
    error: null,
    code: null,
    [fnKey]: null,
  };
  if (!existsSync(path)) {
    return { ...base, error: "module_not_found", code: "ERR_MODULE_NOT_FOUND" };
  }
  try {
    const st = lstatSync(path);
    if (st.isSymbolicLink() || !st.isFile()) {
      return { ...base, present: true, error: "not_a_regular_file", code: "not_a_regular_file" };
    }
    const mod = await import(pathToFileURL(path).href);
    const exportName = pickExport(mod, exportNames);
    const names = Object.keys(mod).filter((key) => typeof mod[key] === "function");
    return {
      ...base,
      present: true,
      mod,
      exportName,
      exportNames: names,
      error: exportName ? null : `no callable export (tried ${exportNames.join(", ")})`,
      code: exportName ? null : "no_callable_export",
      [fnKey]: exportName ? mod[exportName] : null,
      validate: typeof mod.validateInput === "function"
        ? mod.validateInput
        : typeof mod.validate === "function"
          ? mod.validate
          : typeof mod.assertInput === "function"
            ? wrapAssert(mod.assertInput)
            : null,
    };
  } catch (error) {
    return {
      ...base,
      present: true,
      error: error instanceof Error ? error.message : String(error),
      code: error?.code || "import_failed",
    };
  }
}

function wrapAssert(fn) {
  return async (input, ctx) => {
    await fn(input, ctx);
    return { ok: true, issues: [] };
  };
}

function pickExport(mod, names) {
  for (const name of names) {
    if (typeof mod[name] === "function") return name;
  }
  if (typeof mod.default === "function") return "default";
  // Fall back to uniquely named job exports (buildReleaseBrief, reconcileTables, ...).
  const funcs = Object.keys(mod).filter((key) => typeof mod[key] === "function");
  const preferred = funcs.find((key) => /^(transform|build|reconcile|package|analyze|run)/i.test(key));
  return preferred || null;
}

function publicModule(row) {
  return {
    present: row.present,
    path: row.path,
    exportName: row.exportName,
    error: row.error,
    code: row.code,
  };
}

function loadInput(path) {
  let st;
  try {
    st = lstatSync(path);
  } catch (error) {
    return { ok: false, code: error?.code || "ENOENT", message: error.message, kind: "none", sources: [] };
  }
  if (st.isSymbolicLink()) {
    return { ok: false, code: "symlink_refused", message: "--in must not be a symlink", kind: "none", sources: [] };
  }
  if (st.isDirectory()) return loadInputDir(path);
  if (!st.isFile()) {
    return { ok: false, code: "not_a_file", message: "--in must be a regular file or directory", kind: "none", sources: [] };
  }
  if (st.size > MAX_SOURCE_BYTES) {
    return {
      ok: false,
      code: "too_large",
      message: `--in exceeds ${MAX_SOURCE_BYTES} bytes`,
      kind: "none",
      sources: [],
    };
  }
  const buf = readFileSync(path);
  const text = buf.toString("utf8");
  const sha256 = sha256Hex(buf);
  const source = {
    id: "in:0",
    path,
    sha256,
    bytes: buf.length,
    role: "input",
  };
  let value = null;
  let kind = "text";
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      value = JSON.parse(text);
      kind = "json";
    } catch {
      value = null;
      kind = "text";
    }
  }
  return { ok: true, kind, value, text, path, sources: [source] };
}

function loadInputDir(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    return { ok: false, code: error?.code || "ENOENT", message: error.message, kind: "none", sources: [] };
  }
  const files = entries
    .filter((row) => row.isFile() && !row.name.startsWith("."))
    .map((row) => join(dir, row.name))
    .sort()
    .slice(0, MAX_DIR_SOURCES);
  const sources = [];
  const filesPayload = [];
  for (const [i, path] of files.entries()) {
    const st = lstatSync(path);
    if (st.isSymbolicLink() || !st.isFile() || st.size > MAX_SOURCE_BYTES) continue;
    const buf = readFileSync(path);
    const sha256 = sha256Hex(buf);
    const text = buf.toString("utf8");
    const id = `in:${i}`;
    sources.push({ id, path, sha256, bytes: buf.length, role: "input" });
    let json = null;
    const trimmed = text.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    filesPayload.push({ id, path, sha256, json, text: json ? null : text });
  }
  return {
    ok: true,
    kind: "directory",
    value: { directory: dir, files: filesPayload },
    text: null,
    path: dir,
    sources,
  };
}

function deriveEvidenceClass(input, loadedInput) {
  if (input.evidenceClass && EVIDENCE_CLASSES.includes(input.evidenceClass)) {
    return input.evidenceClass;
  }
  const path = loadedInput?.path || input.inputPath || "";
  const norm = String(path).split(sep).join("/");
  if (norm.includes("/fixtures/real/")) return "fixture";
  if (norm.includes("/fixtures/synthetic/")) return "synthetic";
  return "synthetic";
}

function detectFlagConflict(input, evidenceClass) {
  const citation = {
    id: "cli:flags",
    path: join(PACK_ROOT, "scripts/cli.mjs"),
    sha256: hashFileIfPresent(join(PACK_ROOT, "scripts/cli.mjs")),
    note: "CLI flag combination observed this run",
  };
  if (evidenceClass === "live-capture" && input.liveCapture !== true) {
    return {
      finding: {
        id: "cli.evidence-class-conflict",
        kind: "conflict",
        message:
          "evidenceClass is live-capture but --live-capture was not set; this CLI performed no capture",
        citationIds: ["cli:flags"],
      },
      citation,
      limitation: "operator labeled live-capture on an offline CLI run",
    };
  }
  if (input.liveCapture === true && evidenceClass === "synthetic") {
    return {
      finding: {
        id: "cli.live-vs-synthetic-conflict",
        kind: "conflict",
        message: "--live-capture requested while evidenceClass is synthetic",
        citationIds: ["cli:flags"],
      },
      citation,
      limitation: "live-capture flag conflicts with synthetic evidenceClass",
    };
  }
  return null;
}

function citeMissingModule(citations, path, role) {
  const id = `cli:fs:${role}`;
  if (!citations.some((row) => row.id === id)) {
    citations.push({
      id,
      path,
      sha256: null,
      note: existsSync(path) ? "present_but_unusable" : "module_not_found",
      role,
    });
  }
  return id;
}

function readOwnedJobs() {
  const path = join(PACK_ROOT, OWNED_JOBS_REL);
  if (!existsSync(path)) {
    return { ok: false, error: "missing", body: null, citation: null };
  }
  try {
    const buf = readFileSync(path);
    const body = JSON.parse(buf.toString("utf8"));
    return {
      ok: true,
      error: null,
      body,
      citation: {
        id: "owned-jobs",
        path,
        sha256: sha256Hex(buf),
        url: typeof body.sourcePath === "string" ? body.sourcePath : null,
        sourceCommit: body.sourceCommit || null,
        note: "local pack slice; not a live GET",
      },
    };
  } catch (error) {
    return { ok: false, error: error.message, body: null, citation: null };
  }
}

function catalogDisagrees(body) {
  const ids = Array.isArray(body?.ownedJobs) ? body.ownedJobs.map((row) => row.id) : [];
  const expected = ARTIFACTS.map((row) => row.jobId);
  if (ids.length !== expected.length) return true;
  return ids.some((id, i) => id !== expected[i]);
}

function resolveAllInputPath(input, artifact) {
  if (input.inputPath) return input.inputPath;
  if (input.inRoot) {
    const byId = join(input.inRoot, artifact.id);
    if (existsSync(byId)) return byId;
    const byDir = join(input.inRoot, artifact.dir);
    if (existsSync(byDir)) return byDir;
    const fixtureName = artifact.fixtureRel.split("/").pop();
    const byFixture = join(input.inRoot, fixtureName);
    if (existsSync(byFixture)) return byFixture;
    return join(input.inRoot, artifact.id);
  }
  const packFixture = join(PACK_ROOT, artifact.fixtureRel);
  if (existsSync(packFixture)) return packFixture;
  return null;
}

function collectMissingModuleNotes(document) {
  const notes = [];
  const scan = (modules) => {
    if (!modules) return;
    for (const row of Object.values(modules)) {
      if (row && row.present === false) notes.push(row.path || "missing");
      if (row && row.schema && row.schema.present === false) notes.push(row.schema.path);
      if (row && row.transform && row.transform.present === false) notes.push(row.transform.path);
    }
  };
  if (document.modules?.schema || document.modules?.transform) {
    if (document.modules.schema?.present === false) notes.push(document.modules.schema.path);
    if (document.modules.transform?.present === false) notes.push(document.modules.transform.path);
  } else {
    scan(document.modules);
  }
  return notes;
}

function hashFileIfPresent(path) {
  try {
    if (!existsSync(path)) return null;
    const st = lstatSync(path);
    if (!st.isFile()) return null;
    return sha256Hex(readFileSync(path));
  } catch {
    return null;
  }
}

export { sha256Hex };

function isRemoteUrl(value) {
  return /^https?:\/\//i.test(String(value).trim());
}

function isExcludedJob(token) {
  const raw = String(token).trim().toUpperCase();
  if (EXCLUDED_JOBS.includes(raw)) return true;
  if (raw === "07" || raw === "08") return true;
  if (raw === "R2-CONSUMER-JOBS-07" || raw === "R2-CONSUMER-JOBS-08") return true;
  return false;
}

function buildArtifactIndex() {
  const map = new Map();
  for (const row of ARTIFACTS) {
    map.set(row.id, row);
    map.set(row.jobId.toLowerCase(), row);
    map.set(row.dir, row);
    for (const alias of row.aliases) map.set(alias, row);
  }
  return map;
}

function isMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return pathToFileURL(resolve(entry)).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isMain()) {
  const code = await main();
  process.exit(code);
}
