import { lstatSync, readFileSync } from "node:fs";

export const MAX_JSON_BYTES = 4 * 1024 * 1024;

export function readJsonFile(path) {
  if (!path) {
    const error = new Error("path required");
    error.code = "missing_path";
    throw error;
  }
  let st;
  try {
    st = lstatSync(path);
  } catch {
    const error = new Error(`path not found: ${path}`);
    error.code = "missing_path";
    throw error;
  }
  if (st.isSymbolicLink()) {
    const error = new Error(`symlink refused: ${path}`);
    error.code = "symlink_refused";
    throw error;
  }
  if (!st.isFile()) {
    const error = new Error(`regular file required: ${path}`);
    error.code = "not_a_file";
    throw error;
  }
  if (st.size > MAX_JSON_BYTES) {
    const error = new Error(`file exceeds ${MAX_JSON_BYTES} byte budget: ${path}`);
    error.code = "oversize";
    throw error;
  }
  const text = readFileSync(path, "utf8");
  try {
    return { ok: true, path, text, body: JSON.parse(text), bytes: Buffer.byteLength(text) };
  } catch (err) {
    const error = new Error(`not JSON: ${err.message}`);
    error.code = "invalid_json";
    throw error;
  }
}

export function tryReadJsonFile(path) {
  try {
    return readJsonFile(path);
  } catch (error) {
    return {
      ok: false,
      path,
      code: error.code || "unreadable",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
