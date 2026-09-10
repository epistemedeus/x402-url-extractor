import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { finish, isFile, readJsonFile } from "./common.mjs";

export const ARTIFACT_ID = "procurement-brief";
export const TRANSFORM_EXPORT = "buildProcurementBrief";
export const VALIDATE_EXPORT = "validateProcurementInput";

export async function execute({ job, inputPath, clock, mode }) {
  if (!isFile(inputPath)) {
    return finish({
      job,
      clock,
      mode,
      inputPath,
      ok: false,
      decision: "invalid",
      error: { code: "unsupported_input", message: "procurement-brief requires a JSON file" },
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
  const mod = await import(pathToFileURL(join(job.moduleRoot, "src/index.mjs")).href);
  const fn = mod.buildProcurementBrief;
  if (typeof fn !== "function") {
    return finish({
      job,
      clock,
      mode,
      inputPath,
      ok: false,
      decision: "unsupported",
      error: { code: "missing_transform", message: "buildProcurementBrief export missing" },
    });
  }
  const native = fn(parsed.value, { clock: () => Date.parse(clock) });
  return finish({
    job,
    clock,
    mode,
    inputPath,
    native,
    decision: native?.status,
  });
}
