"""Focused bootstrap refusal/integrity/recovery tests; no installs or network."""
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import bootstrap_runtime as b


class BootstrapTests(unittest.TestCase):
    def test_locked_body_mismatch_and_recovery(self):
        row={'label':'fixture','url':'https://source.example/frozen','bytes':3,'sha256':b.SHA(b'abc')}
        class Opener:
            def __init__(self,body): self.body=body
            def open(self,*args,**kwargs): return io.BytesIO(self.body)
        for body in [b'bad',b'ab',b'abcd']:
            with patch.object(b.urllib.request,'build_opener',return_value=Opener(body)):
                with self.assertRaises(ValueError): b.receive(row,3)
        with patch.object(b.urllib.request,'build_opener',return_value=Opener(b'abc')):
            self.assertEqual(b.receive(row,3),b'abc')
        with self.assertRaises(ValueError): b.receive(dict(row,url='http://source.example'))

    def test_unsafe_tar_and_valid_recovery(self):
        for name,kind in [('../escape',tarfile.REGTYPE),('/absolute',tarfile.REGTYPE),('symlink',tarfile.SYMTYPE)]:
            content=io.BytesIO()
            with tarfile.open(fileobj=content,mode='w') as t:
                m=tarfile.TarInfo(name);m.type=kind;t.addfile(m)
            content.seek(0)
            with tarfile.open(fileobj=content) as t:
                with self.assertRaises(ValueError): list(b.safe_members(t))
        content=io.BytesIO()
        with tarfile.open(fileobj=content,mode='w') as t:t.addfile(tarfile.TarInfo('package/source.py'))
        content.seek(0)
        with tarfile.open(fileobj=content) as t:self.assertEqual(len(list(b.safe_members(t))),1)

    def test_nonempty_profile_drift_and_source_tamper_refuse(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(b,'preflight'),patch.object(b,'tool_identity',return_value={'fixture':'tools'}):
            target=Path(temp)/'owned'
            first=b.Bootstrap(target,b.PROFILES[0])
            with self.assertRaises(ValueError):b.Bootstrap(target,b.PROFILES[0])
            with self.assertRaises(ValueError):b.Bootstrap(target,b.PROFILES[1],True)
            received=b.Bootstrap(target,b.PROFILES[0],True)
            (target/'TOOLS.json').write_text(json.dumps({'fixture':'changed'}))
            with self.assertRaises(ValueError):b.Bootstrap(target,b.PROFILES[0],True)
            (target/'TOOLS.json').write_text(json.dumps({'fixture':'tools'}))
            calls=[];received.stage('fixture',lambda:calls.append(1));received.stage('fixture',lambda:calls.append(2))
            self.assertEqual(calls,[1],'completed work must not rerun')
            bad=target/'bad';bad.write_bytes(b'bad')
            with self.assertRaises(ValueError):b.verify(bad,{'bytes':3,'sha256':b.SHA(b'abc')})
            bad.write_bytes(b'abc');b.verify(bad,{'bytes':3,'sha256':b.SHA(b'abc')})

    def test_archive_container_metadata_can_vary_but_every_member_is_pinned(self):
        def archive(content, mtime):
            buf=io.BytesIO()
            with tarfile.open(fileobj=buf,mode='w') as t:
                member=tarfile.TarInfo('cid/package/a.py');member.size=len(content);member.mtime=mtime
                t.addfile(member,io.BytesIO(content))
            return buf.getvalue()
        expected={'cid/package/a.py':{'bytes':3,'sha256':b.SHA(b'abc')}}
        first,later=archive(b'abc',1),archive(b'abc',2)
        self.assertNotEqual(b.SHA(first),b.SHA(later))
        b.verify_archive(first,expected);b.verify_archive(later,expected)
        with self.assertRaises(ValueError):b.verify_archive(archive(b'bad',2),expected)
        with self.assertRaises(ValueError):b.verify_archive(later,{})

    def test_materialized_source_tamper_refuses_then_recovers(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);path=root/'source.py';path.write_bytes(b'original')
            expected=b.source_files(root);b.verify_tree(root,expected)
            path.write_bytes(b'changed')
            with self.assertRaises(ValueError):b.verify_tree(root,expected)
            path.write_bytes(b'original');b.verify_tree(root,expected)
            (root/'extra.py').write_bytes(b'extra')
            with self.assertRaises(ValueError):b.verify_tree(root,expected)

    def test_source_repair_preserves_completed_build_and_refuses_postinstall(self):
        with tempfile.TemporaryDirectory() as temp,patch.object(b,'preflight'),patch.object(b,'tool_identity',return_value={'fixture':'tools'}):
            target=Path(temp)/'owned';first=b.Bootstrap(target,b.PROFILES[0])
            old=json.loads((target/'INPUT.json').read_text());old['sourceFiles']['bootstrap_runtime.py']['sha256']='previous-revision'
            (target/'INPUT.json').write_text(json.dumps(old))
            with self.assertRaises(ValueError):b.Bootstrap(target,b.PROFILES[0],True)
            received=b.Bootstrap(target,b.PROFILES[0],True,True)
            self.assertTrue((target/'INPUT-before-repair-1.json').exists())
            self.assertTrue((target/'INPUT.json').exists())
            (target/'INPUT.json').write_text(json.dumps(old));(target/'install.complete.json').touch()
            with self.assertRaises(ValueError):b.Bootstrap(target,b.PROFILES[0],True,True)

    def test_unknown_profile_wrong_runtime_and_redirect_refuse(self):
        with self.assertRaises(ValueError):b.preflight(Path('/tmp/unused'),'fallback')
        with self.assertRaises(ValueError):b.preflight(b.ROOT,b.PROFILES[0])
        with patch.object(b.sys,'version_info',(3,13,0)):
            with self.assertRaises(ValueError):b.preflight(Path('/tmp/unused'),b.PROFILES[0])
        self.assertIsNone(b.NoRedirect().redirect_request(None,None,302,None,None,None))

    def test_actual_command_timeout_cleans_owned_process_then_recovers(self):
        with tempfile.TemporaryDirectory() as temp,patch.object(b,'preflight'),patch.object(b,'tool_identity',return_value={'fixture':'tools'}):
            x=b.Bootstrap(Path(temp)/'owned',b.PROFILES[0])
            with self.assertRaises(RuntimeError):
                x.run('timeout',[b.sys.executable,'-c','import time; time.sleep(60)'],timeout=.05)
            receipt=json.loads(next((x.target/'logs').glob('*.json')).read_text())
            self.assertTrue(receipt['timedOut']);self.assertFalse(Path('/proc',str(receipt['pid'])).exists())
            x.run('after-timeout',[b.sys.executable,'-c','print("recovered")'])

    def test_first_command_failure_retained_then_resume_unfinished_stage(self):
        with tempfile.TemporaryDirectory() as temp,patch.object(b,'preflight'),patch.object(b,'tool_identity',return_value={'fixture':'tools'}):
            x=b.Bootstrap(Path(temp)/'owned',b.PROFILES[0]);run=lambda:x.run('fails',[b.sys.executable,'-c','raise SystemExit(7)'])
            with self.assertRaises(RuntimeError):x.stage('work',run)
            self.assertFalse((x.target/'work.complete.json').exists())
            receipt=json.loads(next((x.target/'logs').glob('*.json')).read_text());self.assertEqual(receipt['exit'],7)
            x.stage('work',lambda:x.run('recovery',[b.sys.executable,'-c','print("received")']))
            self.assertEqual(len(list((x.target/'logs').glob('*.json'))),2)

    def test_installed_nested_files_refuse_drift_but_source_input_filter_is_explicit(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            (root/'original.mjs').write_bytes(b'original')
            expected=b.source_files(root)
            for relative in ('package/node_modules/shadow/index.mjs',
                             'package/__pycache__/module.cpython-312.pyc',
                             'package/.git/config'):
                added=root/relative
                added.parent.mkdir(parents=True,exist_ok=True)
                added.write_bytes(b'new installed file')
                with self.assertRaises(ValueError):
                    b.verify_tree(root,expected)
                self.assertIn(relative,b.source_files(root))
                self.assertEqual(b.source_files(root,excluded_parts=b.SOURCE_INPUT_EXCLUSIONS),expected)
                added.unlink()
                b.verify_tree(root,expected)
            self.assertEqual(b.source_files(root),expected)


if __name__=='__main__':unittest.main()
