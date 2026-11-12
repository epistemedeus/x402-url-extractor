# samedaydesk-capability-compat

Private 0.1.0 capability pack for official MCP client and protocol changes on
the free page-change profile (`POST /mcp/page-change`, tool
`compare_page_observations`). It is a local-first installable client. The
optional maintained service is the existing free mount, not a new hosted stack.

This package does not take payment, sign, publish to npm, or change a live
merchant. The documented hosted URL
`https://agents.samedaydesk.com/mcp/page-change` is recorded for comparison
only. It is not claimed to be the live tool.

## Normal install

From a checkout that contains this package directory:

```bash
cd packs/samedaydesk-capability-compat
npm pack
```

That writes `samedaydesk-capability-compat-0.1.0.tgz`. A cold consumer then
installs the packed tarball:

```bash
mkdir -p /tmp/capability-compat-consumer
cd /tmp/capability-compat-consumer
npm install --ignore-scripts /path/to/samedaydesk-capability-compat-0.1.0.tgz
```

`package.json` may also depend on the packed tarball with a `file:` path, for
example `file:../samedaydesk-capability-compat/samedaydesk-capability-compat-0.1.0.tgz`.
Run `npm pack` in the pack directory first so that file exists, then
`npm install --ignore-scripts`.

To unpack the tarball and install from its lockfile (versions already present
in the merchant lock at `e90676f48da875c5e0f475f57f7774de947b75a7`):

```bash
mkdir samedaydesk-capability-compat
tar -xzf samedaydesk-capability-compat-0.1.0.tgz -C samedaydesk-capability-compat --strip-components=1
cd samedaydesk-capability-compat
npm ci --ignore-scripts
```

Pinned dependencies are `@modelcontextprotocol/sdk` 1.32.2 and
`@modelcontextprotocol/client` 2.4.0. H99110's writer-base sdk was 1.30.0;
this pack uses the installed merchant lock versions so `npm ci` can resolve
them from that pin.

Node 22.12 or later. Then run `npx capability-compat help`.

## Probe and recovery

`capability-compat probe --endpoint <url>` uses official client 2.4.0 with an
explicit `2026-07-28` pin. On the free profile that pin is refused with
`SdkError` code `ERA_NEGOTIATION_FAILED`. Watched `server/discover` has HTTP
400, JSON-RPC `-32000`, and a message matching
`/Unsupported protocol version: 2026-07-28/` and `/2025-11-25/`. Those shapes
are taken from `mcp-current-client-compat.test.mjs` at merchant pin `e90676f4`.

`capability-compat recover --endpoint <url>` reconnects on the supported
protocol `2025-11-25` (official client default / legacy mode), then recovers
from an unknown tool through `tools/list` and completes a free compare.
`capability-compat compare --endpoint <url>` is the positive path.

`capability-compat compare-acquisition` records steps, wall time, and bytes
for a local tarball versus retained Neomorphic download bytes at
`3232f2891e7af5df3c2a350c764bfdc9d35b1f12`. It does not use the network and
does not claim a live host.


## describeCapabilities

The package root exports `describeCapabilities(request)` as the SameDayDesk CLI
provider adapter (`samedaydesk.capability-provider.preview.v1`, SCHEMA.md
section 10 at relay `79ddb381`). The request may also include an optional
`fetch` function, which is passed through to `StreamableHTTPClientTransport`
(`{ fetch }` is accepted by `@modelcontextprotocol/sdk` 1.32.2 and
`@modelcontextprotocol/client` 2.4.0). The function never reads `process.env`,
never writes to stdout or stderr, and never patches `globalThis.fetch`.

`capability-compat describe --endpoint <url>` writes that envelope to stdout.
On `ok:false`, stderr gets one `samedaydesk.cli.diagnostic.v1` line and the
process exits with the section 10.2 mapping (`endpoint_unreachable` and
`response_invalid` to 2, `protocol_unrecoverable` and `tool_missing` to 8,
`unsupported_client_sdk` to 1). An env snapshot is passed only from explicit
flags such as `--protocol-pin 2026-07-28` (`MCP_PROTOCOL_VERSION`); the bin
does not forward `process.env`.

## Tests

On a Cursor VM, from a checkout of this feature branch with merchant lockfile
dependencies already installed at `e90676f4`, run
`packs/samedaydesk-capability-compat/scripts/vm-run.sh`. The script prints
the sha256 of the packed tgz. Tests are pending that run. Do not merge, publish, or deploy from this pack alone.
