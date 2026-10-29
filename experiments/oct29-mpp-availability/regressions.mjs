import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const calls = [];
const facilitator = createServer((req, res) => {
  calls.push(`${req.method} ${req.url}`);
  res.writeHead(req.url === '/supported' ? 200 : 500, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453' }], extensions: [], signers: {} }));
});
facilitator.listen(0, '127.0.0.1');
await once(facilitator, 'listening');
try {
  const files = process.argv.slice(2);
  const child = spawn(process.execPath, ['--test', '--test-concurrency=1', ...(files.length ? files : [
    'payment-availability.test.mjs', 'operation-identity.test.mjs', 'construction-surface.test.mjs',
    'machine-surface-parity.test.mjs', 'machine-surface-parity.http.test.mjs',
    'a2a-storefront.test.mjs', 'skill-contract.test.mjs', 'solana-agent-registration.test.mjs',
    'paywall-applicability.http.test.mjs', 'discovery-method-parity.http.test.mjs',
    'well-known-skills.mounted.test.mjs', 'openapi-operation-id.test.mjs',
    'purchase-evidence-manifest.test.mjs', 'paid-action-effect-profile.test.mjs',
  ])], { cwd: process.env.MERCHANT_ROOT || process.cwd(), stdio: 'inherit',
    env: { PATH: process.env.PATH, NODE_OPTIONS: '--max-old-space-size=512',
      PUBLIC_URL: 'https://agents.samedaydesk.com', FACILITATOR: 'xpay',
      FACILITATOR_URL: `http://127.0.0.1:${facilitator.address().port}`, MPP_SECRET_KEY: '',
    } });
  const [exit, signal] = await once(child, 'exit');
  if (calls.some(c => c !== 'GET /supported')) throw Error(JSON.stringify(calls));
  console.log(JSON.stringify({ regressionExit: exit, signal, localFacilitatorCalls: calls.length, verify: 0, settle: 0 }));
  process.exitCode = exit ?? 1;
} finally { await new Promise(r => facilitator.close(r)); }
