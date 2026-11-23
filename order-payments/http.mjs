import { fileURLToPath } from "node:url";
import { checkoutOrder } from "./checkout.mjs";
import { publicHistoricalClient } from "../transaction-receipt.mjs";

export const SITE_ORIGINS = Object.freeze({
  sds: "https://samedaydesk.com", ein: "https://ein.llc", neo: "https://api.neomorphic.io",
});
export const ORDER_PATH = "/order-payments/:site/:id";
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const paymentOrigin = "https://agents.samedaydesk.com";
const forwarded = ["authorization", "payment-signature"];

export async function readSiteResult(site, response) {
  const value = await response.json();
  if (site !== "neo") return value;
  if (value?.ok !== true || !value.result || typeof value.result !== "object") throw Error("order owner did not confirm");
  return value.result;
}

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
    return readSiteResult(site, res);
  }
  return { load: () => call("load"), arm: async attempt => (await call("arm", { attempt })).armed === true,
    anchor: async block => (await call("anchor", { block })).block,
    submitted: (attempt, result) => call("submitted", { attempt, result }),
    refundObserved: (original, result) => call("refund-observe", { original, result }),
    observe: (attempt, result) => call("observe", { attempt, result }) };
}

export function mountOrderPayments(app, { merchant, network, facilitator, trust, env = process.env,
  client = publicHistoricalClient("base"), fetchImpl = fetch }) {
  const assetRoot = fileURLToPath(new URL(".", import.meta.url));
  app.get("/order-payments/assets/wallet.js", (_req, res) => res.sendFile("dist/wallet.js", { root: assetRoot }));
  app.get(ORDER_PATH + "/wallet", (req, res) => {
    const { site, id } = req.params;
    if (!Object.hasOwn(SITE_ORIGINS, site) || !uuid.test(id) || !env[`ORDER_PAYMENTS_${site.toUpperCase()}_TOKEN`]) return res.sendStatus(404);
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex",
      "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" });
    return res.sendFile("wallet.html", { root: assetRoot });
  });
  app.get(ORDER_PATH, async (req, res) => {
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" });
    const { site, id } = req.params;
    if (!Object.hasOwn(SITE_ORIGINS, site) || !uuid.test(id) || req.method !== "GET" ||
        req.originalUrl !== `/order-payments/${site}/${id}`) return res.sendStatus(404);
    const token = env[`ORDER_PAYMENTS_${site.toUpperCase()}_TOKEN`];
    if (network !== "eip155:8453" || !token || token.length < 32 || !env.MPP_SECRET_KEY) return res.sendStatus(404);
    const headers = new Headers();
    for (const name of forwarded) if (req.get(name)) headers.set(name, req.get(name));
    if (headers.has("authorization") && headers.has("payment-signature")) return res.sendStatus(400);
    const request = new Request(new URL(req.originalUrl, paymentOrigin), { headers });
    try {
      const response = await checkoutOrder({ request, merchant, facilitator, trust, secretKey: env.MPP_SECRET_KEY, client,
        owner: siteOrder(site, id, token, fetchImpl) });
      for (const name of ["payment-required", "www-authenticate", "content-type", "payment-response", "payment-receipt", "order-original-receipt"])
        if (response.headers.has(name)) res.set(name, response.headers.get(name));
      return res.status(response.status).send(await response.text());
    } catch {
      return res.status(503).json({ error: "order_status_unavailable", statusUrl: request.url });
    }
  });
}
