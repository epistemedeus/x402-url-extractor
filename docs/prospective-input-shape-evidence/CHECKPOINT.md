ROOT1862 source checkpoint

Frozen product and owned PR base: f31abbce319037bfe7bb98dcd859b598ef041ee5.
Operating inputs: pilot@0d3ed6d3c7333c26b98adbccd97d44de17bdafd9; receipt SHA256
8bb35fb87a2452c30994f1f95aa2c1a58b22c47eb2a98d49d216c37fcd2b3948.
All four staged member hashes verified. Native requested/admitted model is
Sol6.1 (gpt-6.1-sol), effort xhigh; original run ROOT-SOL-ROOT1862-261021.

Locked setup: `npm ci --ignore-scripts` (exit 0; audit findings retained in npm-ci.log).
Red: `node --test --test-name-pattern='prospective URL shapes' extract-batch-commerce.mounted.test.mjs`
on unchanged frozen implementation: 0/1, missing all six shape records (frozen-red.tap).
Green: identical command after correction: 1/1 (checkpoint-http.tap).
Existing refusal controls: `node --test commerce-refusal-evidence.test.mjs`: 7/7
(checkpoint-unit.tap). Full adversarial/continuity/privacy review follows.
An initial edit command used unavailable `python` and exited 127; no files changed.
Reran the same edit with `python3` successfully; this was a tool invocation failure.

The owning validator attaches bounded stage/type/count metadata to its error and
hands it to telemetry through a response-bound WeakMap. Public refusal bodies
are unchanged. Only matching actual semantic response codes can carry shapes.
Historical missing/null shapes remain unknown. No old refusal is explained.
No deployment, production-store access, real payment or outside communication.
