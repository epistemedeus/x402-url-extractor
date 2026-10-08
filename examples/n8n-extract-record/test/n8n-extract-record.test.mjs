import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { extractBatchJobId, extractBatchRawBody, normalizeExtractBatchInput } from "../../../extract-batch.mjs";
import { parseMapping } from "../../customer-x402/src/record/mapping.mjs";
import { projectRecords } from "../../customer-x402/src/record/project.mjs";
import { bindingId } from "../src/binding.mjs";
import { exampleRoot, recordCli } from "../src/paths.mjs";
import { runExtract } from "../src/run-extract.mjs";
import { runRetrieve } from "../src/run-retrieve.mjs";
import { readArtifact } from "../src/store.mjs";

const ALPHA = "<!doctype html><html><head><title>Alpha</title><script type=\"application/ld+json\">{\"@type\":\"Product\",\"name\":\"Alpha\",\"sku\":\"A-1\"}</script></head><body><h1>Alpha</h1></body></html>";
const BROKEN = "<!doctype html><html><head><title>Broken</title><script type=\"application/ld+json\">{not json}</script></head><body><h1>Broken</h1></body></html>";
const NAMELESS = "<!doctype html><html><head><title>Nameless</title><script type=\"application/ld+json\">{\"@type\":\"Product\",\"sku\":\"Z-9\"}</script></head></html>";

function store() {
  return mkdtempSync(join(tmpdir(), "n8n-extract-record-"));
}

function writeTask(task) {
  const dir = mkdtempSync(join(tmpdir(), "n8n-extract-task-"));
  const path = join(dir, "task.json");
  writeFileSync(path, `${JSON.stringify(task, null, 2)}\n`);
  return path;
}

function mapping(fields) {
  return {
    schemaVersion: "pilot.c29.buyer-record-projection.mapping.v1",
    kind: "extract_batch",
    artifact: "extract-batch.json",
    itemPointer: "/data/jsonLd",
    fields,
  };
}

function schema(required, properties) {
  return {
    type: "object",
    additionalProperties: false,
    required,
    properties,
  };
}

const nameSku = {
  name: { type: "string" },
  sku: { type: "string" },
};

async function extract(task, root = store()) {
  const taskPath = writeTask(task);
  const result = await runExtract({ taskPath, storeRoot: root });
  return { root, taskPath, task, result, stored: readArtifact(root, result.artifactId) };
}

test("complete handler output projects one record with provenance and does not settle", async () => {
  const task = JSON.parse(readFileSync(join(exampleRoot, "fixtures/complete-task.json"), "utf8"));
  const { result, stored } = await extract(task);
  assert.equal(result.ok, true);
  assert.equal(result.status, "success");
  assert.equal(result.settlement, "not_performed");
  assert.equal(result.paymentAttempted, false);
  assert.equal(result.feedbackSent, false);
  assert.equal(result.handlerChargedField, true);
  assert.equal(result.handlerChargedFieldIsSettlement, false);
  assert.equal(result.fetchCalls, 1);
  assert.equal(result.cliExitCode, 0);
  assert.equal(result.records, 1);
  assert.equal(result.provenance.name.pointer, "/sources/0/data/jsonLd/0/name");
  const delivery = JSON.parse(stored.files["delivery.json"]);
  const normalized = normalizeExtractBatchInput({ urls: task.urls, fields: task.fields });
  const rawBody = extractBatchRawBody(normalized);
  assert.equal(delivery.jobId, extractBatchJobId({ headers: {}, rawBody }));
  assert.equal(delivery.boundary.automaticRetries, false);
  assert.equal(delivery.charged, true);
  assert.equal(stored.manifest.paymentHeader, "absent");
  assert.equal(stored.manifest.purchaseFetches, 0);
  assert.equal(stored.manifest.merchantGrant, false);
  assert.equal(stored.manifest.storageAuthority, "caller-owned-directory");
  const inputText = stored.files["delivery.json"];
  const direct = projectRecords({
    document: JSON.parse(inputText),
    mapping: parseMapping(task.mapping),
    schema: task.schema,
    artifactName: task.mapping.artifact,
    inputText,
  });
  assert.deepEqual(JSON.parse(stored.files["records.json"]), [...direct.records, ...direct.partialRecords]);
  assert.equal(JSON.parse(stored.files["records.json"])[0].fields.name, "Alpha");
  assert.equal(JSON.parse(stored.files["records.json"])[0].fields.sku, "A-1");
  assert.doesNotMatch(JSON.stringify(stored.files), /callerResultFeedback|reportCallerResult/);
});

