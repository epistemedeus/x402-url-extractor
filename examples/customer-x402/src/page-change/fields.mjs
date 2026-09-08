import { ALL_FIELDS } from "./constants.mjs";
import { isPlainObject } from "./util.mjs";

export function normalizeFields(input) {
  if (input === undefined || input === null) {
    throw new Error("fields must be an explicit non-empty unique subset of supported extraction fields");
  }
  const list = typeof input === "string"
    ? input.split(",").map((part) => part.trim()).filter(Boolean)
    : input;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error("fields must be an explicit non-empty unique subset of supported extraction fields");
  }
  const unique = [...new Set(list)];
  if (unique.length !== list.length) {
    throw new Error("fields must not contain duplicates");
  }
  for (const field of unique) {
    if (!ALL_FIELDS.includes(field)) {
      throw new Error(`unsupported field: ${field}`);
    }
  }
  return Object.freeze(unique);
}

export function pickPresent(data, fields) {
  if (!isPlainObject(data)) return { present: {}, absent: [...fields] };
  const present = Object.create(null);
  const absent = [];
  for (const field of fields) {
    if (Object.hasOwn(data, field)) present[field] = data[field];
    else absent.push(field);
  }
  return { present, absent };
}
