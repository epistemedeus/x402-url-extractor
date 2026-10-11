import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// Disposable JSON boundary for one MCP tool result.
// A refusal stays a refusal. An unknown shape stays unknown.
// Unsafe keys are rejected before they become a stored receipt.

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
export const MAX_RECEIPT_BYTES = 4096;
export const EVIDENCE_KEY = "samedaydesk/evidence";

function refusal(code) {
  return { ok: false, code, receipt: null };
}

function unsafe(value, seen) {
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const keys = Object.keys(value);
  if (keys.some((key) => UNSAFE_KEYS.has(key))) return true;
  return keys.some((key) => unsafe(value[key], seen));
}

export function readReceipt(raw) {
  if (typeof raw !== "string") return refusal("unsupported_shape");
  if (Buffer.byteLength(raw) > MAX_RECEIPT_BYTES) return refusal("oversized");
  const prototypeMarker = Object.prototype.polluted;
  let value;
  try {
    value = JSON.parse(raw, (key, item) => {
      if (UNSAFE_KEYS.has(key)) {
        const error = new Error("unsafe_key");
        error.code = "unsafe_key";
        throw error;
      }
      return item;
    });
  } catch (error) {
    if (Object.prototype.polluted !== prototypeMarker) delete Object.prototype.polluted;
    if (error?.code === "unsafe_key") return refusal("unsafe_key");
    return refusal("malformed_json");
  }
  if (Object.prototype.polluted !== prototypeMarker) {
    delete Object.prototype.polluted;
    return refusal("unsafe_key");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return refusal("unsupported_shape");
  if (unsafe(value, new Set())) return refusal("unsafe_key");
  return { ok: true, code: null, receipt: value };
}

export function outcomeClass(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return "unknown";
  if (result.transport === "failed") return "transport_failure";
  if (result.protocolError === true) return "protocol_error";
  if (result.isError === true) return "tool_refusal";
  const content = Array.isArray(result.content) ? result.content : null;
  const structured = result.structuredContent;
  const structuredObject = Boolean(structured) && typeof structured === "object" && !Array.isArray(structured);
  if (content || structuredObject) return "useful";
  return "unknown";
}

export function evidenceOf(result) {
  const meta = result?._meta?.[EVIDENCE_KEY];
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  if (typeof meta.callId !== "string" || typeof meta.taskId !== "string" || typeof meta.evidenceId !== "string") {
    return null;
  }
  return { callId: meta.callId, taskId: meta.taskId, evidenceId: meta.evidenceId };
}

export function remember(index, record) {
  const evidence = evidenceOf(record?.result);
  const callId = evidence?.callId || null;
  if (!callId) return { stored: false, code: "evidence_absent", kept: null };
  const existing = index[callId];
  if (existing) return { stored: false, code: "duplicate_receipt", kept: existing };
  index[callId] = record;
  return { stored: true, code: null, kept: record };
}

export function classifyStore(raw) {
  const read = readReceipt(raw);
  if (!read.ok) return read;
  const records = read.receipt.records;
  if (!records || typeof records !== "object" || Array.isArray(records)) return refusal("unsupported_shape");
  const classes = {};
  for (const [callId, record] of Object.entries(records)) {
    const evidence = evidenceOf(record?.result);
    classes[callId] = {
      class: outcomeClass(record?.result),
      evidenceCallId: evidence?.callId || null,
      taskId: evidence?.taskId || null,
      associated: evidence?.callId === callId,
    };
  }
  return { ok: true, code: null, classes };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const classified = classifyStore(await readFile(process.argv[2], "utf8"));
  if (!classified.ok) {
    process.stderr.write(`${classified.code}\n`);
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify(classified.classes)}\n`);
}
