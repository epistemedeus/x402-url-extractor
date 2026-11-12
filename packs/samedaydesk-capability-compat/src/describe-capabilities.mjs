import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compareInstalledVsHosted } from "./acquisition.mjs";
import { FREE_PAGE_CHANGE, OFFICIAL_CLIENT_NEGOTIATION, PIN, UNKNOWN_TOOL_RECOVERY, mapClientSdk } from "./map.mjs";
import {
  detectPinRefusal,
  recoverToSupportedProtocol,
  recoverUnknownTool,
  throwIfAborted,
} from "./probe.mjs";
import { createWatchedFetch, noPaymentSignature } from "./watch.mjs";

export const PREVIEW_SCHEMA = "samedaydesk.capability-provider.preview.v1";
export const DIAGNOSTIC_SCHEMA = "samedaydesk.cli.diagnostic.v1";
export const ENVELOPE_MAX_BYTES = 64 * 1024;

export const ENV_PROTOCOL_KEY = "SAMEDAYDESK_MCP_PROTOCOL";

export const RECOVERY_INSTRUCTIONS = Object.freeze({
  endpoint_unreachable: "Retry the loopback or recorded endpoint. Do not use a public host.",
  protocol_unrecoverable: "Reconnect with protocol 2025-11-25.",
  tool_missing: "Call tools/list and use compare_page_observations.",
  response_invalid: "Refuse the result. paymentSignature must be null and the body must match the preview schema.",
  unsupported_client_sdk: "Use client SDK 2.4.0 or 1.32.2.",
});

export const FAILURE_EXIT = Object.freeze({
  endpoint_unreachable: 2,
  protocol_unrecoverable: 8,
  tool_missing: 8,
  response_invalid: 2,
  unsupported_client_sdk: 1,
});

const packDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");
const refusedProtocol = OFFICIAL_CLIENT_NEGOTIATION.refusedProtocol;
const supportedProtocol = OFFICIAL_CLIENT_NEGOTIATION.legacyProtocol;

function isPlainRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function programmerError(message) {
  const error = new Error(message);
  error.name = "DescribeCapabilitiesError";
  error.code = "programmer_error";
  return error;
}

