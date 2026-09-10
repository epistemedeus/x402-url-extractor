import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PUBLISHED_RESULT_FIXTURE, REPLAY_RESULT_FIXTURE, MAPPING_FIXTURE } from "../src/paths.mjs";

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function writeTempJson(name, value) {
  const dir = mkdtempSync(join(tmpdir(), "s89-basepay-composition-"));
  const path = join(dir, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

export function clonePublished() {
  return readJson(PUBLISHED_RESULT_FIXTURE);
}

export function cloneReplay() {
  return readJson(REPLAY_RESULT_FIXTURE);
}

export function cloneMapping() {
  return readJson(MAPPING_FIXTURE);
}
