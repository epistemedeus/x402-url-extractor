ROOT1862 replay commands

Use Node and the existing locked dependency tree, from the repository root:

```sh
npm ci --ignore-scripts
npm run test:extract-batch
node --test commerce-events.test.mjs commerce-refusal-evidence.test.mjs commerce-privacy-coverage.test.mjs commerce-prospective-retention.test.mjs ordinary-delivery-join.test.mjs commerce-prospective-delivery.test.mjs
npm run test:replay-boundary
node --check extract-batch.mjs
node --check commerce-events.mjs
git diff --check
```

Final runs use unchanged runtime/test source at 5dbeb8d3cd303a77be7745695171ad0c4c070218.
Their complete stdout/stderr are the three `*-final.tap` receipts. Earlier TAPs
remain separate; they are not added to the final test count. Commands use only
owned synthetic/loopback services and disposable journals. Mounted tests launch
actual server.js and read the normal HTTP aggregate plus its actual stored rows.
The rotation test pads that disposable journal with whitespace to exercise the
real 5 MiB threshold, and intentionally injects one corrupt line for recovery.

Reproduce the original decisive red on the frozen implementation with the
checkpoint's exact mounted test. Expect exit 1 and the six missing shape records:

```sh
ROOT1862_RED_DIR=$(mktemp -d /tmp/root1862-red.XXXXXX)
git archive f31abbce319037bfe7bb98dcd859b598ef041ee5 | tar -x -C "$ROOT1862_RED_DIR"
ln -s "$PWD/node_modules" "$ROOT1862_RED_DIR/node_modules"
git show c9739fc7c3d8cf60b5bf45c2f983f879d42f5d78:extract-batch-commerce.mounted.test.mjs > "$ROOT1862_RED_DIR/extract-batch-commerce.mounted.test.mjs"
(cd "$ROOT1862_RED_DIR" && node --test --test-name-pattern='prospective URL shapes' extract-batch-commerce.mounted.test.mjs)
rm -rf "$ROOT1862_RED_DIR"
```

The original observed run is `frozen-red.tap`; it ran before either owning source
file was edited. The same checkpoint test then passed (`checkpoint-http.tap`).
Current mounted controls include additional positive/adversarial cases.

The exact public-contract parity command used a disposable archive of the frozen
commit and compared the following exports from its extract-batch.mjs with the
current module using `assert.deepEqual`: extractBatchInputRefusalDeclaration,
extractBatchInputRefusalSchema, extractBatchInputSchema, extractBatchOutputSchema,
extractBatchOutputExample, extractBatchQuote and extractBatchBoundary, followed
by extractBatchInputRefusalPayload(code) for all 16 frozen declared codes.
`public-contract-parity.json` records the identical result and exact source head.

Check source ancestry against the owned frozen PR base explicitly:

```sh
git merge-base --is-ancestor f31abbce319037bfe7bb98dcd859b598ef041ee5 HEAD
git diff --name-status f31abbce319037bfe7bb98dcd859b598ef041ee5 HEAD
git ls-remote origin refs/heads/codex/root1862-frozen-base-f31abbce refs/heads/codex/root1862-prospective-input-shape-20261021
git diff --exit-code f31abbce319037bfe7bb98dcd859b598ef041ee5 HEAD -- package.json package-lock.json delivery-journal-coverage.mjs delivery-journal-coverage-http.mjs commerce-journal-admission.mjs commerce-prospective-retention.mjs ordinary-delivery-join.mjs ordinary-delivery-coverage.cases.mjs
```

The only invocation failure during editing was `python /tmp/root1862-edit.py`:
`/bin/bash: python: command not found`, exit 127. No edit ran; `python3` applied
the same edit successfully. The only failed behavioral test was the intentional
frozen-source red. No failed test or audit output was removed or overwritten.
