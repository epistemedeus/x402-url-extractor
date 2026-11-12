// Caller side of the free compare_page_observations continuation.
// The token is a bearer capability: it is kept in a 0600 file and never
// printed. correlationId is the non-authorizing chain id for measurement.
// Discovery is a separate field and is never read from the token.
// This module does not import merchant source, pay, sign, or fetch pages.
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const FREE_CONTINUATION_META = "samedaydesk/continuation";
export const FREE_COMPARE_TOOL = "compare_page_observations";
export const FREE_CONTINUATION_FILE_SCHEMA = "samedaydesk.free-page-change-continuation.v1";
export const FREE_CORRELATION_RE = /^ae:corr:v1:[A-Za-z0-9_-]{22}$/;
const TOKEN_RE = /^pc1\.[A-Za-z0-9_-]{16,900}\.[A-Za-z0-9_-]{43}$/;
const DISCOVERY_SOURCES = new Set(["a2a", "mcp", "cli", "llms", "skill", "registry", "other"]);
const FILE_MAX_BYTES = 64 * 1024;
const plain = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const fail = (code) => { const error = new Error(code); error.code = code; throw error; };

export function freeObservationDigest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function toolBody(result) {
  if (plain(result?.structuredContent)) return result.structuredContent;
  const text = result?.content?.find?.((item) => item?.type === "text")?.text;
  if (typeof text !== "string") return null;
  try { return JSON.parse(text); } catch { return null; }
}

/** Read the continuation from a successful result. Never returns page data. */
export function readFreeContinuation(result) {
  if (result?.isError === true) return { present: false };
  const continuation = toolBody(result)?.continuation;
  if (!plain(continuation) || continuation.tool !== FREE_COMPARE_TOOL
    || typeof continuation.token !== "string" || !TOKEN_RE.test(continuation.token)
    || typeof continuation.correlationId !== "string" || !FREE_CORRELATION_RE.test(continuation.correlationId)) {
    return { present: false };
  }
  return {
    present: true,
    token: continuation.token,
    correlationId: continuation.correlationId,
    step: continuation.step,
    expiresAt: continuation.expiresAt,
    discovery: continuation.discovery,
  };
}

/** Bounded refusal view. Only server-owned codes and cues are copied. */
export function readFreeRefusal(result) {
  if (result?.isError !== true) return null;
  const body = toolBody(result);
  if (!plain(body) || typeof body.code !== "string" || !/^[a-z0-9_]{1,64}$/.test(body.code)) {
    return { code: "unclassified", nextMethod: null, charged: false };
  }
  return {
    code: body.code,
    nextMethod: typeof body.nextMethod === "string" ? body.nextMethod : null,
    nextStep: typeof body.nextStep === "string" ? body.nextStep.slice(0, 240) : null,
    charged: false,
  };
}

export function freeContinuationMeta({ token = null, correlationId = null, save = true, discovery = null } = {}) {
  const request = token ? { token, correlationId, save } : { save: true };
  if (typeof discovery === "string" && DISCOVERY_SOURCES.has(discovery)) request.discovery = discovery;
  return { [FREE_CONTINUATION_META]: request };
}

/** One free call. Old callers can keep calling without _meta. */
export async function callFreeCompare(client, { before, after, fields, token = null, correlationId = null, save = true, discovery = null }) {
  return client.callTool({
    name: FREE_COMPARE_TOOL,
    arguments: { before, after, fields },
    _meta: freeContinuationMeta({ token, correlationId, save, discovery }),
  });
}

/** Public view for stdout, logs, and receipts. Never includes the token. */
export function freeContinuationPublicView(saved) {
  if (!plain(saved)) return null;
  return {
    correlationId: saved.correlationId ?? null,
    step: saved.step ?? null,
    expiresAt: saved.expiresAt ?? null,
    discovery: saved.discovery ?? { status: "unknown", source: null },
    tokenHeld: typeof saved.token === "string",
  };
}

export function freeContinuationFileStore(file) {
  const path = resolve(file);
  return {
    path,
    async load() {
      const bytes = await readFile(path);
      if (bytes.length > FILE_MAX_BYTES) fail("continuation_file_too_large");
      let saved;
      try { saved = JSON.parse(bytes.toString("utf8")); } catch { fail("continuation_file_invalid"); }
      if (!plain(saved) || saved.schema !== FREE_CONTINUATION_FILE_SCHEMA || saved.tool !== FREE_COMPARE_TOOL
        || !Array.isArray(saved.fields) || typeof saved.observationPath !== "string"
        || typeof saved.observationSha256 !== "string") fail("continuation_file_invalid");
      return saved;
    },
    async save(saved) {
      await mkdir(dirname(path), { recursive: true });
      const temp = `${path}.${process.pid}.tmp`;
      const handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC, 0o600);
      try {
        await handle.writeFile(`${JSON.stringify({ schema: FREE_CONTINUATION_FILE_SCHEMA, tool: FREE_COMPARE_TOOL, ...saved })}\n`);
      } finally {
        await handle.close();
      }
      await rename(temp, path);
    },
  };
}
