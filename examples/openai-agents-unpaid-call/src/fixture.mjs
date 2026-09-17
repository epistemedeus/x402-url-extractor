import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { classifyFixture } from "./classify.mjs";
import { fail } from "./errors.mjs";
import { REJECTION_KINDS } from "./constants.mjs";

export function loadFixture(path) {
  const resolved = resolve(path);
  let text;
  try {
    text = readFileSync(resolved, "utf8");
  } catch {
    fail(`fixture not found: ${path}`, { kind: REJECTION_KINDS.INVALID_SHAPE });
  }
  if (text.charCodeAt(0) === 0xfeff) {
    fail("fixture must not have a BOM", { kind: REJECTION_KINDS.INVALID_SHAPE });
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail("fixture is not valid JSON", { kind: REJECTION_KINDS.INVALID_SHAPE });
  }
  return classifyFixture(parsed);
}
