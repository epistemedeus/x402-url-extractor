import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c01 migration-checklist S1 positive-workflow", async () => {
  await runSituation("c01");
});
