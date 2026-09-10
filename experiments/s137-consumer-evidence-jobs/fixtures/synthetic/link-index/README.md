# Synthetic HTML/MD fixtures (R2-CONSUMER-JOBS-04)

Label: **`synthetic`**. Authored offline for the link-to-artifact index. Not live-capture. Not paid demand. Assignment spend $0.

Clock: `2026-09-10T12:00:00.000Z` (`CLOCK.txt`).

Job: bounded citation index from supplied HTML/Markdown with exact source anchors, unreachable targets, and duplicates.

`catalog.mjs` inventories these files. It is **not** `src/link-index/transform.mjs` (c17).

## Cases

| Id | Kind | Decision | What is in the files |
| --- | --- | --- | --- |
| `positive-html` | positive | pass | Quoted `<a href>` to in-tree files and `#overview` |
| `positive-md` | positive | pass | Inline + reference markdown; heading slug `#intro`; `notes.md#limits` |
| `negative-empty` | negative | fail | Zero-byte HTML; no links |
| `negative-no-links` | negative | fail | Prose plus a bare `example.invalid` URL (not markdown link syntax) |
| `negative-malformed` | negative | fail | Empty quoted href; unclosed href is not extracted |
| `partial-mixed` | partial | partial | Present file, missing file, missing fragment, external URL, path escape |
| `conflict-duplicates` | conflict | conflict | Text `Guide` → two hrefs; `artifacts/alpha.md` appears three times |
| `conflict-duplicate-ids` | conflict | conflict | Two `id="install"`; `#install` is ambiguous |

## Inventory rules (fixture contract)

- HTML: complete `<a ... href="...">...</a>` with a double-quoted href; `id="..."`
- Markdown: `[text](href)`, `[text][id]` plus `[id]: href`, ATX headings, HTML ids inside `.md`
- Heading slug: lowercase, strip punctuation except hyphen, whitespace → `-`
- Relative targets resolve inside the case directory only
- `http(s):` is `unresolved-external` and is not fetched
- Missing files are not created; missing fragments are not invented

## Not in this cell

- Packet schema (`src/link-index/schema.mjs`, c16)
- Transform (`src/link-index/transform.mjs`, c17)
- Real public snapshot + PROVENANCE live URL (`fixtures/real/link-index/`, c19)
- Family tests (`test/link-index.test.mjs`, c20)
