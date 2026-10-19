# ROOT633: reproduced link-target candidate; no fix

Recommendation to Root: **existing tracked duplicate, not a new eligible defect**.
Both actual CLIs reproduce the supplied observation. This is a different example
of issue128's already disclosed exclusion of installed `link:true` entries, not
a failure of resolved-field comparison for extracted pins. Keep the candidate
as evidence for that existing issue. No engine change is warranted by this
receiving result; Root owns the bounty decision and any reply.

## Bound source and execution

- Product parent: `b6b9735e37d89109754ffbf43a4a3fa85e95d92d`.
- Advertised engine: `ca38205279f0d543515b81b7261909e55ea2600f`.
- Both vendor trees: `45eaba985a94187c7a2206e82b890b6f44560a9c`;
  `git diff --exit-code ca38205279f0d543515b81b7261909e55ea2600f b6b9735e37d89109754ffbf43a4a3fa85e95d92d -- vendor/lockfile-pin-delta` exits **0**.
- Operating context: `dd6e2a1c627fbf9a40a95c1c3d61406ad8f03356`;
  assignment publication: `0b7a0c613e3df74df42d45bbc48b451a96b158f1`.
  All four staged members match their receipt SHA-256 values; receipt SHA-256
  is `747191ff08e0e1af0906acaf9bbed5f1f78fc0ebe1e551e669ef138c67a12c08`.
- Actual attachment: **5507 bytes**, SHA-256
  `41b42aaf3be6632e8505a2ec015f78d101aaf9eb9eed2c4ab905f770d3dcc476`,
  Git blob `8eb4e7d396171e827433693d98ab13745d9218d0`, matching OUTSIDE-INPUT.json.
- Native session `01a152dc-0b78-7b73-935f-8da831b632bf`;
  actual rollout `turn_context`: **gpt-6.1-sol / high**. Existing Node **v22.14.0**,
  executable `/exec-daemon/node`; admitted `root633-source-node`, 1 GiB, cloud-d.
  No other model, install, compilation, package script, or full merchant suite.

## Independent results

The following six cases were each run against isolated frozen and current source
directories. Every CLI exited **0**; stderr was empty. Both sources gave the same
semantic results. Counts are before/after pins, added, removed, changed,
unchanged, missing-integrity IDs, in that order.

| Input | Status | Counts | Changed identity / fields |
| --- | --- | --- | --- |
| Exact supplied target switch | partial | 2 / 2 / 0 / 0 / 0 / 2 / 2 | none |
| Exact before lock compared to itself | partial | 2 / 2 / 0 / 0 / 0 / 2 / 2 | none |
| Exact issue128 inline pair | partial | 1 / 1 / 0 / 0 / 1 / 0 / 1 | `packages/widget` / version |
| Registry pin, resolved-only edit | actionable | 1 / 1 / 0 / 0 / 1 / 0 / 0 | `node_modules/control` / resolved |
| Same registry pin unchanged | informational | 1 / 1 / 0 / 0 / 0 / 1 / 0 | none |
| Supplied pair with all three link flags removed (synthetic isolation control) | partial | 5 / 5 / 0 / 0 / 1 / 4 / 5 | `node_modules/localpkg` / resolved |

The entire submitted `observed` object matches the corresponding fields in both
written CLI artifacts, not just their counts. Each CLI digest was independently
checked against SHA-256 of the bytes it actually wrote. Original candidate digests:

- Frozen: `66496ac17164a8047dec052ac82492ce80d7165c8383f1cf1ef6f0115ef18edd`.
- Current: `9f1b02b81b71454543af5f0ac519d22155d5e0448c7e87f969b4e8f892aad2b2`.

These differ because reports include caller paths and generation time. Semantic
agreement does not require byte-identical full artifacts across invocations.

The submitter's npm 10.9.2 generation and installed `@test/a` → `@test/b` runtime
check remain **self-reported**. We did not run npm or fetch any lockfile URL.
The attachment itself says its engine output was derived from source, not run.
Our actual CLI reproduction supplies that missing execution evidence.

## Semantics and uniqueness

