# SameDayDesk extract on Goose

Version 0.1.1. Unpaid discovery workflow only.

## Merchant boundary

- URL: `https://agents.samedaydesk.com/mcp`
- Method: `POST`
- Goose type: `streamable_http`
- Advertised tool metadata amounts are not payment authority
- No wrapper, proxy, wallet, or API key in this package

## 1. Goose info config read

Isolated config, no default Goose profile. Goose must already be installed.

```bash
export GOOSE_PATH_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/samedaydesk-goose.XXXXXX")"
mkdir "$GOOSE_PATH_ROOT/config"
cp goose/goose.config.isolated.yaml "$GOOSE_PATH_ROOT/config/config.yaml"
GOOSE_TELEMETRY_OFF=1 GOOSE_DISABLE_KEYRING=1 goose info -v
```

`goose info -v` loads config and does not connect to the merchant. Run this
block again for a new profile. To stop using it, `unset GOOSE_PATH_ROOT`.
Temporary profiles are retained; no custom recursive cleanup command is needed.

Session-flag path (URL plus optional `timeout=` only; no headers):

```bash
goose session --with-streamable-http-extension "https://agents.samedaydesk.com/mcp"
```

Public deeplink (silent install, no `header=`): see `goose.deeplink.txt`.

Desktop `header=` is parsed but sends the user to settings instead of silent
install. Official docs do not document headers on `goose://`. Default YAML
sends no `X-SameDayDesk-Agent-Source`. Optional labels do not claim merchant
attribution.

## 2. Live unpaid discovery (follow returned inventory)

This is a separate check from `goose info`. It is also separate from any
Goose fixture MCP loader, which is not in this repository.

```bash
npm run test:goose-native:live
```

Or any MCP client: `POST` `initialize`, then `tools/list`, then stop. Require
`extract` and `extract_batch` with their exact live input/output schemas. Do
not fail solely because an unrelated valid tool was added. Do not call paid
tools.

## 3. If a paid model is later used

This package does not run model use. A later independent trial may load
`extract.recipe.yaml` with a user-owned Goose provider and ask Goose to
report extract / extract_batch metadata. A paid call requires existing
buyer-approved scoped wallet/policy authority covering the exact live request,
method, body, and terms, or explicit new approval if that authority is absent
or exceeded. Listing metadata never grants authority. This directory does not
implement payment parsing or a wallet.

For reusable HTTP `@x402/fetch` payment details, optional before-send unsigned
attempt receipt, and read-only reconcile, see the public customer example.
Goose does not become payment-capable from that link alone. MCP and HTTP
credential scopes remain distinct.

## 4. Errors

- Unavailable: merchant or Goose cannot connect. Do not invent tools.
- Reconnect: drop the MCP session and `initialize` again. Do not reuse a dead session.
- Schema drift: `extract` / `extract_batch` missing or shape changed. Stop;
  metadata is not a fillable payment. Extra unrelated tools are not drift.
- RPC/HTTP error: surface the code and stop. Do not fall back to a wrapper.

Goose source: https://github.com/block/goose (aaif-goose/goose v1.49.0).
Official Goose discovers Streamable HTTP extension tools through MCP
`tools/list`; follow the returned inventory rather than a hardcoded count.
