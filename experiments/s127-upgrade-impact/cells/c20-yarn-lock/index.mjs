/**
 * Cell c20 — classic yarn.lock resolver.
 *
 * Public surface for the integrator. Copy/adapt into src/lockfile.mjs;
 * do not import this cell from a default-branch merge path.
 */

export {
  SCHEMA as PARSE_SCHEMA,
  MAX_LOCKFILE_BYTES,
  MAX_LOCKFILE_LINES,
  MAX_ENTRIES,
  FORMATS,
  detectYarnLockFormat,
  tokenizeClassic,
  parseYarnLock,
  stripBom,
} from "./parse.mjs";

export {
  SCHEMA as RESOLVE_SCHEMA,
  DIRECT_DEP_FIELDS,
  LOCATOR_PROTOCOLS,
  splitNameRange,
  parseRange,
  parseDescriptor,
  packageNameFromResolved,
  collectManifestPins,
  resolveYarnPackage,
} from "./resolve.mjs";

export {
  SCHEMA as OVERLAY_SCHEMA,
  PACKET_SCHEMA,
  EVIDENCE_LABELS,
  sha256Hex,
  readLockfileText,
  analyzeLockfile,
  resolveLockfile,
  resolveDependency,
  run,
} from "./overlay.mjs";

export { CELL_ID, isolationSelfCheck } from "./isolation.mjs";
