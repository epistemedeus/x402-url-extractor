import { reconcilePersistedAttempt } from "./enroll.mjs";
import { readPersistedAttempt } from "./read.mjs";

if (process.send) {
  process.once("message", (input) => {
    const run = async () => {
      if (!input || typeof input !== "object" || input.paymentReplay === true || input.database || input.signer) {
        const error = new Error("payment_replay_refused");
        error.code = "payment_replay_refused";
        throw error;
      }
      if (input.action === "reconcile") return reconcilePersistedAttempt(input);
      return readPersistedAttempt(input);
    };
    run()
      .then((value) => process.send({ value }, () => process.disconnect()))
      .catch((error) => process.send({ error: error.code || error.message, stack: error.stack }, () => process.disconnect()));
  });
}
