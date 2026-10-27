// Fixed bridge over the unchanged maintained reader. No payment/server imports.
import { readMarkdown, readMcpOutputSchema } from './reader-core/extract.mjs';
import { assertPublicHttpUrl } from './reader-core/extract-batch-c1/url-guard.mjs';

const watchdog = setTimeout(() => process.exit(124), 14_000);
try {
  const chunks = []; let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 8192) throw Object.assign(new Error(), { code: 'invalid_request' });
    chunks.push(chunk);
  }
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!input || Object.keys(input).sort().join(',') !== 'limit,url' || typeof input.url !== 'string' ||
      !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 40000) {
    throw Object.assign(new Error(), { code: 'invalid_request' });
  }
  const canonical = assertPublicHttpUrl(input.url).href;
  const reader = await readMarkdown(input.url, input.limit);
  readMcpOutputSchema.parse(reader);
  if (reader.requestedUrl !== canonical) throw Object.assign(new Error(), { code: 'reader_identity_mismatch' });
  process.stdout.write(JSON.stringify({ kind: 'reader', value: reader }));
} catch (error) {
  // Stable codes only: never propagate a backend message, stack, URL or auth.
  const refused = ['invalid_url', 'invalid_protocol', 'ssrf_blocked', 'invalid_request'];
  const known = [...refused, 'timeout', 'unsupported_encoding', 'invalid_response', 'redirect_error', 'reader_identity_mismatch'];
  let code = error?.name === 'AbortError' || error?.code === 'ABORT_ERR' ? 'timeout' : error?.code;
  if (!known.includes(code)) code = 'reader_transport_unreceived';
  process.stdout.write(JSON.stringify({ kind: 'failure', code, outcome: refused.includes(code) ? 'refused' : 'unreceived' }));
} finally { clearTimeout(watchdog); }
