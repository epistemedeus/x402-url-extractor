// A short-lived, intentionally public domain proof. Never put the private
// listing edit token here. No default, request-supplied proof or storage.
export function activeNoHumansClaimProof(config, now = Date.now()) {
  if (typeof config !== "string" || config.length > 1024) return null;
  let value;
  try {
    value = JSON.parse(config);
  } catch {
    return null;
  }
  if (!value || !Number.isSafeInteger(value.expiresAt) ||
      value.expiresAt <= now || value.expiresAt > now + 86_400_000 ||
      typeof value.token !== "string" || !/^[\x21-\x7e]{1,512}$/.test(value.token)) return null;
  return value.token;
}
