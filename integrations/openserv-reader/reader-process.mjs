import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// Trusted constructor configuration only. No input may choose preload, env or argv.
export class ReaderProcess {
  constructor({ home, fixturePreload, fixtureOrigin, deadlineMs = 14000 } = {}) {
    this.home = home; this.fixturePreload = fixturePreload; this.fixtureOrigin = fixtureOrigin;
    this.deadlineMs = deadlineMs; this.active = new Set(); this.started = []; this.closed = []; this.connections = [];
  }
  run(input, signal) {
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const argv = this.fixturePreload ? ['--import', fileURLToPath(new URL('./network-guard.mjs', import.meta.url)), '--import', this.fixturePreload] : [];
      argv.push(fileURLToPath(new URL('./reader-child.mjs', import.meta.url)));
      const child = spawn(process.execPath, argv, { stdio: ['pipe', 'pipe', 'pipe'],
        env: { HOME: this.home, NODE_ENV: 'production', ...(this.fixtureOrigin ? { READER_FIXTURE_ORIGIN: this.fixtureOrigin } : {}) } });
      this.active.add(child); this.started.push(child.pid);
      let output = ''; let errorCode;
      const stop = code => { errorCode = code; child.kill('SIGKILL'); };
      const abort = () => stop('cancelled');
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => stop('timeout'), this.deadlineMs);
      child.stdout.on('data', bytes => { output += bytes; if (output.length > 1_000_000) stop('reader_output_limit'); });
      child.stderr.resume();
      child.stdin.on('error', () => {});
      child.once('error', () => { errorCode = 'reader_unreceived'; });
      child.once('close', code => {
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
        this.active.delete(child); this.closed.push(child.pid);
        if (errorCode || code !== 0) return reject(Object.assign(Error(), { code: errorCode || 'reader_unreceived' }));
        try {
          const parsed = JSON.parse(output);
          this.connections.push(...(parsed.connections || []));
          if (parsed.kind !== 'reader') return reject(Object.assign(Error(), { code: parsed.code || 'reader_unreceived' }));
          resolve(parsed.value);
        } catch { reject(Object.assign(Error(), { code: 'reader_unreceived' })); }
      });
      child.stdin.end(JSON.stringify(input));
    });
  }
}
