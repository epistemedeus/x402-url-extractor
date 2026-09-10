/**
 * Thin npm packument reader constants.
 * JSON metadata only. No tarball extract. No npm install. No lifecycle.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export const CELL_ID = "c28-packument-thin";
export const CELL_ROOT = HERE;
export const DEFAULT_FIXTURE_ROOT = join(HERE, "fixtures");

export const SCHEMA = "s127.upgrade-impact.packument.v1";
export const CATALOG_SCHEMA = "s127.upgrade-impact.packument-catalog.v1";

export const USER_AGENT =
  "s127-upgrade-impact-packument-thin/0.1 (json-only; no npm install; no lifecycle; no tarball extract)";

export const DEFAULT_REGISTRY = "https://registry.npmjs.org";
export const DEFAULT_MAX_JSON_BYTES = 2 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 15_000;
export const MAX_URL_LENGTH = 4_096;

/** Thin registry document (abbreviated packument). Fallback to JSON. */
export const PACKUMENT_ACCEPT =
  "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8";

export const LABEL = Object.freeze({
  FIXTURE: "fixture",
  LIVE_CAPTURE: "live-capture",
  SYNTHETIC: "synthetic",
});

export const COVERAGE = Object.freeze({
  FULL_PACKUMENT: "full packument",
  SLIM_PACKUMENT: "slim packument",
  VERSION_DOCUMENT: "version document",
  PARTIAL_PAGE: "partial page",
  MISSING: "missing",
});

export const KIND = Object.freeze({
  PACKUMENT: "packument",
  VERSION_DOCUMENT: "version-document",
  UNKNOWN: "unknown",
});

export const MODE = Object.freeze({
  FIXTURE: "fixture",
  LIVE: "live",
});

/**
 * npm lifecycle script names. Recorded from packument metadata; never executed.
 * `dependencies` is the legacy npm lifecycle hook, not package dependencies.
 */
export const LIFECYCLE_SCRIPTS = Object.freeze([
  "preinstall",
  "install",
  "postinstall",
  "preuninstall",
  "uninstall",
  "postuninstall",
  "prepublish",
  "prepare",
  "preprepare",
  "postprepare",
  "prepack",
  "postpack",
  "prepublishOnly",
  "postpublish",
  "dependencies",
]);

export const INSTALL_SCRIPTS = Object.freeze(["preinstall", "install", "postinstall"]);

export const LABEL_VALUES = new Set(Object.values(LABEL));
export const COVERAGE_VALUES = new Set(Object.values(COVERAGE));

export const DEFAULT_LIMITATIONS = Object.freeze([
  "A newer version on the packument (including dist-tags.latest) is not itself a break.",
  "Unused export change is not a caller defect; this reader does not bind usage.",
  "Missing, conflicting, or partial packument metadata stays unknown, not action.",
  "dist-tags are capture-time hints and are not the observation version.",
  "This reader does not extract tarballs, run npm install, or execute lifecycle scripts.",
  "TypeScript types and dynamic imports are unknown (out of scope for packument JSON).",
  "Slim extracts and abbreviated packuments are partial coverage of the registry document.",
]);
