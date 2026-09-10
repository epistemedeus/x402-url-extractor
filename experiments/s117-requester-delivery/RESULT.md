# S117 result

- **Branch:** `codex/s117-requester-delivery-20260910`
- **Base:** `1a23b648e3c5f90bc009accb85972e2db6e22051`
- **Code commit:** `7febe94790f5e1697f38f58f83df56dd16a67bdf`
- **Docs/tip commit:** PLACEHOLDER
- **Tree:** `experiments/s117-requester-delivery/`
- **Live payment routes:** not edited

## Tests

```bash
export PATH="/home/ubuntu/.nvm/versions/node/v22.23.2/bin:$PATH"
cd experiments/s117-requester-delivery
npm test
```

35/35 passing (`node --test test/*.test.mjs`). Root product tests were not run; no root product files were changed.

## Artifacts

| Module | Requester residual |
| --- | --- |
| `src/settlement-txid.mjs` | aibtc #666 / Merit #922 settlement header recovery |
| `src/route-template.mjs` | x402-foundation #3439 Go/Python single-pass vs TS fixed-point |
| `src/paid-call-timeout.mjs` | #3439 MCP timeout + retry-after-timeout unsafety |
| `src/hung-upstream.mjs` | clawhub #3621 stalled well-known abort proof |
| `src/tightest-spend-limit.mjs` | jaw-mono #319 unreadable cap binds |
| `src/validate-index.mjs` | cdp-sdk #806 / HyperXosist #32 valid ≠ indexed |

## Provenance

- aibtc `main` still misses V2 `payment-response` / `payment.txid` (raw `endpoint.tools.ts`, 2026-09-10).
- aibtc PR #667 open, not merged. Portable lookup also covers V1 `x-payment-response`, MCP meta, and conflicts.
- Unpaid Vibewatch 402 + well-known independently observed 2026-09-10T09:14:12Z. Settlement **not** observed.
- Unpaid CDP `/validate`: FractalAI sign and HyperXosist query both `valid: true`, bazaar present, `index: null` at 2026-09-10T09:14:12Z.
- Evidence classes are labelled. Provided-report fixtures are not buyer proof.

## Not done

- No push, no merge of `master`, no external PR/comment, no new accounts.
- No payment, signature, broadcast, or paid model API.
- No competing PR against aibtc #667, x402 #3440/#3441/#3442/#3443, clawhub #3621, or jaw-mono #319.
- No live SameDayDesk homepage/payment-route edits.
- Did not redo Basepay, agentkit#813, MCP#4785 download report, LangChain#40333, Tracer#125, Merit#13, Agensi/Grexal/Dealwork, or published task toolkit.
- Local recipes do not fulfill the upstream requests.

Packets: 8 ranked + negatives in `PACKETS.md`.
