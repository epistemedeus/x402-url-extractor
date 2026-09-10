import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c08 migration-checklist S8 distributable-archive", async () => {
  await runSituation("c08");
});
