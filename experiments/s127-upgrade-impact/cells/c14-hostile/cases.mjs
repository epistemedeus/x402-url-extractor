import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CELL_ROOT = dirname(fileURLToPath(import.meta.url));
export const PACK_ROOT = join(CELL_ROOT, "..", "..");
export const HOSTILE_FIXTURES = join(PACK_ROOT, "fixtures", "hostile");
export const CELL_ID = "c14-hostile";

export const CASES = Object.freeze([
  {
    id: "path-traversal",
    dir: "path-traversal",
    expect: {
      decision: "invalid",
      nextAction: "unknown",
      findingKinds: ["path_traversal"],
      scriptsExecuted: false,
    },
  },
  {
    id: "install-scripts",
    dir: "install-scripts",
    expect: {
      decision: "unknown",
      nextAction: "unknown",
      findingKinds: ["lifecycle_scripts_present"],
      scriptsExecuted: false,
      markerRelative: "SCRIPT_RAN.marker",
    },
  },
  {
    id: "enormous-exports",
    dir: "enormous-exports",
    expect: {
      decision: "unknown",
      nextAction: "unknown",
      findingKinds: ["exports_map_oversize"],
      scriptsExecuted: false,
      maxReads: 20,
    },
  },
  {
    id: "symlink-bomb",
    dir: "symlink-bomb",
    expect: {
      decision: "invalid",
      nextAction: "unknown",
      findingKinds: ["symlink_escape"],
      scriptsExecuted: false,
    },
  },
  {
    id: "conflicting-lockfile",
    dir: "conflicting-lockfile",
    expect: {
      decision: "unknown",
      nextAction: "unknown",
      findingKinds: ["lockfile_disagreement"],
      scriptsExecuted: false,
    },
  },
  {
    id: "binary-source",
    dir: "binary-source",
    expect: {
      decision: "unknown",
      nextAction: "unknown",
      findingKinds: ["binary_source"],
      scriptsExecuted: false,
    },
  },
]);

export function casePath(id) {
  const row = CASES.find((c) => c.id === id);
  if (!row) throw new Error(`unknown hostile case ${id}`);
  return join(HOSTILE_FIXTURES, row.dir);
}
