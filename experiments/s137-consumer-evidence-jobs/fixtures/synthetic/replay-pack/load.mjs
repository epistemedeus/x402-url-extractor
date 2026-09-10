import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));

export function replayPackRoot() {
  return ROOT;
}

export function readJson(relPath) {
  return JSON.parse(readFileSync(join(ROOT, relPath), "utf8"));
}

export function loadCatalog() {
  return readJson("MANIFEST.json");
}

export function loadProvenance() {
  return readJson("PROVENANCE.json");
}

export function loadClock() {
  return readFileSync(join(ROOT, "CLOCK.txt"), "utf8").trim();
}

export function loadCase(caseId) {
  return readJson(`cases/${caseId}/case.json`);
}

export function loadOpenApi(caseId) {
  return readJson(`cases/${caseId}/openapi.json`);
}

export function loadAllCases() {
  const catalog = loadCatalog();
  return catalog.cases.map((entry) => ({
    ...entry,
    doc: loadCase(entry.id),
    openapi: loadOpenApi(entry.id),
  }));
}

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];

export function listOperations(document) {
  const operations = [];
  const paths = document?.paths && typeof document.paths === "object" ? document.paths : {};
  for (const [route, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== "object" || Array.isArray(pathItem)) continue;
    for (const method of METHODS) {
      const operation = pathItem[method];
      if (!operation || typeof operation !== "object" || Array.isArray(operation)) continue;
      operations.push({ method, route, operation });
    }
  }
  return operations;
}

function mediaExamplePayloads(media) {
  const out = [];
  if (!media || typeof media !== "object") return out;
  if (Object.prototype.hasOwnProperty.call(media, "example")) {
    out.push({ kind: "example", value: media.example, externalValue: null });
  }
  if (media.examples && typeof media.examples === "object") {
    for (const [name, ex] of Object.entries(media.examples)) {
      if (!ex || typeof ex !== "object") continue;
      out.push({
        kind: "examples",
        name,
        value: Object.prototype.hasOwnProperty.call(ex, "value") ? ex.value : undefined,
        externalValue: typeof ex.externalValue === "string" ? ex.externalValue : null,
      });
    }
  }
  return out;
}

export function collectExamples(document) {
  const found = [];
  for (const { method, route, operation } of listOperations(document)) {
    const requestContent = operation.requestBody?.content;
    if (requestContent && typeof requestContent === "object") {
      for (const [mediaType, media] of Object.entries(requestContent)) {
        for (const payload of mediaExamplePayloads(media)) {
          found.push({ location: "requestBody", method, route, mediaType, operationId: operation.operationId || null, ...payload });
        }
      }
    }
    const responses = operation.responses && typeof operation.responses === "object" ? operation.responses : {};
    for (const [status, response] of Object.entries(responses)) {
      const content = response?.content;
      if (!content || typeof content !== "object") continue;
      for (const [mediaType, media] of Object.entries(content)) {
        for (const payload of mediaExamplePayloads(media)) {
          found.push({ location: "response", status, method, route, mediaType, operationId: operation.operationId || null, ...payload });
        }
      }
    }
  }
  return found;
}

export function namedResponseExample(document, operationId, exampleName) {
  return collectExamples(document).find(
    (ex) => ex.location === "response" && ex.operationId === operationId && ex.name === exampleName,
  );
}
