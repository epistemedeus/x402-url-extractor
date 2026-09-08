#!/usr/bin/env node

import { HARD_CAPS, RESULT_SCHEMA_VERSION } from "./constants.mjs";
import { prepareOutputDir, readJsonFile, writeOutputFile } from "./io.mjs";
import { parseMapping } from "./mapping.mjs";
import { exitCodeFor, projectRecords } from "./project.mjs";

const USAGE = "Run: node bin/record.mjs --input <json> --mapping <json> --schema <json> --out <dir>";

function values(argv, name) {
  const found = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === `--${name}`) found.push(argv[index + 1]);
  }
  return found;
}

function usageReport(message, code = "cli.usage") {
  return {
    schemaVersion: RESULT_SCHEMA_VERSION,
    ok: false,
    status: "failure",
    issues: [{
      code,
      message,
      repair: USAGE,
    }],
    networkUsed: false,
    credentialsUsed: false,
    evalUsed: false,
    llmUsed: false,
  };
}

function failClosed(report) {
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = exitCodeFor(report.status || "failure");
  return process.exitCode;
}

function missingPathMap(result, artifact) {
  const missingMap = {
    schemaVersion: "pilot.c29.missing-paths.v1",
    artifact,
    byPointer: {},
    entries: result.missingPaths,
  };
  for (const entry of result.missingPaths) {
    const bucket = missingMap.byPointer[entry.pointer] || {
      count: 0,
      field: entry.field,
      reason: entry.reason,
    };
    bucket.count += 1;
    missingMap.byPointer[entry.pointer] = bucket;
  }
  return missingMap;
}

export function writeProjectionOutputs(outDir, result, mapping) {
  const missing = missingPathMap(result, mapping.artifact);
  const usable = [...result.records, ...result.partialRecords];
  const payloadBytes = Buffer.byteLength(`${JSON.stringify(usable, null, 2)}\n`)
    + Buffer.byteLength(`${JSON.stringify(result, null, 2)}\n`)
    + Buffer.byteLength(`${JSON.stringify(missing, null, 2)}\n`);
  if (payloadBytes > mapping.limits.maxOutputBytes) {
    const error = new Error(`output is ${payloadBytes} bytes, above maxOutputBytes ${mapping.limits.maxOutputBytes}; no output files written`);
    error.code = 'io.oversized';
    throw error;
  }
  return writeOutputFile(outDir, "records.json", usable)
    + writeOutputFile(outDir, "report.json", result)
    + writeOutputFile(outDir, "missing-paths.json", missing);
}

export function main(argv = process.argv) {
  const flags = argv[0]?.startsWith("--") ? argv : argv.slice(2);
  const names = flags.filter((_, index) => index % 2 === 0);
  if (flags.length !== 8 || names.some((value) => !["--input", "--mapping", "--schema", "--out"].includes(value))
    || flags.some((value, index) => index % 2 === 1 && (!value || value.startsWith("--")))) {
    return failClosed(usageReport("Only --input, --mapping, --schema, and --out are supported"));
  }
  const input = values(argv, "input");
  const mappingPath = values(argv, "mapping");
  const schema = values(argv, "schema");
  const out = values(argv, "out");
  if ([input, mappingPath, schema, out].some((item) => item.length !== 1)) {
    return failClosed(usageReport("Each flag may be supplied once"));
  }
  try {
    const mappingRaw = readJsonFile(mappingPath[0], HARD_CAPS.maxMappingBytes, "mapping");
    const mapping = parseMapping(mappingRaw.value);
    if (mapping.recordSchema != null) {
      return failClosed(usageReport("CLI --schema cannot be combined with mapping.recordSchema"));
    }
    const inputFile = readJsonFile(input[0], mapping.limits.maxInputBytes, "input");
    const schemaFile = readJsonFile(schema[0], HARD_CAPS.maxSchemaBytes, "schema");
    const result = projectRecords({
      document: inputFile.value,
      mapping,
      schema: schemaFile.value,
      artifactName: mapping.artifact,
      inputText: inputFile.text,
    });
    const output = prepareOutputDir(out[0], [input[0], mappingPath[0], schema[0]]);
    const bytes = writeProjectionOutputs(output, result, mapping);
    result.outputBytes = bytes;
    result.outputDir = output;
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = exitCodeFor(result.status);
    return process.exitCode;
  } catch (error) {
    return failClosed(usageReport(error.message, error.code || "cli.usage"));
  }
}
