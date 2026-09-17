import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function fixtureTools(name = "tools-list.json") {
  return JSON.parse(readFileSync(join(ROOT, "fixtures", name), "utf8"));
}

export function fakeServer(tools, { sessionId = null } = {}) {
  return {
    sessionId,
    async connect() {},
    async listTools() {
      return structuredClone(tools);
    },
    async close() {},
  };
}
