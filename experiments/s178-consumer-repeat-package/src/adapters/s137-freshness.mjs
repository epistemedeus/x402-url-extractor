import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { finish, isFile, readJsonFile } from "./common.mjs";

export const ARTIFACT_ID = "freshness-receipt";
export const TRANSFORM_EXPORT = "buildFreshnessReceipt";
export const VALIDATE_EXPORT = "validateInput";

export async function execute({ job, inputPath, clock, mode }) {
  if (!isFile(inputPath)) {
    return finish({
      job,
      clock,
      mode,
      inputPath,
      ok: false,
      decision: "invalid",
      error: { code: "unsupported_input", message: "freshness-receipt requires a JSON file" },
    });
  }
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
  const transformMod = await import(
    pathToFileURL(join(job.moduleRoot, "src/freshness-receipt/transform.mjs")).href
  );
  const schemaMod = await import(
    pathToFileURL(join(job.moduleRoot, "src/freshness-receipt/schema.mjs")).href
  );
  const fn = transformMod.buildFreshnessReceipt;
  const coerce = transformMod.coerceToSchemaInput;
  if (typeof fn !== "function") {
    return finish({
      job,
      clock,
      mode,
      inputPath,
      ok: false,
      decision: "unsupported",
      error: { code: "missing_transform", message: "buildFreshnessReceipt export missing" },
    });
  }
  let input = typeof coerce === "function" ? coerce(parsed.value) : parsed.value;
  if (clock && input && typeof input === "object") input = { ...input, clock: input.clock || clock };
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
      error: { code: "transform_threw", message: err.message },
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
