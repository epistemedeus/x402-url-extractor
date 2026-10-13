// Receiver processes have no ambient provider or payment transport. Fixtures
// use numeric loopback addresses; refusal happens before DNS or socket I/O.
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';

function local(host) {
  if (!['127.0.0.1', '::1', '[::1]', 'localhost', undefined].includes(host)) {
    throw new Error('229200 outbound network refused');
  }
}
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const options = net._normalizeArgs(args)[0];
  if (options.path) throw new Error('229200 external socket refused');
  local(options.host);
  return connect.apply(this, args);
};
for (const module of [http, https]) {
  const request = module.request;
  module.request = function (input, ...args) {
    const options = typeof input === 'string' || input instanceof URL ? new URL(input) : input;
    local(options?.hostname || options?.host);
    return request.call(this, input, ...args);
  };
}
const fetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  try {
    const url = new URL(input instanceof Request ? input.url : input);
    local(url.hostname);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('229200 protocol refused');
    return fetch(input, options);
  } catch (error) { return Promise.reject(error); }
};
syncBuiltinESMExports();
