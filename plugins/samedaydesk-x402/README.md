# samedaydesk-x402

Agent Plugins 1.0.0 package that pins the live SameDayDesk remote MCP URL.
It is a portable directory, not a marketplace listing.

This folder is the plugin root. The merchant repository around it is not the
plugin. Do not load the repository root as a plugin.

## What this package is

- `plugin.json` targets Agent Plugins 1.0.0.
- `mcp.json` declares one Streamable HTTP server at
  `https://agents.samedaydesk.com/mcp`.
- `skills/web-extract/SKILL.md` is a copy of the GitHub product skill and
  already constructs `GET /extract?url=`.

The `X-SameDayDesk-Agent-Source: agent-plugins-v1` header is public package
data, not a credential. Agent Plugins 1.0 forbids secrets in `headers`.

## What this package is not

- Not submitted to Awesome Copilot, the GitHub MCP gallery, the ChatGPT or
  Codex public plugin directory, or any other marketplace.
- Not an MCP Registry publish. The live remote is already
  `io.github.epistemedeus/x402-data-gateway@1.23.26`.
- Not a claim that Copilot, Cursor, VS Code, ChatGPT, Codex, or Grok loaded
  this folder in a host UI.
- Not dual-stack MCP `2026-07-28`. Live `/mcp` JSON-RPC `initialize` with
  that version negotiates down to `2025-11-25`. Header-routed `Mcp-Method`
  returns HTTP 400. This package does not send either.
- Not OAuth. `/.well-known/oauth-authorization-server` is 404. Unpaid
  `initialize` and `tools/list` do not require a login.
- Not a paid `tools/call`. Do not put payment headers in this package.

## Layout

```text
plugins/samedaydesk-x402/
├── plugin.json
├── mcp.json
├── LICENSE
├── README.md
├── skills/
│   └── web-extract/
│       └── SKILL.md
└── test/
    └── official-schemas/
```

Official schemas under `test/official-schemas/` are copies of
`https://agent-plugins.org/schemas/1.0.0/` for offline validation. They are
not a second specification.

## Install from the default branch

Clone the repository, then point a host at this plugin directory.

```bash
git clone https://github.com/epistemedeus/x402-url-extractor.git
cd x402-url-extractor
PLUGIN_ROOT="$PWD/plugins/samedaydesk-x402"
```

VS Code (Agent Plugins 1.0 local path, 2026-08-19 host docs):

```json
{
  "chat.plugins.enabled": true,
  "chat.pluginLocations": {
    "/absolute/path/x402-url-extractor/plugins/samedaydesk-x402": true
  }
}
```

GitHub Copilot CLI local load:

```bash
copilot --plugin-dir /absolute/path/x402-url-extractor/plugins/samedaydesk-x402
```

GitHub Copilot CLI direct install from the default-branch subdirectory:

```bash
copilot plugin install epistemedeus/x402-url-extractor:plugins/samedaydesk-x402
```

Codex native plugins still use `.codex-plugin/plugin.json`. This package is
the portable Agent Plugins 1.0 layout, not that Codex-native manifest.
Cursor remains on the Agent Plugins 1.0 launch-client list; this package
adds no Cursor-specific extension namespace. Cursor-native `.cursor/mcp.json`
is a different format.

First-party URL MCP, without this folder:

```bash
grok mcp add --transport http samedaydesk https://agents.samedaydesk.com/mcp
```

Stop at tool list. Do not call paid tools.

## Initialize-era MCP

The live server speaks JSON-RPC `initialize` / `tools/list` over Streamable
HTTP. Clients should send `protocolVersion: "2025-11-25"` (or an older
listed initialize-era version). Do not send `Mcp-Method`. Do not claim
`2026-07-28` support.

Unpaid inspect, Inspector 2.3.0:

```bash
npx @modelcontextprotocol/inspector@2.3.0 --cli \
  https://agents.samedaydesk.com/mcp --transport http --method tools/list --format json
```

Expect 22 tools. Do not call them.

## Validate

From the repository root:

```bash
npm run test:agent-plugin
```

That checks the closed Agent Plugins 1.0 schemas, forbids credentials and
`2026-07-28` claims, and performs unpaid live `initialize` plus `tools/list`
against the pinned URL.

## License

MIT. Same license as `epistemedeus/x402-url-extractor`.
