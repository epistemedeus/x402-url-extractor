import { fail } from "./errors.mjs";

export const KIND = Object.freeze({
  UNPAID_TOOLS_CALL_IS_ERROR: "unpaid_tools_call_is_error",
  HANDLER_RAN_UNPAID: "handler_ran_unpaid",
  PROTOCOL_ERROR: "protocol_error",
  FALSE_SUCCESS: "false_success",
  PAID_SUCCESS: "paid_success",
  SETTLEMENT: "settlement",
  REFUSED: "refused",
  MALFORMED: "malformed",
});

export function textContent(result) {
  const blocks = result?.content;
  if (!Array.isArray(blocks) || blocks.length === 0) return "";
  const first = blocks[0];
  return typeof first?.text === "string" ? first.text : "";
}

export function parseChallengeBody(result) {
  if (result?.structuredContent && typeof result.structuredContent === "object") {
    return result.structuredContent;
  }
  const text = textContent(result);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function isPaymentRequiredBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  if (!Number.isInteger(body.x402Version)) return false;
  if (!Array.isArray(body.accepts)) return false;
  return /payment required/i.test(String(body.error || ""));
}

export function handlerLooksLikeExtract(body) {
  if (!body || typeof body !== "object") return false;
  if (isPaymentRequiredBody(body)) return false;
  return Object.hasOwn(body, "title") || Object.hasOwn(body, "markdown")
    || Object.hasOwn(body, "url") && Object.hasOwn(body, "ok") && body.ok === true;
}

/**
 * Classify a JSON-RPC tools/call response the way CrewAI MCPClient.call_tool_result
 * must: keep isError. HTTP 200 plus content is not paid success.
 */
export function classifyToolsCall({ httpStatus, rpc } = {}) {
  if (!rpc || typeof rpc !== "object") {
    return { kind: KIND.MALFORMED, isError: null, handlerRan: null, reason: "missing json-rpc body" };
  }
  if (Object.hasOwn(rpc, "error")) {
    return {
      kind: KIND.PROTOCOL_ERROR,
      isError: null,
      handlerRan: false,
      reason: "JSON-RPC error is not the CrewAI-visible isError tool result",
      code: rpc.error?.code ?? null,
    };
  }
  const result = rpc.result;
  if (!result || typeof result !== "object") {
    return { kind: KIND.MALFORMED, isError: null, handlerRan: null, reason: "missing result" };
  }
  const isError = result.isError === true;
  const body = parseChallengeBody(result);
  const paymentRequired = isPaymentRequiredBody(body);
  const handlerRan = handlerLooksLikeExtract(body);

  if (result._meta?.["x402/payment-response"] || result._meta?.["samedaydesk/http"]?.headers?.["payment-response"]) {
    return {
      kind: KIND.SETTLEMENT,
      isError,
      handlerRan,
      reason: "payment-response present; this unpaid example must never observe settlement",
    };
  }

  if (isError && paymentRequired && !handlerRan) {
    return {
      kind: KIND.UNPAID_TOOLS_CALL_IS_ERROR,
      isError: true,
      handlerRan: false,
      reason: "unpaid tools/call returned isError:true Payment required; not paid success",
      httpStatus: httpStatus ?? null,
      x402Version: body.x402Version,
      acceptsCount: body.accepts.length,
      error: body.error,
    };
  }

  if (!isError && handlerRan) {
    return {
      kind: KIND.HANDLER_RAN_UNPAID,
      isError: false,
      handlerRan: true,
      reason: "extract handler ran without payment; unpaid gating failed",
    };
  }

  if (!isError && paymentRequired) {
    return {
      kind: KIND.FALSE_SUCCESS,
      isError: false,
      handlerRan: false,
      reason: "Payment required body without isError:true; CrewAI call_tool would treat this as success",
    };
  }

  if (isError) {
    return {
      kind: KIND.UNPAID_TOOLS_CALL_IS_ERROR,
      isError: true,
      handlerRan: false,
      reason: "tools/call isError:true without extract payload",
      httpStatus: httpStatus ?? null,
    };
  }

  return {
    kind: KIND.MALFORMED,
    isError,
    handlerRan,
    reason: "tools/call result was not an unpaid isError challenge and not extract",
  };
}

/**
 * CrewAI MCPClient.call_tool drops isError and returns content only.
 * Classifying that content as paid success is the designated false-success.
 */
export function crewaiCallTool(result) {
  return textContent(result);
}

export function crewaiCallToolResult(result) {
  return {
    content: textContent(result),
    is_error: result?.isError === true,
  };
}

export function classifyDroppedCallTool(content, originalResult) {
  const original = classifyToolsCall({ rpc: { result: originalResult } });
  if (original.kind === KIND.UNPAID_TOOLS_CALL_IS_ERROR) {
    return {
      kind: KIND.FALSE_SUCCESS,
      claimed: KIND.PAID_SUCCESS,
      observed: original.kind,
      reason: "CrewAI MCPClient.call_tool dropped isError; unpaid Payment required content claimed as success",
      contentPreview: String(content).slice(0, 160),
      droppedIsError: true,
      challengeStillPresent: isPaymentRequiredBody(parseChallengeBody(originalResult)),
    };
  }
  return {
    kind: original.kind,
    droppedIsError: true,
    claimed: original.kind,
    observed: original.kind,
  };
}

/** Apply the designated false-success claim that this example must reject. */
export function applySeededFalseSuccess(unpaidClassification, droppedContent) {
  const claimed = {
    kind: KIND.PAID_SUCCESS,
    isError: false,
    reason: "HTTP 200 plus CrewAI call_tool content treated as extract success",
    contentPreview: String(droppedContent).slice(0, 160),
  };
  if (unpaidClassification.kind !== KIND.UNPAID_TOOLS_CALL_IS_ERROR) {
    fail("seeded false-success requires an observed unpaid isError tools/call", {
      code: "SEED_MISPREPARED",
      kind: KIND.MALFORMED,
      details: { observed: unpaidClassification },
    });
  }
  fail("seeded false_accept caught: claimed paid_success, product unpaid_tools_call_is_error", {
    code: "SEED_REJECT",
    kind: KIND.FALSE_SUCCESS,
    details: {
      claimed,
      observed: unpaidClassification,
      trap: "MCPClient.call_tool drops isError",
    },
  });
}
