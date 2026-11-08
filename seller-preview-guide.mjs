const AUDIT_ROUTE = "/commerce/seller-integrity-audit";
const PREVIEW_REPO = "https://github.com/epistemedeus/agent-payment-integrity";
const PREVIEW_COMMIT = "f6acc1c56c6fd977608fb6c97c088d36ea27f955";

export function renderSellerPreviewGuide(origin, actions) {
  if (!actions.some((action) => (action.method || "GET").toUpperCase() === "GET" && action.route === AUDIT_ROUTE)) return "";
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return "";
  return `## Free seller preview

Check whether a public HTTPS GET route declares the output fields your agent needs before considering payment. Use the [pinned integrity CLI](${PREVIEW_REPO}/tree/${PREVIEW_COMMIT}); this runs in your own workspace. No wallet, credentials, signing, or payment.

\`\`\`sh
git clone ${PREVIEW_REPO}.git
cd agent-payment-integrity
git checkout --detach ${PREVIEW_COMMIT}
npm ci --ignore-scripts
node cli.mjs audit --origin ${url.origin} --method GET --route ${AUDIT_ROUTE} --required-paths report.findings,report.repairPlan.actions --max-routes 1 --format json --public-dns
\`\`\`

Replace the origin, route, and required paths with your own task. A missing required field means this route is not a fit for that task. A positive preview does not validate required query values or the paid response, and does not authorize spending. The hosted seller audit is a separate paid operation.
`;
}
