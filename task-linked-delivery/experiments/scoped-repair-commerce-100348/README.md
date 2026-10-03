# Scoped repair integration 100348

Node 22.22.2. A caller supplies its task, exact operation and body, expected
output or selected static concern, current terms, input bytes and allowances.
The service runs the existing seller0.4.1 or SkillGuard owners and returns one
of four states: free already sufficient, missing task input, compatible reusable
fix, or an explicitly requested new implementation scope. The last state is a
need declaration, not an implemented fix or a price.

The executable acceptance checks independently observed work. A signed
acceptance additionally requires the existing payment-policy plan and execution
authorization, a trusted caller key and an unchanged current merchant offer.
The sole quote adapter is the existing $0.01 seller integrity audit, for its
existing scope. This package executes no payment and has no implementation SKU.
Missing input, an assessment error and a 402 never grant payment authority.

With a Root-configured isolated store, the same request ID and bytes return the
historical packet after a lost reply or restart. Changing that request requires
a new ID. `reuse` runs current bytes again; it reads existing enrolled retention
only when its owner provides the current record. Sharing, payment and useful
outcome never inherit from a previous success. The inherited store supports one
configured writer, a bounded rotation window and local readback; it promises
neither multi-process durability nor indefinite recovery.

The standalone client needs no npm install, repository, environment credential
or private authority source. Extract the licensed candidate archive and run:

```sh
node bin/scoped-repair.mjs deliver --service https://RECEIVED-HOST --request caller.json
node bin/scoped-repair.mjs deliver --service https://RECEIVED-HOST --request - < caller.json
node bin/scoped-repair.mjs check --packet delivery.json
node bin/scoped-repair.mjs reuse --service https://RECEIVED-HOST --request later.json
```

`later.json` is `{ "packetId": "sha256:...", "request": <current caller request> }`.
`accept` and `review` similarly take explicit command bodies. `check` verifies
integrity and evaluates the supplied predicate; it cannot prove a remote
execution or a signer identity. No task or service is defaulted. HTTP is allowed
only on explicit 127.0.0.1 loopback ports for disposable QA; production requires
public HTTPS. No redirects or runtime downloads are allowed.

Request schema and bindings are in `src/contracts.mjs`; actual working request
builders live in repository-only `test/support.mjs`. The client deliberately
ships no successful example as a default. All intake, file/stdin/transport reads,
child work and output share a deadline (maximum five seconds), cumulative read
allowance (2 MiB), caller input allowance (512 KiB), output allowance (16 KiB)
and child allowance (eight). Callers may lower these limits.
The client reserves a service read allowance, response reads, and three fifths
of output for the service and two fifths for local reply output before sending.
The service also checks that the wire reply fits the local reservation. SDK
regression artifacts stay inside isolated storage; their digest binds the packet.
The propagated deadline begins
before file/stdin intake. A reservation is an upper bound, not measured spending.
Current client 0.1.2 is in `export/candidates/0.1.2`; sealed 0.1.0 and 0.1.1
remain in `export/public` and `export/current` respectively.

Root applies the focused mount/classifier/exporter patch and supplies optional
providers as described in `route/ROOT-INTEGRATION.md`. Current publication,
source acceptance, outside usefulness and settled payment remain separate,
unverified facts. No homepage, localized page, human copy or price was changed.
