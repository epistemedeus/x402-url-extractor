# S194 — release-brief strict-source rejects + item-level linkage

Branch: `codex/s194-release-brief-strict-linkage-20260910`
Start HEAD (S184, ancestor): `e7d46a4fff555a9bae8fe3f6480243d15e081212`
Frozen S174 tip (untouched): `3876fced28e9c9fc4411695eee2f0f275edc63f7`

## Residuals (reproduced on S184 tip)

**R1** Strict-source rejects were laundered into `ok:true` / `decision:pass` / `brief.decision:pass`:
- announced `identity.role: "observed"` (`identity_role_mismatch`)
- missing announced `path`/`url` (`missing_locator`)
- unknown fourth source kind `mystery-doc` (`unknown_source_kind`)

`validateReleaseBriefInput` rejected; `normalizeReleaseBriefInput` overwrote role, synthesized `synthetic://` locators, and reclassified unknown kinds via plane. `buildReleaseBrief` still passed.

**R2** `assessIdentityAlignment` unioned all identities in a plane before graph linkage. Announced A `{tag}` plus unrelated announced B `{commitSha}` plus shipped `{tag}` plus tested `{commitSha}` returned `linked:true` / `pass` with no single source bridging tag to commit.

## Fix

Shared path (`schema.mjs` + `transform.mjs`); API and CLI agree.

- Strict rejects (`identity_role_mismatch`; `missing_locator` when `kind` is explicit; `unknown_source_kind` when `kind` is a non-empty unknown string; plus S184 `invalid_identity_field` / `unexpected_schema`) → `ok:false`, `decision`/`brief.decision`=`fail`. Unknown explicit kinds are not ingested.
- Convenience kept: missing `kind` still infers; missing `role` still fills; raw lane documents / legacy wrappers without `sources[]` may still normalize and pass.
- Linkage is **item-level**. Pass requires a connected item component covering announced+shipped+tested. Plane-union false bridges are `unknown` (`noncomparable_identity`). Genuine chain announced `{tag}` → shipped `{tag,commitSha}` → tested `{commitSha}` still passes.

## Matrix (API = CLI)

| Case | ok | decision |
| --- | --- | --- |
| R1 role mismatch | false | fail |
| R1 missing locator (explicit kind) | false | fail |
| R1 mystery-doc kind | false | fail |
| R2 false plane-union bridge | true | unknown |
| R2 genuine item bridge | true | pass |
| S184 empty three planes | true | partial |
| S184 disjoint | true | unknown |
| S184 linked | true | pass |
| S184 commitSha:7 | false | fail |
| convenience missing kind | true | pass |
| convenience raw lane docs | true | pass |

## Verification

- `test/release-brief-identity-gate.test.mjs` 21/21
- Existing release-brief + S174 CLI + identity-gate `test/release-brief*.mjs` 35/35
- Schema/transform `--self-check` ok
- S182 `acceptance.test.mjs` **OK 0 failures** (03/04/05 positives still pass)
- Clean unpack of s178 kit **outside repo** (`/tmp/s194-unpack`)

S178 kit sha256: `f8d99bcbb36de1d7619a6b28f0bbebd6a4078980e64fdefc44b958bc89e87eaf`
S153 kit sha256: `d855d9a2aca7e1495442244427f4063a3ac268ad18ca1f5a0c7a8f5b30975f91`

## Non-claims

Offline only. No price/payment changes. No default merge/deploy. No SameDayDesk writes. Frozen S174 tip not rewritten. No attestation system or external fetches.
