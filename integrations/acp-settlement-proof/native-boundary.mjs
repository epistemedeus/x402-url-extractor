import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { runNativeProcess } from './native-process.mjs';
import { PROVIDER } from './fulfill.mjs';
import { validJobId } from './operating.mjs';

export const AGENT_ID = '019fef7a-3b3e-7a67-b825-6abfd8ba0e17';
const requireRuntime = createRequire(new URL('./runtime/package.json', import.meta.url));
export const sdk = await import(pathToFileURL(requireRuntime.resolve('@virtuals-protocol/acp-node-v2')));
const { EventSource } = await import(pathToFileURL(requireRuntime.resolve('eventsource')));
const check = (ok, message) => { if (!ok) throw Error(message); };

export function receiveProfile(configDirectory) {
  check(typeof configDirectory === 'string' && path.isAbsolute(configDirectory) && fs.realpathSync(configDirectory) === path.resolve(configDirectory), 'Explicit real ACP profile directory required');
  const dir = fs.statSync(configDirectory);
  check(dir.isDirectory() && dir.uid === process.getuid() && !(dir.mode & 0o077), 'ACP profile must be private and process-owned');
  const file = path.join(configDirectory, 'config.json');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    check(stat.isFile() && stat.uid === process.getuid() && stat.size <= 65536, 'Bounded owned native profile required');
    const config = JSON.parse(fs.readFileSync(fd, 'utf8'));
    const wallet = config.activeWallet;
    const agent = config.agents?.[wallet];
    check(wallet?.toLowerCase() === PROVIDER && agent?.id === AGENT_ID && typeof agent.publicKey === 'string' && agent.publicKey.length > 0 && typeof agent.walletId === 'string' && agent.walletId.length > 0, 'Existing exact provider profile and native signer enrollment required');
    return { wallet, agentId: agent.id, publicKey: agent.publicKey, walletId: agent.walletId };
  } finally { fs.closeSync(fd); }
}

/** Only official native CLI commands cross the account boundary. No private key
 * is read, no factory is patched, no broad signing interface escapes this module. */
