# Upgrade-impact packet contract (S127)

Schema id: `s127.upgrade-impact.packet.v1`

## Required fields
- `schema`, `createdAt`, `clock`
- `caller`: `{ manifestPath, lockfilePath?, sourceRoots[], evidenceClass }`
- `dependency`: `{ name, oldVersion, newVersion, resolvedOld, resolvedNew }`
- `provenance`: per source artifact `{ url|path, retrievedAt, contentSha256, coverage, label: fixture|live-capture|synthetic }`
- `usage`: static imports/exports referenced (`dynamicImport: true` ⇒ unknown contribution)
- `exportDiff`: `{ added[], removed[], renamed[]?, signatureChanged[]?, coverage }`
- `bindings`: array of `{ symbol, used: bool, changeKind, decision: action|unknown|no_action, rationale }`
- `summary`: `{ nextAction, unknownReasons[], unusedChanges[], actionableChanges[] }`
- `prior`: immutable prior ref + optional correction
- `limitations`: explicit (no full TS, no runtime exec, lockfile disagreement, etc.)

## Decision rules (non-negotiable)
1. Newer version alone ≠ break.
2. Unused export change ≠ caller defect.
3. Conflicting/missing/partial source ⇒ `unknown`, not action.
4. Dynamic import of package ⇒ unknown for that surface.
5. Alias/workspace/lockfile disagreement ⇒ unknown until resolved or reported.
6. Same-version/no-op ⇒ `no_action`.

## Kill condition
If binding never changes the decision relative to "read registry + changelog"
on real cases A/B, record negative evidence and stop packaging as paid job.
