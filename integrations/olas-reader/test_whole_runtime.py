"""Acceptance for a declared installed profile; no vendor-image/operator claim."""
import ctypes
import json
import os
from pathlib import Path
import time
import unittest
from unittest.mock import patch

import public_page_reader
import diagnostic_adapter
from trusted_transport import read_page
from whole_runtime import WholeRuntime, ROOT
from packages.valory.skills.task_execution.models import Params
from packages.valory.skills.task_execution.behaviours import TaskExecutionBehaviour
from pebble import ProcessPool

URL = json.loads((ROOT/'fixtures/PUBLIC.json').read_text())['url']
RESULTS = Path(os.environ['OLAS_READER_RESULTS'])
CASES = []


class WholeAcceptance(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Reap only this test's adopted Node child after its timed-out parent dies.
        if ctypes.CDLL(None).prctl(36,1,0,0,0) != 0:raise RuntimeError('subreaper unavailable')
        cls.runtime = WholeRuntime()

    @classmethod
    def tearDownClass(cls):
        cls.runtime.close()
        receipt = RESULTS / ('whole-useful-output-' + str(os.getpid()) + '.json')
        receipt.write_text(json.dumps(CASES,ensure_ascii=True,indent=2)+'\n')
        combined = RESULTS/'whole-useful-output.json'
        previous = json.loads(combined.read_text()) if combined.exists() else []
        combined.write_text(json.dumps(previous + CASES,ensure_ascii=True,indent=2)+'\n')

    def call(self, request, source=None):
        self.runtime.load_tool(source)
        result,response,done=self.runtime.execute(request if isinstance(request,str) else json.dumps(request))
        value=json.loads(response['result']) if result is not None else None
        if result is not None:
            self.assertEqual(result[1:4],('',None,None));self.assertIsNone(done['transaction'])
            self.assertIsInstance(self.runtime.behaviour.params,Params)
            self.assertIsInstance(self.runtime.behaviour,TaskExecutionBehaviour)
            self.assertIsInstance(self.runtime.behaviour._executor,ProcessPool)
            self.assertEqual(result[4].get('fixture',None),None)
        self.assertNotIn('AUTH_SENTINEL',json.dumps(response))
        return value,result,response,done

    def test_01_real_table_text_and_canonical_mismatch_recovery(self):
        direct=read_page(URL,40000)['value']
        raw=URL.replace('https://raw.githubusercontent.com/','HTTPS://RAW.GITHUBUSERCONTENT.COM:443/')
        self.assertFalse(diagnostic_adapter._valid_record(direct,raw,40000),'reproduce the prior raw-string contract mismatch')
        value,result,response,done=self.call({'operation':'read','url':raw})
        self.assertEqual(value['requestedUrl'],URL)
        for field in set(direct)-{'fetchedAt'}:self.assertEqual(value[field],direct[field],field)
        self.assertNotEqual(value['fetchedAt'],direct['fetchedAt'])
        for marker in ['rowspan="2"','colspan="2"','<td></td>','html#fn1','Preview','café','😀']:
            self.assertIn(marker,value['markdown'])
        self.assertEqual(value['capture']['bodyBytes'],485)
        self.assertTrue(value['sourceOk']);self.assertFalse(value['truncated'])
        CASES.append({'case':'real_public_table_and_text','direct':direct,'runtime':value,'equalExceptActualCaptureTime':True})

    def test_02_real_unicode_truncation_preserves_every_field(self):
        # A bounded cut on a page containing emoji must preserve the existing
        # reader's JavaScript code-unit behavior, not re-extract or normalize it.
        limit=77
        direct=read_page(URL,limit)['value']
        value,*_=self.call({'operation':'read','url':URL,'markdownLimitChars':limit})
        for field in set(direct)-{'fetchedAt'}:self.assertEqual(value[field],direct[field],field)
        self.assertTrue(value['truncated']);self.assertEqual(value['capture']['markdownLimitChars'],limit)
        CASES.append({'case':'real_public_unicode_truncation','direct':direct,'runtime':value})

    def test_03_malformed_duplicate_unsupported_and_unsafe_refuse(self):
        for prompt in ['{','null','[]','{"operation":"read","operation":"write","url":"https://reader.example"}',
                       json.dumps({'operation':'write','url':URL}),json.dumps({'operation':'read','url':URL,'command':'bad'}),
                       json.dumps({'operation':'read','url':URL,'markdownLimitChars':True})]:
            value,*_=self.call(prompt)
            self.assertEqual(value['schema'],public_page_reader.FAILURE_SCHEMA)
            self.assertEqual(value['error']['outcome'],'refused')
        for url in ['http://127.0.0.1','http://[::1]/','http://10.0.0.1/','http://169.254.169.254/','file:///etc/passwd']:
            value,*_=self.call({'operation':'read','url':url})
            self.assertEqual(value['error']['outcome'],'refused')
        value,*_=self.call({'operation':'read','url':URL})
        self.assertTrue(value['sourceOk'])

    def test_04_real_reader_faults_retain_refusal_unknown_and_recovery(self):
        expected={'refusal':'reader','private_redirect':'refused','malformed':'unreceived','timeout':'unreceived','unknown':'unknown','nested':'reader'}
        for mode,outcome in expected.items():
            source=f'from fault_transport import run_fault\ndef run(**kwargs):\n    return run_fault({mode!r}, **kwargs)\n'
            value,*_=self.call({'operation':'read','url':'HTTPS://READER.EXAMPLE:443'},source)
            if outcome=='reader':
                self.assertEqual(value['requestedUrl'],'https://reader.example/')
                if mode=='refusal':self.assertFalse(value['sourceOk']);self.assertEqual(value['error']['code'],'http_403')
                else:self.assertTrue(value['truncated']);self.assertIn('Table omitted',value['markdown'])
            else:
                self.assertEqual(value['schema'],public_page_reader.FAILURE_SCHEMA)
                self.assertEqual(value['error']['outcome'],outcome)
            CASES.append({'case':'controlled_source_'+mode,'runtime':value,'realSourceHTTP':False})
        value,*_=self.call({'operation':'read','url':URL})
        self.assertTrue(value['sourceOk'])

    def test_05_hard_process_timeout_no_children_then_recovery(self):
        b=self.runtime.behaviour;b.params.task_deadline=0.25
        source='from fault_transport import run_fault\ndef run(**kwargs):\n    return run_fault("hang", **kwargs)\n'
        try:
            value,result,response,done=self.call({'operation':'read','url':'https://reader.example/'},source)
            self.assertIsNone(result)
            self.assertEqual(response['result'],'Invalid response')  # official fatal-worker convention
            rows=[json.loads(line) for line in (RESULTS/'fault-children.jsonl').read_text().splitlines()]
            node=next(row['pid'] for row in reversed(rows) if row['mode']=='hang')
            until=time.monotonic()+3
            while time.monotonic()<until:
                try:
                    if os.waitpid(node,os.WNOHANG)[0]==node:break
                except ChildProcessError:
                    if not Path('/proc',str(node)).exists():break
                time.sleep(.02)
            self.assertFalse(Path('/proc',str(node)).exists(),'Node must be dead and reaped after worker termination')
        finally:b.params.task_deadline=20.0
        value,*_=self.call({'operation':'read','url':URL})
        self.assertTrue(value['sourceOk'])
        CASES.append({'case':'real_pebble_timeout','response':response,'nodePid':node,'nodeGone':True,'laterRecovery':True})

    def test_06_tuple_hazard_through_real_consumer(self):
        source='def run(**kwargs):\n    return "QA hazard", "", {"context":"TUTORIAL_HAZARD"}, None, kwargs["api_keys"]\n'
        self.runtime.load_tool(source)
        result,response,done=self.runtime.execute(json.dumps({'operation':'read','url':URL}))
        self.assertEqual(done['transaction'],{'context':'TUTORIAL_HAZARD'})
        value,*_=self.call({'operation':'read','url':URL})
        self.assertTrue(value['sourceOk'])

    def test_07_caller_cannot_select_transport_code_auth_or_commands(self):
        self.runtime.load_tool()
        result,response,done=self.runtime.execute(json.dumps({'operation':'read','url':URL}),outer={
            '_reader_transport':'CALLER_CODE', 'tool_py':'def run(**kwargs): return "INJECTED"',
            'callable_method':'other', 'api_keys':'AUTH_SENTINEL', 'command':'bad'})
        value=json.loads(response['result'])
        self.assertTrue(value['sourceOk'])
        self.assertEqual(result[4].services,{})
        self.assertIsNone(result[2]);self.assertIsNone(result[3])
        self.assertNotIn('AUTH_SENTINEL',json.dumps(response))
        self.assertNotIn('INJECTED',json.dumps(response))
        CASES.append({'case':'untrusted_outer_fields_ignored','runtime':value})


if __name__=='__main__':unittest.main()
