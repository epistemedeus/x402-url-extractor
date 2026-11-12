# Recipe: plain Node CLI (offline)

Runtime: Node 20.19 or later, no network, no install beyond a checkout of this repo. The example CLI compares two held observations locally and keeps a caller-held continuation file. It never fetches, pays or signs.

Rules: no exactly-once delivery; the `correlationId` (`ae:corr:v1:`) is non-authorizing; discovery never sits beside a token (with a server it goes in `_meta["samedaydesk/measurement"]`, here the `--discovery` flag lands only on the separate measurement record on stderr); the token is never logged. A local step stores `token: null`, because a server token binds the observation the server saw and a local step changes it.

```sh
C1=examples/customer-x402/fixtures/page-change/c1
NEXT=recipes/free-continuation/fixtures/next.json
CLI=examples/customer-x402/bin/page-change.mjs
```

## Positive path

Compare and save step 0 (the file is written with mode 0600):

<!-- check: cli-args save -->
```sh
node $CLI compare --before $C1/before.json --after $C1/after.json --fields title,description --save-continuation chain.json --discovery cli
```

Stdout is the comparison report. Stderr carries the separate measurement record, with no token and no path. `occurredAt` is the local clock when the step ran, and `entrySurface` is always `installed` / `local_cli` here:

<!-- check: cli-measurement -->
```json
{"saved":true,"measurement":{"v":1,"kind":"measurement","tool":"compare_page_observations","correlationId":"$CORRELATION_ID","step":0,"discovery":{"status":"declared","source":"cli"},"outcome":null,"occurredAt":"$OCCURRED_AT","discoveryBasis":{"kind":"caller_meta","matched":null},"entrySurface":{"surface":"installed","basis":"local_cli","transport":"cli"}}}
```

The saved record (`chain.json`):

<!-- check: saved-file -->
```json
{"schema":"samedaydesk.free-page-change-continuation.v1","tool":"compare_page_observations","endpointUrl":null,"fields":["description","title"],"observationPath":"/abs/path/c1/after.json","observationSha256":"<64 hex>","token":null,"correlationId":"$CORRELATION_ID","step":0,"expiresAt":null}
```

Continue from a fresh process. Write the next step to a new file so `chain.json` stays the recovery record until this step succeeds:

<!-- check: cli-args continue -->
```sh
node $CLI compare --continue chain.json --after $NEXT --save-continuation chain-next.json && mv chain-next.json chain.json
```

The `correlationId` stays the same and `step` becomes 1.

## Failure path

Send a `before` that is not the held observation of the saved step:

<!-- check: cli-args refuse -->
```sh
node $CLI compare --continue chain.json --before $C1/before.json --after $NEXT --save-continuation chain-next.json
```

Exit code 2. Stderr is a typed refusal with a `nextMethod` cue. Nothing is charged and the input is not echoed:

<!-- check: cli-refusal -->
```json
{"ok":false,"charged":false,"paymentRequired":false,"code":"continuation_observation_mismatch","nextMethod":"page-change compare","nextStep":"Keep the saved after observation unchanged, or start a new chain."}
```

`chain.json` is unchanged, so the chain can still continue.

## Recovery path

The process dies after the compare but before `chain-next.json` is written, so the reply is lost. `chain.json` still holds step 0. Run the same continue command again. The local compare is deterministic, and the new file again has the same `correlationId` and step 1. There is no exactly-once promise: if both runs wrote a measurement line, both carry the same `correlationId` and step, so a consumer can count the step once.
