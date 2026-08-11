import { createHash } from "node:crypto";

export const VIBES_CODED_ORIGIN = "https://vibes-coded.com";
export const VIBES_DISCOVERABILITY_PATH = "/integrations/vibes/agent-discoverability-audit";
export const VIBES_DISCOVERABILITY_SLUG = "samedaydesk-discoverability-audit";

const MAX_TICKET_BYTES = 8_192;
const MAX_RESPONSE_BYTES = 500_000;

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function boundedString(value, maximum) {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return clean && clean.length <= maximum ? clean : null;
}

async function boundedJson(response, label) {
  const type = response.headers.get("content-type") || "";
  if (!type.toLowerCase().includes("application/json")) {
    throw new Error(`${label} returned non-JSON`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new Error(`${label} response is too large`);
  return JSON.parse(new TextDecoder().decode(bytes));
}

function ticketClaim(payload) {
  if (!payload || typeof payload !== "object") return {};
  if (payload.data && typeof payload.data === "object") return payload.data;
  if (payload.ticket && typeof payload.ticket === "object") return payload.ticket;
  return payload;
}

function firstValue(object, keys) {
  for (const key of keys) {
    if (object?.[key] !== undefined && object?.[key] !== null) return object[key];
  }
  return null;
}

function validateVerification(payload, { expectedSlug, requestBodySha256, expectedPriceCents }) {
  const claim = ticketClaim(payload);
  if (payload?.ok !== true && payload?.valid !== true && claim?.ok !== true && claim?.valid !== true) {
    throw new Error("Vibes-Coded did not affirm the call ticket");
  }
  if (payload?.valid === false || claim?.valid === false || payload?.ok === false || claim?.ok === false) {
    throw new Error("Vibes-Coded rejected the call ticket");
  }

  const slug = firstValue(claim, ["slug", "endpoint_slug", "seller_endpoint_slug"]);
  if (slug !== null && slug !== expectedSlug) throw new Error("Vibes-Coded call ticket names a different endpoint");
  const requestHash = firstValue(claim, ["request_body_sha256", "request_sha256", "req"]);
  if (requestHash !== null && String(requestHash).toLowerCase() !== requestBodySha256) {
    throw new Error("Vibes-Coded call ticket does not bind the request body");
  }
  const amount = firstValue(claim, ["amount_cents", "price_cents", "gross_cents"]);
  if (amount !== null && Number(amount) !== expectedPriceCents) {
    throw new Error("Vibes-Coded call ticket amount does not match the listing price");
  }
  const state = firstValue(claim, ["status", "state", "payment_status"]);
  if (state !== null && !["settled", "paid", "verified", "ready", "ok"].includes(String(state).toLowerCase())) {
    throw new Error("Vibes-Coded call ticket is not settled");
  }
  return {
    endpointSlug: slug || expectedSlug,
    chargeId: boundedString(String(firstValue(claim, ["charge_id", "chargeId", "id"]) || ""), 200),
  };
}

async function verifyTicket({ ticket, requestBodySha256, fetchImpl, origin }) {
  const response = await fetchImpl(`${origin}/api/v1/seller-endpoints/verify-call-ticket`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": "SameDayDesk-Vibes-Channel/0.1",
    },
    body: JSON.stringify({ call_ticket: ticket, request_body_sha256: requestBodySha256 }),
  });
  const payload = await boundedJson(response, "Vibes-Coded ticket verification");
  if (!response.ok) throw new Error(`Vibes-Coded ticket verification failed with HTTP ${response.status}`);
  return payload;
}

async function submitReceipt({ ticket, status, responseSha256, note, apiKey, fetchImpl, origin }) {
  const headers = {
    accept: "application/json",
    "content-type": "application/json",
    "user-agent": "SameDayDesk-Vibes-Channel/0.1",
  };
  if (apiKey) headers["X-API-Key"] = apiKey;
  const response = await fetchImpl(`${origin}/api/v1/seller-endpoints/delivery-receipt`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers,
    body: JSON.stringify({
      call_ticket: ticket,
      status,
      response_sha256: responseSha256,
      note: boundedString(note, 500),
    }),
  });
  const payload = await boundedJson(response, "Vibes-Coded delivery receipt");
  if (!response.ok || (payload?.ok !== true && payload?.status !== status && payload?.state !== status)) {
    throw new Error(`Vibes-Coded delivery receipt failed with HTTP ${response.status}`);
  }
  return payload;
}

