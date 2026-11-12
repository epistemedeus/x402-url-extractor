# task-continuation v1 contract

Status: stable v1, module version 1.2.0. A dependency-free ESM module (`index.mjs`, Node 20.19 or later). It gives any CLI or server a caller-held continuation for one task chain. Intended consumers: EIN, SameDayDesk and Neomorphic CLIs.

Place in the CLI architecture: under Root's accepted CLI revision 3 (epistemedeus/pilot@e597252f446e46eba10fb30d4c7cb1e51a6f8779, `overview/self-evaluations/2026-11-12-participant-economy/INTEGRATED-DECISIONS.md` section "Revision3" and the owning `THREE-SITE-AGENT-CLI-PLAN.md`), `task-continuation` is a component wire ID. Each CLI's thin task manifest maps its curated task IDs onto component wire operations, and this module is one of those components. It is not a task manifest, not a quote and not a reservation. See "Revision 3 compliance" below.

## What it does

- Issues and verifies an HMAC-SHA256 bearer token. The token has a kid keyring and an expiry, and binds a caller-supplied `tool` and `subject` hash plus optional named bindings.
- Hashes caller data with canonical JSON (`canonicalJson`, `hashJson`), so key order never changes a subject or binding hash.
- Mints and validates a non-authorizing `correlationId`.
- Builds a discovery value and a fixed refusal body with a `nextMethod` cue.
- Derives a deterministic step event id for journal dedup.
- Maps every refusal code to an exit category, a retryable flag and an exit code (`ERROR_CODES`).
- Saves and loads a caller-held record in an owner-only 0600 file, hardened to the EIN activation-continuation store standard (see Store), and gives a token-free public view.
- Builds a separate measurement record (`measurementRecord`) that carries correlationId and discovery and never the token.

## What it does NOT do

- No storage. The issuer keeps nothing. The caller holds the token and the record.
- No terms. It never invents a task id or a termsVersion. Callers pass them as bindings (see Work Exchange below).
- No network calls, payment, signing of payments, or settlement.
- No logging. Callers must never log, journal or publish the token. Use `publicView`.
- It does not hash your input for you. Callers choose the subject normalization and pass a 64-hex hash (`hashJson` is a convenience).
- No exactly-once delivery. It never promises that a dispatch happened once. See In-flight operations.
- No preview, quote or reservation. A CLI's local preview stays separate from any remote quote or reservation, and none of them is a continuation.
- No unverified decode helper. There is deliberately no `decodeUnverified` or similar. An unverified decode invites callers to trust fields (tool, step, expiry, bindings) that nobody has checked, and the token payload is readable by anyone holding it anyway. Read `tool`, `correlationId`, `step` and `expiresAt` from the caller record (validated at load) or from `verifyContinuation`.

## Field names and shapes

| Field | Shape | Notes |
| --- | --- | --- |
| `v` | integer `1` | Contract version. |
| `tool` | `^[A-Za-z0-9_.:/-]{1,128}$` | Task kind the token is bound to. |
| `token` | `^tc1\.[A-Za-z0-9_-]{16,900}\.[A-Za-z0-9_-]{43}$`, max 1024 chars | Bearer capability. Secret. |
| `kid` | `^[a-z0-9-]{1,16}$` | Key that signed this token. |
| `correlationId` | `^ae:corr:v1:[A-Za-z0-9_-]{22}$` | 16 random bytes, base64url. Stable across the chain. Not derivable into or from the token. Carries no authority. Measurement and Agent Money use it as `taskRef`. |
| `step` | non-negative integer | 0 at issue. Each continue adds 1. |
| `expiresAt` | ISO 8601 UTC with ms and `Z` (`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`, must round-trip through `Date`) | Token expiry. |
| `hashAlg` | `"cj1"` | Added in 1.2.0. Canonical-JSON hashing marker on the issue result and the caller file. |
| `discovery` | `{ status: "observed" \| "declared" \| "unknown", source: string \| null }` | observed only from issuer-side request evidence, declared from the caller, otherwise unknown. Never read from the token. |
| step event id | v4-shaped UUID | `stepEventId(correlationId, step)`. Same input gives the same id. |

