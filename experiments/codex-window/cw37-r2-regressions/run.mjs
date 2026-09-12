import { spawn } from 'node:child_process';
import { mkdirSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (!args[0] || args.length > 2) {
  console.error('Usage: node run.mjs /absolute/merchant/checkout [receipt.json]');
  process.exit(2);
}
mkdirSync(resolve(here, 'runtime'), { recursive: true });
const env = {
  PATH: process.env.PATH, LANG: 'C.UTF-8', TZ: 'UTC',
  NODE_OPTIONS: '--max-old-space-size=768',
  CW42_CHECKOUT: realpathSync(args[0]),
  CW42_RECEIPT: resolve(args[1] || resolve(here, 'runtime/receipt.json')),
};
// No ambient credentials, provider settings, NODE_OPTIONS loaders, or wallet env.
const child = spawn(process.execPath, [
  '--max-old-space-size=768', '--import', resolve(here, 'network-fence.mjs'),
  '--test', '--test-concurrency=1', resolve(here, 'regressions.test.mjs'),
], { env, stdio: 'inherit' });
child.on('exit', (code) => { process.exitCode = code ?? 2; });
child.on('error', (error) => { console.error(error.message); process.exitCode = 2; });
