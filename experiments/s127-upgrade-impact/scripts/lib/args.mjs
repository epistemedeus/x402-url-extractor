import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { COMMANDS } from "./contract.mjs";
import { EVIDENCE_LABELS } from "./packet.mjs";
import { PACK_REL, resolveSrcRoot } from "./paths.mjs";

export const USAGE_EXIT = 2;

export function parseCli(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        help: { type: "boolean", default: false },
        manifest: { type: "string" },
        lockfile: { type: "string" },
        "source-root": { type: "string", multiple: true },
        dep: { type: "string" },
        old: { type: "string" },
        new: { type: "string" },
        "fixture-old": { type: "string" },
        "fixture-new": { type: "string" },
        clock: { type: "string" },
        out: { type: "string" },
        prior: { type: "string" },
        correction: { type: "string" },
        compact: { type: "boolean", default: false },
        "evidence-class": { type: "string" },
        "live-capture": { type: "boolean", default: false },
        "src-root": { type: "string" },
      },
    });
  } catch (error) {
    return {
      ok: false,
      exitCode: USAGE_EXIT,
      error: error instanceof Error ? error.message : String(error),
      help: false,
    };
  }

  const { values, positionals } = parsed;
  const command = positionals[0] || null;
  const priorPositional = positionals[1] || null;

  if (values.help || command === "help" || command === "--help") {
    return { ok: true, help: true, command: "help", input: null };
  }

  if (!command) {
    return {
      ok: false,
      help: true,
      exitCode: USAGE_EXIT,
      error: "subcommand required: analyze | replay | correct | --help",
    };
  }

  if (!COMMANDS.includes(command)) {
    return {
      ok: false,
      help: true,
      exitCode: USAGE_EXIT,
      error: `unknown subcommand ${JSON.stringify(command)}; expected analyze | replay | correct | --help`,
    };
  }

  const evidenceClass = values["evidence-class"] || null;
  if (evidenceClass && !EVIDENCE_LABELS.includes(evidenceClass)) {
    return {
      ok: false,
      help: true,
      exitCode: USAGE_EXIT,
      error: `--evidence-class must be fixture | live-capture | synthetic (got ${JSON.stringify(evidenceClass)})`,
    };
  }

  const input = {
    command,
    manifestPath: values.manifest ? resolve(values.manifest) : null,
    lockfilePath: values.lockfile ? resolve(values.lockfile) : null,
    sourceRoots: (values["source-root"] || []).map((row) => resolve(row)),
    dep: values.dep || null,
    old: values.old || null,
    new: values.new || null,
    fixtureOld: values["fixture-old"] ? resolve(values["fixture-old"]) : null,
    fixtureNew: values["fixture-new"] ? resolve(values["fixture-new"]) : null,
    clock: values.clock || null,
    outPath: values.out ? resolve(values.out) : null,
    priorPath: values.prior ? resolve(values.prior) : priorPositional ? resolve(priorPositional) : null,
    correctionNote: values.correction || null,
    compact: values.compact === true,
    evidenceClass,
    liveCapture: values["live-capture"] === true,
    srcRoot: resolveSrcRoot(values["src-root"]),
  };

  const missing = requiredFlags(command, input);
  if (missing.length > 0) {
    return {
      ok: false,
      help: true,
      exitCode: USAGE_EXIT,
      error: `${command} requires ${missing.join(", ")}`,
      input,
    };
  }

  return { ok: true, help: false, command, input };
}

function requiredFlags(command, input) {
  const missing = [];
  if (!input.clock) missing.push("--clock");
  if (command === "analyze") {
    if (!input.dep) missing.push("--dep");
    if (!input.old) missing.push("--old");
    if (!input.new) missing.push("--new");
  }
  if (command === "replay" || command === "correct") {
    if (!input.priorPath) missing.push("--prior");
  }
  return missing;
}

export function usage() {
  return `S127 upgrade-impact CLI (one-shot; offline default; no daemon, no publish, no purchase).

Binds an upstream package export/API change to the caller's actually used import
surface and emits ${"s127.upgrade-impact.packet.v1"} JSON. A newer version alone is
not a break. An unused export change is not a caller defect.

Subcommands: analyze | replay | correct | --help

Usage:
  node ${PACK_REL}/scripts/cli.mjs --help
  node ${PACK_REL}/scripts/cli.mjs analyze \\
    --manifest <package.json> --lockfile <lock> --source-root <dir> [--source-root <dir>...] \\
    --dep <name> --old <ver> --new <ver> \\
    --fixture-old <path> --fixture-new <path> \\
    --clock 2026-09-10T12:00:00.000Z [--out packet.json]

  node ${PACK_REL}/scripts/cli.mjs replay --prior packet.json --clock <iso> [--out replay.json]
  node ${PACK_REL}/scripts/cli.mjs correct --prior packet.json --clock <iso> \\
    [--fixture-old <path>] [--fixture-new <path>] [--correction <note>] [--out corrected.json]

Flags:
  --manifest --lockfile --source-root (repeatable) --dep --old --new
  --fixture-old --fixture-new --clock --out
  --prior (replay/correct; analyze may attach an immutable prior ref)
  --correction --compact --evidence-class fixture|live-capture|synthetic
  --live-capture  request live acquisition (still no fetch in this CLI; acquire module may)
  --src-root      override src module directory (default pack src/, or $${"S127_UPGRADE_IMPACT_SRC"})

Offline default. Does not npm install, run lifecycle scripts, post, pay, or merge.
When src/*.mjs siblings are missing, emits a valid packet with unknown stages
and contract-safe nextAction (never "action" from a version bump alone).

Kill condition: if binding never changes the decision relative to registry
fetch + changelog on real cases A/B, record negative evidence and stop
packaging as a paid job.`;
}
