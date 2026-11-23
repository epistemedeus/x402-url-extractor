import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { refundTerms } from "./refund.mjs";
import { SITE_ORIGINS } from "./http.mjs";
import { publicHistoricalClient } from "../transaction-receipt.mjs";

// Root-only reservation and unsigned signing input. No signing or broadcasting implementation here.
export async function prepareRefund({ order, site, token, client, fetchImpl = fetch, now = Date.now }) {
  if (!Object.hasOwn(SITE_ORIGINS, site) || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(order) ||
      !token || token.length < 32) throw Error("expected enrolled site, payment reference and private admin credential");
  const call = async (action, body) => {
    const res = await fetchImpl(new URL(`/api/order-payments/refunds/${order}/${action}`, SITE_ORIGINS[site]), {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw Error("refund owner refused: " + res.status);
    return res.json();
  };
  const row = await call("read", {});
  if (row.refund) return { action: "read_status_only", state: row.refund.state, original: row.refund.original };
  if (!["paid", "held"].includes(row.state) || await client.getChainId() !== 8453) throw Error("ineligible refund");
  const from = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
  const refund = refundTerms(row.receipt, from, String((await client.getBlock({ blockTag: "latest" })).number), now());
  const result = await call("reserve", { refund });
  if (!result.won) return { action: "read_status_only", original: refund.original };
  return { action: "reserved_for_existing_signer", original: refund.original, typedData: refund.typedData };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [site, order] = process.argv.slice(2);
  if (!process.env.REFUND_ADMIN_TOKEN_FILE) throw Error("set REFUND_ADMIN_TOKEN_FILE to the protected file");
  const token = (await readFile(process.env.REFUND_ADMIN_TOKEN_FILE, "utf8")).trim();
  const result = await prepareRefund({ site, order, token, client: publicHistoricalClient("base") });
  console.log(JSON.stringify(result));
}
