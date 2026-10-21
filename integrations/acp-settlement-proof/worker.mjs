import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createOperatingReceiver, retainedJobIds, validJobId } from './operating.mjs';
import { PROVIDER, OFFERING_ID } from './fulfill.mjs';
const check = (ok, message) => { if (!ok) throw Error(message); };

export function receiveWorkerConfig(config) {
  check(config?.provider === PROVIDER && config.offeringId === OFFERING_ID && config.agentId === '019fef7a-3b3e-7a67-b825-6abfd8ba0e17' && config.selectionPolicy === 'provider-name-terms', 'Explicit original account/offering/policy required');
  for (const name of ['configDirectory', 'workingDirectory', 'journalDirectory']) check(typeof config[name] === 'string' && path.isAbsolute(config[name]), `Explicit absolute ${name} required`);
  check(typeof config.signerId === 'string' && config.signerId.length > 0, 'Explicit signer ID required');
  for (const [key, min, max] of [['runForSeconds', 1, 900], ['maxJobs', 1, 16], ['pollSeconds', 1, 60], ['streamEpochSeconds', 5, 120]]) check(Number.isInteger(config[key]) && config[key] >= min && config[key] <= max, `Finite ${key} required`);
  check(config.declaredMemoryMiB === 2048 && config.nodeHeapMiB === 768, 'Declared 2 GiB/768 MiB workload required');
  return Object.freeze({ ...config });
}

/** One serial productive receiver; hints are coalesced and never used as data.
 * Active REST rows + retained operations are rechecked on every catch-up. */
export async function runWorker({ config, boundary, client, mode, once = false, signal, evidence = () => {}, clock = () => Date.now(), wait = delay }) {
  config = receiveWorkerConfig(config);
  check(['observe', 'serve'].includes(mode), 'Explicit worker mode required');
  const deadline = clock() + config.runForSeconds * 1000;
  const stopped = () => signal?.aborted || clock() >= deadline;
  const receiver = createOperatingReceiver({ boundary, client, mode, journalDirectory: config.journalDirectory, selectionPolicy: config.selectionPolicy, stopped, evidence, admit(id) {
    if (admitted.has(id)) return true;
    if (admitted.size >= config.maxJobs) return false;
    admitted.add(id); return true;
  } });
  const admitted = new Set(retainedJobIds(config.journalDirectory));
  check(admitted.size <= config.maxJobs, 'Retained job population exceeds finite admission');
  const hints = new Set();
  let hintOverflow = false;
  let events = 0;
  const onHint = entry => {
    events++;
    if (entry?.chainId !== 8453 || !validJobId(entry.onChainJobId)) return;
    if (hints.size >= 64) { hintOverflow = true; return; }
    hints.add(entry.onChainJobId);
  };
  async function catchup() {
    const rows = await boundary.api.getActiveJobs();
    check(Array.isArray(rows) && rows.length <= 256, 'Bounded active-job array required');
    const ids = new Set([...retainedJobIds(config.journalDirectory), ...hints]);
    hints.clear();
    for (const row of rows) if (row.chainId === 8453 && validJobId(row.onChainJobId)) ids.add(row.onChainJobId);
    check(ids.size <= 4096, 'Catch-up input exceeds bound');
    evidence({ stage: 'catchup', activeRows: rows.length, candidateJobs: ids.size, streamHints: events, hintOverflow, coverage: 'documented-active-array-plus-retained; pagination/global-history-unknown' });
    events = 0; hintOverflow = false;
    for (const id of ids) {
      if (stopped()) break;
      try { const result = await receiver.run(id); evidence({ stage: 'operation', jobId: id, state: result.state }); }
      catch { evidence({ stage: 'job_refused_or_unavailable', jobId: id }); }
    }
  }
  let connected = false;
  let epochAt = 0;
  async function recover() {
    try { await catchup(); }
    catch (error) {
      evidence({ stage: 'catchup_unavailable', coverage: 'unknown' });
      if (once) throw error;
    }
  }
  try {
    await boundary.receivePolicy();
    // Startup REST recovery is useful even when the stream cannot connect.
    await recover();
    if (once) return;
    while (!stopped()) {
      if (!connected || clock() - epochAt >= config.streamEpochSeconds * 1000) {
        if (connected) await boundary.disconnect();
        connected = false;
        boundary.onHint(onHint);
        try {
          await boundary.connect(() => { evidence({ stage: 'stream_connected' }); });
          connected = true; epochAt = clock();
        } catch { evidence({ stage: 'stream_unavailable' }); }
        if (!stopped()) await recover();
      }
      if (stopped()) break;
      try { await wait(Math.min(config.pollSeconds * 1000, Math.max(1, deadline - clock())), undefined, { signal }); } catch { break; }
      if (!stopped()) await recover();
    }
  } finally {
    await boundary.disconnect();
    evidence({ stage: 'stopped', admittedJobs: admitted.size });
  }
}

/** Installed only inside the dedicated worker process. SDK HTTP reads and SSE
 * share actual byte/time limits. No merchant/global host settings are changed. */
export function installNetworkBounds({ signal, serverOrigin = 'https://api.acp.virtuals.io', rpcOrigin }) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
    check([serverOrigin, rpcOrigin].filter(Boolean).includes(url.origin), 'Undeclared receiver network origin');
    const stream = ['/chats/stream', '/wallets/stream'].includes(url.pathname);
    const headerStop = new AbortController();
    const headerTimer = stream ? setTimeout(() => headerStop.abort(), 15000) : null;
    const signals = [signal, init.signal, stream ? headerStop.signal : AbortSignal.timeout(15000)].filter(Boolean);
    let response;
    try { response = await original(input, { ...init, redirect: 'error', signal: AbortSignal.any(signals) }); }
    finally { clearTimeout(headerTimer); }
    if (!stream) check(response.ok || response.status === 401, 'Receiver HTTP request failed');
    if (stream) {
      let bytes = 0;
      const body = response.body?.pipeThrough(new TransformStream({ transform(chunk, controller) {
        bytes += chunk.byteLength;
        check(bytes <= 4 * 1024 * 1024, 'Finite stream byte budget exhausted');
        controller.enqueue(chunk);
      } }));
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    }
    const reader = response.body?.getReader();
    const chunks = []; let bytes = 0;
    if (reader) {
      try { while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; check(bytes <= 1024 * 1024, 'Receiver response exceeds byte bound'); chunks.push(part.value); } }
      catch (error) { await reader.cancel().catch(() => {}); throw error; }
    }
    return new Response(Buffer.concat(chunks), { status: response.status, statusText: response.statusText, headers: response.headers });
  };
  return () => { globalThis.fetch = original; };
}
