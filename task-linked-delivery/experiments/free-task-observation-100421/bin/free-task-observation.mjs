#!/usr/bin/env node
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { budget, fail, LIMITS, outputJson, parseJson, readBounded } from '../vendor/bounds.mjs';
import { exportSource, parseNdjson } from '../src/export.mjs';
import { projectBundle, replayRetained, retainReport } from '../src/project.mjs';

const args={};const command=process.argv[2];
try {
  for(let i=3;i<process.argv.length;i+=2) {
    const key=process.argv[i],value=process.argv[i+1];
    if(!['--bundle','--receipt','--retain','--prior','--input','--metadata','--format','--deadline-ms'].includes(key)||value===undefined||args[key]!==undefined) fail('argument_rejected');
    args[key]=value;
  }
  const ms=args['--deadline-ms']===undefined?5000:Number(args['--deadline-ms']);
  const tick=budget(ms),timer=setTimeout(()=>{process.stderr.write('deadline_exceeded\n');process.exit(2);},ms);
  async function read(file) {
    if(!file) fail('input_required');
    if(file!=='-') return readBounded(path.resolve(file),tick);
    const chunks=[];let total=0;
    for await(const b of process.stdin) {tick();total+=b.length;if(total>LIMITS.fileBytes) fail('input_bytes_exceeded');chunks.push(b);}
    return Buffer.concat(chunks);
  }
  async function retain(file,value) {
    if(!file||file==='-') fail('output_path_required');
    const handle=await open(path.resolve(file),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try {await handle.writeFile(outputJson(value));await handle.sync();} finally {await handle.close();}
  }
  let value;
  if(command==='query') {
    const bundle=parseJson(await read(args['--bundle']),tick);
    const prior=args['--prior']?replayRetained(parseJson(await read(args['--prior']),tick)):null;
    value=projectBundle(bundle,{tick,priorReportId:prior?.reportId||null});
    if(args['--retain']) await retain(args['--retain'],retainReport(bundle,value));
  } else if(command==='replay') value=replayRetained(parseJson(await read(args['--receipt']),tick));
  else if(command==='export') {
    const bytes=await read(args['--input']),metadata=parseJson(await read(args['--metadata']),tick);
    const parsed=args['--format']==='ndjson'?parseNdjson(bytes,tick):{rows:parseJson(bytes,tick),malformed:0,torn:0};
    value=exportSource({metadata,records:parsed.rows,rawBytes:bytes,malformed:parsed.malformed,torn:parsed.torn});
  } else fail('command_rejected');
  tick();process.stdout.write(outputJson(value));clearTimeout(timer);
} catch(e) {process.stderr.write((e.code||'consumer_failed')+'\n');process.exit(2);}
