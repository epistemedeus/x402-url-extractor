import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewVettedGetQuote } from './vetted-quote-review.mjs';

const url = 'https://pay.example.com/audit?mode=synthetic';
const source = 'test-vetted-quote';
const network = 'eip155:8453';
const asset = `0x${'12'.repeat(20)}`;
const recipient = `0x${'ab'.repeat(20)}`;
const baseline = { source, url, method: 'GET', protocol: 'x402', amountAtomic: '10000', network, asset, recipient };
const offer = { scheme: 'exact', network, asset, payTo: recipient, amount: '10000', maxTimeoutSeconds: 300 };
const options = (changes = {}) => ({
  now: Date.parse('2026-11-15T08:00:00Z'),
  requestImpl: async () => ({
    status: changes.status ?? 402, finalUrl: url,
    headers: new Headers({ 'payment-required': Buffer.from(JSON.stringify({
      x402Version: 2,
      resource: { url: changes.resource ?? url, description: changes.description ?? 'Synthetic test', mimeType: 'application/json' },
      accepts: changes.offers ?? [offer],
    })).toString('base64') }),
  }),
  openapiImpl: async () => ({ paths: { '/audit': { get: { responses: { 200: {
    content: { 'application/json': { schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } } } },
  } } } } } }),
});

test('match is scoped; case and presentation do not signal drift, expiry remains unverified', async () => {
  const result = await reviewVettedGetQuote(baseline, options({ description: 'An edited description', offers: [{ ...offer, payTo: `0x${'AB'.repeat(20)}` }] }));
  assert.equal(result.decision, 'observed_terms_match');
  assert.deepEqual(result.unverified, ['expiry']);
  assert.deepEqual(Object.values(result.boundary), [false, false, false, false]);
  assert.equal(JSON.stringify(result).includes(url), false);
  assert.equal(JSON.stringify(result).includes(recipient), false);
});

for (const [field, liveField, value] of [
  ['recipient', 'payTo', `0x${'cd'.repeat(20)}`],
  ['amount', 'amount', '12000'],
  ['network', 'network', 'eip155:1'],
  ['asset', 'asset', `0x${'23'.repeat(20)}`],
]) {
  test(`surfaces only a changed ${field}`, async () => {
    const result = await reviewVettedGetQuote(baseline, options({ offers: [{ ...offer, [liveField]: value }] }));
    assert.equal(result.decision, 'review_required');
    assert.deepEqual(result.changed, [field]);
  });
}

for (const [name, changes] of [
  ['non-402', { status: 200 }],
  ['empty challenge', { offers: [] }],
  ['incomplete terms', { offers: [{ ...offer, payTo: '' }] }],
  ['different bound request', { resource: 'https://pay.example.com/audit?mode=other' }],
  ['multiple options, only one matches', { offers: [offer, { ...offer, amount: '12000' }] }],
  ['non-exact offer', { offers: [{ ...offer, scheme: 'upto' }] }],
]) {
  test(`never confirms ${name}`, async () => {
    const result = await reviewVettedGetQuote(baseline, options(changes));
    assert.equal(result.decision, 'unknown');
  });
}

test('incomplete baseline is rejected before an outbound read', async () => {
  await assert.rejects(reviewVettedGetQuote({ ...baseline, recipient: '' }, {
    requestImpl: () => assert.fail('must not make a request'),
  }), /Expected an exact x402 GET baseline/);
});
