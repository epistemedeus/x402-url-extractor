import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c07 migration-checklist S7 coverage-integrity", async () => {
  await runSituation("c07");
});