Token payload (base64url JSON, readable by anyone holding it, so it never carries raw input): `{ v, kid, tool, sub, bnd, crh, step, iat, exp, h }`. `h` is `"cj1"` from 1.2.0 on. `sub` is the 64-hex subject. `bnd` is the sorted bindings. `crh` is `HMAC(secret, "task-continuation/correlation|" + correlationId)`. The signature is `HMAC-SHA256(secret, "tc1." + payloadB64)`.

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

1.2.0 inserts `continuation_hash_legacy` between 6 and 7: an authentic token (signature verified) without `h: "cj1"` is refused before expiry is checked. A forged token is still `continuation_token_invalid`.

Also: `continuation_invalid` (bad issue arguments or unknown code) and `continuation_file_invalid` (unparsable, wrong schema, or a bad record field; an unreadable file is `continuation_file_io` from 1.2.0).

Store codes (added in 1.1.0):
- `continuation_file_missing`
- `continuation_file_symlink`
- `continuation_file_not_regular`
- `continuation_file_mode`
- `continuation_file_owner`
- `continuation_file_oversized`
- `continuation_file_parent_writable`
- `continuation_file_record_mixed` (discovery stored beside a token)

Codes added in 1.2.0:
- `continuation_hash_legacy` (token or file from before canonical hashing)
- `continuation_file_hardlink` (file has more than one link)
- `continuation_file_io` (a filesystem error other than a missing file; 1.1.0 gave `continuation_file_invalid` on read and threw the raw error on write)

### Exit map (`ERROR_CODES`)

`ERROR_CODES` is a frozen table of `code -> { exitCategory, retryable, exitCode }` covering every code the module throws (a test scans the source to keep it complete). The messages moved to `ERROR_MESSAGES`. Exit codes are one per category:

| exitCategory | exitCode | Codes | retryable |
| --- | --- | --- | --- |
| usage | 2 | `continuation_invalid`, `continuation_token_oversized`, `continuation_wrong_tool`, `continuation_file_record_mixed` | false |
| auth | 3 | `continuation_unavailable`, `continuation_unknown_key`, `continuation_file_owner` | false |
| not_found | 4 | `continuation_file_missing` | false |
| conflict | 5 | `continuation_subject_mismatch`, `continuation_binding_mismatch`, `continuation_correlation_mismatch`, `continuation_hash_legacy` | false |
| integrity | 6 | `continuation_token_invalid`, `continuation_file_invalid`, `continuation_file_symlink`, `continuation_file_not_regular`, `continuation_file_mode`, `continuation_file_oversized`, `continuation_file_parent_writable`, `continuation_file_hardlink` | false |
| io | 7 | `continuation_file_io` | true |
| expired | 8 | `continuation_expired` | false |

`retryable: true` means the same call may succeed unchanged later. `false` means the caller must change something first (fix input, start a new chain, fix the file). A CLI may embed these numbers in its own exit scheme; 0 and 1 are left to the CLI.

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

5. Validate the record (1.2.0): `tool` is a non-empty string matching the tool regex, `step` is a non-negative safe integer, `expiresAt` matches the ISO regex and round-trips through `Date`, all else `continuation_file_invalid`. A record without `hashAlg: "cj1"` gives `continuation_hash_legacy`. Then `expiresAt` at or before `nowMs` (default `Date.now()`) gives `continuation_expired`, and with `loadContinuationFile(file, { tool })` a record for another tool gives `continuation_wrong_tool`.
6. Refuse a file with more than one hard link (`stats.nlink > 1`, `continuation_file_hardlink`), checked in step 2 and again on the opened handle.

Write (`saveContinuationFile`):
1. Refuse a record over 64 KiB, one with discovery beside a token, or one that fails the shape checks in read step 5 (expiry is not checked on write).
2. `mkdir -p` the parent (mode 0700 when created). Refuse a parent that is a symlink, is not a directory, or is group or other writable.
3. Refuse a target that is a symlink, not a regular file, or hard-linked (`continuation_file_hardlink`; rename would leave the other name holding stale bytes).
4. Write to a temp file in the same directory, opened with `O_CREAT | O_EXCL | O_NOFOLLOW` and mode 0600. Then `fsync`, `chmod 0600`, and atomic `rename`.
5. `fsync` the directory where the filesystem allows it. `lstat` the result and re-run the read checks.

