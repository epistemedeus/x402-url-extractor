#!/usr/bin/env node
/**
 * Stage-1 kill-condition harness.
 *
 *   node harness.mjs compare <method-a.json> <method-b.json>
 *   node harness.mjs suite <manifest.json>
 *   node harness.mjs skim <input.json>
 *   node harness.mjs isolation
 *   node harness.mjs selftest
 *
 * Emits keep | kill | unknown with rationale. Offline. No payment.
 */
import { fileURLToPath } from "node:url";
import { compareDecisions } from "./lib/compare.mjs";
import { skimRegistryChangelog } from "./lib/skim.mjs";
import { runSuite } from "./lib/suite.mjs";
import { tryReadJsonFile, writeJsonFile } from "./lib/io.mjs";
import { CELL_ROOT, cellJoin } from "./lib/paths.mjs";
import { runIsolationSelfCheck } from "./isolation-self-check.mjs";

export { compareDecisions } from "./lib/compare.mjs";
export { skimRegistryChangelog } from "./lib/skim.mjs";
export { runSuite } from "./lib/suite.mjs";
export { extractDecision, coarseBucket } from "./lib/extract.mjs";

const USAGE = `c22-kill-harness — compare registry+changelog skim vs usage-binding packet

Usage:
  node harness.mjs compare <method-a.json> <method-b.json> [--out file] [--mode coarse|exact]
  node harness.mjs suite <manifest.json> [--out file] [--mode coarse|exact]
  node harness.mjs skim <input.json> [--out file]
  node harness.mjs isolation [--out file]
  node harness.mjs selftest

Exit: 0 on successful emit (verdict is JSON data). 1 on usage/IO error.
      --exit-on-verdict maps keep=0 kill=2 unknown=3.
`;

export function parseArgs(argv) {
  const args = { command: null, positionals: [], flags: {} };
  const rest = argv.slice(2);
  if (rest.length === 0) return args;
  let start = 0;
  if (rest[0] === "--help" || rest[0] === "-h") {
    args.flags.help = true;
    return args;
  }
  args.command = rest[0];
  start = 1;
  for (let i = start; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === "--help" || token === "-h") {
      args.flags.help = true;
      continue;
    }
    if (token === "--exit-on-verdict") {
      args.flags.exitOnVerdict = true;
      continue;
    }
    if (token === "--allow-tmp") {
      args.flags.allowTmp = true;
      continue;
    }
    if (token.startsWith("--") && token.includes("=")) {
      const eq = token.indexOf("=");
      const key = token.slice(2, eq);
      args.flags[flagKey(key)] = token.slice(eq + 1);
      continue;
    }
    if (token.startsWith("--")) {
      const key = flagKey(token.slice(2));
      const next = rest[i + 1];
      if (next && !next.startsWith("--")) {
        args.flags[key] = next;
        i += 1;
      } else {
        args.flags[key] = true;
      }
      continue;
    }
    args.positionals.push(token);
  }
  return args;
}

