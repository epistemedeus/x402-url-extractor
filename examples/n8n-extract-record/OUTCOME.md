# Outcome: n8n extract and retrieve

The cheap Stage1 hypothesis did not hold on this VM. A caller who can run Node takes fewer manual steps and less wall time with `bin/extract.mjs` and `bin/retrieve.mjs` than with the same scripts behind n8n. The asset is the tested workflow pair and its truthful partial and refused outputs. Receiving it is not adoption, savings, or revenue.

The workflow executions made no model calls and consumed no inference tokens. Building this example was a separate native Heavy task:119 model calls,652,891 input,11,732,864 cache-read and133,229 output tokens, with2.76208444USD API-equivalent modeled usage, not a cash charge or complete review cost. Workflow cash cost was zero. Settlement was `not_performed`, purchase fetches were0, and no wallet or signer was used.

## Source and pins

- Repository base: `f89ad0644cec7b4409aa135b8b9137d2be322159` on `codex/root-n8n-whole-task-104660`. Merchant package `1.23.51`.
- Owned path: `examples/n8n-extract-record/` only. No merchant runtime, payment behavior, or human page was edited.
- n8n npm package `2.42.5`, lockfile confined to this directory. `n8n --version` printed `2.42.5`.
- n8n workflow commands require Node `>=24`. They were run on Node `v24.21.0`. Merchant tests, example tests, and the direct CLI comparison were run on Node `v22.22.2`. `n8n --help` on Node 22.22.2 exits 1 with "currently not supported".
- Native addons installed under Node 22 did not load under Node 24 (`isolated-vm` undefined symbol). `npm rebuild isolated-vm sqlite3` on Node 24 took 93.52s. The lockfile was not rewritten.
- `npm install` of n8n reported `added 2326 packages in 3m`.

Importable workflow files, sha256 of the committed bytes:

| File | id | sha256 |
| --- | --- | --- |
| `workflows/extract-record.workflow.json` | `SdExtract0000001` | `6d7ccffb8d1b835839da79d6294c9165e4229771aec984583eaaa680c5fbd464` |
| `workflows/retrieve-record.workflow.json` | `SdRetrieve000001` | `cb78e86a1bd3fd0893ae324cd325b97cb110cdad658605ff181abd91d54b0499` |

`n8n export:workflow --pretty` after import wrote one-element arrays. Those exports are gitignored under `receiving/exports/`.

| Export | sha256 | bytes |
| --- | --- | --- |
| extract | `cfebe930d920be4f8947c64afb18bfea80553ef0559b0d161cdd12b9b70e9092` | 2395 |
| retrieve | `ea257bd74c370ac34892b89d022e98b480c3a31174621fc22fd9a0b0b551e5d3` | 2389 |

The export adds instance fields. `shared[0].projectId` is `UjkSxIilA2ycZdxG` and `project.creatorId` is the shell user `4bc2afd4-afa8-4ffd-b32b-c66fb17e8220`. Version ids from this database are `effd722d-223e-416a-be74-455ef8b13e1a` and `4953a010-0aef-4530-9b4b-35060bc41ce0`. The committed files stay the portable import. The export is the runtime round-trip, not a second source of truth.

## Why this shape

`Wintyx57/n8n-nodes-x402-bazaar` at `e1d4467db0cb1d47296f8c5d0b038346d037c291` does not solve the task. That commit is `@wintyx/n8n-nodes-x402-bazaar` 1.4.1, MIT, peer `n8n-workflow *`, devDependency `n8n-workflow ^1.64.0` and `viem ^2.21.0`, no runtime dependencies. The node requires an `x402BazaarCredentials` private key. Operations are `callApi`, `listServices`, `getBalance`, `getServiceInfo`, and `registerService` against `https://x402-api.onrender.com`, paying with a viem USDC transfer or an x402 v1 facilitator settle. It does not call SameDayDesk `POST /extract/batch` or `executeExtractBatch`. It does not take 1–5 URLs plus required fields plus a buyer mapping and schema. Its output is marketplace JSON plus payment metadata, not records, report, and missing-paths with provenance. It has no caller-owned artifact store and no second workflow that returns the same artifact without refetching or paying. Using it would add another wallet and a Bazaar payment wrapper.

