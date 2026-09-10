import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c05 migration-checklist S5 cli-stdout-batch", async () => {
  await runSituation("c05");
});
