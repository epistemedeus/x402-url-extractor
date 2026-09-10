const MAX_LIVE_BYTES = 1024 * 1024;

export const OFFICIAL_JSON_URLS = Object.freeze({
  vercel: "https://registry.npmjs.org/vercel",
  claudeCode: "https://registry.npmjs.org/@anthropic-ai/claude-code",
  nodejsEol: "https://endoflife.date/api/nodejs.json",
});

const ALLOWED = new Set(Object.values(OFFICIAL_JSON_URLS));

export function evidenceClassFor(kind, operatorClass) {
  if (operatorClass === "owner-qa" || operatorClass === "live-replay" || operatorClass === "fixture") {
    return operatorClass;
  }
  if (kind === "live_official") return "live-replay";
  return "fixture";
}

export async function fetchOfficialJson(url, { timeoutMs = 15000, fetchImpl = globalThis.fetch } = {}) {
  if (!ALLOWED.has(url)) {
    return { ok: false, code: "url_not_allowlisted", message: `live official GET refused for ${url}` };
  }
  if (typeof fetchImpl !== "function") {
    return { ok: false, code: "fetch_unavailable", message: "fetch implementation is not available" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (response.status >= 300 && response.status < 400) {
      return { ok: false, code: "redirect_refused", message: `redirect refused status ${response.status}`, status: response.status };
    }
    if (!response.ok) {
      const retryable = response.status >= 500 || response.status === 429;
      return {
        ok: false,
        code: "http_error",
        message: `live fetch status ${response.status}`,
        status: response.status,
        retryable,
      };
    }
    const declared = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(declared) && declared > MAX_LIVE_BYTES) {
      return { ok: false, code: "oversize", message: `response exceeds ${MAX_LIVE_BYTES} bytes` };
    }
    const text = await readBoundedText(response, MAX_LIVE_BYTES);
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return { ok: false, code: "invalid_json", message: "live body is not JSON" };
    }
    return { ok: true, url, status: response.status, body, text, bytes: Buffer.byteLength(text) };
  } catch (error) {
    const aborted = error?.name === "AbortError";
    return {
      ok: false,
      code: aborted ? "timed_out" : "fetch_error",
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function readBoundedText(response, maxBytes) {
  if (typeof response.text === "function" && !response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) {
      const error = new Error(`response exceeds ${maxBytes} bytes`);
      error.code = "oversize";
      throw error;
    }
    return text;
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) {
      const error = new Error(`response exceeds ${maxBytes} bytes`);
      error.code = "oversize";
      throw error;
    }
    return text;
  }
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel().catch(() => {});
      const error = new Error(`response exceeds ${maxBytes} bytes`);
      error.code = "oversize";
      throw error;
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

export function defaultOfficialUrl(recipeId) {
  if (recipeId === "npm-cli-release-followup") return OFFICIAL_JSON_URLS.vercel;
  if (recipeId === "agent-cli-release-followup") return OFFICIAL_JSON_URLS.claudeCode;
  if (recipeId === "runtime-eol-watch") return OFFICIAL_JSON_URLS.nodejsEol;
  return null;
}
