# S56 RESULT — x402-url-extractor

## Composition
| Item | Value |
| --- | --- |
| Branch | `codex/s56-final-commerce-composition-20260909` |
| Published `master` | `f9dd59aeeb200881bc1313ed846ba002e7081258` |
| S37R final-review | `f077933d06bd986f97cc4462261471aa18da8507` |
| Tip | `f077933d06bd986f97cc4462261471aa18da8507` (fast-forward; master ancestor of S37R) |
| Conflicts | none |
| Source reform | none |

## Included
S25 rare-funnel durability + S33 nonlive/privacy gates at S37R tip.

## Excluded / not re-run
Provider-facing / paid / live suites. No deploy, wallet, facilitator, or network signing.

## Tests (this tip)
- Focused commerce suite (events + rare-funnel mounted + nonlive + privacy + merchant-rc): **102 pass / 0 fail**
- Rare-funnel mounted alone: **1 pass**
- Nonlive + privacy: **5 pass**
- Inherited S33 evidence (not re-run here): 91 commerce / 117 nonlive gates

Node `v22.14.0`; NETWORK=`eip155:8453` for commerce tests. Mocks only.
