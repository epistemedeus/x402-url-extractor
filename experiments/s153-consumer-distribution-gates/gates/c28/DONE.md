# c28 DONE — link-index S4 malformed-input

Pinned S137 `fa6878de125cfdcfd77f4b47037c88667090d293`. Reused `negative-malformed`, `negative-empty`, and `negative-no-links`; did not recreate S137 cells. Jobs 07/08 out of scope.

**Proven:** `transformLinkIndex` / `transform` on the malformed HTML fixture is `decision=fail` with one empty quoted href (`unreachable` / `empty_href`); unterminated `href="` and `<a>` without href are not extracted. Empty and no-links sources fail with zero invented hrefs (bare `example.invalid` prose is not a citation). Schema `validateInput` is `invalid` for `"now"`, empty `documents`, and type errors; `transform()` throws and does not invent a clock. Oversize body skips the document (`documentsUnknown=1`) and still fails, not pass.

CLI `analyze link-index --in <schema input>` of negatives exits 0 with a fail packet (stdout stable across reruns). Unreadable / oversize `--in` and `https://` exit 1; missing `--clock` and jobs 07/08 exit 2. Offline, `payment.attempted=false`, demand claims stay false.

**Files:** `PIN.json`, `helper.mjs`, `gate.test.mjs`, this DONE.md.

```bash
node --test experiments/s153-consumer-distribution-gates/gates/c28/gate.test.mjs
```

15 pass, 0 fail. evidenceClass: `synthetic`.
