# samedaydesk-capability-compat-consumer

Cold consumer fixture. Its `package.json` depends on two packed tarballs:

- `file:../samedaydesk-capability-compat/samedaydesk-capability-compat-0.1.0.tgz`
- `file:../samedaydesk-interop-corpus/samedaydesk-interop-corpus-0.1.0.tgz`

Run `npm pack` in both pack directories before `npm install` here. This
package does not import merchant source.

`consumer.mjs` talks only to the installed packs, given an MCP endpoint.

- `useFreeCompare`, `usePinProbe`, `useRecoveredCompare`: the normal free
  page-change journey.
- `replayCorpus(endpoint)`: loads every interop corpus case and replays it
  against the changed implementation (capability pack at c060afcd), next to the
  recorded earlier negative. Output schema
  `samedaydesk.capability-compat-consumer.corpus-replay.v1`, scope
  `baseline-relative`.
- `observeUnknownToolPairs`, `observeEraPin`, `observeTasksDeclared`: the
  residuals R-01, R-02, R-03 that the official conformance runner does not
  cover on this profile.

`test-only/start-loopback-page-change.mjs` is a test-only harness. It may
start `mountPageChangeMcp` from a merchant checkout of
`e90676f48da875c5e0f475f57f7774de947b75a7`. It is not part of the consumer
runtime and is not a live merchant change. `test-only/serve-loopback.mjs`
keeps that harness up for the official runner during a VM run.
