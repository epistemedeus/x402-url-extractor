# ROOT9722 reader table fidelity

The existing reader lost table meaning. At frozen product source
`e862b261b450baef49a4064c4d76b819e291083d`, actual injected-fetch
`readMarkdown` returned `Alpha Yes` for a row whose middle cell was empty,
and `Beta No` for a row whose last cell was empty. Combined rowspan/colspan
information also disappeared. Both results reported `truncated=false`.
The complete synthetic inputs and actual baseline records are in EVIDENCE.json.

The correction retains bounded native HTML tables inside the existing Markdown
string. Empty cells, native spans, captions, row groups, row/column headers,
header references, links, footnotes and code stay explicit. This avoids a
flattened grid that would duplicate or misassign spanning values. Surrounding
content still uses the existing converter. No-table outputs matched six frozen
reader controls byte for byte. Table text/attributes are escaped; presentation
attributes and event handlers are removed, relative table links use the final
URL, and image alternatives replace image loads. Word counts use table text.

The maintained [htmlparser2](https://github.com/fb55/htmlparser2) streaming
callbacks supply tokenization, entity decoding and source offsets. Version
12.0.0 is pinned with six added locked packages (MIT/BSD-2-Clause); every prior
locked package entry is unchanged. The tested alternative, Turndown 7.2.4 plus
[GFM tables 1.0.2](https://github.com/mixmark-io/turndown-plugin-gfm/blob/master/src/tables.js),
kept simple empty cells but dropped spans and produced inconsistent row widths
on the combined-span fixture. Whole-document Turndown would also change ordinary
Markdown. Parse5 8.0.1 (MIT, HTML5 tree builder) supplied an independent receiving
parser; htmlparser2's incremental callbacks fit refusal/depth/work bounds better.

Bounds are cumulative per conversion: 64 tables, 1,024 rows, 8,192 physical
cells, 128 columns, spans through 64 (rowspan=0 means the rest of its row group),
32,768 occupied positions checked, depth 128, 100,000 parser events, 200,000 input
characters per table, 400,000 serialized table characters, and 250 ms processing.
The reader's existing total deadline also covers conversion. Native spans remain
unexpanded; the bounded occupancy check detects overlap. Nested, unsupported,
unclosed and malformed tables get an explicit omission marker and the existing
`truncated` / `capture.textTruncated` flags. A refused scan omits the document
rather than flattening an unexamined tail. A table crossing maxChars is omitted
whole. Direct calls now reject invalid maxChars outside integer 1..40,000 before
fetch; public HTTP/MCP callers retain their existing fixed ceiling and schema.

Limits: this is native HTML within Markdown, not a pipe-table projection. Clients
that discard HTML must retain/read the raw string to use its table semantics.
Explicit closing tags are required, including normally optional cell/row tags.
CSS layout/visibility, JavaScript, nested tables and unsupported table markup
are not reconstructed. A large table may be omitted even when some cell text
would fit. These refusals preserve source status and mark content loss; they do
not claim source failure or completeness. Non-table converter quirks remain.

Final verification: 39 focused reader/HTTP/MCP tests and 75 related consumer
tests pass, with serial Node512/UV1/OMP1 execution and a fresh lockfile install.
Independent markdown-it 14.2.0 (HTML enabled) -> parse5 receiving preserves the
two baseline matrices and literal code/newlines/punctuation in block/list/link
contexts. HTTP/MCP tests use only synthetic local facilitators and injected
source pages. Source refusals, identities, clocks, charset/capture fields,
truncation, SSRF/redirect/compression refusals and stalled readers are covered.
Regressions are wired into `npm test` and `test:extract-batch`.
Commands, exits, retained failures and log hashes are in EVIDENCE.json.

Measured overhead: 767,484 installed dependency bytes. Five cold imports have
median 62.97 -> 72.07 ms and median RSS 68.24 -> 70.28 MB. On 50 injected reads,
small-matrix median is 0.116 -> 0.304 ms; 1,024-cell/14,927-byte table median is
0.507 -> 1.499 ms. The comparison process peaked at 122,560 KiB RSS; this is not
an aggregate VM hard-cap measurement. Live network latency is unmeasured.
Owner self-review corrections and one failed rendered-newline probe are retained;
outside reviewer amendment cost, adoption, customer usefulness and revenue remain
unmeasured. This source repair is a reusable reader capability, not market proof.

Branch/origin are preserved. No deployment, PR, outside message, target-page
fetch, trial, paid call, credential or financial action occurred. One public
Angler issue open returned a cache miss; no retry was made. ROOT9702/9430 and all
other jobs are outside this outcome. Root owns receiving and any later release.
