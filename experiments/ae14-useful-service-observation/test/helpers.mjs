import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { issueCallerResultFeedbackToken } from "../../../caller-result-feedback.mjs";
import { bindMerchantHttpDeliveryContracts } from "../../../http-delivery-evidence/bind-merchant-contracts.mjs";
import { RESOURCES } from "../../../http-delivery-evidence/contract.mjs";
import { digestResponseBytes } from "../../../http-delivery-evidence/digest.mjs";
import { PAID_EVIDENCE_FILENAME } from "../../../http-delivery-evidence/historical.mjs";
import { VALIDATION_FILENAME, recordFromObservedResponse } from "../../../http-delivery-evidence/store.mjs";
import { historicalV1Row, validExtractBody } from "../../../http-delivery-evidence/test/helpers.mjs";
import { createUsefulServiceObservation } from "../src/extend-handback.mjs";

bindMerchantHttpDeliveryContracts();

export const NOW = 1_700_000_000_000;

let sequence = 0;

export function secret() {
  return randomBytes(32).toString("hex");
}

export async function tempDir() {
  return mkdtemp(path.join(tmpdir(), "ae14-uso-"));
}

export async function removeDir(dir) {
  await rm(dir, { recursive: true, force: true });
}

export function observedPair(overrides = {}) {
  sequence += 1;
  const id = overrides.id || `11111111-1111-4111-8111-${String(sequence).padStart(12, "0")}`;
  const requestDigest = overrides.requestDigest || randomBytes(32).toString("hex");
  const settlement = overrides.settlement || `0x${randomBytes(32).toString("hex")}`;
  const bytes = Buffer.from(JSON.stringify(validExtractBody({ title: overrides.title || "Example Domain" })));
  const validation = recordFromObservedResponse({
    method: "GET",
    resource: RESOURCES.EXTRACT,
    responseBytes: bytes,
    merchantHttpStatus: 200,
    settlementClass: "simulated",
    settlementReference: settlement,
    paidEvidenceId: id,
    requestDigest,
  });
  const paid = historicalV1Row({
    id,
    method: "GET",
    route: RESOURCES.EXTRACT,
    requestDigest,
    responseDigest: validation.responseDigest,
    settlementReference: settlement,
  });
  return { paid, validation, bytes, digest: digestResponseBytes(bytes) };
}

export async function writeCaptures(dir, pairs) {
  await writeFile(
    path.join(dir, PAID_EVIDENCE_FILENAME),
    `${pairs.map((pair) => JSON.stringify(pair.paid)).join("\n")}\n`,
  );
  await writeFile(
    path.join(dir, VALIDATION_FILENAME),
    `${pairs.map((pair) => JSON.stringify(pair.validation)).join("\n")}\n`,
  );
}

export function tokenFor(pair, key, now = NOW) {
  return issueCallerResultFeedbackToken({
    key,
    eventId: pair.paid.id,
    method: pair.paid.method,
    route: pair.paid.route,
    requestDigest: pair.paid.requestDigest,
    responseDigest: pair.paid.responseDigest,
    now,
  });
}

export function observationFor(dir, key, overrides = {}) {
  return createUsefulServiceObservation({
    dataDir: dir,
    key,
    tenant: "serving",
    now: () => NOW,
    ...overrides,
  });
}

export async function submit(observation, token, body, extra = {}) {
  const rawBody = Buffer.from(JSON.stringify(body));
  return observation.submitExtension({ token, body, rawBody, ...extra });
}

export async function readText(file) {
  return readFile(file, "utf8");
}
