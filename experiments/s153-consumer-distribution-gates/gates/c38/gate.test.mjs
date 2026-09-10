import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c38 replay-pack S6 import-roundtrip", async () => {
  await runSituation("c38");
});
