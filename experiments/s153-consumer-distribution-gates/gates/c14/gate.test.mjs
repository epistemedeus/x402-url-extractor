import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c14 release-brief S6 import-roundtrip", async () => {
  await runSituation("c14");
});
