// Optional read-only projection. AIAX schema attribution is in IMPLEMENTATION.md.
// Source revision time, not a request/restart clock. ETag covers configuration.
export const AIAX_UPDATED_AT = "2026-10-25T10:00:00Z";
export const AIAX_MANIFEST_PATHS = ["/.well-known/aiax.json", "/aiax/manifest.json"];
export const AIAX_SECTION_PATH = "/aiax/sections/extract.json";
export const AIAX_MAX_BYTES = Object.freeze({ manifest: 1200, section: 8192 });

export function buildAiaxDiscovery({ publicUrl, resource, request, output, amount, operationId, mcpToolName, captureLimits, extractionTrialDiscovery = null }) {
  const origin = new URL(publicUrl).origin;
  const target = new URL(resource.url);
  const method = request?.example?.method;
  const query = request?.schema?.properties?.queryParams;
  if (target.protocol !== "https:" || target.username || target.password || target.hash || target.search
      || target.origin !== origin || target.pathname !== "/extract" || method !== "GET"
      || !query?.required?.includes("url") || !output?.schema || !output?.example
      || typeof amount !== "string" || !/^[0-9]+(\.[0-9]+)?$/.test(amount)) {
    throw new Error("Unsupported AIAX extraction contract");
  }
  for (const [key, value] of Object.entries(request.example.queryParams)) {
    target.searchParams.set(key, String(value));
  }
  const section = {
    aiax_version: "0.1",
    section_id: "extract",
    purpose: resource.description,
    inputs: structuredClone(query),
    outputs: structuredClone(output.schema),
    pricing: { model: "per_call", amount, currency: "USDC", rail: "x402" },
    examples: [{
      description: "Illustrative request and response shape, not an observed capture. Obtain the unsigned 402 offer before authorizing payment.",
      request: { method, url: target.href },
      response: structuredClone(output.example),
    }],
    pact_mandate_template: null,
    mcp_tool_name: mcpToolName,
    openapi_operation_id: operationId,
    extensions: { samedaydesk: {
      method,
      path: target.pathname,
      capture_limits: structuredClone(captureLimits),
      ...(extractionTrialDiscovery ? { extraction_trial_discovery: extractionTrialDiscovery } : {}),
      guidance: "Inspect sourceOk, status, error and capture for source failures and truncation. The text is an excerpt, not the full page. Runtime payment offers remain authoritative.",
    } },
  };
  const manifest = {
    aiax_version: "0.1",
    product: {
      name: "SameDayDesk URL extraction",
      one_line_purpose: "Extract public web pages into bounded structured JSON without JavaScript.",
      domain: "web-data-extraction",
    },
    entry_points: [{ id: section.section_id, url: AIAX_SECTION_PATH, purpose: "Public URL to structured JSON; required input, capture limits and request example.", est_tokens: 2000 }],
    pricing_summary: `${amount} USDC per extraction; discovery is free.`,
    trust_signals: {},
    mcp_endpoint: `${origin}/mcp`,
    updated_at: AIAX_UPDATED_AT,
    openapi_url: `${origin}/openapi.json`,
    llms_txt_url: `${origin}/llms.txt`,
    ...(extractionTrialDiscovery ? { extensions: { samedaydesk: { extraction_trial_discovery: extractionTrialDiscovery } } } : {}),
  };
  const documents = { manifest: JSON.stringify(manifest), section: JSON.stringify(section) };
  for (const [kind, bytes] of Object.entries(documents)) {
    if (Buffer.byteLength(bytes) > AIAX_MAX_BYTES[kind]) throw new Error(`AIAX ${kind} exceeds byte limit`);
  }
  return documents;
}

export function mountAiaxDiscovery(app, contract) {
  const documents = buildAiaxDiscovery(contract);
  const serve = (body) => (_req, res) => {
    res.set("Cache-Control", "public, max-age=300");
    return res.type("application/json").send(body);
  };
  app.get(AIAX_MANIFEST_PATHS, serve(documents.manifest));
  app.get(AIAX_SECTION_PATH, serve(documents.section));
  app.all([...AIAX_MANIFEST_PATHS, AIAX_SECTION_PATH], (_req, res) => {
    res.set("Allow", "GET, HEAD");
    res.set("Cache-Control", "no-store");
    return res.status(405).json({ error: "method_not_allowed" });
  });
  app.use("/aiax/sections", (_req, res) => {
    res.set("Cache-Control", "no-store");
    return res.status(404).json({ error: "aiax_section_not_found" });
  });
  return documents;
}
