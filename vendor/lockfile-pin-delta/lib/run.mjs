import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { cliRefuse } from "./errors.mjs";
import { parseArgs } from "./args.mjs";
import { isSampleLabeled, sampleReason } from "./sample.mjs";
import { parseLockfileText } from "./parse-lockfile.mjs";
import { comparePinMaps } from "./compare.mjs";
import { toMarkdown } from "./format.mjs";
import { createHashTermsAdapter } from "./hash-terms.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "..");
export const JOURNEY_BEFORE = path.join(ROOT, "fixtures/journey/before.json");
export const JOURNEY_AFTER = path.join(ROOT, "fixtures/journey/after.json");

function readText(filePath, label) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") {
      throw cliRefuse("missing-input-file", `${label} not found: ${filePath}`, { path: filePath });
    }
    throw err;
  }
}

function realpathOrAbs(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function classifyProvenance(beforePath, afterPath, exampleMode) {
  if (exampleMode) return "fixture";
  const paths = [beforePath, afterPath].map((p) => path.resolve(String(p)));
  if (paths.some((p) => p.includes(`${path.sep}lockfile-pin-delta${path.sep}fixtures${path.sep}`))) {
    return "fixture";
  }
  if (paths.some((p) => path.basename(p) === "package-lock.json")) return "local-runtime";
  return "caller-supplied";
}

function resolveOutDir(args, sourcePaths) {
  const sources = sourcePaths.map(realpathOrAbs);
  const sourceSet = new Set(sources);
  let outDir;
  if (args["out-dir"]) outDir = path.resolve(String(args["out-dir"]));
  else {
    outDir = path.join(
      process.cwd(),
      "out",
      "lockfile-pin-delta",
      `run-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`,
    );
  }
  if (sourceSet.has(realpathOrAbs(outDir)) || sources.some((s) => outDir === s || outDir.startsWith(`${s}${path.sep}`))) {
    throw cliRefuse("out-dir-collides-with-input", "Output directory collides with a source input path", {
      outDir,
      sources,
    });
  }
  fs.mkdirSync(outDir, { recursive: true });
  return outDir;
}

function requireCallerInputs(args) {
  if (args.example === true || args.example === "true") return { mode: "example" };
  const missing = ["before", "after"].filter((k) => !args[k]);
  if (missing.length) {
    throw cliRefuse(
      "missing-required-inputs",
      "Caller mode requires --before and --after; use --example for the labeled journey fixture",
      { missing },
    );
  }
  return { mode: "caller" };
}

function assertNotSampleAsCustomer({ beforePath, afterPath, beforeDoc, afterDoc, exampleMode, asCustomer }) {
  const labeled = [];
  if (isSampleLabeled(beforePath, beforeDoc)) labeled.push({ path: beforePath, reason: sampleReason(beforePath, beforeDoc) });
  if (isSampleLabeled(afterPath, afterDoc)) labeled.push({ path: afterPath, reason: sampleReason(afterPath, afterDoc) });
  const treatAsCustomer = asCustomer || !exampleMode;
  if (labeled.length && treatAsCustomer) {
    throw cliRefuse(
      "sample-as-customer-delta",
      "SAMPLE lockfile cannot be emitted as a customer pin delta",
      { labeled, exampleMode: Boolean(exampleMode), asCustomer: Boolean(asCustomer) },
    );
  }
}

export function runLockfileDelta(argv, options = {}) {
  const args = Array.isArray(argv) ? parseArgs(argv) : argv;
  const mode = requireCallerInputs(args);
  const exampleMode = mode.mode === "example";
  const beforePath = exampleMode ? JOURNEY_BEFORE : path.resolve(String(args.before));
  const afterPath = exampleMode ? JOURNEY_AFTER : path.resolve(String(args.after));
  const asCustomer = args["as-customer"] === true || args.customer === true;

  if (asCustomer && exampleMode) {
    throw cliRefuse(
      "sample-as-customer-delta",
      "SAMPLE or --example output cannot be emitted as a customer pin delta",
      { exampleMode: true, asCustomer: true },
    );
  }

  const adapter = createHashTermsAdapter(options.hashPinTerms);
  const beforeText = readText(beforePath, "before");
  const afterText = readText(afterPath, "after");
  const before = parseLockfileText(beforeText, { label: "before", hashPinTerms: adapter.hashPinTerms });
  const after = parseLockfileText(afterText, { label: "after", hashPinTerms: adapter.hashPinTerms });

  assertNotSampleAsCustomer({
    beforePath,
    afterPath,
    beforeDoc: before.doc,
    afterDoc: after.doc,
    exampleMode,
    asCustomer,
  });

  const report = comparePinMaps(before, after);
  report.caller = {
    before: beforePath,
    after: afterPath,
    exampleMode,
    sampleLabel: exampleMode ? "explicit-example" : "caller-input",
    notCustomerDemand: true,
    notMarketFact: true,
  };
  report.provenance = classifyProvenance(beforePath, afterPath, exampleMode);
  report.generatedAt = new Date().toISOString();

  const outDir = options.outDir || resolveOutDir(args, [beforePath, afterPath]);
  const jsonPath = path.join(outDir, "pin-delta.json");
  const mdPath = path.join(outDir, "pin-delta.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(mdPath, toMarkdown(report));
  report.outDir = outDir;
  report.outputs = ["pin-delta.json", "pin-delta.md"];
  report.reportSha256 = createHash("sha256").update(fs.readFileSync(jsonPath)).digest("hex");
  return report;
}

export function tmpOutDir(prefix = "lockfile-pin-delta-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
