const MARKET8004_SEARCH_URL = "https://8004market.io/search";
const MAX_RESPONSE_BYTES = 1_048_576;

function cleanText(value, maximum = 500) {
  if (typeof value !== "string") return null;
  const decoded = value
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, entity) => {
      const number = entity[0].toLowerCase() === "x"
        ? Number.parseInt(entity.slice(1), 16)
        : Number.parseInt(entity, 10);
      return Number.isInteger(number) && number > 0 && number <= 0x10ffff
        ? String.fromCodePoint(number)
        : " ";
    })
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return decoded ? decoded.slice(0, maximum) : null;
}

function safeHttps(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

function serviceUrlsFor(html, agentKey) {
  const marker = `agent_id:"${agentKey}"`;
  const start = html.indexOf(marker);
  if (start < 0) return [];
  const nextAgent = html.indexOf('},{agent_id:"', start + marker.length);
  const endOfData = html.indexOf("],featuredAgents:", start + marker.length);
  const ends = [nextAgent, endOfData].filter((value) => value > start);
  const end = ends.length ? Math.min(...ends) : Math.min(html.length, start + 20_000);
  const record = html.slice(start, end);
  const urls = [];
  const seen = new Set();
  for (const match of record.matchAll(/endpoint:"(https:[^"]{1,2048})"/g)) {
    const url = safeHttps(match[1]);
    if (!url || seen.has(url.toString())) continue;
    seen.add(url.toString());
    urls.push(url.toString());
    if (urls.length > 50) throw new Error("8004Market agent exposed too many service endpoints");
  }
  return urls;
}

export function parseMarket8004SearchHtml(html, expectedQuery) {
  if (typeof html !== "string" || !html.trim()) throw new Error("8004Market search response was empty");
  if (Buffer.byteLength(html, "utf8") > MAX_RESPONSE_BYTES) throw new Error("8004Market search exceeded size limit");
  const input = html.match(/<input\b(?=[^>]*\bname="q")(?=[^>]*\bvalue="([^"]*)")[^>]*>/i);
  if (cleanText(input?.[1], 500) !== cleanText(expectedQuery, 500)) {
    throw new Error("8004Market search response did not bind the requested query");
  }
  const count = Number(html.match(/>(\d+)<\/span>\s*<span\b[^>]*>Assets found<\/span>/i)?.[1]);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("8004Market search response omitted its result count");

  const results = [];
  const seen = new Set();
  const cards = html.matchAll(/<a\b[^>]*href="(\/agent\/[a-z0-9-]{2,32}\/[a-z0-9-]{2,32}\/\d{1,20})"[^>]*>([\s\S]*?)<\/a>/gi);
  for (const match of cards) {
    const route = match[1].toLowerCase();
    if (seen.has(route)) throw new Error(`8004Market search contained duplicate agent ${route}`);
    seen.add(route);
    const [, , chain, network, numericId] = route.split("/");
    const name = cleanText(match[2].match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1], 200);
    const description = cleanText(
      match[2].match(/<p\b[^>]*class="[^"]*\btruncate\b[^"]*"[^>]*>([\s\S]*?)<\/p>/i)?.[1],
      500,
    );
    if (!name) throw new Error(`8004Market result ${route} omitted its name`);
    results.push({
      name,
      description,
      listingUrl: new URL(route, MARKET8004_SEARCH_URL).toString(),
      serviceUrls: serviceUrlsFor(html, `${chain}:${network}:${numericId}`),
    });
    if (results.length > 50) throw new Error("8004Market search exceeded result limit");
  }
  if (count === 0 && results.length === 0) return [];
  if (!results.length) throw new Error("8004Market search returned no parseable agent cards");
  return results;
}

export async function searchMarket8004(query, { fetchImpl = fetch, limit = 20 } = {}) {
  const cleaned = cleanText(query, 500);
  if (!cleaned) throw new Error("8004Market query is required");
  const url = new URL(MARKET8004_SEARCH_URL);
  url.searchParams.set("q", cleaned);
  const response = await fetchImpl(url, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
    headers: { accept: "text/html", "user-agent": "SameDayDesk-Discoverability-Audit/1.1" },
  });
  if (!response?.ok) throw new Error(`8004Market search returned HTTP ${response?.status}`);
  const contentType = response.headers?.get?.("content-type") || "";
  if (!/^text\/html(?:;|$)/i.test(contentType)) throw new Error("8004Market search did not return HTML");
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error("8004Market search exceeded size limit");
  }
  return parseMarket8004SearchHtml(await response.text(), cleaned).slice(0, limit);
}
