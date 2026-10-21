import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
export function receiveSource({ required = false } = {}) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const file = path.join(root, 'source-identity.json');
  if (!fs.existsSync(file)) {
    if (required) throw Error('Managed image source identity missing');
    return { sourceIdentity: 'development-checkout' };
  }
  const bytes = fs.readFileSync(file);
  const identity = JSON.parse(bytes);
  if (identity.schema !== 'acp-managed-source/v1' || !Object.keys(identity.hashes ?? {}).length) throw Error('Source identity required');
  for (const [relative, expected] of Object.entries(identity.hashes)) {
    if (path.isAbsolute(relative) || path.normalize(relative) !== relative || relative.startsWith('../')) throw Error('Invalid source identity path');
    const source = path.join(root, relative);
    if (fs.realpathSync(source) !== source || !fs.lstatSync(source).isFile() || createHash('sha256').update(fs.readFileSync(source)).digest('hex') !== expected) throw Error('Source identity mismatch');
  }
  return { sourceIdentitySha256: createHash('sha256').update(bytes).digest('hex'), sourceFiles: Object.keys(identity.hashes).length };
}
