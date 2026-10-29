// Test process guard: fail before any external connection. No proxy environment.
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
const connect = net.Socket.prototype.connect;
globalThis.__OFFLINE_CONNECTIONS__ = [];
net.Socket.prototype.connect = function (...args) {
  const first = args[0];
  const options = Array.isArray(first) ? first[0] : first;
  const host = typeof options === 'object' ? options.host || options.hostname : typeof args[1] === 'string' ? args[1] : undefined;
  globalThis.__OFFLINE_CONNECTIONS__.push(host || 'UNSPECIFIED');
  if (host !== '127.0.0.1' && host !== '::1') throw Error('external connection refused: ' + host);
  return connect.apply(this, args);
};
syncBuiltinESMExports();
