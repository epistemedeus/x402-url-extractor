/**
 * Thin packument CLI. Offline default.
 *
 *   node cli.mjs --path FILE --clock ISO [--old V --new V]
 *   node cli.mjs --name cookie --clock ISO [--old V --new V]
 *   node cli.mjs --live --name cookie --clock ISO
 *
 * Never npm install. Never extract tarballs. Never run lifecycle scripts.
 */

import { loadPackument } from "./packument.mjs";

function usage() {
  return `c28-packument-thin — read saved npm packument JSON (offline default)

Usage:
  node cli.mjs --path <packument.json> --clock <ISO-8601> [--old <ver> --new <ver>]
  node cli.mjs --name <pkg> --clock <ISO-8601> [--old <ver> --new <ver>]
  node cli.mjs --live --name <pkg> --clock <ISO-8601> [--registry <url>] [--old <ver> --new <ver>]

--live is opt-in. Without it, no network is used.
`;
}

function parseArgs(argv) {
  const out = { live: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--live") {
      out.live = true;
      continue;
    }
    if (arg === "--compact") {
      out.compact = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`unexpected argument: ${arg}`);
    }
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value == null || value.startsWith("--")) {
      throw new Error(`missing value for --${key}`);
    }
    i += 1;
    if (key === "path") out.path = value;
    else if (key === "name") out.name = value;
    else if (key === "clock") out.clock = value;
    else if (key === "old") out.oldVersion = value;
    else if (key === "new") out.newVersion = value;
    else if (key === "registry") out.registry = value;
    else if (key === "mode") out.mode = value;
    else if (key === "fixture-root") out.fixtureRoot = value;
    else throw new Error(`unknown flag --${key}`);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  process.stdout.write(usage());
  process.exit(0);
}

const result = await loadPackument({
  path: args.path,
  name: args.name,
  clock: args.clock,
  oldVersion: args.oldVersion,
  newVersion: args.newVersion,
  registry: args.registry,
  mode: args.mode,
  live: args.live,
  fixtureRoot: args.fixtureRoot,
});

process.stdout.write(`${args.compact ? JSON.stringify(result) : JSON.stringify(result, null, 2)}\n`);
process.exit(result.ok && (result.selection ? result.selection.ok : true) ? 0 : 1);
