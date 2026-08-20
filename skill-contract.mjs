import {
  formatSkillActionLine,
  formatSkillAlternateLine,
} from "./publication-examples.mjs";

function actionLines(actions, alternate = null) {
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new TypeError("actions must be a non-empty array");
  }
  const seen = new Set();
  const lines = actions.map((action) => {
    const key = `${String(action?.method || "").toUpperCase()} ${String(action?.route || "")}`;
    if (seen.has(key)) throw new TypeError(`duplicate action contract: ${key}`);
    seen.add(key);
    return formatSkillActionLine(action);
  });
  if (alternate) lines.push(formatSkillAlternateLine(alternate));
  return lines.join("\n");
}

export function buildSkillContract(publicUrl, actions, alternate = null) {
  const origin = new URL(publicUrl).origin;
  const actionsMarkdown = actionLines(actions, alternate);
  return `# SameDayDesk machine commerce gateway

Use this service when an agent needs deterministic web, company, wallet, AI-search-readiness, repository-risk, exact-action or stateful delegated-signer policy conformance, work-opportunity economics, cross-registry discoverability, x402 and MPP offer preflight, Morpho borrower risk, market underwriting, historical PreLiquidation replay, or unsigned Morpho protection plans and can pay exact USDC on Base through x402 or native MPP Payment authentication.

## Discover

- x402 manifest: ${origin}/.well-known/x402
- OpenAPI: ${origin}/openapi.json
- MPP discovery: ${origin}/mpp-openapi.json (per-operation offers)
- Action catalog: ${origin}/api/actions
- MCP transport: POST ${origin}/mcp
- A2A agent card: ${origin}/.well-known/agent-card.json
- Purchase evidence: ${origin}/.well-known/agent-payment-evidence.json

## Paid actions

${actionsMarkdown}

## Call and pay

1. Choose an action from the manifest or action catalog.
2. Send the exact declared method and input. GET lines above already include a bounded seller-authored callable example with every required non-secret query input. POST lines keep JSON schema/body examples and must not be transmitted from this document. Agent Skills clients should include X-SameDayDesk-Agent-Source: agent-skills-v1 on the initial request and paid replay. This declared label is attribution only, not authentication or payment. The Circle Gateway path is the same payment-offer preflight product, not a second catalog action.
3. One unpaid HTTP 402 carries x402 v2 payment requirements and a native MPP WWW-Authenticate Payment challenge.
4. Verify the HTTPS resource, exact amount, Base network, canonical USDC asset, and payTo wallet.
5. If your policy uses seller purchase evidence, follow the same-origin describedby link, verify its exact operation and digest, and bind it into authorization. It is seller-declared evidence, not permission to spend.
6. Pay through x402 and replay with PAYMENT-SIGNATURE, or pay through MPP and replay with Authorization: Payment.
7. Reconcile PAYMENT-RESPONSE for x402 or Payment-Receipt for MPP before continuing a workflow.

## Boundaries

- Payment-offer preflight compares one exact public HTTPS GET target's x402 and MPP challenges, binding, expiry, and economics before buyer authorization. Target inspection uses no credential, signs and sends no target payment, follows no redirect, and reads no target response body. A parseable offer is not permission to pay.
- Morpho output is a read-only indexed snapshot with deterministic stress calculations. Verify direct RPC state before any financial action.
- Morpho protection output is a deterministic quote plus unsigned templates. Re-read, simulate, and apply caller policy before signing elsewhere.
- Morpho market underwriting exposes separate evidence flags rather than one opaque risk score. The caller owns policy and any capital decision.
- Morpho PreLiquidation replay reconstructs gross historical event economics. It does not infer net profit or future executability.
- Repository scan output is static evidence, not permission to execute untrusted code.
- Wallet-policy conformance evaluates safe caller-supplied outcomes from a standardized provider test matrix. It accepts no credentials or raw provider payloads and does not independently run, sign, or verify those provider tests.
- Stateful wallet-policy conformance separately evaluates cumulative limits, signed-but-unbroadcast accounting, metric extraction, concurrent oversubscription, counter-reference failure, and application serialization. It accepts no counter values, resource IDs, credentials, or raw provider payloads and does not run concurrent requests itself.
- Opportunity preflight uses caller-supplied cost and selection assumptions plus dated categorical platform evidence. It makes no claim, bid, payment, or submission on the source platform.
- Agent discoverability audit sends one brand-blind capability intent to public catalogs. An explicit surfaceAudit option also checks three fixed public same-origin discovery documents with pinned public DNS, no redirects, bounded time, and bounded response size. It measures point-in-time rank and coverage, not demand, conversion, reliability, or future rank.
- Demand telemetry is aggregate and does not expose buyer identities or raw request data.
`;
}