export function createNativeBoundary({ configDirectory, workingDirectory, signerId, mode, runCli, serverUrl = sdk.ACP_SERVER_URL, signal }) {
  check(['observe', 'serve'].includes(mode), 'Explicit account mode required');
  check(typeof signerId === 'string' && signerId.length > 0, 'Explicit enrolled signer ID required');
  const original = receiveProfile(configDirectory);
  const cliPackage = requireRuntime.resolve('@virtuals-protocol/acp-cli/package.json');
  const cliRoot = path.dirname(cliPackage);
  check(JSON.parse(fs.readFileSync(cliPackage)).version === '1.0.30', 'Native CLI 1.0.30 required');
  const cliRequire = createRequire(cliPackage);
  check(JSON.parse(fs.readFileSync(cliRequire.resolve('@virtuals-protocol/acp-node-v2/package.json'))).version === '0.1.15', 'CLI/SDK compatible 0.1.15 closure required');
  check(path.isAbsolute(workingDirectory) && fs.realpathSync(workingDirectory) === path.resolve(workingDirectory) && fs.statSync(workingDirectory).uid === process.getuid() && !(fs.statSync(workingDirectory).mode & 0o077) && fs.readdirSync(workingDirectory).length === 0, 'Private empty CLI working directory required');
  const nativeRun = runCli ?? (async args => {
    const env = { PATH: process.env.PATH, HOME: process.env.HOME, ACP_CONFIG_DIR: configDirectory, NODE_OPTIONS: '--max-old-space-size=768', NO_COLOR: '1' };
    // The native credential backend uses the service user's existing environment.
    for (const name of ['XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS']) if (process.env[name]) env[name] = process.env[name];
    const { stdout } = await runNativeProcess(process.execPath, ['--import', fileURLToPath(new URL('./native-network-preload.mjs', import.meta.url)), path.join(cliRoot, 'dist/bin/acp.js'), ...args, '--json'], { env, cwd: workingDirectory, signal });
    const result = JSON.parse(stdout);
    check(!result.error, 'Native CLI refused operation');
    return result;
  });
  async function run(args) {
    check(JSON.stringify(receiveProfile(configDirectory)) === JSON.stringify(original), 'Native profile identity changed');
    check(!signal?.aborted, 'Native worker stopping');
    return nativeRun(args);
  }
  async function receivePolicy() {
    const policy = await run(['agent', 'signer-policy', '--agent-id', AGENT_ID]);
    check(policy.signerId === signerId && policy.policy === 'ACP_ONLY' && Array.isArray(policy.policyIds) && policy.policyIds.length === 1, 'Existing ACP_ONLY signer policy required');
  }
  const context = { agentAddresses: { evm: PROVIDER }, providerSupportedChainIds: [8453], contractAddresses: sdk.ACP_CONTRACT_ADDRESSES,
    getClientForChain() { throw Error('No general signing client exposed'); },
    async signMessage(chain, message) {
      check(chain === 8453 && /^acp-auth:[0-9]{13}$/.test(message), 'Only native ACP authentication challenge supported');
      const result = await run(['wallet', 'sign-message', '--chain-id', '8453', '--message', message]);
      check(typeof result.signature === 'string' && result.signature.length > 0, 'Native authentication signature missing');
      return result.signature;
    },
  };
  const api = new sdk.AcpApiClient({ serverUrl }); api.setContext(context);
  const history = new sdk.SseTransport({ serverUrl }); history.setContext(context);
  // The published active-array/history readers do not check final HTTP status.
  // Retain SDK's single 401 refresh, but never interpret an error body as [].
  for (const transport of [api, history]) {
    const fetch = transport.authedFetch.bind(transport);
    transport.authedFetch = async (...args) => {
      const response = await fetch(...args);
      check(response.ok, 'Authenticated receiver HTTP read failed');
      const json = response.json.bind(response);
      response.json = async () => {
        const body = await json();
        const pathname = new URL(args[0]).pathname;
        if (pathname === '/jobs') check(Array.isArray(body?.jobs), 'Explicit active-job array required');
        if (pathname.endsWith('/history')) check(Array.isArray(body?.entries), 'Explicit job-history array required');
        return body;
      };
      return response;
    };
  }
  const facade = { getApi: () => api,
    async internalSetBudget(chain, params) {
      check(mode === 'serve' && chain === 8453 && validJobId(String(params.jobId)) && params.amount.rawAmount === 5000n, 'Exact quote authority required');
      await receivePolicy();
      return run(['provider', 'set-budget', '--chain-id', '8453', '--job-id', String(params.jobId), '--amount', '0.005']);
    },
    async internalSubmit(chain, params) {
      check(mode === 'serve' && chain === 8453 && validJobId(String(params.jobId)) && typeof params.deliverable === 'string' && Buffer.byteLength(params.deliverable) <= 65536, 'Exact receipt submission authority required');
      await receivePolicy();
      return run(['provider', 'submit', '--chain-id', '8453', '--job-id', String(params.jobId), '--deliverable', params.deliverable]);
    },
  };
  let source = null;
  let hintHandler = null;
  let rejectConnection = null;
  function disconnect() {
    source?.close(); source = null;
    rejectConnection?.(Error('Native stream stopped')); rejectConnection = null;
  }
  signal?.addEventListener('abort', disconnect);
  return Object.freeze({ api, catalog: api, history, receivePolicy,
    async connect(onConnected) {
      check(!source && !signal?.aborted, 'Existing stream must close before reconnect');
      await history.ensureAuthenticated();
      // SDK0.1.15's initial SSE open can retry forever without rejecting. Use
      // its documented route/auth and the same public EventSource dependency,
      // with an owned handle and a finite initial-open deadline.
      return new Promise((resolve, reject) => {
        let opened = false;
        const timer = setTimeout(() => disconnect(), 15000);
        rejectConnection = error => { clearTimeout(timer); if (!opened) reject(error); };
        source = new EventSource(`${serverUrl}/chats/stream`, { fetch: (url, init) => history.authedFetch(url, { ...init, headers: { ...init?.headers, 'x-supported-chains': '[8453]' } }) });
        source.onopen = () => { if (!opened) { opened = true; clearTimeout(timer); rejectConnection = null; onConnected?.(); resolve(); } };
        source.onerror = () => { if (!opened) disconnect(); };
        source.onmessage = message => {
          if (Buffer.byteLength(message.data) > 16384) return;
          try { const hint = JSON.parse(message.data); hintHandler?.({ chainId: hint.chainId, onChainJobId: hint.onChainJobId }); } catch { /* malformed hints carry no authority */ }
        };
      });
    },
    disconnect,
    onHint: handler => { hintHandler = handler; },
    session(id, entries) {
      check(validJobId(id), 'Canonical session identity required');
      return new sdk.JobSession(facade, [PROVIDER], id, 8453, ['provider'], entries);
    },
  });
}
