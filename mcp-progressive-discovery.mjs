// Host-side measurement and compatibility helpers for MCP tool discovery.
// Ordinary tools/list stays a single complete page. These helpers exist to
// measure compact catalogs and to prove why server-side pagination or a
// proprietary compact tools/list must not be enabled.

export const BYTE_DERIVED_TOKEN_METHOD = "ceil(UTF-8 bytes / 4); comparative estimate, not tokenizer billing";
export const CURSOR_PAGE_SIZE_USED_BY_NAIVE_CLIENT_REPROS = 8;

export function compactJsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
}

export function tokenEstimate(bytes) {
  if (!Number.isInteger(bytes) || bytes < 0) throw new Error("bytes must be a non-negative integer");
  return Math.ceil(bytes / 4);
}

export function measureTool(tool) {
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) throw new Error("tool must be an object");
  return {
    name: typeof tool.name === "string" ? tool.name : "",
    bytes: compactJsonBytes(tool),
    nameBytes: compactJsonBytes(tool.name ?? null),
    titleBytes: compactJsonBytes(tool.title ?? null),
    descriptionBytes: compactJsonBytes(tool.description ?? ""),
    inputSchemaBytes: compactJsonBytes(tool.inputSchema ?? null),
    outputSchemaBytes: compactJsonBytes(tool.outputSchema ?? null),
    annotationsBytes: compactJsonBytes(tool.annotations ?? null),
    metaBytes: compactJsonBytes(tool._meta ?? null),
    executionBytes: compactJsonBytes(tool.execution ?? null),
    hasTitle: typeof tool.title === "string" && tool.title.trim().length > 0,
    hasDescription: typeof tool.description === "string" && tool.description.trim().length > 0,
    hasInputSchema: Boolean(tool.inputSchema && typeof tool.inputSchema === "object"),
    hasOutputSchema: Boolean(tool.outputSchema && typeof tool.outputSchema === "object"),
    paymentRequired: tool?._meta?.x402?.paymentRequired === true,
    amountAtomic: tool?._meta?.x402?.accepts?.[0]?.amount ?? null,
    network: tool?._meta?.x402?.accepts?.[0]?.network ?? null,
    payTo: tool?._meta?.x402?.accepts?.[0]?.payTo ?? null,
  };
}

export function measureToolsList(result, { wireBytes = null } = {}) {
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("tools/list result must be an object");
  const tools = Array.isArray(result.tools) ? result.tools : [];
  const measured = tools.map(measureTool);
  const resultBytes = compactJsonBytes(result);
  const compact = { tools: compactCatalog(tools, "name_title_description") };
  const namesOnly = { tools: compactCatalog(tools, "name") };
  const firstPage = paginateToolsList(tools, { pageSize: CURSOR_PAGE_SIZE_USED_BY_NAIVE_CLIENT_REPROS });
  return {
    toolCount: tools.length,
    names: measured.map((tool) => tool.name),
    nextCursor: result.nextCursor ?? null,
    complete: result.nextCursor == null,
    resultBytes,
    wireBytes: Number.isInteger(wireBytes) ? wireBytes : resultBytes,
    resultTokenEstimate: tokenEstimate(resultBytes),
    wireTokenEstimate: tokenEstimate(Number.isInteger(wireBytes) ? wireBytes : resultBytes),
    tokenEstimateMethod: BYTE_DERIVED_TOKEN_METHOD,
    fieldBytes: {
      names: measured.reduce((sum, tool) => sum + tool.nameBytes, 0),
      titles: measured.reduce((sum, tool) => sum + tool.titleBytes, 0),
      descriptions: measured.reduce((sum, tool) => sum + tool.descriptionBytes, 0),
      inputSchemas: measured.reduce((sum, tool) => sum + tool.inputSchemaBytes, 0),
      outputSchemas: measured.reduce((sum, tool) => sum + tool.outputSchemaBytes, 0),
      annotations: measured.reduce((sum, tool) => sum + tool.annotationsBytes, 0),
      meta: measured.reduce((sum, tool) => sum + tool.metaBytes, 0),
      execution: measured.reduce((sum, tool) => sum + tool.executionBytes, 0),
    },
    paymentRequiredCount: measured.filter((tool) => tool.paymentRequired).length,
    missingInputSchemaCount: measured.filter((tool) => !tool.hasInputSchema).length,
    compactCatalogBytes: compactJsonBytes(compact),
    compactCatalogTokenEstimate: tokenEstimate(compactJsonBytes(compact)),
    nameOnlyCatalogBytes: compactJsonBytes(namesOnly),
    naiveFirstPageBytes: compactJsonBytes(firstPage),
    naiveFirstPageToolCount: firstPage.tools.length,
    toolsHiddenFromNaivePagination: Math.max(0, tools.length - firstPage.tools.length),
    heaviestTools: [...measured].sort((left, right) => right.bytes - left.bytes || left.name.localeCompare(right.name)).slice(0, 8),
  };
}

