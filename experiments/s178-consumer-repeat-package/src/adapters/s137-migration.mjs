import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { finish, isDir, isFile, readJsonFile } from "./common.mjs";

export const ARTIFACT_ID = "migration-checklist";
export const TRANSFORM_EXPORT = "transformMigrationChecklist";
export const VALIDATE_EXPORT = "validateInput";

export async function execute({ job, inputPath, clock, mode }) {
  const transformMod = await import(
    pathToFileURL(join(job.moduleRoot, "src/migration-checklist/transform.mjs")).href
  );
  const fn = transformMod.transformMigrationChecklist;
  if (typeof fn !== "function") {
    return finish({
      job,
      clock,
      mode,
      inputPath,
      ok: false,
      decision: "unsupported",
      error: { code: "missing_transform", message: "transformMigrationChecklist export missing" },
    });
  }

  const root = isDir(inputPath) ? inputPath : join(job.fixtureRoot);
  let spec;
  if (isFile(inputPath)) {
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
    spec = parsed.value;
  } else if (isDir(inputPath)) {
    const caseFile = join(inputPath, "cases", "positive-complete.json");
    const parsed = isFile(caseFile) ? readJsonFile(caseFile) : { ok: false };
    if (!parsed.ok) {
      return finish({
        job,
        clock,
        mode,
        inputPath,
        ok: false,
        decision: "invalid",
        error: {
          code: "unsupported_input",
          message: "migration-checklist directory must contain cases/<id>.json or pass a case JSON file",
        },
      });
    }
    spec = parsed.value;
  } else {
    return finish({
      job,
      clock,
      mode,
      inputPath,
      ok: false,
      decision: "invalid",
      error: { code: "missing_input", message: "input path is not a file or directory" },
    });
  }

  if (clock && spec && typeof spec === "object") spec = { ...spec, clock };
  const caseRoot = spec?.input ? dirname(dirname(inputPath.endsWith(".json") ? inputPath : join(inputPath, "x"))) : root;
  const native = fn(spec, { root: job.fixtureRoot, clock });
  return finish({ job, clock, mode, inputPath, native, decision: native?.decision });
}
