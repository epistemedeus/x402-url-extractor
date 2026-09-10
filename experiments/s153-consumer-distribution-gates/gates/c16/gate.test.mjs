import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c16 release-brief S8 distributable-archive", async () => {
  await runSituation("c16");
});
