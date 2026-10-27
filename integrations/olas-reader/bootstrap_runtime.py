"""Cold stateless reader install. Strict official Peewee source profile by default.

No setup/operator/ledger/IPFS service starts. --resume completes unfinished stages
only, refuses source/profile drift, and keeps every command's first failure.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import signal
import subprocess
import sys
import tarfile
import time
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent
SHA = lambda body: hashlib.sha256(body).hexdigest()
PROFILES = ('strict-kv-3.17.5', 'server-lock-3.19.0')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def receive(row, cap=2097152, custody=None):
    """Only locked HTTPS source/artifacts; never a redirect or a partial body."""
    if not row['url'].startswith('https://'):
        raise ValueError('HTTPS required')
    with urllib.request.build_opener(NoRedirect).open(row['url'], timeout=30) as response:
        body = response.read(cap + 1)
    digest = SHA(body)
    if custody is not None:
        custody(body, digest)  # retain even a refused response before interpreting it
    if len(body) > cap:
        raise ValueError('source body exceeds bound: ' + row['label'])
    if 'members' in row:
        verify_archive(body, row['members'])
    elif len(body) != row['bytes'] or digest != row['sha256']:
        raise ValueError('source identity mismatch: ' + row['label'])
    return body


def verify_archive(body, expected):
    import io
    with tarfile.open(fileobj=io.BytesIO(body)) as tar:
        actual = {}
        for member in safe_members(tar):
            if member.isfile():
                if member.name in actual: raise ValueError('duplicate archive member')
                if member.name not in expected or member.size != expected[member.name]['bytes']:
                    raise ValueError('unexpected archive member or size')
                actual[member.name] = {'bytes':member.size,'sha256':SHA(tar.extractfile(member).read())}
    if actual != expected:
        raise ValueError('archive member identity mismatch')


def verify(path, row):
    body = path.read_bytes()
    if 'members' in row:
        verify_archive(body,row['members'])
    elif len(body) != row['bytes'] or SHA(body) != row['sha256']:
        raise ValueError('artifact identity mismatch: ' + str(path))


def verify_tree(root, expected):
    if source_files(root) != expected:
        raise ValueError('materialized runtime drift: '+str(root))


def source_files(root):
    return {str(p.relative_to(root)): {'bytes': p.stat().st_size, 'sha256': SHA(p.read_bytes())}
            for p in sorted(root.rglob('*')) if p.is_file() and
            not any(x in p.relative_to(root).parts for x in ['node_modules', '__pycache__', '.git'])}


def safe_members(tar):
    for member in tar.getmembers():
        path = Path(member.name)
        if path.is_absolute() or '..' in path.parts or member.issym() or member.islnk() or member.isdev():
            raise ValueError('unsafe source archive member')
        yield member


def preflight(target, profile):
    if profile not in PROFILES:
        raise ValueError('unsupported profile; no fallback')
    repository = ROOT.parent.parent
    if target.is_symlink() or repository == target or repository in target.parents or target in ROOT.parents:
        raise ValueError('target must be outside probe/repository source')
    if sys.version_info[:3] != (3, 12, 3) or platform.machine() != 'x86_64' or sys.platform != 'linux':
        raise ValueError('supported profile requires Linux x86_64 Python3.12.3')
    for command in ['node', 'npm']:
        if not shutil.which(command):
            raise ValueError('missing enrolled ' + command)
    if subprocess.check_output(['node', '--version'], text=True).strip() != 'v22.23.4':
        raise ValueError('supported profile requires Node22.23.4')


def tool_identity():
    def binary(command):
        path = Path(shutil.which(command)).resolve()
        return {'path':str(path),'sha256':SHA(path.read_bytes())}
    return {'python':sys.version,'pythonBinary':{'path':str(Path(sys.executable).resolve()),'sha256':SHA(Path(sys.executable).read_bytes())},
            'pip':subprocess.check_output([sys.executable,'-m','pip','--version'],text=True).strip(),
            'node':subprocess.check_output(['node','--version'],text=True).strip(),'nodeBinary':binary('node'),
            'npm':subprocess.check_output(['npm','--version'],text=True).strip(),'npmEntryPoint':binary('npm')}


class Bootstrap:
    def __init__(self, target, profile, resume=False, source_repair=False):
        self.target, self.profile = target, profile
        preflight(target, profile)
        identity = {'profile': profile, 'sourceFiles': source_files(ROOT)}
        if target.exists() and any(target.iterdir()):
            if not resume or not (target/'INPUT.json').is_file():
                raise ValueError('nonempty target; explicit --resume with matching INPUT required')
            previous = json.loads((target/'INPUT.json').read_text())
            if previous != identity:
                if not source_repair or previous['profile'] != profile or (target/'install.complete.json').exists():
                    raise ValueError('resume input/profile drift')
                for name in ['runtime-wheels.json','runtime-requirements.lock','peewee-source.json']:
                    if previous['sourceFiles'][name] != identity['sourceFiles'][name]:
                        raise ValueError('completed dependency input drift')
                revision = len(list(target.glob('INPUT-before-repair-*.json')))+1
                (target/f'INPUT-before-repair-{revision}.json').write_text(json.dumps(previous,indent=2)+'\n')
                (target/'INPUT.json').write_text(json.dumps(identity,indent=2)+'\n')
        else:
            target.mkdir(parents=True, exist_ok=True)
            (target/'INPUT.json').write_text(json.dumps(identity, indent=2)+'\n')
        for name in ['logs', 'results', 'artifacts', 'wheels', 'build-tools', 'tmp', 'home', 'pip-cache', 'npm-cache']:
            (target/name).mkdir(exist_ok=True)
        self.env = {'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'LANG': 'C.UTF-8'}
        self.env.update(HOME=str(target/'home'), TMPDIR=str(target/'tmp'), PYTHONDONTWRITEBYTECODE='1',
                        PIP_CONFIG_FILE='/dev/null', PIP_CACHE_DIR=str(target/'pip-cache'),
                        PIP_DISABLE_PIP_VERSION_CHECK='1', PIP_NO_INPUT='1', NO_SQLITE='1',
                        NPM_CONFIG_USERCONFIG=str(target/'npm-user.conf'),
                        NPM_CONFIG_GLOBALCONFIG=str(target/'npm-global.conf'), NPM_CONFIG_CACHE=str(target/'npm-cache'))
        for name in ['npm-user.conf', 'npm-global.conf']:
            (target/name).touch()
        tools = tool_identity()
        tool_file = target/'TOOLS.json'
        if tool_file.exists() and json.loads(tool_file.read_text()) != tools:
            raise ValueError('enrolled toolchain drift')
        if not tool_file.exists(): tool_file.write_text(json.dumps(tools,indent=2)+'\n')

    def run(self, label, command, timeout=600, **kwargs):
        index = len(list((self.target/'logs').glob('*.json')))+1
        prefix = self.target/'logs'/f'{index:03}-{label}'
        receipt = {'command': list(map(str, command)), 'startedAt': time.time(), 'label': label}
        with prefix.with_suffix('.stdout').open('xb') as out, prefix.with_suffix('.stderr').open('xb') as err:
            with subprocess.Popen(command, env=self.env, stdout=out, stderr=err, start_new_session=True, **kwargs) as process:
                receipt['pid'] = process.pid
                try:
                    process.wait(timeout=timeout)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid,signal.SIGKILL);process.wait()
                    receipt['timedOut'] = True
                receipt['exit'] = process.returncode
        receipt.update(finishedAt=time.time())
        prefix.with_suffix('.json').write_text(json.dumps(receipt, indent=2)+'\n')
        print(label, receipt['exit'], flush=True)
        if receipt['exit']:
            raise RuntimeError('failed stage; retained logs: ' + str(prefix))

    def stage(self, name, function):
        marker = self.target/(name+'.complete.json')
        if marker.exists():
            print('received earlier stage:', name, flush=True)
            return
        function()
        marker.write_text(json.dumps({'finishedAt': time.time()})+'\n')

    def artifact(self, row, cap=2097152):
        path = self.target/'artifacts'/row['file']
        if path.exists():
            verify(path, row)
        else:
            def custody(body,digest):
                capture = self.target/'artifacts'/(row['file']+'.received-'+digest)
                if not capture.exists(): capture.write_bytes(body)
                with (self.target/'results/http-receipts.jsonl').open('a') as log:
                    log.write(json.dumps({'label':row['label'],'url':row['url'],'bytes':len(body),'sha256':digest,'at':time.time()})+'\n')
            body = receive(row, cap, custody)
            path.write_bytes(body)
        return path

    def materialize(self):
        probe = self.target/'probe'
        shutil.copytree(ROOT, probe, ignore=shutil.ignore_patterns('node_modules', '__pycache__'), dirs_exist_ok=True)
        # Validate the unchanged seven-file reader plus original MIT notice.
        for row in json.loads((probe/'reader-core/SOURCES.json').read_text())['files']:
            if row['label'] == 'reader-package-lock.json':
                continue  # documented minimal dependency projection, not full merchant lock
            name = row['url'].split('/38f8787b04bf3221ee0875ce1a6af687592c8015/')[1]
            verify(probe/'reader-core'/name, row)
        lock = json.loads((probe/'runtime-source-lock.json').read_text())
        runtime = self.target/'source-runtime'
        for row in lock['components']:
            row = dict(row, file=row['label']+'.tar',members=json.loads((ROOT/'runtime-archive-members.json').read_text())[row['label']])
            archive = self.artifact(row)
            dest = runtime/'packages'/row['author']/row['kind']/row['name']
            with tarfile.open(archive) as tar:
                for member in safe_members(tar):
                    parts = Path(member.name).parts
                    if not member.isfile() or len(parts)<3 or parts[1]!=row['name'] or 'tests' in parts:
                        continue
                    path = dest/Path(*parts[2:]); path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(tar.extractfile(member).read())
        for row in lock['individualFiles']:
            path = runtime/row['relative'];path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(self.artifact(dict(row, file=row['label']+'.py')).read_bytes())
        # Namespace scaffolds only; never replace an official module.
        for path in list(runtime.rglob('*.py')):
            for parent in path.parents:
                if parent == runtime: break
                (parent/'__init__.py').touch(exist_ok=True)
        diagnostic = {'selected-ipfs':'utils/ipfs.py', 'selected-task':'utils/task.py',
                      'selected-behaviours':'behaviours.py', 'selected-local-cid':'utils/local_cid.py',
                      'selected-apis':'utils/apis.py', 'selected-benchmarks':'utils/benchmarks.py',
                      'selected-skill':'skill.yaml'}
        for row in json.loads((probe/'upstream/SOURCES.json').read_text()):
            if row['label'] in diagnostic:
                name = diagnostic[row['label']]
                body = runtime/'packages/valory/skills/task_execution'/name
                verify(body, row)
                shutil.copyfile(body, probe/'upstream'/Path(name).name)
        (self.target/'results/source-identity.json').write_text(json.dumps({'files':source_files(runtime)},indent=2)+'\n')

    def dependencies(self):
        rows = json.loads((ROOT/'runtime-wheels.json').read_text())['wheels']
        selected = [r for r in rows if self.profile == PROFILES[1] or r['name'].lower()!='peewee']
        lock = self.target/'download.lock'
        lock.write_text(''.join(r['name']+'=='+r['version']+' --hash=sha256:'+r['sha256']+'\n' for r in selected))
        self.run('download-runtime', [sys.executable,'-m','pip','download','--index-url','https://pypi.org/simple',
            '--only-binary=:all:','--no-deps','--require-hashes','--dest',str(self.target/'wheels'),'-r',str(lock)])
        for row in selected: verify(self.target/'wheels'/row['file'], row)
        if self.profile == PROFILES[0]:
            build = json.loads((ROOT/'peewee-source.json').read_text())
            for row in build['buildTools']:
                shutil.copyfile(self.artifact(row), self.target/'build-tools'/row['file'])
            tools_lock = self.target/'build-tools.lock'
            tools_lock.write_text(''.join(r['name']+'=='+r['version']+' --hash=sha256:'+r['sha256']+'\n' for r in build['buildTools']))
            self.run('build-venv',[sys.executable,'-m','venv','--without-pip',str(self.target/'build-env')])
            self.run('build-tools',[sys.executable,'-m','pip','--python',str(self.target/'build-env'),'install','--no-index',
                '--find-links',str(self.target/'build-tools'),'--no-deps','--require-hashes','-r',str(tools_lock)])
            archive = self.artifact(build['source'], 4194304)
            # Reviewable exact setup/build declarations saved before executing official backend.
            with tarfile.open(archive) as tar:
                list(safe_members(tar))
                for name in ['setup.py','pyproject.toml','LICENSE']:
                    member = tar.getmember('peewee-3.17.5/'+name)
                    (self.target/'results'/('peewee-'+name)).write_bytes(tar.extractfile(member).read())
            self.run('peewee-wheel',[sys.executable,'-m','pip','--python',str(self.target/'build-env'),'wheel',
                '--no-deps','--no-build-isolation','--no-index','--no-cache-dir','--wheel-dir',str(self.target/'wheels'),str(archive)])
            wheels = list((self.target/'wheels').glob('peewee-3.17.5-*.whl'))
            if len(wheels)!=1: raise ValueError('one strict wheel required')
            wheel = wheels[0]
            with zipfile.ZipFile(wheel) as z:
                if any(n.endswith(('.so','.pyd')) for n in z.namelist()): raise ValueError('pure-Python profile required')
                meta = z.read('peewee-3.17.5.dist-info/METADATA').decode()
                if '\nVersion: 3.17.5\n' not in meta: raise ValueError('wrong built version')
            selected.append({'name':'peewee','version':'3.17.5','file':wheel.name,'bytes':wheel.stat().st_size,'sha256':SHA(wheel.read_bytes())})
            (self.target/'results/peewee-build.json').write_text(json.dumps({'inputs':build,'wheel':selected[-1],
                'environment':{'NO_SQLITE':'1'},
                'python':sys.version,'compiledExtensions':False},indent=2)+'\n')
        (self.target/'runtime.lock').write_text(''.join(r['name']+'=='+r['version']+' --hash=sha256:'+r['sha256']+'\n' for r in selected))
        (self.target/'results/wheels.json').write_text(json.dumps(selected,indent=2)+'\n')

    def install(self):
        self.run('runtime-venv',[sys.executable,'-m','venv','--without-pip',str(self.target/'venv')])
        self.run('runtime-install',[sys.executable,'-m','pip','--python',str(self.target/'venv'),'install','--no-index',
            '--find-links',str(self.target/'wheels'),'--only-binary=:all:','--no-deps','--require-hashes','-r',str(self.target/'runtime.lock')])
        self.run('installed-identity',[str(self.target/'venv/bin/python'),'-B','-c',
            'import importlib.metadata,json,sys; print(json.dumps({"python":sys.version,"distributions":{d.metadata["Name"].lower().replace("_","-"):d.version for d in importlib.metadata.distributions()}},indent=2))'])
        expected = {r['name'].lower().replace('_','-'):r['version'] for r in json.loads((self.target/'results/wheels.json').read_text())}
        identity_log = sorted((self.target/'logs').glob('*-installed-identity.stdout'))[-1]
        actual = json.loads(identity_log.read_text())
        if len(expected)!=78 or actual['distributions']!=expected: raise ValueError('installed closure mismatch')
        (self.target/'results/installed-identity.json').write_text(json.dumps(actual,indent=2)+'\n')
        (self.target/'results/installed-files.json').write_text(json.dumps(source_files(self.target/'venv'),indent=2)+'\n')

    def reader_install(self):
        self.run('reader-install',['npm','ci','--ignore-scripts','--no-audit','--no-fund','--prefix',str(self.target/'probe/reader-core')])
        (self.target/'results/npm-files.json').write_text(json.dumps(source_files(self.target/'probe/reader-core/node_modules'),indent=2)+'\n')

    def replay(self):
        self.env.update(OLAS_READER_RESULTS=str(self.target/'results'),
                        PYTHONPATH=str(self.target/'source-runtime')+':'+str(self.target/'probe'))
        self.run('18-case-replay',[str(self.target/'venv/bin/python'),'-B','-m','unittest','test_probe','test_whole_runtime','-v'], cwd=self.target/'probe')

    def build(self, replay=False):
        for name, function in [('dependencies',self.dependencies),('materialize',self.materialize),('install',self.install),('reader-install',self.reader_install)]:
            self.stage(name,function)
        # Revalidate staged sources and artifacts before any resumed execution.
        for name,row in json.loads((self.target/'INPUT.json').read_text())['sourceFiles'].items():
            verify(self.target/'probe'/name,row)
        for row in json.loads((self.target/'probe/upstream/SOURCES.json').read_text()):
            verify(self.target/'probe/upstream'/row['url'].rsplit('/',1)[1],row)
        verify_tree(self.target/'probe/reader-core/node_modules',json.loads((self.target/'results/npm-files.json').read_text()))
        for row in json.loads((self.target/'results/wheels.json').read_text()): verify(self.target/'wheels'/row['file'],row)
        for name in ['source-runtime','venv']:
            receipt = 'source-identity.json' if name=='source-runtime' else 'installed-files.json'
            expected = json.loads((self.target/'results'/receipt).read_text())
            if name=='source-runtime': expected=expected['files']
            verify_tree(self.target/name, expected)
        if replay: self.stage('replay',self.replay)
        print('received profile',self.profile,'at',self.target,flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('target',type=Path)
    parser.add_argument('--profile',choices=PROFILES,default=PROFILES[0])
    parser.add_argument('--resume',action='store_true')
    parser.add_argument('--source-repair',action='store_true',help='before install only: record source repair; dependency inputs must remain exact')
    parser.add_argument('--replay',action='store_true')
    args=parser.parse_args()
    # Refuse symlink before resolve; destination ancestry is checked again.
    if args.target.is_symlink(): parser.error('symlink target refused')
    if args.source_repair and not args.resume: parser.error('--source-repair requires --resume')
    Bootstrap(args.target.resolve(),args.profile,args.resume,args.source_repair).build(args.replay)
