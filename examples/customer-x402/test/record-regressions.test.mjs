import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseMapping } from '../src/record/mapping.mjs';
import { projectRecords } from '../src/record/project.mjs';
import { writeProjectionOutputs } from '../src/record/cli.mjs';

const base = { schemaVersion: 'pilot.c29.buyer-record-projection.mapping.v1', kind: 'json',
  rowsPointer: '/rows', fields: { name: { from: '/name', base: 'row', required: true } } };
const schema = { type: 'object', required: ['name'], properties: { name: { type: ['string', 'null'] } } };
function run(document, overrides = {}, buyerSchema = schema) {
  const mapping = parseMapping({ ...base, ...overrides });
  return projectRecords({ document, mapping, schema: buyerSchema, artifactName: 'input.json', inputText: JSON.stringify(document) });
}

test('malformed rows remain in cardinality and prevent all-valid result', () => {
  const result = run({ rows: [{ name: 'valid' }, null, 5] });
  assert.equal(result.status, 'partial');
  assert.equal(result.accounting.sourceRows, 3);
  assert.equal(result.accounting.sourceRowsInvalid, 2);
});
test('malformed item entries remain counted rather than vanishing', () => {
  const result = run({ rows: [{ items: [{ name: 'valid' }, null] }] }, {
    itemPointer: '/items', fields: { name: { from: '/name', required: true } },
  });
  assert.equal(result.status, 'partial');
  assert.equal(result.accounting.itemCandidates, 2);
  assert.equal(result.accounting.itemsInvalid, 1);
});
test('missing item array beside valid row is incomplete even with empty policy', () => {
  const result = run({ rows: [{ items: [{ name: 'valid' }] }, {}] }, {
    itemPointer: '/items', fields: { name: { from: '/name', required: true } },
  });
  assert.equal(result.status, 'partial');
  assert.equal(result.accounting.sourceRowsMissingItems, 1);
});
test('root JSON Pointer provenance is empty string, not slash', () => {
  const result = run({ name: 'valid' }, { rowsPointer: '' });
  assert.equal(result.records[0].provenance.sourceRowPointer, '');
  assert.equal(result.records[0].provenance.itemPointer, '');
});
test('required means present, null obeys the buyer schema without coercion', () => {
  assert.equal(run({ rows: [{ name: null }] }).records[0].fields.name, null);
  assert.equal(run({ rows: [{}] }).invalidRecords.length, 1);
  assert.equal(run({ rows: [{ name: null }] }, {}, { ...schema, properties: { name: { type: 'string' } } }).invalidRecords.length, 1);
});
test('failure cap cannot hide fatal ambiguity after earlier malformed input', () => {
  const result = run({ rows: [null, { name: ['bad'] }, { name: { first: 'valid' } }] }, {
    limits: { maxFailures: 1 }, fields: { name: { from: '/name/first', base: 'row', required: true } },
  });
  assert.equal(result.status, 'failure');
  assert.equal(result.records.length + result.partialRecords.length, 0);
});
test('explicit supported schema dialect is accepted; different dialect is rejected', () => {
  assert.equal(run({ rows: [{ name: 'valid' }] }, {}, { ...schema, $schema: 'https://json-schema.org/draft/2020-12/schema' }).status, 'success');
  assert.equal(run({ rows: [{ name: 'valid' }] }, {}, { ...schema, $schema: 'https://example.com/private-dialect' }).status, 'failure');
});
test('JSON Schema pointer escapes dots, slash and tilde correctly', () => {
  const result = run({ rows: [{ name: { 'a.b/~': 2 } }] }, {}, {
    type: 'object', properties: { name: { type: 'object', properties: { 'a.b/~': { type: 'string' } } } },
  });
  assert.equal(result.invalidRecords[0].schemaIssues[0].pointer, '/name/a.b~1~0');
});
test('output byte ceiling rejects before writing any report or records', () => {
  const mapping = parseMapping({ ...base, limits: { maxOutputBytes: 100 } });
  const result = run({ rows: [{ name: 'x'.repeat(2000) }] });
  const dir = mkdtempSync(join(tmpdir(), 'record-review-output-'));
  try {
    assert.throws(() => writeProjectionOutputs(dir, result, mapping), /output|above/i);
    assert.deepEqual(readdirSync(dir), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('own source fields only: accessor is never called', () => {
  let calls = 0;
  const row = {};
  Object.defineProperty(row, 'name', { enumerable: true, get() { calls++; return 'wrong'; } });
  const mapping = parseMapping(base);
  const result = projectRecords({ document: { rows: [row] }, mapping, schema, artifactName: 'input.json', inputText: '{}' });
  assert.equal(calls, 0);
  assert.equal(result.status, 'failure');
});
test('duplicate seller row labels do not collide record identity', () => {
  const result = run({ rows: [{ id: 'same', name: 'A' }, { id: 'same', name: 'B' }] });
  assert.equal(new Set(result.records.map(record => record.recordId)).size, 2);
});
test('unknown schema keyword, references and mutation annotations are never ignored', () => {
  for (const extra of [{ madeUp: true }, { $ref: '#/local' }, { default: 'created' }, { format: 'email' }, { pattern: '.*' }]) {
    assert.equal(run({ rows: [{ name: 'A' }] }, {}, { ...schema, ...extra }).status, 'failure');
  }
});
test('AJV validates standard composition and boolean child schemas without coercion', () => {
  const standard = { type: 'object', properties: { name: { anyOf: [{ type: 'string', const: 'A' }, { type: 'null' }] } }, required: ['name'], additionalProperties: false };
  assert.equal(run({ rows: [{ name: 'A' }] }, {}, standard).status, 'success');
  assert.equal(run({ rows: [{ name: 1 }] }, {}, standard).invalidRecords.length, 1);
  assert.equal(run({ rows: [{ name: 'A' }] }, {}, { type: 'object', properties: { name: false } }).invalidRecords.length, 1);
});
test('unmapped key display truncation is explicit and does not lose the count', () => {
  const result = run({ rows: [{ name: 'A', extra1: 1, extra2: 2 }] }, { limits: { maxUnmappedKeys: 1 } });
  assert.equal(result.records[0].unmapped.length, 1);
  assert.equal(result.records[0].unmappedCount, 2);
  assert.equal(result.records[0].unmappedTruncated, true);
});
test('hidden toJSON methods cannot run during the JSON-only preflight', () => {
  let calls = 0;
  const document = { rows: [{ name: 'A' }] };
  Object.defineProperty(document, 'toJSON', { value() { calls++; return {}; } });
  const result = projectRecords({ document, mapping: parseMapping(base), schema, artifactName: 'input.json', inputText: '{}' });
  assert.equal(calls, 0);
  assert.equal(result.status, 'failure');
});
test('large unused delivered text does not block a small valid buyer record', () => {
  assert.equal(run({ rows: [{ name: 'A', unusedText: 'x'.repeat(9000) }] }).status, 'success');
  assert.equal(run({ rows: [{ name: 'x'.repeat(9000) }] }).invalidRecords[0].schemaIssues[0].code, 'json.string_oversized');
});
