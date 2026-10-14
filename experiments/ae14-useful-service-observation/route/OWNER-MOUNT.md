# Shared-serving mount handoff

Not applied. Writer of this package does not edit `server.js` or `commerce-events.mjs`.

`route/ROOT-SERVER-MOUNT.patch` is the candidate for the existing serving owner and Root. It does three things:

- Construct `createUsefulServiceObservation` on the existing feedback service and data directory, so there is still one feedback writer.
- Accept the optional extension on the existing `POST /commerce/caller-result-feedback`. A body with only `disposition` and `reasonCategory` is delegated unchanged.
- Replace `attachCallerResultFeedbackHeader` with `decoratePaidResponse`, which keeps that header and Link and appends `rel="useful-service-observation"`.

Paid JSON, price, payment, signer authority, and entitled retrieval are not in the patch. Callers that ignore the extra Link and send the existing body keep the existing response bytes.
