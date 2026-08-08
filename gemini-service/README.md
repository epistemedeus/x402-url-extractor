# SameDayDesk Gemini Evidence Miner

This Cloud Run service gives the SameDayDesk gateway a genuine Google Cloud +
Gemini synthesis layer. Gemini turns bounded evidence excerpts into structured
claims; deterministic application code then rejects any claim that cites an ID
outside the supplied evidence set.

## Endpoints

- `GET /healthz` reports the provider, model, project, and protection state.
- `GET /demo` runs a fixed SameDayDesk evidence brief. Results are cached for 15
  minutes and fresh model calls are capped at eight per instance-hour.
- `POST /synthesize` accepts a bounded custom evidence set and requires the
  `x-samedaydesk-key` header.

The service accepts no arbitrary URLs to fetch, caps request and output size,
uses structured JSON output, and never exposes a Google API key. On Cloud Run it
authenticates to Vertex AI through Application Default Credentials. Structured
responses are capped to five short claims and four caveats, with a 2,048-token
model ceiling so valid JSON can finish without permitting unbounded output.

## Local verification

```sh
npm ci
npm test
```

## Cost-capped deployment

```sh
gcloud run deploy samedaydesk-evidence-miner \
  --source . \
  --project samedaydesk \
  --region us-central1 \
  --allow-unauthenticated \
  --min 0 \
  --max 1 \
  --concurrency 4 \
  --cpu 1 \
  --memory 512Mi \
  --timeout 45 \
  --set-env-vars GOOGLE_CLOUD_PROJECT=samedaydesk,GOOGLE_CLOUD_LOCATION=global,GEMINI_MODEL=gemini-2.5-flash
```

The custom `POST /synthesize` route remains disabled until `DEMO_ACCESS_KEY` is
set through Cloud Run configuration or Secret Manager.
