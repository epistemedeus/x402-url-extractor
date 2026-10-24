# Independent merchant channel recovery

Source qualification only. Root owns installation, live configuration and storage
receiving. An independently qualified route can be restored while CDP/Vibes issuer
recovery remains open. Omitting a key does not revoke it.

Use the exact implementation commit/tree in
[the worker handback](reviews/root5640-independent-recovery/WORKER-HANDBACK.md),
from canonical `https://github.com/epistemedeus/x402-url-extractor.git`, branch
`codex/root5640-merchant-independent-recovery-20261024`. Its base is
`d9a409147f5af1971b1e1b6764e46777b40176e8`, tree
`2b625ac767c5a3622f6084c47da87ab4355d5b34`. This base already contains the accepted
`988c14745c039785bd54e4a4515de20653dbaf83` cutover correction through merge
`8d0522b6`; do not replace it with the older credential-cutover branch.

1. Receive the intended installed commit/tree, deployment identity, original
   volume and retained financial rows, claim markers, offers, terms and debts.
   Do not reset or migrate stores to make readiness green. No source test here
   authorizes a deployment or demonstrates that installation occurred.
2. Configure `VIBES_CODED_ENABLED=false`, `FACILITATOR=xpay`,
   `FACILITATOR_URL=https://facilitator.xpay.sh`, `NETWORK=eip155:8453` and the
   merchant's retained `PAY_TO`/`PUBLIC_URL`. Omit `VIBES_CODED_API_KEY`,
   `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET`. Keep unrelated qualified capabilities
   and exact settlement terms. Unset Vibes remains enabled for compatibility;
   accepted explicit values are `true`, `false`, `1`, `0` (case/space normalized).
   Empty or misspelled values refuse startup. Unknown facilitator names refuse;
   CDP selection still requires its own credentials and never falls back to xpay.
3. Root must install and receive the owned current generation for each restored
   consumer: owner token (including any separately restored gateway injection),
   actor secret, feedback key and receipt signer. Receive the existing MPP secret
   decision separately. Never reuse affected old authority or copy secrets into
   this recipe. Follow [credential cutover continuity](credential-cutover-continuity.md)
   for exact generation boundaries; it remains authoritative for retained rights.
4. Preserve old cached receipt bytes/kids and referral consumption markers.
   `RECEIPT_RETIRED_SIGNERS` contains public addresses only and grants no trust.
   Consumed old claims remain 409; unconsumed retired proofs remain unresolved
   503, without a new marker or repricing. Active replay rows from an unknown
   generation stay quarantined: HTTP refuses before verification/settlement;
   native recovery preserves unknown prior spend as `charged:null`, including
   unreadable state. Receive normal expiry and preserved results; never delete
   replay state to force a miss. Old HMAC coverage cuts are unauthenticated
   metadata, not lost journal rows or new coverage. With current owner authority,
   take a fresh finite POST `/v0/ordinary-delivery-join.json` baseline and GET
   readback; retain partial/unknown historical coverage and actor-epoch limits.
5. Before serving, receive `/healthz` with `channels.vibesCoded.enabled:false`,
   reason `disabled_by_configuration`, and unchanged independent route terms.
   HEAD and POST `/integrations/vibes/agent-discoverability-audit`, including
   missing/invalid tickets and malformed JSON, must return 503
   `vibes_channel_disabled` before outbound or durable-write attempts. That
   response's `charged:false` describes no new merchant charge; it does not
   establish what an upstream issuer previously charged or refunded. The channel
   has no enabled mount and is absent from action/OpenAPI/x402 availability.
6. Receive an unsigned ordinary x402 402 challenge and the SDK's supported-kind
   read without CDP authentication: exact Base, canonical USDC, exact existing
   amount/payee and request resource. Supported-kind advertisement proves no
   actual verification, settlement, delivery or issuer revocation. Receive any
   authorized real ordinary delivery, receipt, feedback and retained-state
   continuity separately; do not make a payment just to green this source task.
7. Run `NODE_OPTIONS=--max-old-space-size=384 npm run test:independent-recovery`.
   It uses serial processes, disposable state and loopback providers. It receives
   disabled refusals with/without a supplied synthetic key, both receipt seams,
   legacy enabled success/failed receipt/replay, restart recovery, malformed config,
   exact SDK terms, cutover/referral/replay continuity and related machine callers.
   In live configuration, re-enable Vibes only after its separate authority and
   consumer contract are received; issuer recovery remains Root's responsibility.

The repair adds no payment adapter, failed-payment fallback, historical trust
archive, obligation ledger or human presentation change. The optional live xpay
GET was not performed; all new provider behavior evidence is synthetic/local.
