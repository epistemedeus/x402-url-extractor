# task-continuation v1 contract

Status: stable v1, module version 1.1.0. A dependency-free ESM module (`index.mjs`, Node 20.19 or later). It gives any CLI or server a caller-held continuation for one task chain. Intended consumers: EIN, SameDayDesk and Neomorphic CLIs.

## What it does

- Issues and verifies an HMAC-SHA256 bearer token. The token has a kid keyring and an expiry, and binds a caller-supplied `tool` and `subject` hash plus optional named bindings.
- Mints and validates a non-authorizing `correlationId`.
- Builds a discovery value and a fixed refusal body with a `nextMethod` cue.
- Derives a deterministic step event id for journal dedup.
- Saves and loads a caller-held record in an owner-only 0600 file, hardened to the EIN activation-continuation store standard (see Store), and gives a token-free public view.
- Builds a separate measurement record (`measurementRecord`) that carries correlationId and discovery and never the token.

## What it does NOT do

- No storage. The issuer keeps nothing. The caller holds the token and the record.
- No terms. It never invents a task id or a termsVersion. Callers pass them as bindings (see Work Exchange below).
- No network calls, payment, signing of payments, or settlement.
- No logging. Callers must never log, journal or publish the token. Use `publicView`.
- It does not hash your input for you. Callers choose the subject normalization and pass a 64-hex hash (`hashJson` is a convenience).

## Field names and shapes

| Field | Shape | Notes |
| --- | --- | --- |
| `v` | integer `1` | Contract version. |
| `tool` | `^[A-Za-z0-9_.:/-]{1,128}$` | Task kind the token is bound to. |
| `token` | `^tc1\.[A-Za-z0-9_-]{16,900}\.[A-Za-z0-9_-]{43}$`, max 1024 chars | Bearer capability. Secret. |
| `kid` | `^[a-z0-9-]{1,16}$` | Key that signed this token. |
| `correlationId` | `^ae:corr:v1:[A-Za-z0-9_-]{22}$` | 16 random bytes, base64url. Stable across the chain. Not derivable into or from the token. Carries no authority. Measurement and Agent Money use it as `taskRef`. |
| `step` | non-negative integer | 0 at issue. Each continue adds 1. |
| `expiresAt` | ISO 8601 UTC with ms and `Z` | Token expiry. |
| `discovery` | `{ status: "observed" \| "declared" \| "unknown", source: string \| null }` | observed only from issuer-side request evidence, declared from the caller, otherwise unknown. Never read from the token. |
| step event id | v4-shaped UUID | `stepEventId(correlationId, step)`. Same input gives the same id. |

Token payload (base64url JSON, readable by anyone holding it, so it never carries raw input): `{ v, kid, tool, sub, bnd, crh, step, iat, exp }`. `sub` is the 64-hex subject. `bnd` is the sorted bindings. `crh` is `HMAC(secret, "task-continuation/correlation|" + correlationId)`. The signature is `HMAC-SHA256(secret, "tc1." + payloadB64)`.

Bindings: up to 8 names matching `^[A-Za-z][A-Za-z0-9]{0,31}$`. Each value is `^(sha256:)?[a-f0-9]{64}$`. `termsVersion`, when present, must be `^sha256:[a-f0-9]{64}$`. Integers are refused.

## Keyring

`kid:secret,kid:secret` (for example from an env var via `keyringFromEnv(env, name)`). The first entry signs and every entry verifies. Rotate by adding the new key first and keeping the old one until its tokens expire. Secrets must be 32+ chars. Any malformed entry returns `null`, which means continuation is off (`continuation_unavailable`). TTL defaults to 7 days and is clamped from 60 s to 30 days.

## Errors

The verify check order is fixed:

1. `continuation_unavailable`
2. `continuation_token_invalid` (not a string)
3. `continuation_token_oversized`
4. `continuation_token_invalid` (format, payload, version)
5. `continuation_unknown_key`
6. `continuation_token_invalid` (signature or field shape)
7. `continuation_expired`
8. `continuation_wrong_tool`
9. `continuation_subject_mismatch`
10. `continuation_binding_mismatch`
11. `continuation_correlation_mismatch`

Also: `continuation_invalid` (bad issue arguments or unknown code) and `continuation_file_invalid` (unreadable, unparsable, or wrong schema).

