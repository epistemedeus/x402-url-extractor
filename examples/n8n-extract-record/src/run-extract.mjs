import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ExtractBatchInputError,
  executeExtractBatch,
  extractBatchInputRefusalPayload,
  extractBatchRawBody,
  normalizeExtractBatchInput,
} from "../../../extract-batch.mjs";
import {
  assertRequestMatchesAuthorization,
  normalizeAuthorization,
} from "../../customer-x402/src/authorization.mjs";
import { validateBatchBuyerOutput } from "../../customer-x402/src/batch-output.mjs";
import {
  DEFAULT_BATCH_REQUIRED_OUTPUT,
  LIVE_ASSET,
  LIVE_BATCH_AMOUNT_ATOMIC,
  LIVE_EXTRACT_BATCH_URL,
  LIVE_NETWORK,
  LIVE_RECIPIENT,
} from "../../customer-x402/src/constants.mjs";
import { decideExtractTask } from "../../customer-x402/src/extract-task.mjs";
import { HARD_CAPS } from "../../customer-x402/src/record/constants.mjs";
import { readJsonFile } from "../../customer-x402/src/record/io.mjs";
import { parseMapping } from "../../customer-x402/src/record/mapping.mjs";
import { inspectJsonSchema } from "../../customer-x402/src/record/schema.mjs";
import { runAuthorizedPurchase } from "../../customer-x402/src/purchase.mjs";
import { boundedFetch } from "../../customer-x402/src/transport.mjs";
import { bindingId } from "./binding.mjs";
import { createHarness } from "./harness.mjs";
import { recordCli } from "./paths.mjs";
import { publishArtifact, readArtifact, scratchDirectory } from "./store.mjs";

const merchantUrl = new URL("../../../extract-batch.mjs", import.meta.url).href;

