# SameDayDesk on Hermes Agent

Portable AgentSkills (`SKILL.md`) for Nous Research Hermes. This is skill
guidance, not a Hermes plugin, MCP wrapper, wallet, or directory listing.

Hermes already loads the existing Agent Skills files in
`plugins/samedaydesk-x402/skills/` when they are copied into
`$HERMES_HOME/skills/` or installed with `hermes skills install`. No extra
Hermes-specific format is required.

## Skills

| Skill | Job | Pays? |
| --- | --- | --- |
| `web-extract` | Construct one unpaid bounded `POST /extract/batch` or `GET /extract` | No. Stop at live 402 unless a separate customer-owned signer is explicitly approved. |
| `page-change` | Compare two already delivered batch JSON files | No. Offline. Fixtures first. |

These skills do not implement an x402 or MPP signer. This package verifies
discovery, not Hermes-wide payment capability. User-owned signing stays in
[`examples/customer-x402`](../examples/customer-x402).

## Isolated discovery (no global profile)

See [`INSTALL.txt`](INSTALL.txt). Maintainer check:

```bash
npm run test:hermes-native
```

Optional official loader proof, with a local Hermes source checkout and a
fresh empty throwaway `HERMES_HOME` (never `~/.hermes`):

```bash
export HERMES_HOME="$(mktemp -d "${TMPDIR:-/tmp}/samedaydesk-hermes.XXXXXX")"
export HERMES_AGENT_SRC=/path/to/NousResearch/hermes-agent
npm run test:hermes-native:loader
```

The tests create their own isolated profiles. That path is native loader/discovery
only. Model execution and payment execution are separate evidence boundaries;
neither is performed here.

Project-local `.hermes/skills` or `.agents/skills` inside a git checkout
does not auto-load. Hermes requires `hermes skills trust` for that root.

## Not this package

- Not `hermes skills tap add` publication.
- Not a well-known skills index on the merchant.
- Not a Goose-style MCP YAML (that remains in `goose/`).
- Not a Claude marketplace plugin (that remains in `plugins/samedaydesk-extract`).
- Not an autonomous cron/blueprint. Do not attach these skills to a scheduler
  that would purchase or refetch.
