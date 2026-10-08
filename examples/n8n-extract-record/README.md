# n8n extract record

Cold-importable workflows for the pinned `executeExtractBatch` handler and `examples/customer-x402/bin/record.mjs`.

The extract workflow reads `N8N_EXTRACT_TASK` and writes a caller-owned directory at `N8N_EXTRACT_STORE`. The retrieve workflow reads that directory back. It does not call the handler again. Page bodies in the task are the no-funds fetch harness used by the merchant tests. They are not a settled purchase. `formatMerchantResult` still sets `charged: true` on a completed handler response. That field is not settlement.

n8n 2.42.5 refuses workflow commands on Node 22 and declares `node >=24`. The example scripts and the merchant tests stay on the repository Node. The installed default `NODES_EXCLUDE` is `n8n-nodes-base.executeCommand` and `n8n-nodes-base.localFileTrigger`, so the disposable runtime sets `NODES_EXCLUDE=[]`. A Code node cannot import this repository's ESM handler, and an HTTP Request node cannot inject the no-funds harness into the paid route. No custom node is added. Do not set `N8N_PORT` to 5679: that is the default task-broker port. An n8n execution status of success means the command exited 0. Partial records still exit 1 from `bin/record.mjs`. Read `status` in the command stdout.

From this directory, after `npm ci` here and in the repository root and `examples/customer-x402`:

```bash
export N8N_EXTRACT_HOME="$PWD"
export N8N_EXTRACT_STORE="$PWD/runtime/store"
export N8N_EXTRACT_TASK="$PWD/fixtures/partial-task.json"
export N8N_USER_FOLDER="$PWD/runtime/n8n"
export NODES_EXCLUDE='[]'
node bin/extract.mjs
export N8N_EXTRACT_ARTIFACT="<artifactId from the extract JSON>"
node bin/retrieve.mjs
```

Server CLI, with `./node_modules/.bin/n8n` and the same environment. n8n 2.42.5 single-file import upserts on `id` and does not generate one (`--separate` does). The files pin 16-character ids:

```bash
n8n import:workflow --input=workflows/extract-record.workflow.json
n8n import:workflow --input=workflows/retrieve-record.workflow.json
n8n execute --id=SdExtract0000001
n8n execute --id=SdRetrieve000001
```

`Wintyx57/n8n-nodes-x402-bazaar` at `e1d4467db0cb1d47296f8c5d0b038346d037c291` is not used. See `OUTCOME.md`.
