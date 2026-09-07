# samedaydesk-extract

Self-contained Claude Code plugin. It binds the canonical SameDayDesk
Streamable HTTP MCP and one extract skill. Discovery is unpaid. Payment stays
on the live merchant 402.

This folder is the plugin root. The marketplace catalog lives at the merchant
repository root in `.claude-plugin/marketplace.json`. Do not load the
repository root as a plugin. This is not the Agent Plugins 1.0 package in
`plugins/samedaydesk-x402`.

## What this plugin is

- `.claude-plugin/plugin.json` is a Claude Code plugin manifest.
- `.mcp.json` points at `https://agents.samedaydesk.com/mcp` with
  `"type": "http"` (Claude Code's name for Streamable HTTP;
  `streamable-http` is an accepted alias).
- `skills/web-extract/SKILL.md` constructs `GET /extract?url=` and the MCP
  `extract` tool from exact inputs, then stops at the live 402 unless the
  buyer explicitly authorizes payment.

The header `X-SameDayDesk-Agent-Source: claude-code-marketplace-v1` is a
claimed source label. It is not a credential. Do not treat it as proof that
the merchant accepted, bucketed, or attributed an independent customer.

## What this plugin is not

- Not the Agent Plugins 1.0 package at
  `epistemedeus/x402-url-extractor:plugins/samedaydesk-x402`. That schema is
  a different installer.
- Not a submission to `claude-plugins-official` or `claude-community`.
- Not a second paywall, wallet, signer, OAuth client, deployment hook, or
  arbitrary installer.
- Not a hardcoded price. Read the live challenge.
- Not proof of model invocation, payment, or demand after install.
- For a separate HTTP `@x402/fetch` customer example against
  `POST /extract/batch` (default) and `GET /extract`, see the
  [public customer example](https://github.com/epistemedeus/x402-url-extractor/tree/master/examples/customer-x402). This plugin
  does not become payment-capable from that example.

## Layout

```text
plugins/samedaydesk-extract/
├── .claude-plugin/plugin.json
├── .mcp.json
├── LICENSE
├── README.md
└── skills/web-extract/SKILL.md
```

Claude Code copies this directory into its plugin cache. The plugin does not
reference files outside this directory.

## Install

After this catalog is on the public default branch:

```text
/plugin marketplace add epistemedeus/x402-url-extractor
/plugin install samedaydesk-extract@samedaydesk-claude
```

Equivalent CLI:

```bash
claude plugin marketplace add epistemedeus/x402-url-extractor
claude plugin install samedaydesk-extract@samedaydesk-claude
```

Then invoke `/samedaydesk-extract:web-extract` with one public HTTPS URL.
Stop at unpaid discovery unless current buyer authority already covers the
exact live terms. Listing and install grant none. Unknown payment outcomes
reconcile; do not retry from this plugin alone.

Until the public branch exists, add a local git clone of this repository
(the directory that contains `.git` and `.claude-plugin/marketplace.json`):

```bash
export CLAUDE_CONFIG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/samedaydesk-claude-config.XXXXXX")"
export CLAUDE_CODE_PLUGIN_CACHE_DIR="$CLAUDE_CONFIG_DIR/plugins"
export DISABLE_AUTOUPDATER=1
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN CLAUDE_CODE_OAUTH_TOKEN CLAUDE_API_KEY
claude plugin marketplace add "$PWD" --scope user
claude plugin install samedaydesk-extract@samedaydesk-claude --scope user --yes
claude plugin list --json
```

Do not use `--scope project` or `--scope local` inside unrelated
repositories. Those scopes write git-root Claude settings. Use `--scope user`
with a task-scoped `CLAUDE_CONFIG_DIR`.
Keep the exports in the same shell to use this isolated install. The commands
above only install/list the plugin; they do not call an Anthropic model. A later
interactive skill invocation requires the user's own separately configured
model access and remains outside this unpaid loader trial.

After install, Claude Code copies the plugin into
`~/.claude/plugins/cache/samedaydesk-claude/samedaydesk-extract/<version>/`
(or `$CLAUDE_CODE_PLUGIN_CACHE_DIR` / `$CLAUDE_CONFIG_DIR` when those are
set). Relative marketplace source `./plugins/samedaydesk-extract` resolves
from the repository root, not from `.claude-plugin/`.

`--plugin-dir` can load this folder for a one-off session. It is not the
marketplace install path and does not register `samedaydesk-extract@samedaydesk-claude`.

## Unpaid inspect without Claude Code

```bash
npx @modelcontextprotocol/inspector@2.3.0 --cli \
  https://agents.samedaydesk.com/mcp --transport http --method tools/list --format json
```

Expect 22 tools. Do not call them.

## License

MIT.
