import { reconcileRefund } from "./refund.mjs";
import { paymentRequestKey } from "./request-key.mjs";
import { Receipt } from "mppx";
import { decodePaymentRequiredHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import { evm, Mppx } from "mppx/server";
import { formatUnits, getAddress } from "viem";
import { amountForCents, reconcileOrder } from "./reconcile.mjs";

const json = (value, status, headers) => Response.json(value, {
  status, headers: { "cache-control": "no-store", ...headers },
});
const hash = /^0x[0-9a-f]{64}$/i;
// The facilitator may reply before finality. Emit protocol success only from the
// site's finalized receipt, including after a lost provider response or restart.
async function finalizedHeaders(row, trust) {
  if (!row.receipt || !row.attempt || !["paid","refunded"].includes(row.state)) return {};
  const { transaction: reference, payer, timestamp } = row.receipt;
  if (row.state === "refunded") {
    if (row.attempt.protocol !== "x402" || !trust?.enabled) return {};
    const original = await trust.finalizedOrderReceipt(row.resource,payer,reference,Number(BigInt(timestamp)));
    return { "order-original-receipt": Buffer.from(JSON.stringify(original)).toString("base64") };
  }
  if (row.attempt.protocol === "x402") return { "payment-response": encodePaymentResponseHeader({
    success: true, network: "eip155:8453", transaction: reference, payer,
    ...(trust?.enabled && { extensions: { "offer-receipt": { info: { receipt: await trust.finalizedOrderReceipt(
      row.resource, payer, reference, Number(BigInt(timestamp))) } } } }),
  }) };
  return { "payment-receipt": Receipt.serialize(Receipt.from({ method: "evm", status: "success",
    reference, timestamp: new Date(Number(BigInt(timestamp) * 1000n)).toISOString() })) };
}
const terminal = new Set(["paid", "held", "refunded", "refund_pending", "closed"]);

// owner is the site's authenticated order repository. arm must commit before returning true.
// The only settlement transport here is the already configured merchant facilitator.
export async function checkoutOrder({ request, owner, client, facilitator, merchant, secretKey, trust, now = Date.now }) {
  const quote = await owner.load();
  if (!quote) return json({ error: "order_not_found" }, 404);
  const amount = amountForCents(quote.cents);
  if (quote.resource !== request.url || request.method !== "GET" || !Number.isSafeInteger(quote.created) ||
      !Number.isSafeInteger(quote.expires) || quote.created >= quote.expires ||
      typeof quote.version !== "string" || !quote.version || quote.version.length > 180) {
    return json({ error: "order_terms_unavailable" }, 409);
  }
  const view = row => ({ order: quote.id, version: quote.version, amount, created: quote.created, expires: quote.expires, network: "eip155:8453",
    state: row.state, ...(row.ownerQa === true && { classification: "owner_qa" }), ...(row.transaction && { providerTransaction: row.transaction }),
    ...(row.providerReason && { providerReason: row.providerReason }), ...(row.reason && { reason: row.reason }), ...(row.receipt && { receipt: row.receipt }) });
  async function read(row) {
    if (row.state === "refund_pending") {
      const observed = await reconcileRefund(client, row.receipt, row.refund, merchant);
      row = await owner.refundObserved(row.refund.original, observed);
    }
    if (terminal.has(row.state)) return json(view(row), row.state === "held" ? 409 : 200, await finalizedHeaders(row, trust));
    if (!row.attempt) return json(view(row), 202);
    const observed = await reconcileOrder({ client, quote: row, attempt: row.attempt, merchant });
    const current = await owner.observe(row.attempt, observed);
    return json({ ...view(current), ...(current.state === "seen" && observed.review && { review: observed.review }) }, current.state === "paid" ? 200 : current.state === "held" ? 409 : 202, await finalizedHeaders(current, trust));
  }
  const protocol = request.headers.has("payment-signature") ? "x402" : "mpp";
  const wire = request.headers.get("payment-signature") || request.headers.get("authorization");
  const key = wire ? await paymentRequestKey(quote.resource, { ...quote, order:quote.id, amount }, protocol, wire) : null;
  const dispute = async (row, contender) => {
    const statusUrl = row.resource + "/requests/" + key;
    if (contender && owner.review) {
      const saved = await owner.review("register", key, { attempt: contender });
      if (saved?.matched) return reviewOrder({ owner, client, merchant, key, statusUrl });
    }
    return json({ error: "different_payment_request", order: row.id, state: "conflict" }, 409);
  };
  if (quote.state !== "waiting") {
    if (!key || key === quote.attempt?.requestKey) return read(quote);
    if (quote.reviews?.[key]) return reviewOrder({ owner, client, merchant, key, statusUrl: quote.resource + "/requests/" + key });
    if (!quote.attempt || now() >= quote.expires) return dispute(quote);
  }
  if (now() >= quote.expires) return json({ ...view(quote), state: "expired" }, 410);
  // Anchor before releasing any payable challenge. A lost response or an externally mined
  // authorization can then be recovered from the first block where it could have appeared.
  if (await client.getChainId() !== 8453) throw Error("expected Base chain");
  const anchor = quote.startBlock ?? await owner.anchor(String((await client.getBlock({ blockTag: "latest" })).number));
  if (!/^(0|[1-9][0-9]{0,19})$/.test(anchor)) throw Error("missing order scan start");
  let attempt;
  let armed = false;
  let lostRace = false;
  // mppx supplies both x402 and Payment-auth wires. Its EVM charge verifier binds the signed
  // nonce to the resource and challenge. Reserve after signature verification, before broadcast.
  const guardedFacilitator = {
    async verify(payload, terms) {
      const auth = payload.payload.authorization;
      if (await client.getChainId() !== 8453 || now() >= quote.expires) throw Error("invalid_chain_or_expiry");
      const validBefore = String(auth.validBefore);
      const limit = request.headers.has("payment-signature") ? Math.floor(now() / 1000) + 301 : Math.ceil(quote.expires / 1000);
      if (!/^[1-9][0-9]{0,18}$/.test(validBefore) || BigInt(validBefore) > BigInt(limit)) {
        return { isValid: false, invalidReason: "invalid_authorization_expiry" };
      }
      attempt = { requestKey: key, payer: getAddress(auth.from), nonce: auth.nonce, validBefore, version: quote.version,
        nextBlock: anchor, protocol: request.headers.has("payment-signature") ? "x402" : "mpp" };
      // Reaching this callback requires the maintained EVM verifier to recover
      // the payer and bind its authorization to this exact challenge/resource.
      armed = quote.state === "waiting" && await owner.arm(attempt);
      if (!armed) { lostRace = true; return { isValid: false, invalidReason: "order_already_reserved" }; }
      const verified = await facilitator.verify(payload, terms).catch(() => ({ isValid: false, invalidReason: "verification_unavailable" }));
      if (!verified.isValid) {
        const reason = String(verified.invalidReason || "provider_refused");
        await owner.submitted(attempt, { reason: /^[A-Za-z0-9_:-]{1,96}$/.test(reason) ? reason : "provider_refused" });
      }
      return verified.isValid ? { isValid: true } : { isValid: false, invalidReason: "verification_refused" };
    },
    async settle(payload, terms) {
      if (!armed) throw Error("order_not_reserved");
      const settled = await facilitator.settle(payload, terms).catch(() => ({ success: false, errorReason: "settlement_unknown" }));
      if (!settled.success || settled.network !== "eip155:8453" || !hash.test(settled.transaction) ||
          (settled.payer && getAddress(settled.payer) !== attempt.payer)) {
        const reason = typeof settled.errorReason === "string" ? settled.errorReason : "settlement_unconfirmed";
        await owner.submitted(attempt, { reason: /^[A-Za-z0-9_:-]{1,96}$/.test(reason) ? reason : "provider_refused" });
        return { success: false, errorReason: "settlement_unconfirmed" };
      }
      await owner.submitted(attempt, { transaction: settled.transaction });
      return settled;
    },
  };
  const server = Mppx.create({ secretKey, realm: new URL(quote.resource).host, methods: [evm({
    currency: evm.assets.base.USDC, recipient: merchant, x402: { facilitator: guardedFacilitator },
  })] });
  const route = server.evm.charge({ amount: formatUnits(BigInt(amount), 6), externalId: quote.id,
    scope: JSON.stringify([quote.resource, quote.version, quote.created, quote.expires, amount]),
    expires: new Date(quote.expires).toISOString() });
  let result;
  try { result = await route(request); }
  catch (err) {
    if (!armed && !lostRace) throw err;
  }
  if (result?.status === 402 && !armed && !lostRace) {
    const headers = new Headers(result.challenge.headers);
    headers.set("cache-control", "no-store");
    headers.delete("content-length");
    const hasCredential = request.headers.has("payment-signature") || request.headers.has("authorization");
    if (hasCredential && quote.state !== "waiting") return dispute(quote);
    if (hasCredential) return new Response(result.challenge.body, { status: 402, headers });
    if (trust?.enabled) {
      const required = decodePaymentRequiredHeader(headers.get("payment-required"));
      const validFor = Math.min(300, Math.floor(quote.expires / 1000) - Math.floor(now() / 1000));
      if (validFor < 1) return json({ ...view(quote), state: "expired" }, 410);
      const extension = await trust.resourceServerExtension.enrichPaymentRequiredResponse({ offerValiditySeconds: validFor },
        { paymentRequiredResponse: required, requirements: required.accepts });
      if (!extension?.info?.offers?.length) throw Error("merchant order attestation unavailable");
      required.extensions = { ...required.extensions, "offer-receipt": extension };
      headers.set("payment-required", encodePaymentRequiredHeader(required));
    }
    headers.set("content-type", "application/json");
    return new Response(JSON.stringify(view(quote)), { status: 402, headers });
  }
  const current = await owner.load();
  if (key && current.attempt?.requestKey !== key) return dispute(current, lostRace ? attempt : null);
  return read(current);
}

export async function reviewOrder({ owner, client, merchant, key, statusUrl }) {
  let row = await owner.review("read", key);
  if (!row?.attempt) return json({ error: "payment_review_not_found" }, 404);
  if (row.state === "seen") {
    const result = await reconcileOrder({ client, quote: row, attempt: row.attempt, merchant });
    row = await owner.review("observe", key, { attempt: row.attempt, result });
  } else if (row.state === "refund_pending") {
    const result = await reconcileRefund(client, row.receipt, row.refund, merchant);
    row = await owner.review("refund-observe", key, { original: row.refund.original, result });
  }
  // A secondary payment never fulfills the order or receives its success headers.
  return json({ error: "different_payment_request", order:row.id, version:row.version, amount:amountForCents(row.cents), network:"eip155:8453",
    ...(row.ownerQa && {classification:"owner_qa"}), state: row.state, statusUrl,
    ...(row.reason && { reason: row.reason }), ...(row.receipt && { receipt: row.receipt }) }, 409);
}
