import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { finish, isFile, readJsonFile } from "./common.mjs";

export const ARTIFACT_ID = "acquisition-status";
export const TRANSFORM_EXPORT = "acquisitionStatusFromPath";
export const VALIDATE_EXPORT = "content-discriminated journey|package";

/**
 * Derive compose input kind from validated content, not from the filename.
 * Explicit options.type may override when it matches the content.
 */
export function classifyComposeInput(raw, explicitType) {
  const isJourney = Boolean(raw && (Array.isArray(raw.steps) || raw.journey === true));
  const isPackage = Boolean(raw && Array.isArray(raw.recipes) && raw.status);
  if (explicitType === "journey" || explicitType === "package") {
    if (explicitType === "journey" && !isJourney) {
      return { kind: null, error: "explicit --type journey but input has no steps[] / journey:true" };
    }
    if (explicitType === "package" && !isPackage) {
      return { kind: null, error: "explicit --type package but input has no status+recipes" };
    }
    return { kind: explicitType };
  }
  if (isJourney) return { kind: "journey" };
  if (isPackage) return { kind: "package" };
  return { kind: null, error: "input is neither a journey (steps[]/journey:true) nor a package (status+recipes)" };
}

export async function execute({ job, inputPath, clock, mode, type }) {
  if (!isFile(inputPath)) {
    return finish({
      job,
      clock,
      mode,
      inputPath,
      ok: false,
      decision: "invalid",
      error: { code: "unsupported_input", message: "acquire requires a journey or package JSON file" },
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
  const classified = classifyComposeInput(parsed.value, type);
  if (!classified.kind) {
    return finish({
      job,
      clock,
      mode,
      inputPath,
      ok: false,
      decision: "invalid",
      error: { code: "invalid_input", message: classified.error },
    });
  }
  const mod = await import(
    pathToFileURL(join(job.moduleRoot, "src/acquisition-status.mjs")).href
  );
  const fn = mod.acquisitionStatusFromPath;
  if (typeof fn !== "function") {
    return finish({
      job,
      clock,
      mode,
      inputPath,
      ok: false,
      decision: "unsupported",
      error: { code: "missing_transform", message: "acquisitionStatusFromPath export missing" },
    });
  }
  let native;
  try {
    native = fn(inputPath, classified.kind === "journey" ? { step: "positive-journey" } : {});
  } catch (err) {
    return finish({
      job,
      clock,
      mode,
      inputPath,
      ok: false,
      decision: err.code === "invalid_input" ? "invalid" : "fail",
      error: { code: err.code || "compose_failed", message: err.message },
    });
  }
  return finish({
    job,
    clock,
    mode,
    inputPath,
    native,
    decision: native?.packageStatus,
  });
}
