import express from "express";

export const LIMITS = Object.freeze({
  questionChars: 280,
  evidenceItems: 5,
  excerptChars: 1200,
  outputClaims: 5,
});

export const DEMO_INPUT = Object.freeze({
  question:
    "What evidence shows that SameDayDesk has a working, agent-accessible web-intelligence product?",
  evidence: [
    {
      id: "product",
      url: "https://samedaydesk.com/x402",
      excerpt:
        "SameDayDesk publishes an x402 Data Gateway with paid extraction, scan, schema, enrichment, wallet, and audit capabilities for agents.",
    },
    {
      id: "manifest",
      url: "https://x402-url-extractor-production.up.railway.app/.well-known/x402",
      excerpt:
        "The live machine-readable x402 manifest advertises seven resources, including /extract, /scan, /enrich, /wallet-enrich, and /deep-audit.",
    },
    {
      id: "source",
      url: "https://github.com/epistemedeus/x402-url-extractor",
      excerpt:
        "The public MIT-licensed repository contains the deployed Express service, x402 payment middleware, MCP adapter, and regression tests.",
    },
  ],
});

const OUTPUT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["summary", "claims", "caveats"],
  properties: {
    summary: { type: "string", maxLength: 600 },
    claims: {
      type: "array",
      maxItems: LIMITS.outputClaims,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["claim", "evidenceIds", "confidence"],
        properties: {
          claim: { type: "string", maxLength: 320 },
          evidenceIds: {
            type: "array",
            minItems: 1,
            maxItems: LIMITS.evidenceItems,
            items: { type: "string" },
          },
          confidence: {
            type: "string",
            enum: ["high", "medium", "low"],
          },
        },
      },
    },
    caveats: {
      type: "array",
      maxItems: 4,
      items: { type: "string", maxLength: 240 },
    },
  },
});

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function parseHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function validateInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Body must be a JSON object." };
  }

  const question = cleanText(body.question, LIMITS.questionChars + 1);
  if (question.length < 3 || question.length > LIMITS.questionChars) {
    return {
      ok: false,
      error: `question must contain 3-${LIMITS.questionChars} characters.`,
    };
  }

  if (
    !Array.isArray(body.evidence) ||
    body.evidence.length < 1 ||
    body.evidence.length > LIMITS.evidenceItems
  ) {
    return {
      ok: false,
      error: `evidence must contain 1-${LIMITS.evidenceItems} items.`,
    };
  }

  const ids = new Set();
  const evidence = [];
  for (const raw of body.evidence) {
    const id = cleanText(raw?.id, 33);
    const excerpt = cleanText(raw?.excerpt, LIMITS.excerptChars + 1);
    const url = parseHttpsUrl(raw?.url);
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(id)) {
      return { ok: false, error: "Each evidence id must be 1-32 letters, digits, _ or -." };
    }
    if (ids.has(id)) {
      return { ok: false, error: `Duplicate evidence id: ${id}.` };
    }
    if (!url) {
      return { ok: false, error: `Evidence ${id} must have an https URL.` };
    }
    if (!excerpt || excerpt.length > LIMITS.excerptChars) {
      return {
        ok: false,
        error: `Evidence ${id} excerpt must contain 1-${LIMITS.excerptChars} characters.`,
      };
    }
    ids.add(id);
    evidence.push({ id, url, excerpt });
  }

  return { ok: true, value: { question, evidence } };
}

export function buildPrompt(input) {
  return [
    "You are an evidence analyst. Use only the supplied evidence excerpts.",
    "Do not add outside facts, infer live status beyond the excerpts, or cite an ID not present below.",
    "Every claim must cite at least one evidence ID. Put uncertainty or missing proof in caveats.",
    "Return JSON matching the required schema.",
    "",
    `QUESTION: ${input.question}`,
    "",
    "EVIDENCE:",
    JSON.stringify(input.evidence, null, 2),
  ].join("\n");
}