Store codes (added in 1.1.0):
- `continuation_file_missing`
- `continuation_file_symlink`
- `continuation_file_not_regular`
- `continuation_file_mode`
- `continuation_file_owner`
- `continuation_file_oversized`
- `continuation_file_parent_writable`
- `continuation_file_record_mixed` (discovery stored beside a token)

Refusal body (`refusal(code, { nextMethod, nextStep, ...extra })`): `{ ok: false, charged: false, paymentRequired: false, error, code, message, nextMethod, nextStep }`. The message is fixed per code. Never put caller input into `nextStep` or `extra`.

## Measurement record

`measurementRecord({ correlationId, discovery, step, tool, outcome })` returns `{ v: 1, kind: "measurement", tool, correlationId, step, discovery: { status, source }, outcome }`. Measurement counts discovery only from this separate record. It refuses any record where discovery sits in the same object as a bearer token. So:
- A measurement record never has a key named `token`, `continuation` or `kid`, and contains no token substring.
- The object that holds the token (the issue result or the caller file) never has a `discovery` field. `saveContinuationFile` and `loadContinuationFile` refuse one with `continuation_file_record_mixed`.
- `publicView` (stdout and logs) carries no discovery.

## Store

Standard matched: epistemedeus/ein-llc-lean@bb8be3107d6c4f8da264a33185c1ff2c6aed3cbe:tools/activation-continuation/src/store.mjs (`readContinuation`, `writeContinuation`).

Read (`loadContinuationFile`):
1. `lstat` the path. A missing path gives `continuation_file_missing`.
2. Refuse a symlink (`continuation_file_symlink`), a non-regular file (`continuation_file_not_regular`), more than 64 KiB (`continuation_file_oversized`), any group or other mode bit (`continuation_file_mode`), and an owner uid other than `process.getuid()` where it exists (`continuation_file_owner`).
3. Open with `O_RDONLY | O_NOFOLLOW`, `fstat`, require the same dev and inode, and re-run the checks.
4. Parse, then check the schema and token shape.

Write (`saveContinuationFile`):
1. Refuse a record over 64 KiB, or one with discovery beside a token.
2. `mkdir -p` the parent (mode 0700 when created). Refuse a parent that is a symlink, is not a directory, or is group or other writable.
3. Refuse a target that is a symlink or not a regular file.
4. Write to a temp file in the same directory, opened with `O_CREAT | O_EXCL | O_NOFOLLOW` and mode 0600. Then `fsync`, `chmod 0600`, and atomic `rename`.
5. `fsync` the directory where the filesystem allows it. `lstat` the result and re-run the read checks.

Differences from EIN: EIN returns `null` for a missing file and uses one code, `continuation_permissions`, for every permission failure. This module keeps distinct stable codes and refuses a group or other writable parent directory, which the EIN store does not check.

## Changelog

- 1.1.0: hardened store and new store codes (additive); `measurementRecord` (additive). `publicView` no longer returns `discovery`, because discovery moved to the measurement record so that no caller-facing view mixes it with token state. This is the one non-additive change; v1 wire fields and token format are unchanged. A missing file now gives `continuation_file_missing` instead of `continuation_file_invalid`.
- 1.0.0: initial v1 contract.

## Versioning rules

- v1 field names, regexes, error codes and check order do not change within v1.
- Additive only within v1: new optional exports, new error codes appended, new optional record fields.
- A token format change needs a new prefix (`tc2`) and a new `v`. Issuers should verify `tc1` for at least one max TTL (30 days) after switching.
- `correlationId` format `ae:corr:v1:` is shared with Measurement and Agent Money. A change needs `ae:corr:v2:` and a coordinated update.

## Work Exchange plug-in points

- Kernel task id: pass it as `tool` when it is a stable kind id, or hash it into `subject` or a binding (`bindings.taskId = hashJson(kernelTaskId)`) when it is per-instance.
- Terms: pass `bindings.termsVersion = hashTermsVersion(terms)` (`sha256:<64 hex>`, earned-work-sdk 2e7403f5, contributor-desk 58ef9fbe). A continue with different terms fails with `continuation_binding_mismatch`. Integer versions are refused.
- Free tasks with no terms (for example SameDayDesk `compare_page_observations` today) omit `termsVersion`.

## Relationship to page-change-continuation.mjs

The SameDayDesk server module `page-change-continuation.mjs` predates this package. It uses the same design under its own `pc1` prefix with fixed `sub`, `obs` and `fld` fields. Moving it onto this package would change its wire token, so it is left as is. Both share the `correlationId` format and the refusal fields.
