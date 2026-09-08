# Reviewed change-digest source (C2)

This directory contains the minimum reviewed comparator files required for the
offline page-change recipe. They are copied unchanged from the accepted C2
change digest at commit `f4c6cff982f662ccfe65171b2ebb03b74cf4a986`
(merged as `670ce6e926dc5543d29c5a8afb2c9025846b46d6`, pull request 28).

Omitted on purpose: CLI, unit-economics, tests, fixtures, and research notes.
Those files are not required to compare two already delivered JSON artifacts.

Copyright (c) 2026 SameDayDesk. Licensed under the MIT License in the
repository root `LICENSE`.

| File | SHA-256 |
| --- | --- |
| `compare.mjs` | `86c9c0368755634a0a0674615bc38cc7d04664ab4aea9d54b1b60b611ec2ddec` |
| `html-diff.mjs` | `f6a401d751e14ad2ab9559cd7c5a4079d7e3b96402afc46f5bf0f8dec5254b8c` |
| `json-diff.mjs` | `45f022627f64d4acb2ff9029092bc7919a21ab64cc5bdc0f0600e72857689f2c` |
| `limits.mjs` | `58c264c931d87f7ef0d3b9303174c99b14dc4542592c24a1a49a4d4245cad739` |
| `snapshot.mjs` | `6853761f3c51a956c7252afac0b77f29d2d23f42ca729e5368022670b1681850` |
| `text-diff.mjs` | `7cc47a0df5e03335f79c24550c5839d0f5c4d1c75b1a4ff519b335bcd24c61ab` |

`index.mjs` is a local export surface for those files. It does not add
comparison behavior.
