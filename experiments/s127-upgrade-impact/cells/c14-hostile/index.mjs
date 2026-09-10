export { CELL_ID, PACK_ROOT, HOSTILE_FIXTURES, CASES, casePath } from "./cases.mjs";
export {
  scanHostileInputs,
  toPacketPatch,
  HOSTILE_SCAN_SCHEMA,
  MAX_MANIFEST_BYTES,
  MAX_SOURCE_BYTES,
  MAX_WALK_ENTRIES,
} from "./hostile-gate.mjs";
export { withSpawnGuard, withSpawnGuardAsync } from "./spawn-guard.mjs";
export { inspectManifestPath, inspectSymlinkTarget, isInsideRoot } from "./path-safety.mjs";
export { LIFECYCLE_SCRIPTS, listLifecycleScripts } from "./script-policy.mjs";
export { classifySourceBuffer } from "./source-kind.mjs";
export { detectLockfileDisagreement } from "./lockfile-conflict.mjs";
export { countExportTree, EXPORT_ENTRY_CAP } from "./exports-bounds.mjs";
export { packAnalyzerPresent, probePackAnalyzer } from "./pack-probe.mjs";
