import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c44 freshness-receipt S4 malformed-input", async () => {
  await runSituation("c44");
});
