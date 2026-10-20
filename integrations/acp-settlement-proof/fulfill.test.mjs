import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { encodeAbiParameters, encodeEventTopics, parseAbiItem } from 'viem';
import { BASE_USDC } from '../../settlement-proof.mjs';
import { fulfillAcpSettlementProof, OFFERING_ID, PROVIDER } from './fulfill.mjs';

const requireSdk = createRequire(new URL('./validation/package.json', import.meta.url));
const { AcpAgent, AcpApiClient, JobSession, BaseAcpClient } = await import(pathToFileURL(requireSdk.resolve('@virtuals-protocol/acp-node-v2')));
const TX = `0x${'1'.repeat(64)}`;
const PAYER = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x2222222222222222222222222222222222222222';
const OTHER = '0x3333333333333333333333333333333333333333';
const ZERO = `0x${'0'.repeat(40)}`;
const requirement = { transactionHash: TX, recipient: RECIPIENT, amountAtomic: '5000', payer: PAYER };
const event = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
function transfer({ payer = PAYER, payee = RECIPIENT, amount = 5000n, token = BASE_USDC } = {}) {
  return { address: token, topics: encodeEventTopics({ abi: [event], eventName: 'Transfer', args: { from: payer, to: payee } }), data: encodeAbiParameters([{ type: 'uint256' }], [amount]) };
}
const copy = x => structuredClone(x);
function setup(t, options = {}) {
  const calls = { http: [], authSigns: 0, receipt: 0, block: 0, prepares: 0, sends: 0, writes: [] };
  const records = new Map();
  const journal = {
    async read(key) { return copy(records.get(key) ?? null); },
    async compareAndSet(key, previous, next) {
      if (options.persistFail) throw Error('disk unavailable');
      if (JSON.stringify(records.get(key) ?? null) !== JSON.stringify(previous)) return false;
      records.set(key, copy(next)); calls.writes.push(next.state); return true;
    },
  };
  const job = {
    chainId: 8453, onChainJobId: '123', clientAddress: OTHER, providerAddress: PROVIDER,
    evaluatorAddress: OTHER, description: 'Settlement Proof', budget: '5000',
    expiredAt: '2026-10-21T21:00:00.000Z', jobStatus: 'FUNDED', hookAddress: ZERO,
    deliverable: null, intents: [], ...options.job,
  };
  let reads = 0;
  const api = new AcpApiClient({ serverUrl: 'https://acp.invalid' });
  api.setContext({ providerSupportedChainIds: [8453], agentAddresses: { evm: PROVIDER }, async signMessage(chain, message) {
    assert.equal(chain, 8453); assert.match(message, /^acp-auth:\d+$/); calls.authSigns++; return 'OFFLINE_AUTH_SENTINEL';
  } });
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    calls.http.push({ url, method: init.method ?? 'GET', body: init.body });
    assert.ok(url.startsWith('https://acp.invalid/'), 'network escape');
    if (url.endsWith('/auth/agent')) return { ok: true, status: 200, json: async () => ({ data: { token: `offline.${Buffer.from(JSON.stringify({ exp: 4102444800 })).toString('base64url')}.sentinel` } }) };
    assert.match(init.headers.Authorization, /^Bearer offline\./);
    if (url.endsWith('/jobs/8453/123/deliverable')) {
      assert.equal(init.method, 'POST'); assert.equal(records.get('acp:8453:123').state, 'sent_unknown');
      job.deliverable = JSON.parse(init.body).deliverable;
      if (options.postResponseLost) throw Error('HTTP response lost after storage');
      return { ok: true, status: 200 };
    }
    assert.equal(url, 'https://acp.invalid/jobs/8453/123');
    if (++reads > 1 && options.readbackFail) throw Error('readback down');
    if (reads > 1 && options.drift) job.clientAddress = PAYER;
    return { ok: true, status: 200, json: async () => ({ data: copy(job) }) };
  });
  const signer = {
    async submit(chainId, params) { calls.prepares++; assert.equal(chainId, 8453); assert.equal(params.jobId, 123n); return { params }; },
    async submitPrepared(chainId, prepared) {
      calls.sends++; assert.equal(chainId, 8453); assert.equal(prepared.length, 1);
      assert.equal(records.get('acp:8453:123').state, 'sent_unknown');
      if (options.signerRefuse) throw Error('offline signer refuses');
      job.jobStatus = options.autoComplete ? 'COMPLETED' : 'SUBMITTED';
      if (options.responseLost) throw Error('transaction response lost');
      return 'OFFLINE_TX_SENTINEL';
    },
    isStalePrepareError: BaseAcpClient.prototype.isStalePrepareError,
  };
  const agent = new AcpAgent(new Map([['evm', signer]]), {}, api);
  const session = new JobSession(agent, [options.agentAddress ?? PROVIDER], '123', 8453, options.roles ?? ['provider'], [
    { kind: 'system', event: { type: options.event ?? 'job.funded' } },
  ]);
  const client = {
    async getTransactionReceipt({ hash }) { calls.receipt++; assert.equal(hash, TX); if (options.rpcFail) throw Error('RPC down'); return { status: options.receiptStatus ?? 'success', blockNumber: 123n, logs: options.logs ?? [transfer()] }; },
    async getBlock() { calls.block++; if (options.blockFail) throw Error('block down'); return { timestamp: 1786350903n }; },
  };
  const run = (requirements = requirement, extra = {}) => fulfillAcpSettlementProof({ session, offeringId: OFFERING_ID, requirements, journal, client, now: () => new Date('2026-10-20T21:00:00.000Z'), ...extra });
  return { run, session, job, calls, records, journal };
}

