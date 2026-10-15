# Shared-serving mount handoff

Applied on `codex/ae14-useful-service-observation` only. It is not deployed and it is not merged to the default branch. Root receives any production mount.

`route/ROOT-SERVER-MOUNT.patch` matches `git diff 82a51274 -- server.js commerce-events.mjs`. It does four things:

- Construct `createUsefulServiceObservation` on the existing feedback service and data directory, so there is still one feedback writer.
- Accept the optional extension on the existing `POST /commerce/caller-result-feedback`. A body with only `disposition` and `reasonCategory` is delegated unchanged.
- Serve `usefulServiceObservationPublicContract()` from the existing GET. Every previous contract key stays the same, and `usefulServiceObservation` is the one added field.
- Replace `attachCallerResultFeedbackHeader` with `decoratePaidResponse`, which keeps that header and Link and appends `rel="useful-service-observation"`.

Paid JSON, price, payment, signer authority, and entitled retrieval are not in the patch. Callers that ignore the extra Link and send the existing body keep the existing response bytes.
