function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function wantsGatewayHtml(accept) {
  const value = String(accept || "").toLowerCase();
  return value.includes("text/html") && !value.includes("application/json");
}

function routeCard([route, detail]) {
  const [price = "", ...rest] = String(detail).split(" - ");
  const description = rest.join(" - ") || detail;
  return `<article class="tool">
    <div class="tool-top"><code>${escapeHtml(route)}</code><span>${escapeHtml(price)}</span></div>
    <p>${escapeHtml(description)}</p>
  </article>`;
}

export function renderGatewayLanding(gateway) {
  const routes = Object.entries(gateway?.paidRoutes || {});
  const protocols = Array.isArray(gateway?.machineCommerce?.paymentProtocols)
    ? gateway.machineCommerce.paymentProtocols
    : [];
  const descriptor = JSON.stringify({
    service: gateway?.service,
    paymentProtocols: protocols,
    manifest: gateway?.machineCommerce?.manifest,
    openapi: gateway?.machineCommerce?.openapi,
    network: gateway?.network,
    payTo: gateway?.payTo,
  }, null, 2);
  const structuredData = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebAPI",
    name: gateway?.service,
    description: gateway?.what,
    documentation: "https://samedaydesk.com/x402",
    provider: { "@type": "Organization", name: "SameDayDesk", url: "https://samedaydesk.com" },
  }).replaceAll("<", "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SameDayDesk Agent Payment Gateway</title>
  <meta name="description" content="Twelve deterministic pay-per-call tools accepting x402 and native MPP with Base USDC settlement.">
  <link rel="canonical" href="https://agents.samedaydesk.com/">
  <script type="application/ld+json">${structuredData}</script>
  <style>
    :root { color-scheme: dark; --bg:#0b0d0c; --panel:#121613; --ink:#f4f0e7; --muted:#a9b0a7; --line:#293029; --lime:#c8f45b; --rust:#ef7758; --mono:ui-monospace,SFMono-Regular,Menlo,monospace; --sans:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    * { box-sizing:border-box; }
    html { scroll-behavior:smooth; }
    body { margin:0; background:radial-gradient(circle at 78% 8%,rgba(200,244,91,.11),transparent 31rem),var(--bg); color:var(--ink); font-family:var(--sans); line-height:1.55; }
    a { color:inherit; }
    .shell { width:min(1180px,calc(100% - 2rem)); margin:auto; }
    nav { min-height:76px; display:flex; align-items:center; justify-content:space-between; gap:1rem; border-bottom:1px solid var(--line); }
    .brand { display:flex; align-items:center; gap:.7rem; font-weight:750; text-decoration:none; letter-spacing:-.02em; }
    .mark { width:28px; height:28px; display:grid; place-items:center; border-radius:8px; background:var(--lime); color:#12160b; font:800 13px var(--mono); }
    .nav-links { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:.55rem; }
    .chip,.button { border:1px solid var(--line); border-radius:999px; padding:.55rem .8rem; text-decoration:none; font:650 .78rem var(--mono); }
    .chip { color:var(--muted); }
    .hero { padding:clamp(4rem,10vw,8rem) 0 4rem; display:grid; grid-template-columns:minmax(0,1.15fr) minmax(310px,.85fr); gap:clamp(2rem,6vw,5rem); align-items:end; }
    .eyebrow { margin:0 0 1rem; color:var(--lime); font:700 .76rem var(--mono); letter-spacing:.14em; text-transform:uppercase; }
    h1 { max-width:13ch; margin:0; font-size:clamp(3rem,7vw,6.7rem); line-height:.92; letter-spacing:-.07em; }
    h1 span { color:var(--rust); }
    .lead { max-width:60ch; margin:1.6rem 0 0; color:var(--muted); font-size:clamp(1rem,1.8vw,1.22rem); }
    .actions { display:flex; flex-wrap:wrap; gap:.7rem; margin-top:1.8rem; }
    .button { padding:.78rem 1rem; background:var(--lime); border-color:var(--lime); color:#11150b; }
    .button.secondary { background:transparent; border-color:#505950; color:var(--ink); }
    .machine-card { min-width:0; border:1px solid var(--line); border-radius:18px; background:rgba(18,22,19,.88); overflow:hidden; box-shadow:0 30px 90px rgba(0,0,0,.32); }
    .machine-card header { display:flex; justify-content:space-between; gap:1rem; padding:.85rem 1rem; border-bottom:1px solid var(--line); color:var(--muted); font:650 .72rem var(--mono); }
    pre { margin:0; padding:1.15rem; color:#d7e7c8; font:500 .76rem/1.65 var(--mono); white-space:pre-wrap; overflow-wrap:anywhere; }
    .metrics { display:grid; grid-template-columns:repeat(3,1fr); border-block:1px solid var(--line); }
    .metric { padding:1.4rem; }
    .metric + .metric { border-left:1px solid var(--line); }
    .metric strong { display:block; font-size:clamp(1.5rem,3vw,2.5rem); letter-spacing:-.04em; }
    .metric span { color:var(--muted); font:600 .7rem var(--mono); text-transform:uppercase; letter-spacing:.1em; }
    section { padding:4.5rem 0; border-bottom:1px solid var(--line); }
    .section-head { display:grid; grid-template-columns:.75fr 1.25fr; gap:2rem; margin-bottom:2rem; }
    h2 { margin:0; max-width:16ch; font-size:clamp(2rem,4vw,3.8rem); line-height:1; letter-spacing:-.055em; }
    .section-head p { margin:0; max-width:62ch; color:var(--muted); }
    .flow { display:grid; grid-template-columns:repeat(5,1fr); gap:.7rem; counter-reset:step; }
    .step { min-width:0; padding:1.2rem; border:1px solid var(--line); border-radius:14px; background:var(--panel); }
    .step::before { counter-increment:step; content:"0" counter(step); display:block; margin-bottom:1.7rem; color:var(--lime); font:700 .72rem var(--mono); }
    .step strong { display:block; }
    .step span { color:var(--muted); font-size:.9rem; }
    .tools { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:.75rem; }
    .tool { min-width:0; padding:1.2rem; border:1px solid var(--line); border-radius:14px; background:linear-gradient(145deg,rgba(255,255,255,.025),transparent); }
    .tool-top { display:flex; align-items:flex-start; justify-content:space-between; gap:1rem; }
    .tool code { min-width:0; color:var(--lime); font:650 .82rem var(--mono); overflow-wrap:anywhere; }
    .tool span { flex:none; padding:.25rem .48rem; border:1px solid #46522c; border-radius:999px; color:var(--lime); font:700 .72rem var(--mono); }
    .tool p { margin:.8rem 0 0; color:var(--muted); font-size:.9rem; }
    .boundary { display:grid; grid-template-columns:1fr 1fr; gap:1rem; }
    .boundary article { padding:1.5rem; border:1px solid var(--line); border-radius:16px; }
    .boundary h3 { margin:0 0 .65rem; font-size:1rem; }
    .boundary p { margin:0; color:var(--muted); }
    footer { padding:2rem 0 3rem; display:flex; justify-content:space-between; flex-wrap:wrap; gap:1rem; color:var(--muted); font-size:.86rem; }
    @media (max-width:800px) { .hero,.section-head,.boundary { grid-template-columns:1fr; } .hero { padding-top:3rem; } .flow { grid-template-columns:1fr 1fr; } .tools { grid-template-columns:1fr; } }
    @media (max-width:520px) { nav { align-items:flex-start; padding:1rem 0; } .nav-links .chip:not(:first-child) { display:none; } .metrics { grid-template-columns:1fr; } .metric + .metric { border-left:0; border-top:1px solid var(--line); } .flow { grid-template-columns:1fr; } h1 { font-size:3.3rem; } }
  </style>
</head>
<body>
  <div class="shell">
    <nav>
      <a class="brand" href="https://samedaydesk.com"><span class="mark">SD</span><span>SameDayDesk / Agent Gateway</span></a>
      <div class="nav-links"><a class="chip" href="/.well-known/x402">x402 manifest</a><a class="chip" href="/mpp-openapi.json">MPP discovery</a><a class="chip" href="/openapi.json">OpenAPI</a></div>
    </nav>
    <main>
      <div class="hero">
        <div>
          <p class="eyebrow">Live machine commerce on Base</p>
          <h1>Agent infrastructure humans can <span>inspect.</span></h1>
          <p class="lead">${escapeHtml(gateway?.what)} Every paid route offers the same economics through x402 and native MPP, with machine-readable discovery and reconciled settlement evidence.</p>
          <div class="actions"><a class="button" href="https://samedaydesk.com/x402">Human guide and seller integration</a><a class="button secondary" href="/openapi.json">Inspect the API contract</a></div>
        </div>
        <aside class="machine-card"><header><span>GET /</span><span>application/json</span></header><pre>${escapeHtml(descriptor)}</pre></aside>
      </div>
      <div class="metrics"><div class="metric"><strong>${routes.length}</strong><span>paid tools</span></div><div class="metric"><strong>${escapeHtml(protocols.join(" + "))}</strong><span>payment protocols</span></div><div class="metric"><strong>Base</strong><span>USDC settlement</span></div></div>
      <section>
        <div class="section-head"><div><p class="eyebrow">The machine path</p><h2>Discover, verify, pay, continue.</h2></div><p>Agents do not need a dashboard account or prepaid balance. They inspect a declared route, receive a payment challenge, authorize the exact amount, call the tool, and retain a protocol receipt for reconciliation and safe replay.</p></div>
        <div class="flow"><div class="step"><strong>Discover</strong><span>OpenAPI, x402, MPP, MCP, or A2A</span></div><div class="step"><strong>Validate</strong><span>Schema, request binding, price, and recipient</span></div><div class="step"><strong>Pay</strong><span>Choose x402 or native MPP</span></div><div class="step"><strong>Receive</strong><span>Deterministic JSON plus receipt</span></div><div class="step"><strong>Reconcile</strong><span>Verify settlement and replay safely</span></div></div>
      </section>
      <section id="tools">
        <div class="section-head"><div><p class="eyebrow">Live inventory</p><h2>Twelve focused machine calls.</h2></div><p>The gateway covers web extraction, security, company and wallet intelligence, AI-readiness evidence, Morpho decisions, and agent-work economics. Prices are per successful call.</p></div>
        <div class="tools">${routes.map(routeCard).join("")}</div>
      </section>
      <section>
        <div class="section-head"><div><p class="eyebrow">One URL, two audiences</p><h2>The interface stays machine-first.</h2></div><p>Browser navigation requests HTML and receives this map. API clients that request JSON, plus clients using a generic wildcard accept header, continue to receive the stable gateway descriptor. Discovery manifests remain the authoritative contracts.</p></div>
        <div class="boundary"><article><h3>For agents</h3><p>Start with <a href="/.well-known/x402">the x402 manifest</a>, <a href="/mpp-openapi.json">MPP discovery</a>, <a href="/openapi.json">OpenAPI</a>, <a href="/llms.txt">llms.txt</a>, or the <a href="/.well-known/agent-card.json">A2A card</a>.</p></article><article><h3>For builders and sellers</h3><p>Read the <a href="https://samedaydesk.com/x402">human integration guide</a>, inspect the production dual-stack middleware, or request a founding x402 and MPP seller integration.</p></article></div>
      </section>
    </main>
    <footer><span>SameDayDesk machine commerce gateway</span><span>Network ${escapeHtml(gateway?.network)} · payTo ${escapeHtml(String(gateway?.payTo || "").slice(0,8))}…${escapeHtml(String(gateway?.payTo || "").slice(-6))}</span></footer>
  </div>
</body>
</html>`;
}
