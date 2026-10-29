import { readMarkdown, readMcpOutputSchema } from './.runtime/reader-core/extract.mjs';
try {
  const chunks = []; let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 8192) throw Object.assign(Error(), { code: 'invalid_input' });
    chunks.push(chunk);
  }
  const { url, maxChars } = JSON.parse(Buffer.concat(chunks));
  const value = await readMarkdown(url, maxChars);
  readMcpOutputSchema.parse(value);
  process.stdout.write(JSON.stringify({ kind: 'reader', value, connections: globalThis.__OFFLINE_CONNECTIONS__ }));
} catch (error) {
  let code = error?.name === 'AbortError' || error?.code === 'ABORT_ERR' ? 'timeout' : error?.code;
  if (!['timeout', 'ssrf_blocked', 'redirect_error', 'invalid_url', 'invalid_protocol',
    'unsupported_encoding', 'invalid_response'].includes(code)) code = 'reader_unreceived';
  process.stdout.write(JSON.stringify({ kind: 'failure', code, connections: globalThis.__OFFLINE_CONNECTIONS__ }));
}
