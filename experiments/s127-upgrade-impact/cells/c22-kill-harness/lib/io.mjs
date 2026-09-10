import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { assertWritableOut } from "./paths.mjs";

export const MAX_JSON_BYTES = 1024 * 1024;

export function readFileLimited(path, { maxBytes = MAX_JSON_BYTES } = {}) {
  if (!path) {
    const error = new Error("path required");
    error.code = "missing_path";
    throw error;
  }
  if (String(path).includes("\0")) {
    const error = new Error("nul byte in path");
    error.code = "nul_byte";
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
  const loaded = readFileLimited(path);
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

export function writeJsonFile(path, value, { compact = false, allowTmp = false } = {}) {
  const jail = assertWritableOut(path, { allowTmp });
  if (!jail.ok) {
    const error = new Error(jail.message);
    error.code = jail.code;
    throw error;
  }
  mkdirSync(dirname(jail.path), { recursive: true });
  const text = `${compact ? JSON.stringify(value) : JSON.stringify(value, null, 2)}\n`;
  writeFileSync(jail.path, text);
  return { ok: true, path: jail.path, bytes: Buffer.byteLength(text), zone: jail.zone };
}

export function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
