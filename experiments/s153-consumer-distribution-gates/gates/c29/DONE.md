# c29 DONE

S5 CLI gate for `link-index` (R2-CONSUMER-JOBS-04). Pin `fa6878de125cfdcfd77f4b47037c88667090d293`. Offline.

`scripts/cli.mjs analyze link-index --in <schema JSON> --clock <ISO>` exits 0 and prints `s137.consumer-evidence.packet.v1`. Decision matches `transformLinkIndex`: positive-html/md `pass`, partial-mixed `partial`, conflict-* `conflict`, negative-* `fail`. Findings keep `citationIds`. `--all` prints `s137.consumer-evidence.family.v1` (six packets); link-index child is `pass` on positive-html. Usage exits 2 (no `--clock`, jobs 07/08). Bad `--in` and URLs exit 1. Fixtures are not auto-loaded. `--live-capture` stays offline. Real README replay is `fixture`/`fail` (unknown https, unreachable relatives); no GET.

Files: `gates/c29/PIN.json`, `helper.mjs`, `gate.test.mjs`, `DONE.md`. Reused S137 CLI, `src/link-index/{schema,transform}.mjs`, synthetic + real fixtures.

```bash
node --test experiments/s153-consumer-distribution-gates/gates/c29/gate.test.mjs
```

Result: 10 pass / 0 fail.
