# c27 DONE

Dataset freshness receipt transform for R2-CONSUMER-JOBS-06. Builds a cited receipt from supplied evidence. Download/retrieval time and source-update time stay distinct slots. Unknowns are marked, not invented.

## Files written

- `experiments/s137-consumer-evidence-jobs/src/freshness-receipt/transform.mjs`
- `experiments/s137-consumer-evidence-jobs/cells/c27/DONE.md`

## Test command

```sh
node experiments/s137-consumer-evidence-jobs/src/freshness-receipt/transform.mjs --self-check
```

Self-check uses c26 `EXAMPLE_CASES` (positive / negative / partial / conflict). Offline. No network.

## evidenceClass

`fixture` for the cited S122/S127 example inputs. Self-check does not live-capture.

## Limitations

- Does not fetch or observe live datasets.
- Does not substitute retrieval time for source-update time, or the reverse.
- HTTP Date, filesystem mtime, npm `time.created`, and operator clock are not source-update.
- Without `horizonMs`, ages are reported and disposition stays `unknown` (not current).
- Future timestamps versus clock yield unknown ages.
- Pack synthetic/real fixtures are c28/c29; pack tests are c30.
- Not a legal attestation, paid endpoint, or customer-demand claim.