test("partial JSON-LD keeps the usable record and an explicit missing source", async () => {
  const task = JSON.parse(readFileSync(join(exampleRoot, "fixtures/partial-task.json"), "utf8"));
  const { result, stored } = await extract(task);
  assert.equal(result.ok, true);
  assert.equal(result.status, "partial");
  assert.equal(result.cliExitCode, 1);
  assert.equal(result.fetchCalls, 2);
  assert.equal(result.records, 1);
  const delivery = JSON.parse(stored.files["delivery.json"]);
  assert.deepEqual(delivery.sources.map((row) => row.status), ["success", "partial"]);
  assert.match(JSON.stringify(delivery.sources[1].notes), /JSON-LD|json/i);
  const records = JSON.parse(stored.files["records.json"]);
  assert.equal(records.length, 1);
  assert.equal(records[0].fields.name, "Alpha");
  assert.equal(records[0].fields.sku, "A-1");
  assert.equal(records[0].provenance.fields.name.pointer, "/sources/0/data/jsonLd/0/name");
  assert.notEqual(JSON.parse(stored.files["single-extract-task.json"]).satisfied, true);
  assert.notEqual(JSON.parse(stored.files["buyer-output.json"]).delivery, "invalid");
  assert.equal(stored.manifest.workflowRetried, false);
  assert.equal(stored.manifest.feedbackSent, false);
});

test("a missing required field stays explicit and does not invent a value", async () => {
  const task = {
    urls: ["https://nameless.example/item"],
    fields: ["title", "jsonLd"],
    mapping: mapping({ name: { from: "/name", required: true } }),
    schema: schema(["name"], { name: { type: "string" } }),
    pages: { "https://nameless.example/item": NAMELESS },
  };
  const { result, stored } = await extract(task);
  assert.equal(result.ok, false);
  assert.notEqual(result.status, "success");
  assert.equal(result.fetchCalls, 1);
  const report = JSON.parse(stored.files["report.json"]);
  assert.equal(report.records.length, 0);
  assert.ok(report.missingPaths.some((entry) => entry.field === "name"));
  assert.doesNotMatch(stored.files["records.json"], /Nameless|Z-9|invented/);
});

test("source failure and duplicate URLs stay explicit without a workflow retry", async () => {
  const failed = await extract({
    urls: ["https://missing.example/gone"],
    fields: ["title", "jsonLd"],
    mapping: mapping({ name: { from: "/name", required: true } }),
    schema: schema(["name"], { name: { type: "string" } }),
    pages: {},
  });
  const failureDelivery = JSON.parse(failed.stored.files["delivery.json"]);
  assert.equal(failureDelivery.sources[0].status, "failure");
  assert.equal(failureDelivery.sources[0].httpStatus, 404);
  assert.equal(failed.result.fetchCalls, 1);
  assert.equal(failureDelivery.accounting.retries, 0);
  assert.equal(failed.stored.manifest.workflowRetried, false);
  assert.equal(failed.result.feedbackSent, false);

  const duplicate = await extract({
    urls: ["https://alpha.example/product", "https://alpha.example/product"],
    fields: ["title", "jsonLd"],
    mapping: mapping({
      name: { from: "/name", required: true },
      sku: { from: "/sku", required: true },
    }),
    schema: schema(["name", "sku"], nameSku),
    pages: { "https://alpha.example/product": ALPHA },
  });
  const duplicateDelivery = JSON.parse(duplicate.stored.files["delivery.json"]);
  assert.deepEqual(duplicateDelivery.sources.map((row) => row.status), ["success", "skipped_duplicate"]);
  assert.equal(duplicateDelivery.accounting.skippedDuplicate, 1);
  assert.equal(duplicate.result.fetchCalls, 1);
  assert.equal(JSON.parse(duplicate.stored.files["records.json"])[0].fields.name, "Alpha");
});

