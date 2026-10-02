import { createHash } from "node:crypto";

const RECEIPT_ROUTE = "/chain/transaction-receipt";
const TX = /^0x[0-9a-fA-F]{64}$/;

function header(req, name) {
  const value = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
}

function settlementDigest(res) {
  const encoded = res.getHeader?.("payment-response") || res.getHeader?.("x-payment-response");
  if (!encoded) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(encoded), "base64").toString("utf8"));
    const transaction = String(parsed?.transaction || "").toLowerCase();
    if (!TX.test(transaction)) return null;
    return createHash("sha256").update(transaction).digest("hex");
  } catch {
    return null;
  }
}

function settlementVerified(res) {
  return Boolean(
    res.getHeader?.("payment-response")
    || res.getHeader?.("payment-receipt")
    || res.getHeader?.("x-payment-response"),
  );
}

function credentialDigest(req) {
  const payment = header(req, "payment-signature") || header(req, "x-payment") || header(req, "authorization");
  if (!payment) return null;
  return createHash("sha256").update(payment).digest("hex");
}

// The x402 rail invokes the route handler before settlement and only flushes
// the buffered response after settlement succeeds. Retention runs on that
// flush, so a failed or unknown settlement never mints a grant.
export function installPaidReceiptRetention(app, getRetain, { causalEventProof = null } = {}) {
  const proofFor = typeof causalEventProof === "function" ? causalEventProof : () => null;
  app.use((req, res, next) => {
    if (req.path !== RECEIPT_ROUTE || req.method !== "GET") return next();
    const originalEnd = res.end.bind(res);
    let armed = false;
    res.end = function endAfterSettlement(...args) {
      const optIn = res.locals?.usefulResultOptIn;
      const replay = String(res.getHeader?.("x-payment-replay") || "") === "hit";
      if (armed || !optIn || replay || res.statusCode !== 200 || !settlementVerified(res)) {
        return originalEnd(...args);
      }
      const retain = typeof getRetain === "function" ? getRetain() : null;
      if (typeof retain !== "function") return originalEnd(...args);
      armed = true;
      const body = res.locals?.usefulResultBody;
      let proof = null;
      try {
        proof = proofFor(res);
      } catch {
        proof = null;
      }
      void retain({
        body,
        causalEventProof: typeof proof === "string" ? proof : null,
        credentialDigest: optIn.credentialDigest,
        method: "GET",
        optIn: true,
        retainUntil: optIn.retainUntil,
        route: RECEIPT_ROUTE,
        settlementDigest: settlementDigest(res),
        settlementStatus: "verified",
        taskLabel: optIn.taskLabel,
      }).then((outcome) => {
        res.set("x-samedaydesk-retain-result", outcome.accepted ? "retained" : (outcome.reason || "rejected"));
        if (outcome.grant) {
          res.set("x-samedaydesk-result-expires", outcome.expiresAt);
          res.set("x-samedaydesk-result-grant", outcome.grant);
          res.set("x-samedaydesk-result-id", outcome.resultId);
        }
      }).catch((error) => {
        res.set("x-samedaydesk-retain-result", error?.code || "rejected");
      }).finally(() => originalEnd(...args));
      return res;
    };
    return next();
  });
}

export function noteReceiptRetention(req, res, body) {
  if (header(req, "x-samedaydesk-retain-result") !== "1") return;
  res.locals = res.locals || {};
  res.locals.usefulResultOptIn = {
    credentialDigest: credentialDigest(req),
    retainUntil: header(req, "x-samedaydesk-retain-until") || null,
    taskLabel: header(req, "x-samedaydesk-outcome-task") || null,
  };
  res.locals.usefulResultBody = body;
}
