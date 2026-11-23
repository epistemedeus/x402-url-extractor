import { checkoutOrder } from "./checkout.mjs";
import { publicHistoricalClient } from "../transaction-receipt.mjs";

export const SITE_ORIGINS = Object.freeze({
  sds: "https://samedaydesk.com", ein: "https://ein.llc", neo: "https://neomorphic.io",
});
export const ORDER_PATH = "/order-payments/:site/:id";
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const paymentOrigin = "https://agents.samedaydesk.com";
const forwarded = ["authorization", "payment-signature"];

// Only controller-enrolled sites are reachable. The public request controls neither URL nor headers
// used for the internal call. A POST is sent once and an ambiguous result is left for readback.
function siteOrder(site, id, token, fetchImpl) {
  async function call(action, data = {}) {
    const res = await fetchImpl(new URL(`/api/order-payments/internal/${id}/${action}`, SITE_ORIGINS[site]), {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.status === 404 && action === "load") return null;
    if (!res.ok) throw Error("order owner unavailable");
    return res.json();
  }
  return { load: () => call("load"), arm: async attempt => (await call("arm", { attempt })).armed === true,
    anchor: async block => (await call("anchor", { block })).block,
    submitted: (attempt, result) => call("submitted", { attempt, result }),
    observe: (attempt, result) => call("observe", { attempt, result }) };
}

export function mountOrderPayments(app, { merchant, network, facilitator, env = process.env,
  client = publicHistoricalClient("base"), fetchImpl = fetch }) {
  app.get(ORDER_PATH, async (req, res) => {
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" });
    const { site, id } = req.params;
    if (!Object.hasOwn(SITE_ORIGINS, site) || !uuid.test(id) || req.method !== "GET" ||
        req.originalUrl !== `/order-payments/${site}/${id}`) return res.sendStatus(404);
    const token = env[`ORDER_PAYMENTS_${site.toUpperCase()}_TOKEN`];
    if (network !== "eip155:8453" || !token || token.length < 32 || !env.MPP_SECRET_KEY) return res.sendStatus(404);
    const headers = new Headers();
    for (const name of forwarded) if (req.get(name)) headers.set(name, req.get(name));
    if (headers.size > 1 || (headers.has("authorization") && headers.has("payment-signature"))) return res.sendStatus(400);
    const request = new Request(new URL(req.originalUrl, paymentOrigin), { headers });
    try {
      const response = await checkoutOrder({ request, merchant, facilitator, secretKey: env.MPP_SECRET_KEY, client,
        owner: siteOrder(site, id, token, fetchImpl) });
      for (const name of ["payment-required", "www-authenticate", "content-type", "payment-response", "payment-receipt"])
        if (response.headers.has(name)) res.set(name, response.headers.get(name));
      return res.status(response.status).send(await response.text());
    } catch {
      return res.status(503).json({ error: "order_status_unavailable", statusUrl: request.url });
    }
  });
}