No custom node was added. The Code node sandbox cannot import this repository's ESM handler or inject `fetchImpl`. HTTP Request would hit the paid route and cannot inject the no-funds harness. Read/Write File can store bytes and cannot run `executeExtractBatch` or `projectRecords`. The workflow is Manual Trigger plus the built-in Execute Command node (`n8n-nodes-base.executeCommand`, typeVersion 1). Installed `@n8n/config` defaults `NODES_EXCLUDE` to `n8n-nodes-base.executeCommand` and `n8n-nodes-base.localFileTrigger`. The disposable runtime sets `NODES_EXCLUDE=[]`.

The bins call the existing modules: `executeExtractBatch` with an injected fetch, `normalizeAuthorization` and `assertRequestMatchesAuthorization`, `runAuthorizedPurchase({ approve: false })`, `boundedFetch` of the local handler JSON, `validateBatchBuyerOutput`, `decideExtractTask` recorded and not used as the batch predicate, and `examples/customer-x402/bin/record.mjs`. `caller-result.mjs` feedback stays in its process-private WeakMap. Nothing in this example calls `reportCallerResult`, `bindCallerResultFeedback`, or `useful-result-reuse`.

n8n 2.42.5 single-file `import:workflow` upserts on `id` and does not run the entity `BeforeInsert` id generator. A first import without `id` failed with `SQLITE_CONSTRAINT: NOT NULL constraint failed: workflow_entity.id`. Directory `--separate` import does generate an id. The committed files pin 16-character ids so the documented single-file command is stable.

## Cold import and extract

Disposable home: `N8N_USER_FOLDER=examples/n8n-extract-record/runtime/cold`, so sqlite and the encryption key landed in `runtime/cold/.n8n/`. That tree is gitignored. Diagnostics, version notifications, templates, and personalization were off. `DB_TYPE=sqlite`. Executions were saved on success and error.

Commands and wall time, Node v24.21.0:

| Command | Exit | Seconds |
| --- | --- | --- |
| `n8n import:workflow --input=workflows/extract-record.workflow.json` | 0 | 3.905 |
| `n8n import:workflow --input=workflows/retrieve-record.workflow.json` | 0 | 2.048 |
| `n8n list:workflow` | 0 | 1.875 |
| `n8n execute --id=SdExtract0000001` on `fixtures/partial-task.json` | 0 | 2.828 |

Both imports printed `Successfully imported 1 workflow.` `list:workflow` printed the two ids and names. Migrations created one `user` row: email null, first name null, last name null, password absent, `lastActiveAt` null. `setupOwner` was not called. No cloud account was created.

Execution id 1, `workflowId=SdExtract0000001`, `mode=cli`, n8n `status=success`, `startedAt=2026-10-08 16:11:15.633`, `stoppedAt=2026-10-08 16:11:16.395`. n8n success means the command exited 0. The record result is partial.

Caller store `runtime/store-receive/580319d64c0e8e258db542524b9fb42d9d9152f75bd47d1abbc03b03b92f6bdb/`. `inputBinding` equals that id. `storageAuthority` is `caller-owned-directory`. `merchantGrant` and `usefulResultReuseGrant` are false.

Handler body from `executeExtractBatch` plus the injected harness, not a fabricated delivery:

- `product` `samedaydesk-extract-batch`, `jobStatus` `completed`, `jobId` `a090c433fc70d147f0ce9497edb5e92445f6530602a1863f114a15e6fcdb1ba6`.
- `https://alpha.example/product` status `success`, title `Alpha`, one JSON-LD product.
- `https://beta.example/broken` status `partial`, title `Broken`, `jsonLd` length 0, note `Expected property name or '}' in JSON at position 1 (line 1 column 2)`.
- Body `ok` true and `charged` true. Manifest `handlerChargedField` true and `handlerChargedFieldIsSettlement` false. `paymentHeader` `absent`. `settlement` `not_performed`. `paymentAttempted` false. `purchaseFetches` 0. Purchase gate returned `purchase requires explicit approve=true`.
- `fetchCalls` 2. `merchantAccountingRetries` 0. `feedbackSent`, `feedbackRetried`, and `workflowRetried` false.
- `records.json` is one success record. `fields.name` `Alpha`, `fields.sku` `A-1`. Provenance pointer `/sources/0/data/jsonLd/0/name`.
- Record CLI inside the workflow exited 1. `report.json` status `partial`. `single-extract-task.json` has `satisfied` null and `reason` `predicate_not_declared`. That single-extract decision is stored and does not fail the batch.

