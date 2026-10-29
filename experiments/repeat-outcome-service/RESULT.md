# RESULT

H64003 built a source-only maintained check for the merchant's existing `axios@1.19.0` pin. The direct OSV query captured on 2026-10-29T14:24:45 GMT marks that pin inside 12 npm ranges whose recorded fix is 1.20.0. A same-session query for axios 1.20.0 returned `{}`. The captured GitHub page for GHSA-3pq3-5fj3-cg6v agrees with that one range when the existing reader is given the markdown budget, and the default 1,200 character excerpt drops the range. The page does not carry the other eleven advisories.

Cycles proved: initial delivery (`affected`, 12 ids), no-change (`noChangeProven`), change of the fixed version (decision stays affected), record-only change while the page monitor proves no change, semantic failure when an authored page says the pin is not affected, and recovery when a 503 page says the same thing. The failed page does not clear the pin. There is no product win.

Do not productize an advisory reader from this prototype. For the pinned axios 1.19.0 decision, the OSV query document is a sufficient direct feed: it marks the pin inside 12 npm ranges fixed at 1.20.0, and the same API's axios 1.20.0 query on 2026-10-29 returned no vulnerabilities. The existing reader is useful as a contradiction and continuity check on one human page, not as the release decision. Root should keep this package as laboratory evidence and make any dependency-pin change outside this branch.

No price, charge, ledger write, network call at runtime, merge, or deploy.

Host limit: six independent native source streams are not reserved on this host. Source reading ran serially in this parent. No additional native children were spawned.

Requested model: grok-4.7. Requested effort: xhigh. Observed model: grok-4.7, the model this session identifies. Observed effort: xhigh, the effort named at admission. These are separate records of the same admission values. This parent had no provider usage meter, so no token or quota figure is stated. Session `39d35140-e9b4-49a0-866a-e83d07812133`. Command: `node --test experiments/repeat-outcome-service/test/outcome.test.mjs`.