export function verifyModelOutput(raw, input) {
  const allowedIds = new Set(input.evidence.map((item) => item.id));
  const unsupportedCitations = new Set();
  const verifiedClaims = [];
  const sourceById = Object.fromEntries(input.evidence.map((item) => [item.id, item.url]));

  for (const candidate of Array.isArray(raw?.claims) ? raw.claims : []) {
    const claim = cleanText(candidate?.claim, 320);
    const evidenceIds = Array.isArray(candidate?.evidenceIds)
      ? [...new Set(candidate.evidenceIds.filter((id) => typeof id === "string"))]
      : [];
    const unsupported = evidenceIds.filter((id) => !allowedIds.has(id));
    unsupported.forEach((id) => unsupportedCitations.add(id));
    if (!claim || evidenceIds.length === 0 || unsupported.length > 0) continue;

    const confidence = ["high", "medium", "low"].includes(candidate?.confidence)
      ? candidate.confidence
      : "low";
    verifiedClaims.push({
      claim,
      evidenceIds,
      confidence,
      citations: evidenceIds.map((id) => ({ id, url: sourceById[id] })),
    });
  }

  return {
    summary: cleanText(raw?.summary, 600),
    claims: verifiedClaims.slice(0, LIMITS.outputClaims),
    caveats: (Array.isArray(raw?.caveats) ? raw.caveats : [])
      .map((item) => cleanText(item, 240))
      .filter(Boolean)
      .slice(0, 4),
    grounding: {
      suppliedEvidenceCount: input.evidence.length,
      verifiedClaimCount: verifiedClaims.length,
      unsupportedCitations: [...unsupportedCitations],
      passed: verifiedClaims.length > 0 && unsupportedCitations.size === 0,
    },
  };
}

export function createApp({ generate, model, project, accessKey = "", now = Date.now }) {
  if (typeof generate !== "function") throw new TypeError("generate must be a function");

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "32kb", strict: true }));

  let demoWindowStartedAt = now();
  let demoCalls = 0;
  let demoCache = null;
  const demoWindowMs = 60 * 60 * 1000;
  const demoMaxCalls = 8;

  async function synthesize(input) {
    const raw = await generate({ prompt: buildPrompt(input), schema: OUTPUT_SCHEMA });
    return verifyModelOutput(raw, input);
  }

  app.get("/", (_req, res) => {
    res.json({
      name: "SameDayDesk Gemini Evidence Miner",
      provider: "Google Cloud Vertex AI",
      model,
      endpoints: ["/readyz", "/demo", "/synthesize"],
      source: "https://github.com/epistemedeus/x402-url-extractor/tree/master/gemini-service",
    });
  });

  app.get("/readyz", (_req, res) => {
    res.json({ ok: true, provider: "vertex-ai", model, project, protectedSynthesis: Boolean(accessKey) });
  });

  app.get("/demo", async (_req, res) => {
    const current = now();
    if (demoCache && current - demoCache.at < 15 * 60 * 1000) {
      return res.json({ ...demoCache.payload, cached: true });
    }
    if (current - demoWindowStartedAt >= demoWindowMs) {
      demoWindowStartedAt = current;
      demoCalls = 0;
    }
    if (demoCalls >= demoMaxCalls) {
      return res.status(429).json({ error: "Public Gemini demo hourly limit reached." });
    }
    demoCalls += 1;

    try {
      const analysis = await synthesize(DEMO_INPUT);
      const payload = {
        ok: true,
        provider: "Google Cloud Vertex AI Gemini",
        model,
        project,
        input: DEMO_INPUT,
        analysis,
        cached: false,
      };
      demoCache = { at: current, payload };
      return res.json(payload);
    } catch (error) {
      console.error("Gemini demo failed", error);
      return res.status(502).json({ error: "Gemini synthesis failed." });
    }
  });

  app.post("/synthesize", async (req, res) => {
    if (!accessKey || req.get("x-samedaydesk-key") !== accessKey) {
      return res.status(401).json({ error: "Valid x-samedaydesk-key required." });
    }
    const parsed = validateInput(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });

    try {
      const analysis = await synthesize(parsed.value);
      return res.json({
        ok: true,
        provider: "Google Cloud Vertex AI Gemini",
        model,
        project,
        input: parsed.value,
        analysis,
      });
    } catch (error) {
      console.error("Gemini synthesis failed", error);
      return res.status(502).json({ error: "Gemini synthesis failed." });
    }
  });

  app.use((error, _req, res, _next) => {
    if (error instanceof SyntaxError || error?.type === "entity.too.large") {
      return res.status(error?.type === "entity.too.large" ? 413 : 400).json({ error: "Invalid JSON body." });
    }
    console.error("Unhandled request error", error);
    return res.status(500).json({ error: "Internal server error." });
  });

  return app;
}
