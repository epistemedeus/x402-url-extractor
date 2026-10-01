# Unpaid door decision

Free decision for one already-supported question: can the unpaid seller response, plus that seller's free catalog, tell a caller whether the door is payable before anyone pays?

The 2026-10-01 replay of the named inventory answered yes for every public row. The existing `GET /commerce/seller-integrity-audit` was not required. This example does not add a route, price, recipient, or SKU. It never sends a payment header.

Pilot252 `EXPERIMENTS.md` E2 is the reference hypothesis. The old "sample 10" figure is not a cap in this command.

## Replay the saved public evidence

```sh
node examples/unpaid-door-decision/cli.mjs replay
```

Exit 0 means every `public_replay` row is free-sufficient and `paidAuditRequired` is 0. `cashUsd` stays 0. A caller label, including `independent`, does not confirm independent demand.

## Refetch one named public door

```sh
node examples/unpaid-door-decision/cli.mjs live --id issue3249-root
```

Inventory ids are `issue3249-root`, `t1-bronzetti-brief`, `merchant-extract`, and `merchant-lockfile-get`. The command follows no redirect and sends no payment. `issue3249-root` also requests the invented control path named in the x402 issue comment, on the same host only.

Current MCP, unpaid:

```sh
node examples/unpaid-door-decision/cli.mjs mcp
```

## Receipt a later task can reuse

`TASK.txt` is the task. `receipt.json` binds that text to `evidence/2026-10-01-public-replay.json`.

```sh
node examples/unpaid-door-decision/cli.mjs check-receipt --receipt examples/unpaid-door-decision/receipt.json
```

Exit 0 accepts the negative decision. Edit `TASK.txt` and the same command exits 4 with `task_changed`: the old negative is not evidence for the new wording. The receipt schema still parses, so the later task reuses the checker instead of a new format.

Seeded failures this command rejects:

```sh
node examples/unpaid-door-decision/cli.mjs check-receipt --receipt examples/unpaid-door-decision/fixtures/seeded-independent-demand.json
node examples/unpaid-door-decision/cli.mjs check-receipt --receipt examples/unpaid-door-decision/fixtures/seeded-incomplete-audit.json
```

Both exit 3. A self-reported independent actor is not demand. An incomplete audit is not useful delivery.

## What the classes mean

`payable`, `402_sans_accepts`, `false_routing`, `method_mismatch`, `free_or_open`, `missing_route`, `terms_changed`, and `terms_ambiguous` are all answered by the unpaid documents. `false_routing` is a blanket 402 that also appears on a different invented path. `terms_changed` compares caller-supplied digests and does not settle the old terms. Amount agreement for a USD catalog string uses 6-decimal Base USDC only when the unpaid accept is that asset on `eip155:8453`; otherwise the comparison stays `unknown`.

Owner QA stays `unknown`. Commerce-demand coverage on the saved snapshot stays `unknown_for_full_window`.
