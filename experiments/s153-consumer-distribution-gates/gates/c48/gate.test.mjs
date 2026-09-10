import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c48 freshness-receipt S8 distributable-archive", async () => {
  await runSituation("c48");
});