## Restart and retrieval

A first `n8n start` with `N8N_PORT=5679` exited 1 in 3.002s. The log said the task broker port 5679 was already in use. The installed default broker port is 5679, so it collided with the editor port.

The restart that counts used `N8N_PORT=5688` and `N8N_RUNNERS_BROKER_PORT=5689`. The port answered in 3.001s. The log contains `n8n ready on 127.0.0.1, port 5688`, `n8n Task Broker ready on 127.0.0.1, port 5689`, `Version: 2.42.5`, and `Editor is now accessible via: http://localhost:5688`. The internal Python runner failed because its virtual environment is missing. The JS runner registered. Execute Command does not use the Python runner. SIGTERM stopped the server, exit 0, and the port closed before the next sqlite writer.

A new process then ran `n8n execute --id=SdRetrieve000001` with `N8N_EXTRACT_ARTIFACT=580319d64c0e8e258db542524b9fb42d9d9152f75bd47d1abbc03b03b92f6bdb` and the same partial task. Execution id 2, `2026-10-08 16:12:51.307` to `16:12:51.364`, process wall 2.147s. Stdout `ok` true, `status` `partial`, `refetched` false, `paymentAttempted` false, `settlement` `not_performed`, `storageAuthority` `caller-owned-directory`, same `inputBinding`. Record name `Alpha`, sku `A-1`, pointer `/sources/0/data/jsonLd/0/name`. `delivery.json` mtime and bytes were unchanged. The retrieve module does not import the handler.

## Negatives on this runtime

| Execution | Workflow | Started | Result |
| --- | --- | --- | --- |
| 3 | retrieve | 16:12:53.471 | Changed `fields` to `["title"]`. `input_binding_mismatch`, `records` null, `refetched` false. Process 2.162s. |
| 4 | retrieve | 16:12:55.727 | Artifact id `ab` repeated to 64 hex chars. `artifact_not_found`, status `missing`, `records` null. Process 2.258s. |
| 5 | retrieve | 16:12:57.859 | Artifact id `../etc/passwd`. `artifact.foreign`, `records` null. Process 2.131s. |
| 6 | extract | 16:13:00.075 | `fixtures/fields-unknown-task.json`. Status `refused`, `fetchCalls` 0, `handlerChargedField` false, no `records.json`. Delivery code `fields_unknown`, `charged` false. Artifact `58217df915957a53b5f228aa977fdd0c937918627df95db573514ce6f88430fb`. Process 2.694s. |

n8n marked executions 3–6 `success` because the bins exit 0 when they publish an explicit outcome. The stdout `status` and `reason` are the record outcome.

Example tests on Node 22, `node --test examples/n8n-extract-record/test/n8n-extract-record.test.mjs`: 11 pass, 0 fail, `duration_ms` 4070.599485. Those tests also cover a missing required name, a 404 with `accounting.retries` 0, duplicate URLs kept as `skipped_duplicate` with one fetch, six URLs refused as `urls_invalid` before fetch, the same input reused without a second handler call, a lost id, and the malformed JSON-LD note coming from the handler. They assert the workflow JSON has no private key and that the example source does not mention caller feedback.

## Existing suites

`RECORD_REQUIRE_MERCHANT=1 node --test` on Node v22.22.2, 2026-10-08:

`examples/customer-x402/test/record-adversarial.test.mjs`, `record-cli.test.mjs`, `record-merchant-compat.test.mjs`, `record-merchant-runtime.test.mjs`, `record-pins.test.mjs`, `record-pointer.test.mjs`, `record-project.test.mjs`, `record-regressions.test.mjs`, `record-w6.test.mjs`, `batch-customer-x402.test.mjs`, `review-batch-boundaries.test.mjs`, `customer-x402.test.mjs`, plus `extract-batch-record.test.mjs`, `extract-batch.identity.test.mjs`, and `extract-batch.test.mjs`.

