import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const MAX_JSON_BYTES = 4 * 1024 * 1024;
export const MAX_PROVENANCE_BYTES = 32 * 1024 * 1024;

export function readFileLimited(path, { maxBytes = MAX_PROVENANCE_BYTES } = {}) {
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
  if (st.size > maxBytes) {
    const error = new Error(`file exceeds ${maxBytes} byte budget: ${path}`);
    error.code = "oversize";
    throw error;
  }
  const buffer = readFileSync(path);
  return { ok: true, path, buffer, bytes: st.size, text: buffer.toString("utf8") };
}

export function readJsonFile(path) {
  const loaded = readFileLimited(path, { maxBytes: MAX_JSON_BYTES });
  try {
    return { ...loaded, body: JSON.parse(loaded.text) };
  } catch (err) {
    const error = new Error(`not JSON: ${err instanceof Error ? err.message : String(err)}`);
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

export function tryReadFile(path, options) {
  try {
    return readFileLimited(path, options);
  } catch (error) {
    return {
      ok: false,
      path,
      code: error.code || "unreadable",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Accept a regular file or directory (no symlink). Used for --fixture-old/--fixture-new roots. */
export function tryStatPath(path) {
  if (!path) {
    return { ok: false, path, code: "missing_path", message: "path required" };
  }
  let st;
  try {
    st = lstatSync(path);
  } catch {
    return { ok: false, path, code: "missing_path", message: `path not found: ${path}` };
  }
  if (st.isSymbolicLink()) {
    return { ok: false, path, code: "symlink_refused", message: `symlink refused: ${path}` };
  }
  if (st.isFile()) {
    return { ok: true, path, kind: "file", bytes: st.size };
  }
  if (st.isDirectory()) {
    return { ok: true, path, kind: "directory", bytes: st.size };
  }
  return {
    ok: false,
    path,
    code: "unsupported_path_kind",
    message: `file or directory required: ${path}`,
  };
}

export function writeJsonFile(path, value, { compact = false } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  const text = `${compact ? JSON.stringify(value) : JSON.stringify(value, null, 2)}\n`;
  writeFileSync(path, text);
  return { ok: true, path, bytes: Buffer.byteLength(text) };
}