test("fields_unknown refuses before the harness fetch and can be retrieved", async () => {
  const task = JSON.parse(readFileSync(join(exampleRoot, "fixtures/fields-unknown-task.json"), "utf8"));
  const { root, taskPath, result, stored } = await extract(task);
  assert.equal(result.ok, false);
  assert.equal(result.status, "refused");
  assert.equal(result.fetchCalls, 0);
  assert.equal(JSON.parse(stored.files["delivery.json"]).code, "fields_unknown");
  assert.equal(JSON.parse(stored.files["delivery.json"]).charged, false);
  assert.equal(stored.files["records.json"], undefined);
  const again = await runExtract({ taskPath, storeRoot: root });
  assert.equal(again.reused, true);
  assert.equal(again.refetched, false);
  assert.equal(again.fetchCalls, 0);
  const retrieved = runRetrieve({ storeRoot: root, artifactId: result.artifactId, task });
  assert.equal(retrieved.refetched, false);
  assert.equal(retrieved.records, null);
  assert.equal(retrieved.delivery.code, "fields_unknown");
});

test("too many URLs are refused before fetch", async () => {
  const urls = [1, 2, 3, 4, 5, 6].map((index) => `https://alpha.example/${index}`);
  const { result, stored } = await extract({
    urls,
    fields: ["title"],
    mapping: mapping({ name: { from: "/name", required: true } }),
    schema: schema(["name"], { name: { type: "string" } }),
    pages: {},
  });
  assert.equal(result.status, "refused");
  assert.equal(JSON.parse(stored.files["delivery.json"]).code, "urls_invalid");
  assert.equal(result.fetchCalls, 0);
});

test("a later process retrieves the same artifact and a changed task is refused", async () => {
  const task = JSON.parse(readFileSync(join(exampleRoot, "fixtures/partial-task.json"), "utf8"));
  const root = store();
  const taskPath = writeTask(task);
  const first = spawnSync(process.execPath, [join(exampleRoot, "bin/extract.mjs"), "--task", taskPath, "--store", root], {
    encoding: "utf8",
  });
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const created = JSON.parse(first.stdout);
  const deliveryPath = join(root, created.artifactId, "delivery.json");
  const stamped = statSync(deliveryPath).mtimeMs;
  const second = spawnSync(process.execPath, [join(exampleRoot, "bin/retrieve.mjs"), "--task", taskPath, "--store", root, "--artifact", created.artifactId], {
    encoding: "utf8",
  });
  assert.equal(second.status, 0, second.stderr || second.stdout);
  const retrieved = JSON.parse(second.stdout);
  assert.equal(retrieved.refetched, false);
  assert.equal(retrieved.paymentAttempted, false);
  assert.equal(retrieved.records[0].fields.name, "Alpha");
  assert.equal(retrieved.records[0].provenance.fields.name.pointer, "/sources/0/data/jsonLd/0/name");
  assert.equal(statSync(deliveryPath).mtimeMs, stamped);
  const changed = { ...task, fields: ["title"] };
  const mismatch = runRetrieve({ storeRoot: root, artifactId: created.artifactId, task: changed });
  assert.equal(mismatch.reason, "input_binding_mismatch");
  assert.equal(mismatch.records, null);
  assert.equal(mismatch.refetched, false);
  assert.notEqual(bindingId(changed), created.artifactId);
});

