import { wrapFetchWithPayment, x402Client, x402HTTPClient } from "@x402/fetch";
import { encodePaymentRequiredHeader } from "@x402/core/http";
import { Mppx, evm } from "mppx/client";
import { getAddress } from "viem";

// Use the caller's existing signer. The maintained EVM method commits its nonce to
// the order resource. A default exact-EVM client generates an unrelated random nonce.
export async function payOrder({ resource, amount, account, fetchImpl = fetch }) {
  const url = new URL(resource);
  if (url.origin !== "https://agents.samedaydesk.com" || url.username || url.password || url.search || url.hash ||
      !/^\/order-payments\/(sds|ein|neo)\/[0-9a-f-]{36}$/.test(url.pathname) ||
      !/^[1-9][0-9]{0,15}$/.test(amount)) throw Error("expected canonical order resource and exact atomic amount");
  const signer = Mppx.create({ methods: [evm({ account, networks: [8453], currencies: [evm.assets.base.USDC],
    maxAtomicAmount: amount })], polyfill: false });
  const client = new x402HTTPClient(new x402Client());
  client.onPaymentRequired(async ({ paymentRequired, requestUrl }) => {
    const t = paymentRequired.accepts?.[0];
    if (requestUrl !== resource || paymentRequired.resource?.url !== resource ||
        paymentRequired.accepts.length !== 1 || t.scheme !== "exact" || t.network !== "eip155:8453" ||
        t.amount !== amount || getAddress(t.asset) !== getAddress(evm.assets.base.USDC.address) ||
        getAddress(t.payTo) !== "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee" || !paymentRequired.extensions?.mppx) {
      throw Error("order terms differ from expected terms");
    }
    const response = new Response(null, { status: 402, headers: { "payment-required": encodePaymentRequiredHeader(paymentRequired) } });
    return { headers: { "payment-signature": await signer.createCredential(response) } };
  });
  let sent = false;
  const response = await wrapFetchWithPayment(async req => {
    if (sent) throw Error("payment has already been submitted, read the original order");
    if (req.headers.has("payment-signature")) sent = true;
    return fetchImpl(new Request(req, { redirect: "error", credentials: "omit", cache: "no-store" }));
  }, client)(resource);
  if (response.ok) {
    const result = await response.clone().json();
    if (["paid","refunded"].includes(result.state) &&
        (result.order !== url.pathname.split("/").pop() || result.amount !== amount || !result.receipt?.payer ||
         getAddress(result.receipt.payer) !== getAddress(account.address))) {
      return Response.json({state:"conflict",error:"order_payment_belongs_to_another_intent"}, {status:409});
    }
  }
  return response;
}
