import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';
import { issue } from './issues.mjs';
import { getByPointer, isPlainObject, joinPointers } from './pointer.mjs';

// Generated unchanged from the public merchant's extractBatchOutputSchema()
// at d7ceb857. This is shape compatibility, not settlement or fact verification.
const batchSchema = JSON.parse(readFileSync(new URL('./merchant-batch-schema.json', import.meta.url)));
const validateBatch = new Ajv2020({ strict: false, allErrors: false, ownProperties: true,
  coerceTypes: false, useDefaults: false, removeAdditional: false }).compile(batchSchema);

export function inspectMerchantDocument(document, mapping) {
  const issues = [];
  if (!mapping.merchantCompat) return issues;
  if (!isPlainObject(document)) return [issue({ code: 'merchant.malformed', message: 'Expected a delivered JSON object' })];
  if (mapping.kind === 'extract_batch' && !validateBatch(document)) {
    const error = validateBatch.errors[0];
    issues.push(issue({ code: 'merchant.schema', message: error.message, pointer: error.instancePath }));
  }
  if (mapping.kind === 'extract') {
    // These are only the source shape requirements used by this recipe.
    if (document.ok !== true || typeof document.url !== 'string' || !Array.isArray(document.jsonLd)) {
      issues.push(issue({ code: 'merchant.extract_shape', message: 'Expected successful extract with url and jsonLd array' }));
    }
  }
  const rows = mapping.kind === 'extract_batch' && Array.isArray(document.sources)
    ? document.sources.map((row, i) => [row, `/sources/${i}`]) : [[document, '']];
  for (const [row, base] of rows) {
    if (!isPlainObject(row)) continue;
    if (mapping.kind === 'extract_batch' && !['success', 'partial'].includes(row.status)) continue;
    for (const relative of mapping.requestedFields ?? []) {
      const hit = getByPointer(row, relative, { maxTokens: mapping.limits.maxPointerTokens });
      if (!hit.ok || !hit.present) issues.push(issue({ code: 'merchant.requested_missing',
        message: 'Requested selected field was not delivered', pointer: joinPointers(base, relative) }));
    }
  }
  return issues;
}
