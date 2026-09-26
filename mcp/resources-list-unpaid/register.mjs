import { listResourceDescriptors, readResourceDocument } from "./catalog.mjs";

function readCallback(uri) {
  const href = typeof uri === "string" ? uri : uri?.href;
  const document = readResourceDocument(href);
  if (!document) {
    throw new Error(`unpaid resource not in catalog: ${href}`);
  }
  return {
    contents: [{
      uri: document.uri,
      mimeType: document.mimeType,
      text: JSON.stringify(document),
    }],
  };
}

/**
 * Register the unpaid discovery catalog on an MCP server. No payment wrapper.
 */
export function registerUnpaidResources(server) {
  if (!server || typeof server.registerResource !== "function") {
    throw new Error("registerUnpaidResources requires an MCP server with registerResource");
  }
  for (const item of listResourceDescriptors()) {
    server.registerResource(item.name, item.uri, {
      title: item.title,
      description: item.description,
      mimeType: item.mimeType,
      _meta: item._meta,
    }, async (uri) => readCallback(uri));
  }
  return listResourceDescriptors().length;
}
