# Useful-service observation

Optional extension of the existing caller-result handback for an already serving paid API. It does not replace `/commerce/caller-result-feedback`, and it does not write the canonical commerce journals except by calling that service.

A schema-valid HTTP response, a caller declaration of usefulness or retained use, and an observed distinct later-task purchase or free entitled retrieval stay separate. A missing response stays `unknown`. Pseudonym continuity is not an independent repeat. Full-window coverage stays unknown. No outside useful answer is claimed.

```sh
node --test --test-concurrency=1 experiments/ae14-useful-service-observation/test/*.test.mjs
node experiments/ae14-useful-service-observation/bin/cold-replay.mjs <data-dir>
node experiments/ae14-useful-service-observation/bin/export-candidate.mjs
```

The shared-serving mount in `route/ROOT-SERVER-MOUNT.patch` is not applied. Existing serving owner and Root receive it.
