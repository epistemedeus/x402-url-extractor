# c46 DONE

S6 import-roundtrip for R2-CONSUMER-JOBS-06 dataset freshness receipt. Programmatic import of S137 `src/freshness-receipt/{transform,schema}.mjs` (not CLI). JSON roundtrip of packet fields keeps `s137.freshness-receipt.v1` / `s137.consumer-evidence.packet.v1`, jobId, clock, evidenceClass, findings+citationIds, and distinct download vs source-update slots. Primary fixture `positive-complete` (sha256 `46e928cd0d3b8f897c2dfc79c632677d236ff8686f0c59c2d8ecddda89d9b4be`) decides **pass**. Partial stays partial (source-update absent, not filled from retrieval). Conflict stays conflict (`source_update_after_download`; no silent merge). Missing times stay **unknown**, not invented pass. Real NYC 311 input (fixture) also roundtrips as **pass**. Offline; payment.attempted false; claims.inventsFacts false. Jobs 07/08 untouched.

`node --test experiments/s153-consumer-distribution-gates/gates/c46/gate.test.mjs` → **7 pass, 0 fail**.

Files: `gates/c46/PIN.json`, `gates/c46/helper.mjs`, `gates/c46/gate.test.mjs`, `gates/c46/DONE.md`. Reused S137 transform/schema and synthetic/real freshness fixtures; did not rewrite S137 cells.
