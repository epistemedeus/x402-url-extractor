import {
  compareHeldPages,
  detectPinRefusal,
  recoverToSupportedProtocol,
  recoverUnknownTool,
} from "samedaydesk-capability-compat";

export async function useFreeCompare(endpoint, clientSdk) {
  return compareHeldPages({ endpoint, clientSdk });
}

export async function usePinProbe(endpoint, clientSdk) {
  return detectPinRefusal({ endpoint, clientSdk });
}

export async function useRecoveredCompare(endpoint, clientSdk) {
  const recovered = await recoverToSupportedProtocol({ endpoint, clientSdk });
  try {
    const unknown = await recoverUnknownTool({ session: recovered.session });
    return {
      protocol: recovered.protocol,
      listed: unknown.listed,
      charged: unknown.body.charged,
      verdict: unknown.body.report?.verdict ?? null,
      body: unknown.body,
    };
  } finally {
    await recovered.session.close();
  }
}