function assertNoDelivery(calls) { assert.equal(calls.prepares, 0); assert.equal(calls.sends, 0); assert.equal(calls.http.filter(c => c.url.endsWith('/deliverable')).length, 0); }

test('real reader + installed SDK HTTP/post/submit path retains exact verified bytes', async t => {
  const h = setup(t); const record = await h.run();
  assert.equal(record.state, 'received');
  const result = JSON.parse(record.artifact);
  assert.equal(result.decision, 'verified'); assert.deepEqual(result.request, requirement);
  assert.equal(result.asset.address.toLowerCase(), BASE_USDC.toLowerCase());
  assert.deepEqual(h.calls.writes, ['prepared', 'sent_unknown', 'received']);
  assert.equal(h.calls.authSigns, 1); assert.equal(h.calls.receipt, 1); assert.equal(h.calls.block, 1); assert.equal(h.calls.sends, 1);
  assert.equal(h.job.deliverable, record.artifact);
  assert.deepEqual(await h.run(), record); assert.equal(h.calls.receipt, 1); assert.equal(h.calls.sends, 1);
});

for (const [name, input] of Object.entries({ missing: {}, null: null, string: JSON.stringify(requirement), number: 5, array: [], boolean: false,
  missingRecipient: { transactionHash: TX, amountAtomic: '5000' }, malformedHash: { ...requirement, transactionHash: '0x12' },
  malformedRecipient: { ...requirement, recipient: 'bad' }, malformedPayer: { ...requirement, payer: 'bad' }, nullPayer: { ...requirement, payer: null },
  numericAmount: { ...requirement, amountAtomic: 5000 }, zero: { ...requirement, amountAtomic: '0' }, leadingZero: { ...requirement, amountAtomic: '05000' },
  amountCap: { ...requirement, amountAtomic: '1000000000000001' }, unknownNetwork: { ...requirement, network: 'ethereum' }, unknownAsset: { ...requirement, asset: OTHER },
})) test(`refuses ${name} before RPC, HTTP, signing or persistence`, async t => {
  const h = setup(t); await assert.rejects(h.run(input)); assert.equal(h.calls.http.length, 0); assert.equal(h.calls.authSigns, 0); assert.equal(h.calls.receipt, 0); assert.deepEqual(h.calls.writes, []); assertNoDelivery(h.calls);
});

for (const [name, options, decision, finding] of [
  ['payee mismatch', { logs: [transfer({ payee: OTHER })] }, 'not_verified', 'recipient_not_paid'],
  ['payer mismatch', { logs: [transfer({ payer: OTHER })] }, 'not_verified', 'payer_mismatch'],
  ['amount mismatch', { logs: [transfer({ amount: 4999n })] }, 'not_verified', 'amount_mismatch'],
  ['wrong asset', { logs: [transfer({ token: OTHER })] }, 'not_verified', 'recipient_not_paid'],
  ['failed receipt', { receiptStatus: 'reverted' }, 'not_verified', 'transaction_unsuccessful'],
  ['unavailable RPC', { rpcFail: true }, 'receipt_unavailable', 'receipt_unavailable'],
  ['missing block', { blockFail: true }, 'not_verified', 'block_unavailable'],
  ['ambiguous transfer', { logs: [transfer(), transfer()] }, 'not_verified', 'ambiguous_exact_transfer'],
]) test(`preserves useful ${name} outcome through original SDK delivery`, async t => {
  const h = setup(t, options); const record = await h.run(); const result = JSON.parse(record.artifact);
  assert.equal(record.state, 'received'); assert.equal(result.decision, decision); assert.equal(result.findings[0].code, finding); assert.equal(h.calls.sends, 1);
});

