# AE20 D MCP / A2A adapter

Thin free/test adapters over X1 `url.extract.submit`, `url.extract.poll`, and `url.extract.result`. They do not extract, store jobs, or take payment. X1's base URL is `X1_BASE_URL` or `--base-url`.

```sh
cd experiments/ae20-d-mcp-a2a-adapter
npm install --ignore-scripts
npm test
```

`bin/mcp-stdio.mjs` and `bin/mcp-http.mjs` expose `url_extract_submit`, `url_extract_status`, and `url_extract_result`. `bin/a2a.mjs` serves `/.well-known/agent-card.json` and JSON-RPC `message/send` / `tasks/get` (aliases `SendMessage` / `GetTask`). The task id is X1's job id.

`test/fixtures/x1-http-fixture.mjs` is a labelled in-memory stand-in for the mounted contract. It does not fetch.
