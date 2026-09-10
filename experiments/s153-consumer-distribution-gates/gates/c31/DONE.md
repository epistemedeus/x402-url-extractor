# c31 DONE (S7 coverage-integrity, link-index)

Observed sha256 of S137 synthetic/real link-index fixtures equals claimed PROVENANCE and this cell's PIN. Synthetic license is the authored-fixture note; real SPDX is Apache-2.0 with LICENSE/NOTICE hashes pinned and bodies not stored.

`transform`/`transformLinkIndex` on `positive-md` is **pass** with citation hashes matching `expected.json`. Real README without inventory is **fail** (not an invented pass): 21 observed records = claimed 19 links + 2 images; `./` unreachable; http(s) unknown; slack href duplicated; `specs/` is not a href; `networkFetched=false`.

Claimed `contentSha256` vs observed body is schema **invalid** (`hash_mismatch`); the packet may still carry the claimed hash, so this gate compares file bytes independently. CLI `analyze link-index` on the pinned positive input is pass, offline, no private receipts, jobs 07/08 absent.

Files: `gates/c31/PIN.json`, `helper.mjs`, `gate.test.mjs`, `DONE.md`. Test: `node --test experiments/s153-consumer-distribution-gates/gates/c31/gate.test.mjs` (7 pass).