The [frozen feature map](https://github.com/epistemedeus/x402-url-extractor/blob/ca38205279f0d543515b81b7261909e55ea2600f/vendor/lockfile-pin-delta/FEATURE-MAP.md)
supports npm v2/v3 pairs and compares extracted name/version/integrity/resolved
fields. Missing integrity remains partial even when a known resolved delta is
listed. The submitted lockfiles are accepted input; acceptance of their JSON
shape does not establish the proposed five-entry pin inventory.

The shared producer is `lib/parse-lockfile.mjs:87–95`: it excludes the root and
every `link:true` stub, then produces the two unchanged `packages/a` and
`packages/b` pins. No link reaches `comparePinMaps`. `lib/hash-terms.mjs` compares
resolved fields directly; hashes annotate rather than decide equality.
`lib/compare.mjs:52–54` correctly keeps missing-integrity results partial.
The existing owning [local-runtime test](https://github.com/epistemedeus/samedaydesk/blob/fba9d14872bc4c04214e527b9edfb30c2123c9e7/tools/lockfile-pin-delta/test/local-runtime.test.mjs)
explicitly asserts **“link stubs are not pins.”** This is an intentional tested
projection boundary, not a newly broken resolved comparator.

The expected 5 pins, 1 changed, 4 unchanged and 5 missing-integrity IDs are
arithmetically consistent **if all link stubs are included**. Removing the three
flags in our synthetic control reproduces the entire submitted expected object,
including its two terms hashes. This does not validate those counts for the
original linked input or prove an installed workspace graph. The proposed
`localpkg` identity is the path-derived alias, with null version/integrity; the
engine does not resolve its target into the installed package's name/version.

[Issue128](https://github.com/epistemedeus/x402-url-extractor/issues/128), created
2026-09-24 06:16:44 UTC, was open and had no comments when read. Its exact body
already identifies the actual installed `node_modules/...` `link:true` entry,
the engine skipping it, and reporting workspace source paths instead. Its
example changes the target package version and proposes actionable/no-missing-SRI
semantics. This candidate instead keeps both target entries fixed, changes the
link's resolved destination, and correctly retains partial. That is a useful
additional trigger and a better status expectation, but the allegedly missing
installed identity and its complete exclusion were already disclosed. A target
field on that excluded entry disappearing is the direct consequence of the same
reported missing entry, with no additional failing comparator or supported
consumer demonstrated. Deduplication rests on that disclosed behavior, not just
on two reports naming the same function. Issue131 concerns SRI token ordering;
it is unrelated and remains untouched. The public issue inventory also retains
124/125/126/210 as distinct optional-peer/name/alias/bundled-integrity candidates;
none establishes this candidate's uniqueness or acceptance.

The [public offer source](https://github.com/epistemedeus/neomorphic-io/blob/28666351eda767bce124f158ebbda1e5c24f96a6/src/data/n-bty-003.ts)
(blob `cff46a380c4709668a954f9f9e826047ff4ac4bc`, source pin taken from the frozen
STATE/AE120 chain) says **“First accepted unique issue wins; duplicates are not
paid”** and excludes **“Existing tracked duplicates.”** It reserves one 0.10 USDC
reward, not one payment per new fixture. These terms support the recommendation.
The assignment's referenced `NBTY003-ADMISSION.md` is absent at both supplied
operating/assignment commits (Contents API 404 and Git tree inspection); the
older STATE-linked `308b49f3` also returns 404. We did not substitute a moving
branch. The exact public terms above and current AE142 were read instead; no
missing internal admission text is represented as received.

## Commands and verification receipt

Working directory: `/home/ubuntu/ae14-work/root633-link-target-receiving`.
Scratch receipt root (ignored, retained for Root): `.scratch/root633/`.
Source isolation used these commands, all exit **0**:

```sh
mkdir -p .scratch/root633/frozen .scratch/root633/current
git archive ca38205279f0d543515b81b7261909e55ea2600f vendor/lockfile-pin-delta | tar -x -C .scratch/root633/frozen
git archive b6b9735e37d89109754ffbf43a4a3fa85e95d92d vendor/lockfile-pin-delta | tar -x -C .scratch/root633/current
gh api repos/epistemedeus/x402-url-extractor/issues/128 > .scratch/root633/issue128.json
```

Only `beforeLockfile`/`afterLockfile` JSON values were serialized from the claim
and issue128's fenced JSON. Unchanged controls use each before object twice.
Registry control: v3 `packages` map with root `{name:"registry-control"}` and
`node_modules/control` `{version:"1.0.0",integrity:"sha512-control",resolved:
"https://registry.invalid/control-1.0.0.tgz"}`; after changes only resolved to
`https://registry.invalid/relocated/control-1.0.0.tgz`. These strings are data.
The non-link control uses structured clones of the supplied pair and deletes
`link` from each package entry. No submitted command was executed.

The exact CLI argv pattern below was used for each `source` = `frozen`, `current`
and each `case` = `candidate`, `unchanged-link`, `issue128`, `registry-resolved`,
`registry-unchanged`, `non-link-resolved`. All **12 process exits were 0**.
`R` is the absolute scratch receipt root shown here, not a source/CLI selector
from the attachment:

```sh
R=/home/ubuntu/ae14-work/root633-link-target-receiving/.scratch/root633
/exec-daemon/node "$R/$source/vendor/lockfile-pin-delta/bin/lockfile-delta.mjs" --before "$R/$source/runs/$case/before.json" --after "$R/$source/runs/$case/after.json" --out-dir "$R/$source/runs/$case/out"
```

`observations.json` retains every expanded command, exit, count, changed pin and
digest. Each run directory retains the two exact inputs, stdout, empty stderr,
and original JSON/Markdown outputs. Assertions checked full submitted observed
fields, unchanged-link counts, issue128 identity, registry resolved change,
non-link resolved change, digest bytes and false purchase authority; exit **0**.

The merchant source projection contains no vendor test directory. We fetched
the two **existing owning** test files and the exact SDS root lock as data from
the provenance pin, not from a current branch. For each named path, retrieval
used `gh api 'repos/epistemedeus/samedaydesk/contents/<path>?ref=fba9d14872bc4c04214e527b9edfb30c2123c9e7' -H 'Accept: application/vnd.github.raw+json'` (all exit **0**):

| Path | Verified Git blob / SHA-256 |
| --- | --- |
| `tools/lockfile-pin-delta/test/cli.test.mjs` | blob `6ec98b63cc8284fb26bf4eb7445a9f1266ba036e` |
| `tools/lockfile-pin-delta/test/local-runtime.test.mjs` | blob `1e40e2f5cdfeeb274a13a2b2d83ff14bc29b5c36` |
| `package-lock.json` | SHA-256 `d51849d016d28f67aae0a99eeb6b4dd810c1c0069ced4094eb127a5301ed8fac` |

The unchanged tests were copied into each scratch vendor `test/` directory,
and the SDS lock into each snapshot root, preserving their original relative
layout. All 36 available projected upstream files, including the two tests,
match their pinned upstream Git blobs. Each source used this actual command:

```sh
/exec-daemon/node --test --test-concurrency=1 "$R/$source/vendor/lockfile-pin-delta/test/cli.test.mjs" "$R/$source/vendor/lockfile-pin-delta/test/local-runtime.test.mjs"
```

- Frozen: exit **0**, **29 pass / 0 fail / 0 skip**, 644.7 ms.
- Current: exit **0**, **29 pass / 0 fail / 0 skip**, 570.0 ms.

TAP and stderr receipts are `frozen-owning-tests.*` and `current-owning-tests.*`.
These are 29 distinct existing tests repeated on two snapshots, plus six
receiving cases repeated on two snapshots; do not sum repeats as unique tests.
No runtime or permanent regression change is made for a duplicate. Only this
report is delivered. Frozen source and original output receipts remain intact.
No external reply, award, ledger/financial mutation, signer, offer publication,
deployment or human-page effect was performed.

The first `git commit` exited 128 because this fresh checkout had no author
identity. The final commit uses command-local `user.name=pilot-sol-worker` and
`user.email=sol@pilot.invalid`, matching the existing native worker commit in
the neighboring ROOT615 checkout; no account configuration was changed.