test("foreign ids, path traversal, and a lost artifact do not return records", async () => {
  const task = JSON.parse(readFileSync(join(exampleRoot, "fixtures/complete-task.json"), "utf8"));
  const { root, result } = await extract(task);
  const foreign = runRetrieve({
    storeRoot: root,
    artifactId: "ab".repeat(32),
    task,
  });
  assert.equal(foreign.status, "missing");
  assert.equal(foreign.records, null);
  for (const artifactId of ["../etc/passwd", "..", "/etc/passwd", `../${result.artifactId}`, `${result.artifactId}/../../etc/passwd`]) {
    const escaped = runRetrieve({ storeRoot: root, artifactId, task });
    assert.equal(escaped.reason, "artifact.foreign", artifactId);
    assert.equal(escaped.records, null);
    assert.equal(escaped.refetched, false);
  }
  const lost = runRetrieve({
    storeRoot: root,
    artifactId: "cd".repeat(32),
    task,
  });
  assert.equal(lost.reason, "artifact_not_found");
  assert.equal(lost.records, null);
});

test("the same input is not extracted again", async () => {
  const task = JSON.parse(readFileSync(join(exampleRoot, "fixtures/complete-task.json"), "utf8"));
  const root = store();
  const taskPath = writeTask(task);
  const first = await runExtract({ taskPath, storeRoot: root });
  const delivery = readFileSync(join(root, first.artifactId, "delivery.json"), "utf8");
  const second = await runExtract({ taskPath, storeRoot: root });
  assert.equal(second.reused, true);
  assert.equal(second.refetched, false);
  assert.equal(readFileSync(join(root, first.artifactId, "delivery.json"), "utf8"), delivery);
  assert.equal(second.artifactId, first.artifactId);
});

test("workflow files call the built-in command node and do not carry a signer", () => {
  for (const name of ["extract-record.workflow.json", "retrieve-record.workflow.json"]) {
    const workflow = JSON.parse(readFileSync(join(exampleRoot, "workflows", name), "utf8"));
    assert.match(workflow.id, /^[0-9A-Za-z]{16}$/);
    assert.equal(workflow.nodes[0].type, "n8n-nodes-base.manualTrigger");
    assert.equal(workflow.nodes[1].type, "n8n-nodes-base.executeCommand");
    assert.match(workflow.nodes[1].parameters.command, /\$N8N_EXTRACT_HOME\/bin\/(extract|retrieve)\.mjs/);
    assert.equal(workflow.active, false);
    const serialized = JSON.stringify(workflow);
    assert.doesNotMatch(serialized, /privateKey|BEGIN PRIVATE|x402Bazaar|n8n-nodes-base\.httpRequest/);
  }
  for (const relative of ["src/run-extract.mjs", "src/run-retrieve.mjs", "src/harness.mjs", "bin/extract.mjs", "bin/retrieve.mjs"]) {
    const source = readFileSync(join(exampleRoot, relative), "utf8");
    assert.doesNotMatch(source, /reportCallerResult|bindCallerResultFeedback|useful-result-reuse/);
  }
  assert.equal(recordCli.endsWith("examples/customer-x402/bin/record.mjs"), true);
});

test("malformed JSON-LD note is the handler note, not a synthetic delivery", async () => {
  const { stored } = await extract({
    urls: ["https://beta.example/broken"],
    fields: ["title", "jsonLd"],
    mapping: mapping({ name: { from: "/name", required: true } }),
    schema: schema(["name"], { name: { type: "string" } }),
    pages: { "https://beta.example/broken": BROKEN },
  });
  const delivery = JSON.parse(stored.files["delivery.json"]);
  assert.equal(delivery.product, "samedaydesk-extract-batch");
  assert.equal(delivery.sources[0].status, "partial");
  assert.equal(delivery.sources[0].data.jsonLd.length, 0);
  assert.ok(delivery.sources[0].notes.length > 0);
  assert.equal(delivery.sources[0].data.title, "Broken");
});
