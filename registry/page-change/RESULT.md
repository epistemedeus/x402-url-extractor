# Page-change Registry descriptor

Free-only publisher input for the already hosted `POST /mcp/page-change` profile. This file does not publish, log in, or call a tool. Root owns Registry JWT renewal, publication, readback, and any live initialize.

## Decision

Do not add `https://agents.samedaydesk.com/mcp/page-change` to `io.github.epistemedeus/x402-data-gateway`. Schema `2025-12-11` gives one server one name, description, and version. `remotes` has no per-remote tool list and no `maxItems`. Official guidance uses multiple remotes for alternate transports, package-or-remote installation choice, or tenant URL templates of that same server. A client may select any remote. The paid remote exposes the separate 30-tool runtime catalog. This profile exposes only `compare_page_observations`. Those are different servers.

Use the existing GitHub namespace `io.github.epistemedeus` and the name `page-change`. Descriptor version `1.0.0` is this record's first publication version. It is not a merchant runtime bump. `page-change-mcp.mjs` still passes `SERVICE_VERSION` (`1.23.55` at this base) to MCP initialize.

## Comparison

| | Paid listing, unchanged | This descriptor |
| --- | --- | --- |
| Name | `io.github.epistemedeus/x402-data-gateway` | `io.github.epistemedeus/page-change` |
| Version | `1.23.55`, same as `package.json` | `1.0.0` registry descriptor |
| Remote | `https://agents.samedaydesk.com/mcp` | `https://agents.samedaydesk.com/mcp/page-change` |
| Transport | `streamable-http` | `streamable-http` |
| Tools | Not a Registry field. Runtime catalog is separate. | Not a Registry field. Runtime tool is `compare_page_observations` only. |
| File | `/server.json` sha256 `1e3da1f5dc833cf84a8f8a5415efc5c48be69d22505739003d621418bd1f017c` | `registry/page-change/server.json` |

## Source

- Product base: `96b2dddf62292030a77c50032764e45faddb6450`
- Branch: `codex/h97610-existing-free-profile-registry-20261031`
- Parent of this package: that base. Publish from this branch head, not from the parent. The commit SHA is the branch head after push; it cannot be stored inside itself.
- Schema: `https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`
- Schema sha256: `3fba09590c99f61735d234822279f4223fab9e300c0a81e81c91ab62a4114de0` (22090 bytes)
- Remotes: [Publishing Remote Servers](https://modelcontextprotocol.io/registry/remote-servers)
- Same-server examples: [generic server.json](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/server-json/generic-server-json.md)
- Namespace: [official requirements](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/server-json/official-registry-requirements.md), [GitHub auth](https://modelcontextprotocol.io/registry/authentication)
- Version: [versioning](https://modelcontextprotocol.io/registry/versioning). `1.0.0` is not `Implementation.version`.
- Publish path argument: [CLI commands](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/cli/commands.md). `--registry` on `publish` is taken as a file path.
- Readback: `GET /v0.1/servers/{url-encoded-name}/versions/{version}` in [openapi.yaml](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/api/openapi.yaml). Official meta is `_meta["io.modelcontextprotocol.registry/official"]` (`status`, `isLatest`).

## Files

- `registry/page-change/server.json`
- `registry/page-change/server.schema.json`
- `registry/page-change/check.mjs`
- `registry/page-change/descriptor.test.mjs`
- `registry/page-change/RESULT.md`
- `package.json` script `test:page-change-registry` only

Unchanged: root `server.json`, package lock, prices, SDK and payment code, human assets, paid runtime version.

## Checks

```sh
node --test --test-concurrency=1 registry/page-change/descriptor.test.mjs
node registry/page-change/check.mjs
```

Both exited 0 on this branch before commit. The checker prints `ok name=io.github.epistemedeus/page-change descriptor=1.0.0 runtime=1.23.55 remote=https://agents.samedaydesk.com/mcp/page-change tool=compare_page_observations`. It refuses a paid-plus-free remote pair, a non-HTTPS URL, SSE, headers, packages, another namespace, a payment claim, and a descriptor version equal to the runtime. No Registry GET and no tool call.

`npm run test:page-change-registry` is the same node test. Full `npm test` was not run.

## Root publication

Use the existing `epistemedeus` GitHub publisher. Do not create an account, and do not use the domain login. From a checkout of this branch head:

```sh
node tools/ops/mcp-registry-login-via-gh.mjs
mcp-publisher validate registry/page-change/server.json
mcp-publisher publish registry/page-change/server.json
```

Do not run bare `mcp-publisher publish` in the repository root. That default path is the paid `/server.json`.

Readback, still without calling a tool:

```sh
curl -fsS "https://registry.modelcontextprotocol.io/v0.1/servers/io.github.epistemedeus%2Fpage-change/versions/1.0.0"
curl -fsS "https://registry.modelcontextprotocol.io/v0.1/servers/io.github.epistemedeus%2Fpage-change/versions/latest"
curl -fsS "https://registry.modelcontextprotocol.io/v0.1/servers/io.github.epistemedeus%2Fx402-data-gateway/versions/latest"
```

Require the new `server` object to match this descriptor, `status` `active`, and `isLatest` true. Require the paid latest row to stay `1.23.55` with only `https://agents.samedaydesk.com/mcp`. Then initialize and `tools/list` on the free URL only: one tool, `compare_page_observations`, and initialize version still the deployed runtime version. Do not execute the tool. Do not treat a 30-tool count as a Registry field.

## Next

Root publishes this file and reads both rows back. No further descriptor work is required unless that readback disagrees.

## Root receiving amendment

JSON member order is not semantic. Separate descriptor/runtime identities may
have equal numeric versions. Paid metadata may evolve without a frozen source
hash, while its name, remote and current runtime/lock binding remain checked.
The original paid descriptor and runtime bytes are unchanged in this release.
Focused descriptor and service-version tests pass remotely after these changes.
The scoped source checker is not a replacement for official Registry validation.
