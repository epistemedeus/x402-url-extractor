import fs from 'node:fs';
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { createNativeBoundary } from './native-boundary.mjs';
import { runWorker, receiveWorkerConfig, installNetworkBounds } from './worker.mjs';
const [mode, configFile, onceFlag] = process.argv.slice(2);
if (!['observe', 'serve'].includes(mode) || !configFile || (onceFlag && onceFlag !== '--once')) throw Error('Usage: node start.mjs observe|serve /absolute/worker.json [--once]');
if (process.env.NODE_OPTIONS !== '--max-old-space-size=768') throw Error('Explicit NODE_OPTIONS=--max-old-space-size=768 required');
const config = receiveWorkerConfig(JSON.parse(fs.readFileSync(configFile, 'utf8')));
const rpc = new URL(config.receiptRpcUrl);
if (rpc.protocol !== 'https:' || rpc.username || rpc.password || rpc.search || rpc.hash) throw Error('Explicit HTTPS receipt RPC without inline credentials required');
const stop = new AbortController();
const timer = setTimeout(() => stop.abort(), config.runForSeconds * 1000);
const shutdown = () => stop.abort();
process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
const restore = installNetworkBounds({ signal: stop.signal, rpcOrigin: rpc.origin });
let logBytes = 0;
const evidence = entry => {
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n';
  logBytes += Buffer.byteLength(line);
  if (logBytes <= 256 * 1024) process.stdout.write(line);
  else stop.abort();
};
try {
  const boundary = createNativeBoundary({ configDirectory: config.configDirectory, workingDirectory: config.workingDirectory, signerId: config.signerId, mode, signal: stop.signal });
  const client = createPublicClient({ chain: base, transport: http(config.receiptRpcUrl, { timeout: 15000, retryCount: 0 }) });
  await runWorker({ config, boundary, client, mode, once: onceFlag === '--once', signal: stop.signal, evidence });
} catch {
  evidence({ stage: 'worker_refused_or_interrupted' });
  process.exitCode = stop.signal.aborted ? 0 : 1;
} finally {
  stop.abort(); clearTimeout(timer); restore();
  process.removeListener('SIGINT', shutdown); process.removeListener('SIGTERM', shutdown);
}
