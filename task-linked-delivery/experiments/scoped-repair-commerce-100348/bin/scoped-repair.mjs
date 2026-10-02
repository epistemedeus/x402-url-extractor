#!/usr/bin/env node
import { allowance, fileJson, writeJson } from '../src/bounds.mjs';
import { callService } from '../src/client.mjs';
import { evaluateAcceptance, verifyPacket } from '../src/contracts.mjs';

const budget = allowance();
try {
  const [command, ...args] = process.argv.slice(2);
  const flags = new Map();
  for (let i = 0; i < args.length; i += 2) {
    if (!['--service','--request','--packet','--deadline-ms','--max-read-bytes','--max-output-bytes','--max-input-bytes'].includes(args[i]) || !args[i+1] || flags.has(args[i])) throw Object.assign(new Error('usage'), { code: 'usage' });
    flags.set(args[i], args[i+1]);
  }
  const caps = {};
  for (const [flag, key] of [['--deadline-ms','deadlineMs'],['--max-read-bytes','maxReadBytes'],['--max-output-bytes','maxOutputBytes'],['--max-input-bytes','maxInputBytes']]) if (flags.has(flag)) caps[key] = Number(flags.get(flag));
  budget.restrict(caps);
  let result;
  if (command === 'check' && flags.has('--packet')) {
    const supplied = await fileJson(flags.get('--packet'), budget), packet = verifyPacket(supplied.packet || supplied);
    result = { packetId: packet.packetId, predicate: evaluateAcceptance(packet), executionAuthenticity: 'not_established_by_local_checksum', paymentPermitted: false };
  } else if (['deliver','reuse','accept','review'].includes(command) && flags.has('--service') && flags.has('--request')) {
    const request = await fileJson(flags.get('--request'), budget);
    if (request.limits) budget.restrict(request.limits);
    result = await callService(flags.get('--service'), command, request, budget);
  } else throw Object.assign(new Error('request_required'), { code: 'request_required' });
  await writeJson(result, process.stdout, budget);
} catch (error) {
  const reason = /^[a-z][a-z0-9_]{0,80}$/.test(error.code || '') ? error.code : 'client_failed';
  const result = { ok: false, qualification: 'missing_task_input', reason, executed: false, paymentPerformed: false,
    recognizedRevenueAtomic: '0', nextAction: error.nextAction || 'Supply --service https://<received-host> --request <caller.json> (or - for bounded stdin); no request or service is defaulted.' };
  // Errors never echo caller bytes, signatures, environment, paths or secrets.
  try { await writeJson(result, process.stdout, budget); } catch { process.exitCode = 2; }
  process.exitCode = 2;
}
