# Needed enrollment

This view can read a journal Root already exported. It cannot see production
until Root enrolls that read. The integration target is merchant161
`32f07a836fb28e400d56b0e2e876043644bde31a`. Merchant160
`dc32cf7bf5fd76a5cd9047865f49b2462252897c` is historical only.

1. Merchant161 was fetched. It is the merge of pull request 161. Its second
   parent is the public-acquisition artifact
   `4b7928f315be9d9ec7d14f2604eab1b7b236a63a`. The only file that differs from
   merchant160 is `public-acquisition/receiving/artifact.json`. The `server.js`
   blob `77e0e67c6c62f8e4a5c12d5b84e3bd8c7e74e0b7` is the same on both heads.
   `freeTaskObservation` has no match in `server.js` or
   `useful-result-reuse/http.mjs`. The three 421 patches stay unapplied.
   This packet does not apply them, does not copy the receiving artifact, and
   does not edit `server.js`.
2. Root chooses one caller-supplied task. The owner-QA receipt fixtures are
   not that task. `liveCoverage` remains false until a production journal cut
   is supplied.
3. Root passes one authorized read-only cut of the existing attempts,
   task-ref, forward, retention, read, and settlement planes into
   `readAttemptUsefulView`. One task ref per call. `attemptOf` stays null.
4. Do not mint operation `add923ae-3eb5-474b-8b3e-e376666dee83`. Do not reuse
   prior view operation `bc331d8d-2e56-4770-93d2-bc40bc146e8c`. Do not add a
   database, signer, global agent id, or customer label. Do not attach the
   43-row settlement ledger or the 3692-event day to the attempt.
5. Payment and revenue classification stay on the existing classifier. A free
   observation leaves settlement unresolved. Recognized revenue stays 0.
   There is no payment replay.

The artifact is a cold-command deployment readback. `paidLaunch` is false,
the remote index is a draft, and `paid_success` is absent from it. That
readback does not enroll this view. Until the steps above happen, enrollment
is waiting and the integration delta is `prepared_unapplied`.
