import { createHash } from "node:crypto";

import {
  RESULT_SCHEMA_VERSION,
  SOURCE_STATEMENT_DISCLAIMER,
  TRANSFORMER_NAME,
  TRANSFORMER_VERSION,
} from "./constants.mjs";
import { boundedList, issue } from "./issues.mjs";
import { inspectMerchantDocument } from "./merchant.mjs";
import { encodeToken, getByPointer, hasPrototypeKey, isPlainObject, joinPointers, ownKeys, parsePointer } from "./pointer.mjs";
import { compileBuyerSchema, validateJsonSchema } from "./schema.mjs";

function digest(text) {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function pointerOpts(mapping) {
  return { maxTokens: mapping.limits.maxPointerTokens };
}

function firstToken(pointer) {
  const tokens = parsePointer(pointer);
  return tokens[0] ?? null;
}

function classifyRecord(requiredMissing, optionalMissing, schemaFailures) {
  if (schemaFailures.length || requiredMissing.length) return "invalid";
  if (optionalMissing.length) return "partial";
  return "success";
}

function classifyJob({ records, merchantIssues, fatal, accounting, failureCount }) {
  if (fatal) return "failure";
  const usable = records.success.length + records.partial.length;
  if (usable === 0) return "failure";
  if (records.success.length === 0 || records.partial.length || records.invalid.length
    || accounting.requestedFieldsMissing || merchantIssues.length || failureCount
    || accounting.sourceRowsSkippedStatus || accounting.sourceRowsPartial) {
    return "partial";
  }
  return "success";
}

function resolveRows(document, mapping, failures, counts) {
  const hit = getByPointer(document, mapping.rowsPointer, pointerOpts(mapping));
  if (!hit.ok) {
    failures.push(issue({
      code: hit.code,
      message: hit.message,
      pointer: mapping.rowsPointer,
      repair: "Fix rowsPointer. Array mapping must use an index token, not a field name.",
    }));
    return [];
  }
  if (!hit.present) {
    failures.push(issue({
      code: "rows.missing",
      message: `rowsPointer ${mapping.rowsPointer || "(document)"} is missing`,
      pointer: mapping.rowsPointer || "",
      repair: "Point rowsPointer at the delivered source array or use empty pointer for a single document.",
    }));
    return [];
  }
  if (mapping.rowsPointer === "") {
    if (!isPlainObject(hit.value)) {
      failures.push(issue({
        code: "rows.ambiguous",
        message: "document row must be a JSON object",
        pointer: "",
        repair: "Use an object extract body, or set rowsPointer to an array of objects.",
      }));
      return [];
    }
    counts.sourceRows = 1;
    return [{ index: 0, pointer: "", value: hit.value }];
  }
  if (!Array.isArray(hit.value)) {
    failures.push(issue({
      code: "rows.ambiguous",
      message: `rowsPointer ${mapping.rowsPointer} did not resolve to an array`,
      pointer: mapping.rowsPointer,
      repair: "Set rowsPointer to an array. Mapping an object as many rows is ambiguous.",
    }));
    return [];
  }
  if (hit.value.length > mapping.limits.maxRows) {
    failures.push(issue({
      code: "rows.oversized",
      message: `rows exceed maxRows ${mapping.limits.maxRows}`,
      pointer: mapping.rowsPointer,
      repair: "Split the job. Do not silently drop extra source rows.",
    }));
    return [];
  }
  counts.sourceRows = hit.value.length;
  const rows = [];
  for (const [index, value] of hit.value.entries()) {
    const pointer = joinPointers(mapping.rowsPointer, `/${index}`);
    if (!isPlainObject(value)) {
      counts.sourceRowsInvalid += 1;
      failures.push(issue({
        code: "rows.invalid",
        message: `source row at ${pointer} is not an object`,
        pointer,
        repair: "Each source row must be a JSON object.",
      }));
      continue;
    }
    if (hasPrototypeKey(value)) {
      counts.sourceRowsInvalid += 1;
      failures.push(issue({
        code: "pointer.prototype",
        message: `source row at ${pointer} contains a prototype-special key`,
        pointer,
        repair: "Remove __proto__, constructor, and prototype keys.",
      }));
      continue;
    }
    rows.push({ index, pointer, value });
  }
  return rows;
}

function resolveItems(row, mapping, failures, counts) {
  if (mapping.itemPointer == null) {
    counts.itemCandidates += 1;
    return [{ index: 0, pointer: row.pointer, value: row.value }];
  }
  const absolute = joinPointers(row.pointer, mapping.itemPointer);
  const hit = getByPointer(row.value, mapping.itemPointer, pointerOpts(mapping));
  if (!hit.ok) {
    failures.push(issue({
      code: hit.code,
      message: `${hit.message} at ${absolute}`,
      pointer: absolute,
      recordId: row.value.id ?? row.pointer,
      repair: "Fix itemPointer. Do not walk an array with a field name.",
    }));
    return null;
  }
  if (!hit.present) {
    counts.sourceRowsMissingItems += 1;
    failures.push(issue({ code: 'items.missing', message: 'Selected item collection is absent, not an observed empty array', pointer: absolute }));
    if (mapping.itemWhenMissing === "fail") {
      failures.push(issue({
        code: "items.missing",
        message: `itemPointer ${absolute} is missing`,
        pointer: absolute,
        recordId: row.value.id ?? row.pointer,
        repair: "Keep the source row accounted. Do not invent JSON-LD items.",
      }));
      return null;
    }
    return [];
  }
  if (mapping.itemCardinality === "one") {
    if (Array.isArray(hit.value)) {
      failures.push(issue({
        code: "pointer.ambiguous_array",
        message: `itemPointer ${absolute} is an array but itemCardinality is one`,
        pointer: absolute,
        repair: "Set itemCardinality to array, or pick an exact index.",
      }));
      return null;
    }
    if (!isPlainObject(hit.value)) {
      failures.push(issue({
        code: "items.invalid",
        message: `item at ${absolute} is not an object`,
        pointer: absolute,
        repair: "Map object items only. Scalars need an explicit field pointer.",
      }));
      return null;
    }
    counts.itemCandidates += 1;
    return [{ index: 0, pointer: absolute, value: hit.value }];
  }
  if (!Array.isArray(hit.value)) {
    failures.push(issue({
      code: "pointer.ambiguous_array",
      message: `itemPointer ${absolute} is not an array`,
      pointer: absolute,
      repair: "Set itemCardinality to one for a single object, or point at an array.",
    }));
    return null;
  }
  if (hit.value.length > mapping.limits.maxItemsPerRow) {
    failures.push(issue({
      code: "items.oversized",
      message: `items at ${absolute} exceed maxItemsPerRow ${mapping.limits.maxItemsPerRow}`,
      pointer: absolute,
      repair: "Split the source row. Extra items are not silently dropped.",
    }));
    return null;
  }
  counts.itemCandidates += hit.value.length;
  const items = [];
  for (const [index, value] of hit.value.entries()) {
    const pointer = `${absolute}/${index}`;
    if (!isPlainObject(value)) {
      counts.itemsInvalid += 1;
      failures.push(issue({
        code: "items.invalid",
        message: `item at ${pointer} is not an object`,
        pointer,
        repair: "JSON-LD items must be objects. Malformed blocks stay invalid.",
      }));
      continue;
    }
    if (hasPrototypeKey(value)) {
      counts.itemsInvalid += 1;
      failures.push(issue({
        code: "pointer.prototype",
        message: `item at ${pointer} contains a prototype-special key`,
        pointer,
        repair: "Remove prototype-special keys from delivered JSON.",
      }));
      continue;
    }
    items.push({ index, pointer, value });
  }
  return items;
}

function mapFields({ document, row, item, mapping, failures }) {
  const fields = {};
  const provenance = {};
  const requiredMissing = [];
  const optionalMissing = [];
  const mapped = [];
  for (const field of mapping.fields) {
    const base = field.base === "document" ? { value: document, pointer: "" }
      : field.base === "row" ? { value: row.value, pointer: row.pointer }
        : { value: item.value, pointer: item.pointer };
    const absolute = joinPointers(base.pointer, field.from);
    const hit = getByPointer(base.value, field.from, pointerOpts(mapping));
    mapped.push({
      field: field.name,
      pointer: absolute,
      present: Boolean(hit.ok && hit.present),
      code: hit.code,
    });
    if (!hit.ok) {
      failures.push(issue({
        code: hit.code,
        message: `${hit.message} for field ${field.name} at ${absolute}`,
        field: field.name,
        pointer: absolute,
        recordId: item.pointer,
        repair: "Use an exact JSON Pointer with array indexes. Do not guess.",
      }));
      requiredMissing.push({ field: field.name, pointer: absolute, reason: hit.code });
      continue;
    }
    if (!hit.present) {
      const entry = { field: field.name, pointer: absolute, reason: "missing" };
      if (field.required) requiredMissing.push(entry);
      else optionalMissing.push(entry);
      if (!field.required && field.onMissing === "null") {
        fields[field.name] = null;
        provenance[field.name] = { pointer: absolute, present: false, missing: "null" };
      }
      continue;
    }
    if (hit.value === undefined) {
      const entry = { field: field.name, pointer: absolute, reason: "undefined" };
      if (field.required) requiredMissing.push(entry);
      else optionalMissing.push(entry);
      continue;
    }
    fields[field.name] = hit.value;
    provenance[field.name] = { pointer: absolute, present: true };
  }
  return { fields, provenance, requiredMissing, optionalMissing, mapped };
}

function unmappedKeys(item, mapping) {
  if (mapping.fields.some(field => field.base === 'item' && field.from === '')) return { entries: [], total: 0 };
  const ignore = new Set(mapping.unmappedIgnore);
  const used = new Set(
    mapping.fields
      .filter((field) => field.base === "item" || (mapping.itemPointer == null && field.base === "row"))
      .map((field) => firstToken(field.from))
      .filter(Boolean),
  );
  const leftover = [];
  for (const key of ownKeys(item.value)) {
    if (ignore.has(key) || used.has(key)) continue;
    leftover.push({
      key,
      pointer: joinPointers(item.pointer, `/${encodeToken(key)}`),
    });
  }
  return { entries: leftover.slice(0, mapping.limits.maxUnmappedKeys), total: leftover.length };
}

export function projectRecords({ document, mapping, schema, artifactName, inputText }) {
  const limits = mapping.limits;
  const failures = boundedList(limits.maxFailures);
  // Library callers receive the same JSON-only boundary as parsed CLI inputs.
  // Inspect descriptors before reading them; no getters or toJSON execution.
  const jsonIssue = inspectJsonData(document, limits) ?? inspectJsonData(schema, { ...limits, maxInputBytes: limits.maxSchemaBytes });
  if (jsonIssue) return fatalResult({ code: jsonIssue.code, message: jsonIssue.message, issues: [jsonIssue], mapping, artifactName, inputText });
  const { issues: schemaIssues, validate } = compileBuyerSchema(schema, limits);
  if (schemaIssues.length) {
    return fatalResult({
      code: schemaIssues[0].code,
      message: "buyer record schema is unsupported or malformed",
      issues: schemaIssues,
      mapping,
      artifactName,
      inputText,
    });
  }
  const merchantIssues = inspectMerchantDocument(document, mapping);
  if (merchantIssues.some(entry => entry.code !== 'merchant.requested_missing')) {
    return fatalResult({ code: 'merchant.invalid_delivery', message: 'Input does not match the selected merchant shape',
      issues: merchantIssues, mapping, artifactName, inputText });
  }
  const counts = { sourceRows: 0, sourceRowsInvalid: 0, sourceRowsMissingItems: 0, itemCandidates: 0, itemsInvalid: 0, sourceRowsPartial: 0 };
  const rows = resolveRows(document, mapping, failures, counts);
  if (failures.some((item) => item.code === "rows.oversized" || item.code === "rows.ambiguous" || item.code === "pointer.ambiguous_array")) {
    return fatalResult({
      code: failures[0].code,
      message: failures[0].message,
      issues: [...merchantIssues, ...failures],
      mapping,
      artifactName,
      inputText,
    });
  }

  const records = { success: [], partial: [], invalid: [] };
  const missingPaths = [];
  const unmapped = [];
  const requested = [];
  let sourceRowsIncluded = 0;
  let sourceRowsSkippedStatus = 0;
  let recordBytes = 0;

  for (const row of rows) {
    const statusHit = mapping.statusPointer
      ? getByPointer(row.value, mapping.statusPointer, pointerOpts(mapping))
      : { present: false, value: null };
    const rowStatus = statusHit.present ? statusHit.value : null;
    const included = !(mapping.includeStatuses && mapping.statusPointer)
      || mapping.includeStatuses.includes(rowStatus);
    if (mapping.requestedFields && included) {
      for (const relative of mapping.requestedFields) {
        const pointer = joinPointers(row.pointer, relative);
        const hit = getByPointer(row.value, relative, pointerOpts(mapping));
        requested.push({
          pointer,
          present: Boolean(hit.ok && hit.present),
          sourceRow: row.pointer,
          status: rowStatus,
        });
      }
    }
    if (!included) {
      sourceRowsSkippedStatus += 1;
      continue;
    }
    sourceRowsIncluded += 1;
    if (rowStatus === 'partial') counts.sourceRowsPartial += 1;
    const items = resolveItems(row, mapping, failures, counts);
    if (items == null) continue;
    for (const item of items) {
      const mapped = mapFields({ document, row, item, mapping, failures });
      const schemaFailures = boundedList(limits.maxFailures);
      validateJsonSchema(mapped.fields, schema, { path: "", limits, failures: schemaFailures, validate });
      const status = classifyRecord(mapped.requiredMissing, mapped.optionalMissing, schemaFailures);
      const recordId = `record:${item.pointer}`;
      const unmappedInfo = unmappedKeys(item, mapping);
      const record = {
        recordId,
        status,
        fields: mapped.fields,
        provenance: {
          artifact: artifactName,
          sourceRowPointer: row.pointer,
          itemPointer: item.pointer,
          fields: mapped.provenance,
        },
        missing: {
          required: mapped.requiredMissing,
          optional: mapped.optionalMissing,
        },
        unmapped: unmappedInfo.entries,
        unmappedCount: unmappedInfo.total,
        unmappedTruncated: unmappedInfo.total > unmappedInfo.entries.length,
        schemaIssues: [...schemaFailures],
        disclaimer: SOURCE_STATEMENT_DISCLAIMER,
      };
      recordBytes += Buffer.byteLength(JSON.stringify(record));
      if (recordBytes > limits.maxOutputBytes) return fatalResult({ code: 'io.oversized',
        message: 'Projected records exceed output byte ceiling', issues: [], mapping, artifactName, inputText });
      records[status].push(record);
      missingPaths.push(...mapped.mapped.filter((entry) => !entry.present).map((entry) => ({
        recordId,
        field: entry.field,
        pointer: entry.pointer,
        reason: entry.code === "pointer.missing" ? "missing" : entry.code,
      })));
      unmapped.push(...record.unmapped.map((entry) => ({ recordId, ...entry })));
    }
  }

  const requestedFieldsMissing = requested.filter((item) => !item.present).length;
  const accounting = {
    ...counts,
    sourceRowsIncluded,
    sourceRowsSkippedStatus,
    recordsSuccess: records.success.length,
    recordsPartial: records.partial.length,
    recordsInvalid: records.invalid.length,
    recordsEmitted: records.success.length + records.partial.length,
    requestedFields: mapping.requestedFields,
    requestedFieldsChecked: requested.length,
    requestedFieldsPresent: requested.filter((item) => item.present).length,
    requestedFieldsMissing,
  };
  const fatal = [...failures.codes].some((code) => String(code).startsWith("pointer.ambiguous")
    || code === "pointer.prototype" || code === 'pointer.accessor'
    || code === "pointer.append_unsupported" || code === "items.oversized");
  const status = classifyJob({ records, merchantIssues, fatal, accounting, failureCount: failures.total });
  if (fatal) { records.success = []; records.partial = []; accounting.recordsEmitted = 0; }
  const issues = [...merchantIssues, ...failures];
  const result = {
    schemaVersion: RESULT_SCHEMA_VERSION,
    transformer: TRANSFORMER_NAME,
    transformerVersion: TRANSFORMER_VERSION,
    ok: status === "success",
    status,
    kind: mapping.kind,
    artifact: artifactName,
    inputDigest: digest(inputText),
    disclaimer: SOURCE_STATEMENT_DISCLAIMER,
    networkUsed: false,
    credentialsUsed: false,
    evalUsed: false,
    llmUsed: false,
    accounting,
    records: records.success,
    partialRecords: records.partial,
    invalidRecords: records.invalid,
    missingPaths,
    unmapped,
    requestedFields: requested,
    issues: issues.slice(0, limits.maxFailures),
    issueCount: merchantIssues.length + failures.total,
    issuesTruncated: merchantIssues.length + failures.total > limits.maxFailures,
    merchantCompat: {
      enabled: mapping.merchantCompat,
      ok: merchantIssues.length === 0,
      issues: merchantIssues.slice(0, limits.maxFailures),
    },
  };
  return result;
}

function inspectJsonData(value, limits) {
  const stack = [value];
  const seen = new Set();
  let nodes = 0;
  while (stack.length) {
    const current = stack.pop();
    if (++nodes > limits.maxInputBytes) return issue({ code: 'json.oversized', message: 'JSON value exceeds bounded node budget' });
    if (current === null || typeof current === 'boolean') continue;
    if (typeof current === 'string') continue;
    if (typeof current === 'number' && Number.isFinite(current)) continue;
    if (!isPlainObject(current) && !Array.isArray(current)) return issue({ code: 'json.malformed', message: 'Only JSON data values are accepted' });
    if (seen.has(current)) return issue({ code: 'json.malformed', message: 'Repeated object references are not a parsed JSON tree' });
    seen.add(current);
    if (Array.isArray(current) && Object.keys(current).length !== current.length) return issue({ code: 'json.malformed', message: 'Sparse or extended arrays are not parsed JSON arrays' });
    for (const key of Reflect.ownKeys(current)) {
      if (Array.isArray(current) && key === 'length') continue;
      if (typeof key !== 'string') return issue({ code: 'json.malformed', message: 'Symbol properties are not JSON' });
      if (['__proto__', 'constructor', 'prototype'].includes(key)) return issue({ code: 'pointer.prototype', message: 'Prototype-special source key is unsupported' });
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return issue({ code: 'pointer.accessor', message: 'Only own JSON data properties are accepted' });
      if (!descriptor.enumerable) return issue({ code: 'json.malformed', message: 'Hidden properties are not parsed JSON' });
      stack.push(descriptor.value);
    }
  }
  if (Buffer.byteLength(JSON.stringify(value)) > limits.maxInputBytes) return issue({ code: 'json.oversized', message: 'JSON value exceeds input byte budget' });
  return null;
}

function fatalResult({ code, message, issues, mapping, artifactName, inputText }) {
  return {
    schemaVersion: RESULT_SCHEMA_VERSION,
    transformer: TRANSFORMER_NAME,
    transformerVersion: TRANSFORMER_VERSION,
    ok: false,
    status: "failure",
    kind: mapping.kind,
    artifact: artifactName,
    inputDigest: inputText ? digest(inputText) : null,
    disclaimer: SOURCE_STATEMENT_DISCLAIMER,
    networkUsed: false,
    credentialsUsed: false,
    evalUsed: false,
    llmUsed: false,
    accounting: {
      sourceRows: 0,
      sourceRowsIncluded: 0,
      sourceRowsSkippedStatus: 0,
      itemCandidates: 0,
      recordsSuccess: 0,
      recordsPartial: 0,
      recordsInvalid: 0,
      recordsEmitted: 0,
      requestedFields: mapping.requestedFields,
      requestedFieldsChecked: 0,
      requestedFieldsPresent: 0,
      requestedFieldsMissing: 0,
    },
    records: [],
    partialRecords: [],
    invalidRecords: [],
    missingPaths: [],
    unmapped: [],
    requestedFields: [],
    issues: issues.length ? issues : [issue({ code, message, repair: "Fix the mapping, schema, or input. No records were invented." })],
    merchantCompat: {
      enabled: mapping.merchantCompat,
      ok: !issues.some((item) => String(item.code).startsWith("merchant.")),
      issues: issues.filter((item) => String(item.code).startsWith("merchant.")),
    },
  };
}

export function exitCodeFor(status) {
  if (status === "success") return 0;
  if (status === "partial") return 1;
  return 2;
}
