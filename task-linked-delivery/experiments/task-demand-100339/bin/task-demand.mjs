#!/usr/bin/env node
import { constants } from 'node:fs';
import { open, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { LIMITS, budget, fail, outputJson, parseJson, readBounded } from '../src/bounds.mjs';
import { projectBundle, retainReport, replayRetained } from '../src/project.mjs';
import { parseNdjson } from '../src/export.mjs';
import { exportObserverSource } from '../src/observer-integration.mjs';

async function stdinBytes(tick) {
  const chunks = []; let total = 0;
  for await (const part of process.stdin) {
    tick(); total += part.length;
    if (total > LIMITS.fileBytes) fail('input_bytes_exceeded');
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}
async function atomicSave(file, bytes) {
  const target = resolve(file), temp = target + '.' + randomUUID() + '.tmp';
  let handle;
  try {
    handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
    await rename(temp, target);
  } finally { if (handle) await handle.close(); await unlink(temp).catch(() => {}); }
}
async function main() {
  const [command, ...argv] = process.argv.slice(2), args = {};
  const allowed = { query: ['bundle','question','retain','prior','deadline-ms'], replay: ['receipt','deadline-ms'], export: ['input','metadata','format','out','deadline-ms'] }[command];
  if (!allowed) fail('usage_query_replay_export');
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    if (!argv[i].startsWith('--') || !allowed.includes(key) || args[key] !== undefined || argv[i+1] === undefined) fail('argument_rejected');
    args[key] = argv[i+1];
  }
  const ms = args['deadline-ms'] ? Number(args['deadline-ms']) : LIMITS.deadlineMs;
  const tick = budget(ms);
  const hard = setTimeout(() => { process.stderr.write('{"error":"deadline_exceeded"}\n'); process.exit(2); }, ms);
  let total = 0, usedStdin = false;
  const read = async file => {
    if (!file) fail('required_input_missing');
    if (file === '-' && usedStdin) fail('stdin_consumed_once');
    if (file === '-') usedStdin = true;
    const bytes = file === '-' ? await stdinBytes(tick) : await readBounded(file,tick);
    total += bytes.length; if (total > LIMITS.totalBytes) fail('total_bytes_exceeded');
    return bytes;
  };
  try {
    let value;
    if (command === 'query') {
      const bundle = parseJson(await read(args.bundle),tick);
      if (args.question) bundle.question = parseJson(await read(args.question),tick);
      let prior = null;
      if (args.prior) prior = replayRetained(parseJson(await read(args.prior),tick),{tick});
      value = projectBundle(bundle,{tick,priorReportId:prior?.reportId || null});
      if (args.retain) {
        if ([args.bundle,args.question,args.prior].some(f => f && f !== '-' && resolve(f) === resolve(args.retain))) fail('retention_overwrites_input');
        await atomicSave(args.retain,outputJson(retainReport(bundle,value)));
      }
    } else if (command === 'replay') value = replayRetained(parseJson(await read(args.receipt),tick),{tick});
    else {
      const metadata = parseJson(await read(args.metadata),tick), rawBytes = await read(args.input);
      if (args.format && !['json','ndjson'].includes(args.format)) fail('format_rejected');
      const parsed = args.format === 'ndjson' ? parseNdjson(rawBytes,tick) : { rows: parseJson(rawBytes,tick), malformed:0,torn:0 };
      value = exportObserverSource({ metadata, records:parsed.rows, rawBytes, malformed:parsed.malformed,torn:parsed.torn },{tick});
      if (args.out) {
        if ([args.metadata,args.input].some(f => f !== '-' && resolve(f) === resolve(args.out))) fail('export_overwrites_input');
        await atomicSave(args.out,outputJson(value));
      }
    }
    tick(); await new Promise((resolve,reject) => process.stdout.write(outputJson(value), e => e ? reject(e) : resolve()));
  } finally { clearTimeout(hard); }
}
main().then(() => process.exit(0)).catch(e => { process.stderr.write(JSON.stringify({error:e.code || 'input_or_io_rejected'}) + '\n'); process.exit(2); });
