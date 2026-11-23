import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { directRefundTerms, verifyRefundSource } from "./refund.mjs";
import { SITE_ORIGINS, readSiteResult } from "./http.mjs";
import { publicHistoricalClient } from "../transaction-receipt.mjs";

// Root-only reservation and unsigned signing input. No signing or broadcasting implementation here.
export async function prepareRefund({ order, site, token, client, fetchImpl = fetch, now = Date.now, canonical = null, review = null }) {
  if (!Object.hasOwn(SITE_ORIGINS, site) || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(order) ||
      !token || token.length < 32) throw Error("expected enrolled site, payment reference and private admin credential");
  if (review !== null && !/^[0-9a-f]{64}$/.test(review)) throw Error("invalid payment review reference");
  const call = async (action, body) => {
    const res = await fetchImpl(new URL(`/api/order-payments/refunds/${order}/${action}`, SITE_ORIGINS[site]), {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(review ? {...body, review} : body), redirect: "error", signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw Error("refund owner refused: " + res.status);
    return readSiteResult(site, res);
  };
  const row = await call("read", {});
  if (!row) throw Error("payment effect not found");
  if (canonical) {
    const q=row.refund?.request;
    if (!q || canonical.schema!=="pilot.merchant-refund.canonical.v1" || canonical.role!=="merchant_refund" ||
        canonical.originalPayment!==q.original || canonical.order!==order || canonical.site!==site ||
        canonical.operationId!==q.operationId || canonical.exactTransferVerified!==true || canonical.status!=="success" ||
        canonical.network!==q.network || canonical.token?.toLowerCase()!==q.token.toLowerCase() ||
        canonical.source?.toLowerCase()!==q.merchant.toLowerCase() || canonical.recipient?.toLowerCase()!==q.payer.toLowerCase() ||
        canonical.amountAtomic!==q.amountAtomic || !/^0x[0-9a-f]{64}$/i.test(canonical.transactionHash) ||
        !Number.isSafeInteger(canonical.logIndex) || canonical.logIndex<0) throw Error("controller canonical refund mismatch");
    await call("bind",{original:q.original,operationId:q.operationId,transaction:canonical.transactionHash,transferLogIndex:canonical.logIndex});
    return {action:"read_original_order",resource:review ? row.resource + "/requests/" + review : row.resource};
  }
  if (row.refund) return { action: "read_status_only", state: row.refund.state, original: row.refund.original,
    ...(row.refund.request && { existingIntent:row.refund.request }) };
  if (!["paid", "held"].includes(row.state) || await client.getChainId() !== 8453) throw Error("ineligible refund");
  const from = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
  await verifyRefundSource(client,row,from,now());
  const refund = directRefundTerms(row,site,from);
  const result = await call("reserve", { refund });
  if (!result.won) return { action: "read_status_only", original: refund.original };
  return { action: "reserved_for_controller", original:refund.original, originalPayment:refund.request };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [site, order, ...args] = process.argv.slice(2);
  let review = null;
  if (args[0] === "--review") {
    args.shift();
    review = args.shift();
  }
  if (review === undefined) throw Error("expected a payment review reference");
  const [mode,file] = args;
  if (args.length > 2) throw Error("unexpected refund arguments");
  if (mode && (mode!=="--receive" || !file)) throw Error("expected --receive PRIVATE_CANONICAL_FILE");
  if (!process.env.REFUND_ADMIN_TOKEN_FILE) throw Error("set REFUND_ADMIN_TOKEN_FILE to the protected file");
  const token = (await readFile(process.env.REFUND_ADMIN_TOKEN_FILE, "utf8")).trim();
  const result = await prepareRefund({ site, order, token, review, canonical:file ? JSON.parse(await readFile(file,"utf8")) : null, client: publicHistoricalClient("base") });
  console.log(JSON.stringify(result));
}
