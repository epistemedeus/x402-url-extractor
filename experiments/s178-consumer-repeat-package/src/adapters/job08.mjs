import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { finish, isFile, readJsonFile } from "./common.mjs";

export const ARTIFACT_ID = "customer-result-package";
export const TRANSFORM_EXPORT = "assembleCustomerResultPackage";
export const VALIDATE_EXPORT = "validateResultRequest";

export async function execute({ job, inputPath, clock, mode }) {
  if (!isFile(inputPath)) {
    return finish({
      job,
      clock,
      mode,
      inputPath,
      ok: false,
      decision: "invalid",
      error: { code: "unsupported_input", message: "customer-result-package requires a JSON file" },
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
  const mod = await import(pathToFileURL(join(job.moduleRoot, "src/assemble.mjs")).href);
  const fn = mod.assembleCustomerResultPackage;
  if (typeof fn !== "function") {
    return finish({
      job,
      clock,
      mode,
      inputPath,
      ok: false,
      decision: "unsupported",
      error: {
        code: "missing_assemble",
        message: "assembleCustomerResultPackage export missing",
      },
    });
  }
  const native = fn(parsed.value, { clock: () => Date.parse(clock) });
  let decision = native?.status || native?.packageStatus;
  const pending = (native?.recipes || []).filter((s) =>
    /unavailable|pending_heavy/i.test(String(s.status || "")),
  );
  if ((decision === "pass" || decision === "ready") && pending.length) decision = "partial";
  return finish({
    job,
    clock,
    mode,
    inputPath,
    native,
    decision,
    extraLimitations: pending.length
      ? [`${pending.length} recipe slot(s) unavailable_pending_heavy — recorded honestly`]
      : [],
  });
}
