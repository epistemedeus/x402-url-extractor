/**
 * TEST-ONLY. Keeps the loopback page-change harness up so the official
 * conformance runner can reach it during a VM run. Prints one line,
 * `LISTENING <endpoint>`, then waits for SIGTERM or SIGINT.
 */
import { startLoopbackPageChange } from "./start-loopback-page-change.mjs";

const profile = await startLoopbackPageChange();
process.stdout.write(`LISTENING ${profile.endpoint}\n`);
const stop = async () => {
  await profile.close();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
