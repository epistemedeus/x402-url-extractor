# S93 A final source gate

Input b408b9221de8179bde09cbc05fb566678b19235e over merchant 4910f83bd2be1e38667f1a3cfa23c70fcff6b0c1. Only the example changes; production handlers and root package wiring remain as supplied.

Fixed external replay JSON self-confirmation: only the pinned worker replay bytes retain replay confirmation. Other reports remain caller-supplied unverified evidence. Missing/failed replay summaries now follow actual confirmation. Serialized/fabricated layer-1 output cannot bypass evaluation through the exported composition helper. Layer-1 classifications still mean caller-supplied observations, not independently observed or signed provider execution. Removed the misleading local replay log pointer and corrected checkout/dependency/standalone instructions.

Actual Work Node v24.19.0: 35/35 focused tests (33 supplied + 2 regression groups); 11 documented CLI/start/compose/help/fixture executions passed. Tests imported the exact merchant evaluator and lock-pinned agent-payment-policy 0.12.0, Zod 3.25.76. Dependencies installed offline from cached tarballs with scripts disabled. Full root npm ci and Node22 were not rerun. Upstream 19/19 native harness replay is inherited S89 evidence, not a new execution here. Published result/mapping blobs match Lumen's exact 94fa65d65c204c02f4af5a9bc9fd27225c688994 tree. Mapping remains 4 covered / 1 partial / 2 gaps with six limits; no live/signed assurance or payment.

Publication gate: upstream pinned tree has no LICENSE and package.json has no license declaration. Lumen's exact comment 5611527986 invites composition; that is not a general MIT license grant. README explicitly excludes the copied third-party results/mapping from an inferred MIT relicensing. Root must resolve redistribution permission before publishing those copies. No public reply, deployment, wallet access, signing or paid call was performed.

Replay: from repository root, `npm run test:basepay-composition`; example usage is in README.md. Export commit is the pin of this receipt.
