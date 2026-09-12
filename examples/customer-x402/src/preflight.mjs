import { OUTCOMES } from "./constants.mjs";
import { assertChallengeResource, decodeChallengeFromResponse, selectExactAccept } from "./challenge.mjs";
import {
  assertAcceptMatchesAuthorization,
  assertRequestMatchesAuthorization,
  AuthorizationRefusal,
  normalizeAuthorization,
  admitVendorBudgetBody,
} from "./authorization.mjs";
import { BatchAdmissionError, admitExtractBatchBody } from "./batch-admission.mjs";
import { classifyRequestConstruction } from "./request-construction.mjs";
import { safeJson } from "./redact.mjs";
import { boundedFetch } from "./transport.mjs";

function requestInitFor(auth) {
  if (auth.method === "POST") {
    return {
      method: "POST",
      redirect: "error",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: auth.bodyRaw,
    };
  }
  return {
    method: "GET",
    redirect: "error",
    headers: { accept: "application/json" },
  };
}

/**
 * Credential-free unpaid preflight. Never looks up wallet keys, signs, or
 * sends payment headers. POST /extract/batch validates local admission first.
 */
export async function runPreflight({
  url,
  authorization = null,
  fetchImpl = globalThis.fetch,
  method,
  body = null,
} = {}) {
  if (!url && !authorization) throw new Error("preflight url is required");
  if (String(url || authorization?.url || "").startsWith("mcp://")) {
    throw new Error("preflight refuses mcp:// resources; use HTTPS extract only");
  }

  let auth = null;
  if (authorization) {
    auth = normalizeAuthorization(authorization);
  }
  const resolvedMethod = String(method ?? auth?.method ?? "GET").toUpperCase();
  const resolvedUrl = url ?? auth?.url;
  if (!resolvedUrl) throw new Error("preflight url is required");

  const target = new URL(resolvedUrl);
  if (target.protocol !== "https:" || target.username || target.password || target.hash) {
    throw new Error("preflight requires credential-free HTTPS without a fragment");
  }
  if (resolvedMethod !== "GET" && resolvedMethod !== "POST") {
    throw new Error("preflight method must be GET or POST");
  }

  const admitPostBody = value => target.pathname === "/vendor-budget-impact"
    ? admitVendorBudgetBody(typeof value === "string" ? {bodyRaw:value} : {body:value}).bodyRaw
    : admitExtractBatchBody(typeof value === "string" ? JSON.parse(value) : value).bodyRaw;
  let bodyRaw = null;
  if (resolvedMethod === "POST") {
    if (auth) {
      bodyRaw = body == null ? auth.bodyRaw : typeof body === "string" ? body : admitPostBody(body);
    } else if (body != null) {
      try {
        bodyRaw = admitPostBody(body);
      } catch (error) {
        if (error instanceof BatchAdmissionError) throw error;
        throw error;
      }
    } else {
      throw new Error("POST preflight requires authorization body or body");
    }
  } else if (body != null && body !== "") {
    throw new Error("GET preflight must not include a body");
  }

  const construction = classifyRequestConstruction(resolvedUrl, {
    method: resolvedMethod,
    body: resolvedMethod === "POST" ? bodyRaw : null,
  });
  if (construction.kind === "invalid_input") {
    throw new AuthorizationRefusal(construction.reason, { field: construction.missing[0] || "url" });
  }

  let bound = null;
  if (auth) {
    bound = assertRequestMatchesAuthorization(resolvedUrl, auth, {
      method: resolvedMethod,
      body: resolvedMethod === "POST" ? bodyRaw : null,
    });
  } else if (resolvedMethod === "POST") {
    // Local admission already ran; still no wallet access.
    admitPostBody(bodyRaw);
  }

  const init = bound
    ? requestInitFor(bound)
    : resolvedMethod === "POST"
      ? {
        method: "POST",
        redirect: "error",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: bodyRaw,
      }
      : {
        method: "GET",
        redirect: "error",
        headers: { accept: "application/json" },
      };

  const response = await boundedFetch(fetchImpl, resolvedUrl, init);

  const bodyText = await response.text();
  if (response.status !== 402) {
    return {
      outcome: OUTCOMES.UNKNOWN,
      httpStatus: response.status,
      message: `expected HTTP 402 unpaid challenge, received ${response.status}`,
      bodyPreviewBytes: Buffer.byteLength(bodyText),
      bodyDigest: bound?.bodyDigest ?? null,
      construction,
      walletAccessed: false,
      paymentSigned: false,
      paymentSent: false,
    };
  }

  const challenge = decodeChallengeFromResponse(response, bodyText);
  const accept = selectExactAccept(challenge, { network: bound?.network });
  let matched = null;
  if (bound) {
    assertChallengeResource(challenge, bound);
    matched = assertAcceptMatchesAuthorization(accept, bound);
  }

  return {
    outcome: OUTCOMES.PREFLIGHT_OK,
    httpStatus: 402,
    method: resolvedMethod,
    url: resolvedUrl,
    bodyDigest: bound?.bodyDigest ?? null,
    offer: {
      scheme: accept.scheme,
      network: accept.network,
      asset: accept.asset,
      recipient: accept.payTo,
      amountAtomic: String(accept.amount ?? accept.maxAmountRequired),
      maxTimeoutSeconds: accept.maxTimeoutSeconds ?? null,
    },
    resourceUrl: challenge.resource?.url ?? null,
    matchedAuthorization: matched,
    construction,
    walletAccessed: false,
    paymentSigned: false,
    paymentSent: false,
    boundary:
      "Unpaid preflight only. This result is not authorization to spend and does not move funds.",
  };
}

export function printPreflight(result) {
  console.log(safeJson(result));
}
