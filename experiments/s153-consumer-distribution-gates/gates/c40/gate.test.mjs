import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c40 replay-pack S8 distributable-archive", async () => {
  await runSituation("c40");
});
