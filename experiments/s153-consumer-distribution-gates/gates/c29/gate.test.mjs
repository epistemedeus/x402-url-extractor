import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c29 link-index S5 cli-stdout-batch", async () => {
  await runSituation("c29");
});