test('optional payer is absent without weakening recipient or amount', async t => {
  const h = setup(t); const { payer, ...input } = requirement; const record = await h.run(input);
  assert.equal(JSON.parse(record.artifact).request.payer, null); assert.equal(JSON.parse(record.artifact).decision, 'verified');
});
for (const [name, options] of [
  ['unfunded job', { job: { jobStatus: 'OPEN' }, event: 'job.created' }],
  ['stale funded event', { job: { jobStatus: 'OPEN' } }],
  ['wrong role', { roles: ['client'] }], ['wrong agent', { agentAddress: OTHER }],
  ['wrong provider', { job: { providerAddress: OTHER } }], ['wrong job ID', { job: { onChainJobId: '124' } }],
  ['wrong service', { job: { description: 'Payment Preflight' } }], ['changed fee', { job: { budget: '50000' } }],
  ['working funds', { job: { intents: [{ intentId: '1', actor: 'provider', isEscrow: false, isSigned: false, fromAddress: PAYER, recipientAddress: OTHER, amount: '1', tokenAddress: BASE_USDC }] } }],
]) test(`refuses ${name} before receipt execution and delivery`, async t => {
  const h = setup(t, options); await assert.rejects(h.run()); assert.equal(h.calls.receipt, 0); assertNoDelivery(h.calls);
});

test('wrong original offering refuses before HTTP', async t => { const h = setup(t); await assert.rejects(h.run(requirement, { offeringId: 'other' })); assert.equal(h.calls.http.length, 0); });
test('cannot dispatch when original journal persistence fails', async t => { const h = setup(t, { persistFail: true }); await assert.rejects(h.run(), /disk/); assertNoDelivery(h.calls); });

test('lost transaction response recovers exact original artifact without another send', async t => {
  const h = setup(t, { responseLost: true }); const record = await h.run();
  assert.equal(record.state, 'received'); assert.equal(h.calls.sends, 1);
  assert.equal((await h.run()).artifactSha256, record.artifactSha256); assert.equal(h.calls.sends, 1);
});
for (const options of [{ postResponseLost: true }, { signerRefuse: true }]) test(`HTTP storage alone remains unknown (${Object.keys(options)[0]}); retry is read-only`, async t => {
  const h = setup(t, options); const first = await h.run(); assert.equal(first.state, 'sent_unknown');
  const callsBefore = copy(h.calls); const second = await h.run();
  assert.equal(second.state, 'sent_unknown'); assert.equal(second.artifact, first.artifact);
  assert.equal(h.calls.sends, callsBefore.sends); assert.equal(h.calls.prepares, callsBefore.prepares); assert.equal(h.calls.receipt, 1);
  assert.equal(h.calls.http.filter(c => c.method === 'POST').length, callsBefore.http.filter(c => c.method === 'POST').length);
  h.job.jobStatus = 'SUBMITTED'; assert.equal((await h.run()).state, 'received'); assert.equal(h.calls.sends, callsBefore.sends);
});

test('lost readback persists unknown; later original-job read recovers', async t => {
  const h = setup(t, { readbackFail: true }); assert.equal((await h.run()).state, 'sent_unknown');
  await assert.rejects(h.run(), /readback/); assert.equal(h.calls.sends, 1); assert.equal(h.calls.receipt, 1);
});
test('same job cannot replace original request/artifact on retry', async t => {
  const h = setup(t); await h.run(); await assert.rejects(h.run({ ...requirement, amountAtomic: '5001' }), /binding changed/); assert.equal(h.calls.sends, 1); assert.equal(h.calls.receipt, 1);
  h.records.get('acp:8453:123').artifact += ' '; await assert.rejects(h.run(), /digest mismatch/); assert.equal(h.calls.sends, 1);
});
test('competing dispatches produce at most one original SDK submission', async t => {
  const h = setup(t); const outcomes = await Promise.allSettled([h.run(), h.run()]);
  assert.ok(outcomes.some(x => x.status === 'fulfilled')); assert.equal(h.calls.sends, 1);
});
test('no-evaluator auto-completion readback is carriage evidence', async t => {
  const h = setup(t, { autoComplete: true }); assert.equal((await h.run()).state, 'received'); assert.equal(h.calls.sends, 1);
});
test('readback cannot receive changed original identity', async t => {
  const h = setup(t, { drift: true }); await assert.rejects(h.run(), /binding changed/); assert.equal(h.records.get('acp:8453:123').state, 'sent_unknown'); assert.equal(h.calls.sends, 1);
});
