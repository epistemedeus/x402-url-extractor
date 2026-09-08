/**
 * Shared unpaid MCP discovery checks for extract + extract_batch.
 * Follow the returned inventory; do not require an exact global tool count.
 */

const FIELD_ENUM = Object.freeze([
  "title",
  "description",
  "canonical",
  "lang",
  "openGraph",
  "twitter",
  "jsonLd",
  "headings",
  "links",
  "text",
  "aiReadiness",
]);

export const EXTRACT_BATCH_FIELD_ENUM = FIELD_ENUM;

export function findTool(tools, name) {
  if (!Array.isArray(tools)) return null;
  return tools.find((tool) => tool && tool.name === name) || null;
}

function inputSchema(tool) {
  return tool?.inputSchema || tool?.input_schema || null;
}

function assertUrlsSchema(urls, label) {
  if (!urls || typeof urls !== "object") {
    throw new Error(`${label}: urls property missing`);
  }
  if (urls.type !== "array") throw new Error(`${label}: urls must be array`);
  if (urls.minItems !== 1) throw new Error(`${label}: urls.minItems must be 1`);
  if (urls.maxItems !== 5) throw new Error(`${label}: urls.maxItems must be 5`);
}

function assertFieldsSchema(fields, label) {
  if (!fields || typeof fields !== "object") {
    throw new Error(`${label}: fields property missing`);
  }
  if (fields.type !== "array") throw new Error(`${label}: fields must be array`);
  const items = fields.items || {};
  const enumerated = Array.isArray(items.enum) ? items.enum : [];
  for (const name of FIELD_ENUM) {
    if (!enumerated.includes(name)) {
      throw new Error(`${label}: fields enum missing ${name}`);
    }
  }
}

/**
 * Validate tools/list inventory for extract + extract_batch schemas.
 * Extra unrelated tools are accepted. Missing or invalid extract_batch fails.
 */
export function assertExtractDiscoveryInventory(tools, { requireBatch = true } = {}) {
  if (!Array.isArray(tools)) throw new Error("tools/list must return an array");
  const extract = findTool(tools, "extract");
  if (!extract) throw new Error("tools/list missing extract");
  const extractInput = inputSchema(extract);
  if (!extractInput?.properties?.url) {
    throw new Error("extract inputSchema must declare url");
  }
  const required = Array.isArray(extractInput.required) ? extractInput.required : [];
  if (!required.includes("url")) {
    throw new Error("extract inputSchema must require url");
  }

  const batch = findTool(tools, "extract_batch");
  if (!requireBatch) {
    return { extract, batch, names: tools.map((tool) => tool.name) };
  }
  if (!batch) throw new Error("tools/list missing extract_batch");
  const batchInput = inputSchema(batch);
  if (!batchInput || batchInput.type !== "object") {
    throw new Error("extract_batch inputSchema must be an object");
  }
  if (batchInput.additionalProperties !== false) {
    throw new Error("extract_batch inputSchema must set additionalProperties false");
  }
  assertUrlsSchema(batchInput.properties?.urls, "extract_batch");
  assertFieldsSchema(batchInput.properties?.fields, "extract_batch");
  const batchRequired = Array.isArray(batchInput.required) ? batchInput.required : [];
  if (!batchRequired.includes("urls")) {
    throw new Error("extract_batch inputSchema must require urls");
  }
  const output = batch.outputSchema || batch.output_schema;
  if (!output || output.type !== "object") {
    throw new Error("extract_batch outputSchema must be an object");
  }
  const outRequired = Array.isArray(output.required) ? output.required : [];
  for (const key of ["ok", "product", "partial", "sources", "charged", "boundary"]) {
    if (!outRequired.includes(key)) {
      throw new Error(`extract_batch outputSchema missing required ${key}`);
    }
  }
  return {
    extract,
    batch,
    names: tools.map((tool) => tool.name),
  };
}

/**
 * Construct the canonical unpaid POST /extract/batch JSON body from a caller list.
 * No wallet, credentials, or payment headers.
 */
export function constructExtractBatchBody({ urls, fields }) {
  if (!Array.isArray(urls) || urls.length < 1 || urls.length > 5) {
    const err = new Error("batch requires 1-5 public HTTPS URLs");
    err.code = "url_count";
    throw err;
  }
  for (const url of urls) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      const err = new Error(`invalid URL: ${url}`);
      err.code = "invalid_url";
      throw err;
    }
    if (parsed.protocol !== "https:") {
      const err = new Error(`URL must be https: ${url}`);
      err.code = "not_https";
      throw err;
    }
  }
  if (!Array.isArray(fields) || fields.length < 1) {
    const err = new Error("batch requires explicit desired fields");
    err.code = "fields_required";
    throw err;
  }
  const unique = [...new Set(fields)];
  if (unique.length !== fields.length) {
    const err = new Error("fields must be unique");
    err.code = "fields_unique";
    throw err;
  }
  for (const field of unique) {
    if (!FIELD_ENUM.includes(field)) {
      const err = new Error(`unsupported field: ${field}`);
      err.code = "field_enum";
      throw err;
    }
  }
  return { urls: [...urls], fields: unique };
}

/**
 * Skill-facing route selection for constructible requests (no payment).
 * Returns { route, method, url, body } or { reject, reason }.
 */
export function selectExtractRoute({ urls, fields, batchSupported = true }) {
  const list = Array.isArray(urls) ? urls : urls ? [urls] : [];
  if (list.length === 0) {
    return { reject: true, reason: "missing_urls" };
  }
  if (list.length > 5) {
    return { reject: true, reason: "too_many_urls_no_autosplit" };
  }
  if (list.length === 1 && (!fields || fields.length === 0 || !batchSupported)) {
    const target = list[0];
    return {
      reject: false,
      route: "extract",
      method: "GET",
      url: `https://agents.samedaydesk.com/extract?url=${encodeURIComponent(target)}`,
      body: null,
      mcpTool: "extract",
      mcpArguments: { url: target },
    };
  }
  if (!batchSupported) {
    return { reject: true, reason: "batch_unsupported" };
  }
  if (!fields || fields.length === 0) {
    return { reject: true, reason: "fields_required_for_batch" };
  }
  try {
    const body = constructExtractBatchBody({ urls: list, fields });
    return {
      reject: false,
      route: "extract_batch",
      method: "POST",
      url: "https://agents.samedaydesk.com/extract/batch",
      body,
      mcpTool: "extract_batch",
      mcpArguments: body,
    };
  } catch (error) {
    return { reject: true, reason: error.code || "invalid_batch" };
  }
}
