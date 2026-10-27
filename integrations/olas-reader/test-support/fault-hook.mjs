// Test-only external source faults. Production reader bridge never imports this.
import { readFileSync } from 'node:fs';
const fixture = readFileSync(new URL('../fixtures/olas-reader-runtime.html', import.meta.url), 'utf8');
const mode = process.env.OLAS_READER_FAULT;
if (!['refusal','private_redirect','malformed','timeout','hang','unknown','nested'].includes(mode)) throw new Error('bad fixed test fault');
if (mode === 'timeout') globalThis.__SAMEDAYDESK_EXTRACT_TIMEOUT_MS__ = 80;
globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = async () => {
  if (mode === 'unknown') process.exit(0);
  if (mode === 'hang' || mode === 'timeout') return new Promise(() => {});
  if (mode === 'private_redirect') return new Response(null, {status:302, headers:{location:'http://127.0.0.1/private'}});
  if (mode === 'malformed') return {status:200,headers:new Headers(),body:null};
  return new Response(mode === 'nested' ? '<table><tr><td><table><tr><td>nested</td></tr></table></td></tr></table>' : fixture,
      {status:mode === 'refusal' ? 403 : 200, headers:{'content-type':'text/html; charset=utf-8'}});
};
