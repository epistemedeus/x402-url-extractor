import { assertPublicHttpUrl } from "../../../extract-batch-c1/url-guard.mjs";

export function evaluateFit(url, acceptance = {}) {
  const criteria = acceptance && typeof acceptance === "object" ? acceptance : {};
  try {
    const parsed = assertPublicHttpUrl(url);
    if (criteria.requireHttps === true && parsed.protocol !== "https:") {
      return { fit: false, reason: "https_required", paymentAttempts: 0, newPayment: false };
    }
    return {
      fit: true,
      reason: null,
      href: parsed.href,
      paymentAttempts: 0,
      newPayment: false,
      titleChecked: false,
    };
  } catch (error) {
    return {
      fit: false,
      reason: typeof error?.code === "string" ? error.code : "invalid_url",
      paymentAttempts: 0,
      newPayment: false,
    };
  }
}
