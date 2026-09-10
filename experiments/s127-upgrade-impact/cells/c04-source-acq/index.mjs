export {
  AcquireError,
  CATALOG_SCHEMA,
  COVERAGE,
  DEFAULT_FIXTURE_ROOT,
  DEFAULT_MAX_BYTES,
  DEFAULT_REGISTRY,
  LABEL,
  SCHEMA,
  USER_AGENT,
  acquire,
  acquirePair,
  assertNoSymlinks,
  assertExactVersion,
  assertSafePackageName,
  catalogKey,
  encodePackageNameForRegistryPath,
  extractTarball,
  fixtureTarballFileName,
  hashUnpackedTree,
  isAllowedSourceUrl,
  listTarballMembers,
  readCatalog,
  registryTarballUrl,
  resolvePackageRoot,
  sha256Hex,
  versionDocumentUrl,
} from "../../src/acquire.mjs";

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const CELL_ROOT = dirname(fileURLToPath(import.meta.url));
export const CELL_FIXTURE_ROOT = join(CELL_ROOT, "fixtures");
