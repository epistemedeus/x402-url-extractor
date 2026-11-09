const AUDIT_ROUTE = "/commerce/seller-integrity-audit";
const PREVIEW_INSTALL = "https://github.com/epistemedeus/agent-payment-integrity#try-it";
const PREVIEW_INDEX = "https://neomorphic.io/api/v1/instruments";

export function renderSellerPreviewGuide(origin, actions) {
  if (!actions.some((action) => (action.method || "GET").toUpperCase() === "GET" && action.route === AUDIT_ROUTE)) return "";
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return "";
  return `## Free seller preview

Check whether a public HTTPS GET route declares the output fields your agent needs. Use the [publisher's clone-free installation](${PREVIEW_INSTALL}) with Node.js 22 or newer and npm. For machine discovery, read the [instrument index](${PREVIEW_INDEX}) and select the entry with id \`seller-conformance\`. Its \`source.url\` points to the exact release in \`epistemedeus/agent-payment-integrity\`. Use that release's CLI archive and checksum together, verify the archive, and run the command below. No Git checkout, wallet, credentials, signing, or payment.

\`\`\`sh
npm exec --yes --ignore-scripts --package="./$package" -- agent-payment-integrity audit --origin ${url.origin} --method GET --route ${AUDIT_ROUTE} --required-paths report.findings,report.repairPlan.actions --max-routes 1 --format json --public-dns
\`\`\`

Here \`package\` is the local archive filename from the publisher's instructions. Replace the origin, route, and required paths for your task. The check builds its unsigned request from public OpenAPI examples. A missing required field means the route is not a fit. A verified challenge does not validate your private input or the paid response, and does not authorize spending. If the free check answers your question, stop there. The hosted seller audit is a separate paid operation.
`;
}