Result: 103 tests, 102 pass, 0 fail, 1 skip, `duration_ms` 2778.786159. The skip is `bounded credential-free production preflight` (`CUSTOMER_X402_LIVE_PREFLIGHT` unset). `ok 50` is `exact public merchant schema and injected real partial runtime compose` from `record-merchant-runtime.test.mjs`. The whole root `npm test` suite was not run.

## Comparison

Same partial task. Direct commands on Node 22. Record CLI on the delivery.json written by n8n execution 1.

| Path | What was timed | Wall clock | Record result |
| --- | --- | --- | --- |
| Direct extract | `node bin/extract.mjs --task --store` | 0.699s | partial, same artifact id `580319d6…6bdb` |
| Direct retrieve | `node bin/retrieve.mjs` in a second process | 0.036s | Alpha, `refetched` false |
| Record CLI only | `examples/customer-x402/bin/record.mjs` on that delivery | 0.115s, exit 1 | `records.json` byte-identical to the n8n store |
| n8n extract process | `n8n execute --id=SdExtract0000001` | 2.828s | partial; workflow body 0.762s |
| n8n retrieve process | `n8n execute --id=SdRetrieve000001` | 2.147s | same artifact; workflow body 0.057s |
| n8n install | `npm install` in this directory | 3m, 2326 packages | runtime only |
| Native rebuild | `npm rebuild isolated-vm sqlite3` on Node 24 | 93.52s | required after the Node 22 install |

Manual steps once the repository and Node 22 are present: two node commands, then read `status` and the records. Manual steps for this n8n path from the same checkout: install n8n, install Node 24, rebuild native addons, set `NODES_EXCLUDE=[]` and a non-colliding port, import two files, execute, interpret n8n success against stdout `status`, start and stop the server, execute retrieve, then review. With n8n already running and Execute Command already enabled, import, environment, execute, and interpretation remain. That is more surrounding effort than the direct CLI. The hypothesis of less surrounding effort is not supported.

## Limits

- Page bodies in the fixtures are the no-funds harness. They are not network fetches and not a settled purchase.
- `formatMerchantResult` sets `charged: true` when the handler completes. That field is not settlement.
- `runAuthorizedPurchase({ approve: false })` returns `authorization_refused`. It does not throw out of the function. The refuse path does not bind caller feedback.
- `decideExtractTask` on a batch body with `ok: true` returns `satisfied: null` and `predicate_not_declared`.
- Execute Command is off unless `NODES_EXCLUDE=[]`. It is self-hosted. The command string is expanded by a POSIX shell.
- Single-file import requires a workflow `id` on n8n 2.42.5.
- The sqlite shell user is not an owner account. No password was set.
- An early `n8n --help` before `N8N_USER_FOLDER` was set wrote `/home/ubuntu/.n8n/config`. The receiving database is under the gitignored example runtime. Neither config is committed.
- Internal Python task runner did not start. JS execution of Execute Command did.
- n8n outside a container is deprecated by this n8n build. This trial used the Server CLI on the VM.

## Possible fixture reproduction, not a launched integration

This recipe currently reads injected page fixtures. It is not a live network extraction or paid merchant workflow. Reproducing it can test compatibility, but cannot establish outside useful delivery. Root retained the recipe after the direct CLI won the measured comparison; no distribution or production launch is approved by this report.

A visitor with their own self-hosted n8n 2.42.x, Node 24, and `NODES_EXCLUDE=[]` imports the two committed JSON files, sets `N8N_EXTRACT_HOME`, `N8N_EXTRACT_TASK`, and `N8N_EXTRACT_STORE`, executes `SdExtract0000001`, then in a later process executes `SdRetrieve000001` with `N8N_EXTRACT_ARTIFACT`. They keep the editor port off 5679. They read stdout `status`, not the n8n execution status. A settled purchase stays a separate approval. This artifact does not grant one.

Root receives this directory and decides distribution. No merge, deploy, account, or payment change is included.
