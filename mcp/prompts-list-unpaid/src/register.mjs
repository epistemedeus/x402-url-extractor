import { UNPAID_PROMPT_DISCOVERY_NOTE, unpaidPromptCatalog, unpaidPromptSummaries } from "./catalog.mjs";

export function registerUnpaidPrompts(server, catalog = unpaidPromptCatalog()) {
  if (!server || typeof server.registerPrompt !== "function") {
    throw new Error("registerUnpaidPrompts requires an MCP server with registerPrompt");
  }
  for (const prompt of catalog) {
    const { name, title, description, markdown } = prompt;
    server.registerPrompt(name, { title, description }, async () => ({
      description,
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `${UNPAID_PROMPT_DISCOVERY_NOTE}\n\n${markdown}`,
          },
        },
      ],
    }));
  }
  return unpaidPromptSummaries(catalog);
}

export { UNPAID_PROMPT_DISCOVERY_NOTE, unpaidPromptCatalog };