function assertHttpUrl(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw programmerError(`${label} is required as an absolute http(s) URL`);
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw programmerError(`${label} is required as an absolute http(s) URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw programmerError(`${label} is required as an absolute http(s) URL`);
  }
  if (url.username || url.password) {
    throw programmerError(`${label} must not include credentials`);
  }
  return url;
}

function validateRequest(request) {
  if (!isPlainRecord(request)) {
    throw programmerError("describeCapabilities requires a request object");
  }
  assertHttpUrl(request.endpoint, "endpoint");
  if (request.clientSdk !== undefined && typeof request.clientSdk !== "string") {
    throw programmerError("clientSdk must be a string when provided");
  }
  if (request.expectedSource != null) {
    if (!isPlainRecord(request.expectedSource)
      || typeof request.expectedSource.repo !== "string"
      || typeof request.expectedSource.sha !== "string"
      || !request.expectedSource.repo
      || !request.expectedSource.sha) {
      throw programmerError("expectedSource must be { repo: string, sha: string } or null");
    }
  }
  if (request.env !== undefined && !isPlainRecord(request.env)) {
    throw programmerError("env must be a readonly record of string values when provided");
  }
  if (request.signal !== undefined) {
    const signal = request.signal;
    if (!signal || typeof signal !== "object" || typeof signal.aborted !== "boolean") {
      throw programmerError("signal must be an AbortSignal when provided");
    }
  }
  if (request.now !== undefined && typeof request.now !== "function") {
    throw programmerError("now must be a function when provided");
  }
  if (request.fetch !== undefined && typeof request.fetch !== "function") {
    throw programmerError("fetch must be a function when provided");
  }
}

export function protocolFromEnv(env) {
  if (!isPlainRecord(env)) return null;
  const value = env[ENV_PROTOCOL_KEY];
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

export function formatObservedAt(now) {
  const date = typeof now === "function" ? now() : new Date();
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) {
    throw programmerError("now must return a Date");
  }
  return date.toISOString();
}

export function endpointKind(url) {
  const host = String(url.hostname || "").toLowerCase();
  if (host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]") return "loopback";
  return "recorded";
}

export function inputSchemaDigest(schema) {
  if (!schema || typeof schema !== "object") return null;
  const hex = createHash("sha256").update(JSON.stringify(schema), "utf8").digest("hex");
  return `sha256:${hex}`;
}

export function installedVsHostedFacts(comparison) {
  return {
    installedBytes: comparison?.installed?.bytes ?? comparison?.bytes?.installed ?? 0,
    hostedBytes: comparison?.hosted?.bytes ?? comparison?.bytes?.hosted ?? 0,
    hostedSha: comparison?.hosted?.sha ?? PIN.sourcePins.neomorphic.sha,
    network: false,
    liveClaimed: false,
  };
}

function failureEnvelope(provider, code, retryable, recovery, observedAt) {
  return {
    schema: PREVIEW_SCHEMA,
    ok: false,
    observedAt,
    provider,
    error: {
      code,
      retryable,
      recovery: {
        action: recovery.action,
        instruction: recovery.instruction || RECOVERY_INSTRUCTIONS[code],
      },
    },
    paymentSignature: null,
  };
}

function isUnreachable(error) {
  const code = error?.cause?.code || error?.code;
  if (["ECONNREFUSED", "ENOTFOUND", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "EAI_AGAIN"].includes(code)) {
    return true;
  }
  const message = String(error?.message || error);
  return /fetch failed|ECONNREFUSED|ENOTFOUND|network|socket hang up|connect ECONN|AggregateError/i.test(message);
}

function isProgrammer(error) {
  return error?.code === "programmer_error" || error?.name === "DescribeCapabilitiesError";
}

function boundEnvelope(envelope, provider, observedAt = envelope?.observedAt) {
  const serialized = JSON.stringify(envelope);
  if (Buffer.byteLength(serialized, "utf8") <= ENVELOPE_MAX_BYTES) return envelope;
  return failureEnvelope(provider, "response_invalid", false, {
    action: "none",
    instruction: RECOVERY_INSTRUCTIONS.response_invalid,
  }, observedAt);
}

export function exitCodeForEnvelope(envelope) {
  if (envelope?.paymentSignature != null) return FAILURE_EXIT.response_invalid;
  if (envelope?.ok) return 0;
  return FAILURE_EXIT[envelope?.error?.code] ?? 1;
}

export function diagnosticForEnvelope(envelope, exit = exitCodeForEnvelope(envelope)) {
  const code = envelope?.paymentSignature != null
    ? "response_invalid"
    : envelope?.error?.code ?? (envelope?.ok ? "ok" : "internal");
  return { schema: DIAGNOSTIC_SCHEMA, code, exit };
}

/**
 * Adapter defined by SameDayDesk CLI SCHEMA.md section 10 (relay 79ddb381),
 * plus confirmed `fetch?: typeof fetch` and top-level `observedAt`.
 * This function never reads process.env and never writes to stdout or stderr.
 */
export async function describeCapabilities(request) {
  validateRequest(request);
  const { endpoint, clientSdk, expectedSource, env, signal, now, fetch } = request;
  throwIfAborted(signal);
  const observedAt = formatObservedAt(now);

  const provider = { package: PIN.package, version: PIN.version };
  const merchant = PIN.sourcePins.merchant;
  const sourceChanged = Boolean(expectedSource?.sha && expectedSource.sha !== merchant.sha);
  const envProtocol = protocolFromEnv(env);

  let mapped;
  try {
    mapped = mapClientSdk(clientSdk || OFFICIAL_CLIENT_NEGOTIATION.lockedCurrentClient);
  } catch {
    return boundEnvelope(failureEnvelope(provider, "unsupported_client_sdk", false, {
      action: "none",
      instruction: RECOVERY_INSTRUCTIONS.unsupported_client_sdk,
    }, observedAt), provider);
  }

  const requestedProtocol = envProtocol
    || (mapped.kind === "current" ? refusedProtocol : supportedProtocol);
  const comparison = compareInstalledVsHosted({ packDirectory });
  const installedVsHosted = installedVsHostedFacts(comparison);
  const url = new URL(endpoint);
  const changes = [];

  if (sourceChanged) {
    changes.push({
      kind: "source_version_changed",
      detected: true,
      recovered: false,
      evidence: { expectedSha: expectedSource.sha, installedSha: merchant.sha, repo: merchant.repo },
      recovery: { action: "re_pin" },
    });
  }

  if (envProtocol) {
    changes.push({
      kind: "env_changed",
      detected: true,
      recovered: envProtocol === refusedProtocol,
      evidence: { requestedProtocol: envProtocol },
      recovery: {
        action: envProtocol === refusedProtocol ? "reconnect" : "none",
        protocol: supportedProtocol,
      },
    });
  }

  if (clientSdk && mapped.id !== OFFICIAL_CLIENT_NEGOTIATION.lockedCurrentClient) {
    changes.push({
      kind: "client_sdk_changed",
      detected: true,
      recovered: true,
      evidence: { requested: mapped.id, default: OFFICIAL_CLIENT_NEGOTIATION.lockedCurrentClient },
      recovery: { action: "none" },
    });
  }

  const wire = createWatchedFetch(new URL(endpoint).origin, { fetch });
  const sessionOpts = { endpoint, clientSdk: mapped.id, fetch: wire.fetch, signal };
  const paymentSeen = () => !noPaymentSignature(wire.events);

  try {
    throwIfAborted(signal);
    let pinResult = null;
    if (mapped.kind === "current") {
      pinResult = await detectPinRefusal({
        ...sessionOpts,
        protocol: envProtocol || refusedProtocol,
      });
      throwIfAborted(signal);
      if (pinResult.paymentSignature != null || paymentSeen()) {
        return boundEnvelope(failureEnvelope(provider, "response_invalid", false, {
          action: "none",
          instruction: RECOVERY_INSTRUCTIONS.response_invalid,
        }, observedAt), provider);
      }
    }

    let recovered;
    try {
      recovered = await recoverToSupportedProtocol(sessionOpts);
    } catch (error) {
      throwIfAborted(signal, error);
      if (isUnreachable(error)) {
        return boundEnvelope(failureEnvelope(provider, "endpoint_unreachable", true, {
          action: "none",
          instruction: RECOVERY_INSTRUCTIONS.endpoint_unreachable,
        }, observedAt), provider);
      }
      return boundEnvelope(failureEnvelope(provider, "protocol_unrecoverable", false, {
        action: "reconnect",
        instruction: RECOVERY_INSTRUCTIONS.protocol_unrecoverable,
      }, observedAt), provider);
    }

    if (pinResult?.pinRefused) {
      changes.push({
        kind: "protocol_refused",
        detected: true,
        recovered: Boolean(recovered.recovered),
        evidence: {
          sdkErrorCode: pinResult.code ?? OFFICIAL_CLIENT_NEGOTIATION.pinClientErrorCode,
          httpStatus: pinResult.discover?.status ?? OFFICIAL_CLIENT_NEGOTIATION.discoverHttpStatus,
          jsonRpcCode: pinResult.discover?.errorCode ?? OFFICIAL_CLIENT_NEGOTIATION.discoverJsonRpcCode,
        },
        recovery: { action: "reconnect", protocol: supportedProtocol },
      });
      if (!recovered.recovered) {
        try { await recovered.session.close(); } catch { /* already closed */ }
        return boundEnvelope(failureEnvelope(provider, "protocol_unrecoverable", false, {
          action: "reconnect",
          instruction: RECOVERY_INSTRUCTIONS.protocol_unrecoverable,
        }, observedAt), provider);
      }
    }

    let unknown;
    try {
      unknown = await recoverUnknownTool({ session: recovered.session, signal });
    } catch (error) {
      try { await recovered.session.close(); } catch { /* already closed */ }
      throwIfAborted(signal, error);
      if (isUnreachable(error)) {
        return boundEnvelope(failureEnvelope(provider, "endpoint_unreachable", true, {
          action: "none",
          instruction: RECOVERY_INSTRUCTIONS.endpoint_unreachable,
        }, observedAt), provider);
      }
      return boundEnvelope(failureEnvelope(provider, "tool_missing", false, {
        action: "list_tools",
        instruction: RECOVERY_INSTRUCTIONS.tool_missing,
      }, observedAt), provider);
    }
    try { await recovered.session.close(); } catch { /* already closed */ }

    if (paymentSeen()) {
      return boundEnvelope(failureEnvelope(provider, "response_invalid", false, {
        action: "none",
        instruction: RECOVERY_INSTRUCTIONS.response_invalid,
      }, observedAt), provider);
    }

    changes.push({
      kind: "unknown_tool",
      detected: true,
      recovered: true,
      evidence: { jsonRpcCode: UNKNOWN_TOOL_RECOVERY.jsonRpcCode },
      recovery: { action: "list_tools", nextMethod: UNKNOWN_TOOL_RECOVERY.nextMethod },
    });

    const body = unknown.body;
    if (body?.charged === true) {
      return boundEnvelope(failureEnvelope(provider, "response_invalid", false, {
        action: "none",
        instruction: RECOVERY_INSTRUCTIONS.response_invalid,
      }, observedAt), provider);
    }
    if (!unknown.listed.includes(FREE_PAGE_CHANGE.tool)) {
      return boundEnvelope(failureEnvelope(provider, "tool_missing", false, {
        action: "list_tools",
        instruction: RECOVERY_INSTRUCTIONS.tool_missing,
      }, observedAt), provider);
    }

    const toolEntry = (unknown.tools || []).find((tool) => tool.name === FREE_PAGE_CHANGE.tool);
    const envelope = {
      schema: PREVIEW_SCHEMA,
      ok: true,
      observedAt,
      provider,
      source: {
        repo: merchant.repo,
        sha: merchant.sha,
        changed: sourceChanged,
      },
      endpoint: {
        url: endpoint,
        kind: endpointKind(url),
        liveClaimed: false,
      },
      protocol: {
        requested: requestedProtocol,
        negotiated: recovered.protocol || supportedProtocol,
        supported: [supportedProtocol],
      },
      capabilities: [
        {
          tool: FREE_PAGE_CHANGE.tool,
          path: FREE_PAGE_CHANGE.path,
          effect: "read",
          charged: false,
          auth: "none",
          inputSchemaDigest: inputSchemaDigest(toolEntry?.inputSchema),
        },
      ],
      preview: {
        tool: FREE_PAGE_CHANGE.tool,
        charged: false,
        usefulResult: "page-change-verdict",
        verdict: body?.report?.verdict ?? null,
      },
      changes,
      installedVsHosted,
      paymentSignature: null,
    };
    return boundEnvelope(envelope, provider);
  } catch (error) {
    throwIfAborted(signal, error);
    if (isProgrammer(error)) throw error;
    if (isUnreachable(error)) {
      return boundEnvelope(failureEnvelope(provider, "endpoint_unreachable", true, {
        action: "none",
        instruction: RECOVERY_INSTRUCTIONS.endpoint_unreachable,
      }, observedAt), provider);
    }
    throw error;
  }
}
