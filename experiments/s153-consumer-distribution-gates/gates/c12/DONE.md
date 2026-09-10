# c12 DONE

S153 gate `c12` (release-brief, S4 malformed-input) on pin `fa6878de125cfdcfd77f4b47037c88667090d293`.

`buildReleaseBrief(negative-draft-only.input)` is `decision=fail` with cited `draft_not_shipped`; shipped/tested stay empty. `negative-empty.input` is `unknown`, not fail and not pass. Schema catalog negatives (`missing_clock`, `invalid_clock`, `kind_plane_mismatch`, `plane_conflation`, `draft_not_shipped`, `compound_split_required`) reject; transform never invents `pass` (unsplit GitHub JSON is repaired to announced-only `partial`). Null/array/`now`/hostile input: `ok:false`, `decision=fail`, `brief=null`.

CLI `analyze release-brief --in <draft.input>` emits JSON `decision=fail` and exits 0. Missing path and oversize: exit 1, packet `fail`. URL: exit 1. `--clock now` and jobs 07/08: exit 2. Malformed JSON text is not a crash and is not `pass`. Offline; no payment.

`node --test experiments/s153-consumer-distribution-gates/gates/c12/gate.test.mjs` — 9 pass, 0 fail.

Files: `gates/c12/PIN.json`, `gates/c12/helper.mjs`, `gates/c12/gate.test.mjs`, `gates/c12/DONE.md`. Reused S137 fixtures/src; did not rewrite implementation cells.
