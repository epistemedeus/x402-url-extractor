import { paymentRequestKey } from "./request-key.mjs";
import QRCode from "qrcode";
import { Mppx, evm } from "mppx/client";
import { createWalletClient, custom, formatUnits, getAddress } from "viem";
import { base } from "viem/chains";
import { Header } from "mppx/x402";

const endpoint = new URL(location.pathname.replace(/\/wallet$/, ""), location.origin);
const reference = endpoint.pathname.split("/").pop();
const merchant = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
const button = document.querySelector("#pay");
const state = document.querySelector("#state");
const refresh = document.querySelector("#refresh");
const mobile = document.querySelector("#mobile");
let codeReady=false;
document.querySelector("#order").textContent = reference;
// The page wears the sending site's dress (set by the server); these name that site and show what this browser can do.
const root = document.documentElement;
const site = ({ sds: ["SameDayDesk", "https://samedaydesk.com"], ein: ["EIN.LLC", "https://ein.llc"], neo: ["Neomorphic", "https://neomorphic.io"] })[root.dataset.site];
if (site) { document.querySelector("#site").textContent = site[0] + " order"; document.querySelector("#again").href = site[1]; }
const sync = () => { root.dataset.wallet = window.ethereum ? "injected" : "none"; };
sync();
mobile.open = matchMedia("(min-width: 768px)").matches;
document.querySelector("#copy").onclick = async event => {
  try { await navigator.clipboard.writeText(location.href); event.target.textContent = "Link copied. Paste it in your wallet app's browser."; }
  catch { event.target.textContent = location.href; }
};
let busy = false, submitted = false, timer, signedKey;
const read = () => fetch(signedKey ? endpoint.href + "/requests/" + signedKey : endpoint, { cache: "no-store", credentials: "omit", redirect: "error" });

