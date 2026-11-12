# samedaydesk-capability-compat-consumer

Cold consumer fixture. Its `package.json` depends on the packed tarball at
`file:../samedaydesk-capability-compat/samedaydesk-capability-compat-0.1.0.tgz`.
Run `npm pack` in the pack directory before `npm install` here. This package
does not import merchant source.

`consumer.mjs` talks only to the installed pack, given an MCP endpoint.

`test-only/start-loopback-page-change.mjs` is a test-only harness. It may
start `mountPageChangeMcp` from a merchant checkout of
`e90676f48da875c5e0f475f57f7774de947b75a7`. It is not part of the consumer
runtime and is not a live merchant change.
