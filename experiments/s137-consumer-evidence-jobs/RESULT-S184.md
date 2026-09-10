# S184 — release-brief identity alignment + rejected-ok/pass

Branch: `codex/s184-release-brief-identity-gate-20260910`
Start HEAD (S182, ancestor): `5779c952d6c267821985044d229c1f6e2ebf2fef`
Frozen S174 tip (untouched): `3876fced28e9c9fc4411695eee2f0f275edc63f7`

## Defects (reproduced on S182 head)

**B1** Empty payloads on announced+shipped+tested returned `pass` / `three_planes_aligned` with no identity linkage.

**B2** `identity.commitSha: 7` (non-string) yielded `ok: false` but top-level and `brief.decision` stayed `pass`.

## Fix

Shared `assessIdentityAlignment` in `schema.mjs` (used by `impliedDecision` and transform `decide`):

- Linking evidence is **non-empty strings** for `version` / `tag` / `commitSha` only.
- **pass** only when all three planes are present, identities are connected by agreeing overlapping fields, and there is no disagreement.
- Empty identities → **partial** (`missing_identity_link`).
- Disjoint/noncomparable identities → **unknown** (`noncomparable_identity`).
- Overlapping field mismatch → **conflict**.
- Missing plane → **partial** (not malformed).
- Malformed identity / unexpected schema id → **fail**; `ok: false`; nested `brief.decision` matches. Not pass.

## Matrix (API = CLI)

| Case | decision | ok |
| --- | --- | --- |
| empty three planes (B1) | partial | true |
| disjoint identities | unknown | true |
| linked compatible identities | pass | true |
| explicit tag/sha conflict | conflict | true |
| commitSha: 7 (B2) | fail | false |
| wrong schema id | fail | false |
| announced-only (missing plane) | partial | true |

## Verification

- `test/release-brief-identity-gate.test.mjs` 10/10
- Existing release-brief + S174 CLI regression 42/42 with identity-gate file
- S182 `acceptance.test.mjs` **OK 0 failures** (03/04/05 positives still pass)
- Clean unpack of s178 kit **outside repo** (`/tmp/s184-unpack`): B1 partial, B2 fail/ok false, linked pass, jobs 03/04/05/02 pass

S178 kit sha256: `ab04e6bcfc2c497c5023039db9e7e118b1b5a142b03d9f755cbc9bb5af45761e`
S153 kit sha256: `c14a1290b0ee45e95f4239c1c20f7fb514095a2091e058e3f2639b209242a5b7`

## Non-claims

Offline only. No price/payment changes. No default merge/deploy. No SameDayDesk writes. Frozen S174 tip not rewritten.
