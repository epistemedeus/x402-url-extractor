import { spawn } from 'node:child_process';

/** A bounded, owned native command group. No shell and no output in errors.
 * Killing a command also contains its native signer child; uncertainty remains
 * the caller's durable marker and must never trigger an automatic replay. */
export function runNativeProcess(file, args, { cwd, env, signal, timeoutMs = 45000, maxBytes = 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(Error('Native worker stopping')); return; }
    const child = spawn(file, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let bytes = 0; let stdout = ''; let failed = false;
    let timer; let killTimer;
    const killGroup = sig => { if (child.pid) { try { process.kill(-child.pid, sig); } catch (error) { if (error.code !== 'ESRCH') failed = true; } } };
    const stop = () => { failed = true; killGroup('SIGTERM'); killTimer ??= setTimeout(() => killGroup('SIGKILL'), 500); };
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes <= maxBytes) stdout += chunk.toString(); else stop(); });
    child.stderr.on('data', chunk => { bytes += chunk.length; if (bytes > maxBytes) stop(); });
    child.on('error', () => { failed = true; });
    timer = setTimeout(stop, timeoutMs);
    signal?.addEventListener('abort', stop, { once: true });
    child.on('close', code => {
      clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', stop);
      killGroup('SIGKILL');
      if (failed || code !== 0) reject(Error('Native command failed, exceeded bounds or stopped'));
      else resolve({ stdout });
    });
  });
}
