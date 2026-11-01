# H99110 NEXT

Root receives branch `codex/h99110-mcp-current-client-compat-20261101`. Integration, registry publication, and deployment stay with Root.

The installed runtime remains `d795e2badf805f991c3074755061a20d0c255b00` until that release. This commit does not merge to `master` and does not deploy.

Free-profile callers on the current official client default, and on auto, already have the supported `2025-11-25` path. Callers that pin `2026-07-28` use paid `POST /mcp` for that revision. The free profile keeps its v1 contract.
