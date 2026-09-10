import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c32 link-index S8 distributable-archive", async () => {
  await runSituation("c32");
});
