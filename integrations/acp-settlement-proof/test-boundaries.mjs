// Offline boundaries shared by the configured receiving command and its tests.
// Full published SDK classes execute; no real provider or listener is created.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { encodeAbiParameters, encodeEventTopics, parseAbiItem } from 'viem';
import { withDirectoryLock } from '../../experiments/scoped-surface-delivery-100312/src/lock.mjs';
import { BASE_USDC } from '../../settlement-proof.mjs';
import { PROVIDER, OFFERING_ID } from './fulfill.mjs';
import { configureSettlementProofDelivery } from './configured.mjs';
import { openDeliveryJournal } from './journal.mjs';

const requireSdk = createRequire(new URL('./validation/package.json', import.meta.url));
export const sdk = await import(pathToFileURL(requireSdk.resolve('@virtuals-protocol/acp-node-v2')));
export const REQUEST = { transactionHash: `0x${'1'.repeat(64)}`, recipient: `0x${'2'.repeat(40)}`, amountAtomic: '5000', payer: `0x${'1'.repeat(40)}` };
export const CLIENT = `0x${'3'.repeat(40)}`;
export const KEY = 'acp:8453:123';
export const NOW = '2026-10-20T22:00:00.000Z';

export function initialServer(options = {}) {
  return {
    options, calls: { http: [], receipt: 0, block: 0, authSigns: 0, prepares: 0, sends: 0 },
    job: { chainId: 8453, onChainJobId: '123', clientAddress: CLIENT, providerAddress: PROVIDER,
      evaluatorAddress: CLIENT, description: 'Settlement Proof', budget: '5000', expiredAt: '2026-10-21T22:00:00.000Z', jobStatus: 'FUNDED', hookAddress: `0x${'0'.repeat(40)}`, intents: [], deliverable: null },
    history: [{ kind: 'message', chainId: 8453, onChainJobId: '123', from: CLIENT, contentType: 'requirement', content: JSON.stringify(REQUEST), timestamp: 1792533600000 }],
    catalog: { walletAddress: PROVIDER, offerings: [{ id: OFFERING_ID, name: 'Settlement Proof', priceType: 'fixed', priceValue: 0.005, slaMinutes: 1440, requiredFunds: false, subscriptions: [] }] },
  };
}

export function createBoundary(serverDirectory, journalDirectory) {
  const file = path.join(serverDirectory, 'server.json');
  function update(work) {
    return withDirectoryLock(serverDirectory, () => {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      const result = work(data);
      fs.writeFileSync(file, JSON.stringify(data));
      return result;
    });
  }
  const journal = openDeliveryJournal(journalDirectory);
  const context = { providerSupportedChainIds: [8453], agentAddresses: { evm: PROVIDER }, async signMessage(chain, message) {
    assert.equal(chain, 8453); assert.match(message, /^acp-auth:\d+$/);
    update(data => { data.calls.authSigns++; }); return 'OFFLINE_AUTH_SENTINEL';
  } };
  const api = new sdk.AcpApiClient({ serverUrl: 'https://acp.invalid' }); api.setContext(context);
  const history = new sdk.SseTransport({ serverUrl: 'https://acp.invalid' }); history.setContext(context);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    assert.ok(url.startsWith('https://acp.invalid/'), `network escape: ${url}`);
    const action = update(data => {
      data.calls.http.push({ url, method: init.method ?? 'GET' });
      if (url.endsWith('/auth/agent')) return { data: { token: `offline.${Buffer.from(JSON.stringify({ exp: 4102444800, wallet: JSON.parse(init.body).walletAddress })).toString('base64url')}.sentinel` } };
      assert.match(init.headers.Authorization, /^Bearer offline\./);
      const wallet = JSON.parse(Buffer.from(init.headers.Authorization.split('.')[1], 'base64url')).wallet;
      if (url.endsWith(`/agents/wallet/${PROVIDER}`)) return { data: data.catalog };
      if (url.endsWith('/chats/8453/123/message')) {
        assert.equal(init.method, 'POST');
        data.history.push({ kind: 'message', chainId: 8453, onChainJobId: '123', from: wallet, timestamp: 1792533600000, ...JSON.parse(init.body) });
        return {};
      }
      if (url.endsWith('/chats/8453/123/history')) {
        if (data.options.historyDriftAfterReceipt && data.calls.receipt) data.history[0].content += ' ';
        return { entries: data.history };
      }
      if (url.endsWith('/jobs/8453/123/deliverable')) {
        assert.equal(wallet, PROVIDER);
        assert.equal(init.method, 'POST'); assert.equal(journal.read(KEY).state, 'sent_unknown');
        data.job.deliverable = JSON.parse(init.body).deliverable;
        return data.options.postResponseLost ? { failure: 'lost HTTP response' } : {};
      }
      assert.equal(url, 'https://acp.invalid/jobs/8453/123');
      if (data.options.readbackFail && data.calls.sends) return { failure: 'readback down' };
      if (data.options.jobDriftAfterReceipt && data.calls.receipt) Object.assign(data.job, data.options.jobDriftAfterReceipt);
      return { data: data.job };
    });
    if (action.failure) throw Error(action.failure);
    return { ok: true, status: 200, json: async () => structuredClone(action) };
  };
  const signer = {
    async submit(chain, params) { assert.equal(chain, 8453); assert.equal(params.jobId, 123n); update(data => { data.calls.prepares++; }); return { params }; },
    async submitPrepared(chain, prepared) {
      assert.equal(chain, 8453); assert.equal(prepared.length, 1); assert.equal(journal.read(KEY).state, 'sent_unknown');
      const failure = update(data => {
        data.calls.sends++;
        if (data.options.signerRefuse) return 'signer refuses';
        data.job.jobStatus = 'SUBMITTED';
        return data.options.responseLost ? 'transaction response lost' : null;
      });
      if (failure) throw Error(failure);
      return 'OFFLINE_TX_SENTINEL';
    },
    isStalePrepareError: sdk.BaseAcpClient.prototype.isStalePrepareError,
  };
  const agent = new sdk.AcpAgent(new Map([['evm', signer]]), history, api);
  const session = new sdk.JobSession(agent, [PROVIDER], '123', 8453, ['provider'], [{ kind: 'system', event: { type: 'job.funded' } }]);
  const event = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
  const client = {
    async getTransactionReceipt() {
      const options = update(data => { data.calls.receipt++; return data.options; });
      if (options.rpcFail) throw Error('RPC unavailable');
      return { status: 'success', blockNumber: 123n, logs: [{ address: BASE_USDC,
        topics: encodeEventTopics({ abi: [event], eventName: 'Transfer', args: { from: REQUEST.payer, to: REQUEST.recipient } }),
        data: encodeAbiParameters([{ type: 'uint256' }], [options.wrongAmount ? 4999n : 5000n]),
      }] };
    },
    async getBlock() { update(data => { data.calls.block++; }); return { timestamp: 1792533600n }; },
  };
  const configuration = { session, history, catalog: api, journalDirectory, client, now: () => new Date(NOW), selectionPolicy: 'provider-name-terms' };
  return { update, journal, session, history, api, configuration,
    run: () => configureSettlementProofDelivery(configuration).run(),
    close() { globalThis.fetch = originalFetch; },
  };
}
