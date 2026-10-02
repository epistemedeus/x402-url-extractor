import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns';
import { assertResolvedPublicAddresses } from 'agent-payment-policy';
import { parseJson } from '../../task-demand-100339/src/bounds.mjs';
import { ROUTE, verifyPacket } from './contracts.mjs';
import { fail } from './bounds.mjs';

export function serviceOrigin(value) {
  let url; try { url = new URL(value); } catch { fail('service_url_required'); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') fail('service_origin_required');
  if (url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port) return url;
  if (url.protocol !== 'https:' || (url.port && url.port !== '443')) fail('service_transport_refused');
  return url;
}
export async function callService(base, command, input, budget) {
  if (!['deliver','reuse','accept','review'].includes(command)) fail('command_invalid');
  const url = new URL(ROUTE + '/' + command, serviceOrigin(base));
  const bytes = Buffer.from(JSON.stringify(input)); budget.read(bytes.length);
  // Reserve both sides before transport: service child/output bytes plus local
  // reply output, and service reads plus the local response read. Reservations
  // are allowances, not claimed measured resource costs.
  const availableOutput=budget.remainingOutput(),replyCap=Math.floor(availableOutput*2/5),serviceOutput=availableOutput-replyCap;
  if(replyCap<1024)fail('output_bytes_exceeded');
  budget.chargeOutput(serviceOutput);budget.read(replyCap);
  const snapshot=budget.snapshot(),serviceReads=snapshot.caps.maxReadBytes-snapshot.readBytes;
  const serviceInput=snapshot.caps.maxInputBytes-snapshot.inputBytes;
  if(serviceReads<1024||serviceInput<1024||bytes.length>serviceInput)fail('input_bytes_exceeded');
  budget.read(serviceReads);
  const isLoopback = url.protocol === 'http:';
  const headers = { 'content-type': 'application/json', 'content-length': bytes.length,
    'x-scoped-deadline-at': String(Date.now() + Math.floor(budget.remainingMs())),
    'x-scoped-read-left': String(serviceReads),
    'x-scoped-input-left': String(serviceInput),
    'x-scoped-output-left': String(serviceOutput),
    'x-scoped-reply-left': String(replyCap) };
  let req;
  let result;
  try { result = await budget.wait(new Promise((resolve, reject) => {
    req = (isLoopback ? http : https).request(url, { method: 'POST', headers,
      lookup: isLoopback ? undefined : (host, options, done) => lookup(host, { all: true }, (error, entries) => {
        try {
          budget.check(); if (error) return done(error);
          assertResolvedPublicAddresses(entries);
          done(null, options?.all ? entries : entries[0].address, options?.all ? undefined : entries[0].family);
        } catch (e) { done(e); }
      }) }, res => {
        const chunks = []; let used = 0;
        if (res.statusCode >= 300 && res.statusCode < 400) { res.destroy(); return reject(Object.assign(new Error('redirect_refused'), { code: 'redirect_refused' })); }
        res.on('data', chunk => {
          try { used += chunk.length; budget.check(); if (used > replyCap) fail('response_bytes_exceeded'); chunks.push(chunk); }
          catch (e) { req.destroy(e); }
        });
        res.once('error', reject); res.once('aborted', () => reject(Object.assign(new Error('reply_lost'), { code: 'reply_lost' })));
        res.once('end', () => {
          try {
            const body = parseJson(Buffer.concat(chunks), () => budget.check());
            if (res.statusCode >= 400) return reject(Object.assign(new Error(body.reason || 'service_refused'), { code: body.reason || 'service_refused', nextAction: body.nextAction || null }));
            if (body.packet) verifyPacket(body.packet);
            if (body.current) verifyPacket(body.current);
            resolve(body);
          } catch (e) { reject(e); }
        });
      });
    req.once('error', reject); req.end(bytes);
  }), () => req?.destroy()); }
  catch(error){error.remoteAttempted=Boolean(req);throw error;}
  return result;
}
