import {
  FIXTURE_AMOUNT,
  FIXTURE_NETWORK,
  FIXTURE_PAY_TO,
  FIXTURE_RESOURCE,
  TOOL_NAME,
} from "./pins.mjs";

export const FIXTURE_CHALLENGE = Object.freeze({
  error: "Payment required",
  x402Version: 2,
  accepts: Object.freeze([
    Object.freeze({
      scheme: "exact",
      network: FIXTURE_NETWORK,
      amount: FIXTURE_AMOUNT,
      payTo: FIXTURE_PAY_TO,
      resource: FIXTURE_RESOURCE,
      description: "local unpaid extract fixture; not a live offer; not settlement",
      extra: Object.freeze({ fixture: true, charged: false }),
    }),
  ]),
});

export function unpaidExtractResult() {
  return {
    content: [{ type: "text", text: JSON.stringify(FIXTURE_CHALLENGE) }],
    isError: true,
    structuredContent: structuredClone(FIXTURE_CHALLENGE),
  };
}

export function extractToolDescriptor() {
  return {
    name: TOOL_NAME,
    description: "URL -> structured JSON. Unpaid tools/call is isError Payment required, not settlement.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  };
}
