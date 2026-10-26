# ROOT9722 source handback

Outcome: useful source correction, ready for Root receiving. The frozen baseline
loses empty-cell positions and spans; the repaired reader carries validated,
bounded native HTML tables in its existing Markdown field. Public schema and
server/payment/auth/trial/configuration files are unchanged. No release is made.

Canonical source: `https://github.com/epistemedeus/x402-url-extractor.git`
at `e862b261b450baef49a4064c4d76b819e291083d`.
Preserved writer branch: `codex/root9722-read-table-fidelity-20261026`.
Operating source: separate Pilot `e3b055200d099bcf0db71e624bc89fee10a23ff4`;
no product AGENTS.md was invented. All seven required product members and the
four supplied operating inputs were read; receipt SHA256 was verified.

Complete changed paths:

- `extract.mjs`
- `markdown-table.mjs`
- `markdown-table.test.mjs`
- `extract.http.test.mjs`
- `mcp-output-schema-extract.test.mjs`
- `package.json`
- `package-lock.json`
- `experiments/read-table-fidelity-20261026/RESULT.md`
- `experiments/read-table-fidelity-20261026/EVIDENCE.json`
- `experiments/read-table-fidelity-20261026/WORKER-HANDBACK.md`

Reusable receiving command (from product root, after `npm ci --ignore-scripts`):

```sh
env NODE_OPTIONS=--max-old-space-size=512 UV_THREADPOOL_SIZE=1 OMP_NUM_THREADS=1 node --test --test-concurrency=1 markdown-table.test.mjs extract.review.test.mjs extract.semantics.test.mjs extract.http.test.mjs mcp-output-schema-extract.test.mjs
```

Related consumers and exact exits are recorded in EVIDENCE.json. Full TAP logs,
baseline, comparison scripts/outputs, cold import samples and rendered receipts
remain in the owned job root:
`/home/ubuntu/root-sol-window100337/root9722-read-table-fidelity-20261026/`.
That root's `EXPORT.json` and Git bundle identify the final published head/tree;
the final worker response supplies those exact IDs without a self-referential
commit hash in this versioned document.

Receiving attention: native HTML requires HTML-preserving consumers. Optional
closing tags and nested/unsupported tables are deliberately refused and labeled;
content omissions use existing truncation flags, not a new schema field.
Invalid direct maxChars now fails before fetch. Bounds and raw-table overhead
can reduce the amount of returned cell text. CSS/JS semantics remain unsupported.
The actual Lakebridge pages were not fetched or qualified. The source outcome
does not establish release, independent adoption, paid choice or revenue.

No model children, extra model calls or other-job ownership. No deployment, PR,
outreach, target authentication, account/trial actions, credentials, live paid
calls or financial actions. Only this admitted branch is committed/pushed. Root
decides later installed receiving and release.
