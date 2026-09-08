import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  C1_COMMIT,
  C1_IDENTITY_MODULE,
  C2_COMMIT,
  C2_MERGE,
  C2_PULL_REQUEST,
  MERCHANT_COMMIT,
  MERCHANT_FILES,
} from "./constants.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const VENDOR_C2 = join(HERE, "vendor", "change-digest");
const MERCHANT_ROOT = join(HERE, "..", "..", "..", "..");

let cachedC2 = null;

export function merchantRoot() {
  return MERCHANT_ROOT;
}

export function vendorC2Root() {
  return VENDOR_C2;
}

export async function importC2() {
  if (cachedC2) return cachedC2;
  cachedC2 = await import(pathToFileURL(join(VENDOR_C2, "index.mjs")).href);
  return cachedC2;
}

export async function importC2Snapshot() {
  return import(pathToFileURL(join(VENDOR_C2, "snapshot.mjs")).href);
}

export async function importC2JsonDiff() {
  return import(pathToFileURL(join(VENDOR_C2, "json-diff.mjs")).href);
}

export async function importC1UrlGuard() {
  return import(pathToFileURL(join(MERCHANT_ROOT, C1_IDENTITY_MODULE)).href);
}

export function c2Provenance() {
  return {
    commit: C2_COMMIT,
    merge: C2_MERGE,
    pullRequest: C2_PULL_REQUEST,
    source: "examples/customer-x402/src/page-change/vendor/change-digest",
    license: "MIT",
    acceptance: "reviewed_source_vendored",
  };
}

export function c1Provenance() {
  return {
    commit: C1_COMMIT,
    module: C1_IDENTITY_MODULE,
    license: "MIT",
    acceptance: "in_repo_public_identity_helper",
  };
}

export function merchantProvenance() {
  return {
    commit: MERCHANT_COMMIT,
    files: [...MERCHANT_FILES],
    acceptance: "in_repo_public_batch_schema",
  };
}
