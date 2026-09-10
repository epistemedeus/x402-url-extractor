import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const provenance = JSON.parse(readFileSync(join(dir, "PROVENANCE.json"), "utf8"));
const operationBytes = readFileSync(join(dir, "github-rest-get-a-repository.operation.json"));
const curlBytes = readFileSync(join(dir, "github-rest-get-a-repository.html-curl.txt"));
const headerBytes = readFileSync(join(dir, "github-rest-get-a-repository.headers.txt"));
const operation = JSON.parse(operationBytes.toString("utf8"));
const curlText = curlBytes.toString("utf8");
const headers = headerBytes.toString("latin1");

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

test("PROVENANCE has required retrieval fields", () => {
  assert.equal(provenance.retrievedAt, "2026-09-10T11:23:06Z");
  assert.equal(
    provenance.url,
    "https://docs.github.com/en/rest/repos/repos?apiVersion=2022-11-28",
  );
  assert.equal(typeof provenance.sha256, "string");
  assert.equal(provenance.sha256.length, 64);
  assert.equal(provenance.license.spdx, "CC-BY-4.0");
  assert.ok(provenance.license.note.includes("Creative Commons"));
  assert.equal(provenance.evidenceClass, "fixture");
  assert.equal(provenance.offline, true);
  assert.equal(provenance.payment.attempted, false);
  assert.equal(provenance.cost.assignmentSpendUsd, 0);
  assert.equal(provenance.onlinePrerequisites.executed, false);
  assert.equal(provenance.onlinePrerequisites.liveProviderCall, false);
  assert.equal(provenance.claims.inventsFacts, false);
  assert.equal(provenance.claims.paidEndpoint, false);
  assert.equal(provenance.claims.legalAttestation, false);
  assert.equal(provenance.claims.modelAsOracle, false);
});

test("snapshot sha256 and byte length match PROVENANCE", () => {
  assert.equal(operationBytes.length, provenance.bytes);
  assert.equal(sha256(operationBytes), provenance.sha256);
  assert.equal(sha256(operationBytes), "611afa11d38f21d1cc63e70de18e9ee080917f8f1c91cf9c1790006f42cdb2b7");
  assert.equal(curlBytes.length, provenance.htmlCurlBytes);
  assert.equal(sha256(curlBytes), provenance.htmlCurlSha256);
  assert.equal(headerBytes.length, provenance.headersBytes);
  assert.equal(sha256(headerBytes), provenance.headersSha256);
});

test("stored headers match retrieval metadata", () => {
  assert.match(headers, /^HTTP\/2 200 /);
  assert.match(headers, /content-type: text\/html; charset=utf-8/i);
  assert.match(headers, /content-length: 1416675/i);
  assert.match(headers, /date: Thu, 10 Sep 2026 11:23:06 GMT/i);
  assert.match(headers, /x-github-request-id: A390:4E8E3:2D5049:3705DB:6AA292FA/i);
});

test("citations list covers hashes and every observedCase", () => {
  const byId = Object.fromEntries(provenance.citations.map((c) => [c.id, c]));
  assert.equal(byId["src-operation"].sha256, provenance.sha256);
  assert.equal(byId["src-operation"].url, provenance.htmlUrl);
  assert.equal(byId["src-html-curl"].sha256, provenance.htmlCurlSha256);
  assert.equal(byId["src-headers"].sha256, provenance.headersSha256);
  assert.equal(byId["src-docs-license"].sha256, provenance.license.licenseSha256);
  assert.equal(provenance.observedCases.length, 4);
  for (const finding of provenance.observedCases) {
    assert.ok(finding.citationIds.length > 0);
    for (const id of finding.citationIds) {
      assert.ok(byId[id], `missing citation ${id}`);
    }
  }
  const kinds = new Set(provenance.observedCases.map((c) => c.kind));
  assert.deepEqual([...kinds].sort(), ["conflicting", "negative", "partial", "positive"]);
});

test("positive: official 200 Get a repository example is present", () => {
  assert.equal(operation.title, "Get a repository");
  assert.equal(operation.verb, "get");
  assert.equal(operation.requestPath, "/repos/{owner}/{repo}");
  assert.equal(operation.serverUrl, "https://api.github.com");
  assert.equal(operation.codeExamples.length, 1);
  const example = operation.codeExamples[0];
  assert.equal(example.response.statusCode, "200");
  assert.equal(example.response.contentType, "application/json");
  assert.equal(example.response.example.full_name, "octocat/Hello-World");
  assert.equal(example.response.example.id, 1296269);
  assert.equal(operation.progAccess.allowsPublicRead, true);
  assert.equal(provenance.captureMethod.includes("Live https://api.github.com/repos/OWNER/REPO was not requested"), true);
});

test("negative: 301/403/404 are documented without example bodies", () => {
  const codes = operation.statusCodes.map((s) => s.httpStatusCode);
  assert.deepEqual(codes, ["200", "301", "403", "404"]);
  const byCode = Object.fromEntries(operation.statusCodes.map((s) => [s.httpStatusCode, s]));
  assert.match(byCode["404"].description, /Resource not found/);
  assert.match(byCode["403"].description, /Forbidden/);
  assert.match(byCode["301"].description, /Moved permanently/);
  const exampleStatuses = operation.codeExamples.map((ex) => ex.response.statusCode);
  assert.deepEqual(exampleStatuses, ["200"]);
  assert.equal(operation.codeExamples.some((ex) => ["301", "403", "404"].includes(ex.response.statusCode)), false);
});

test("partial: schema requires language; example omits it", () => {
  const schema = operation.codeExamples[0].response.schema;
  const example = operation.codeExamples[0].response.example;
  assert.ok(schema.required.includes("language"));
  assert.deepEqual(schema.properties.language.type, ["string", "null"]);
  assert.equal(Object.hasOwn(example, "language"), false);
  assert.ok(operation.descriptionHTML.includes("security_and_analysis"));
  assert.equal(Object.hasOwn(example, "security_and_analysis"), false);
  assert.deepEqual(operation.codeExamples[0].request.parameters, { owner: "OWNER", repo: "REPO" });
  assert.notEqual(example.full_name, "OWNER/REPO");
});

test("conflicting: accept header, API version, and fork vs parent/source", () => {
  assert.match(provenance.url, /apiVersion=2022-11-28/);
  assert.match(curlText, /X-GitHub-Api-Version: 2026-03-10/);
  assert.match(curlText, /Accept: application\/vnd\.github\+json/);
  assert.match(curlText, /Authorization: Bearer <YOUR-TOKEN>/);
  assert.match(curlText, /https:\/\/api\.github\.com\/repos\/OWNER\/REPO/);
  const acceptHeader = operation.codeExamples[0].request.acceptHeader;
  assert.equal(acceptHeader, "application/vnd.github.v3+json");
  assert.notEqual(acceptHeader, "application/vnd.github+json");
  const example = operation.codeExamples[0].response.example;
  assert.equal(example.fork, false);
  assert.equal(example.parent.full_name, "octocat/Hello-World");
  assert.equal(example.source.full_name, "octocat/Hello-World");
  assert.match(operation.descriptionHTML, /parent<\/code> and <code>source<\/code> objects are present when the repository is a fork/);
});

test("replay pack does not claim live provider execution or spend", () => {
  assert.equal(provenance.offline, true);
  assert.equal(provenance.onlinePrerequisites.executed, false);
  assert.equal(provenance.cost.assignmentSpendUsd, 0);
  assert.equal(operation.url, undefined);
  assert.equal(headers.includes("api.github.com/repos/octocat"), false);
  assert.match(curlText, /<YOUR-TOKEN>/);
});
