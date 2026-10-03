import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import express from 'express';
import { HARD } from '../src/bounds.mjs';
import { mountScopedRepairCommerce } from '../route/mount.mjs';

const declared = 1000000;
const sent = 530000;

function listen(server) {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function rawRequest({ port, path, contentLength, payload, headers = {} }) {
  const extra = Object.entries(headers).map(([name, value]) => `${name}: ${value}`).join('\r\n');
  const head = [
    `POST ${path} HTTP/1.1`,
    `Host: 127.0.0.1:${port}`,
    'Content-Type: application/json',
    `Content-Length: ${contentLength}`,
    'Connection: keep-alive',
    extra,
    '',
    '',
  ].filter((line, index, all) => line !== '' || index >= all.length - 2).join('\r\n');
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    const started = performance.now();
    let buf = Buffer.alloc(0);
    let clientClosed = false;
    let settled = false;
    const fail = error => { if (!settled) { settled = true; reject(error); } };
    const timer = setTimeout(() => fail(new Error('raw_response_timeout')), HARD.deadlineMs + 1000);
    const onData = chunk => {
      buf = Buffer.concat([buf, chunk]);
      const sep = buf.indexOf('\r\n\r\n');
      if (sep < 0) return;
      const headText = buf.subarray(0, sep).toString('latin1');
      const status = Number((headText.match(/^HTTP\/1\.1 (\d+)/) || [])[1]);
      const length = Number((headText.match(/content-length:\s*(\d+)/i) || [])[1]);
      if (!Number.isInteger(length) || buf.length < sep + 4 + length) return;
      clearTimeout(timer);
      socket.off('data', onData);
      settled = true;
      resolve({
        status,
        headers: headText,
        body: JSON.parse(buf.subarray(sep + 4, sep + 4 + length).toString('utf8')),
        socket,
        clientClosed: () => clientClosed,
        elapsed: () => performance.now() - started,
      });
    };
    socket.on('error', error => { if (!settled) fail(error); });
    socket.on('close', () => { clientClosed = true; });
    socket.on('data', onData);
    socket.once('connect', () => {
      socket.write(head);
      if (payload.length) socket.write(payload);
    });
  });
}

async function mountedServer() {
  const app = express();
  mountScopedRepairCommerce(app, { skillguardRoot: null });
  const server = http.createServer(app);
  const seen = { socket: null, req: null, serverClosed: false };
  server.on('connection', socket => {
    seen.socket = socket;
    socket.on('close', () => { seen.serverClosed = true; });
  });
  server.on('request', req => { seen.req = req; });
  const port = await listen(server);
  return {
    port,
    seen,
    close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }),
  };
}

test('a withheld oversized request closes the server socket within the intake deadline', async () => {
  assert.ok(sent > HARD.maxInputBytes && sent < declared);
  const host = await mountedServer();
  try {
    const response = await rawRequest({
      port: host.port,
      path: '/commerce/scoped-repair/deliver',
      contentLength: declared,
      payload: Buffer.alloc(sent, 0x78),
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.reason, 'input_bytes_exceeded');
    assert.equal(response.body.paymentPerformed, false);
    assert.match(response.headers, /connection:\s*close/i);
    const closed = await Promise.race([
      new Promise(resolve => {
        if (host.seen.serverClosed) return resolve(true);
        host.seen.socket.once('close', () => resolve(true));
      }),
      new Promise(resolve => setTimeout(() => resolve(false), HARD.deadlineMs)),
    ]);
    assert.equal(closed, true);
    assert.equal(host.seen.serverClosed, true);
    assert.equal(host.seen.socket.destroyed, true);
    assert.equal(host.seen.req.complete, false);
    assert.equal(host.seen.req.aborted, true);
    const clientClosed = response.clientClosed() || await Promise.race([
      new Promise(resolve => response.socket.once('close', () => resolve(true))),
      new Promise(resolve => setTimeout(() => resolve(false), 1000)),
    ]);
    assert.equal(clientClosed, true);
    assert.ok(response.elapsed() < HARD.deadlineMs, `closed after ${response.elapsed()}ms`);
    response.socket.destroy();
  } finally {
    await host.close();
  }
});

test('a configured shorter intake deadline still closes the withheld socket', async () => {
  const deadlineMs = 800;
  const host = await mountedServer();
  try {
    const response = await rawRequest({
      port: host.port,
      path: '/commerce/scoped-repair/deliver',
      contentLength: declared,
      payload: Buffer.alloc(sent, 0x78),
      headers: { 'x-scoped-deadline-at': String(Date.now() + deadlineMs) },
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.reason, 'input_bytes_exceeded');
    const closed = await Promise.race([
      new Promise(resolve => host.seen.serverClosed ? resolve(true) : host.seen.socket.once('close', () => resolve(true))),
      new Promise(resolve => setTimeout(() => resolve(false), deadlineMs + 200)),
    ]);
    assert.equal(closed, true);
    assert.equal(host.seen.req.aborted, true);
    const clientClosed = response.clientClosed() || await Promise.race([
      new Promise(resolve => response.socket.once('close', () => resolve(true))),
      new Promise(resolve => setTimeout(() => resolve(false), 1000)),
    ]);
    assert.equal(clientClosed, true);
    assert.ok(response.elapsed() < deadlineMs + 200, `closed after ${response.elapsed()}ms`);
    response.socket.destroy();
  } finally {
    await host.close();
  }
});

test('a finished invalid body keeps the connection and a complete oversized body still returns 400', async () => {
  const host = await mountedServer();
  try {
    const small = Buffer.from('{}');
    const first = await rawRequest({
      port: host.port,
      path: '/commerce/scoped-repair/deliver',
      contentLength: small.length,
      payload: small,
    });
    assert.equal(first.status, 400);
    assert.notEqual(first.body.reason, 'input_bytes_exceeded');
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(host.seen.serverClosed, false);
    assert.equal(host.seen.socket.destroyed, false);
    assert.equal(host.seen.req.complete, true);
    assert.equal(first.clientClosed(), false);
    const again = Buffer.from('{"schema":"nope"}');
    first.socket.write([
      'POST /commerce/scoped-repair/deliver HTTP/1.1',
      `Host: 127.0.0.1:${host.port}`,
      'Content-Type: application/json',
      `Content-Length: ${again.length}`,
      'Connection: close',
      '',
      '',
    ].join('\r\n'));
    first.socket.write(again);
    const secondBuf = await new Promise((resolve, reject) => {
      let buf = Buffer.alloc(0);
      const timer = setTimeout(() => reject(new Error('second_response_timeout')), 2000);
      const onData = chunk => {
        buf = Buffer.concat([buf, chunk]);
        const sep = buf.indexOf('\r\n\r\n');
        if (sep < 0) return;
        const length = Number((buf.subarray(0, sep).toString('latin1').match(/content-length:\s*(\d+)/i) || [])[1]);
        if (buf.length < sep + 4 + length) return;
        clearTimeout(timer);
        first.socket.off('data', onData);
        resolve(buf.subarray(sep + 4, sep + 4 + length));
      };
      first.socket.on('data', onData);
    });
    assert.equal(JSON.parse(secondBuf.toString('utf8')).ok, false);
    first.socket.destroy();
    const oversized = Buffer.from(JSON.stringify({ pad: 'x'.repeat(sent) }));
    const response = await fetch(`http://127.0.0.1:${host.port}/commerce/scoped-repair/deliver`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: oversized,
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).reason, 'input_bytes_exceeded');
  } finally {
    await host.close();
  }
});
