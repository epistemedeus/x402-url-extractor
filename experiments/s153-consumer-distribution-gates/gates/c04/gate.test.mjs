import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c04 migration-checklist S4 malformed-input", async () => {
  await runSituation("c04");
});
