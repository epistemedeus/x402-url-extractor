# Unsupported runtime: Claude API Skills

Rejected. Claude API Skills (Anthropic Messages API `container.skills`) have no network.

This skill constructs live HTTPS extract routes and Streamable HTTP MCP at
`https://agents.samedaydesk.com/mcp`. Those calls cannot run in Claude API Skills.
Do not upload `SKILL.md` as a Claude API Skill.

Supported in-repo loaders:

- Cursor: `.cursor/skills/web-extract/`
- Claude Code: `.claude/skills/web-extract/`
- Grok Bot: `.grok/skills/web-extract/`

Prove the reject from this skill directory:

```bash
node reject-claude-api-skills.mjs claude-api-skills
```

That command exits 1.
