// Synthetic data and sentinels only; never reads a real account or network.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { encodeAbiParameters, encodeEventTopics, parseAbiItem } from 'viem';
import { withDirectoryLock } from '../../experiments/scoped-surface-delivery-100312/src/lock.mjs';
import { BASE_USDC } from '../../settlement-proof.mjs';
import { OFFERING_ID, PROVIDER } from './fulfill.mjs';
import { createNativeBoundary, AGENT_ID } from './native-boundary.mjs';
import { createOperatingReceiver } from './operating.mjs';
import { openDeliveryJournal } from './journal.mjs';
import { runNativeProcess } from './native-process.mjs';

export const CLIENT = `0x${'3'.repeat(40)}`;
export const REQUEST = { transactionHash: `0x${'1'.repeat(64)}`, recipient: `0x${'2'.repeat(40)}`, amountAtomic: '8000000' };
export const NOW = '2026-10-21T00:00:00.000Z';
export const TOKEN = `offline.${Buffer.from(JSON.stringify({ exp: 4102444800 })).toString('base64url')}.sentinel`;
export function initialState() {
  const creation = { type: 'job.created', jobId: '123', client: CLIENT, provider: PROVIDER, evaluator: CLIENT, expiredAt: '1792620000', hook: `0x${'0'.repeat(40)}` };
  return { options: {}, calls: { quotes: 0, submits: 0, auth: 0, receipt: 0, block: 0, commands: [] },
    active: [{ chainId: 8453, onChainJobId: '123' }],
    job: { chainId: 8453, onChainJobId: '123', clientAddress: CLIENT, providerAddress: PROVIDER, evaluatorAddress: CLIENT, description: 'Settlement Proof', budget: '0', expiredAt: new Date(1792620000 * 1000).toISOString(), jobStatus: 'OPEN', hookAddress: creation.hook, intents: [], deliverable: null },
    entries: [{ kind: 'system', chainId: 8453, onChainJobId: '123', timestamp: 1792540800000, event: creation }, { kind: 'message', chainId: 8453, onChainJobId: '123', from: CLIENT, timestamp: 1792540800001, contentType: 'requirement', content: JSON.stringify(REQUEST) }],
    catalog: { id: AGENT_ID, walletAddress: PROVIDER, offerings: [{ id: OFFERING_ID, name: 'Settlement Proof', priceType: 'fixed', priceValue: 0.005, slaMinutes: 1440, requiredFunds: false, subscriptions: [] }] },
  };
}
export function initialize(root) {
  for (const name of ['profile', 'empty', 'operations', 'server']) fs.mkdirSync(path.join(root, name), { mode: 0o700 });
  fs.writeFileSync(path.join(root, 'profile/config.json'), JSON.stringify({ activeWallet: PROVIDER, ownerWallet: CLIENT, agents: { [PROVIDER]: { id: AGENT_ID, publicKey: 'OFFLINE_PUBLIC_KEY', walletId: 'OFFLINE_WALLET_ID', builderCode: 'OFFLINE' } } }), { mode: 0o600 });
  fs.writeFileSync(path.join(root, 'server/server.json'), JSON.stringify(initialState()));
}
export function serverStore(root) {
  const directory = path.join(root, 'server'); const file = path.join(directory, 'server.json');
  return work => withDirectoryLock(directory, () => { const data = JSON.parse(fs.readFileSync(file)); const result = work(data); fs.writeFileSync(file, JSON.stringify(data)); return result; });
}
export function systemEntry(data, event) {
  data.entries.push({ kind: 'system', chainId: 8453, onChainJobId: '123', timestamp: 1792540800000 + data.entries.length, event });
}
export function fund(root) { serverStore(root)(data => { data.job.jobStatus = 'FUNDED'; systemEntry(data, { type: 'job.funded', jobId: '123', client: CLIENT, amount: 0.005 }); }); }
export function executeSentinel(root, args) {
  const update = serverStore(root);
  update(data => { data.calls.commands.push(args); });
  if (args[0] === 'agent' && args[1] === 'signer-policy') return update(data => ({ signerId: 'OFFLINE_SIGNER', policyIds: ['OFFLINE_POLICY'], policy: data.options.wrongPolicy ? 'UNRESTRICTED' : 'ACP_ONLY' }));
  if (args[0] === 'wallet' && args[1] === 'sign-message') {
    assert.equal(args[3], '8453'); assert.match(args[5], /^acp-auth:[0-9]{13}$/);
    return { signature: 'OFFLINE_SIGNATURE' };
  }
  assert.equal(args[0], 'provider'); assert.equal(args[3], '8453'); assert.equal(args[5], '123');
  const isQuote = args[1] === 'set-budget';
  assert.ok(isQuote || args[1] === 'submit');
  const phase = isQuote ? 'quote' : 'delivery';
  const marker = openDeliveryJournal(path.join(root, 'operations'), { phase }).read('acp:8453:123');
  assert.equal(marker.state, 'sent_unknown');
  const failure = update(data => {
    data.calls[isQuote ? 'quotes' : 'submits']++;
    if (data.options[`${phase}Before`]) return 'response lost before effect';
    if (isQuote) {
      assert.equal(args[6], '--amount'); assert.equal(args[7], '0.005');
      data.job.budget = '5000'; systemEntry(data, { type: 'budget.set', jobId: '123', amount: 0.005 });
    } else {
      assert.equal(args[6], '--deliverable'); assert.equal(args[7], marker.artifact);
      data.job.deliverable = args[7];
      if (!data.options.postOnly) { data.job.jobStatus = 'SUBMITTED'; systemEntry(data, { type: 'job.submitted', jobId: '123', provider: PROVIDER, deliverable: args[7], deliverableHash: 'OFFLINE' }); }
    }
    return data.options[`${phase}After`] ? 'response lost after effect' : null;
  });
  if (update(data => data.options[`${phase}CrashAfter`])) process.exit(87);
  if (failure) throw Error(failure);
  return { success: true };
}
export function createTestBoundary(root, { mode = 'serve', realCli = false, evidence = () => {} } = {}) {
  const update = serverStore(root); const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    assert.ok(String(url).startsWith('https://acp.invalid/'), `Network escape ${url}`);
    let status = 200;
    const result = update(data => {
      if (url.endsWith('/auth/agent')) { data.calls.auth++; assert.equal(JSON.parse(init.body).signature, 'OFFLINE_SIGNATURE'); return { data: { token: TOKEN } }; }
      assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
      if (url.endsWith('/jobs')) return { jobs: data.active };
      if (url.endsWith(`/agents/wallet/${PROVIDER}`)) return { data: data.catalog };
      if (data.options.readbackFail && (data.calls.quotes || data.calls.submits)) throw Error('readback unavailable');
      if (url.endsWith('/chats/8453/123/history')) {
        if (data.options.historyDriftAfterReceipt && data.calls.receipt) data.entries[1].content += ' ';
        return { entries: data.entries };
      }
      assert.equal(url, 'https://acp.invalid/jobs/8453/123');
      if (data.options.jobDriftAfterReceipt && data.calls.receipt) Object.assign(data.job, data.options.jobDriftAfterReceipt);
      return { data: data.job };
    });
    return { ok: status === 200, status, json: async () => structuredClone(result) };
  };
  const runCli = realCli ? async args => {
    const { stdout } = await runNativeProcess(process.execPath, ['--import', fileURLToPath(new URL('./native-network-preload.mjs', import.meta.url)), '--import', fileURLToPath(new URL('./native-cli-sentinel-preload.mjs', import.meta.url)), fileURLToPath(new URL('./runtime/node_modules/@virtuals-protocol/acp-cli/dist/bin/acp.js', import.meta.url)), ...args, '--json'], {
      cwd: path.join(root, 'empty'), env: { PATH: process.env.PATH, HOME: root, ACP_CONFIG_DIR: path.join(root, 'profile'), ROOT1652_SENTINEL_ROOT: root, NODE_OPTIONS: '--max-old-space-size=768', NO_COLOR: '1' }, timeoutMs: 15000,
    });
    const result = JSON.parse(stdout); if (result.error) throw Error(result.error); return result;
  } : async args => executeSentinel(root, args);
  const boundary = createNativeBoundary({ configDirectory: path.join(root, 'profile'), workingDirectory: path.join(root, 'empty'), signerId: 'OFFLINE_SIGNER', mode, runCli, serverUrl: 'https://acp.invalid' });
  const event = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
  const client = {
    async getTransactionReceipt() {
      const options = update(data => { data.calls.receipt++; return data.options; });
      if (options.rpcFail) throw Error('unavailable');
      return { status: 'success', blockNumber: 123n, logs: [{ address: BASE_USDC, topics: encodeEventTopics({ abi: [event], eventName: 'Transfer', args: { from: CLIENT, to: REQUEST.recipient } }), data: encodeAbiParameters([{ type: 'uint256' }], [options.wrongAmount ? 1n : BigInt(REQUEST.amountAtomic)]) }] };
    },
    async getBlock() { update(data => { data.calls.block++; }); return { timestamp: 1792540800n }; },
  };
  const receiver = createOperatingReceiver({ boundary, journalDirectory: path.join(root, 'operations'), client, mode, selectionPolicy: 'provider-name-terms', now: () => new Date(NOW), evidence });
  return { boundary, receiver, update, client, close: () => { globalThis.fetch = oldFetch; } };
}
