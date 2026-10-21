// TEST ONLY: actual installed CLI parsing/factory/SDK guard, sentinel account,
// network and signing. Every unrecognized route fails; no native signer runs.
import { register } from 'node:module';
register('./native-cli-sentinel-loader.mjs', import.meta.url);
const { sdk, AGENT_ID } = await import('./native-boundary.mjs');
const { executeSentinel, serverStore, TOKEN } = await import('./operating-test-boundary.mjs');
const { PROVIDER } = await import('./fulfill.mjs');
const root = process.env.ROOT1652_SENTINEL_ROOT;
if (!root?.startsWith('/tmp/')) throw Error('Owned disposable synthetic root required');
const update = serverStore(root);
globalThis.fetch = async (url, init = {}) => {
  const route = new URL(url).pathname;
  const data = update(state => {
    if (route === '/agents') return { data: [{ id: AGENT_ID, walletAddress: PROVIDER, walletProviders: [] }] };
    if (route === `/agents/${AGENT_ID}`) return { data: { id: AGENT_ID, walletAddress: PROVIDER, walletProviders: [] } };
    if (route === `/agents/${AGENT_ID}/signers`) return { data: [{ id: 'OFFLINE_SIGNER', authorization_keys: [{ public_key: 'OFFLINE_PUBLIC_KEY' }], policy_ids: ['OFFLINE_POLICY'] }] };
    if (route === '/policies') return { data: [] };
    if (route === '/common/policies/global') return { data: [{ policyId: 'OFFLINE_POLICY', name: state.options.wrongPolicy ? 'UNRESTRICTED' : 'ACP_ONLY' }] };
    throw Error(`Synthetic CLI network escape: ${url}`);
  });
  return { ok: true, status: 200, json: async () => data };
};
sdk.PrivyAlchemyEvmProviderAdapter.create = async () => ({
  getAddress: async () => PROVIDER, getSupportedChainIds: async () => [8453],
  signMessage: async (chain, message) => executeSentinel(root, ['wallet', 'sign-message', '--chain-id', String(chain), '--message', message]).signature,
});
sdk.SseTransport.prototype.connect = async function (callback) { callback?.(); };
sdk.SseTransport.prototype.disconnect = async function () {};
sdk.AcpAgent.create = async () => {
  const facade = {
    getApi: () => ({ getJob: async () => update(state => state.job) }),
    async internalSetBudget(chain, params) { if (params.amount.rawAmount !== 5000n) throw Error('Wrong native CLI quote'); return executeSentinel(root, ['provider', 'set-budget', '--chain-id', String(chain), '--job-id', String(params.jobId), '--amount', String(params.amount.amount)]); },
    async internalSubmit(chain, params) { return executeSentinel(root, ['provider', 'submit', '--chain-id', String(chain), '--job-id', String(params.jobId), '--deliverable', params.deliverable]); },
  };
  return {
    start: async () => {}, stop: async () => {},
    getSession(chain, id) { const session = new sdk.JobSession(facade, [PROVIDER], id, chain, ['provider'], update(state => state.entries)); session._job = sdk.AcpJob.fromOffChain(update(state => state.job)); return session; },
    getApi: () => ({ getActiveSubscription: async () => null }),
  };
};
