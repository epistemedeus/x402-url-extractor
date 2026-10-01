// Key names match the closed observation reject set in src/outcomes.mjs.
// Matching is on the normalized key, never on a copied value.

const RESTRICTED = [
  "prompt", "rawPrompt", "systemPrompt", "completion", "messages",
  "ip", "ipAddress", "clientIp", "userAgent", "cookie", "authorization",
  "secret", "apiKey", "email", "customerId", "wallet", "walletAddress",
  "payer", "payerAddress", "browserId",
  "prompttext", "rawtext", "completiontext", "remoteaddress", "remoteip", "clientaddress",
  "sourceip", "xforwardedfor", "forwardedfor", "userid", "accountid", "phone", "phonenumber",
  "ipaddr", "customeridentifier", "emailaddress", "walletaddr", "secretkey", "accesstoken",
  "refreshtoken", "sessionid", "authorizationheader", "browserfingerprint", "rawpayload",
  "causedBy", "causalOf", "sameTransactionAs", "transactionId", "causalKey", "causalChain",
  "cause", "causes", "causal", "causality", "causallink", "causalid", "because", "becauseof",
  "parentid", "parentobservation", "parentobservationid", "priorobservation", "sametx",
  "sametransaction", "txnid", "txid", "txhash", "transactionhash", "causallinkid", "linkedto",
  "triggeredby", "resultof", "dependson",
  "sharedCustomerId", "crossBrandIdentity",
  "samecustomer", "samecustomerid", "crossbrandcustomer", "globalcustomerid", "sharedwallet",
  "sharedidentity", "crossbranduser", "sameuser", "sameuserid", "shareduserid", "crosssiteidentity",
];

function normalizeKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
}

const RESTRICTED_NORMALIZED = new Set(RESTRICTED.map(normalizeKey));

export function isRestrictedKey(key) {
  return RESTRICTED_NORMALIZED.has(normalizeKey(key));
}

export function containsRestrictedKey(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => containsRestrictedKey(item, seen));
  for (const [key, child] of Object.entries(value)) {
    if (isRestrictedKey(key) || containsRestrictedKey(child, seen)) return true;
  }
  return false;
}

export function restrictedOwnEntries(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return [];
  return Object.entries(row).filter(([key]) => isRestrictedKey(key));
}
