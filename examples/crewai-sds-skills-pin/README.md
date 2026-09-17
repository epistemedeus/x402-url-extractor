# CrewAI local digest-pin of SameDayDesk SKILL.md

Populate CrewAI `Agent.skills=[]` from the portable SDS Agent Skills already in
this checkout. Each `SKILL.md` must match a committed sha256, byte length, and
git blob before the path is placed on the agent.

This example does **not** import CrewAI, call an LLM, fetch
`/.well-known/skills`, or talk to a skill registry.

## What this is

- Local pin of `plugins/samedaydesk-x402/skills/{web-extract,page-change,explicit-record}/SKILL.md`
- CrewAI constructor payload whose `skills` list is the local skills parent directory
- Offline verification: no network, no wallet, no publish

CrewAI `discover_skills` scans children of that parent for `SKILL.md`. Passing
the parent directory is the documented `skills=["./skills"]` shape.

## Pins

| Skill | Bytes | sha256 | git blob |
| --- | ---: | --- | --- |
| `web-extract` | 3324 | `382e45d33e95b81dd27c2ab38c576118159a37af2d776bc0620ecf9b472d3551` | `faffb077d648180d92e5bd1bfb8a76867bf6719f` |
| `page-change` | 3938 | `24a197775f91a002027be506b8ba60afdd10bd7d165d8a629d0b38b5f707d13a` | `e561d5b1f84af05fdaaded5dea14128b03a13105` |
| `explicit-record` | 4801 | `509c816d00d42928249b019bfa8f072b0b414f53ff48ae195de1e02a99b17062` | `abd78347b0a90425e9dbc065b6783772f4d7309c` |

`web-extract` sha256 is the same product-skill digest already asserted in
`plugins/samedaydesk-x402/plugin.test.mjs`. Git blob is `sha1("blob " + len + NUL + bytes)`.

## Install

```bash
git clone https://github.com/epistemedeus/x402-url-extractor.git
cd x402-url-extractor/examples/crewai-sds-skills-pin
```

Requires Node.js 22 or newer. No `npm ci` and no Python packages. From an
existing repository checkout, start with `cd examples/crewai-sds-skills-pin`.

## Copyable CLI

Default commands never read credentials, sign, pay, publish, or import CrewAI.
They digest-pin the checkout `SKILL.md` files and print `Agent.skills`.

```bash
npm start
node bin/cli.mjs
```

Optional explicit skills root (still local, still pinned):

```bash
node bin/cli.mjs --skills-root ../../plugins/samedaydesk-x402/skills
```

Stdlib Python companion (same payload, still no CrewAI import):

```bash
python3 python/pin_agent.py
```

The JSON `python` field is the copyable constructor:

```python
from pathlib import Path
from crewai import Agent

SDS_SKILLS = Path("/absolute/checkout/plugins/samedaydesk-x402/skills").resolve()
agent = Agent(
    role="SameDayDesk portable-skill operator",
    goal="Follow digest-pinned local SDS SKILL.md instructions without registry install or payment.",
    backstory="Loads only checkout Agent Skills whose SKILL.md sha256 matches the committed pin. Does not pay, publish, or fetch skills.",
    skills=[SDS_SKILLS],
)
```

That `skills=[SDS_SKILLS]` list is the local digest-pin. Do not replace it with
a registry ref.

## Seeded failure

A wrong `web-extract` sha256 must fail closed:

```bash
npm run seeded-failure
node bin/cli.mjs --seeded-failure
node bin/cli.mjs --pins ./fixtures/seeded-failure/digest-mismatch.json
```

Exit 1. Stderr names `digest_mismatch` and both the actual and pinned hashes.
Agent.skills is not printed.

Registry refs and remote URLs are also refused:

```bash
node bin/cli.mjs --skills '@acme/web-extract'
node bin/cli.mjs --skills-root 'https://agents.samedaydesk.com/.well-known/skills'
```

## Tests

```bash
npm test
```

## Not in this example

- CrewAI registry publish or install
- Fetching live `/.well-known/skills` as the skill bytes
- Payment, wallets, MCP `tools/call`, or LLM execution
- Copying a signer into a skill
- A second payment rail or marketplace listing
