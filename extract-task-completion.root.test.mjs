import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTextExcerptLimit } from './extract-capture.mjs';
import { EXTRACT_BATCH_MAX_RESPONSE_BYTES } from './extract-batch-config.mjs';
import {
  maxAdmittedBatchExcerptChars,
  normalizeExtractBatchInput,
} from './extract-batch.mjs';
import { decideExtractTask } from './examples/customer-x402/src/extract-task.mjs';

const record = overrides => ({
  ok: true,
  status: 200,
  sourceOk: true,
  error: null,
  title: 'Fixture',
  text: 'x'.repeat(2000),
  capture: {
    textExcerptLimitChars: 2000,
    textTruncated: true,
    bodyTruncated: false,
  },
  ...overrides,
});

test('only omitted excerpt limits select the default; malformed explicit values refuse', () => {
  assert.equal(parseTextExcerptLimit(undefined).value, 1200);
  for (const value of [null, '', [], [2000], { toString: () => '2000' }, true]) {
    assert.equal(parseTextExcerptLimit(value).ok, false, String(value));
  }
  assert.equal(parseTextExcerptLimit(2000).ok, true);
  assert.equal(parseTextExcerptLimit('2000').ok, true);
});

test('batch budgets reserve the promised room after worst-case JSON escaping', () => {
  for (let count = 1; count <= 5; count++) {
    const chars = maxAdmittedBatchExcerptChars(count);
    const actualTextBytes = count * (Buffer.byteLength(JSON.stringify(String.fromCharCode(1).repeat(chars))) - 2);
    assert.ok(actualTextBytes <= EXTRACT_BATCH_MAX_RESPONSE_BYTES - 48 * 1024,
      `${count} URLs admit ${actualTextBytes} text bytes instead of the reserved bound`);
    assert.throws(() => normalizeExtractBatchInput({
      urls: Array.from({ length: count }, (_, index) => `https://example.com/${index}`),
      textExcerptLimitChars: chars + 1,
    }), /textExcerptLimitChars/);
  }
});

test('an explicit bounded excerpt predicate can be met while later source text is cropped', () => {
  const bounded = decideExtractTask(record(), { kind: 'excerpt', requiredChars: 1500 });
  assert.equal(bounded.satisfied, true);
  assert.equal(bounded.delivery, 'excerpt_sufficient');
  assert.equal(bounded.nextAction.purchaseAuthorized, false);
  assert.equal(bounded.nextAction.executed, false);
  const more = decideExtractTask(record(), { kind: 'excerpt', requiredChars: 2500 });
  assert.equal(more.satisfied, false);
  const unspecified = decideExtractTask(record(), { kind: 'excerpt' });
  assert.equal(unspecified.satisfied, false);
  assert.equal(decideExtractTask(record(), null).satisfied, null);
});

test('source status contradictions do not become useful metadata', () => {
  const refusal = decideExtractTask(record({ status: 403 }), { kind: 'metadata' });
  assert.equal(refusal.satisfied, false);
  assert.equal(refusal.delivery, 'source_refused');
  assert.equal(refusal.nextAction.purchaseAuthorized, false);
});
