import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
export const EXAMPLE_ROOT = dirname(SRC_DIR);
export const DEFAULT_CATALOG_PATH = join(EXAMPLE_ROOT, "fixtures", "well-known-x402.json");
export const HOSTILE_FIXTURE_DIR = join(EXAMPLE_ROOT, "fixtures", "hostile");

export const HOSTILE_FIXTURES = Object.freeze({
  malformed: join(HOSTILE_FIXTURE_DIR, "malformed.json"),
  missingItems: join(HOSTILE_FIXTURE_DIR, "missing-items.json"),
  privateUrl: join(HOSTILE_FIXTURE_DIR, "private-url.json"),
  mcpResource: join(HOSTILE_FIXTURE_DIR, "mcp-resource.json"),
  credentialsUrl: join(HOSTILE_FIXTURE_DIR, "credentials-url.json"),
  wrongVersion: join(HOSTILE_FIXTURE_DIR, "wrong-version.json"),
  paidBody: join(HOSTILE_FIXTURE_DIR, "paid-body.json"),
  challengeAsCatalog: join(HOSTILE_FIXTURE_DIR, "challenge-as-catalog.json"),
  httpResource: join(HOSTILE_FIXTURE_DIR, "http-resource.json"),
});