export function compactCatalog(tools, detail = "name_title_description") {
  if (!Array.isArray(tools)) throw new Error("tools must be an array");
  if (detail === "name") return tools.map((tool) => ({ name: tool.name }));
  if (detail === "name_description") {
    return tools.map((tool) => ({ name: tool.name, description: tool.description }));
  }
  if (detail === "name_title_description") {
    return tools.map((tool) => ({
      name: tool.name,
      ...(tool.title ? { title: tool.title } : {}),
      ...(tool.description ? { description: tool.description } : {}),
    }));
  }
  throw new Error("unsupported compact catalog detail");
}

function encodeCursor(offset) {
  return Buffer.from(JSON.stringify({ o: offset }), "utf8").toString("base64url");
}

function decodeCursor(cursor) {
  if (typeof cursor !== "string" || cursor.length === 0) throw invalidCursor();
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw invalidCursor();
  }
  if (!parsed || typeof parsed !== "object" || !Number.isInteger(parsed.o) || parsed.o < 0) throw invalidCursor();
  return parsed.o;
}

function invalidCursor() {
  const error = new Error("Invalid params: cursor");
  error.code = -32602;
  return error;
}

export function paginateToolsList(tools, { pageSize = CURSOR_PAGE_SIZE_USED_BY_NAIVE_CLIENT_REPROS, cursor } = {}) {
  if (!Array.isArray(tools)) throw new Error("tools must be an array");
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error("pageSize must be a positive integer");
  const offset = cursor == null || cursor === "" ? 0 : decodeCursor(cursor);
  if (offset > tools.length) throw invalidCursor();
  const page = tools.slice(offset, offset + pageSize);
  const nextOffset = offset + page.length;
  const result = { tools: page };
  if (nextOffset < tools.length) result.nextCursor = encodeCursor(nextOffset);
  return result;
}

export function naiveClientCollect(firstPage) {
  if (!firstPage || !Array.isArray(firstPage.tools)) throw new Error("tools/list page is missing tools");
  return firstPage.tools;
}

export function specClientCollect(tools, { pageSize = CURSOR_PAGE_SIZE_USED_BY_NAIVE_CLIENT_REPROS } = {}) {
  const collected = [];
  let cursor;
  do {
    const page = paginateToolsList(tools, { pageSize, cursor });
    collected.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);
  return collected;
}

export function evaluateServerSideDiscoveryChange({
  totalToolCount,
  naiveClientToolCount,
  compactPassesToolSchema,
  specHasMinimalToolsListFlag = false,
  officialSdkClientFollowsCursor = false,
  currentClientsFollowCursor = false,
} = {}) {
  const reasons = [];
  const hidden = Math.max(0, Number(totalToolCount || 0) - Number(naiveClientToolCount || 0));
  if (!currentClientsFollowCursor && hidden > 0) {
    reasons.push(`Enabling tools/list pagination would hide ${hidden} of ${totalToolCount} tools from single-page clients.`);
  }
  if (!officialSdkClientFollowsCursor && hidden > 0) {
    reasons.push("The official TypeScript SDK Client.listTools issues one tools/list request and does not follow nextCursor.");
  }
  if (!compactPassesToolSchema) {
    reasons.push("A compact catalog that omits inputSchema is not a valid MCP tools/list result.");
  }
  if (!specHasMinimalToolsListFlag) {
    reasons.push("MCP ListToolsRequest still has only an optional cursor; it has no compact or minimal schema flag.");
  }
  return {
    verdict: reasons.length ? "no-go" : "go",
    reasons,
    hiddenToolCount: hidden,
    keepOrdinaryToolsListComplete: true,
  };
}
