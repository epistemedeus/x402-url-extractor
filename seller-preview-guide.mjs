const AUDIT_ROUTE = "/commerce/seller-integrity-audit";
const PREVIEW_INSTALL = "https://github.com/epistemedeus/agent-payment-integrity#try-it";
const PREVIEW_INDEX = "https://neomorphic.io/api/v1/instruments";
const PREVIEW_ID = "seller-conformance";
const REQUIRED_PATHS = ["report.findings", "report.repairPlan.actions"];

export function sellerPreviewDiscovery(origin, method, route) {
  if (method !== "GET" || route !== AUDIT_ROUTE) return null;
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
  return {
    kind: "local-cli",
    charged: false,
    paymentRequired: false,
    instrument: { indexUrl: PREVIEW_INDEX, id: PREVIEW_ID, releasePointer: "/source/url" },
    installGuideUrl: PREVIEW_INSTALL,
    checks: ["declared_output_fields", "unsigned_payment_offer"],
    verifiesPaidDelivery: false,
    example: {
      command: "audit",
      origin: url.origin,
      method,
      route,
      requiredPaths: [...REQUIRED_PATHS],
      maxRoutes: 1,
      publicDns: true,
    },
  };
}

export function renderSellerPreviewGuide(origin, actions) {
  if (!actions.some((action) => (action.method || "GET").toUpperCase() === "GET" && action.route === AUDIT_ROUTE)) return "";
  const preview = sellerPreviewDiscovery(origin, "GET", AUDIT_ROUTE);
  if (!preview) return "";
  const { example, instrument, installGuideUrl } = preview;
  return `## Free seller preview

Check whether a public HTTPS GET route declares the output fields your agent needs. Use the [publisher's clone-free installation](${installGuideUrl}) with Node.js 22 or newer and npm. For machine discovery, read the [instrument index](${instrument.indexUrl}) and select the entry with id \`${instrument.id}\`. Its \`source.url\` points to the exact release in \`epistemedeus/agent-payment-integrity\`. Use that release's CLI archive and checksum together, verify the archive, and run the command below. No Git checkout, wallet, credentials, signing, or payment.

\`\`\`sh
npm exec --yes --ignore-scripts --package="./$package" -- agent-payment-integrity ${example.command} --origin ${example.origin} --method ${example.method} --route ${example.route} --required-paths ${example.requiredPaths.join(",")} --max-routes ${example.maxRoutes} --format json --public-dns
\`\`\`

Here \`package\` is the local archive filename from the publisher's instructions. Replace the origin, route, and required paths for your task. The check builds its unsigned request from public OpenAPI examples. A missing required field means the route is not a fit. A verified challenge does not validate your private input or the paid response, and does not authorize spending. If the free check answers your question, stop there. The hosted seller audit is a separate paid operation.
`;
}
