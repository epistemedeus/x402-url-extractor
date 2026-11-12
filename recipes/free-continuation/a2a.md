# Recipe: A2A (follow-up as a new task in the same contextId)

Runtime: any A2A client. Discovery: `GET https://agents.samedaydesk.com/.well-known/agent-card.json` lists the skill `compare-held-page-observations`. Its description names the free Streamable HTTP endpoint (`POST /mcp/page-change`, tool `compare_page_observations`). The SameDayDesk `POST /a2a/message:send` returns the action catalog only; it does not run the comparison and stores no task. Each comparison runs as a `tools/call` on the MCP endpoint (see [curl-http.md](curl-http.md) or [node-mcp-sdk.md](node-mcp-sdk.md)), and the A2A task lineage is kept by the caller (`artifactLineage: "client_side"` in the recipe from `freePageCompareContinuationRecipe`).

Hosted status: two separate gaps. The hosted serving build (e90676f4) does not include `page-change-continuation.mjs`, so the hosted endpoint returns no `continuation` and no `measurement`; and after a build with the feature is deployed, it still answers `continuation_unavailable` until the production `PAGE_CHANGE_CONTINUATION_KEYS` is configured. Run these steps against a local server started with `PAGE_CHANGE_CONTINUATION_TEST_KEY=1`.

Rules: no exactly-once delivery; the `correlationId` (`ae:corr:v1:`) is non-authorizing; discovery is sent separately in `_meta["samedaydesk/measurement"]` (use `{"discovery":"a2a"}`) and travels on its own measurement part, never beside the token; the token is never logged (the continuation part is a bearer capability: keep it out of logs, traces and shared task stores).

## Positive path

1. Run the save call with `_meta {"samedaydesk/continuation":{"save":true},"samedaydesk/measurement":{"discovery":"a2a"}}`:

<!-- check: mcp-params save-a2a -->
```json
{"name":"compare_page_observations","arguments":{"before":"@c1/before.json","after":"@c1/after.json","fields":["title","description"]},"_meta":{"samedaydesk/continuation":{"save":true},"samedaydesk/measurement":{"discovery":"a2a"}}}
```

2. Record it as a completed task in your context (for example `id: "task-1"`, `contextId: "ctx-1"`, `status.state: "TASK_STATE_COMPLETED"`). Keep `continuation.token`, `continuation.correlationId` and the `after` you sent.

3. For the next step, never reopen the completed task. Build a new task in the same `contextId` that references it. In Node, `buildFreeCompareContinuationTask(priorTask, { data, measurement, taskId, messageId })` from `a2a-storefront.mjs` returns exactly this frozen shape:

<!-- check: a2a-followup -->
```json
{"taskId":"task-2","contextId":"ctx-1","message":{"role":"ROLE_USER","messageId":"msg-2","contextId":"ctx-1","referenceTaskIds":["task-1"],"parts":[{"data":{"continuation":{"token":"$TOKEN","correlationId":"$CORRELATION_ID","step":0}},"mediaType":"application/json"},{"data":{"measurement":{"v":1,"kind":"measurement","tool":"compare_page_observations","correlationId":"$CORRELATION_ID","step":0,"discovery":{"status":"declared","source":"a2a"},"outcome":"changed","occurredAt":"2026-11-12T11:47:18.000Z","discoveryBasis":{"kind":"caller_meta","matched":null},"entrySurface":{"surface":"installed","basis":"no_deployment_marker","transport":"mcp_streamable_http"}}},"mediaType":"application/json"}]}}
```

Part 1 carries the continuation and no discovery. Part 2 carries the measurement and no token, kid or continuation key.

4. Execute the follow-up as the continue call, with `before` = the kept `after`, a new `after` and the same `fields`:

<!-- check: mcp-params continue-a2a -->
```json
{"name":"compare_page_observations","arguments":{"before":"@c1/after.json","after":"@fixtures/next.json","fields":["title","description"]},"_meta":{"samedaydesk/continuation":{"token":"$TOKEN","correlationId":"$CORRELATION_ID","save":true}}}
```

The reply has the same `correlationId` and `step: 1`. Mark `task-2` completed and keep its continuation for `task-3`.

## Failure path

- A refused continue call returns `isError: true` with a typed body, for example `code: "continuation_observation_mismatch"`, `nextMethod: "tools/call"`, `nextTool: "compare_page_observations"`, `charged: false`, `paymentRequired: false`. Mark only the follow-up task failed and copy `code`, `nextMethod` and `charged` into it. `task-1` stays completed and unchanged.
- The builder itself refuses to mix: discovery beside a token throws `discovery must not sit beside a token; send it on the measurement part`, a measurement part with a token throws `measurement part must not carry a token or key`, a non-terminal prior task throws `prior task is not terminal`, and reusing the prior `taskId` throws `continuation needs a new taskId`.

## Recovery path

The continue call's reply is lost. `task-1` is still terminal and still holds the step 0 continuation. Build another follow-up (a new `taskId`, the same `contextId`, `referenceTaskIds: ["task-1"]`) and send the same continue call again. The token is not single use, so the server returns step 1 with the same `correlationId`, and a repeated step maps to one journal id. That is not exactly-once delivery: the lost attempt may also have been answered, so treat the abandoned follow-up as superseded rather than failed.