Record schema: `record.schema.json` (JSON Schema 2020-12, exported as `task-continuation/record.schema.json`) describes the saved object. A module test validates real saved output against it with a small local checker and no dependencies. Expiry against the clock is checked by the loader, not the schema.

Filesystem errors: any error other than a missing file (for example `EACCES`, `ENOTDIR`, `ENOSPC`) becomes `continuation_file_io`, which is retryable.

### /tmp behaviour

The module has no special case for `/tmp` or `os.tmpdir()`. A shared `/tmp` is mode 1777, so saving a file directly into it is refused with `continuation_file_parent_writable`; the sticky bit does not exempt it. Saving to a private subdirectory (for example `mkdtemp` then `chmod 0700`, as the tests do) works. Temp files are written in the target's own directory as `<file>.<pid>.<8 hex>.tmp`, never in `/tmp`, and are removed on a failed write. Nothing is cleaned up in `/tmp` by the module.

Differences from EIN: EIN returns `null` for a missing file and uses one code, `continuation_permissions`, for every permission failure. This module keeps distinct stable codes and refuses a group or other writable parent directory, which the EIN store does not check.

## Hashing and migration (1.2.0)

`hashJson(value)` is now `sha256(canonicalJson(value))`. `canonicalJson` sorts object keys recursively (UTF-16 code unit order), keeps array order and writes no whitespace. It refuses, with `continuation_invalid`, values plain JSON would drop or rewrite silently: `undefined`, functions, symbols, bigint, `NaN`, `Infinity` and non-plain objects such as `Date`. Bindings are compared with `canonicalJson` too.

This changes the hash for any object whose keys were not already in sorted order. Arrays and scalars hash to the same bytes as in 1.1.0.

Migration choice: refuse, typed. A token issued by 1.1.0 has no `h` field and a 1.1.0 caller file has no `hashAlg`. After the signature check, such a token is refused with `continuation_hash_legacy`, and such a file is refused at load with the same code. Its exit row is `conflict`, not retryable: start a new chain (step 0, new correlationId). The module never verifies a token "the old way". The module only ever sees a subject hash, not the data, so it cannot tell whether the caller's 1.1.0 hash would have changed, and silently accepting a mixed chain would let one chain carry two hash meanings. 1.1.0 tokens live at most 30 days (max TTL), so the refusal window is bounded. 1.1.0 verifiers ignore the new `h` field, so a 1.2.0 token still verifies on a 1.1.0 issuer that computes the same subject.

## In-flight operations

