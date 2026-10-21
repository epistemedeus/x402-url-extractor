import fs from 'node:fs';
import path from 'node:path';
const fail = message => { throw Error(message); };
const sync = directory => { const fd = fs.openSync(directory, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } };
export function privateDirectory(directory, uid, gid) {
  const s = fs.lstatSync(directory);
  if (!s.isDirectory() || fs.realpathSync(directory) !== path.resolve(directory) || s.uid !== uid || (gid !== undefined && s.gid !== gid) || (s.mode & 0o077)) fail('Private real owned directory required');
}
export function privateFile(file, uid, max = 65536) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const s = fs.fstatSync(fd);
    if (!s.isFile() || s.uid !== uid || (s.mode & 0o077) || s.size > max || s.nlink !== 1) fail('Private bounded owned file required');
    return fs.readFileSync(fd, 'utf8');
  } finally { fs.closeSync(fd); }
}
export function writePrivate(file, contents) {
  // Do not replace an unexpected file/symlink, even for enrollment output.
  try { privateFile(file, process.getuid(), 1024 * 1024); }
  catch (error) { if (error.code !== 'ENOENT') throw error;
    // A dangling symlink is still an existing entry and must refuse.
    try { fs.lstatSync(file); fail('Unexpected enrollment output entry'); } catch (statError) { if (statError.code !== 'ENOENT') throw statError; }
  }
  const temporary = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(fd, contents); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file); sync(path.dirname(file));
}
export function initializeStore(directory, { uid = process.getuid(), gid = process.getgid(), bootstrap = false } = {}) {
  if (!path.isAbsolute(directory) || path.resolve(directory) !== directory || directory === '/') fail('Explicit absolute volume path required');
  const s = fs.lstatSync(directory);
  if (!s.isDirectory() || fs.realpathSync(directory) !== directory) fail('Real existing dedicated volume required');
  if (bootstrap && s.uid === 0 && fs.readdirSync(directory).length === 0) {
    // Only the empty mount itself changes ownership; never recursive chown.
    fs.chownSync(directory, uid, gid); fs.chmodSync(directory, 0o700); sync(path.dirname(directory));
  }
  privateDirectory(directory, uid, gid);
  const marker = path.join(directory, '.managed-layout.json');
  const identity = JSON.stringify({ schema: 'acp-managed-store/v1', uid, gid });
  const entries = fs.readdirSync(directory);
  if (!entries.length) {
    const fd = fs.openSync(marker, 'wx', 0o600);
    try {
      if (bootstrap) fs.fchownSync(fd, uid, gid);
      fs.writeFileSync(fd, identity); fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    sync(directory);
  } else if (privateFile(marker, uid) !== identity) fail('Conflicting managed store identity');
  const names = ['home', 'profile', 'empty', 'operations', 'enrollment'];
  if (fs.readdirSync(directory).some(name => ![...names, '.managed-layout.json', 'worker.json'].includes(name))) fail('Unexpected volume contents');
  for (const name of names) {
    const target = path.join(directory, name);
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { mode: 0o700 });
      if (bootstrap) fs.chownSync(target, uid, gid);
      sync(directory);
    }
    privateDirectory(target, uid, gid);
  }
  if (fs.readdirSync(path.join(directory, 'empty')).length) fail('Native CLI cwd must stay empty');
  const home = path.join(directory, 'home');
  for (const name of ['.local', '.config', '.cache']) {
    const target = path.join(home, name);
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { mode: 0o700 });
      if (bootstrap) fs.chownSync(target, uid, gid);
      sync(home);
    }
    privateDirectory(target, uid, gid);
  }
  // Inspect metadata only. A copied/symlinked/foreign credential subtree cannot
  // redirect this service into another writer's store; retained bytes stay untouched.
  let visited = 0;
  function inspect(current, depth = 0) {
    if (++visited > 8192 || depth > 16) fail('Managed store metadata exceeds bound');
    const entry = fs.lstatSync(current);
    if (entry.uid !== uid || entry.gid !== gid || entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile()) || (!entry.isDirectory() && entry.nlink !== 1)) fail('Foreign or linked managed store entry');
    if (entry.mode & 0o022) fail('Writable shared managed store entry');
    if (entry.isDirectory()) for (const name of fs.readdirSync(current)) inspect(path.join(current, name), depth + 1);
  }
  for (const name of names) inspect(path.join(directory, name));
  inspect(marker);
  try { fs.lstatSync(path.join(directory, 'worker.json')); inspect(path.join(directory, 'worker.json')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { directory, home, profile: path.join(directory, 'profile'), empty: path.join(directory, 'empty'), operations: path.join(directory, 'operations'), enrollment: path.join(directory, 'enrollment') };
}
export function storeEnvironment(store) {
  return { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: store.home, ACP_CONFIG_DIR: store.profile,
    XDG_DATA_HOME: path.join(store.home, '.local'), XDG_CONFIG_HOME: path.join(store.home, '.config'),
    XDG_CACHE_HOME: path.join(store.home, '.cache'), NODE_OPTIONS: '--max-old-space-size=768', NO_COLOR: '1' };
}
