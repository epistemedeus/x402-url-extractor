import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c28 link-index S4 malformed-input", async () => {
  await runSituation("c28");
});
