# Fixtures

Small public snapshots plus immutable priors. Default evidence class is `fixture`.
Captures that originated from live official JSON are labelled `capturedFromLive: true`
in `PROVENANCE.json`; a fixture *run* is still `fixture` unless `--live-official` or
`--evidence-class owner-qa`.

| Job | Prior | Changed current | Unchanged replay | Partial | Second snapshot |
| --- | --- | --- | --- | --- | --- |
| npm vercel | `npm-vercel/prior.seq-1.json` (59.9.1) | `current.json` (59.15.1) | `unchanged.json` | `partial-missing-version.json` | `second-snapshot-version-doc.json` (version, no published_at) |
| Node EOL | `eol-nodejs/prior.seq-1.json` (clock 2026-03-01) | `current.json` (clock 2026-09-10) | `unchanged.json` | `partial-missing-eol.json` | `second-snapshot-full-api.json` |
| claude-code | `npm-claude-code/prior.seq-1.json` (2.1.260) | `current.json` (2.1.267) | `unchanged.json` | `partial-missing-version.json` | `second-snapshot-version-doc.json` |

Original URLs and capture time: `PROVENANCE.json` and `../evidence/snapshots/CAPTURED_AT_UTC.txt` (`2026-09-10T09:54:59Z`).
