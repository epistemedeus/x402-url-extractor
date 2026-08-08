import { RADAR_DISCLAIMER } from "./platform-health.mjs";

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const titleCase = (value) =>
  String(value)
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

const date = (value) =>
  new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));

const css = `
:root { color-scheme: dark; --bg:#07100d; --panel:#0d1914; --ink:#effff6; --muted:#9ab5a7; --line:#223d30; --lime:#b8ff68; --amber:#ffcb6b; --red:#ff7b72; --blue:#77c8ff; }
* { box-sizing:border-box; }
body { margin:0; background:radial-gradient(circle at 15% 0%,#143023 0,#07100d 42%); color:var(--ink); font:16px/1.55 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
a { color:var(--lime); }
.shell { width:min(1120px,calc(100% - 32px)); margin:0 auto; padding:38px 0 70px; }
.eyebrow { color:var(--lime); font:700 12px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:.14em; text-transform:uppercase; }
h1 { max-width:850px; margin:12px 0 16px; font-size:clamp(36px,7vw,72px); line-height:.98; letter-spacing:-.055em; }
h2 { margin:0; font-size:25px; letter-spacing:-.025em; }
h3 { margin:0 0 8px; font-size:16px; }
.lede { max-width:760px; margin:0; color:#c7ddd1; font-size:19px; }
.nav { display:flex; flex-wrap:wrap; gap:10px; margin:28px 0 34px; }
.button { display:inline-flex; align-items:center; min-height:42px; padding:9px 14px; border:1px solid var(--line); border-radius:999px; color:var(--ink); text-decoration:none; background:#0b1712; }
.button.primary { color:#07100d; background:var(--lime); border-color:var(--lime); font-weight:800; }
.grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(290px,1fr)); gap:14px; }
.card { display:block; padding:20px; border:1px solid var(--line); border-radius:20px; background:linear-gradient(145deg,rgba(18,39,29,.96),rgba(9,20,15,.96)); color:inherit; text-decoration:none; box-shadow:0 16px 44px rgba(0,0,0,.18); }
.card:hover { border-color:#548262; transform:translateY(-1px); }
.card-head { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; }
.pill { display:inline-flex; padding:5px 8px; border-radius:999px; border:1px solid currentColor; color:var(--amber); font:700 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:.04em; }
.pill.fresh { color:var(--lime); }
.pill.stale { color:var(--red); }
.meta { display:flex; flex-wrap:wrap; gap:8px 16px; margin-top:14px; color:var(--muted); font-size:13px; }
.note { color:#bdd3c7; }
.section { margin-top:32px; padding:24px; border:1px solid var(--line); border-radius:20px; background:rgba(10,24,17,.8); }
.evidence { display:grid; gap:12px; padding:0; list-style:none; }
.evidence li { padding:16px; border-left:3px solid #416e51; background:#0b1712; }
.code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; color:var(--blue); overflow-wrap:anywhere; }
.warning { padding:14px 16px; border:1px solid #735a23; border-radius:14px; color:#ffe0a0; background:#241e0d; }
.footer { margin-top:36px; padding-top:22px; border-top:1px solid var(--line); color:var(--muted); font-size:13px; }
ul.clean { padding-left:19px; }
@media (max-width:600px) { .shell { width:min(100% - 20px,1120px); padding-top:24px; } .section,.card { border-radius:16px; } }
`;

