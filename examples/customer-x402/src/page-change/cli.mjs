import { dirname, resolve } from "node:path";
import { comparePageBatches, renderReport } from "./compare.mjs";
import { DEFAULT_LIMITS } from "./constants.mjs";
import { importC2, importC2Snapshot } from "./provenance.mjs";
import { normalizeFields } from "./fields.mjs";

const ALLOWED_OPTIONS = new Set([
  "before", "after", "job", "clock", "format", "fields",
  "max-bytes", "max-json-depth", "max-json-nodes", "max-changes",
  "max-excerpt-bytes", "max-stale-ms", "max-sources", "max-fields",
]);

function usage() {
  return `Usage:
  page-change compare --before PATH --after PATH --fields title,description [options]
  page-change job --job PATH [options]

Compare two already delivered batch JSON artifacts for explicitly selected fields.
This command does not fetch URLs, pay, retry, or schedule a second purchase.

Options:
  --fields a,b             Required explicit field list (title, description, headings, ...).
  --clock ISO8601          Comparison clock (UTC, trailing Z). Freshness is unknown without it.
  --max-stale-ms N         Explicit freshness horizon. Current/fresh stay false without it.
  --max-bytes N            Raw artifact byte ceiling (default ${DEFAULT_LIMITS.maxBytes}).
  --format json|text       Output format (default json).
  --allow-fresh-claim      Set claims.fresh only when clock, horizon, and timestamps prove currency.
`;
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (token === "--allow-fresh-claim") {
      args.allowFreshClaim = true;
      continue;
    }
    if (token.startsWith("--")) {
      const key = token.slice(2);
      if (!ALLOWED_OPTIONS.has(key)) throw new Error(`unknown option --${key}`);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`missing value for --${key}`);
      args[key] = value;
      i += 1;
      continue;
    }
    args._.push(token);
  }
  return args;
}

function integerFlag(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${field} must be a finite non-negative integer`);
  }
  return number;
}

function limitsFromArgs(args) {
  const limits = {};
  const map = {
    "max-bytes": "maxBytes",
    "max-json-depth": "maxJsonDepth",
    "max-json-nodes": "maxJsonNodes",
    "max-changes": "maxChanges",
    "max-excerpt-bytes": "maxExcerptBytes",
    "max-stale-ms": "maxStaleMs",
    "max-sources": "maxSources",
    "max-fields": "maxFields",
  };
  for (const [flag, field] of Object.entries(map)) {
    if (args[flag] !== undefined) limits[field] = integerFlag(args[flag], flag);
  }
  return limits;
}

async function loadJob(path) {
  const c2 = await importC2();
  const snapshot = await importC2Snapshot();
  const maxBytes = c2.DEFAULT_LIMITS.maxBytes;
  const bytes = snapshot.readBoundedFile(path, maxBytes);
  if (bytes.length > maxBytes) throw new Error("job file exceeds byte limit");
  const raw = JSON.parse(bytes.toString("utf8"));
  const root = dirname(path);
  if (!raw.before || !raw.after) throw new Error("job file requires before and after paths");
  if (!raw.fields) throw new Error("job file requires explicit fields");
  return {
    ...raw,
    fields: normalizeFields(raw.fields),
    before: resolve(root, raw.before),
    after: resolve(root, raw.after),
  };
}

export async function main(argv = process.argv.slice(2), io = process) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    io.stderr.write(`${error.message}\n${usage()}`);
    return 2;
  }
  if (args.help || args._.length === 0) {
    io.stdout.write(usage());
    return args.help ? 0 : 2;
  }
  const command = args._[0];
  const format = args.format ?? "json";
  if (format !== "json" && format !== "text") {
    io.stderr.write("format must be json or text\n");
    return 2;
  }
  try {
    if (command === "compare") {
      if (!args.before || !args.after) throw new Error("compare requires --before and --after");
      if (!args.fields) throw new Error("compare requires --fields");
      const report = await comparePageBatches(args.before, args.after, {
        fields: args.fields,
        limits: limitsFromArgs(args),
        clock: args.clock,
        allowFreshClaim: args.allowFreshClaim === true,
      });
      io.stdout.write(renderReport(report, format));
      return 0;
    }
    if (command === "job") {
      if (!args.job) throw new Error("job requires --job");
      const job = await loadJob(args.job);
      const report = await comparePageBatches(job.before, job.after, {
        fields: args.fields ? normalizeFields(args.fields) : job.fields,
        limits: { ...(job.limits ?? {}), ...limitsFromArgs(args) },
        clock: args.clock ?? job.clock,
        allowFreshClaim: args.allowFreshClaim === true || job.allowFreshClaim === true,
      });
      io.stdout.write(`${JSON.stringify({ job: { id: job.id ?? null, title: job.title ?? null, fields: report.fields }, report }, null, 2)}\n`);
      return 0;
    }
    throw new Error(`unknown command: ${command}`);
  } catch (error) {
    io.stderr.write(`${error.message}\n`);
    return 2;
  }
}
