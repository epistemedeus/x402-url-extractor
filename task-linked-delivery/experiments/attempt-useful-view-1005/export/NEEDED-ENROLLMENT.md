# Needed enrollment

This view can read a journal Root already exported. It cannot see production
until Root enrolls that read.

1. Released merchant head `dc32cf7bf5fd76a5cd9047865f49b2462252897c` does not
   mount the 421 observation adapter. The three 421 patches stay unapplied.
   This packet does not apply them and does not edit `server.js`.
2. Root chooses one caller-supplied task. The owner-QA receipt fixtures are
   not that task. `liveCoverage` remains false until a production journal cut
   is supplied.
3. Root passes one authorized read-only cut of the existing attempts,
   task-ref, forward, retention, read, and settlement planes into
   `readAttemptUsefulView`. One task ref per call. `attemptOf` stays null.
4. Do not mint operation `add923ae-3eb5-474b-8b3e-e376666dee83`. Do not add a
   database, signer, global agent id, or customer label. Do not attach the
   43-row settlement ledger or the 3692-event day to the attempt.
5. Payment and revenue classification stay on the existing classifier. A free
   observation leaves settlement unresolved. Recognized revenue stays 0.
   There is no payment replay.

Until those steps happen, enrollment is waiting and the integration delta is
unapplied.
