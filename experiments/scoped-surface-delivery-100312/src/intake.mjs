import { CONCERN_DECIDE, LIMITS, RULE_IDS, TASK_ID } from "./pins.mjs";
import { containsSecret } from "./redact.mjs";

const REQUEST_KEYS = new Set(["taskId", "callerId", "concern", "files", "limits", "contextId"]);
const CONCERN_KEYS = new Set(["id", "statement"]);
const FILE_KEYS_TEXT = new Set(["path", "text"]);
const FILE_KEYS_BYTES = new Set(["path", "encoding", "data"]);
const LIMIT_KEYS = new Set(["deadlineMs", "maxOutputBytes"]);
const BLOCKED = new Set([
  "accepted", "command", "shell", "gitUrl", "url", "install", "child", "childScript",
  "executable", "report", "verdict", "payment", "paymentReceipt", "txHash", "grant",
  "ownerId", "contributorEffortMs", "blanketSafetyScore",
]);

const ELF = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);
const MZ = Buffer.from([0x4d, 0x5a]);
const MACHO64 = Buffer.from([0xcf, 0xfa, 0xed, 0xfe]);
const MACHO32 = Buffer.from([0xfe, 0xed, 0xfa, 0xce]);
const FAT = Buffer.from([0xca, 0xfe, 0xba, 0xbe]);

function sameKeys(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.every((key) => allowed.has(key));
}

function looksBinary(bytes) {
  if (bytes.includes(0)) return true;
  if (bytes.length < 2) return false;
  const head = bytes.subarray(0, 4);
  return head.subarray(0, 4).equals(ELF)
    || head.subarray(0, 4).equals(MACHO64)
    || head.subarray(0, 4).equals(MACHO32)
    || head.subarray(0, 4).equals(FAT)
    || bytes.subarray(0, 2).equals(MZ);
}

function normalizePath(input) {
  if (typeof input !== "string" || input.length === 0 || input.length > LIMITS.maxPathLength) {
    return { error: "bad_path" };
  }
  if (input.includes("\\") || input.includes("%") || input.startsWith("/") || /^[A-Za-z]:/.test(input)) {
    return { error: "path_traversal" };
  }
  if (/[\u0000-\u001f\u007f]/.test(input)) return { error: "control_path" };
  const parts = input.split("/");
  if (parts.some((part) => part === "" || part === "." || part === ".." || part === "node_modules" || part === ".git")) {
    return { error: "path_traversal" };
  }
  const normalized = parts.join("/").normalize("NFC");
  if (normalized !== input.normalize("NFC")) return { error: "path_collision" };
  if (containsSecret(normalized)) return { error: "secret_in_name" };
  return { path: normalized };
}

function fileBytes(entry) {
  const keys = new Set(Object.keys(entry));
  const textMode = [...keys].every((key) => FILE_KEYS_TEXT.has(key)) && keys.has("path") && keys.has("text");
  const byteMode = [...keys].every((key) => FILE_KEYS_BYTES.has(key)) && entry.encoding === "base64";
  if (!textMode && !byteMode) return { error: "bad_file" };
  const pathResult = normalizePath(entry.path);
  if (pathResult.error) return pathResult;
  let bytes;
  if (textMode) {
    if (typeof entry.text !== "string") return { error: "bad_file" };
    bytes = Buffer.from(entry.text, "utf8");
  } else {
    if (typeof entry.data !== "string" || !/^[A-Za-z0-9+/=\s]+$/.test(entry.data)) return { error: "bad_file" };
    bytes = Buffer.from(entry.data.replace(/\s/g, ""), "base64");
  }
  if (bytes.length > LIMITS.maxFileBytes) return { error: "file_too_large" };
  if (looksBinary(bytes)) return { error: "binary_rejected" };
  return { path: pathResult.path, bytes };
}

export function validateInventory(request) {
  const errors = [];
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    return { ok: false, errors: ["malformed"] };
  }
  const presentBlocked = Object.keys(request).filter((key) => BLOCKED.has(key));
  if (presentBlocked.length) return { ok: false, errors: ["command_rejected"] };
  if (!sameKeys(request, REQUEST_KEYS)) return { ok: false, errors: ["unknown_field"] };
  if (!TASK_ID.test(request.taskId || "") || !TASK_ID.test(request.callerId || "")) {
    errors.push("bad_identity");
  }
  if (request.contextId !== undefined && !TASK_ID.test(request.contextId)) errors.push("bad_context");
  const concern = request.concern;
  if (!sameKeys(concern, CONCERN_KEYS)) errors.push("bad_concern");
  else {
    const id = concern.id;
    const known = id === CONCERN_DECIDE || (typeof id === "string" && id.startsWith("rule:") && RULE_IDS.includes(id.slice(5))) || id === "any-danger";
    if (!known) errors.push("bad_concern");
    if (typeof concern.statement !== "string" || concern.statement.length === 0 || concern.statement.length > LIMITS.maxStatement) {
      errors.push("bad_concern");
    } else if (/[\u0000-\u001f\u007f]/.test(concern.statement) || containsSecret(concern.statement)) {
      errors.push("secret_in_request");
    }
  }
  if (!Array.isArray(request.files) || request.files.length === 0 || request.files.length > LIMITS.maxFiles) {
    errors.push("bad_files");
  }
  let deadlineMs = LIMITS.deadlineMs;
  let maxOutputBytes = LIMITS.maxOutputBytes;
  if (request.limits !== undefined) {
    if (!sameKeys(request.limits, LIMIT_KEYS)) errors.push("bad_limits");
    else {
      if (request.limits.deadlineMs !== undefined) {
        if (!Number.isInteger(request.limits.deadlineMs) || request.limits.deadlineMs < LIMITS.minDeadlineMs || request.limits.deadlineMs > LIMITS.maxDeadlineMs) {
          errors.push("bad_limits");
        } else deadlineMs = request.limits.deadlineMs;
      }
      if (request.limits.maxOutputBytes !== undefined) {
        if (!Number.isInteger(request.limits.maxOutputBytes) || request.limits.maxOutputBytes < 32 || request.limits.maxOutputBytes > LIMITS.maxOutputBytes) {
          errors.push("bad_limits");
        } else maxOutputBytes = request.limits.maxOutputBytes;
      }
    }
  }
  const files = [];
  const seen = new Set();
  let total = 0;
  if (Array.isArray(request.files)) {
    for (const entry of request.files) {
      if (!entry || typeof entry !== "object") {
        errors.push("bad_file");
        continue;
      }
      const decoded = fileBytes(entry);
      if (decoded.error) {
        errors.push(decoded.error);
        continue;
      }
      if (seen.has(decoded.path)) errors.push("path_collision");
      seen.add(decoded.path);
      total += decoded.bytes.length;
      files.push(decoded);
    }
  }
  if (total > LIMITS.maxAggregateBytes) errors.push("aggregate_too_large");
  if (errors.length) return { ok: false, errors: [...new Set(errors)] };
  return {
    ok: true,
    errors: [],
    value: {
      taskId: request.taskId,
      callerId: request.callerId,
      contextId: request.contextId || request.taskId,
      concern: { id: request.concern.id, statement: request.concern.statement },
      files,
      deadlineMs,
      maxOutputBytes,
      totalBytes: total,
    },
  };
}

export function inputFailure(errors) {
  return {
    scanPerformed: false,
    authority: "none",
    exitCode: 64,
    scannerVerdict: null,
    scannerExit: null,
    blanketSafetyScore: null,
    universalGuarantee: false,
    inputError: { code: "input_error", errors },
  };
}
