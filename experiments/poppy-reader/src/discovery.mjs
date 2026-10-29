import {
  DEFAULT_ISSUER,
  DEFAULT_ORGANIZATION,
  DEFAULT_ORIGIN,
  EXCLUDED_TASKS_PATH,
  OPENAPI_PATH,
  PROTOCOL_VERSION,
  TRIAL_OPERATION_ID,
  TRIAL_READ_PATH,
  assertHttpsOrigin,
} from "./constants.mjs";

export function buildDiscoveryDocuments({
  origin = DEFAULT_ORIGIN,
  issuer = DEFAULT_ISSUER,
  organizationName = DEFAULT_ORGANIZATION,
} = {}) {
  const canonical = assertHttpsOrigin(origin, "origin");
  const issuerOrigin = assertHttpsOrigin(issuer, "issuer");
  if (typeof organizationName !== "string" || organizationName.length === 0) {
    throw new Error("organization name is required");
  }
  const domain = new URL(canonical).hostname;
  const openapiUrl = new URL(OPENAPI_PATH, canonical).href;
  const excludedUrl = new URL(EXCLUDED_TASKS_PATH, canonical).href;
  const poppy = {
    protocol_version: PROTOCOL_VERSION,
    organization: { name: organizationName, domain },
    auth: { issuer: issuerOrigin },
    apis: [
      {
        type: "openapi",
        url: openapiUrl,
        description: "Optional source-only adapter for the existing walletless trial read. Direct merchant POST /trial/read and MCP trial_read stay the supported routes. This document is not a public Poppy support claim.",
      },
    ],
    excluded_tasks: { url: excludedUrl },
  };
  const protectedResource = {
    resource: canonical,
    authorization_servers: [issuerOrigin],
  };
  const excludedTasks = {
    tasks: [
      {
        task: "Paid markdown read of a caller-selected public URL. A Poppy session does not authorize payment, change the target, or return paid output.",
        alternative: {
          instructions: "Use the free walletless trial read. The merchant POST /trial/read and MCP trial_read perform that same read on the direct routes.",
          references: [
            { type: "openapi", url: openapiUrl, operation_id: TRIAL_OPERATION_ID },
          ],
        },
      },
    ],
  };
  const openapi = {
    openapi: "3.0.3",
    info: {
      title: "Reader lab trial read",
      version: "0.0.0-source-only",
      description: "One existing walletless reader operation behind a draft 0.3 session header. No sign-in and no payment settlement are offered here.",
    },
    servers: [{ url: canonical }],
    paths: {
      [TRIAL_READ_PATH]: {
        post: {
          operationId: TRIAL_OPERATION_ID,
          summary: "Read one public HTTP or HTTPS URL as bounded Markdown through the existing walletless trial.",
          parameters: [
            {
              name: "Poppy-Session",
              in: "header",
              required: true,
              schema: { type: "string" },
              description: "Draft 0.3 Poppy-Session header. A valid session does not authorize a paid read or a different target.",
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["url"],
                  properties: {
                    url: { type: "string", minLength: 1, maxLength: 2048 },
                    markdownLimitChars: { type: "integer", minimum: 1, maximum: 40000 },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Existing readMarkdown JSON, including source failure bodies. Success bodies have no charged field and no payment receipt." },
            "400": { description: "invalid_session, or invalid_trial_input / invalid_trial_body from the existing trial wrapper." },
            "405": { description: "method_not_allowed. Allow: POST." },
            "413": { description: "invalid_trial_body when the JSON body exceeds 4096 bytes." },
            "503": { description: "trial_unavailable from the shared trial budget." },
          },
        },
      },
    },
  };
  return { poppy, protectedResource, excludedTasks, openapi };
}
