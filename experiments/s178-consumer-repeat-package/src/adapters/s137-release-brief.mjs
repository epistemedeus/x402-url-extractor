import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { finish, isFile, readJsonFile } from "./common.mjs";

export const ARTIFACT_ID = "release-brief";
export const TRANSFORM_EXPORT = "buildReleaseBrief";
export const VALIDATE_EXPORT = "validateReleaseBriefInput";

function unwrap(raw, clock) {
  let input = raw;
  if (
    raw &&
    typeof raw === "object" &&
    !Object.hasOwn(raw, "sources") &&
    raw.input &&
    typeof raw.input === "object" &&
    (raw.schema === "s137.release-brief.synthetic-case.v1" ||
      raw.caseClass ||
      raw.lanes ||
      raw.expect)
  ) {
    input = { ...raw.input };
  }
  if (clock && input && typeof input === "object" && !Array.isArray(input)) {
    input = { ...input, clock: Object.hasOwn(input, "clock") ? input.clock : clock };
  }
  return input;
}

export async function execute({ job, inputPath, clock, mode }) {
  if (!isFile(inputPath)) {
    return finish({
      job,
      clock,
      mode,
      inputPath,
      ok: false,
      decision: "invalid",
      error: { code: "unsupported_input", message: "release-brief import/run requires a JSON file" },
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
  const schemaMod = await import(
    pathToFileURL(join(job.moduleRoot, "src/release-brief/schema.mjs")).href
  );
  const transformMod = await import(
    pathToFileURL(join(job.moduleRoot, "src/release-brief/transform.mjs")).href
  );
  const fn = transformMod.buildReleaseBrief;
  if (typeof fn !== "function") {
    return finish({
      job,
      clock,
      mode,
      inputPath,
      ok: false,
      decision: "unsupported",
      error: { code: "missing_transform", message: "buildReleaseBrief export missing" },
    });
  }
  const input = unwrap(parsed.value, clock);
  let schemaRejected = false;
  let schemaError = null;
  if (typeof schemaMod.validateReleaseBriefInput === "function") {
    const v = schemaMod.validateReleaseBriefInput(input);
    if (v && v.ok === false) {
      schemaRejected = true;
      schemaError = v;
    }
  }
  const native = fn(input);
  const decision = native?.decision || native?.brief?.decision;
  return finish({
    job,
    clock,
    mode,
    inputPath,
    native,
    ok: !schemaRejected && native?.ok !== false,
    error: schemaRejected || native?.ok === false
      ? { code: "invalid_input", issues: schemaError?.issues ?? native?.issues ?? [] }
      : null,
    decision: schemaRejected && decision === "pass" ? "invalid" : decision,
    schemaRejected,
    schemaError,
    extraLimitations: schemaRejected ? ["schema_rejected_on_validated_input"] : [],
  });
}