function terms(response, result) {
  const required = Header.decodePaymentRequired(response.headers.get("payment-required"));
  const term = required.accepts?.[0];
  if (required.resource?.url !== endpoint.href || result.order !== reference || term?.scheme !== "exact" ||
      term.network !== "eip155:8453" || getAddress(term.payTo) !== getAddress(merchant) ||
      getAddress(term.asset) !== getAddress(evm.assets.base.USDC.address) ||
      term.amount !== result.amount || !/^[1-9][0-9]{0,15}$/.test(term.amount)) throw Error("The payment details could not be confirmed.");
  return term;
}
async function show(response) {
  const result = await response.clone().json();
  clearTimeout(timer);
  sync();
  button.hidden = true;
  mobile.hidden=true;
  if (response.status === 404 && signedKey) {
    root.dataset.state = "unknown";
    state.textContent = "Your signed request has no confirmed payment yet. Refresh its status.";
    return;
  }
  if (result.order !== reference) throw Error("The order could not be read.");
  if (response.status === 402) {
    const term = terms(response, result);
    if (!codeReady) {
      try {
        await QRCode.toCanvas(document.querySelector("#code"),endpoint.href+"/wallet",{width:232,margin:4,errorCorrectionLevel:"M"});
        codeReady=true;
      } catch { /* Wallet connection remains available. */ }
    }
    root.dataset.state = submitted ? "seen" : "waiting";
    mobile.hidden=!codeReady || submitted;
    document.querySelector("#amount").textContent = formatUnits(BigInt(term.amount), 6) + " USDC";
    button.hidden = submitted;
    state.textContent = submitted ? "Checking your signed payment. Refresh its status." : "Waiting for payment.";
  } else {
    root.dataset.state = result.state || "unknown";
    document.querySelector("#title").textContent = result.state === "paid" ? "Paid" : result.state === "refunded" ? "Refunded" : "Pay with USDC";
    state.textContent = ({ seen: "Payment seen. Waiting for confirmation.", paid: "Paid. Your receipt is ready.",
      conflict: "Another payment request is attached to this order.", closed: "This invoice is closed.", expired: "This price hold ended before payment. Nothing was charged.", held: "Payment under review. Keep your order reference.",
      refunded: "Refund confirmed.", refund_pending: "Refund awaiting confirmation." })[result.state] || "Checking payment status.";
    if (result.state === "seen" && result.providerReason) {
      state.textContent = "Provider response: " + result.providerReason + ". Checking the original payment.";
    }
    if (result.state === "held") {
      state.textContent = ({
        authorization_expired_unused: "Your authorization expired unused. No USDC was collected.",
        additional_order_payment: "Another payment completed this order. This transfer is recorded for a refund.",
        wrong_asset: "The transfer used a different token. Keep this transaction and order reference for support.",
        amount_changed: "The received amount differs from the quote. Keep this order reference for support.",
        quote_changed_or_expired: "The transfer arrived against a changed or expired quote. Keep this order reference for support.",
      })[result.reason] || state.textContent;
      if (result.providerReason) state.textContent += " Provider response: " + result.providerReason + ".";
    }
    if (result.review) state.textContent = "The reported transfer needs review. Checking the original USDC authorization.";
    const debit = result.receipt?.transaction || result.review?.evidence?.transaction;
    if (debit) {
      document.querySelector("#history").hidden = false;
      document.querySelector("#debit").replaceChildren(Object.assign(document.createElement("a"), { href: "https://basescan.org/tx/" + debit, textContent: debit }));
      const refund = result.receipt?.refund?.transaction;
      document.querySelector("#refund-label").hidden = !refund;
      document.querySelector("#refund").replaceChildren(...(refund ? [Object.assign(document.createElement("a"), { href: "https://basescan.org/tx/" + refund, textContent: refund })] : []));
    }
    if (result.amount) document.querySelector("#amount").textContent = formatUnits(BigInt(result.amount), 6) + " USDC";
    if (result.state === "seen" || result.state === "refund_pending") timer = setTimeout(check, 12000);
  }
}
async function check() {
  if (busy) return;
  try { await show(await read()); } catch { root.dataset.state = "unknown"; state.textContent = "Status is temporarily unavailable. Refresh this order."; }
}
refresh.onclick = check;
button.onclick = async () => {
  if (busy || submitted) return;
  busy = true; button.disabled = true;
  try {
    if (!window.ethereum) throw Error("Open this payment link in your wallet browser.");
    const response = await read();
    if (response.status !== 402) { await show(response); return; }
    const quote = await response.clone().json();
    const term = terms(response, quote);
    const wallet = createWalletClient({ chain: base, transport: custom(window.ethereum) });
    const [address] = await wallet.requestAddresses();
    if (await wallet.getChainId() !== base.id) await wallet.switchChain({ id: base.id });
    const signer = { address, signTypedData: data => wallet.signTypedData({ account: address, ...data }) };
    const client = Mppx.create({ methods: [evm({ account: signer, currencies: [evm.assets.base.USDC],
      networks: [8453], maxAtomicAmount: term.amount })], polyfill: false });
    // Use the SDK's resource-bound x402 path. Sign once, submit once, then only read.
    const headers = new Headers(response.headers);
    headers.delete("www-authenticate");
    const signature = await client.createCredential(new Response(null, { status: 402, headers }));
    signedKey = await paymentRequestKey(endpoint.href, quote, "x402", signature);
    try { sessionStorage.setItem("request/" + reference, signedKey); } catch { /* this tab still owns the digest */ }
    submitted = true;
    try { sessionStorage.setItem("submitted/" + reference, "1"); } catch { /* the owner still elects one submission */ }
    const paid = await fetch(endpoint, { credentials: "omit", cache: "no-store", redirect: "error",
      headers: { "payment-signature": signature } });
    await show(paid);
  } catch (err) {
    state.textContent = submitted ? "Checking payment status. Refresh this order." :
      (err?.message === "Open this payment link in your wallet browser." ? err.message : "Payment was not confirmed. Check your wallet and this order.");
  } finally { busy = false; button.disabled = false; }
};
try {
  const stored = sessionStorage.getItem("request/" + reference);
  if (stored && /^[0-9a-f]{64}$/.test(stored)) signedKey = stored;
  submitted = Boolean(signedKey) || sessionStorage.getItem("submitted/" + reference) === "1";
} catch { /* optional browser memory */ }
void check();
