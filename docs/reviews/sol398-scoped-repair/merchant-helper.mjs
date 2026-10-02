import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { unusedPort } from '../../../task-linked-delivery/experiments/scoped-repair-commerce-100348/test/merchant.mjs';

export const ROOT = path.resolve(import.meta.dirname, '../../..');

// Actual server process, isolated files and an unpaid loopback facilitator.
// Verification and settlement are traps, never successful payment adapters.
export async function startMerchant(packetDir) {
  const data = await mkdtemp(path.join(tmpdir(), 'sol398-merchant-'));
  const calls = { verify: 0, settle: 0 };
  const facilitator = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/supported') return res.end(JSON.stringify({ kinds: [{ network: 'eip155:8453', scheme: 'exact', x402Version: 2 }], extensions: [], signers: {} }));
    if (req.url === '/verify') calls.verify++;
    if (req.url === '/settle') calls.settle++;
    res.writeHead(500); res.end('{"error":"paid_boundary_forbidden"}');
  });
  await new Promise(resolve => facilitator.listen(0, '127.0.0.1', resolve));
  const port = await unusedPort();
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: {
    PATH: process.env.PATH || '', PORT: String(port), COMMERCE_DATA_DIR: data,
    SCOPED_REPAIR_PACKET_DIR: packetDir, FACILITATOR: 'xpay',
    FACILITATOR_URL: 'http://127.0.0.1:' + facilitator.address().port,
    PUBLIC_URL: 'https://agents.samedaydesk.com',
    COMMERCE_RECONCILIATION_INTERVAL_MS: '86400000', MPP_SECRET_KEY: '',
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  const close = async () => {
    if (child.exitCode === null && child.signalCode === null) await new Promise(resolve => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
      child.once('exit', () => { clearTimeout(timer); resolve(); }); child.kill('SIGTERM');
    });
    facilitator.closeAllConnections();
    await new Promise(resolve => facilitator.close(resolve));
    await rm(data, { recursive: true, force: true });
  };
  try {
    await new Promise((resolve, reject) => {
      let seen = '', bytes = 0;
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('merchant_start_deadline')); }, 10000);
      const consume = chunk => {
        bytes += chunk.length; seen = (seen + chunk).slice(-2000);
        if (bytes > 65536) { clearTimeout(timer); child.kill('SIGKILL'); reject(new Error('merchant_output_bound')); }
        if (seen.includes('x402-merchant listening on :' + port)) { clearTimeout(timer); resolve(); }
      };
      child.stdout.on('data', consume); child.stderr.on('data', consume);
      child.once('error', () => { clearTimeout(timer); reject(new Error('merchant_start_failed')); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('merchant_start_failed')); });
    });
    return { base: 'http://127.0.0.1:' + port, calls, close };
  } catch (error) { await close(); throw error; }
}