export function createVibesChannel({
  product,
  validateInput = (value) => value,
  expectedSlug = VIBES_DISCOVERABILITY_SLUG,
  expectedPriceCents = 50,
  apiKey = "",
  fetchImpl = fetch,
  origin = VIBES_CODED_ORIGIN,
  now = () => Date.now(),
} = {}) {
  if (typeof product !== "function") throw new Error("Vibes-Coded channel requires a product function");
  const cache = new Map();
  const pending = new Set();

  function prune() {
    const cutoff = now();
    for (const [key, value] of cache) if (value.expiresAt <= cutoff) cache.delete(key);
  }

  return {
    async execute({ ticket, rawBody, body }) {
      prune();
      if (typeof ticket !== "string" || ticket.length < 16 || Buffer.byteLength(ticket) > MAX_TICKET_BYTES) {
        return { status: 401, body: { ok: false, error: "missing_or_invalid_vibes_call_ticket", charged: false } };
      }
      const bytes = Buffer.isBuffer(rawBody) && rawBody.length > 0
        ? rawBody
        : Buffer.from(JSON.stringify(body ?? {}));
      const requestBodySha256 = sha256Hex(bytes);
      const ticketDigest = sha256Hex(ticket);
      const replay = cache.get(ticketDigest);
      if (replay) {
        if (replay.requestBodySha256 !== requestBodySha256) {
          return { status: 409, body: { ok: false, error: "vibes_ticket_request_mismatch", charged: false } };
        }
        return { status: 200, body: { ...replay.output, channel: { ...replay.output.channel, replay: true } } };
      }
      if (pending.has(ticketDigest)) {
        return { status: 409, body: { ok: false, error: "vibes_ticket_in_progress", charged: false } };
      }

      pending.add(ticketDigest);
      try {
        const verificationPayload = await verifyTicket({ ticket, requestBodySha256, fetchImpl, origin });
        const verification = validateVerification(verificationPayload, {
          expectedSlug,
          requestBodySha256,
          expectedPriceCents,
        });
        let input;
        try {
          input = validateInput(body ?? {});
        } catch (error) {
          const failure = { ok: false, error: String(error?.message || error) };
          const responseSha256 = sha256Hex(JSON.stringify(failure));
          await submitReceipt({
            ticket,
            status: "failed",
            responseSha256,
            note: "SameDayDesk rejected invalid discoverability-audit input",
            apiKey,
            fetchImpl,
            origin,
          });
          return {
            status: 400,
            body: {
              ...failure,
              channel: {
                source: "vibes-coded",
                endpointSlug: verification.endpointSlug,
                chargeId: verification.chargeId,
                requestBodySha256,
                responseSha256,
                deliveryReceipt: "failed",
                replay: false,
              },
            },
          };
        }
        const productOutput = await product(input);
        const responseSha256 = sha256Hex(JSON.stringify(productOutput));
        await submitReceipt({
          ticket,
          status: "delivered",
          responseSha256,
          note: "SameDayDesk agent discoverability audit delivered",
          apiKey,
          fetchImpl,
          origin,
        });
        const output = {
          ...productOutput,
          channel: {
            source: "vibes-coded",
            endpointSlug: verification.endpointSlug,
            chargeId: verification.chargeId,
            requestBodySha256,
            responseSha256,
            deliveryReceipt: "confirmed",
            replay: false,
          },
        };
        cache.set(ticketDigest, {
          requestBodySha256,
          output,
          expiresAt: now() + 15 * 60_000,
        });
        return { status: 200, body: output };
      } catch (error) {
        const failure = { ok: false, error: String(error?.message || error) };
        const responseSha256 = sha256Hex(JSON.stringify(failure));
        await submitReceipt({
          ticket,
          status: "failed",
          responseSha256,
          note: "SameDayDesk fulfillment failed before delivery",
          apiKey,
          fetchImpl,
          origin,
        }).catch(() => {});
        return {
          status: 502,
          body: {
            ok: false,
            error: "vibes_fulfillment_failed",
            detail: String(error?.message || error),
          },
        };
      } finally {
        pending.delete(ticketDigest);
      }
    },
  };
}
