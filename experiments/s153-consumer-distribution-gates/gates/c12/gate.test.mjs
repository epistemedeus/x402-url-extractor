import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c12 release-brief S4 malformed-input", async () => {
  await runSituation("c12");
});
