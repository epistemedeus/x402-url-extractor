import { lstatSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { classifyFixture } from "./classify.mjs";
import { fail } from "./errors.mjs";
import { REJECTION_KINDS } from "./constants.mjs";

const EXAMPLE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES_ROOT = resolve(EXAMPLE_ROOT, "fixtures");
const MAX_FIXTURE_BYTES = 64 * 1024;

export function loadFixture(path) {
  if (typeof path !== "string" || path.length === 0) {
    fail("fixture path required", { kind: REJECTION_KINDS.INVALID_SHAPE });
  }
  if (path.startsWith("-")) {
    fail("fixture path must not be a flag", { kind: REJECTION_KINDS.FORBIDDEN_FLAG });
  }

  const resolved = resolve(path);
  const rel = relative(FIXTURES_ROOT, resolved);
  if (
    rel.length === 0
    || rel.startsWith("..")
    || rel.split(/[\\/]/).includes("..")
    || resolve(FIXTURES_ROOT, rel) !== resolved
  ) {
    fail("fixture path must stay inside this example's fixtures directory", {
      kind: REJECTION_KINDS.FORBIDDEN_URL,
    });
  }

  let stat;
  try {
    stat = lstatSync(resolved);
  } catch {
    fail(`fixture not found: ${path}`, { kind: REJECTION_KINDS.INVALID_SHAPE });
  }
  if (stat.isSymbolicLink()) {
    fail("fixture must not be a symlink", { kind: REJECTION_KINDS.FORBIDDEN_URL });
  }
  if (!stat.isFile()) {
    fail("fixture must be a regular file", { kind: REJECTION_KINDS.INVALID_SHAPE });
  }
  if (stat.size > MAX_FIXTURE_BYTES) {
    fail("fixture is too large", { kind: REJECTION_KINDS.INVALID_SHAPE });
  }

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
  const report = classifyFixture(parsed);
  return Object.freeze({ ...report, source: "fixture" });
}
