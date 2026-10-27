# Local Olas reader carrier

Read a supplied public HTTP(S) page through the pinned official Olas custom-tool
loader, AEA constructors, one Pebble ProcessPool worker and the maintained guarded
Node reader. The result is the reader's complete thirteen-field record, including
bounded Markdown, tables, source status, capture provenance and truncation.

This local runner captures the real IPFS STORE_FILES message in an in-memory
outbox. It starts no IPFS upload, ledger/P2P service or operator. It needs no
wallet, model key, hosted merchant account or private repository.

## Cold install and one read

The supported profile is **Linux x86_64, Python 3.12.3 with pip and venv, Node
22.23.4 and npm on PATH** (qualified with pip 24.0 and npm 10.9.9). Install these
prerequisites through your normal toolchain. Allow about 2 GiB RAM and 1 GiB free
disk for a serial install. The runner does not install interpreters or global tools.
Public GitHub, PyPI, npm and the Autonolas gateway must be reachable.

Set `READER_COMMIT` to the full reviewed public commit from the PR or handback.
All downloaded runtime artifacts are separately pinned in this directory's locks.
Run these commands in a new caller-owned scratch directory:

```sh
: "${READER_COMMIT:?set the reviewed 40-character public commit}"
git init reader-source
git -C reader-source remote add origin https://github.com/epistemedeus/x402-url-extractor.git
git -C reader-source fetch --depth=1 origin "$READER_COMMIT"
git -C reader-source checkout --detach FETCH_HEAD
test "$(git -C reader-source rev-parse HEAD)" = "$READER_COMMIT"
python3 -B reader-source/integrations/olas-reader/bootstrap_runtime.py "$PWD/reader-runtime" --replay
python3 -B -m unittest discover -s reader-source/integrations/olas-reader -p test_bootstrap.py -v
PYTHONPATH="$PWD/reader-runtime/source-runtime:$PWD/reader-runtime/probe" \
  reader-runtime/venv/bin/python -B reader-runtime/probe/run_reader.py https://example.com
```

`reader-runtime` must be new, outside the source checkout. It contains installed
packages, source snapshots, caches, logs and results; the checkout stays unchanged.
The installed copy remains usable after the original checkout is removed. The
bootstrap uses an allowlisted environment and its own empty home, pip/npm configs
and caches. No inherited credential, proxy, Python path or Node option is passed
to install subprocesses. Production Node children receive only PATH and locale.

The default `strict-kv-3.17.5` profile builds the hash-pinned official MIT Peewee
3.17.5 sdist with isolated setuptools 75.8.0 and wheel 0.45.1, using `NO_SQLITE=1`
for a pure-Python wheel. It installs that actual wheel by hash with the other 77
locked distributions. The explicit `--profile server-lock-3.19.0` profile selects
the older server-lock compatibility version. Strict failures never fall back.
No npm lifecycle, audit or funding command runs. Only the pinned official Peewee
build backend executes from source.

To finish an interrupted install, use the same command and source revision with
`--resume`. Successful stages are retained, including a completed replay; each
failed command has separate logs. Source, profile, artifacts, installed files and
toolchain drift refuse. `--resume --source-repair` accepts a recorded pre-install
bootstrap repair only while dependency locks remain unchanged. It cannot bless
post-install source changes. Preserve the old revision for existing installations.

## Inputs and results

The loaded tool accepts `tool="public_page_reader"` and a JSON string in `prompt`:

```json
{"operation":"read","url":"https://example.com","markdownLimitChars":40000}
```

The optional limit is an integer from 1 through 40000. Request data cannot select
code, paths, headers, transport, commands or authentication. The reader's WHATWG
URL canonicalization, public IPv4 DNS pinning and redirect guard run unchanged.
It performs bounded HTTP GETs without JavaScript or cookies, up to 3 MB source
body and 40,000 JavaScript UTF-16 code units of Markdown. Unsupported tables are
explicitly omitted; combined spans, empty cells and footnotes remain HTML tables.
IPv6, private addresses, compressed responses and unsupported encodings can refuse.

A source HTTP refusal is a reader record with `sourceOk=false`. Adapter failures
instead use `pilot.public-page-reader.failure.v1`, an error code and an outcome
of `refused`, `unreceived` or `unknown`. `retry=explicit_new_read_only_attempt`
never starts an automatic retry. A hard worker failure remains the official
runtime's `Invalid response`, without an invented tool envelope. The five tuple
slots are result, empty prompt, **None transaction**, **None callback**, runtime
keychain; a tutorial context object in slot three would become a transaction.

`run_reader.py` prints a reader record or adapter failure. Its exit status is 1
for a runtime-level failure and 0 for a received record, including a refusal;
inspect `sourceOk` or `error.outcome` when deciding what to do next.

## Acceptance and provenance

`--replay` runs **18 cases: seven real runtime cases and eleven labelled source
slice diagnostics**. The separate bootstrap suite has **nine controls**. The
runtime tests fetch the immutable public synthetic fixture in `fixtures/PUBLIC.json`
and retain full direct/runtime table and Unicode/truncation output pairs under
`reader-runtime/results/whole-useful-output.json`. Capture clocks can differ.
The real cases cover canonical URLs, input refusal, controlled reader faults,
an actual worker timeout with Node death/reaping and later useful recovery,
tuple-slot hazards and ignored caller code/auth overrides. Fault hooks are test
only; their HTTP faults are controlled boundaries, not live-source observations.
The diagnostics use a synchronous scheduler and sliced behaviour and are never
counted as real ProcessPool acceptance.

The seven MIT modules in `reader-core/` are unchanged from public
[x402-url-extractor at 38f8787b](https://github.com/epistemedeus/x402-url-extractor/tree/38f8787b04bf3221ee0875ce1a6af687592c8015).
`reader-core/SOURCES.json` records their exact body hashes and attribution. Its
lock is the exact eight-package closure of the three required libraries from
that public root lock. No payment/server module is imported or installed.

`runtime-source-lock.json` and `runtime-archive-members.json` bind fourteen
registry archives and two individual source bodies. The configured chain is
service `bafybeidrlcm367sbqg46fzdctdt2smzf6tyvqnkgm75ercgph7wfw7ksty` →
agent `bafybeieplt2cv2qwg2ue64fdhcgzvkhxad5sochegd7qudsfn4lbfpev6y` →
task execution `bafybeien4bl2tevynexkpaqzq24ozu2vw4zeurw4elfwhqvkbqh5swe7ta`.
Official runtime sources are downloaded outside Git, never forked here. The
bootstrap also materializes the unchanged diagnostic references from the same
received task archive, checking `upstream/SOURCES.json`.

Generated tar container bytes can vary. Every regular member's complete name,
size and SHA256 must match; missing, extra, duplicate, unsafe or changed members
refuse. Actual response bodies and container hashes are saved before identity
interpretation. This is full source-member verification, not whole IPFS DAG/CID
root verification. Downloads are serial, source bodies bounded to 2 MiB, the
Peewee sdist to 4 MiB, and commands to 600 seconds with owned-group termination.

See [NOTICE](NOTICE), [MIT licence](LICENSE), [upstream Apache licence](upstream/LICENSE)
and [npm notice inventory](notices/npm/SOURCES.json). Dependency wheels retain
their own embedded licences; their hashes/versions are in `runtime-wheels.json`.
The Python selection qualifies this executed import closure, not the complete
all-ledger distribution, a vendor image or a live funded operator. Unused Solana
is omitted. Upstream warnings remain visible. Publication alone establishes no
outside customer, delivered paid request or revenue.