const layout = ({ title, description, body }) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <style>${css}</style>
</head>
<body><main class="shell">${body}</main></body>
</html>`;

const freshnessPill = (card) =>
  `<span class="pill ${escapeHtml(card.freshness)}">${escapeHtml(card.freshness)}</span>`;

const longDisclaimer = () => `<details class="section"><summary>Full v0 disclaimer</summary><ol class="clean">${RADAR_DISCLAIMER.long
  .map((item) => `<li>${escapeHtml(item)}</li>`)
  .join("")}</ol></details>`;

export function renderPlatformIndex(cards) {
  const body = `
    <div class="eyebrow">SameDayDesk Settlement Radar v0</div>
    <h1>Platform health from work we actually tried.</h1>
    <p class="lede">Five versioned, incident-backed health cards for agent work markets. Categories show what was observed. They do not predict your payout.</p>
    <nav class="nav">
      <a class="button primary" href="/alerts">Join the $19 alert pilot</a>
      <a class="button" href="/v0/cards.json">Download JSON</a>
      <a class="button" href="/platforms/methodology">Methodology</a>
    </nav>
    <section class="grid">
      ${cards
        .map(
          (card) => `<a class="card" href="/platforms/${escapeHtml(card.platform_id)}">
            <div class="card-head"><div><div class="eyebrow">N=${card.sample_count} · ${escapeHtml(card.confidence)} confidence</div><h2>${escapeHtml(card.platform_name)}</h2></div>${freshnessPill(card)}</div>
            <p><span class="pill">${escapeHtml(card.health_category)}</span></p>
            <p class="note">${escapeHtml(card.current_platform_state.notes)}</p>
            <div class="meta"><span>Observed ${escapeHtml(date(card.observed_at))}</span><span>${card.evidence.length} evidence item(s)</span></div>
          </a>`
        )
        .join("")}
    </section>
    ${longDisclaimer()}
    <footer class="footer">${escapeHtml(RADAR_DISCLAIMER.short)} Corrections: <a href="mailto:${escapeHtml(RADAR_DISCLAIMER.correctionEmail)}?subject=radar-correction">${escapeHtml(RADAR_DISCLAIMER.correctionEmail)}</a>.</footer>`;
  return layout({
    title: "Settlement Radar | SameDayDesk",
    description: "Incident-backed health cards for agent work platforms.",
    body,
  });
}

export function renderPlatformCard(card) {
  const stale = card.freshness === "stale"
    ? `<p class="warning">This card is outside its freshness window. Reverify every fact at the primary platform before acting.</p>`
    : "";
  const evidence = card.evidence
    .map(
      (item) => `<li>
        <div class="eyebrow">${escapeHtml(item.fact_class)} · ${escapeHtml(item.source_type)} · ${escapeHtml(date(item.observed_at))}</div>
        <p>${escapeHtml(item.summary)}</p>
        <div class="meta"><span>Stage: ${escapeHtml(item.stage_reached || "unknown")}</span>${item.failed_at ? `<span>Failed at: ${escapeHtml(item.failed_at)}</span>` : ""}</div>
        <a href="${escapeHtml(item.source_url)}" rel="noreferrer">Primary evidence</a>
      </li>`
    )
    .join("");
  const body = `
    <div class="eyebrow">SameDayDesk Settlement Radar v0</div>
    <h1>${escapeHtml(card.platform_name)}</h1>
    <p class="lede"><span class="pill">${escapeHtml(card.health_category)}</span> ${freshnessPill(card)}</p>
    <nav class="nav"><a class="button" href="/platforms">All platforms</a><a class="button" href="/v0/cards.json">JSON</a><a class="button" href="${escapeHtml(card.primary_url)}" rel="noreferrer">Primary platform</a></nav>
    ${stale}
    <section class="section">
      <h2>Observed state</h2>
      <p>${escapeHtml(card.current_platform_state.notes)}</p>
      <div class="meta"><span>Sample count: ${card.sample_count}</span><span>Confidence: ${escapeHtml(card.confidence)}</span><span>Rights: ${escapeHtml(card.rights_class)}</span><span>Fresh until: ${escapeHtml(date(card.fresh_until))}</span></div>
      <p class="code">Settlement: ${escapeHtml(card.settlement_mechanism.join(" + "))}</p>
    </section>
    <section class="section"><h2>Evidence</h2><ul class="evidence">${evidence}</ul></section>
    <section class="section"><h2>Unknowns</h2><ul class="clean">${card.unknowns.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>
    ${longDisclaimer()}
    <footer class="footer">${escapeHtml(RADAR_DISCLAIMER.short)} Corrections: <a href="mailto:${escapeHtml(RADAR_DISCLAIMER.correctionEmail)}?subject=radar-correction%20${escapeHtml(card.platform_id)}">${escapeHtml(RADAR_DISCLAIMER.correctionEmail)}</a>.</footer>`;
  return layout({
    title: `${card.platform_name} health | SameDayDesk`,
    description: `${titleCase(card.health_category)} with ${card.sample_count} SameDayDesk observation(s).`,
    body,
  });
}

export function renderMethodology() {
  const body = `
    <div class="eyebrow">SameDayDesk Settlement Radar v0</div>
    <h1>Evidence before rankings.</h1>
    <p class="lede">The radar reports dated incidents and public platform state. It does not assign a numerical trust score or payout probability.</p>
    <nav class="nav"><a class="button" href="/platforms">All platforms</a><a class="button" href="/schemas/platform-health-card-v0.json">JSON schema</a></nav>
    <section class="section"><h2>Evidence classes</h2><p>First-person attempts, public APIs, public pages, vendor claims, directory claims, on-chain receipts, derived categorical labels, and explicit unknowns stay separate.</p></section>
    <section class="section"><h2>Attempt ladder</h2><p class="code">listed → discoverable → claimable → submit_ok → verify_start → verify_pass → paid</p><p>We record the first stage that was not reached. A claim, accepted upload, or transaction request is not payment.</p></section>
    <section class="section"><h2>Freshness</h2><ul class="clean"><li>Current platform state: 24 hours</li><li>Inventory live badge: 12 hours</li><li>Stable incident category: 7 days</li><li>Green or yellow canary: 24 hours</li></ul></section>
    <section class="section"><h2>Corrections</h2><p>Send counter-evidence to <a href="mailto:${escapeHtml(RADAR_DISCLAIMER.correctionEmail)}?subject=radar-correction">${escapeHtml(RADAR_DISCLAIMER.correctionEmail)}</a>. We issue a new card version, link the prior card, and retain the history.</p></section>
    ${longDisclaimer()}
    <footer class="footer">${escapeHtml(RADAR_DISCLAIMER.short)}</footer>`;
  return layout({
    title: "Radar methodology | SameDayDesk",
    description: "Evidence classes, freshness, corrections, and boundaries for SameDayDesk Settlement Radar v0.",
    body,
  });
}

export function renderAlertPilot() {
  const subject = encodeURIComponent("Settlement Radar alert pilot");
  const message = encodeURIComponent(
    "I run agents on work boards and want the $19/month material-change alert pilot.\n\nPrimary platforms:\nPreferred delivery: email or webhook\n"
  );
  const body = `
    <div class="eyebrow">14-day demand test</div>
    <h1>Material changes, not another bounty firehose.</h1>
    <p class="lede">The pilot sends an alert when an observed platform moves out of a freeze, verifier block, empty state, or other material condition. Early price: $19 per month when seats open.</p>
    <nav class="nav"><a class="button primary" href="mailto:${escapeHtml(RADAR_DISCLAIMER.correctionEmail)}?subject=${subject}&body=${message}">Join the alert pilot</a><a class="button" href="/platforms">View free health cards</a></nav>
    <section class="section"><h2>What the pilot includes</h2><ul class="clean"><li>Material-change email alerts</li><li>Evidence link and JSON snapshot</li><li>No promise of a bounty win</li><li>No raw inventory spam</li><li>Cancel anytime before a paid seat opens</li></ul></section>
    ${longDisclaimer()}
    <footer class="footer">Joining by email is an intentional waitlist signal. No payment is collected yet. ${escapeHtml(RADAR_DISCLAIMER.short)}</footer>`;
  return layout({
    title: "Settlement Radar alert pilot | SameDayDesk",
    description: "Join the $19 material-change alert pilot for agent work platforms.",
    body,
  });
}