A dispatch that could be lost (a network call, a child process, anything where the reply can vanish after the remote side acted) follows this order:
1. Save the recovery record first: `saveContinuationFile` with the current token, correlationId, step and tool, before the dispatch. If that save fails, do not dispatch and do not claim crash recovery.
2. Dispatch, carrying the correlationId and, where the operation supports it, the step event id (`stepEventId(correlationId, step)`) as the caller key.
3. On a lost reply, recover by re-reading: load the saved record in a fresh process, then read back the remote state by correlationId and step (or the operation's own readback) before deciding to retry. Retrying the same step reuses the same step event id, so a journal that dedups on it counts the step once.

There is no exactly-once promise. A failure after sending does not prove no effect happened, and a retry can reach the remote side twice. Dedup by step event id is at-most-once counting in a journal that honours it, not exactly-once execution. Retention expiry and storage loss stay honest limitations.

## Correlation without an issuer

A caller with no issuer (no keyring, offline, or a different product) may mint its own correlationId with `mintCorrelationId()` in the shared `ae:corr:v1:` format. Its discovery is `declared` (the caller says where it came from), and it is non-authorizing: it is not a token, it unlocks nothing, and a token issued under another correlationId refuses it with `continuation_correlation_mismatch`. It only joins measurement records.

## Discovery sources for measurementRecord

`discovery.status` takes exactly three values: `observed` (issuer-side request evidence), `declared` (the caller says so) and `unknown`. Nothing else. Any other status, including a missing one, is recorded as `unknown` with `source: null`. `source` is a caller string naming the channel (for example `cli`, `mcp`, `a2a`); the module does not interpret it, and `discovery()` only returns a source that appears in the caller's allowlist.

## Revision 3 compliance

Pin: epistemedeus/pilot@e597252f446e46eba10fb30d4c7cb1e51a6f8779 (`INTEGRATED-DECISIONS.md` Revision3, `THREE-SITE-AGENT-CLI-PLAN.md`).
- Component wire ID: `task-continuation` is a component wire operation under each CLI's thin task manifest. The manifest maps its curated task ID onto this component; this module does not define task IDs, terms or manifests.
- Preview, quote and reservation stay separate. A local preview or `--dry-run` validates without dispatch. A remote quote or reservation is a separate record with its own expiry. None of them is a continuation token, and a continuation never stands in for any of them.
- Recovery is persisted before a vulnerable dispatch (In-flight operations above). No exactly-once delivery is claimed anywhere in this contract.
- Continuation bearers are not analytics IDs or general authorization. Analytics joins use the correlationId on the separate measurement record.

## Runtime and test matrix

`engines.node` is `>=20.19.0`. The module uses only `node:crypto`, `node:fs/promises`, `node:fs` constants and `node:path`; tests use `node:test` and `node:assert`. Run `node --test test/index.test.mjs` from this directory. Linux and macOS are the supported targets (POSIX modes, `O_NOFOLLOW`, `nlink`). Windows is not offered: mode bits and owner checks do not map. The 1.2.0 tests were run locally on Node 22 only. Node 20.19 and 24 runs belong on a VM and are not yet recorded. The owner-mismatch test needs root to chown a fixture and is skipped otherwise.

## Changelog

- 1.2.0: canonical `hashJson` (`canonicalJson`) with typed refusal of 1.1.0 tokens and files (`continuation_hash_legacy`); tokens carry `h: "cj1"`, issue results and files carry `hashAlg: "cj1"`. Load validates `tool`, `step`, `expiresAt` and refuses expired records (`continuation_expired`) and, given `{ tool }`, another tool's record (`continuation_wrong_tool`). Hard-link refusal (`continuation_file_hardlink`). Filesystem errors become `continuation_file_io`. `ERROR_CODES` is now the exit map (`{ exitCategory, retryable, exitCode }`) and the messages moved to `ERROR_MESSAGES`, which is non-additive for anyone who read `ERROR_CODES[code]` as a string. Published `record.schema.json`. Documented in-flight recovery, issuer-free correlation, discovery sources, /tmp behaviour, runtime matrix and revision 3 compliance.

- 1.1.0: hardened store and new store codes (additive); `measurementRecord` (additive). `publicView` no longer returns `discovery`, because discovery moved to the measurement record so that no caller-facing view mixes it with token state. This is the one non-additive change; v1 wire fields and token format are unchanged. A missing file now gives `continuation_file_missing` instead of `continuation_file_invalid`.
- 1.0.0: initial v1 contract.

## Versioning rules

- v1 field names, regexes, error codes and check order do not change within v1, except the 1.2.0 hashing migration listed in the changelog.
- Additive only within v1: new optional exports, new error codes appended, new optional record fields.
- A token format change needs a new prefix (`tc2`) and a new `v`. Issuers should verify `tc1` for at least one max TTL (30 days) after switching.
- `correlationId` format `ae:corr:v1:` is shared with Measurement and Agent Money. A change needs `ae:corr:v2:` and a coordinated update.

## Work Exchange plug-in points

- Kernel task id: pass it as `tool` when it is a stable kind id, or hash it into `subject` or a binding (`bindings.taskId = hashJson(kernelTaskId)`) when it is per-instance.
- Terms: pass `bindings.termsVersion = hashTermsVersion(terms)` (`sha256:<64 hex>`, earned-work-sdk 2e7403f5, contributor-desk 58ef9fbe). A continue with different terms fails with `continuation_binding_mismatch`. Integer versions are refused.
- Free tasks with no terms (for example SameDayDesk `compare_page_observations` today) omit `termsVersion`.

## Relationship to page-change-continuation.mjs

The SameDayDesk server module `page-change-continuation.mjs` predates this package. It uses the same design under its own `pc1` prefix with fixed `sub`, `obs` and `fld` fields. Moving it onto this package would change its wire token, so it is left as is. Both share the `correlationId` format and the refusal fields.
