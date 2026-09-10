#!/usr/bin/env node
/**
 * S178 consumer-repeat CLI — unified offline entry for jobs 01–08 (+ compose).
 *
 *   node bin/s178-cli.mjs list
 *   node bin/s178-cli.mjs run <job> --in <path> --clock <ISO> [--mode cli|import]
 *   node bin/s178-cli.mjs example <job> [--kind positive|partial|negative|conflict]
 *   node bin/s178-cli.mjs help
 */
import { buildCatalog, findJob } from "../src/catalog.mjs";
import { examplePath, runJob } from "../src/run-job.mjs";

function usage() {
  return `S178 consumer-repeat package (offline; no paid/network execution).

Commands:
  list
  run <job> --in <path> --clock <ISO-8601> [--mode cli|import] [--type journey|package] [--json]
  example <job> [--kind positive|partial|negative|conflict]
  help

Jobs: 01..08 artifact ids / aliases, or acquire (compose acquisition status).

Examples:
  node bin/s178-cli.mjs list
  node bin/s178-cli.mjs run release-brief --in vendor/.../conflict-sha-mismatch.json --clock 2026-09-10T18:00:00.000Z
  node bin/s178-cli.mjs run 07 --in path/to/positive.json --clock 2026-09-10T18:00:00.000Z --mode import
`;
}

function parseArgs(argv) {
  const out = {
    cmd: null,
    job: null,
    inPath: null,
    clock: null,
    mode: "cli",
    kind: "positive",
    type: null,
    json: true,
  };
  if (!argv.length) return out;
  out.cmd = argv[0];
  let i = 1;
  if (out.cmd === "run" || out.cmd === "example") {
    out.job = argv[i++];
  }
  for (; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--in") out.inPath = argv[++i];
    else if (a === "--clock") out.clock = argv[++i];
    else if (a === "--mode") out.mode = argv[++i];
    else if (a === "--kind") out.kind = argv[++i];
    else if (a === "--type") out.type = argv[++i];
    else if (a === "--json") out.json = true;
    else if (a === "--help" || a === "-h") out.cmd = "help";
    else throw new Error(`Unknown arg: ${a}`);
  }
  return out;
}

async function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: err.message }));
    console.error(usage());
    process.exit(2);
  }

  if (!args.cmd || args.cmd === "help") {
    process.stdout.write(usage());
    process.exit(args.cmd ? 0 : 2);
  }

  if (args.cmd === "list") {
    const catalog = buildCatalog();
    console.log(JSON.stringify(catalog, null, 2));
    process.exit(0);
  }

  if (args.cmd === "example") {
    const job = findJob(args.job);
    if (!job) {
      console.error(JSON.stringify({ ok: false, error: `unknown job ${args.job}` }));
      process.exit(1);
    }
    const path = examplePath(job, args.kind);
    console.log(
      JSON.stringify(
        {
          ok: Boolean(path),
          jobId: job.jobId,
          artifactId: job.artifactId,
          kind: args.kind,
          path,
        },
        null,
        2,
      ),
    );
    process.exit(path ? 0 : 1);
  }

  if (args.cmd === "run") {
    if (!args.job) {
      console.error(JSON.stringify({ ok: false, error: "run requires a job token" }));
      process.exit(2);
    }
    const result = await runJob({
      jobToken: args.job,
      inputPath: args.inPath,
      clock: args.clock,
      mode: args.mode === "import" ? "import" : "cli",
      type: args.type,
    });
    console.log(JSON.stringify(result, null, 2));
    // Exit 0 for honest completed runs (including conflict/fail/partial).
    // Exit 1 only for runner/transport failures (ok:false).
    process.exit(result.ok ? 0 : 1);
  }

  console.error(JSON.stringify({ ok: false, error: `unknown command ${args.cmd}` }));
  console.error(usage());
  process.exit(2);
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message, stack: err.stack }));
  process.exit(1);
});
