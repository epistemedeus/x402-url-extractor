# SameDayDesk on Goose

Native Goose `streamable_http` files for the live merchant at
`https://agents.samedaydesk.com/mcp`. This is config and documentation, not
an installer, wrapper, wallet, or directory listing.

## Copyable isolated profile

Goose must already be installed. Existing profiles stay unchanged.

```bash
export GOOSE_PATH_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/samedaydesk-goose.XXXXXX")"
mkdir "$GOOSE_PATH_ROOT/config"
cp goose/goose.config.isolated.yaml "$GOOSE_PATH_ROOT/config/config.yaml"
GOOSE_TELEMETRY_OFF=1 GOOSE_DISABLE_KEYRING=1 goose info -v
```

`goose info -v` only reads config. It does not connect to the merchant.

To stop: `unset GOOSE_PATH_ROOT`. Temporary profiles are retained. There is
no cleanup command.

Merge-safe add-only config: `goose.config.yaml`. Isolated home that also
disables bundled Goose platform extensions: `goose.config.isolated.yaml`.

## Three different checks

Do not mix these:

1. Goose info config read: the block above. Config YAML only.
2. Fixture MCP loader: not in this repository. C13 kept that as experiment
   test scaffolding. Public distribution does not ship it. Local package tests
   may use an in-process fixture `tools/list` inventory only.
3. Live unpaid discovery: `POST` `initialize` then `tools/list` on
   `https://agents.samedaydesk.com/mcp`, or `npm run test:goose-native:live`.
   Require `extract` and `extract_batch` with their live input/output schemas.
   Extra unrelated tools are accepted. Default Goose YAML sends no source
   header.

## Session flag and deeplink

```bash
goose session --with-streamable-http-extension "https://agents.samedaydesk.com/mcp"
```

Public silent-install link: `goose.deeplink.txt`. Official silent install
does not send custom headers. Default package headers stay empty.

Optional `goose.config.with-declared-source.yaml` is labeled, spoofable,
and caller-declared. The merchant may bucket `goose-native-v1` as unverified
attribution. It is not identity, payment, or organic-acquisition proof, and it
is not the default.

Retention covers HTTP request records and observed direct MCP tool outcomes.
MCP `extract_batch` retains source on its exact `/extract/batch` HTTP record
only. Initialization and tools/list create no tool-outcome events. These
observations do not establish identity, independent use, or demand.

Workflow copy: `extract.workflow.md`. Recipe: `extract.recipe.yaml` (report
extract and extract_batch metadata only; do not call paid tools from this
package).

HTTP customer preflight and explicitly authorized `@x402/fetch` purchase for
`POST /extract/batch` (default) and `GET /extract`, including optional
before-send unsigned attempt receipt and read-only reconcile:
[public customer example](https://github.com/epistemedeus/x402-url-extractor/tree/master/examples/customer-x402).
This Goose package does not become payment-capable from that example. MCP and
HTTP credential scopes remain distinct.
