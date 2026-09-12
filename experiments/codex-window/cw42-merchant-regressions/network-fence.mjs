import net from 'node:net';
import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const port = 55549;
const originalConnect = net.Socket.prototype.connect;
function event(value) {
  if (process.env.CW42_EVENTS) appendFileSync(process.env.CW42_EVENTS, `${JSON.stringify(value)}\n`);
}
net.Socket.prototype.connect = function (...args) {
  // net.connect normalizes its arguments to an array before calling connect.
  const actual = Array.isArray(args[0]) ? args[0] : args;
  const options = actual[0] && typeof actual[0] === 'object'
    ? actual[0] : { port: actual[0], host: typeof actual[1] === 'string' ? actual[1] : 'localhost' };
  const host = options.host || options.hostname || 'localhost';
  if (options.path || !['127.0.0.1', 'localhost', '::1'].includes(host) || Number(options.port) !== port) {
    event({ kind: 'blocked-socket', host, port: options.port });
    throw new Error('CW42_NETWORK_FENCE: only owned loopback port 55549 is allowed');
  }
  return originalConnect.apply(this, args);
};
syncBuiltinESMExports();

const originalFetch = globalThis.fetch;
globalThis.fetch = async function (input, init) {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (process.env.CW42_FAKE_FACILITATOR === '1' && url.origin === 'https://cw42-facilitator.invalid') {
    const method = init?.method || (input instanceof Request ? input.method : 'GET');
    event({ kind: 'fake-facilitator', method, path: url.pathname });
    const payer = '0x1111111111111111111111111111111111111111';
    const reply = url.pathname === '/supported'
      ? { kinds: [{ network: 'eip155:8453', scheme: 'exact', x402Version: 2 }], extensions: [], signers: {} }
      : url.pathname === '/verify' ? { isValid: true, payer }
        : url.pathname === '/settle' ? { success: true, payer, transaction: `0x${'3'.repeat(64)}`, network: 'eip155:8453' }
          : null;
    if (!reply) throw new Error('Unexpected fake facilitator path');
    return Response.json(reply);
  }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || Number(url.port) !== port) {
    event({ kind: 'blocked-fetch', origin: url.origin });
    throw new Error('CW42_NETWORK_FENCE: external fetch refused');
  }
  return originalFetch(input, init);
};
