# Root shared integration proposal

The export leaves `server.js`, package scripts, published caller0.1.0 bytes,
homepage, price and shared indexes at admitted source. Root owns adoption.

Apply `SHARED-INTEGRATION.patch` to the one `mountMcp` call. It passes the existing
`idempotencyReplay` instance and current public endpoint/tenant to the optional
port. The patch was checked with `git apply --check` and exercised in a disposable
copy of the actual full `server.js`: one verification, one settlement and one
retained result across server restart and a fresh SDK1 read client. This is
loopback QA, not deployed integration or an independently accepted purchase.

Append these new files to the existing normal `test` script (journal tests are
already included): `mcp-task-recovery.test.mjs` and
`caller-result-client/test/recovery.test.mjs`. A narrow reusable check is:

```sh
node --test idempotency-replay.test.mjs replay-boundary.http.test.mjs \
  mcp-task-recovery.test.mjs caller-result-client/test/recovery.test.mjs
node docs/reviews/native-task-recovery-211200/reproduce.mjs --candidate
```

Use the source-pinned supported Node runtime and existing normal Python httpx
dependency. `run-normal.mjs` reads and runs every file in the unmodified normal
pretest/test scripts with one worker; its log records full original commands
and actual argv. This limits shared-VM contention without reducing the normal
suite. Earlier default-concurrency failures remain exact evidence.

The caller is complete in feature source via its private CLI/direct import.
Root can connect `loadGrant` to an existing application's current authority;
shipping a new public package version/export requires its own receiving. Do not
rewrite the immutable0.1.0 archive or infer provider authentication from the
caller-supplied principal labels. The private grant file used by the test CLI
is a test/application authority input, not a merchant grant issuance service.

Unresolved settlement stays quarantined. The existing provider retention TTL
does not prove cancellation, stopping or refund; the calling application must
reconcile its original reservation before authorizing a distinct paid operation.
Check `flushMcpResults().pendingPersistence` before a controlled stop. Production
deployment, real payment-provider reconciliation and external adoption remain
unexecuted. Financial204000, EIN205000 and Pilot211300 retain original owners
and exports.
