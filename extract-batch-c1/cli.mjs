#!/usr/bin/env node
import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { planJob, runBatch } from "./batch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function usage() {
  return `Usage:
  node src/cli.mjs --sources <json-array|file> --checkpoint <path> [options]

Options:
  --sources <json|file>     JSON array of fixture:/http(s) sources, or path to JSON file
  --checkpoint <path>       Resumable checkpoint JSON path (required)
  --fixture-root <path>     Root for fixture: sources (default: ./fixtures)
  --requirement <json|file> Exact extraction fields, e.g. {"fields":["title","links"]}
  --allow-live              Permit live http(s) with SSRF/size/redirect ceilings
  --retry-unknown           Explicitly retry items left in unknown state (off by default)
  --max-requests <n>
  --max-bytes-total <n>
  --max-bytes-per-item <n>
  --max-wall-ms <n>
  --max-retries <n>
  --timeout-ms <n>
  --max-redirects <n>
  --job-id <id>
  --out <path>              Write final result JSON (default: stdout only summary)
`;
}

async function readJsonMaybe(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    return JSON.parse(trimmed);
  }
  const handle = await fs.open(trimmed, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 10_000_000) throw new Error("JSON input must be a regular file of at most 10 MB");
    const buffer = Buffer.alloc(10_000_001);
    let count = 0;
    while (count < buffer.length) {
      const read = await handle.read(buffer, count, buffer.length - count, null);
      if (!read.bytesRead) break;
      count += read.bytesRead;
    }
    if (count > 10_000_000) throw new Error("JSON input exceeds 10 MB");
    return JSON.parse(buffer.subarray(0, count).toString("utf8"));
  } finally { await handle.close(); }
}

function parseArgs(argv) {
  const out = {
    allowLive: false,
    retryUnknown: false,
    costParameters: {},
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--sources":
        out.sourcesRef = next();
        break;
      case "--checkpoint":
        out.checkpointPath = next();
        break;
      case "--fixture-root":
        out.fixtureRoot = next();
        break;
      case "--requirement":
        out.requirementRef = next();
        break;
      case "--allow-live":
        out.allowLive = true;
        break;
      case "--retry-unknown":
        out.retryUnknown = true;
        break;
      case "--max-requests":
        out.costParameters.maxRequests = Number(next());
        break;
      case "--max-bytes-total":
        out.costParameters.maxBytesTotal = Number(next());
        break;
      case "--max-bytes-per-item":
        out.costParameters.maxBytesPerItem = Number(next());
        break;
      case "--max-wall-ms":
        out.costParameters.maxWallTimeMs = Number(next());
        break;
      case "--max-retries":
        out.costParameters.maxRetriesPerItem = Number(next());
        break;
      case "--timeout-ms":
        out.costParameters.timeoutMs = Number(next());
        break;
      case "--max-redirects":
        out.costParameters.maxRedirects = Number(next());
        break;
      case "--job-id":
        out.jobId = next();
        break;
      case "--out":
        out.outPath = next();
        break;
      case "--help":
      case "-h":
        out.help = true;
        break;
      default:
        throw new Error(`unknown argument: ${a}`);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.sourcesRef || !args.checkpointPath) {
    process.stdout.write(usage());
    process.exit(args.help ? 0 : 2);
  }

  const sources = await readJsonMaybe(args.sourcesRef);
  if (args.outPath && path.resolve(args.outPath) === path.resolve(args.checkpointPath)) {
    throw new Error("--out must not overwrite the resumable checkpoint");
  }
  if (!Array.isArray(sources)) {
    throw new Error("--sources must resolve to a JSON array");
  }
  const requirement = args.requirementRef
    ? await readJsonMaybe(args.requirementRef)
    : { fields: ["title", "description", "headings", "links", "jsonLd", "text"] };

  const job = planJob({
    jobId: args.jobId,
    sources,
    requirement,
    checkpointPath: path.resolve(args.checkpointPath),
    fixtureRoot: path.resolve(args.fixtureRoot || path.join(ROOT, "fixtures")),
    allowLive: args.allowLive,
    retryUnknown: args.retryUnknown,
    costParameters: args.costParameters,
  });

  const result = await runBatch(job);
  const text = JSON.stringify(result, null, 2);
  if (args.outPath) {
    await fs.mkdir(path.dirname(path.resolve(args.outPath)), { recursive: true });
    await fs.writeFile(args.outPath, text, "utf8");
  }
  process.stdout.write(text + "\n");
  if (result.status === "stopped" || result.items.some((i) => i.status === "unknown")) {
    process.exitCode = 3;
  } else if (result.items.some((i) => i.status === "failure")) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
