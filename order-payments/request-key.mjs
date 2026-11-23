// Keep only this digest after a wallet signs. The owner persists it after EVM
// signature verification. A digest locates status and cannot authorize payment.
export async function paymentRequestKey(resource, quote, protocol, wire) {
  const terms = [protocol, resource, quote.order, quote.version, quote.amount, quote.created, quote.expires, wire];
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(terms)));
  return Array.from(new Uint8Array(bytes), part => part.toString(16).padStart(2, "0")).join("");
}
