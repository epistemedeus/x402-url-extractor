import { createHash } from "node:crypto";

export const OPPORTUNITY_TAB_PATH = "/work/opportunity-preflight";
const signedFields = ["content-digest", "idempotency-key", "signature-input", "signature"];
const chargePath = "/v1/sellers/samedaydesk/opportunity-deliveries";
const digest = (bytes) => "sha256:" + createHash("sha256").update(bytes).digest("hex");
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

function serviceOrigin(value) {
  const url = new URL(value);
  if (url.origin !== value || (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "127.0.0.1"))) {
    throw new Error("Expected a bare HTTPS origin");
  }
  return url.origin;
}

export function createOpportunityTab({ publicUrl, houseUrl, sellerToken, price, calculate, hasPaymentCredential }) {
  const enabled = Boolean(houseUrl || sellerToken);
  let resource, amountUsd;
  if (enabled) {
    houseUrl = serviceOrigin(houseUrl);
    resource = serviceOrigin(publicUrl) + OPPORTUNITY_TAB_PATH;
    const amount = /^\$((?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?)$/.exec(price)?.[1];
    if (!/^[0-9a-f]{64}$/.test(sellerToken ?? "") || !amount || Number(amount) <= 0) {
      throw new Error("Invalid House tab configuration");
    }
    amountUsd = amount;
  }

  return async function opportunityTab(req, res, next) {
    const committed = Object.hasOwn(req.headers, "house-letter");
    const refuse = (status, error, extra) =>
      res.set("Cache-Control", "no-store").status(status).json({ ok: false, error, ...extra });
    if (req.originalUrl !== OPPORTUNITY_TAB_PATH) {
      return committed ? refuse(400, "house_target_mismatch") : next();
    }
    if (!enabled) return committed ? refuse(503, "house_tab_unavailable") : next();
    const otherPayment = hasPaymentCredential(req);
    if (otherPayment) return committed ? refuse(400, "one_payment_method_required") : next();
    const raw = req.rawBody;
    if (!Buffer.isBuffer(raw) || raw.length === 0 || raw.length > 2048
        || !req.is("application/json") || req.get("content-encoding")) {
      return committed ? refuse(400, "invalid_house_request_body") : next();
    }

    const terms = { payTo: "samedaydesk", resource, amountUsd, quoteId: digest(raw) };
    if (!committed) {
      if (Object.keys(req.body || {}).length) res.set("House-Offer", encode({
        issueAt: houseUrl + "/v1/tabs/{tabId}/letters",
        target: { method: "POST", url: resource },
        terms,
      }));
      return next();
    }

    const letterId = req.get("house-letter");
    if (!/^letter_[a-f0-9-]{36}$/.test(letterId ?? "") || req.get("idempotency-key") !== letterId
        || signedFields.some((field) => typeof req.headers[field] !== "string")) {
      return refuse(401, "letter_and_request_signature_required");
    }

    let prepared;
    try {
      prepared = Buffer.from(JSON.stringify(calculate(req.body)));
      if (prepared.length > 8192) throw new Error("Result too large");
    } catch {
      return refuse(503, "house_result_unavailable");
    }

    try {
      const response = await fetch(houseUrl + chargePath, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + sellerToken },
        body: JSON.stringify({
          requestHeaders: Object.fromEntries(signedFields.map((field) => [field, req.headers[field]])),
          requestBody: raw.toString("base64url"),
          resultBody: prepared.toString("base64url"),
        }),
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      const reply = await response.json();
      if ([400, 401, 404, 409].includes(response.status) && reply.ok === false
          && /^[a-z_]{1,80}$/.test(reply.error)) return refuse(response.status, reply.error);
      if (!response.ok || reply.ok !== true) throw new Error("House receipt unavailable");
      const { charge, resultBody } = reply.result;
      const result = Buffer.from(resultBody, "base64url");
      if (charge.letterId !== letterId || charge.state !== "captured" || result.length > 8192
          || resultBody !== result.toString("base64url") || digest(result) !== charge.resultDigest) {
        throw new Error("House receipt mismatch");
      }
      return res.set("Cache-Control", "no-store")
        .set("House-Charge", encode(charge))
        .type("application/json").status(200).send(result);
    } catch {
      return refuse(503, "house_receipt_unavailable", { retry: "same_letter_and_request" });
    }
  };
}
