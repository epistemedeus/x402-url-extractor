export function extractCapture(overrides = {}) {
  return {
    method: "http-get-no-javascript",
    javascriptExecuted: false,
    maxBodyBytes: 3_000_000,
    textExcerptLimitChars: 1200,
    markdownLimitChars: null,
    bodyBytes: 128,
    bodyTruncated: false,
    textTruncated: false,
    charset: "utf-8",
    charsetSource: "content-type",
    ...overrides,
  };
}

export function validExtractBody(overrides = {}) {
  return {
    ok: true,
    requestedUrl: "https://ok.example/",
    finalUrl: "https://ok.example/",
    url: "https://ok.example/",
    status: 200,
    sourceOk: true,
    error: null,
    contentType: "text/html; charset=utf-8",
    title: "Example Domain",
    description: "Public example page used as a controlled extract fixture.",
    canonical: "https://example.com/",
    lang: "en",
    openGraph: {},
    twitter: {},
    jsonLd: [],
    headings: { h1: ["Example Domain"], h2: [] },
    links: [],
    text: "Example Domain This domain is for use in documentation examples without private customer content.",
    aiReadiness: {
      hasJsonLd: false,
      hasOpenGraph: false,
      hasTitle: true,
      hasDescription: true,
      hasCanonical: true,
      schemaTypes: [],
    },
    capture: extractCapture(),
    fetchedAt: "2026-09-11T00:00:00.000Z",
    ...overrides,
  };
}

export function validReadBody(overrides = {}) {
  return {
    ok: true,
    requestedUrl: "https://ok.example/",
    finalUrl: "https://ok.example/",
    url: "https://ok.example/",
    status: 200,
    sourceOk: true,
    error: null,
    title: "Example Domain",
    markdown: "# Example Domain\n\nPublic example page.",
    wordCount: 6,
    truncated: false,
    capture: extractCapture({
      textExcerptLimitChars: null,
      markdownLimitChars: 40_000,
    }),
    fetchedAt: "2026-09-11T00:00:00.000Z",
    ...overrides,
  };
}

export function validBatchBody(overrides = {}) {
  return {
    ok: true,
    product: "samedaydesk-extract-batch",
    schemaVersion: "samedaydesk.extract-batch.v0",
    quote: {
      amountAtomic: "10000",
      displayUsdc: "0.01",
      meaning: "up to five public URLs",
    },
    jobId: "ab".repeat(32),
    jobStatus: "completed",
    stopReason: null,
    partial: false,
    sources: [{
      id: "1",
      source: "https://ok.example/",
      status: "success",
      data: {},
      notes: [],
      error: null,
      provenance: null,
    }],
    accounting: {},
    costInputs: {},
    charged: true,
    boundary: {},
    ...overrides,
  };
}

export function merchantCatchEnvelope({
  url = "https://slow.example/",
  code = "timeout",
  message = "aborted",
} = {}) {
  return {
    ok: false,
    url,
    requestedUrl: url,
    finalUrl: null,
    status: null,
    sourceOk: false,
    error: { code, message },
    capture: extractCapture({
      bodyBytes: 0,
      charset: null,
      charsetSource: "default-utf-8",
    }),
  };
}

export function historicalV1Row(overrides = {}) {
  return {
    v: 1,
    id: "11111111-1111-4111-8111-111111111111",
    requestStartedAt: "2026-09-10T00:00:00.000Z",
    responseFinishedAt: "2026-09-10T00:00:01.000Z",
    method: "GET",
    route: "/extract",
    originClass: "external",
    source: "direct-or-unattributed",
    payerClass: "unclassified",
    requestDigest: "a".repeat(64),
    credentialFingerprint: "b".repeat(64),
    responseDigest: "c".repeat(64),
    settlementReference: `0x${"d".repeat(64)}`,
    paymentProtocol: "x402",
    runtimeAttribution: "http",
    validatorVerdict: "not_checked",
    validatorAuthority: "none",
    validatorSource: "http_runtime_not_checked",
    ...overrides,
  };
}
