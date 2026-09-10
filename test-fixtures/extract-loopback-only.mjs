// Native test-process guard. Never shipped as service runtime configuration.
import net from 'node:net';
const original = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = args[0];
  const normalized = Array.isArray(first) ? first[0] : first;
  let host = normalized && typeof normalized === 'object' ? normalized.host : typeof args[1] === 'string' ? args[1] : 'localhost';
  host ||= 'localhost';
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw Object.assign(new Error('S66 test guard refused non-loopback socket'), { code: 'TEST_EXTERNAL_NETWORK_BLOCKED' });
  }
  return original.apply(this, args);
};
