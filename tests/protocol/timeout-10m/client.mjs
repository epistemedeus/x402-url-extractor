import {
  paidTimeoutMs,
  probeTimeoutMs,
  resolveMaxRequestTimeoutSeconds,
} from "./derive.mjs";

export const MCP_PAYMENT_META_KEY = "x402/payment";

/**
 * Local stand-in for @x402/mcp wrapMCPClientWithPayment timeout application.
 * Records the timeout passed to the underlying MCP callTool. Never signs,
 * never verifies, never settles.
 */
export function wrapFakeMcpWithTimeoutCap(mcpClient, options = {}) {
  const capSeconds = resolveMaxRequestTimeoutSeconds(options.maxRequestTimeoutSeconds);
  return {
    capSeconds,
    async callTool(name, args = {}, callOptions) {
      const timeout = probeTimeoutMs(callOptions?.timeout, capSeconds);
      return mcpClient.callTool(
        { name, arguments: args },
        undefined,
        { ...callOptions, timeout },
      );
    },
    async callToolWithPayment(name, args = {}, paymentPayload, callOptions) {
      const timeout = paidTimeoutMs(
        callOptions?.timeout,
        paymentPayload?.accepted?.maxTimeoutSeconds,
        capSeconds,
      );
      return mcpClient.callTool(
        {
          name,
          arguments: args,
          _meta: { [MCP_PAYMENT_META_KEY]: paymentPayload },
        },
        undefined,
        { ...callOptions, timeout },
      );
    },
  };
}

export function createRecordingMcp() {
  const calls = [];
  return {
    calls,
    async callTool(params, _schema, options) {
      const hasPayment = Boolean(params?._meta?.[MCP_PAYMENT_META_KEY]);
      calls.push({
        name: params?.name ?? null,
        timeout: options?.timeout,
        hasPayment,
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, paid: false }) }],
        isError: false,
      };
    },
  };
}
