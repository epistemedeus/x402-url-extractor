# syntax=docker/dockerfile:1
FROM --platform=linux/amd64 node:22.14.0-bookworm-slim@sha256:745403dc46b5ab4c998502b07a12cbf020cf2c30645427a68ec0718f02d647de AS dependencies
ENV NODE_OPTIONS=--max-old-space-size=768
WORKDIR /opt/acp
COPY .npmrc package.json package-lock.json ./
COPY vendor/task-discoverability/ vendor/task-discoverability/
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY integrations/acp-settlement-proof/runtime/package*.json integrations/acp-settlement-proof/runtime/
RUN npm ci --prefix integrations/acp-settlement-proof/runtime --omit=dev --ignore-scripts --no-audit --no-fund
COPY integrations/acp-settlement-proof/managed/reader-closure.mjs integrations/acp-settlement-proof/managed/reader-closure.mjs
RUN node integrations/acp-settlement-proof/managed/reader-closure.mjs /opt/reader

FROM --platform=linux/amd64 node:22.14.0-bookworm-slim@sha256:745403dc46b5ab4c998502b07a12cbf020cf2c30645427a68ec0718f02d647de
RUN apt-get update && apt-get install -y --no-install-recommends tini util-linux ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/acp
COPY --from=dependencies /opt/reader/node_modules/ node_modules/
COPY --from=dependencies /opt/acp/integrations/acp-settlement-proof/runtime/node_modules/ integrations/acp-settlement-proof/runtime/node_modules/
COPY --chmod=0555 . .
ENV ACP_REQUIRE_SOURCE_IDENTITY=1 ACP_DATA_DIR=/var/lib/acp-worker NODE_OPTIONS=--max-old-space-size=768
# Bootstrap changes only a fresh empty mount, then drops permanently to image node:1000.
ENTRYPOINT ["/usr/bin/tini", "-s", "--", "node", "/opt/acp/integrations/acp-settlement-proof/managed/entry.mjs"]
CMD ["receive"]