function flagKey(name) {
  return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

export function runCommand(args) {
  const command = args.command;
  if (!command || args.flags.help) {
    return { ok: command === null ? false : true, code: command ? "help" : "usage", usage: USAGE, result: null };
  }

  if (command === "compare") {
    const aPath = args.positionals[0] || args.flags.a;
    const bPath = args.positionals[1] || args.flags.b;
    if (!aPath || !bPath) {
      return { ok: false, code: "usage", message: "compare requires two JSON paths", usage: USAGE };
    }
    const aLoaded = tryReadJsonFile(aPath);
    const bLoaded = tryReadJsonFile(bPath);
    if (!aLoaded.ok) {
      const result = compareDecisions(null, bLoaded.ok ? bLoaded.body : null, {
        aPath,
        bPath,
        aExtract: {
          ok: false,
          path: aPath,
          method: "registry_version_changelog_skim",
          raw: null,
          coarse: "unknown",
          source: "unreadable",
          code: aLoaded.code,
          message: aLoaded.message,
        },
        mode: args.flags.mode || "coarse",
      });
      return finish(args, result);
    }
    if (!bLoaded.ok) {
      const result = compareDecisions(aLoaded.body, null, {
        aPath,
        bPath,
        bExtract: {
          ok: false,
          path: bPath,
          method: "usage_binding_packet",
          raw: null,
          coarse: "unknown",
          source: "unreadable",
          code: bLoaded.code,
          message: bLoaded.message,
        },
        mode: args.flags.mode || "coarse",
      });
      return finish(args, result);
    }
    const result = compareDecisions(aLoaded.body, bLoaded.body, {
      aPath,
      bPath,
      mode: args.flags.mode || "coarse",
    });
    return finish(args, result);
  }

  if (command === "suite") {
    const manifestPath = args.positionals[0] || args.flags.manifest;
    if (!manifestPath) {
      return { ok: false, code: "usage", message: "suite requires a manifest JSON path", usage: USAGE };
    }
    const loaded = tryReadJsonFile(manifestPath);
    if (!loaded.ok) {
      return { ok: false, code: loaded.code, message: loaded.message };
    }
    const result = runSuite(loaded.body, {
      manifestPath,
      mode: args.flags.mode || "coarse",
    });
    return finish(args, result);
  }

  if (command === "skim") {
    const inputPath = args.positionals[0] || args.flags.input;
    if (!inputPath) {
      return { ok: false, code: "usage", message: "skim requires an input JSON path", usage: USAGE };
    }
    const loaded = tryReadJsonFile(inputPath);
    if (!loaded.ok) {
      return { ok: false, code: loaded.code, message: loaded.message };
    }
    const result = skimRegistryChangelog(loaded.body);
    return finish(args, result);
  }

  if (command === "isolation") {
    const result = runIsolationSelfCheck();
    return finish(args, result);
  }

  if (command === "selftest") {
    const result = runSelftest();
    return finish(args, result);
  }

  return { ok: false, code: "usage", message: `unknown command: ${command}`, usage: USAGE };
}

function finish(args, result) {
  const out = args.flags.out;
  if (out) {
    try {
      const written = writeJsonFile(out, result, { allowTmp: args.flags.allowTmp === true });
      return { ok: true, result, written };
    } catch (error) {
      return {
        ok: false,
        code: error.code || "write_failed",
        message: error instanceof Error ? error.message : String(error),
        result,
      };
    }
  }
  return { ok: true, result, written: null };
}

function runSelftest() {
  const suites = [
    ["synthetic-keep", cellJoin("fixtures/suites/synthetic-keep.json"), "keep"],
    ["synthetic-kill", cellJoin("fixtures/suites/synthetic-kill.json"), "kill"],
    ["real-ab", cellJoin("fixtures/suites/real-ab.json"), "kill"],
    ["incomplete", cellJoin("fixtures/suites/incomplete.json"), "unknown"],
  ];
  const rows = [];
  let failed = 0;
  for (const [id, path, expect] of suites) {
    const loaded = tryReadJsonFile(path);
    if (!loaded.ok) {
      failed += 1;
      rows.push({ id, ok: false, expect, actual: null, code: loaded.code, message: loaded.message });
      continue;
    }
    const result = runSuite(loaded.body, { manifestPath: path, mode: "coarse" });
    const matched = result.verdict === expect;
    if (!matched) failed += 1;
    rows.push({ id, ok: matched, expect, actual: result.verdict, changedIds: result.changedIds });
  }

  const pairKeep = spawnHarness(["compare", cellJoin("fixtures/cases/synthetic-standin-a/registry-skim-decision.json"), cellJoin("fixtures/cases/synthetic-standin-a/binding-packet.json")]);
  const pairKill = spawnHarness(["compare", cellJoin("fixtures/cases/kill-both-action/case-a/registry-skim-decision.json"), cellJoin("fixtures/cases/kill-both-action/case-a/binding-packet.json")]);
  if (pairKeep.result?.verdict !== "keep") failed += 1;
  if (pairKill.result?.verdict !== "kill") failed += 1;
  rows.push({ id: "pair-keep-standin-a", ok: pairKeep.result?.verdict === "keep", expect: "keep", actual: pairKeep.result?.verdict ?? null });
  rows.push({ id: "pair-kill-both-action-a", ok: pairKill.result?.verdict === "kill", expect: "kill", actual: pairKill.result?.verdict ?? null });

  return {
    schema: "s127.upgrade-impact.kill-selftest.v1",
    ok: failed === 0,
    failed,
    cellRoot: CELL_ROOT,
    payment: { attempted: false },
    rows,
  };
}

function spawnHarness(argv) {
  const ran = runCommand({ command: argv[0], positionals: argv.slice(1), flags: {} });
  return ran;
}

export function main(argv = process.argv) {
  const args = parseArgs(argv);
  const ran = runCommand(args);
  if (args.flags.help || ran.code === "help") {
    process.stdout.write(USAGE);
    return 0;
  }
  if (!ran.ok) {
    process.stderr.write(`${ran.message || ran.code || "error"}\n`);
    if (ran.usage) process.stderr.write(ran.usage);
    return 1;
  }
  if (!ran.written) {
    process.stdout.write(`${JSON.stringify(ran.result, null, 2)}\n`);
  }
  if (args.flags.exitOnVerdict) {
    const verdict = ran.result?.verdict;
    if (verdict === "kill") return 2;
    if (verdict === "unknown") return 3;
    return 0;
  }
  return 0;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const code = main(process.argv);
  process.exit(code);
}
