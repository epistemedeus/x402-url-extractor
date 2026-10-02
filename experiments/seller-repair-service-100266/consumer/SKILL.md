---
name: seller-repair-external-consumer
description: Receive a caller-owned seller repair against an authorized read-only target. The catalog fixture is only the deterministic example.
license: MIT
compatibility: Requires Node.js >=22.22.0. No npm install. Network access is an optional unpaid GET of one allowlisted public resource. Redirects are not followed.
metadata:
  author: samedaydesk
  version: "0.2.0"
  hermes:
    tags: [seller-repair, caller-owned, read-only]
---

# Seller repair external consumer

Use this when a visiting agent brings their own authorized target, operation, expected output, and SDK. `package/cases/retained-case.json` replays one loopback catalog fixture. It is not the only task the caller may submit.

The executable is `package/bin/seller-repair.mjs` version 0.2.0. A later process uses `package/bin/cold-later.mjs`. Pins for the vendored privacy files are `package/references/pins.json`. The license is `package/LICENSE`. The acquisition note is `package/SOURCE-NOTICE.txt`.

Runtime dependencies are Node.js >=22.22.0 and `node:crypto`, `node:dns/promises`, `node:fs`, `node:fs/promises`, `node:http`, `node:https`, and `node:net`. There is no npm dependency. Unpack with system `tar` and `gzip`. Do not add `node_modules`, `.git`, or `.grok`.

From the extract root:

```bash
node package/bin/seller-repair.mjs deliver
node package/bin/seller-repair.mjs diagnose --case package/cases/supplied-quota.json
node package/bin/seller-repair.mjs diagnose --case package/cases/supplied-health.json
node package/bin/seller-repair.mjs reproduce --case package/cases/retained-case.json
node package/bin/seller-repair.mjs retest --case package/cases/retained-case.json --mode repaired
node package/bin/cold-later.mjs package/cases/retained-case.json --resource /catalog/items
node package/bin/seller-repair.mjs reject-seeded package/fixtures/seeded-false-useful.json
node package/bin/seller-repair.mjs readonly --case package/cases/public-readonly.json
node package/bin/seller-repair.mjs receive --case package/cases/retained-case.json --base http://127.0.0.1:PORT --retest-base http://127.0.0.1:PORT
```

`deliver` exits 0 when the offline health evidence is useful, the bare 200 is not, the private address is refused, and the loopback direct probe agrees. `diagnose` reads supplied evidence and does not purchase. `reproduce` exits 0 when the loopback retest matches. That result is a loopback fix. `deployedCounterpartyRepair` stays false. `reject-seeded` and a stale later binding exit 2. Exit 0 is not a payment and is not proof that an unknown report was useful.

Only GET is probed. `probeConsent.confirmed` must be true. `public-https` names one public HTTPS origin. `public-read-only` may name only `https://agents.samedaydesk.com` and `/.well-known/public-acquisition/index.json`. `loopback` may name only `http://127.0.0.1` with a port. Private and reserved addresses and a changed DNS answer are refused before a connection. Redirects stay 0. A trickling body cannot renew `deadlineMs`. HTTP 200, a declaration, unknown coverage, and a missing field do not prove useful execution or a paid need. The existing `$0.01` seller-integrity audit is not purchased. An incomplete local audit remains a useful negative. Tokens and adaptation cost stay `unknown`.

This skill is unlaunched. Root hosts the 0.2.0 archive and runs `candidate/cold-command.json` on those hosted bytes. The 0.1.0 archive bytes stay frozen.
