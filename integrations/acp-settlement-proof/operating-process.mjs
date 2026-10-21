// Offline process entry; does not expose native/live receiving.
import { createTestBoundary } from './operating-test-boundary.mjs';
const boundary = createTestBoundary(process.argv[2], { realCli: process.argv[3] === 'native' });
try { const record = await boundary.receiver.run('123'); process.stdout.write(JSON.stringify({ state: record.state, artifactSha256: record.artifactSha256 }) + '\n'); }
finally { boundary.close(); }
