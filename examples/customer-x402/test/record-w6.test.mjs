import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parseMapping } from '../src/record/mapping.mjs';
import { projectRecords } from '../src/record/project.mjs';
import { getByPointer } from '../src/record/pointer.mjs';

const root = new URL('../fixtures/record/w6-corpus/', import.meta.url);
const read = path => JSON.parse(readFileSync(new URL(path, root)));
test('W6 single-field oracle replay preserves 18 mapped, 2 missing, 3 invalid and rejects 3 ambiguous mappings', () => {
  const manifest = read('manifest.json');
  const seen = { mapped: 0, unmapped: 0, invalid: 0, ambiguous: 0 };
  for (const id of manifest.cases) {
    const spec = read(`cases/${id}/case.json`);
    const delivery = read(`cases/${id}/delivery.json`);
    for (const field of spec.mappings) {
      const rule = spec.buyerSchema.fields[field.outputPointer];
      const declaration = { schemaVersion: 'pilot.c29.buyer-record-projection.mapping.v1', kind: 'json',
        statusPointer: '/status', includeStatuses: ['success', 'partial'],
        fields: { value: { from: field.sourcePointers.length === 1 ? field.sourcePointers[0] : field.sourcePointers,
          base: 'row', required: rule.required } } };
      if (field.sourcePointers.length > 1) {
        assert.equal(field.expected, 'ambiguous');
        assert.throws(() => parseMapping(declaration), /Pointer string/);
        seen.ambiguous++;
        continue; // No first-entity choice is silently invented by this bridge.
      }
      const result = projectRecords({ document: delivery, mapping: parseMapping(declaration),
        schema: { type: 'object', properties: { value: { type: rule.type } }, required: rule.required ? ['value'] : [] },
        artifactName: 'w6.json', inputText: JSON.stringify(delivery) });
      const record = [...result.records, ...result.partialRecords, ...result.invalidRecords][0];
      if (field.expected === 'mapped') {
        assert.ok(record && record.status !== 'invalid', `${id}/${field.id}`);
        assert.deepEqual(record.fields.value, getByPointer(spec.desiredRecord, field.outputPointer).value);
        assert.equal(record.provenance.fields.value.pointer, field.sourcePointers[0]);
      } else if (field.expected === 'unmapped') {
        assert.equal(Object.hasOwn(record.fields, 'value'), false);
        assert.ok(result.missingPaths.some(x => x.pointer === field.sourcePointers[0]));
      } else if (delivery.status === 'failure') {
        assert.equal(result.accounting.recordsEmitted, 0);
        assert.equal(result.status, 'failure');
      } else {
        assert.equal(record.status, 'invalid');
        assert.equal(record.schemaIssues[0].code, 'json.type');
      }
      seen[field.expected]++;
    }
  }
  assert.deepEqual(seen, { mapped: 18, unmapped: 2, invalid: 3, ambiguous: 3 });
});
