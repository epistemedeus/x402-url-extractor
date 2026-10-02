import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { performance } from "node:perf_hooks";
export const MAX_RAW_INPUT_BYTES = 1024 * 1024;
export const INPUT_DEADLINE_MS = 5000;
function failure(code) { return Object.assign(new Error(code), { code }); }
export async function readInputText(file, { stream = process.stdin, maxBytes = MAX_RAW_INPUT_BYTES, deadlineMs = INPUT_DEADLINE_MS } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_RAW_INPUT_BYTES ||
      !Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > INPUT_DEADLINE_MS) throw failure("input_limits_invalid");
  if (file === "-") return new Promise((resolve, reject) => {
    const chunks=[]; let bytes=0, settled=false, timer;
    const finish=(error)=> {
      if(settled) return; settled=true; clearTimeout(timer);
      stream.off("data", data); stream.off("end", end); stream.off("error", fail); stream.pause();
      if(error) reject(error); else resolve(Buffer.concat(chunks,bytes).toString("utf8"));
    };
    const data=(raw)=> {const chunk=Buffer.isBuffer(raw)?raw:Buffer.from(raw);bytes+=chunk.length;
      if(bytes>maxBytes) finish(failure("input_too_large")); else chunks.push(chunk);};
    const end=()=>finish(null), fail=(error)=>finish(error);
    timer=setTimeout(()=>finish(failure("input_deadline_exceeded")),deadlineMs);
    stream.on("data",data);stream.once("end",end);stream.once("error",fail);
    if(stream.readableEnded) finish(null); else stream.resume();
  });
  const started=performance.now();
  const handle=await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat=await handle.stat();
    if(!stat.isFile()) throw failure("input_not_regular_file");
    if(stat.size>maxBytes) throw failure("input_too_large");
    const chunks=[];let total=0;
    for(;;){
      if(performance.now()-started>deadlineMs) throw failure("input_deadline_exceeded");
      const buffer=Buffer.alloc(Math.min(64*1024,maxBytes+1-total));
      const {bytesRead}=await handle.read(buffer,0,buffer.length,null);
      if(performance.now()-started>deadlineMs) throw failure("input_deadline_exceeded");
      if(!bytesRead)break;total+=bytesRead;
      if(total>maxBytes)throw failure("input_too_large");chunks.push(buffer.subarray(0,bytesRead));
    }
    return Buffer.concat(chunks,total).toString("utf8");
  } finally {await handle.close();}
}
