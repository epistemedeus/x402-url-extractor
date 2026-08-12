const TOOL_METADATA = Object.freeze({
  extract: {
    title: "Extract Web Page as Structured JSON",
    description: "Fetch a public HTTP(S) page and return compact extraction signals for programmatic inspection: title, meta description, Open Graph/Twitter metadata, JSON-LD, headings, links, text excerpt, and AI-readiness flags. Use `read` instead when you need the page body as LLM-ready Markdown rather than metadata or a link inventory. Does not execute JavaScript; follows redirects and applies SSRF, timeout, and response-size guards.",
  },
  read: {
    title: "Read Web Page as Markdown",
    description: "Fetch a public HTTP(S) page and return its readable body as cleaned Markdown for LLM context, preserving headings, links, and lists while dropping navigation, ads, scripts, headers, footers, asides, and forms. Use `extract` instead when you need metadata, JSON-LD, Open Graph/Twitter tags, or a link inventory. Markdown is capped at 40,000 characters and no JavaScript is executed.",
  },
  scan: {
    title: "Scan GitHub Repository Before Install",
  },
  schemaforge: {
    title: "Generate Business JSON-LD",
    description: "Analyze a public business site and return a deterministic, paste-ready JSON-LD template plus the live structured-data gap diff and ranked fixes. Use `deep_audit` instead when the same call must also return company, technology, contact, and DNS/email evidence. Generated markup contains placeholders that must be replaced with real business values; this tool makes no site changes and does not guarantee AI citations.",
  },
  enrich: {
    title: "Enrich Company Domain",
    description: "Inspect a public company domain and return structured identity, technology, social, contact, DNS, email-infrastructure, and AI-readiness evidence. Use `schemaforge` instead for a paste-ready JSON-LD template and remediation diff, or `deep_audit` when both outputs are required together. Public data only; this tool makes no site changes.",
  },
  wallet_enrich: {
    title: "Enrich Base Wallet or Contract",
    description: "Inspect a public Base or EVM address and return an agent-ready on-chain profile: EOA or contract type, native and curated token holdings, token/NFT metadata, proxy evidence, activity, and a derived profile label. Use `enrich` for a company domain; the two tools accept different identifiers and return different evidence. Read-only public chain data; no wallet action or custody.",
  },
  deep_audit: {
    title: "Audit Complete AI Search Readiness",
    description: "Run one read-only AI-search-readiness audit for a public business domain: company, technology, contact, and DNS/email evidence from `enrich`, plus the live structured-data gap analysis and paste-ready JSON-LD template from `schemaforge`. Use `enrich` for company facts only or `schemaforge` for structured-data remediation only. The template contains placeholders for real data; the score is diagnostic, no site changes are made, and it does not guarantee AI citations.",
  },
  morpho_position: {
    title: "Inspect Morpho Borrower Position",
    description: "Inspect one Base borrower across Morpho markets and return position balances, LTV, health factor, liquidation headroom, direct-RPC verification, and caller-selected collateral-price stress scenarios. Use `morpho_protection` when you need exact repay or add-collateral amounts and unsigned transaction templates, `morpho_market_underwrite` for market-wide risk, or `morpho_preliquidation_replay` for one completed historical event. Read-only; no wallet, signing, broadcast, or custody.",
  },
  morpho_protection: {
    title: "Plan Morpho Borrower Protection",
    description: "Calculate two alternative protection plans for one Base Morpho borrower under a selected collateral-price shock and target health factor: partial repayment or added collateral. Each plan includes the bounded asset amount, expected stressed health factor, evidence basis, and unsigned ERC-20 approval plus Morpho call templates. Use `morpho_position` for diagnosis without an action plan, `morpho_market_underwrite` for market-wide risk, or `morpho_preliquidation_replay` for a completed historical event. Read-only; no wallet, signing, broadcast, or custody.",
  },
  morpho_market_underwrite: {
    title: "Underwrite Morpho Market",
    description: "Underwrite one Base Morpho market with independent GraphQL, REST, and direct-RPC evidence for configuration integrity, liquidity, utilization, concentration, borrower health bands, recent history, bad debt, and PreLiquidation availability. Use `morpho_position` or `morpho_protection` for one borrower's current position or protection plan, and `morpho_preliquidation_replay` for the economics of one completed historical event. Read-only evidence with explicit disagreements; no opaque risk score or transaction action.",
  },
  morpho_preliquidation_replay: {
    title: "Replay Morpho PreLiquidation",
    description: "Reconstruct one successful Base Morpho PreLiquidation transaction from its receipt and the exact block state, returning repaid and seized assets, protocol-oracle valuation, gross incentive, configured health window, and transaction gas before off-chain costs. Use `morpho_market_underwrite` for current market risk, `morpho_position` for a current borrower, or `morpho_protection` for a future protection plan. Historical read-only evidence; no transaction simulation, wallet, signing, or broadcast.",
  },
  opportunity_preflight: {
    title: "Preflight Agent Work Opportunity",
  },
  agent_discoverability_audit: {
    title: "Audit Agent Service Discoverability",
    description: "Measure one service's brand-blind rank, source-family coverage, expected-route presence, competitors, and exact-price drift across ten public machine-service discovery views. Supply `runtimeUrl` with an exact route to derive the comparison price from one coherent live unsigned x402 or MPP offer; otherwise `expectedPriceUsd` remains caller-supplied. Set `surfaceAudit` only when you also want the target's public Agent Card, ERC-8004 registration document, and action catalog checked. Catalog queries use no credentials or payments, and runtime inspection is DNS-pinned, redirect-free, headers-only, and unsigned. Results are point-in-time reach and catalog-coherence evidence, not demand, seller trust, or future-rank proof.",
  },
  payment_offer_preflight: {
    title: "Preflight x402 and MPP Offer",
    description: "Compare x402 and MPP payment challenges and terms for one exact public HTTPS GET route before buyer authorization, including URL and realm binding, expiry, and cross-protocol economic parity. Use `agent_discoverability_audit` instead when you need to know whether catalogs rank or expose a service. This tool uses no target credential, signs and sends no target payment, follows no redirect, reads no response body, and does not establish seller trust or settlement reliability.",
  },
  settlement_proof: {
    title: "Verify Base USDC Settlement",
    description: "Verify one claimed canonical Base USDC settlement after execution by matching a successful transaction receipt to the exact recipient, atomic amount, and optional payer. Use `payment_offer_preflight` before authorization when you need to inspect an unpaid x402 or MPP offer instead. This tool reads only public Base receipt and log data; it reads no merchant ledger and performs no wallet, signing, broadcast, custody, or execution action.",
  },
  transaction_receipt: {
    title: "Inspect Transaction Receipt",
    description: "Inspect one Base or Ethereum transaction hash and return normalized success or revert status, block time, gas and fee fields, decoded ERC-20 Transfer events, and canonical USDC transfers. Use `settlement_proof` instead when you must verify an exact canonical Base USDC recipient, amount, and optional payer claim. Raw logs are excluded; this tool performs no wallet, signing, broadcast, custody, or execution action.",
  },
  solana_transaction_receipt: {
    title: "Inspect Solana Transaction Receipt",
    description: "Inspect one finalized Solana mainnet transaction signature and return normalized success or failure status, slot, block time, fee, SPL-token owner deltas, and canonical USDC deltas. Supply recipient, amount, and optional payer when an exact settlement claim must be verified; use `transaction_receipt` for Base or Ethereum. Raw instructions and logs are excluded, and this tool performs no wallet, signing, broadcast, custody, or execution action.",
  },
  wallet_policy_conformance: {
    title: "Evaluate Agent Wallet Policy Conformance",
    description: "Evaluate safe standardized allow, deny, and error observations from an agent wallet or delegated signer. Use this after running a bounded provider policy test matrix to distinguish explicit provider-policy enforcement from validation or generic provider failures and to test exact execution shape separately from operation allowlisting. Accepts no credentials, wallet IDs, signatures, transactions, or raw provider responses; it evaluates caller-supplied observations and does not run the provider tests itself.",
  },
  stateful_wallet_policy_conformance: {
    title: "Evaluate Stateful Wallet Policy Conformance",
    description: "Evaluate safe standardized observations from wallet policies that track prior or concurrent requests. Use `wallet_policy_conformance` instead for one-request action shape, method, chain, token, recipient, amount, and function controls. This tool separately tests sequential cumulative limits, signed-but-unbroadcast accounting, ABI extraction, concurrent oversubscription, counter-reference failure, and application serialization. It accepts no credentials, counter values, wallet or resource IDs, signatures, transactions, or raw provider responses and does not run the provider tests itself.",
  },
});

export function decorateMcpTool(tool) {
  if (!tool || typeof tool !== "object") throw new Error("MCP tool config is required");
  const name = String(tool.name || "");
  const metadata = TOOL_METADATA[name];
  if (!metadata) throw new Error(`Missing MCP selection metadata for ${name || "unnamed tool"}`);
  const baseDescription = String(tool.description || "").trim();
  if (!baseDescription) throw new Error(`Missing MCP description for ${name}`);
  return {
    ...tool,
    title: metadata.title,
    description: metadata.description || baseDescription,
  };
}

export function listMcpToolMetadata() {
  return Object.entries(TOOL_METADATA).map(([name, metadata]) => ({ name, ...metadata }));
}
