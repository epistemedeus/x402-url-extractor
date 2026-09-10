import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c02 migration-checklist S2 partial-prereq", async () => {
  await runSituation("c02");
});