function text(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function authorizationInput(normalized) {
  return {
    method: "POST",
    url: LIVE_EXTRACT_BATCH_URL,
    network: LIVE_NETWORK,
    asset: LIVE_ASSET,
    recipient: LIVE_RECIPIENT,
    amountCapAtomic: LIVE_BATCH_AMOUNT_ATOMIC,
    assetName: "USD Coin",
    assetVersion: "2",
    maxTimeoutSeconds: 300,
    body: {
      urls: [...normalized.urls],
      fields: [...normalized.fields],
    },
    requiredOutput: normalized.requiredOutput || DEFAULT_BATCH_REQUIRED_OUTPUT,
  };
}

async function refusePurchase(authInput) {
  let fetches = 0;
  const result = await runAuthorizedPurchase({
    authorization: authInput,
    approve: false,
    fetchImpl: async () => {
      fetches += 1;
      throw new Error("purchase_fetch");
    },
  });
  if (result?.outcome !== "authorization_refused" || result.paymentSent !== false
    || result.walletAccessed !== false || result.paymentSigned !== false || fetches !== 0) {
    throw new Error(`purchase gate did not refuse before payment: ${result?.outcome || "missing"}`);
  }
  return {
    purchaseAttempted: false,
    fetches,
    refusal: result.message,
    walletAccessed: false,
    paymentSent: false,
  };
}

async function boundHandlerJson(delivery, maxBytes) {
  let networkCalls = 0;
  const payload = text(delivery);
  const bounded = await boundedFetch(async () => {
    networkCalls += 1;
    return new Response(payload, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }, LIVE_EXTRACT_BATCH_URL, { method: "POST" }, maxBytes, 15_000);
  if (networkCalls !== 1) throw new Error("bounded fetch was retried");
  const body = await bounded.text();
  return { body, networkCalls, bytes: Buffer.byteLength(body) };
}

function projectWithCli(delivery, mapping, schema) {
  const dir = mkdtempSync(join(tmpdir(), "n8n-record-cli-"));
  const inputPath = join(dir, "delivery.json");
  const mappingPath = join(dir, "mapping.json");
  const schemaPath = join(dir, "schema.json");
  const outDir = join(dir, "out");
  writeFileSync(inputPath, text(delivery));
  writeFileSync(mappingPath, text(mapping));
  writeFileSync(schemaPath, text(schema));
  const child = spawnSync(process.execPath, [
    recordCli,
    "--input", inputPath,
    "--mapping", mappingPath,
    "--schema", schemaPath,
    "--out", outDir,
  ], { encoding: "utf8" });
  const stdout = child.stdout || "";
  let parsed = null;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    parsed = null;
  }
  const readOut = (name) => {
    try {
      return readFileSync(join(outDir, name), "utf8");
    } catch {
      return null;
    }
  };
  return {
    exitCode: child.status,
    stdout,
    stderr: child.stderr || "",
    parsed,
    records: readOut("records.json"),
    report: readOut("report.json"),
    missingPaths: readOut("missing-paths.json"),
  };
}

function baseManifest(artifactId, task, extra) {
  return {
    schemaVersion: "samedaydesk.n8n-extract-record.artifact.v1",
    artifactId,
    inputBinding: artifactId,
    storageAuthority: "caller-owned-directory",
    merchantGrant: false,
    usefulResultReuseGrant: false,
    settlement: "not_performed",
    paymentAttempted: false,
    feedbackSent: false,
    feedbackRetried: false,
    workflowRetried: false,
    handler: "executeExtractBatch",
    harness: "injected-fetchImpl",
    merchantModule: merchantUrl,
    taskUrls: task.urls,
    taskFields: task.fields,
    ...extra,
  };
}

function summary(published, extra = {}) {
  const manifest = published.manifest;
  return {
    ok: manifest.disposition === "artifact" && (manifest.status === "success" || manifest.status === "partial"),
    disposition: manifest.disposition,
    status: manifest.status,
    artifactId: manifest.artifactId,
    inputBinding: manifest.inputBinding,
    reused: published.reused === true,
    refetched: false,
    storageAuthority: manifest.storageAuthority,
    merchantGrant: false,
    settlement: "not_performed",
    paymentAttempted: false,
    feedbackSent: false,
    handlerChargedField: manifest.handlerChargedField ?? null,
    handlerChargedFieldIsSettlement: false,
    fetchCalls: manifest.fetchCalls ?? 0,
    recordStatus: manifest.recordStatus ?? null,
    cliExitCode: manifest.cliExitCode ?? null,
    buyerDelivery: manifest.buyerDelivery ?? null,
    singleExtractTaskReason: manifest.singleExtractTaskReason ?? null,
    records: manifest.recordCounts?.records ?? 0,
    partialRecords: manifest.recordCounts?.partialRecords ?? 0,
    invalidRecords: manifest.recordCounts?.invalidRecords ?? 0,
    missingPaths: manifest.recordCounts?.missingPaths ?? 0,
    provenance: manifest.provenanceSample ?? null,
    exitCode: 0,
    ...extra,
  };
}

function publishRefusal(storeRoot, artifactId, task, manifestExtra, files) {
  const manifest = baseManifest(artifactId, task, {
    disposition: "explicit-negative",
    complete: false,
    ...manifestExtra,
  });
  const published = publishArtifact(storeRoot, artifactId, {
    "manifest.json": manifest,
    "task-binding.json": {
      urls: task.urls,
      fields: task.fields,
      mapping: task.mapping,
      schema: task.schema,
    },
    ...files,
  });
  return summary(published);
}

export async function runExtract({ taskPath, storeRoot } = {}) {
  const taskFile = readJsonFile(taskPath, HARD_CAPS.maxInputBytes, "task");
  const task = taskFile.value;
  if (task == null || typeof task !== "object" || Array.isArray(task)) {
    return { ok: false, status: "usage", exitCode: 2, error: "task must be a JSON object" };
  }
  const artifactId = bindingId(task);
  const existing = safeRead(storeRoot, artifactId);
  if (existing?.manifest?.complete === true && existing.manifest.inputBinding === artifactId) {
    return summary({ ...existing, reused: true }, { refetched: false, fetchCalls: existing.manifest.fetchCalls ?? 0 });
  }

  let normalized;
  try {
    normalized = normalizeExtractBatchInput({ urls: task.urls, fields: task.fields });
  } catch (error) {
    if (!(error instanceof ExtractBatchInputError)) throw error;
    const payload = extractBatchInputRefusalPayload(error.reason);
    return publishRefusal(storeRoot, artifactId, task, {
      status: "refused",
      reason: error.reason,
      fetchCalls: 0,
      handlerInvoked: false,
      handlerChargedField: payload.charged,
    }, {
      "delivery.json": payload,
      "refusal.json": {
        code: error.reason,
        message: error.message,
        guidance: error.guidance,
        fetchCalls: 0,
        paymentAttempted: false,
        feedbackSent: false,
        workflowRetried: false,
      },
    });
  }

  const merchantRaw = extractBatchRawBody(normalized).toString("utf8");
  const authInput = authorizationInput({
    ...normalized,
    requiredOutput: task.requiredOutput,
  });
  const authorization = normalizeAuthorization(authInput);
  assertRequestMatchesAuthorization(authorization.url, authorization, {
    method: "POST",
    body: authorization.bodyRaw,
  });
  if (authorization.bodyRaw !== merchantRaw) {
    return publishRefusal(storeRoot, artifactId, task, {
      status: "refused",
      reason: "body_binding_mismatch",
      fetchCalls: 0,
      handlerInvoked: false,
    }, {
      "refusal.json": {
        code: "body_binding_mismatch",
        message: "Merchant canonical body and customer authorization body differ. The handler was not called.",
        fetchCalls: 0,
        paymentAttempted: false,
        feedbackSent: false,
        workflowRetried: false,
      },
    });
  }
  const purchase = await refusePurchase(authInput);
  const harness = createHarness(task.pages || {});
  const dataDir = scratchDirectory();
  let delivery;
  try {
    delivery = await executeExtractBatch({
      input: normalized,
      rawBody: Buffer.from(merchantRaw),
      headers: {},
      dataDir,
      fetchImpl: harness.fetchImpl,
    });
  } catch (error) {
    return publishRefusal(storeRoot, artifactId, task, {
      status: "handler_error",
      reason: "handler_error",
      fetchCalls: harness.calls.length,
      handlerInvoked: true,
      handlerCalls: harness.calls,
    }, {
      "refusal.json": {
        code: "handler_error",
        message: error.message,
        fetchCalls: harness.calls.length,
        paymentAttempted: false,
        feedbackSent: false,
        workflowRetried: false,
      },
    });
  }

  const bounded = await boundHandlerJson(delivery, authorization.requiredOutput.maxResponseBytes);
  const buyer = validateBatchBuyerOutput(JSON.parse(bounded.body), authorization);
  const singleTask = decideExtractTask(delivery);
  let mappingError = null;
  let schemaIssues = [];
  try {
    parseMapping(task.mapping);
  } catch (error) {
    mappingError = { code: error.code || "mapping.malformed", message: error.message };
  }
  try {
    schemaIssues = inspectJsonSchema(task.schema, HARD_CAPS);
  } catch (error) {
    schemaIssues = [{ code: error.code || "schema.malformed", message: error.message }];
  }

  const common = {
    fetchCalls: harness.calls.length,
    handlerInvoked: true,
    handlerCalls: harness.calls,
    handlerChargedField: delivery.charged,
    handlerChargedFieldIsSettlement: false,
    jobId: delivery.jobId,
    paymentHeader: "absent",
    purchaseRefusal: purchase.refusal,
    purchaseFetches: purchase.fetches,
    buyerDelivery: buyer.delivery,
    buyerValid: buyer.valid,
    singleExtractTaskReason: singleTask.reason,
    singleExtractTaskSatisfied: singleTask.satisfied,
    merchantAccountingRetries: delivery.accounting?.retries ?? null,
    workflowRetried: false,
  };

  if (mappingError || schemaIssues.length) {
    return publishRefusal(storeRoot, artifactId, task, {
      status: "projection_refused",
      reason: mappingError?.code || schemaIssues[0]?.code || "projection_refused",
      ...common,
    }, {
      "delivery.json": delivery,
      "buyer-output.json": buyer,
      "single-extract-task.json": singleTask,
      "refusal.json": {
        mappingError,
        schemaIssues,
        fetchCalls: harness.calls.length,
        paymentAttempted: false,
        feedbackSent: false,
        workflowRetried: false,
      },
    });
  }

  const projected = projectWithCli(delivery, task.mapping, task.schema);
  const report = projected.parsed;
  const counts = report && typeof report === "object" ? {
    records: Array.isArray(report.records) ? report.records.length : 0,
    partialRecords: Array.isArray(report.partialRecords) ? report.partialRecords.length : 0,
    invalidRecords: Array.isArray(report.invalidRecords) ? report.invalidRecords.length : 0,
    missingPaths: Array.isArray(report.missingPaths) ? report.missingPaths.length : 0,
  } : { records: 0, partialRecords: 0, invalidRecords: 0, missingPaths: 0 };
  const sample = report?.records?.[0]?.provenance?.fields || report?.partialRecords?.[0]?.provenance?.fields || null;
  const files = {
    "delivery.json": delivery,
    "buyer-output.json": buyer,
    "single-extract-task.json": singleTask,
    "cli-stdout.json": projected.stdout,
  };
  if (projected.records) files["records.json"] = projected.records;
  if (projected.report) files["report.json"] = projected.report;
  if (projected.missingPaths) files["missing-paths.json"] = projected.missingPaths;
  if (!projected.records) {
    files["refusal.json"] = {
      code: "record_cli_failed",
      message: "The record CLI did not write records.json",
      cliExitCode: projected.exitCode,
      stderr: projected.stderr,
      fetchCalls: harness.calls.length,
      paymentAttempted: false,
      feedbackSent: false,
      workflowRetried: false,
    };
  }
  const manifest = baseManifest(artifactId, task, {
    disposition: projected.records ? "artifact" : "explicit-negative",
    status: report?.status || "failure",
    recordStatus: report?.status || null,
    cliExitCode: projected.exitCode,
    recordCounts: counts,
    provenanceSample: sample,
    ...common,
  });
  const published = publishArtifact(storeRoot, artifactId, {
    "manifest.json": manifest,
    "task-binding.json": {
      urls: task.urls,
      fields: task.fields,
      mapping: task.mapping,
      schema: task.schema,
    },
    ...files,
  });
  return summary(published);
}

function safeRead(storeRoot, artifactId) {
  try {
    return readArtifact(storeRoot, artifactId);
  } catch (error) {
    if (error.code === "artifact.foreign" || error.code === "artifact.escape") throw error;
    return null;
  }
}
