import crypto from "node:crypto";

const THE402_ORIGIN = "https://api.the402.ai";

function headerValue(headers, name) {
  if (typeof headers?.get === "function") return headers.get(name);
  const match = Object.entries(headers || {}).find(
    ([key]) => key.toLowerCase() === name.toLowerCase()
  );
  const value = match?.[1];
  return Array.isArray(value) ? value[0] : value;
}

function constantTimeEqual(left, right) {
  const leftDigest = crypto.createHash("sha256").update(String(left || "")).digest();
  const rightDigest = crypto.createHash("sha256").update(String(right || "")).digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

export function verifyThe402Webhook({
  headers,
  rawBody,
  apiKey,
  webhookSecret,
  nowMs = Date.now(),
  maxAgeSeconds = 300,
}) {
  if (!apiKey || !webhookSecret) return { ok: false, status: 503, error: "not_configured" };

  const platformSecret = headerValue(headers, "x-platform-secret");
  if (!constantTimeEqual(platformSecret, apiKey)) {
    return { ok: false, status: 401, error: "invalid_platform_secret" };
  }

  const timestampText = headerValue(headers, "x-webhook-timestamp");
  const timestamp = Number(timestampText);
  if (!Number.isFinite(timestamp)) {
    return { ok: false, status: 401, error: "invalid_timestamp" };
  }
  const ageSeconds = Math.abs(nowMs / 1000 - timestamp);
  if (ageSeconds > maxAgeSeconds) {
    return { ok: false, status: 401, error: "stale_timestamp" };
  }

  const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || "");
  const expected = `sha256=${crypto
    .createHmac("sha256", webhookSecret)
    .update(`${timestamp}.`)
    .update(raw)
    .digest("hex")}`;
  const signature = headerValue(headers, "x-webhook-signature");
  if (!constantTimeEqual(signature, expected)) {
    return { ok: false, status: 401, error: "invalid_signature" };
  }

  return { ok: true, status: 200 };
}

export function validateThe402CallbackUrl(value) {
  try {
    const url = new URL(value);
    if (url.origin !== THE402_ORIGIN || !url.pathname.startsWith("/v1/")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function postCallback(fetchImpl, callbackUrl, apiKey, body) {
  const response = await fetchImpl(callbackUrl, {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`the402 callback failed with HTTP ${response.status}`);
  }
}

export async function fulfillThe402Job(payload, {
  apiKey,
  serviceId,
  deepAudit,
  fetchImpl = fetch,
}) {
  if (payload?.type !== "job_dispatch") return { ignored: true, type: payload?.type || null };
  if (serviceId && payload.service_id !== serviceId) {
    return { ignored: true, type: payload.type, reason: "service_mismatch" };
  }

  const callbackUrl = validateThe402CallbackUrl(payload.callback_url);
  if (!callbackUrl) throw new Error("invalid the402 callback URL");

  const brief = payload.brief && typeof payload.brief === "object" ? payload.brief : {};
  const domain = brief.domain || brief.url || brief.site_url;
  if (!domain || typeof domain !== "string" || domain.length > 253) {
    await postCallback(fetchImpl, callbackUrl, apiKey, {
      status: "failed",
      notes: "A domain or URL is required for the AI Search Readiness Audit.",
    });
    return { completed: false, reason: "invalid_domain" };
  }

  await postCallback(fetchImpl, callbackUrl, apiKey, { status: "in_progress" });
  try {
    const audit = await deepAudit(domain, {
      vertical: typeof brief.vertical === "string" ? brief.vertical : undefined,
      city: typeof brief.city === "string" ? brief.city : undefined,
    });
    await postCallback(fetchImpl, callbackUrl, apiKey, {
      status: "completed",
      deliverables: { audit },
      notes: "Completed the production SameDayDesk AI Search Readiness Audit.",
    });
    return { completed: true, domain };
  } catch (error) {
    await postCallback(fetchImpl, callbackUrl, apiKey, {
      status: "failed",
      notes: `Audit failed safely: ${String(error?.message || error).slice(0, 300)}`,
    });
    return { completed: false, reason: "audit_failed" };
  }
}
