---
name: route-lock-receipt
description: Map an unpaid merchant challenge into a route-lock receipt a later process can read.
license: MIT
compatibility: Requires Node.js >=22, npm, and tar. Network access is an unpaid GET of the named challenge plus the pinned public archives.
metadata:
  author: neomorphic
  version: "0.1.0"
  hermes:
    tags: [route-lock, receipt, merchant-402]
---

# Route lock receipt

Use this when a caller needs one unpaid merchant challenge mapped into a route-lock receipt that a later process can read. A supplied decision file is not this entry. The executable is `scripts/lock-and-capture.mjs` version 0.1.0. It calls the unchanged route-release-decision 0.1.0 scripts `scripts/run-task.mjs`, `scripts/http-boundary.mjs`, `scripts/map-challenge.mjs`, `scripts/package-cache.mjs`, `scripts/read-receipt.mjs`, `scripts/receipt.mjs`, and `scripts/time.mjs`, with pins in `references/pins.json` and identity in `references/manifest.json`. The license is `references/LICENSE`. The acquisition note is `references/SOURCE-NOTICE.txt`.

Map one unpaid challenge. The clock on that process is the receipt time:

`node scripts/lock-and-capture.mjs map --url https://agents.samedaydesk.com/extract?url=https%3A%2F%2Fexample.com --cache DIR --out receipt.json`

A second process reads that receipt at its own clock. `newAuthority` stays denied. An expired, stale, changed-recipient, or malformed observation exits 3:

`node scripts/lock-and-capture.mjs continue --receipt receipt.json --out continuation.json`

`--now` sets the second process clock for a check. It does not create authority.

The script pins route-lock 0.1.0 and release-gate 0.1.4 by sha256. It does not rewrite those archives. It sends no payment header. It does not follow redirects. A private address or local name is refused before a connection. Other names are resolved, and a private answer is refused, but the later connection is not pinned to that answer. `confinementClaim` is `none`. A body larger than 1 MiB is rejected while it is still streaming. A cached tree runs only when every archive member is a regular file with the pinned bytes. A tampered, partial, or symlinked cache is left in place and is not the process that runs.

`--pay`, `--settle`, `--publish`, `--sign`, `--reserve`, `--register`, `--deploy`, `--submit`, `--authenticate`, and `--owner-pay` are refused. A lockable diagnostic is not permission to pay.
