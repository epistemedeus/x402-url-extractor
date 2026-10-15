# Useful-service observation

Optional extension of the existing caller-result handback for an already serving paid API. It does not replace `/commerce/caller-result-feedback`, and it does not write the canonical commerce journals except by calling that service.

A schema-valid HTTP response, a caller declaration of usefulness or retained use, and an observed distinct later-task purchase or free entitled retrieval stay separate. A missing response stays `unknown`. A repeat purchase counts only when later start is strictly after prior finish and the settlement effects are distinct. Pseudonym continuity is not an independent repeat. Full-window coverage stays unknown. Absence of an outside useful answer stays `unknown`.

```sh
node --test --test-concurrency=1 experiments/ae14-useful-service-observation/test/*.test.mjs
node experiments/ae14-useful-service-observation/bin/cold-replay.mjs <data-dir>
node experiments/ae14-useful-service-observation/bin/export-candidate.mjs
```

The shared-serving mount in `route/ROOT-SERVER-MOUNT.patch` is applied on this branch only. It is not deployed. Existing serving owner and Root receive any production mount.
