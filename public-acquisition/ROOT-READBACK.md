# Root production readback

This draft is not hosted. `hostedAcquisitionVerified` and `productionHosted` stay false in the served document. A loopback run of `cold-acquire.mjs` or `cold-httpx.py` is not this readback.

Apply `public-acquisition/root-mount.patch` on the merchant tree that already contains `machine-acquisition.mjs`. That file at `26a2655b0672f0add4c8208347be1be106334297` matches `server.js` on master `84cce4284d145deae0c6a89d222b09d9a1f8b997` (#142, squash-merged). #141's client-diagnostic tests are already on that master and stay registered in `package.json`. Do not treat this patch as a price, payTo, signing, or catalog change.

After the patched process is on the public merchant origin:

1. Anonymous Node, with redirects refused:

   `GET https://agents.samedaydesk.com/.well-known/public-acquisition/index.json`

   Require `productionHosted: false` until this readback is recorded, `primaryOrigin` `https://neomorphic.io`, and three archive sha256 values:

   - l09-next-action 0.1.0, 477108 bytes, `23bf8574b37c485b4b99f2e15f9b77a3239d0b2308a9048c25e118425a7f63d0`
   - retained-task 0.1.0, 107420 bytes, `350629b7bf1a14b092d94e0c27579f2e05114bf7f2f05a33c33d32b4c68176de`
   - composition-route-knowledge 0.1.0, 66166 bytes, `11d5a0e2df86282b6d4edbeab84b6d8ab5ccdb26b44364042cf76c9576c23817`

2. `GET` and `HEAD` one archive from `alternatePath` on that same origin. Content-Length is the byte count above. The body sha256 matches. `HEAD` has no body.

3. Repeat the archive `GET` with Python `httpx` 0.28.1, the library version recorded for official `hermes-agent` 0.19.0 on PyPI. Do not substitute a later Git checkout, a header spoof, or an exit code without the bytes. Compare the body to the Node body.

4. Unpack `composition-route-knowledge` and run `node package/bin/decide.mjs self-check`. Then unpack `retained-task` and run the `open` / `resume` commands in `cold-commands.json`. The useful result is the command output, not a bare exit 0.

5. Confirm the primary Neomorphic URLs still answer a Node `GET`. This mount does not replace them.

6. Confirm `GET /extract` is still the existing 402, `GET /.well-known/skills/route-lock-receipt/SKILL.md` is still the pinned skill, and `machine-acquisition/pins.json` is unchanged.

7. Only after those responses match, record the readback outside this draft. Leave provenance sidecars unchanged. Do not mark private Git available, a paid launch, measured savings, or independent demand.

If `public-acquisition/engine.mjs` is absent, the patched server keeps the existing routes and omits `publicAcquisition` from `GET /mcp`.

Worker loopback on 2026-10-01, not this readback: with the patch applied and `PUBLIC_URL` set to the signed origin `https://agents.samedaydesk.com`, a process on `127.0.0.1:3799` put `publicAcquisition` on `GET /mcp`, served the retained-task archive (`107420` bytes, sha256 `350629b7bf1a14b092d94e0c27579f2e05114bf7f2f05a33c33d32b4c68176de`), returned 200 for the route-lock skill, and left `GET /extract` at 402. With the adapter directory removed, the same patched process omitted `publicAcquisition`, returned 404 for the acquisition index, and still served the skill and the 402. The patch was reversed after that check. This branch does not edit `server.js`.
