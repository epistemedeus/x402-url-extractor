import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { finish, isDir, isFile, readJsonFile, sha256Bytes, walkFiles } from "./common.mjs";

export const ARTIFACT_ID = "link-index";
export const TRANSFORM_EXPORT = "transform";
export const VALIDATE_EXPORT = "validateInput";

function safeId(rel, prefix = "a") {
  const cleaned = String(rel).replace(/[^A-Za-z0-9._:-]+/g, "-").replace(/^-+/, "");
  const core = cleaned || "file";
  const id = /^[A-Za-z]/.test(core) ? core : `${prefix}-${core}`;
  return id.slice(0, 128);
}

function buildFromCaseDir(dir, clock) {
  const expected = JSON.parse(readFileSync(join(dir, "expected.json"), "utf8"));
  const entry = expected.entry;
  const entryAbs = join(dir, entry);
  const body = readFileSync(entryAbs, "utf8");
  const artifacts = [];
  for (const file of walkFiles(dir)) {
    if (file.name === "expected.json" || file.rel === entry) continue;
    const bytes = readFileSync(file.abs);
    artifacts.push({
      id: safeId(file.rel),
      path: file.rel,
      kind: "file",
      body: bytes.toString("utf8"),
      sha256: sha256Bytes(bytes),
    });
  }
  const kind = expected.format === "html" || /\.html?$/i.test(entry) ? "html" : "markdown";
  return {
    schema: "s137.link-index.input.v1",
    clock: clock || expected.clock,
    evidenceClass: expected.evidenceClass || "synthetic",
    documents: [
      {
        id: "entry",
        kind,
        path: entry,
        body,
        sha256: sha256Bytes(Buffer.from(body, "utf8")),
      },
    ],
    artifacts,
  };
}

export async function execute({ job, inputPath, clock, mode }) {
  const transformMod = await import(
    pathToFileURL(join(job.moduleRoot, "src/link-index/transform.mjs")).href
  );
  const schemaMod = await import(
    pathToFileURL(join(job.moduleRoot, "src/link-index/schema.mjs")).href
  );
  const fn = transformMod.transform;
  if (typeof fn !== "function") {
    return finish({
      job,
      clock,
      mode,
      inputPath,
      ok: false,
      decision: "unsupported",
      error: { code: "missing_transform", message: "link-index transform export missing" },
    });
  }

  let input;
  if (isDir(inputPath) && isFile(join(inputPath, "expected.json"))) {
    input = buildFromCaseDir(inputPath, clock);
  } else if (isFile(inputPath)) {
    const parsed = readJsonFile(inputPath);
    if (!parsed.ok) {
      return finish({
        job,
        clock,
        mode,
        inputPath,
        ok: false,
        decision: "invalid",
        error: { code: "invalid_json", message: parsed.error.message },
      });
    }
    input = parsed.value;
    if (clock && input && typeof input === "object") input = { ...input, clock: input.clock || clock };
  } else {
    return finish({
      job,
      clock,
      mode,
      inputPath,
      ok: false,
      decision: "invalid",
      error: {
        code: "unsupported_input",
        message: "link-index needs a case directory (expected.json + source) or schema-valid JSON with documents[]",
      },
    });
  }

  let schemaRejected = false;
  let schemaError = null;
  if (typeof schemaMod.validateInput === "function") {
    const v = schemaMod.validateInput(input);
    if (v && v.ok === false) {
      schemaRejected = true;
      schemaError = v;
    }
  }

  let native;
  try {
    native = fn(input);
  } catch (err) {
    return finish({
      job,
      clock,
      mode,
      inputPath,
      ok: false,
      decision: schemaRejected ? "invalid" : "fail",
      error: { code: "transform_threw", message: err.message, issues: err.issues },
      schemaRejected,
      schemaError,
    });
  }
  const decision = native?.decision;
  return finish({
    job,
    clock,
    mode,
    inputPath,
    native,
    decision: schemaRejected && decision === "pass" ? "invalid" : decision,
    schemaRejected,
    schemaError,
  });
}
