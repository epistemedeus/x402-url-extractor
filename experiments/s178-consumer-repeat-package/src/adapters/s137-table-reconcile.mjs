import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { finish, isFile, readJsonFile } from "./common.mjs";

export const ARTIFACT_ID = "table-reconcile";
export const TRANSFORM_EXPORT = "reconcileTables";
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
      error: {
        code: "unsupported_input",
        message: "table-reconcile requires a case JSON or schema-valid input JSON",
      },
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
  const loadUrl = pathToFileURL(join(job.fixtureRoot, "load-case.mjs")).href;
  const { loadCase, toSchemaInput } = await import(loadUrl);
  const transformMod = await import(
    pathToFileURL(join(job.moduleRoot, "src/table-reconcile/transform.mjs")).href
  );
  const schemaMod = await import(
    pathToFileURL(join(job.moduleRoot, "src/table-reconcile/schema.mjs")).href
  );
  const fn = transformMod.reconcileTables || transformMod.transform;
  if (typeof fn !== "function") {
    return finish({
      job,
      clock,
      mode,
      inputPath,
      ok: false,
      decision: "unsupported",
      error: { code: "missing_transform", message: "reconcileTables export missing" },
    });
  }

  let input = parsed.value;
  if (input?.schema === "s137.table-reconcile.case.v1" || (input?.tables && input?.join && !input.tables[0]?.rows)) {
    const id = input.id || basename(inputPath, ".json");
    const loaded = loadCase(id);
    input = toSchemaInput(loaded.spec, loaded.tables);
  }
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
  const native = fn(input);
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
